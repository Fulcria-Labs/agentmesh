/**
 * TaskCoordinator - Deep coverage tests
 *
 * Covers: bid ordering, multi-assignment tasks, reputation integration,
 * task lifecycle, concurrent bids, message format validation, and error paths.
 */

import { TaskCoordinator, TaskBid } from '../core/task-coordinator';
import { AgentRegistry } from '../core/agent-registry';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile, MessageType, CoordinationMessage } from '../core/types';

jest.mock('../core/hedera-client');

function createMockClient(): jest.Mocked<HederaClient> {
  const mock = new HederaClient({
    network: 'testnet',
    operatorAccountId: '0.0.1',
    operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
  }) as jest.Mocked<HederaClient>;

  mock.createTopic = jest.fn().mockResolvedValue('0.0.300');
  mock.submitMessage = jest.fn().mockResolvedValue(1);
  mock.subscribeTopic = jest.fn();
  mock.emit = jest.fn().mockReturnValue(true);

  return mock;
}

function makeProfile(id: string, capabilities: string[]): AgentProfile {
  return {
    id,
    name: `Agent_${id}`,
    description: `Agent ${id}`,
    capabilities: capabilities.map(c => ({
      name: c,
      description: `${c} capability`,
      inputSchema: {},
      outputSchema: {},
    })),
    hederaAccountId: '0.0.12345',
    inboundTopicId: '0.0.200',
    outboundTopicId: '0.0.201',
    registryTopicId: '0.0.100',
    status: 'active',
    createdAt: Date.now(),
    metadata: {},
  };
}

describe('TaskCoordinator - Bid System Deep', () => {
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

  it('should accumulate bids for the same task', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    for (let i = 0; i < 5; i++) {
      await coordinator.submitBid({
        taskId,
        agentId: `agent-${i}`,
        capability: 'a',
        estimatedDuration: 1000,
        estimatedCost: i * 2,
        confidence: 0.5 + i * 0.1,
        timestamp: Date.now(),
      });
    }

    expect(coordinator.getTaskBids(taskId)).toHaveLength(5);
  });

  it('should select highest confidence/cost ratio bid', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    // Bid 1: confidence=0.5, cost=10 -> baseScore = 0.5/11 ≈ 0.045
    await coordinator.submitBid({
      taskId, agentId: 'low-ratio', capability: 'a',
      estimatedDuration: 1000, estimatedCost: 10, confidence: 0.5, timestamp: Date.now(),
    });

    // Bid 2: confidence=0.9, cost=1 -> baseScore = 0.9/2 = 0.45
    await coordinator.submitBid({
      taskId, agentId: 'high-ratio', capability: 'a',
      estimatedDuration: 1000, estimatedCost: 1, confidence: 0.9, timestamp: Date.now(),
    });

    const best = coordinator.selectBestBid(taskId);
    expect(best!.agentId).toBe('high-ratio');
  });

  it('should factor reputation into bid selection', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    // Build reputation for agent-rep
    for (let i = 0; i < 15; i++) {
      coordinator.reputation.recordSuccess('agent-rep', 1000, 1);
    }

    // Both have same confidence/cost ratio, but agent-rep has better reputation
    await coordinator.submitBid({
      taskId, agentId: 'agent-new', capability: 'a',
      estimatedDuration: 1000, estimatedCost: 5, confidence: 0.8, timestamp: Date.now(),
    });
    await coordinator.submitBid({
      taskId, agentId: 'agent-rep', capability: 'a',
      estimatedDuration: 1000, estimatedCost: 5, confidence: 0.8, timestamp: Date.now(),
    });

    const best = coordinator.selectBestBid(taskId);
    expect(best!.agentId).toBe('agent-rep');
  });

  it('should return empty bids array for unknown task', () => {
    expect(coordinator.getTaskBids('nonexistent')).toEqual([]);
  });

  it('should emit task:bid event on bid submission', async () => {
    const spy = jest.fn();
    coordinator.on('task:bid', spy);

    await coordinator.submitBid({
      taskId: 'some-task',
      agentId: 'agent-1',
      capability: 'a',
      estimatedDuration: 1000,
      estimatedCost: 5,
      confidence: 0.8,
      timestamp: Date.now(),
    });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      capability: 'a',
    }));
  });

  it('should throw when submitting bid without initialization', async () => {
    const uninitCoordinator = new TaskCoordinator(mockClient, registry);
    await expect(uninitCoordinator.submitBid({
      taskId: 'task', agentId: 'agent', capability: 'a',
      estimatedDuration: 1000, estimatedCost: 5, confidence: 0.8, timestamp: Date.now(),
    })).rejects.toThrow('Coordinator not initialized');
  });
});

describe('TaskCoordinator - Task Lifecycle', () => {
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

  it('should track full lifecycle: submit -> bid -> assign -> complete', async () => {
    const events: string[] = [];
    coordinator.on('task:submitted', () => events.push('submitted'));
    coordinator.on('task:bid', () => events.push('bid'));
    coordinator.on('task:assigned', () => events.push('assigned'));
    coordinator.on('task:completed', () => events.push('completed'));

    const taskId = await coordinator.submitTask({
      description: 'Full lifecycle test',
      requiredCapabilities: ['research'],
      payload: { topic: 'AI' },
      priority: 'high',
      requesterId: 'requester-1',
    });

    expect(events).toContain('submitted');

    await coordinator.submitBid({
      taskId, agentId: 'agent-1', capability: 'research',
      estimatedDuration: 5000, estimatedCost: 1, confidence: 0.95, timestamp: Date.now(),
    });

    expect(events).toContain('bid');

    await coordinator.assignTask(taskId, 'agent-1', 'research');
    expect(events).toContain('assigned');

    await coordinator.completeTask(taskId, 'agent-1', { findings: ['result'] });
    expect(events).toContain('completed');

    const result = coordinator.getTaskResult(taskId);
    expect(result).toBeDefined();
    expect(result!.status).toBe('success');
  });

  it('should track lifecycle with failure: submit -> assign -> fail', async () => {
    const events: string[] = [];
    coordinator.on('task:submitted', () => events.push('submitted'));
    coordinator.on('task:failed', () => events.push('failed'));
    coordinator.on('task:completed', () => events.push('completed'));

    const taskId = await coordinator.submitTask({
      description: 'Failure lifecycle',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'agent-1', 'research');
    await coordinator.failTask(taskId, 'agent-1', 'timeout error');

    expect(events).toContain('failed');
    expect(events).toContain('completed'); // completion event fires even with failures

    const result = coordinator.getTaskResult(taskId);
    expect(result!.status).toBe('partial');
  });

  it('should handle mixed success and failure in multi-agent task', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Multi-agent task',
      requiredCapabilities: ['research', 'analysis', 'synthesis'],
      payload: {},
      priority: 'critical',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'agent-1', 'research');
    await coordinator.assignTask(taskId, 'agent-2', 'analysis');
    await coordinator.assignTask(taskId, 'agent-3', 'synthesis');

    const spy = jest.fn();
    coordinator.on('task:completed', spy);

    await coordinator.completeTask(taskId, 'agent-1', { data: 'research_done' });
    expect(spy).not.toHaveBeenCalled(); // Not all done yet

    await coordinator.failTask(taskId, 'agent-2', 'error');
    expect(spy).not.toHaveBeenCalled(); // Still waiting on agent-3

    await coordinator.completeTask(taskId, 'agent-3', { data: 'synthesis_done' });
    expect(spy).toHaveBeenCalled();

    const result = spy.mock.calls[0][0];
    expect(result.status).toBe('partial');
    expect(result.outputs.research).toEqual({ data: 'research_done' });
    expect(result.outputs.synthesis).toEqual({ data: 'synthesis_done' });
  });

  it('should handle all assignments failing', async () => {
    const taskId = await coordinator.submitTask({
      description: 'All fail task',
      requiredCapabilities: ['a', 'b'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'a1', 'a');
    await coordinator.assignTask(taskId, 'a2', 'b');

    const spy = jest.fn();
    coordinator.on('task:completed', spy);

    await coordinator.failTask(taskId, 'a1', 'error1');
    await coordinator.failTask(taskId, 'a2', 'error2');

    const result = spy.mock.calls[0][0];
    expect(result.status).toBe('partial');
  });
});

describe('TaskCoordinator - Reputation Integration', () => {
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

  it('should record success in reputation system on task completion', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Rep test',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'agent-1', 'a');
    await coordinator.completeTask(taskId, 'agent-1', { result: 'ok' });

    const score = coordinator.reputation.getScore('agent-1');
    expect(score.taskCount).toBe(1);
    expect(score.successRate).toBe(1);
  });

  it('should record failure in reputation system on task failure', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Rep fail test',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'agent-1', 'a');
    await coordinator.failTask(taskId, 'agent-1', 'error');

    const score = coordinator.reputation.getScore('agent-1');
    expect(score.taskCount).toBe(1);
    expect(score.successRate).toBe(0);
  });

  it('should build reputation across multiple tasks', async () => {
    for (let i = 0; i < 5; i++) {
      const taskId = await coordinator.submitTask({
        description: `Task ${i}`,
        requiredCapabilities: ['a'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'reliable-agent', 'a');
      await coordinator.completeTask(taskId, 'reliable-agent', { result: `done-${i}` });
    }

    const score = coordinator.reputation.getScore('reliable-agent');
    expect(score.taskCount).toBe(5);
    expect(score.successRate).toBe(1);
    expect(score.overallScore).toBeGreaterThan(0.5);
  });
});

describe('TaskCoordinator - Message Handler Deep', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;
  let messageHandler: (msg: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();

    mockClient.createTopic.mockResolvedValue('0.0.300');
    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      if (topicId === '0.0.300') {
        messageHandler = callback as any;
      }
    });

    coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
  });

  function sendMsg(msg: CoordinationMessage, seq: number) {
    messageHandler({ contents: Buffer.from(JSON.stringify(msg)), sequenceNumber: seq });
  }

  it('should handle TASK_REQUEST from external source', () => {
    const receivedSpy = jest.fn();
    coordinator.on('task:received', receivedSpy);

    sendMsg({
      type: MessageType.TASK_REQUEST,
      senderId: 'external-agent',
      taskId: 'ext-task-1',
      payload: {
        task: {
          id: 'ext-task-1',
          description: 'External task',
          requiredCapabilities: ['research'],
          payload: { query: 'test' },
          priority: 'high',
          requesterId: 'external-agent',
          createdAt: Date.now(),
        },
      },
      timestamp: Date.now(),
    }, 1);

    expect(coordinator.getTask('ext-task-1')).toBeDefined();
    expect(coordinator.getTask('ext-task-1')!.description).toBe('External task');
    expect(receivedSpy).toHaveBeenCalled();
  });

  it('should handle TASK_BID from external source and store it', () => {
    // First create a task
    sendMsg({
      type: MessageType.TASK_REQUEST,
      senderId: 'agent-1',
      taskId: 'task-for-bid',
      payload: {
        task: {
          id: 'task-for-bid',
          description: 'Task',
          requiredCapabilities: ['a'],
          payload: {},
          priority: 'medium',
          requesterId: 'agent-1',
          createdAt: Date.now(),
        },
      },
      timestamp: Date.now(),
    }, 1);

    const bidSpy = jest.fn();
    coordinator.on('task:bidReceived', bidSpy);

    sendMsg({
      type: MessageType.TASK_BID,
      senderId: 'bidder-1',
      taskId: 'task-for-bid',
      payload: {
        bid: {
          taskId: 'task-for-bid',
          agentId: 'bidder-1',
          capability: 'a',
          estimatedDuration: 2000,
          estimatedCost: 3,
          confidence: 0.85,
          timestamp: Date.now(),
        },
      },
      timestamp: Date.now(),
    }, 2);

    expect(bidSpy).toHaveBeenCalled();
    const bids = coordinator.getTaskBids('task-for-bid');
    expect(bids.length).toBeGreaterThan(0);
  });

  it('should handle TASK_BID for new unknown task (creates bid array)', () => {
    sendMsg({
      type: MessageType.TASK_BID,
      senderId: 'agent-1',
      taskId: 'unknown-task',
      payload: {
        bid: {
          taskId: 'unknown-task',
          agentId: 'agent-1',
          capability: 'a',
          estimatedDuration: 1000,
          estimatedCost: 1,
          confidence: 0.9,
          timestamp: Date.now(),
        },
      },
      timestamp: Date.now(),
    }, 1);

    // Should create a new bids array for the unknown task
    const bids = coordinator.getTaskBids('unknown-task');
    expect(bids.length).toBe(1);
  });

  it('should handle multiple TASK_REQUEST messages', () => {
    for (let i = 0; i < 10; i++) {
      sendMsg({
        type: MessageType.TASK_REQUEST,
        senderId: `agent-${i}`,
        taskId: `task-${i}`,
        payload: {
          task: {
            id: `task-${i}`,
            description: `Task ${i}`,
            requiredCapabilities: ['a'],
            payload: {},
            priority: 'medium',
            requesterId: `agent-${i}`,
            createdAt: Date.now(),
          },
        },
        timestamp: Date.now(),
      }, i + 1);
    }

    expect(coordinator.getTaskCount()).toBe(10);
  });

  it('should ignore messages with unknown type', () => {
    sendMsg({
      type: 'unknown.message.type' as any,
      senderId: 'agent-1',
      payload: {},
      timestamp: Date.now(),
    }, 1);

    expect(coordinator.getTaskCount()).toBe(0);
  });
});

describe('TaskCoordinator - Auto Assignment Deep', () => {
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

  it('should assign first available agent for each capability', async () => {
    await registry.registerAgent(makeProfile('research-1', ['research']));
    await registry.registerAgent(makeProfile('research-2', ['research']));
    await registry.registerAgent(makeProfile('analysis-1', ['analysis']));

    const taskId = await coordinator.submitTask({
      description: 'Auto assign test',
      requiredCapabilities: ['research', 'analysis'],
      payload: {},
      priority: 'high',
      requesterId: 'r1',
    });

    const assignments = await coordinator.autoAssignTask(taskId);
    expect(assignments).toHaveLength(2);
    expect(assignments[0]!.capability).toBe('research');
    expect(assignments[1]!.capability).toBe('analysis');
  });

  it('should skip capabilities with no matching agents', async () => {
    await registry.registerAgent(makeProfile('agent-1', ['research']));

    const taskId = await coordinator.submitTask({
      description: 'Partial assign',
      requiredCapabilities: ['research', 'nonexistent_capability'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    const assignments = await coordinator.autoAssignTask(taskId);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.capability).toBe('research');
  });

  it('should only assign active agents', async () => {
    await registry.registerAgent(makeProfile('active-agent', ['research']));
    await registry.registerAgent({
      ...makeProfile('inactive-agent', ['research']),
      status: 'inactive',
    });

    const taskId = await coordinator.submitTask({
      description: 'Active only',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    const assignments = await coordinator.autoAssignTask(taskId);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.agentId).toBe('active-agent');
  });
});

describe('TaskCoordinator - Multiple Assignments', () => {
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

  it('should support multiple assignments for the same task', async () => {
    const taskId = 'multi-assign-task';
    await coordinator.assignTask(taskId, 'agent-1', 'research');
    await coordinator.assignTask(taskId, 'agent-2', 'analysis');
    await coordinator.assignTask(taskId, 'agent-3', 'synthesis');

    const assignments = coordinator.getTaskAssignments(taskId);
    expect(assignments).toHaveLength(3);
    expect(assignments.map(a => a.agentId)).toEqual(['agent-1', 'agent-2', 'agent-3']);
  });

  it('should independently track status of each assignment', async () => {
    const taskId = 'status-track';
    await coordinator.assignTask(taskId, 'agent-1', 'a');
    await coordinator.assignTask(taskId, 'agent-2', 'b');

    await coordinator.completeTask(taskId, 'agent-1', 'done');

    const assignments = coordinator.getTaskAssignments(taskId);
    expect(assignments[0]!.status).toBe('completed');
    expect(assignments[1]!.status).toBe('assigned');
  });

  it('should emit task:assigned for each assignment', async () => {
    const spy = jest.fn();
    coordinator.on('task:assigned', spy);

    await coordinator.assignTask('task', 'a1', 'cap-a');
    await coordinator.assignTask('task', 'a2', 'cap-b');
    await coordinator.assignTask('task', 'a3', 'cap-c');

    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('should set startedAt on assignment', async () => {
    const before = Date.now();
    const assignment = await coordinator.assignTask('task', 'agent', 'cap');
    const after = Date.now();

    expect(assignment.startedAt).toBeDefined();
    expect(assignment.startedAt).toBeGreaterThanOrEqual(before);
    expect(assignment.startedAt).toBeLessThanOrEqual(after);
  });
});

describe('TaskCoordinator - Error Handling', () => {
  let mockClient: jest.Mocked<HederaClient>;
  let registry: AgentRegistry;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
  });

  it('should throw on submitTask without initialization', async () => {
    const coordinator = new TaskCoordinator(mockClient, registry);
    await expect(coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: [],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    })).rejects.toThrow('Coordinator not initialized');
  });

  it('should throw on assignTask without initialization', async () => {
    const coordinator = new TaskCoordinator(mockClient, registry);
    await expect(coordinator.assignTask('t', 'a', 'c'))
      .rejects.toThrow('Coordinator not initialized');
  });

  it('should throw on completeTask without initialization', async () => {
    const coordinator = new TaskCoordinator(mockClient, registry);
    await expect(coordinator.completeTask('t', 'a', {}))
      .rejects.toThrow('Coordinator not initialized');
  });

  it('should throw on failTask without initialization', async () => {
    const coordinator = new TaskCoordinator(mockClient, registry);
    await expect(coordinator.failTask('t', 'a', 'err'))
      .rejects.toThrow('Coordinator not initialized');
  });

  it('should throw on getCoordinationTopicId without initialization', () => {
    const coordinator = new TaskCoordinator(mockClient, registry);
    expect(() => coordinator.getCoordinationTopicId())
      .toThrow('Coordinator not initialized');
  });

  it('should return undefined for getTask on nonexistent task', async () => {
    mockClient.createTopic.mockResolvedValue('0.0.300');
    const coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
    expect(coordinator.getTask('no-such-task')).toBeUndefined();
  });

  it('should return empty array for getTaskAssignments on nonexistent task', async () => {
    mockClient.createTopic.mockResolvedValue('0.0.300');
    const coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
    expect(coordinator.getTaskAssignments('no-task')).toEqual([]);
  });
});
