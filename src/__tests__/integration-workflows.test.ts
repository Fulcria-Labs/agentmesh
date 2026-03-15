/**
 * Integration workflows - End-to-end multi-component interaction tests
 */

import { AgentRegistry } from '../core/agent-registry';
import { TaskCoordinator, TaskBid } from '../core/task-coordinator';
import { ReputationManager } from '../core/reputation';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile, MessageType } from '../core/types';
import { MCPServer } from '../mcp/mcp-server';
import { MeshNode } from '../core/mesh-node';

jest.mock('../core/hedera-client');

function createMockClient(): jest.Mocked<HederaClient> {
  const mock = new HederaClient({
    network: 'testnet',
    operatorAccountId: '0.0.1',
    operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
  }) as jest.Mocked<HederaClient>;
  mock.createTopic = jest.fn().mockResolvedValue('0.0.100');
  mock.submitMessage = jest.fn().mockResolvedValue(1);
  mock.subscribeTopic = jest.fn();
  mock.emit = jest.fn().mockReturnValue(true);
  mock.close = jest.fn();
  mock.getOperatorAccountId = jest.fn().mockReturnValue('0.0.1');
  mock.getBalance = jest.fn().mockResolvedValue(100);
  return mock;
}

function createProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'agent-1',
    name: 'Agent',
    description: 'Test',
    capabilities: [
      { name: 'web_research', description: 'Research', inputSchema: {}, outputSchema: {} },
    ],
    hederaAccountId: '0.0.1',
    inboundTopicId: '0.0.2',
    outboundTopicId: '0.0.3',
    registryTopicId: '0.0.4',
    status: 'active',
    createdAt: Date.now(),
    metadata: {},
    ...overrides,
  };
}

describe('Integration Workflows', () => {
  describe('Full Task Lifecycle with Registry', () => {
    let registry: AgentRegistry;
    let coordinator: TaskCoordinator;
    let mockClient: jest.Mocked<HederaClient>;

    beforeEach(async () => {
      mockClient = createMockClient();
      registry = new AgentRegistry(mockClient);
      await registry.initialize('0.0.100');
      coordinator = new TaskCoordinator(mockClient, registry);
      await coordinator.initialize('0.0.200');
    });

    it('should complete full task lifecycle: register -> discover -> submit -> bid -> assign -> complete', async () => {
      // 1. Register agents
      const researchAgent = createProfile({
        id: 'research-1',
        name: 'ResearchBot',
        capabilities: [
          { name: 'web_research', description: 'Web research', inputSchema: {}, outputSchema: {} },
        ],
      });
      const analysisAgent = createProfile({
        id: 'analysis-1',
        name: 'AnalysisBot',
        capabilities: [
          { name: 'data_analysis', description: 'Data analysis', inputSchema: {}, outputSchema: {} },
        ],
      });
      await registry.registerAgent(researchAgent);
      await registry.registerAgent(analysisAgent);

      // 2. Discover agents
      const discovered = registry.discoverAgents({ capability: 'web_research' });
      expect(discovered.totalFound).toBe(1);
      expect(discovered.agents[0].id).toBe('research-1');

      // 3. Submit task
      const taskId = await coordinator.submitTask({
        description: 'Research market trends',
        requiredCapabilities: ['web_research'],
        payload: { topic: 'AI market' },
        priority: 'high',
        requesterId: 'coordinator-1',
      });

      // 4. Submit bid
      await coordinator.submitBid({
        taskId,
        agentId: 'research-1',
        capability: 'web_research',
        estimatedDuration: 5000,
        estimatedCost: 10,
        confidence: 0.9,
        timestamp: Date.now(),
      });

      // 5. Select best bid
      const bestBid = coordinator.selectBestBid(taskId);
      expect(bestBid!.agentId).toBe('research-1');

      // 6. Assign task
      const assignment = await coordinator.assignTask(taskId, bestBid!.agentId, bestBid!.capability);
      expect(assignment.status).toBe('assigned');

      // 7. Complete task
      const completionHandler = jest.fn();
      coordinator.on('task:completed', completionHandler);
      await coordinator.completeTask(taskId, 'research-1', { findings: ['trend 1', 'trend 2'] });

      // 8. Verify result
      const result = coordinator.getTaskResult(taskId);
      expect(result!.status).toBe('success');
      expect(result!.outputs.web_research).toEqual({ findings: ['trend 1', 'trend 2'] });
    });

    it('should handle multi-agent task with partial failure', async () => {
      await registry.registerAgent(createProfile({
        id: 'agent-a',
        capabilities: [{ name: 'cap_a', description: 'A', inputSchema: {}, outputSchema: {} }],
      }));
      await registry.registerAgent(createProfile({
        id: 'agent-b',
        capabilities: [{ name: 'cap_b', description: 'B', inputSchema: {}, outputSchema: {} }],
      }));

      const taskId = await coordinator.submitTask({
        description: 'Multi-agent task',
        requiredCapabilities: ['cap_a', 'cap_b'],
        payload: {},
        priority: 'critical',
        requesterId: 'coord',
      });

      await coordinator.assignTask(taskId, 'agent-a', 'cap_a');
      await coordinator.assignTask(taskId, 'agent-b', 'cap_b');

      await coordinator.completeTask(taskId, 'agent-a', { success: true });
      await coordinator.failTask(taskId, 'agent-b', 'Network error');

      const result = coordinator.getTaskResult(taskId);
      expect(result!.status).toBe('partial');
      expect(result!.outputs.cap_a).toEqual({ success: true });
    });

    it('should build reputation over multiple task completions', async () => {
      await registry.registerAgent(createProfile({ id: 'reliable-agent' }));

      for (let i = 0; i < 10; i++) {
        const taskId = await coordinator.submitTask({
          description: `Task ${i}`,
          requiredCapabilities: ['web_research'],
          payload: {},
          priority: 'medium',
          requesterId: 'coord',
        });

        await coordinator.assignTask(taskId, 'reliable-agent', 'web_research');
        await coordinator.completeTask(taskId, 'reliable-agent', { iteration: i });
      }

      const score = coordinator.reputation.getScore('reliable-agent');
      expect(score.taskCount).toBe(10);
      expect(score.successRate).toBe(1);
      // With near-instant test execution, reliability varies due to sub-ms timing jitter
      // Score = 0.5*successRate + 0.3*reliability + 0.2*experienceBonus
      // With 100% success, 10/20 experience: minimum is 0.6 (reliability=0), max 0.75 (reliability=0.5)
      expect(score.overallScore).toBeGreaterThanOrEqual(0.6);
    });

    it('should auto-assign when agents match capabilities', async () => {
      await registry.registerAgent(createProfile({
        id: 'auto-agent',
        status: 'active',
        capabilities: [
          { name: 'web_research', description: 'Research', inputSchema: {}, outputSchema: {} },
          { name: 'data_analysis', description: 'Analysis', inputSchema: {}, outputSchema: {} },
        ],
      }));

      const taskId = await coordinator.submitTask({
        description: 'Auto assign test',
        requiredCapabilities: ['web_research', 'data_analysis'],
        payload: {},
        priority: 'medium',
        requesterId: 'coord',
      });

      const assignments = await coordinator.autoAssignTask(taskId);
      expect(assignments).toHaveLength(2);
      expect(assignments[0].agentId).toBe('auto-agent');
      expect(assignments[1].agentId).toBe('auto-agent');
    });
  });

  describe('MCP + MeshNode Integration', () => {
    it('should create MCP server from MeshNode and call tools', async () => {
      const node = new MeshNode({
        config: {
          network: 'testnet',
          operatorAccountId: '0.0.1',
          operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
        },
        agentName: 'IntegrationNode',
        agentDescription: 'Node for integration test',
        capabilities: [
          { name: 'test_integration', description: 'Integration test cap', inputSchema: {}, outputSchema: {} },
        ],
      });

      const client = (node as any).hederaClient as jest.Mocked<HederaClient>;
      client.createTopic = jest.fn().mockResolvedValue('0.0.100');
      client.submitMessage = jest.fn().mockResolvedValue(1);
      client.subscribeTopic = jest.fn();
      client.close = jest.fn();
      client.getOperatorAccountId = jest.fn().mockReturnValue('0.0.1');
      client.emit = jest.fn().mockReturnValue(true);

      node.registerCapabilityHandler('test_integration', async (input) => {
        return { processed: true, data: input };
      });

      const server = new MCPServer(node);

      // Execute capability through MCP
      const result = await server.handleToolCall('execute_capability', {
        capability: 'test_integration',
        input: { key: 'value' },
      });

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.result.processed).toBe(true);

      // List capabilities
      const toolsResp = server.getToolsListResponse();
      expect(toolsResp.tools.length).toBe(6);

      await node.stop();
    });

    it('should handle discover_agents through MCP with registered agents', async () => {
      const node = new MeshNode({
        config: {
          network: 'testnet',
          operatorAccountId: '0.0.1',
          operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
        },
        agentName: 'DiscoveryNode',
        agentDescription: 'Node for discovery test',
        capabilities: [],
      });

      const client = (node as any).hederaClient as jest.Mocked<HederaClient>;
      client.createTopic = jest.fn().mockResolvedValue('0.0.100');
      client.submitMessage = jest.fn().mockResolvedValue(1);
      client.subscribeTopic = jest.fn();
      client.close = jest.fn();
      client.getOperatorAccountId = jest.fn().mockReturnValue('0.0.1');
      client.emit = jest.fn().mockReturnValue(true);

      const server = new MCPServer(node);

      const result = await server.handleToolCall('discover_agents', {});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.totalFound).toBe(0); // No agents registered yet

      await node.stop();
    });
  });

  describe('Reputation-Weighted Bid Selection', () => {
    let coordinator: TaskCoordinator;
    let registry: AgentRegistry;

    beforeEach(async () => {
      const mockClient = createMockClient();
      registry = new AgentRegistry(mockClient);
      await registry.initialize('0.0.100');
      coordinator = new TaskCoordinator(mockClient, registry);
      await coordinator.initialize('0.0.200');
    });

    it('should prefer experienced agents over new ones', async () => {
      // Build reputation for experienced agent
      for (let i = 0; i < 15; i++) {
        coordinator.reputation.recordSuccess('exp-agent', 100, 5);
      }

      const taskId = await coordinator.submitTask({
        description: 'Important task',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'high',
        requesterId: 'r1',
      });

      // Both bid with same parameters
      await coordinator.submitBid({
        taskId,
        agentId: 'exp-agent',
        capability: 'x',
        estimatedDuration: 5000,
        estimatedCost: 10,
        confidence: 0.8,
        timestamp: Date.now(),
      });

      await coordinator.submitBid({
        taskId,
        agentId: 'new-agent',
        capability: 'x',
        estimatedDuration: 5000,
        estimatedCost: 10,
        confidence: 0.8,
        timestamp: Date.now(),
      });

      const best = coordinator.selectBestBid(taskId);
      expect(best!.agentId).toBe('exp-agent');
    });

    it('should select cheaper bid when reputations are equal', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Cost-sensitive',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'low',
        requesterId: 'r1',
      });

      await coordinator.submitBid({
        taskId,
        agentId: 'expensive-agent',
        capability: 'x',
        estimatedDuration: 5000,
        estimatedCost: 100,
        confidence: 0.9,
        timestamp: Date.now(),
      });

      await coordinator.submitBid({
        taskId,
        agentId: 'cheap-agent',
        capability: 'x',
        estimatedDuration: 5000,
        estimatedCost: 1,
        confidence: 0.9,
        timestamp: Date.now(),
      });

      const best = coordinator.selectBestBid(taskId);
      expect(best!.agentId).toBe('cheap-agent');
    });

    it('should balance confidence vs cost', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Balance test',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      // High confidence, high cost
      await coordinator.submitBid({
        taskId,
        agentId: 'confident',
        capability: 'x',
        estimatedDuration: 5000,
        estimatedCost: 100,
        confidence: 1.0,
        timestamp: Date.now(),
      });

      // Low confidence, very low cost
      await coordinator.submitBid({
        taskId,
        agentId: 'cheap',
        capability: 'x',
        estimatedDuration: 5000,
        estimatedCost: 0,
        confidence: 0.5,
        timestamp: Date.now(),
      });

      const best = coordinator.selectBestBid(taskId);
      expect(best).not.toBeNull();
      // cheap agent: 0.5/(0+1) * 1.0 = 0.5
      // confident: 1.0/(100+1) * 1.0 = ~0.0099
      // cheap should win due to much better score
      expect(best!.agentId).toBe('cheap');
    });
  });

  describe('Agent Status Transitions', () => {
    let registry: AgentRegistry;
    let mockClient: jest.Mocked<HederaClient>;

    beforeEach(async () => {
      mockClient = createMockClient();
      registry = new AgentRegistry(mockClient);
      await registry.initialize('0.0.100');
    });

    it('should transition active -> busy -> active', async () => {
      await registry.registerAgent(createProfile({ id: 'transit-agent', status: 'active' }));

      expect(registry.getAgent('transit-agent')!.status).toBe('active');

      await registry.updateAgentStatus('transit-agent', 'busy');
      expect(registry.getAgent('transit-agent')!.status).toBe('busy');

      await registry.updateAgentStatus('transit-agent', 'active');
      expect(registry.getAgent('transit-agent')!.status).toBe('active');
    });

    it('should transition active -> inactive', async () => {
      await registry.registerAgent(createProfile({ id: 'shutdown-agent', status: 'active' }));

      await registry.updateAgentStatus('shutdown-agent', 'inactive');
      expect(registry.getAgent('shutdown-agent')!.status).toBe('inactive');
    });

    it('should exclude inactive agents from active discovery', async () => {
      await registry.registerAgent(createProfile({ id: 'active-1', status: 'active' }));
      await registry.registerAgent(createProfile({ id: 'inactive-1', status: 'inactive' }));

      const result = registry.discoverAgents({ status: 'active' });
      expect(result.totalFound).toBe(1);
      expect(result.agents[0].id).toBe('active-1');
    });

    it('should include busy agents in discovery but not as active', async () => {
      await registry.registerAgent(createProfile({ id: 'busy-1', status: 'busy' }));

      const active = registry.discoverAgents({ status: 'active' });
      expect(active.totalFound).toBe(0);

      const busy = registry.discoverAgents({ status: 'busy' });
      expect(busy.totalFound).toBe(1);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent task submissions', async () => {
      const mockClient = createMockClient();
      const registry = new AgentRegistry(mockClient);
      await registry.initialize('0.0.100');
      const coordinator = new TaskCoordinator(mockClient, registry);
      await coordinator.initialize('0.0.200');

      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(coordinator.submitTask({
          description: `Concurrent task ${i}`,
          requiredCapabilities: ['x'],
          payload: {},
          priority: 'medium',
          requesterId: 'r1',
        }));
      }

      const taskIds = await Promise.all(promises);
      expect(taskIds).toHaveLength(20);
      expect(new Set(taskIds).size).toBe(20); // All unique
    });

    it('should handle concurrent agent registrations', async () => {
      const mockClient = createMockClient();
      const registry = new AgentRegistry(mockClient);
      await registry.initialize('0.0.100');

      const promises = [];
      for (let i = 0; i < 30; i++) {
        promises.push(registry.registerAgent(createProfile({ id: `concurrent-${i}` })));
      }

      await Promise.all(promises);
      expect(registry.getAgentCount()).toBe(30);
    });

    it('should handle concurrent bid submissions', async () => {
      const mockClient = createMockClient();
      const registry = new AgentRegistry(mockClient);
      await registry.initialize('0.0.100');
      const coordinator = new TaskCoordinator(mockClient, registry);
      await coordinator.initialize('0.0.200');

      const taskId = await coordinator.submitTask({
        description: 'Concurrent bids',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'high',
        requesterId: 'r1',
      });

      const promises = [];
      for (let i = 0; i < 15; i++) {
        promises.push(coordinator.submitBid({
          taskId,
          agentId: `bidder-${i}`,
          capability: 'x',
          estimatedDuration: 1000 + i * 100,
          estimatedCost: 5 + i,
          confidence: 0.7 + i * 0.01,
          timestamp: Date.now(),
        }));
      }

      await Promise.all(promises);
      expect(coordinator.getTaskBids(taskId)).toHaveLength(15);
    });
  });

  describe('Reputation Impact on Selection', () => {
    it('should demonstrate reputation growth impact', () => {
      const rep = new ReputationManager();

      // Initial score
      const initial = rep.getScore('growing-agent');
      expect(initial.overallScore).toBe(0.5);

      // After 1 success
      rep.recordSuccess('growing-agent', 100, 5);
      const after1 = rep.getScore('growing-agent');
      expect(after1.overallScore).toBeGreaterThan(initial.overallScore);

      // After 5 successes
      for (let i = 0; i < 4; i++) {
        rep.recordSuccess('growing-agent', 100, 5);
      }
      const after5 = rep.getScore('growing-agent');
      expect(after5.overallScore).toBeGreaterThan(after1.overallScore);

      // After 20 successes (max experience)
      for (let i = 0; i < 15; i++) {
        rep.recordSuccess('growing-agent', 100, 5);
      }
      const after20 = rep.getScore('growing-agent');
      expect(after20.overallScore).toBeGreaterThan(after5.overallScore);
    });

    it('should demonstrate reputation decline with failures', () => {
      const rep = new ReputationManager();

      // Build good reputation
      for (let i = 0; i < 10; i++) {
        rep.recordSuccess('declining-agent', 100, 5);
      }
      const good = rep.getScore('declining-agent');

      // Add failures
      for (let i = 0; i < 10; i++) {
        rep.recordFailure('declining-agent');
      }
      const declined = rep.getScore('declining-agent');

      expect(declined.overallScore).toBeLessThan(good.overallScore);
      expect(declined.successRate).toBe(0.5);
    });

    it('should compare multiple agents comprehensively', () => {
      const rep = new ReputationManager();

      // Perfect agent
      for (let i = 0; i < 20; i++) {
        rep.recordSuccess('perfect', 100, 5);
      }

      // Good agent (80% success)
      for (let i = 0; i < 8; i++) {
        rep.recordSuccess('good', 100, 5);
      }
      for (let i = 0; i < 2; i++) {
        rep.recordFailure('good');
      }

      // Poor agent (20% success)
      for (let i = 0; i < 2; i++) {
        rep.recordSuccess('poor', 100, 5);
      }
      for (let i = 0; i < 8; i++) {
        rep.recordFailure('poor');
      }

      const scores = rep.getAllScores();
      expect(scores[0].agentId).toBe('perfect');
      expect(scores[scores.length - 1].agentId).toBe('poor');
    });
  });
});
