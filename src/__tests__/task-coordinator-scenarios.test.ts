/**
 * TaskCoordinator - Advanced scenarios and edge cases
 * Tests bidding strategies, auto-assignment, and task lifecycle edge cases
 */

import { TaskCoordinator, TaskBid } from '../core/task-coordinator';
import { AgentRegistry } from '../core/agent-registry';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile, TaskRequest, MessageType } from '../core/types';

jest.mock('../core/hedera-client');

function createMockHederaClient(): jest.Mocked<HederaClient> {
  const mock = new HederaClient({
    network: 'testnet',
    operatorAccountId: '0.0.1',
    operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
  }) as jest.Mocked<HederaClient>;
  mock.createTopic = jest.fn().mockResolvedValue('0.0.500');
  mock.submitMessage = jest.fn().mockResolvedValue(1);
  mock.subscribeTopic = jest.fn();
  mock.emit = jest.fn().mockReturnValue(true);
  return mock;
}

function createTestProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    description: 'A test agent',
    capabilities: [
      { name: 'web_research', description: 'Research', inputSchema: {}, outputSchema: {} },
    ],
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

describe('TaskCoordinator - Advanced Scenarios', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockHederaClient();
    registry = new AgentRegistry(mockClient);
    await registry.initialize('0.0.100');
    coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize('0.0.500');
  });

  describe('Bid Selection Edge Cases', () => {
    it('should return null when no bids exist for a task', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Test task',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'medium',
        requesterId: 'requester-1',
      });
      expect(coordinator.selectBestBid(taskId)).toBeNull();
    });

    it('should return null for non-existent task', () => {
      expect(coordinator.selectBestBid('non-existent-task')).toBeNull();
    });

    it('should select bid with highest reputation-adjusted score', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Test task',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'high',
        requesterId: 'requester-1',
      });

      // Record reputation for agent-2
      coordinator.reputation.recordSuccess('agent-2', 100, 5);
      coordinator.reputation.recordSuccess('agent-2', 110, 5);
      coordinator.reputation.recordSuccess('agent-2', 105, 5);

      await coordinator.submitBid({
        taskId,
        agentId: 'agent-1',
        capability: 'research',
        estimatedDuration: 5000,
        estimatedCost: 10,
        confidence: 0.8,
        timestamp: Date.now(),
      });

      await coordinator.submitBid({
        taskId,
        agentId: 'agent-2',
        capability: 'research',
        estimatedDuration: 6000,
        estimatedCost: 10,
        confidence: 0.8,
        timestamp: Date.now(),
      });

      const best = coordinator.selectBestBid(taskId);
      expect(best).not.toBeNull();
      expect(best!.agentId).toBe('agent-2');
    });

    it('should prefer lower cost bids when confidence and reputation are equal', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Test',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'low',
        requesterId: 'r1',
      });

      await coordinator.submitBid({
        taskId,
        agentId: 'a1',
        capability: 'x',
        estimatedDuration: 5000,
        estimatedCost: 100,
        confidence: 0.9,
        timestamp: Date.now(),
      });

      await coordinator.submitBid({
        taskId,
        agentId: 'a2',
        capability: 'x',
        estimatedDuration: 5000,
        estimatedCost: 1,
        confidence: 0.9,
        timestamp: Date.now(),
      });

      const best = coordinator.selectBestBid(taskId);
      expect(best!.agentId).toBe('a2');
    });

    it('should handle single bid correctly', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Solo',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      const bid: TaskBid = {
        taskId,
        agentId: 'only-bidder',
        capability: 'x',
        estimatedDuration: 1000,
        estimatedCost: 5,
        confidence: 0.7,
        timestamp: Date.now(),
      };
      await coordinator.submitBid(bid);

      const best = coordinator.selectBestBid(taskId);
      expect(best!.agentId).toBe('only-bidder');
    });

    it('should handle zero confidence bids', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Zero conf',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'low',
        requesterId: 'r1',
      });

      await coordinator.submitBid({
        taskId,
        agentId: 'a1',
        capability: 'x',
        estimatedDuration: 5000,
        estimatedCost: 10,
        confidence: 0,
        timestamp: Date.now(),
      });

      const best = coordinator.selectBestBid(taskId);
      expect(best).not.toBeNull();
      expect(best!.confidence).toBe(0);
    });

    it('should handle zero cost bids without division by zero', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Free',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'low',
        requesterId: 'r1',
      });

      await coordinator.submitBid({
        taskId,
        agentId: 'a1',
        capability: 'x',
        estimatedDuration: 5000,
        estimatedCost: 0,
        confidence: 0.9,
        timestamp: Date.now(),
      });

      const best = coordinator.selectBestBid(taskId);
      expect(best).not.toBeNull();
    });
  });

  describe('Task Lifecycle Events', () => {
    it('should emit task:submitted on submitTask', async () => {
      const handler = jest.fn();
      coordinator.on('task:submitted', handler);

      await coordinator.submitTask({
        description: 'Event test',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].description).toBe('Event test');
    });

    it('should emit task:bid on submitBid', async () => {
      const handler = jest.fn();
      coordinator.on('task:bid', handler);

      const taskId = await coordinator.submitTask({
        description: 'Bid event',
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
        confidence: 0.9,
        timestamp: Date.now(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should emit task:assigned on assignTask', async () => {
      const handler = jest.fn();
      coordinator.on('task:assigned', handler);

      const taskId = await coordinator.submitTask({
        description: 'Assign event',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'high',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'a1', 'x');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should emit task:completed when all assignments finish', async () => {
      const handler = jest.fn();
      coordinator.on('task:completed', handler);

      const taskId = await coordinator.submitTask({
        description: 'Complete event',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'a1', 'x');
      await coordinator.completeTask(taskId, 'a1', { data: 'done' });

      expect(handler).toHaveBeenCalledTimes(1);
      const result = handler.mock.calls[0][0];
      expect(result.status).toBe('success');
    });

    it('should emit task:failed on failTask', async () => {
      const handler = jest.fn();
      coordinator.on('task:failed', handler);

      const taskId = await coordinator.submitTask({
        description: 'Fail event',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'critical',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'a1', 'x');
      await coordinator.failTask(taskId, 'a1', 'Something broke');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].error).toBe('Something broke');
    });
  });

  describe('Task Completion Status', () => {
    it('should mark result as partial when some assignments fail', async () => {
      const handler = jest.fn();
      coordinator.on('task:completed', handler);

      const taskId = await coordinator.submitTask({
        description: 'Mixed results',
        requiredCapabilities: ['x', 'y'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'a1', 'x');
      await coordinator.assignTask(taskId, 'a2', 'y');

      await coordinator.completeTask(taskId, 'a1', { data: 'ok' });
      await coordinator.failTask(taskId, 'a2', 'error');

      expect(handler).toHaveBeenCalled();
      const result = handler.mock.calls[0][0];
      expect(result.status).toBe('partial');
    });

    it('should aggregate outputs from multiple assignments', async () => {
      const handler = jest.fn();
      coordinator.on('task:completed', handler);

      const taskId = await coordinator.submitTask({
        description: 'Multi output',
        requiredCapabilities: ['x', 'y'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'a1', 'x');
      await coordinator.assignTask(taskId, 'a2', 'y');

      await coordinator.completeTask(taskId, 'a1', { result: 'from_x' });
      await coordinator.completeTask(taskId, 'a2', { result: 'from_y' });

      const taskResult = handler.mock.calls[0][0];
      expect(taskResult.outputs.x).toEqual({ result: 'from_x' });
      expect(taskResult.outputs.y).toEqual({ result: 'from_y' });
    });

    it('should calculate total cost from assignments', async () => {
      const handler = jest.fn();
      coordinator.on('task:completed', handler);

      const taskId = await coordinator.submitTask({
        description: 'Cost calc',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'low',
        requesterId: 'r1',
      });

      const assignment = await coordinator.assignTask(taskId, 'a1', 'x');
      assignment.cost = 15;
      await coordinator.completeTask(taskId, 'a1', {});

      const result = handler.mock.calls[0][0];
      expect(result.totalCost).toBe(15);
    });

    it('should compute duration based on task creation time', async () => {
      const handler = jest.fn();
      coordinator.on('task:completed', handler);

      const taskId = await coordinator.submitTask({
        description: 'Duration test',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'a1', 'x');
      await coordinator.completeTask(taskId, 'a1', {});

      const result = handler.mock.calls[0][0];
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('should throw on submitTask when not initialized', async () => {
      const freshCoordinator = new TaskCoordinator(mockClient, registry);
      await expect(
        freshCoordinator.submitTask({
          description: 'x',
          requiredCapabilities: [],
          payload: {},
          priority: 'low',
          requesterId: 'r1',
        })
      ).rejects.toThrow('Coordinator not initialized');
    });

    it('should throw on submitBid when not initialized', async () => {
      const freshCoordinator = new TaskCoordinator(mockClient, registry);
      await expect(
        freshCoordinator.submitBid({
          taskId: 't1',
          agentId: 'a1',
          capability: 'x',
          estimatedDuration: 1000,
          estimatedCost: 5,
          confidence: 0.9,
          timestamp: Date.now(),
        })
      ).rejects.toThrow('Coordinator not initialized');
    });

    it('should throw on assignTask when not initialized', async () => {
      const freshCoordinator = new TaskCoordinator(mockClient, registry);
      await expect(
        freshCoordinator.assignTask('t1', 'a1', 'x')
      ).rejects.toThrow('Coordinator not initialized');
    });

    it('should throw on completeTask when not initialized', async () => {
      const freshCoordinator = new TaskCoordinator(mockClient, registry);
      await expect(
        freshCoordinator.completeTask('t1', 'a1', {})
      ).rejects.toThrow('Coordinator not initialized');
    });

    it('should throw on failTask when not initialized', async () => {
      const freshCoordinator = new TaskCoordinator(mockClient, registry);
      await expect(
        freshCoordinator.failTask('t1', 'a1', 'err')
      ).rejects.toThrow('Coordinator not initialized');
    });

    it('should throw on autoAssignTask for non-existent task', async () => {
      await expect(
        coordinator.autoAssignTask('non-existent')
      ).rejects.toThrow('Task non-existent not found');
    });

    it('should throw on getCoordinationTopicId when not initialized', () => {
      const freshCoordinator = new TaskCoordinator(mockClient, registry);
      expect(() => freshCoordinator.getCoordinationTopicId()).toThrow('Coordinator not initialized');
    });
  });

  describe('Auto Assignment', () => {
    it('should assign agents matching required capabilities', async () => {
      await registry.registerAgent(createTestProfile({
        id: 'research-agent',
        status: 'active',
        capabilities: [
          { name: 'web_research', description: 'Research', inputSchema: {}, outputSchema: {} },
        ],
      }));

      const taskId = await coordinator.submitTask({
        description: 'Auto assign test',
        requiredCapabilities: ['web_research'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      const assignments = await coordinator.autoAssignTask(taskId);
      expect(assignments).toHaveLength(1);
      expect(assignments[0].agentId).toBe('research-agent');
      expect(assignments[0].capability).toBe('web_research');
    });

    it('should skip capabilities with no matching agents', async () => {
      const taskId = await coordinator.submitTask({
        description: 'No match',
        requiredCapabilities: ['nonexistent_capability'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      const assignments = await coordinator.autoAssignTask(taskId);
      expect(assignments).toHaveLength(0);
    });

    it('should handle multiple required capabilities', async () => {
      await registry.registerAgent(createTestProfile({
        id: 'research-agent',
        status: 'active',
        capabilities: [
          { name: 'web_research', description: 'Research', inputSchema: {}, outputSchema: {} },
        ],
      }));
      await registry.registerAgent(createTestProfile({
        id: 'analysis-agent',
        status: 'active',
        capabilities: [
          { name: 'data_analysis', description: 'Analysis', inputSchema: {}, outputSchema: {} },
        ],
      }));

      const taskId = await coordinator.submitTask({
        description: 'Multi-cap',
        requiredCapabilities: ['web_research', 'data_analysis'],
        payload: {},
        priority: 'high',
        requesterId: 'r1',
      });

      const assignments = await coordinator.autoAssignTask(taskId);
      expect(assignments).toHaveLength(2);
    });

    it('should only assign active agents', async () => {
      await registry.registerAgent(createTestProfile({
        id: 'inactive-agent',
        status: 'inactive',
        capabilities: [
          { name: 'web_research', description: 'Research', inputSchema: {}, outputSchema: {} },
        ],
      }));

      const taskId = await coordinator.submitTask({
        description: 'Active only',
        requiredCapabilities: ['web_research'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      const assignments = await coordinator.autoAssignTask(taskId);
      expect(assignments).toHaveLength(0);
    });
  });

  describe('Task Retrieval', () => {
    it('should retrieve task by ID', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Retrievable',
        requiredCapabilities: ['x'],
        payload: { key: 'value' },
        priority: 'high',
        requesterId: 'r1',
      });

      const task = coordinator.getTask(taskId);
      expect(task).toBeDefined();
      expect(task!.description).toBe('Retrievable');
      expect(task!.priority).toBe('high');
    });

    it('should return undefined for non-existent task', () => {
      expect(coordinator.getTask('nope')).toBeUndefined();
    });

    it('should get task assignments', async () => {
      const taskId = await coordinator.submitTask({
        description: 'With assignments',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'a1', 'x');
      const assignments = coordinator.getTaskAssignments(taskId);
      expect(assignments).toHaveLength(1);
    });

    it('should return empty array for task with no assignments', () => {
      expect(coordinator.getTaskAssignments('no-task')).toEqual([]);
    });

    it('should get task bids', async () => {
      const taskId = await coordinator.submitTask({
        description: 'With bids',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      await coordinator.submitBid({
        taskId,
        agentId: 'a1',
        capability: 'x',
        estimatedDuration: 1000,
        estimatedCost: 5,
        confidence: 0.9,
        timestamp: Date.now(),
      });

      expect(coordinator.getTaskBids(taskId)).toHaveLength(1);
    });

    it('should return empty array for task with no bids', () => {
      expect(coordinator.getTaskBids('no-bids')).toEqual([]);
    });

    it('should get all tasks', async () => {
      await coordinator.submitTask({
        description: 'Task 1',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'low',
        requesterId: 'r1',
      });
      await coordinator.submitTask({
        description: 'Task 2',
        requiredCapabilities: ['y'],
        payload: {},
        priority: 'high',
        requesterId: 'r1',
      });

      expect(coordinator.getAllTasks()).toHaveLength(2);
    });

    it('should get correct task count', async () => {
      expect(coordinator.getTaskCount()).toBe(0);

      await coordinator.submitTask({
        description: 'Count test',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      expect(coordinator.getTaskCount()).toBe(1);
    });

    it('should get task result after completion', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Result test',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'a1', 'x');
      await coordinator.completeTask(taskId, 'a1', { result: 'done' });

      const result = coordinator.getTaskResult(taskId);
      expect(result).toBeDefined();
      expect(result!.status).toBe('success');
    });

    it('should return undefined for task result before completion', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Not done',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'a1', 'x');
      expect(coordinator.getTaskResult(taskId)).toBeUndefined();
    });
  });

  describe('Reputation Integration', () => {
    it('should record success in reputation on task completion', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Rep test',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'a1', 'x');
      await coordinator.completeTask(taskId, 'a1', {});

      const score = coordinator.reputation.getScore('a1');
      expect(score.taskCount).toBe(1);
      expect(score.successRate).toBeGreaterThan(0);
    });

    it('should record failure in reputation on task failure', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Fail rep',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'a1', 'x');
      await coordinator.failTask(taskId, 'a1', 'error');

      const score = coordinator.reputation.getScore('a1');
      expect(score.taskCount).toBe(1);
      expect(score.successRate).toBe(0);
    });

    it('should accumulate reputation across multiple tasks', async () => {
      for (let i = 0; i < 5; i++) {
        const taskId = await coordinator.submitTask({
          description: `Task ${i}`,
          requiredCapabilities: ['x'],
          payload: {},
          priority: 'medium',
          requesterId: 'r1',
        });
        await coordinator.assignTask(taskId, 'persistent-agent', 'x');
        await coordinator.completeTask(taskId, 'persistent-agent', { i });
      }

      const score = coordinator.reputation.getScore('persistent-agent');
      expect(score.taskCount).toBe(5);
      expect(score.successRate).toBe(1);
    });
  });

  describe('Priority Handling', () => {
    it('should accept all priority levels', async () => {
      const priorities: Array<'low' | 'medium' | 'high' | 'critical'> = [
        'low', 'medium', 'high', 'critical',
      ];

      for (const priority of priorities) {
        const taskId = await coordinator.submitTask({
          description: `Priority: ${priority}`,
          requiredCapabilities: ['x'],
          payload: {},
          priority,
          requesterId: 'r1',
        });
        const task = coordinator.getTask(taskId);
        expect(task!.priority).toBe(priority);
      }
    });

    it('should preserve task payload through lifecycle', async () => {
      const payload = {
        data: [1, 2, 3],
        nested: { key: 'value' },
        flag: true,
      };

      const taskId = await coordinator.submitTask({
        description: 'Payload test',
        requiredCapabilities: ['x'],
        payload,
        priority: 'medium',
        requesterId: 'r1',
      });

      const task = coordinator.getTask(taskId);
      expect(task!.payload).toEqual(payload);
    });
  });

  describe('Coordination Message Handling', () => {
    it('should handle TASK_REQUEST messages via subscription', async () => {
      let subscriptionCallback: any;
      mockClient.subscribeTopic = jest.fn().mockImplementation((_topicId, cb) => {
        subscriptionCallback = cb;
      });

      const freshCoord = new TaskCoordinator(mockClient, registry);
      await freshCoord.initialize('0.0.700');

      const handler = jest.fn();
      freshCoord.on('task:received', handler);

      const taskMsg = {
        type: MessageType.TASK_REQUEST,
        senderId: 'sender-1',
        taskId: 'external-task-1',
        payload: {
          task: {
            id: 'external-task-1',
            description: 'External task',
            requiredCapabilities: ['x'],
            payload: {},
            priority: 'medium',
            requesterId: 'sender-1',
            createdAt: Date.now(),
          },
        },
        timestamp: Date.now(),
      };

      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(taskMsg)),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(freshCoord.getTask('external-task-1')).toBeDefined();
    });

    it('should handle TASK_BID messages via subscription', async () => {
      let subscriptionCallback: any;
      mockClient.subscribeTopic = jest.fn().mockImplementation((_topicId, cb) => {
        subscriptionCallback = cb;
      });

      const freshCoord = new TaskCoordinator(mockClient, registry);
      await freshCoord.initialize('0.0.700');

      const handler = jest.fn();
      freshCoord.on('task:bidReceived', handler);

      const bidMsg = {
        type: MessageType.TASK_BID,
        senderId: 'bidder-1',
        taskId: 'task-1',
        payload: {
          bid: {
            taskId: 'task-1',
            agentId: 'bidder-1',
            capability: 'x',
            estimatedDuration: 5000,
            estimatedCost: 10,
            confidence: 0.85,
            timestamp: Date.now(),
          },
        },
        timestamp: Date.now(),
      };

      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(bidMsg)),
        sequenceNumber: 2,
        consensusTimestamp: null,
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should ignore malformed messages', async () => {
      let subscriptionCallback: any;
      mockClient.subscribeTopic = jest.fn().mockImplementation((_topicId, cb) => {
        subscriptionCallback = cb;
      });

      const freshCoord = new TaskCoordinator(mockClient, registry);
      await freshCoord.initialize('0.0.700');

      // Should not throw
      subscriptionCallback({
        contents: Buffer.from('not valid json'),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      expect(freshCoord.getTaskCount()).toBe(0);
    });

    it('should ignore empty buffer messages', async () => {
      let subscriptionCallback: any;
      mockClient.subscribeTopic = jest.fn().mockImplementation((_topicId, cb) => {
        subscriptionCallback = cb;
      });

      const freshCoord = new TaskCoordinator(mockClient, registry);
      await freshCoord.initialize('0.0.700');

      subscriptionCallback({
        contents: Buffer.from(''),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      expect(freshCoord.getTaskCount()).toBe(0);
    });
  });

  describe('Concurrent Bidding', () => {
    it('should handle many bids on the same task', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Many bids',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'high',
        requesterId: 'r1',
      });

      for (let i = 0; i < 20; i++) {
        await coordinator.submitBid({
          taskId,
          agentId: `agent-${i}`,
          capability: 'x',
          estimatedDuration: 1000 + i * 100,
          estimatedCost: 5 + i,
          confidence: Math.min(0.5 + i * 0.02, 1),
          timestamp: Date.now(),
        });
      }

      expect(coordinator.getTaskBids(taskId)).toHaveLength(20);
      const best = coordinator.selectBestBid(taskId);
      expect(best).not.toBeNull();
    });

    it('should handle bids for non-tracked task gracefully', async () => {
      // Bid for a task that coordinator doesn't know about
      await coordinator.submitBid({
        taskId: 'unknown-task',
        agentId: 'a1',
        capability: 'x',
        estimatedDuration: 1000,
        estimatedCost: 5,
        confidence: 0.9,
        timestamp: Date.now(),
      });

      // Should not crash, bids not tracked
      expect(coordinator.getTaskBids('unknown-task')).toEqual([]);
    });
  });

  describe('Multiple Assignment Completion', () => {
    it('should not emit task:completed until all assignments are done', async () => {
      const handler = jest.fn();
      coordinator.on('task:completed', handler);

      const taskId = await coordinator.submitTask({
        description: 'Multi-assign',
        requiredCapabilities: ['x', 'y', 'z'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, 'a1', 'x');
      await coordinator.assignTask(taskId, 'a2', 'y');
      await coordinator.assignTask(taskId, 'a3', 'z');

      await coordinator.completeTask(taskId, 'a1', {});
      expect(handler).not.toHaveBeenCalled();

      await coordinator.completeTask(taskId, 'a2', {});
      expect(handler).not.toHaveBeenCalled();

      await coordinator.completeTask(taskId, 'a3', {});
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle completing task for non-existent assignment', async () => {
      const taskId = await coordinator.submitTask({
        description: 'No assign',
        requiredCapabilities: ['x'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      // Complete without any assignment - should not throw
      await coordinator.completeTask(taskId, 'unknown-agent', {});
    });
  });
});
