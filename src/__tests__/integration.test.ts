/**
 * Integration tests for AgentMesh
 *
 * Tests multi-component interactions: registry + coordinator + reputation,
 * end-to-end task lifecycle, multi-agent bid competition, and
 * reputation-influenced bid selection.
 */

import { AgentRegistry } from '../core/agent-registry';
import { TaskCoordinator, TaskBid } from '../core/task-coordinator';
import { ReputationManager } from '../core/reputation';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile, MessageType } from '../core/types';

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

  return mock;
}

function createProfile(id: string, caps: string[], status: AgentProfile['status'] = 'active'): AgentProfile {
  return {
    id,
    name: `Agent_${id}`,
    description: `Test agent ${id}`,
    capabilities: caps.map(c => ({
      name: c,
      description: `${c} capability`,
      inputSchema: {},
      outputSchema: {},
    })),
    hederaAccountId: '0.0.12345',
    inboundTopicId: '0.0.200',
    outboundTopicId: '0.0.201',
    registryTopicId: '0.0.100',
    status,
    createdAt: Date.now(),
    metadata: {},
  };
}

describe('Integration: Full Task Lifecycle', () => {
  let registry: AgentRegistry;
  let coordinator: TaskCoordinator;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
  });

  it('should complete a full task lifecycle: register -> submit -> bid -> assign -> complete', async () => {
    // Step 1: Register agents
    await registry.registerAgent(createProfile('researcher', ['web_research']));
    await registry.registerAgent(createProfile('analyst', ['data_analysis']));

    // Step 2: Submit a task
    const taskId = await coordinator.submitTask({
      description: 'Research and analyze AI trends',
      requiredCapabilities: ['web_research', 'data_analysis'],
      payload: { topic: 'AI trends 2026' },
      priority: 'high',
      requesterId: 'requester-1',
    });

    expect(coordinator.getTask(taskId)).toBeDefined();

    // Step 3: Submit bids
    await coordinator.submitBid({
      taskId,
      agentId: 'researcher',
      capability: 'web_research',
      estimatedDuration: 3000,
      estimatedCost: 2,
      confidence: 0.95,
      timestamp: Date.now(),
    });

    await coordinator.submitBid({
      taskId,
      agentId: 'analyst',
      capability: 'data_analysis',
      estimatedDuration: 5000,
      estimatedCost: 5,
      confidence: 0.8,
      timestamp: Date.now(),
    });

    expect(coordinator.getTaskBids(taskId)).toHaveLength(2);

    // Step 4: Assign tasks
    const assignment1 = await coordinator.assignTask(taskId, 'researcher', 'web_research');
    const assignment2 = await coordinator.assignTask(taskId, 'analyst', 'data_analysis');

    expect(assignment1.status).toBe('assigned');
    expect(assignment2.status).toBe('assigned');

    // Step 5: Complete tasks
    const completedSpy = jest.fn();
    coordinator.on('task:completed', completedSpy);

    await coordinator.completeTask(taskId, 'researcher', { findings: ['trend1', 'trend2'] });
    await coordinator.completeTask(taskId, 'analyst', { insights: ['insight1'] });

    // Step 6: Verify result
    expect(completedSpy).toHaveBeenCalled();
    const result = completedSpy.mock.calls[0][0];
    expect(result.status).toBe('success');
    expect(result.outputs.web_research).toEqual({ findings: ['trend1', 'trend2'] });
    expect(result.outputs.data_analysis).toEqual({ insights: ['insight1'] });
  });

  it('should handle partial failure in multi-agent task', async () => {
    await registry.registerAgent(createProfile('agent-a', ['cap_a']));
    await registry.registerAgent(createProfile('agent-b', ['cap_b']));

    const taskId = await coordinator.submitTask({
      description: 'Multi-part task',
      requiredCapabilities: ['cap_a', 'cap_b'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'agent-a', 'cap_a');
    await coordinator.assignTask(taskId, 'agent-b', 'cap_b');

    const completedSpy = jest.fn();
    coordinator.on('task:completed', completedSpy);

    await coordinator.completeTask(taskId, 'agent-a', { data: 'ok' });
    await coordinator.failTask(taskId, 'agent-b', 'timeout');

    expect(completedSpy).toHaveBeenCalled();
    const result = completedSpy.mock.calls[0][0];
    expect(result.status).toBe('partial');
    expect(result.outputs.cap_a).toEqual({ data: 'ok' });
  });

  it('should auto-assign tasks to matching agents', async () => {
    await registry.registerAgent(createProfile('r1', ['research']));
    await registry.registerAgent(createProfile('a1', ['analysis']));
    await registry.registerAgent(createProfile('i1', ['inactive_cap'], 'inactive'));

    const taskId = await coordinator.submitTask({
      description: 'Auto-assign test',
      requiredCapabilities: ['research', 'analysis'],
      payload: {},
      priority: 'medium',
      requesterId: 'req',
    });

    const assignments = await coordinator.autoAssignTask(taskId);
    expect(assignments).toHaveLength(2);
    expect(assignments[0]!.agentId).toBe('r1');
    expect(assignments[1]!.agentId).toBe('a1');
  });
});

describe('Integration: Reputation-Influenced Bid Selection', () => {
  let registry: AgentRegistry;
  let coordinator: TaskCoordinator;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
  });

  it('should select bid from agent with better reputation when bids are similar', async () => {
    // Build up reputation for trusted agent
    for (let i = 0; i < 10; i++) {
      coordinator.reputation.recordSuccess('trusted-agent', 1000, 5);
    }

    // New agent has no reputation
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    // Similar bids
    await coordinator.submitBid({
      taskId,
      agentId: 'trusted-agent',
      capability: 'research',
      estimatedDuration: 5000,
      estimatedCost: 5,
      confidence: 0.8,
      timestamp: Date.now(),
    });

    await coordinator.submitBid({
      taskId,
      agentId: 'new-agent',
      capability: 'research',
      estimatedDuration: 5000,
      estimatedCost: 5,
      confidence: 0.8,
      timestamp: Date.now(),
    });

    const best = coordinator.selectBestBid(taskId);
    expect(best!.agentId).toBe('trusted-agent');
  });

  it('should allow new agent with much better bid to win over reputable agent', async () => {
    for (let i = 0; i < 10; i++) {
      coordinator.reputation.recordSuccess('veteran', 1000, 5);
    }

    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    // Veteran: low confidence, high cost
    await coordinator.submitBid({
      taskId,
      agentId: 'veteran',
      capability: 'research',
      estimatedDuration: 10000,
      estimatedCost: 50,
      confidence: 0.3,
      timestamp: Date.now(),
    });

    // Newcomer: high confidence, free
    await coordinator.submitBid({
      taskId,
      agentId: 'newcomer',
      capability: 'research',
      estimatedDuration: 1000,
      estimatedCost: 0,
      confidence: 0.99,
      timestamp: Date.now(),
    });

    const best = coordinator.selectBestBid(taskId);
    expect(best!.agentId).toBe('newcomer');
  });

  it('should update reputation after task completion and failure', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Track rep',
      requiredCapabilities: ['a', 'b'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'good-agent', 'a');
    await coordinator.assignTask(taskId, 'bad-agent', 'b');

    await coordinator.completeTask(taskId, 'good-agent', 'done');
    await coordinator.failTask(taskId, 'bad-agent', 'error');

    const goodScore = coordinator.reputation.getScore('good-agent');
    const badScore = coordinator.reputation.getScore('bad-agent');

    expect(goodScore.successRate).toBe(1);
    expect(badScore.successRate).toBe(0);
    expect(goodScore.overallScore).toBeGreaterThan(badScore.overallScore);
  });
});

describe('Integration: Registry + Discovery Workflow', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    await registry.initialize();
  });

  it('should support register, discover, update, re-discover cycle', async () => {
    // Register agents
    await registry.registerAgent(createProfile('a1', ['research'], 'active'));
    await registry.registerAgent(createProfile('a2', ['research'], 'active'));

    // Discover both
    let result = registry.discoverAgents({ capability: 'research', status: 'active' });
    expect(result.totalFound).toBe(2);

    // Mark one busy
    await registry.updateAgentStatus('a1', 'busy');

    // Discover only active
    result = registry.discoverAgents({ capability: 'research', status: 'active' });
    expect(result.totalFound).toBe(1);
    expect(result.agents[0]!.id).toBe('a2');

    // Deregister the other
    await registry.deregisterAgent('a2');

    result = registry.discoverAgents({ capability: 'research', status: 'active' });
    expect(result.totalFound).toBe(0);
  });

  it('should handle rapid registration and deregistration', async () => {
    // Register many agents
    for (let i = 0; i < 20; i++) {
      await registry.registerAgent(createProfile(`agent-${i}`, ['cap']));
    }
    expect(registry.getAgentCount()).toBe(20);

    // Deregister half
    for (let i = 0; i < 10; i++) {
      await registry.deregisterAgent(`agent-${i}`);
    }
    expect(registry.getAgentCount()).toBe(10);

    // All remaining should be discoverable
    const result = registry.discoverAgents({ capability: 'cap' });
    expect(result.totalFound).toBe(10);
  });

  it('should handle agents with diverse capability sets', async () => {
    await registry.registerAgent(createProfile('generalist', ['research', 'analysis', 'writing']));
    await registry.registerAgent(createProfile('specialist', ['research']));
    await registry.registerAgent(createProfile('analyst', ['analysis', 'visualization']));

    const researchResult = registry.discoverAgents({ capability: 'research' });
    expect(researchResult.totalFound).toBe(2);

    const analysisResult = registry.discoverAgents({ capability: 'analysis' });
    expect(analysisResult.totalFound).toBe(2);

    const vizResult = registry.discoverAgents({ capability: 'visualization' });
    expect(vizResult.totalFound).toBe(1);
    expect(vizResult.agents[0]!.id).toBe('analyst');
  });
});

describe('Integration: Multi-Task Coordination', () => {
  let registry: AgentRegistry;
  let coordinator: TaskCoordinator;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
  });

  it('should manage multiple concurrent tasks independently', async () => {
    const task1Id = await coordinator.submitTask({
      description: 'Task 1',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'high',
      requesterId: 'r1',
    });

    const task2Id = await coordinator.submitTask({
      description: 'Task 2',
      requiredCapabilities: ['b'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    expect(coordinator.getTaskCount()).toBe(2);

    await coordinator.assignTask(task1Id, 'agent-1', 'a');
    await coordinator.assignTask(task2Id, 'agent-2', 'b');

    // Complete task 1, fail task 2
    await coordinator.completeTask(task1Id, 'agent-1', 'result1');
    await coordinator.failTask(task2Id, 'agent-2', 'error');

    const result1 = coordinator.getTaskResult(task1Id);
    const result2 = coordinator.getTaskResult(task2Id);

    expect(result1!.status).toBe('success');
    expect(result2!.status).toBe('partial');
  });

  it('should track bids per task independently', async () => {
    const task1Id = await coordinator.submitTask({
      description: 'Task 1',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    const task2Id = await coordinator.submitTask({
      description: 'Task 2',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    await coordinator.submitBid({
      taskId: task1Id,
      agentId: 'a1',
      capability: 'a',
      estimatedDuration: 1000,
      estimatedCost: 1,
      confidence: 0.9,
      timestamp: Date.now(),
    });

    await coordinator.submitBid({
      taskId: task2Id,
      agentId: 'a2',
      capability: 'a',
      estimatedDuration: 1000,
      estimatedCost: 1,
      confidence: 0.8,
      timestamp: Date.now(),
    });

    await coordinator.submitBid({
      taskId: task2Id,
      agentId: 'a3',
      capability: 'a',
      estimatedDuration: 1000,
      estimatedCost: 1,
      confidence: 0.7,
      timestamp: Date.now(),
    });

    expect(coordinator.getTaskBids(task1Id)).toHaveLength(1);
    expect(coordinator.getTaskBids(task2Id)).toHaveLength(2);
  });

  it('should return empty arrays for tasks with no bids or assignments', () => {
    expect(coordinator.getTaskBids('nonexistent')).toEqual([]);
    expect(coordinator.getTaskAssignments('nonexistent')).toEqual([]);
  });
});
