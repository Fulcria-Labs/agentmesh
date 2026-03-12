/**
 * Edge case and error handling tests for AgentMesh core components
 *
 * Covers: registry message handling, coordinator message handling,
 * boundary values, concurrent operations, and error scenarios.
 */

import { AgentRegistry } from '../core/agent-registry';
import { TaskCoordinator, TaskBid } from '../core/task-coordinator';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile, MessageType, CoordinationMessage } from '../core/types';

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

function createProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    description: 'Test',
    capabilities: [{ name: 'research', description: 'Research', inputSchema: {}, outputSchema: {} }],
    hederaAccountId: '0.0.12345',
    inboundTopicId: '0.0.200',
    outboundTopicId: '0.0.201',
    registryTopicId: '0.0.100',
    status: 'active',
    createdAt: Date.now(),
    metadata: {},
    ...overrides,
  };
}

describe('AgentRegistry - Message Handler Edge Cases', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;
  let messageHandler: (message: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);

    // Capture the subscription callback
    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      messageHandler = callback as any;
    });

    await registry.initialize();
  });

  it('should handle AGENT_REGISTER messages via topic subscription', () => {
    const profile = createProfile({ id: 'remote-agent', name: 'RemoteAgent' });
    const message: CoordinationMessage = {
      type: MessageType.AGENT_REGISTER,
      senderId: 'remote-agent',
      payload: { profile },
      timestamp: Date.now(),
    };

    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 1,
    });

    expect(registry.getAgent('remote-agent')).toBeDefined();
    expect(registry.getAgent('remote-agent')!.name).toBe('RemoteAgent');
  });

  it('should handle AGENT_DEREGISTER messages via topic subscription', async () => {
    await registry.registerAgent(createProfile({ id: 'agent-to-remove' }));
    expect(registry.getAgent('agent-to-remove')).toBeDefined();

    const message: CoordinationMessage = {
      type: MessageType.AGENT_DEREGISTER,
      senderId: 'agent-to-remove',
      payload: {},
      timestamp: Date.now(),
    };

    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 2,
    });

    expect(registry.getAgent('agent-to-remove')).toBeUndefined();
  });

  it('should handle AGENT_STATUS_UPDATE messages via topic subscription', async () => {
    await registry.registerAgent(createProfile({ id: 'status-agent', status: 'active' }));

    const message: CoordinationMessage = {
      type: MessageType.AGENT_STATUS_UPDATE,
      senderId: 'status-agent',
      payload: { status: 'busy' },
      timestamp: Date.now(),
    };

    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 3,
    });

    expect(registry.getAgent('status-agent')!.status).toBe('busy');
  });

  it('should handle AGENT_HEARTBEAT messages and update metadata', async () => {
    await registry.registerAgent(createProfile({ id: 'heartbeat-agent' }));

    const message: CoordinationMessage = {
      type: MessageType.AGENT_HEARTBEAT,
      senderId: 'heartbeat-agent',
      payload: { status: 'active' },
      timestamp: 1234567890,
    };

    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 4,
    });

    const agent = registry.getAgent('heartbeat-agent')!;
    expect(agent.metadata.lastHeartbeat).toBe('1234567890');
  });

  it('should silently ignore malformed JSON messages', () => {
    // Should not throw
    messageHandler({
      contents: Buffer.from('this is not valid json'),
      sequenceNumber: 5,
    });

    // Registry should be unaffected
    expect(registry.getAgentCount()).toBe(0);
  });

  it('should silently ignore empty messages', () => {
    messageHandler({
      contents: Buffer.from(''),
      sequenceNumber: 6,
    });

    expect(registry.getAgentCount()).toBe(0);
  });

  it('should handle status update for non-existent agent gracefully', () => {
    const message: CoordinationMessage = {
      type: MessageType.AGENT_STATUS_UPDATE,
      senderId: 'nonexistent',
      payload: { status: 'busy' },
      timestamp: Date.now(),
    };

    // Should not throw
    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 7,
    });
  });

  it('should handle heartbeat for non-existent agent gracefully', () => {
    const message: CoordinationMessage = {
      type: MessageType.AGENT_HEARTBEAT,
      senderId: 'nonexistent',
      payload: {},
      timestamp: Date.now(),
    };

    // Should not throw
    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 8,
    });
  });

  it('should emit agent:registered event on register message', () => {
    const profile = createProfile({ id: 'emit-test' });
    const message: CoordinationMessage = {
      type: MessageType.AGENT_REGISTER,
      senderId: 'emit-test',
      payload: { profile },
      timestamp: Date.now(),
    };

    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 9,
    });

    expect(mockClient.emit).toHaveBeenCalledWith('agent:registered', profile);
  });

  it('should emit agent:deregistered event on deregister message', () => {
    const message: CoordinationMessage = {
      type: MessageType.AGENT_DEREGISTER,
      senderId: 'deregister-agent',
      payload: {},
      timestamp: Date.now(),
    };

    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 10,
    });

    expect(mockClient.emit).toHaveBeenCalledWith('agent:deregistered', 'deregister-agent');
  });

  it('should emit agent:statusChanged on status update message', async () => {
    await registry.registerAgent(createProfile({ id: 'emit-status' }));

    const message: CoordinationMessage = {
      type: MessageType.AGENT_STATUS_UPDATE,
      senderId: 'emit-status',
      payload: { status: 'inactive' },
      timestamp: Date.now(),
    };

    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 11,
    });

    expect(mockClient.emit).toHaveBeenCalledWith('agent:statusChanged', {
      agentId: 'emit-status',
      status: 'inactive',
    });
  });
});

describe('AgentRegistry - Discovery Edge Cases', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    await registry.initialize();
  });

  it('should do case-insensitive capability name matching', async () => {
    await registry.registerAgent(createProfile({
      id: 'a1',
      capabilities: [{ name: 'Web_Research', description: 'Research', inputSchema: {}, outputSchema: {} }],
    }));

    const result = registry.discoverAgents({ capability: 'web_research' });
    expect(result.totalFound).toBe(1);
  });

  it('should do case-insensitive capability description matching', async () => {
    await registry.registerAgent(createProfile({
      id: 'a1',
      capabilities: [{ name: 'cap1', description: 'Advanced Data Analysis', inputSchema: {}, outputSchema: {} }],
    }));

    const result = registry.discoverAgents({ capability: 'data analysis' });
    expect(result.totalFound).toBe(1);
  });

  it('should return empty result when no agents match filter', async () => {
    await registry.registerAgent(createProfile({ id: 'a1', status: 'active' }));

    const result = registry.discoverAgents({ status: 'busy' });
    expect(result.totalFound).toBe(0);
    expect(result.agents).toEqual([]);
  });

  it('should handle maxResults of 0', async () => {
    await registry.registerAgent(createProfile({ id: 'a1' }));

    const result = registry.discoverAgents({ maxResults: 0 });
    // maxResults of 0 is falsy, so it should not limit
    expect(result.totalFound).toBe(1);
  });

  it('should handle maxResults larger than total agents', async () => {
    await registry.registerAgent(createProfile({ id: 'a1' }));

    const result = registry.discoverAgents({ maxResults: 100 });
    expect(result.totalFound).toBe(1);
  });

  it('should handle agents with no capabilities', async () => {
    await registry.registerAgent(createProfile({ id: 'a1', capabilities: [] }));

    const result = registry.discoverAgents({ capability: 'anything' });
    expect(result.totalFound).toBe(0);
  });

  it('should handle agents with multiple capabilities matching same query', async () => {
    await registry.registerAgent(createProfile({
      id: 'a1',
      capabilities: [
        { name: 'research', description: 'web research', inputSchema: {}, outputSchema: {} },
        { name: 'research_deep', description: 'deep research', inputSchema: {}, outputSchema: {} },
      ],
    }));

    const result = registry.discoverAgents({ capability: 'research' });
    expect(result.totalFound).toBe(1); // Should match agent once, not twice
  });
});

describe('AgentRegistry - Registration Error Handling', () => {
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('should throw on registerAgent when not initialized', async () => {
    const registry = new AgentRegistry(mockClient);
    await expect(
      registry.registerAgent(createProfile())
    ).rejects.toThrow('Registry not initialized');
  });

  it('should throw on deregisterAgent when not initialized', async () => {
    const registry = new AgentRegistry(mockClient);
    await expect(
      registry.deregisterAgent('agent-1')
    ).rejects.toThrow('Registry not initialized');
  });

  it('should throw on updateAgentStatus when not initialized', async () => {
    const registry = new AgentRegistry(mockClient);
    await expect(
      registry.updateAgentStatus('agent-1', 'busy')
    ).rejects.toThrow('Registry not initialized');
  });

  it('should handle updateAgentStatus for non-existent agent', async () => {
    const registry = new AgentRegistry(mockClient);
    await registry.initialize();

    // Should not throw, just sends the message
    await registry.updateAgentStatus('nonexistent', 'busy');
    expect(mockClient.submitMessage).toHaveBeenCalled();
  });

  it('should overwrite agent when registering with same ID', async () => {
    const registry = new AgentRegistry(mockClient);
    await registry.initialize();

    await registry.registerAgent(createProfile({ id: 'a1', name: 'First' }));
    await registry.registerAgent(createProfile({ id: 'a1', name: 'Second' }));

    expect(registry.getAgent('a1')!.name).toBe('Second');
    expect(registry.getAgentCount()).toBe(1);
  });
});

describe('TaskCoordinator - Message Handler Edge Cases', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;
  let messageHandler: (message: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();

    // Reset for coordinator
    mockClient.createTopic.mockResolvedValue('0.0.300');
    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      if (topicId === '0.0.300') {
        messageHandler = callback as any;
      }
    });

    coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
  });

  it('should handle TASK_REQUEST messages via topic subscription', () => {
    const task = {
      id: 'remote-task-1',
      description: 'Remote task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'high' as const,
      requesterId: 'remote-agent',
      createdAt: Date.now(),
    };

    const message: CoordinationMessage = {
      type: MessageType.TASK_REQUEST,
      senderId: 'remote-agent',
      taskId: task.id,
      payload: { task },
      timestamp: Date.now(),
    };

    const spy = jest.fn();
    coordinator.on('task:received', spy);

    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 1,
    });

    expect(coordinator.getTask('remote-task-1')).toBeDefined();
    expect(spy).toHaveBeenCalled();
  });

  it('should handle TASK_BID messages via topic subscription', async () => {
    // First create a task
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'a1',
    });

    const bid: TaskBid = {
      taskId,
      agentId: 'remote-agent',
      capability: 'research',
      estimatedDuration: 5000,
      estimatedCost: 1,
      confidence: 0.9,
      timestamp: Date.now(),
    };

    const message: CoordinationMessage = {
      type: MessageType.TASK_BID,
      senderId: 'remote-agent',
      taskId,
      payload: { bid },
      timestamp: Date.now(),
    };

    const spy = jest.fn();
    coordinator.on('task:bidReceived', spy);

    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 2,
    });

    expect(spy).toHaveBeenCalled();
  });

  it('should handle TASK_BID for unknown task gracefully', () => {
    const bid: TaskBid = {
      taskId: 'nonexistent',
      agentId: 'agent-1',
      capability: 'research',
      estimatedDuration: 5000,
      estimatedCost: 1,
      confidence: 0.9,
      timestamp: Date.now(),
    };

    const message: CoordinationMessage = {
      type: MessageType.TASK_BID,
      senderId: 'agent-1',
      taskId: 'nonexistent',
      payload: { bid },
      timestamp: Date.now(),
    };

    // Should not throw
    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 3,
    });
  });

  it('should silently ignore malformed coordination messages', () => {
    messageHandler({
      contents: Buffer.from('not-json'),
      sequenceNumber: 99,
    });

    // Should not throw, coordinator should be unaffected
    expect(coordinator.getTaskCount()).toBe(0);
  });

  it('should handle TASK_COMPLETE messages', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'agent-1', 'a');

    const message: CoordinationMessage = {
      type: MessageType.TASK_COMPLETE,
      senderId: 'agent-1',
      taskId,
      payload: { result: 'done' },
      timestamp: Date.now(),
    };

    // Should not throw
    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 4,
    });
  });

  it('should handle TASK_COMPLETE without taskId gracefully', () => {
    const message: CoordinationMessage = {
      type: MessageType.TASK_COMPLETE,
      senderId: 'agent-1',
      payload: { result: 'done' },
      timestamp: Date.now(),
    };

    // Should not throw (taskId is undefined, so checkTaskCompletion won't run)
    messageHandler({
      contents: Buffer.from(JSON.stringify(message)),
      sequenceNumber: 5,
    });
  });
});

describe('TaskCoordinator - Bid Selection Edge Cases', () => {
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
    await coordinator.initialize();
  });

  it('should return null for task with no bids array', () => {
    expect(coordinator.selectBestBid('nonexistent-task')).toBeNull();
  });

  it('should return single bid when only one exists', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    await coordinator.submitBid({
      taskId,
      agentId: 'only-agent',
      capability: 'a',
      estimatedDuration: 1000,
      estimatedCost: 5,
      confidence: 0.8,
      timestamp: Date.now(),
    });

    const best = coordinator.selectBestBid(taskId);
    expect(best).not.toBeNull();
    expect(best!.agentId).toBe('only-agent');
  });

  it('should prefer bid with zero cost over expensive bid', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    await coordinator.submitBid({
      taskId, agentId: 'expensive', capability: 'a',
      estimatedDuration: 1000, estimatedCost: 100, confidence: 0.95, timestamp: Date.now(),
    });

    await coordinator.submitBid({
      taskId, agentId: 'free', capability: 'a',
      estimatedDuration: 1000, estimatedCost: 0, confidence: 0.8, timestamp: Date.now(),
    });

    const best = coordinator.selectBestBid(taskId);
    expect(best!.agentId).toBe('free');
  });

  it('should handle multiple bids with same score', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    await coordinator.submitBid({
      taskId, agentId: 'a1', capability: 'a',
      estimatedDuration: 1000, estimatedCost: 5, confidence: 0.5, timestamp: Date.now(),
    });
    await coordinator.submitBid({
      taskId, agentId: 'a2', capability: 'a',
      estimatedDuration: 1000, estimatedCost: 5, confidence: 0.5, timestamp: Date.now(),
    });

    const best = coordinator.selectBestBid(taskId);
    expect(best).not.toBeNull();
    // With identical scores, the first one should be selected (reduce behavior)
  });
});

describe('TaskCoordinator - Task Completion Edge Cases', () => {
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
    await coordinator.initialize();
  });

  it('should handle completeTask for non-existent assignment', async () => {
    // Should not throw even though no assignment exists
    await coordinator.completeTask('fake-task', 'fake-agent', { data: 'done' });
  });

  it('should handle failTask for non-existent assignment', async () => {
    // Should not throw
    await coordinator.failTask('fake-task', 'fake-agent', 'error');
  });

  it('should record completion time on assignment', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'agent-1', 'a');
    await coordinator.completeTask(taskId, 'agent-1', { result: 'ok' });

    const assignments = coordinator.getTaskAssignments(taskId);
    expect(assignments[0]!.completedAt).toBeDefined();
    expect(assignments[0]!.completedAt).toBeGreaterThan(0);
  });

  it('should record failure time on assignment', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'agent-1', 'a');
    await coordinator.failTask(taskId, 'agent-1', 'timeout');

    const assignments = coordinator.getTaskAssignments(taskId);
    expect(assignments[0]!.completedAt).toBeDefined();
    expect(assignments[0]!.result).toEqual({ error: 'timeout' });
  });

  it('should aggregate outputs from multiple completed assignments', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Multi-agent task',
      requiredCapabilities: ['research', 'analysis'],
      payload: {},
      priority: 'high',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'a1', 'research');
    await coordinator.assignTask(taskId, 'a2', 'analysis');

    const completedSpy = jest.fn();
    coordinator.on('task:completed', completedSpy);

    await coordinator.completeTask(taskId, 'a1', { findings: ['f1'] });
    await coordinator.completeTask(taskId, 'a2', { insights: ['i1'] });

    expect(completedSpy).toHaveBeenCalled();
    const result = completedSpy.mock.calls[0][0];
    expect(result.status).toBe('success');
    expect(result.outputs.research).toEqual({ findings: ['f1'] });
    expect(result.outputs.analysis).toEqual({ insights: ['i1'] });
  });

  it('should calculate total cost from assignments', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['a', 'b'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    const a1 = await coordinator.assignTask(taskId, 'a1', 'a');
    const a2 = await coordinator.assignTask(taskId, 'a2', 'b');
    a1.cost = 10;
    a2.cost = 20;

    const completedSpy = jest.fn();
    coordinator.on('task:completed', completedSpy);

    await coordinator.completeTask(taskId, 'a1', 'done');
    await coordinator.completeTask(taskId, 'a2', 'done');

    const result = completedSpy.mock.calls[0][0];
    expect(result.totalCost).toBe(30);
  });

  it('should store task result and make it retrievable', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'a1', 'a');
    await coordinator.completeTask(taskId, 'a1', 'done');

    const result = coordinator.getTaskResult(taskId);
    expect(result).toBeDefined();
    expect(result!.taskId).toBe(taskId);
    expect(result!.status).toBe('success');
  });

  it('should return undefined for task with no result yet', () => {
    expect(coordinator.getTaskResult('nonexistent')).toBeUndefined();
  });
});

describe('TaskCoordinator - autoAssignTask Edge Cases', () => {
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
    await coordinator.initialize();
  });

  it('should return empty assignments when no agents match', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['nonexistent_capability'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    const assignments = await coordinator.autoAssignTask(taskId);
    expect(assignments).toHaveLength(0);
  });

  it('should handle tasks with empty required capabilities', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: [],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    const assignments = await coordinator.autoAssignTask(taskId);
    expect(assignments).toHaveLength(0);
  });
});
