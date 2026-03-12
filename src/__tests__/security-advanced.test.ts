/**
 * Advanced security tests - injection, malformed data, boundary attacks
 */

import { AgentRegistry } from '../core/agent-registry';
import { TaskCoordinator, TaskBid } from '../core/task-coordinator';
import { ReputationManager } from '../core/reputation';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile, MessageType, CoordinationMessage } from '../core/types';
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
    capabilities: [],
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

describe('Security - Advanced', () => {
  describe('Registry - Injection Resistance', () => {
    let registry: AgentRegistry;
    let mockClient: jest.Mocked<HederaClient>;
    let subscriptionCallback: any;

    beforeEach(async () => {
      mockClient = createMockClient();
      mockClient.subscribeTopic = jest.fn().mockImplementation((_topicId, cb) => {
        subscriptionCallback = cb;
      });
      registry = new AgentRegistry(mockClient);
      await registry.initialize('0.0.100');
    });

    it('should handle agent name with special characters', async () => {
      const profile = createProfile({
        id: 'special-agent',
        name: '<script>alert("xss")</script>',
      });
      await registry.registerAgent(profile);
      const agent = registry.getAgent('special-agent');
      expect(agent!.name).toBe('<script>alert("xss")</script>');
    });

    it('should handle agent name with SQL injection attempt', async () => {
      const profile = createProfile({
        id: 'sql-agent',
        name: "'; DROP TABLE agents; --",
      });
      await registry.registerAgent(profile);
      expect(registry.getAgent('sql-agent')).toBeDefined();
    });

    it('should handle extremely long agent name', async () => {
      const profile = createProfile({
        id: 'long-name',
        name: 'A'.repeat(10000),
      });
      await registry.registerAgent(profile);
      expect(registry.getAgent('long-name')!.name).toHaveLength(10000);
    });

    it('should handle agent ID with unicode characters', async () => {
      const profile = createProfile({
        id: '\u0000\u0001\u0002',
      });
      await registry.registerAgent(profile);
      expect(registry.getAgent('\u0000\u0001\u0002')).toBeDefined();
    });

    it('should handle empty string agent ID', async () => {
      const profile = createProfile({ id: '' });
      await registry.registerAgent(profile);
      expect(registry.getAgent('')).toBeDefined();
    });

    it('should handle agent description with null bytes', async () => {
      const profile = createProfile({
        id: 'null-desc',
        description: 'Hello\x00World',
      });
      await registry.registerAgent(profile);
      expect(registry.getAgent('null-desc')).toBeDefined();
    });

    it('should handle metadata with nested objects as strings', async () => {
      const profile = createProfile({
        id: 'meta-agent',
        metadata: { key: '{"nested": "json"}' },
      });
      await registry.registerAgent(profile);
      expect(registry.getAgent('meta-agent')!.metadata.key).toBe('{"nested": "json"}');
    });

    it('should handle malformed JSON in subscription messages', () => {
      // Various malformed messages that should not crash the registry
      const badMessages = [
        'null',
        'undefined',
        '[]',
        '""',
        '0',
        'true',
        '{"type": null}',
        '{"type": "agent.register"}', // missing payload
        '{"type": "agent.register", "payload": {}}', // missing profile in payload
      ];

      for (const msg of badMessages) {
        subscriptionCallback({
          contents: Buffer.from(msg),
          sequenceNumber: 1,
          consensusTimestamp: null,
        });
      }

      // Registry should still be functional
      expect(registry.getAgentCount()).toBe(0);
    });

    it('should handle binary garbage in subscription', () => {
      const garbage = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0xAA, 0xBB]);
      subscriptionCallback({
        contents: garbage,
        sequenceNumber: 1,
        consensusTimestamp: null,
      });
      expect(registry.getAgentCount()).toBe(0);
    });

    it('should handle very large subscription message', () => {
      const largeMsg = JSON.stringify({
        type: MessageType.AGENT_REGISTER,
        senderId: 'large-agent',
        payload: {
          profile: createProfile({
            id: 'large-agent',
            description: 'X'.repeat(100000),
          }),
        },
        timestamp: Date.now(),
      });

      subscriptionCallback({
        contents: Buffer.from(largeMsg),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      expect(registry.getAgent('large-agent')).toBeDefined();
    });
  });

  describe('TaskCoordinator - Boundary Conditions', () => {
    let coordinator: TaskCoordinator;
    let registry: AgentRegistry;
    let mockClient: jest.Mocked<HederaClient>;

    beforeEach(async () => {
      mockClient = createMockClient();
      registry = new AgentRegistry(mockClient);
      await registry.initialize('0.0.100');
      coordinator = new TaskCoordinator(mockClient, registry);
      await coordinator.initialize('0.0.200');
    });

    it('should handle task with empty description', async () => {
      const taskId = await coordinator.submitTask({
        description: '',
        requiredCapabilities: [],
        payload: {},
        priority: 'low',
        requesterId: 'r1',
      });
      expect(taskId).toBeDefined();
    });

    it('should handle task with empty required capabilities', async () => {
      const taskId = await coordinator.submitTask({
        description: 'No caps',
        requiredCapabilities: [],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });
      const assignments = await coordinator.autoAssignTask(taskId);
      expect(assignments).toHaveLength(0);
    });

    it('should handle task with very large payload', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Large payload',
        requiredCapabilities: ['x'],
        payload: { data: 'Y'.repeat(50000) },
        priority: 'high',
        requesterId: 'r1',
      });
      expect(coordinator.getTask(taskId)!.payload.data).toHaveLength(50000);
    });

    it('should handle bid with negative estimated cost', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Neg cost',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'low',
        requesterId: 'r1',
      });

      await coordinator.submitBid({
        taskId,
        agentId: 'a1',
        capability: 'x',
        estimatedDuration: 1000,
        estimatedCost: -5,
        confidence: 0.9,
        timestamp: Date.now(),
      });

      const best = coordinator.selectBestBid(taskId);
      expect(best).not.toBeNull();
    });

    it('should handle bid with confidence > 1', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Over-confident',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'low',
        requesterId: 'r1',
      });

      await coordinator.submitBid({
        taskId,
        agentId: 'a1',
        capability: 'x',
        estimatedDuration: 1000,
        estimatedCost: 5,
        confidence: 1.5,
        timestamp: Date.now(),
      });

      const best = coordinator.selectBestBid(taskId);
      expect(best!.confidence).toBe(1.5);
    });

    it('should handle very large number of tasks', async () => {
      const taskIds: string[] = [];
      for (let i = 0; i < 100; i++) {
        const id = await coordinator.submitTask({
          description: `Task ${i}`,
          requiredCapabilities: ['x'],
          payload: {},
          priority: 'medium',
          requesterId: 'r1',
        });
        taskIds.push(id);
      }
      expect(coordinator.getTaskCount()).toBe(100);
      expect(coordinator.getAllTasks()).toHaveLength(100);
    });

    it('should handle completing task without assignment start time', async () => {
      const taskId = await coordinator.submitTask({
        description: 'No start',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      const assignment = await coordinator.assignTask(taskId, 'a1', 'x');
      delete assignment.startedAt;
      await coordinator.completeTask(taskId, 'a1', {});
      // Should not throw
    });
  });

  describe('Reputation - Boundary Conditions', () => {
    let reputation: ReputationManager;

    beforeEach(() => {
      reputation = new ReputationManager();
    });

    it('should handle negative execution time', () => {
      reputation.recordSuccess('a1', -100, 5);
      const score = reputation.getScore('a1');
      expect(score.taskCount).toBe(1);
    });

    it('should handle negative cost', () => {
      reputation.recordSuccess('a1', 100, -5);
      const score = reputation.getScore('a1');
      expect(score.avgCost).toBe(-5);
    });

    it('should handle Infinity execution time', () => {
      reputation.recordSuccess('a1', Infinity, 5);
      const score = reputation.getScore('a1');
      expect(score.taskCount).toBe(1);
    });

    it('should handle NaN execution time gracefully', () => {
      reputation.recordSuccess('a1', NaN, 5);
      // Should not crash
      expect(reputation.getScore('a1').taskCount).toBe(1);
    });

    it('should handle rapid success/failure alternation', () => {
      for (let i = 0; i < 50; i++) {
        if (i % 2 === 0) {
          reputation.recordSuccess('alternating', 100, 5);
        } else {
          reputation.recordFailure('alternating');
        }
      }
      const score = reputation.getScore('alternating');
      expect(score.taskCount).toBe(50);
      expect(score.successRate).toBe(0.5);
    });

    it('should handle agent ID with special characters', () => {
      const specialId = 'agent/with\\special:chars@here';
      reputation.recordSuccess(specialId, 100, 5);
      const score = reputation.getScore(specialId);
      expect(score.taskCount).toBe(1);
    });

    it('should handle empty string agent ID', () => {
      reputation.recordSuccess('', 100, 5);
      const score = reputation.getScore('');
      expect(score.taskCount).toBe(1);
    });

    it('should handle very many agents', () => {
      for (let i = 0; i < 1000; i++) {
        reputation.recordSuccess(`agent-${i}`, 100, 5);
      }
      expect(reputation.getTrackedAgentCount()).toBe(1000);
    });
  });

  describe('MCP Server - Input Sanitization', () => {
    let server: MCPServer;
    let node: MeshNode;

    beforeEach(() => {
      node = new MeshNode({
        config: {
          network: 'testnet',
          operatorAccountId: '0.0.1',
          operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
        },
        agentName: 'SecurityTest',
        agentDescription: 'Test',
        capabilities: [],
      });

      const client = (node as any).hederaClient as jest.Mocked<HederaClient>;
      client.createTopic = jest.fn().mockResolvedValue('0.0.100');
      client.submitMessage = jest.fn().mockResolvedValue(1);
      client.subscribeTopic = jest.fn();
      client.close = jest.fn();
      client.getOperatorAccountId = jest.fn().mockReturnValue('0.0.1');
      client.emit = jest.fn().mockReturnValue(true);

      server = new MCPServer(node);
    });

    it('should handle XSS in tool arguments', async () => {
      const result = await server.handleToolCall('discover_agents', {
        capability: '<script>alert("xss")</script>',
      });
      expect(result.isError).toBeUndefined();
    });

    it('should handle SQL injection in tool arguments', async () => {
      const result = await server.handleToolCall('discover_agents', {
        capability: "'; DROP TABLE agents; --",
      });
      expect(result.isError).toBeUndefined();
    });

    it('should handle null args values', async () => {
      const result = await server.handleToolCall('discover_agents', {
        capability: null as any,
      });
      // Should not crash
      expect(result).toBeDefined();
    });

    it('should handle prototype pollution attempt', async () => {
      const result = await server.handleToolCall('discover_agents', {
        __proto__: { polluted: true },
        capability: 'test',
      });
      expect(result).toBeDefined();
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('should handle very long tool name', async () => {
      const result = await server.handleToolCall('A'.repeat(10000), {});
      expect(result.isError).toBe(true);
    });

    it('should handle unicode in tool arguments', async () => {
      const result = await server.handleToolCall('discover_agents', {
        capability: '\u{1F600}\u{1F601}\u{1F602}',
      });
      expect(result).toBeDefined();
    });

    it('should handle deeply nested args', async () => {
      let obj: any = { value: 'deep' };
      for (let i = 0; i < 50; i++) {
        obj = { nested: obj };
      }

      server.registerTool(
        {
          name: 'deep_tool',
          description: 'Handle deep nesting',
          inputSchema: { type: 'object', properties: {} },
        },
        async (args) => ({
          content: [{ type: 'text', text: 'ok' }],
        })
      );

      const result = await server.handleToolCall('deep_tool', obj);
      expect(result.content[0].text).toBe('ok');
    });
  });

  describe('Discovery Security', () => {
    let registry: AgentRegistry;
    let mockClient: jest.Mocked<HederaClient>;

    beforeEach(async () => {
      mockClient = createMockClient();
      registry = new AgentRegistry(mockClient);
      await registry.initialize('0.0.100');
    });

    it('should not leak data through capability search with regex', async () => {
      await registry.registerAgent(createProfile({
        id: 'secret-agent',
        capabilities: [
          { name: 'classified', description: 'Top secret capability', inputSchema: {}, outputSchema: {} },
        ],
      }));

      // Capability search is substring-based, not regex
      const result = registry.discoverAgents({ capability: '.*' });
      // Should not match since '.*' is treated as literal substring
      expect(result.totalFound).toBe(0);
    });

    it('should handle empty string capability search', async () => {
      await registry.registerAgent(createProfile({ id: 'a1' }));
      const result = registry.discoverAgents({ capability: '' });
      // Empty string matches everything (substring match)
      expect(result.totalFound).toBe(1);
    });
  });
});
