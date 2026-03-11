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

  mock.createTopic = jest.fn().mockResolvedValue('0.0.300');
  mock.submitMessage = jest.fn().mockResolvedValue(1);
  mock.subscribeTopic = jest.fn();
  mock.emit = jest.fn().mockReturnValue(true);

  return mock;
}

function createTestProfile(id: string, capabilities: string[]): AgentProfile {
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
    hederaAccountId: '0.0.12345',
    inboundTopicId: '0.0.200',
    outboundTopicId: '0.0.201',
    registryTopicId: '0.0.100',
    status: 'active',
    createdAt: Date.now(),
    metadata: {},
  };
}

describe('TaskCoordinator', () => {
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
  });

  describe('initialize', () => {
    it('should create a coordination topic', async () => {
      const topicId = await coordinator.initialize();
      expect(topicId).toBe('0.0.300');
    });

    it('should use existing topic if provided', async () => {
      mockClient.createTopic.mockClear();
      const topicId = await coordinator.initialize('0.0.999');
      expect(topicId).toBe('0.0.999');
      expect(mockClient.createTopic).not.toHaveBeenCalled();
    });

    it('should subscribe to coordination topic', async () => {
      await coordinator.initialize();
      expect(mockClient.subscribeTopic).toHaveBeenCalledWith(
        '0.0.300',
        expect.any(Function)
      );
    });
  });

  describe('submitTask', () => {
    beforeEach(async () => {
      await coordinator.initialize();
    });

    it('should create a task with generated ID', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Test task',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'medium',
        requesterId: 'agent-1',
      });

      expect(taskId).toBeDefined();
      expect(taskId.length).toBeGreaterThan(0);
    });

    it('should store the task', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Test task',
        requiredCapabilities: ['research'],
        payload: { topic: 'AI' },
        priority: 'high',
        requesterId: 'agent-1',
      });

      const task = coordinator.getTask(taskId);
      expect(task).toBeDefined();
      expect(task!.description).toBe('Test task');
      expect(task!.priority).toBe('high');
    });

    it('should submit task message to Hedera', async () => {
      await coordinator.submitTask({
        description: 'Test task',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'medium',
        requesterId: 'agent-1',
      });

      const lastCall = mockClient.submitMessage.mock.calls[mockClient.submitMessage.mock.calls.length - 1]!;
      const message = JSON.parse(lastCall[1] as string);
      expect(message.type).toBe(MessageType.TASK_REQUEST);
    });

    it('should emit task:submitted event', async () => {
      const emitSpy = jest.fn();
      coordinator.on('task:submitted', emitSpy);

      await coordinator.submitTask({
        description: 'Test',
        requiredCapabilities: [],
        payload: {},
        priority: 'low',
        requesterId: 'a1',
      });

      expect(emitSpy).toHaveBeenCalled();
    });

    it('should throw if not initialized', async () => {
      const uninit = new TaskCoordinator(mockClient, registry);
      await expect(uninit.submitTask({
        description: 'Test',
        requiredCapabilities: [],
        payload: {},
        priority: 'low',
        requesterId: 'a1',
      })).rejects.toThrow('Coordinator not initialized');
    });
  });

  describe('submitBid', () => {
    it('should store the bid', async () => {
      await coordinator.initialize();
      const taskId = await coordinator.submitTask({
        description: 'Test',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'medium',
        requesterId: 'a1',
      });

      const bid: TaskBid = {
        taskId,
        agentId: 'agent-2',
        capability: 'research',
        estimatedDuration: 5000,
        estimatedCost: 1,
        confidence: 0.9,
        timestamp: Date.now(),
      };

      await coordinator.submitBid(bid);
      const bids = coordinator.getTaskBids(taskId);
      expect(bids).toHaveLength(1);
      expect(bids[0]!.agentId).toBe('agent-2');
    });

    it('should submit bid message to Hedera', async () => {
      await coordinator.initialize();

      const bid: TaskBid = {
        taskId: 'task-1',
        agentId: 'agent-2',
        capability: 'research',
        estimatedDuration: 5000,
        estimatedCost: 1,
        confidence: 0.9,
        timestamp: Date.now(),
      };

      await coordinator.submitBid(bid);

      const lastCall = mockClient.submitMessage.mock.calls[mockClient.submitMessage.mock.calls.length - 1]!;
      const message = JSON.parse(lastCall[1] as string);
      expect(message.type).toBe(MessageType.TASK_BID);
    });
  });

  describe('assignTask', () => {
    it('should create an assignment', async () => {
      await coordinator.initialize();

      const assignment = await coordinator.assignTask('task-1', 'agent-1', 'research');

      expect(assignment.taskId).toBe('task-1');
      expect(assignment.agentId).toBe('agent-1');
      expect(assignment.status).toBe('assigned');
    });

    it('should store assignments', async () => {
      await coordinator.initialize();
      await coordinator.assignTask('task-1', 'agent-1', 'research');
      await coordinator.assignTask('task-1', 'agent-2', 'analysis');

      const assignments = coordinator.getTaskAssignments('task-1');
      expect(assignments).toHaveLength(2);
    });

    it('should submit assignment message', async () => {
      await coordinator.initialize();
      await coordinator.assignTask('task-1', 'agent-1', 'research');

      const lastCall = mockClient.submitMessage.mock.calls[mockClient.submitMessage.mock.calls.length - 1]!;
      const message = JSON.parse(lastCall[1] as string);
      expect(message.type).toBe(MessageType.TASK_ASSIGN);
      expect(message.recipientId).toBe('agent-1');
    });
  });

  describe('completeTask', () => {
    it('should update assignment status', async () => {
      await coordinator.initialize();
      await coordinator.assignTask('task-1', 'agent-1', 'research');

      await coordinator.completeTask('task-1', 'agent-1', { findings: ['data'] });

      const assignments = coordinator.getTaskAssignments('task-1');
      expect(assignments[0]!.status).toBe('completed');
      expect(assignments[0]!.result).toEqual({ findings: ['data'] });
    });

    it('should submit completion message', async () => {
      await coordinator.initialize();
      await coordinator.completeTask('task-1', 'agent-1', { result: 'done' });

      const lastCall = mockClient.submitMessage.mock.calls[mockClient.submitMessage.mock.calls.length - 1]!;
      const message = JSON.parse(lastCall[1] as string);
      expect(message.type).toBe(MessageType.TASK_COMPLETE);
    });
  });

  describe('failTask', () => {
    it('should update assignment status to failed', async () => {
      await coordinator.initialize();
      await coordinator.assignTask('task-1', 'agent-1', 'research');

      await coordinator.failTask('task-1', 'agent-1', 'timeout');

      const assignments = coordinator.getTaskAssignments('task-1');
      expect(assignments[0]!.status).toBe('failed');
    });

    it('should emit task:failed event', async () => {
      await coordinator.initialize();
      const spy = jest.fn();
      coordinator.on('task:failed', spy);

      await coordinator.failTask('task-1', 'agent-1', 'error');
      expect(spy).toHaveBeenCalledWith({
        taskId: 'task-1',
        agentId: 'agent-1',
        error: 'error',
      });
    });
  });

  describe('selectBestBid', () => {
    it('should return null when no bids', async () => {
      await coordinator.initialize();
      const taskId = await coordinator.submitTask({
        description: 'Test',
        requiredCapabilities: [],
        payload: {},
        priority: 'low',
        requesterId: 'a1',
      });

      expect(coordinator.selectBestBid(taskId)).toBeNull();
    });

    it('should select bid with best confidence/cost ratio', async () => {
      await coordinator.initialize();
      const taskId = await coordinator.submitTask({
        description: 'Test',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'medium',
        requesterId: 'a1',
      });

      // Lower confidence but much lower cost = better ratio
      await coordinator.submitBid({
        taskId, agentId: 'a1', capability: 'research',
        estimatedDuration: 5000, estimatedCost: 10, confidence: 0.9, timestamp: Date.now(),
      });
      await coordinator.submitBid({
        taskId, agentId: 'a2', capability: 'research',
        estimatedDuration: 3000, estimatedCost: 0, confidence: 0.85, timestamp: Date.now(),
      });

      const best = coordinator.selectBestBid(taskId);
      expect(best).toBeDefined();
      expect(best!.agentId).toBe('a2'); // Better ratio (0.85/1 > 0.9/11)
    });
  });

  describe('autoAssignTask', () => {
    it('should assign agents based on capabilities', async () => {
      await coordinator.initialize();

      // Register agents with capabilities
      await registry.registerAgent(createTestProfile('a1', ['research']));
      await registry.registerAgent(createTestProfile('a2', ['analysis']));

      const taskId = await coordinator.submitTask({
        description: 'Complex task',
        requiredCapabilities: ['research', 'analysis'],
        payload: {},
        priority: 'high',
        requesterId: 'requester',
      });

      const assignments = await coordinator.autoAssignTask(taskId);
      expect(assignments).toHaveLength(2);
    });

    it('should throw for non-existent task', async () => {
      await coordinator.initialize();
      await expect(coordinator.autoAssignTask('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('getAllTasks', () => {
    it('should return all tasks', async () => {
      await coordinator.initialize();
      await coordinator.submitTask({
        description: 'Task 1', requiredCapabilities: [], payload: {},
        priority: 'low', requesterId: 'a1',
      });
      await coordinator.submitTask({
        description: 'Task 2', requiredCapabilities: [], payload: {},
        priority: 'high', requesterId: 'a1',
      });

      expect(coordinator.getAllTasks()).toHaveLength(2);
    });
  });

  describe('getTaskCount', () => {
    it('should return correct count', async () => {
      await coordinator.initialize();
      expect(coordinator.getTaskCount()).toBe(0);

      await coordinator.submitTask({
        description: 'Task', requiredCapabilities: [], payload: {},
        priority: 'low', requesterId: 'a1',
      });
      expect(coordinator.getTaskCount()).toBe(1);
    });
  });

  describe('getCoordinationTopicId', () => {
    it('should throw if not initialized', () => {
      expect(() => coordinator.getCoordinationTopicId()).toThrow('Coordinator not initialized');
    });

    it('should return topic ID after init', async () => {
      await coordinator.initialize();
      expect(coordinator.getCoordinationTopicId()).toBe('0.0.300');
    });
  });

  describe('task completion detection', () => {
    it('should emit task:completed when all assignments done', async () => {
      await coordinator.initialize();
      const spy = jest.fn();
      coordinator.on('task:completed', spy);

      const taskId = await coordinator.submitTask({
        description: 'Test', requiredCapabilities: ['research'], payload: {},
        priority: 'medium', requesterId: 'a1',
      });

      await coordinator.assignTask(taskId, 'agent-1', 'research');
      await coordinator.completeTask(taskId, 'agent-1', { data: 'result' });

      expect(spy).toHaveBeenCalled();
      const result = spy.mock.calls[0][0];
      expect(result.taskId).toBe(taskId);
      expect(result.status).toBe('success');
    });

    it('should mark result as partial when some fail', async () => {
      await coordinator.initialize();
      const spy = jest.fn();
      coordinator.on('task:completed', spy);

      const taskId = await coordinator.submitTask({
        description: 'Test', requiredCapabilities: ['a', 'b'], payload: {},
        priority: 'medium', requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'agent-1', 'a');
      await coordinator.assignTask(taskId, 'agent-2', 'b');
      await coordinator.completeTask(taskId, 'agent-1', { ok: true });
      await coordinator.failTask(taskId, 'agent-2', 'error');

      expect(spy).toHaveBeenCalled();
      const result = spy.mock.calls[0][0];
      expect(result.status).toBe('partial');
    });
  });
});
