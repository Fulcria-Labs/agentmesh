/**
 * TaskCoordinator workflow tests - covers full task lifecycle workflows,
 * multi-phase task execution, bid selection with reputation,
 * and error recovery scenarios.
 */

import { TaskCoordinator, TaskBid } from '../core/task-coordinator';
import { AgentRegistry } from '../core/agent-registry';
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

function createProfile(id: string, capabilities: string[]): AgentProfile {
  return {
    id,
    name: `Agent_${id}`,
    description: `Test agent ${id}`,
    capabilities: capabilities.map(c => ({
      name: c,
      description: `${c} capability`,
      inputSchema: {},
      outputSchema: {},
    })),
    hederaAccountId: `0.0.${id.replace(/\D/g, '') || '12345'}`,
    inboundTopicId: '0.0.200',
    outboundTopicId: '0.0.201',
    registryTopicId: '0.0.100',
    status: 'active',
    createdAt: Date.now(),
    metadata: {},
  };
}

describe('Full Task Lifecycle Workflow', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    mockClient.subscribeTopic.mockImplementation(() => {});
    await coordinator.initialize();
  });

  it('should complete a full submit -> bid -> assign -> complete lifecycle', async () => {
    // Track all events
    const events: string[] = [];
    coordinator.on('task:submitted', () => events.push('submitted'));
    coordinator.on('task:bid', () => events.push('bid'));
    coordinator.on('task:assigned', () => events.push('assigned'));
    coordinator.on('task:completed', () => events.push('completed'));

    // 1. Submit task
    const taskId = await coordinator.submitTask({
      description: 'Research AI market trends',
      requiredCapabilities: ['research'],
      payload: { topic: 'AI' },
      priority: 'high',
      requesterId: 'requester-1',
    });
    expect(events).toContain('submitted');

    // 2. Submit bid
    await coordinator.submitBid({
      taskId,
      agentId: 'researcher-1',
      capability: 'research',
      estimatedDuration: 5000,
      estimatedCost: 2,
      confidence: 0.95,
      timestamp: Date.now(),
    });
    expect(events).toContain('bid');

    // 3. Select best bid
    const bestBid = coordinator.selectBestBid(taskId);
    expect(bestBid).not.toBeNull();
    expect(bestBid!.agentId).toBe('researcher-1');

    // 4. Assign task
    const assignment = await coordinator.assignTask(taskId, bestBid!.agentId, bestBid!.capability);
    expect(assignment.status).toBe('assigned');
    expect(events).toContain('assigned');

    // 5. Complete task
    await coordinator.completeTask(taskId, 'researcher-1', {
      findings: ['AI market growing rapidly'],
      sources: ['source1.com'],
    });
    expect(events).toContain('completed');

    // 6. Verify final state
    const result = coordinator.getTaskResult(taskId);
    expect(result).toBeDefined();
    expect(result!.status).toBe('success');
    expect(result!.outputs.research).toBeDefined();

    // 7. Verify reputation was recorded
    const score = coordinator.reputation.getScore('researcher-1');
    expect(score.taskCount).toBe(1);
    expect(score.successRate).toBe(1);
  });

  it('should handle submit -> bid -> assign -> fail lifecycle', async () => {
    const events: string[] = [];
    coordinator.on('task:submitted', () => events.push('submitted'));
    coordinator.on('task:failed', () => events.push('failed'));
    coordinator.on('task:completed', () => events.push('completed'));

    const taskId = await coordinator.submitTask({
      description: 'Failing task',
      requiredCapabilities: ['analysis'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    await coordinator.submitBid({
      taskId,
      agentId: 'agent-1',
      capability: 'analysis',
      estimatedDuration: 1000,
      estimatedCost: 5,
      confidence: 0.8,
      timestamp: Date.now(),
    });

    await coordinator.assignTask(taskId, 'agent-1', 'analysis');
    await coordinator.failTask(taskId, 'agent-1', 'Resource exhaustion');

    expect(events).toContain('failed');
    expect(events).toContain('completed'); // task:completed fires even with failures

    const result = coordinator.getTaskResult(taskId);
    expect(result!.status).toBe('partial');

    const score = coordinator.reputation.getScore('agent-1');
    expect(score.successRate).toBe(0);
  });
});

describe('Multi-Agent Task Workflow', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    mockClient.subscribeTopic.mockImplementation(() => {});
    await coordinator.initialize();

    // Register agents
    await registry.registerAgent(createProfile('researcher', ['research']));
    await registry.registerAgent(createProfile('analyst', ['analysis']));
    await registry.registerAgent(createProfile('synthesizer', ['synthesis']));
  });

  it('should auto-assign based on capabilities', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Multi-agent task',
      requiredCapabilities: ['research', 'analysis'],
      payload: {},
      priority: 'high',
      requesterId: 'r1',
    });

    const assignments = await coordinator.autoAssignTask(taskId);
    expect(assignments).toHaveLength(2);

    const assignedCapabilities = assignments.map(a => a.capability);
    expect(assignedCapabilities).toContain('research');
    expect(assignedCapabilities).toContain('analysis');
  });

  it('should handle partial auto-assignment when some capabilities unavailable', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Partially coverable task',
      requiredCapabilities: ['research', 'nonexistent_cap'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    const assignments = await coordinator.autoAssignTask(taskId);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.capability).toBe('research');
  });

  it('should track outputs from multiple agents independently', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Multi-output task',
      requiredCapabilities: ['research', 'analysis', 'synthesis'],
      payload: {},
      priority: 'high',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'researcher', 'research');
    await coordinator.assignTask(taskId, 'analyst', 'analysis');
    await coordinator.assignTask(taskId, 'synthesizer', 'synthesis');

    await coordinator.completeTask(taskId, 'researcher', { findings: ['f1', 'f2'] });
    await coordinator.completeTask(taskId, 'analyst', { insights: ['i1'] });
    await coordinator.completeTask(taskId, 'synthesizer', { summary: 'done' });

    const result = coordinator.getTaskResult(taskId);
    expect(result).toBeDefined();
    expect(result!.status).toBe('success');
    expect(result!.outputs.research).toEqual({ findings: ['f1', 'f2'] });
    expect(result!.outputs.analysis).toEqual({ insights: ['i1'] });
    expect(result!.outputs.synthesis).toEqual({ summary: 'done' });
  });
});

describe('Bid Selection with Reputation', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    mockClient.subscribeTopic.mockImplementation(() => {});
    await coordinator.initialize();
  });

  it('should prefer experienced agent over newcomer with same bid', async () => {
    // Build reputation for experienced agent
    for (let i = 0; i < 15; i++) {
      coordinator.reputation.recordSuccess('experienced', 1000, 5);
    }

    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['cap'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    // Identical bids
    const bidParams = {
      taskId,
      capability: 'cap',
      estimatedDuration: 5000,
      estimatedCost: 5,
      confidence: 0.8,
      timestamp: Date.now(),
    };

    await coordinator.submitBid({ ...bidParams, agentId: 'experienced' });
    await coordinator.submitBid({ ...bidParams, agentId: 'newcomer' });

    const best = coordinator.selectBestBid(taskId);
    expect(best!.agentId).toBe('experienced');
  });

  it('should prefer reliable agent over unreliable with same bid', async () => {
    // Reliable agent: all successes
    for (let i = 0; i < 10; i++) {
      coordinator.reputation.recordSuccess('reliable', 1000, 5);
    }
    // Unreliable agent: mix of successes and failures
    for (let i = 0; i < 5; i++) {
      coordinator.reputation.recordSuccess('unreliable', 1000, 5);
      coordinator.reputation.recordFailure('unreliable');
    }

    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['cap'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    const bidParams = {
      taskId,
      capability: 'cap',
      estimatedDuration: 5000,
      estimatedCost: 5,
      confidence: 0.8,
      timestamp: Date.now(),
    };

    await coordinator.submitBid({ ...bidParams, agentId: 'reliable' });
    await coordinator.submitBid({ ...bidParams, agentId: 'unreliable' });

    const best = coordinator.selectBestBid(taskId);
    expect(best!.agentId).toBe('reliable');
  });

  it('should allow high-confidence newcomer to beat low-confidence veteran', async () => {
    // Build up veteran reputation
    for (let i = 0; i < 10; i++) {
      coordinator.reputation.recordSuccess('veteran', 1000, 5);
    }

    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['cap'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    // Veteran: low confidence, high cost
    await coordinator.submitBid({
      taskId, agentId: 'veteran', capability: 'cap',
      estimatedDuration: 10000, estimatedCost: 50, confidence: 0.3, timestamp: Date.now(),
    });

    // Newcomer: very high confidence, zero cost
    await coordinator.submitBid({
      taskId, agentId: 'newcomer', capability: 'cap',
      estimatedDuration: 1000, estimatedCost: 0, confidence: 0.99, timestamp: Date.now(),
    });

    const best = coordinator.selectBestBid(taskId);
    expect(best!.agentId).toBe('newcomer');
  });
});

describe('Error Recovery Scenarios', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    mockClient.subscribeTopic.mockImplementation(() => {});
    await coordinator.initialize();
  });

  it('should handle submitMessage failure during task submission', async () => {
    mockClient.submitMessage.mockRejectedValueOnce(new Error('Network error'));

    await expect(coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['cap'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    })).rejects.toThrow('Network error');
  });

  it('should handle submitMessage failure during bid submission', async () => {
    mockClient.submitMessage
      .mockResolvedValueOnce(1) // submitTask succeeds
      .mockRejectedValueOnce(new Error('Bid failed'));

    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['cap'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    await expect(coordinator.submitBid({
      taskId, agentId: 'a1', capability: 'cap',
      estimatedDuration: 1000, estimatedCost: 5, confidence: 0.8, timestamp: Date.now(),
    })).rejects.toThrow('Bid failed');
  });

  it('should handle submitMessage failure during completeTask', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['cap'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'a1', 'cap');

    mockClient.submitMessage.mockRejectedValueOnce(new Error('Complete failed'));

    await expect(
      coordinator.completeTask(taskId, 'a1', { result: 'done' })
    ).rejects.toThrow('Complete failed');
  });

  it('should handle submitMessage failure during failTask', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['cap'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'a1', 'cap');

    mockClient.submitMessage.mockRejectedValueOnce(new Error('Fail failed'));

    await expect(
      coordinator.failTask(taskId, 'a1', 'error')
    ).rejects.toThrow('Fail failed');
  });

  it('should handle error when initializing without topic', async () => {
    const freshCoordinator = new TaskCoordinator(mockClient, registry);

    await expect(freshCoordinator.submitTask({
      description: 'Test',
      requiredCapabilities: [],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    })).rejects.toThrow('Coordinator not initialized');
  });

  it('should handle error when submitting bid without initialization', async () => {
    const freshCoordinator = new TaskCoordinator(mockClient, registry);

    await expect(freshCoordinator.submitBid({
      taskId: 't1', agentId: 'a1', capability: 'cap',
      estimatedDuration: 1000, estimatedCost: 5, confidence: 0.8, timestamp: Date.now(),
    })).rejects.toThrow('Coordinator not initialized');
  });

  it('should handle error when assigning without initialization', async () => {
    const freshCoordinator = new TaskCoordinator(mockClient, registry);
    await expect(
      freshCoordinator.assignTask('t1', 'a1', 'cap')
    ).rejects.toThrow('Coordinator not initialized');
  });

  it('should handle error when completing without initialization', async () => {
    const freshCoordinator = new TaskCoordinator(mockClient, registry);
    await expect(
      freshCoordinator.completeTask('t1', 'a1', {})
    ).rejects.toThrow('Coordinator not initialized');
  });

  it('should handle error when failing without initialization', async () => {
    const freshCoordinator = new TaskCoordinator(mockClient, registry);
    await expect(
      freshCoordinator.failTask('t1', 'a1', 'err')
    ).rejects.toThrow('Coordinator not initialized');
  });
});

describe('Task Data Access', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    mockClient.subscribeTopic.mockImplementation(() => {});
    await coordinator.initialize();
  });

  it('should return undefined for non-existent task', () => {
    expect(coordinator.getTask('nonexistent')).toBeUndefined();
  });

  it('should return empty array for non-existent task assignments', () => {
    expect(coordinator.getTaskAssignments('nonexistent')).toEqual([]);
  });

  it('should return empty array for non-existent task bids', () => {
    expect(coordinator.getTaskBids('nonexistent')).toEqual([]);
  });

  it('should return undefined for non-existent task result', () => {
    expect(coordinator.getTaskResult('nonexistent')).toBeUndefined();
  });

  it('should return all tasks ordered by insertion', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const id = await coordinator.submitTask({
        description: `Task ${i}`,
        requiredCapabilities: [],
        payload: { order: i },
        priority: 'low',
        requesterId: 'r1',
      });
      ids.push(id);
    }

    const allTasks = coordinator.getAllTasks();
    expect(allTasks).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(allTasks[i]!.payload.order).toBe(i);
    }
  });

  it('should track task count accurately', async () => {
    expect(coordinator.getTaskCount()).toBe(0);

    for (let i = 0; i < 3; i++) {
      await coordinator.submitTask({
        description: `Task ${i}`,
        requiredCapabilities: [],
        payload: {},
        priority: 'low',
        requesterId: 'r1',
      });
    }

    expect(coordinator.getTaskCount()).toBe(3);
  });
});
