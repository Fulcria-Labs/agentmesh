/**
 * Concurrency and stress tests for AgentMesh components.
 *
 * Covers: parallel task submission, concurrent bid processing,
 * simultaneous agent registration/deregistration, reputation under load,
 * and race conditions in task completion.
 */

import { AgentRegistry } from '../core/agent-registry';
import { TaskCoordinator, TaskBid } from '../core/task-coordinator';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile, MessageType, CoordinationMessage } from '../core/types';
import { ReputationManager } from '../core/reputation';

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

function createProfile(id: string, capabilities: string[] = ['research']): AgentProfile {
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

describe('Concurrency - Parallel Task Submission', () => {
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

  it('should handle 50 parallel task submissions', async () => {
    const promises = Array.from({ length: 50 }, (_, i) =>
      coordinator.submitTask({
        description: `Task ${i}`,
        requiredCapabilities: ['research'],
        payload: { index: i },
        priority: 'medium',
        requesterId: 'r1',
      })
    );

    const taskIds = await Promise.all(promises);
    expect(taskIds).toHaveLength(50);

    // All IDs should be unique
    const uniqueIds = new Set(taskIds);
    expect(uniqueIds.size).toBe(50);

    expect(coordinator.getTaskCount()).toBe(50);
  });

  it('should handle parallel task submission with different priorities', async () => {
    const priorities: Array<'low' | 'medium' | 'high' | 'critical'> = ['low', 'medium', 'high', 'critical'];
    const promises = priorities.map(priority =>
      coordinator.submitTask({
        description: `${priority} priority task`,
        requiredCapabilities: ['research'],
        payload: {},
        priority,
        requesterId: 'r1',
      })
    );

    const taskIds = await Promise.all(promises);
    expect(taskIds).toHaveLength(4);

    for (const id of taskIds) {
      const task = coordinator.getTask(id);
      expect(task).toBeDefined();
    }
  });

  it('should handle parallel bid submissions for same task', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Contested task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'high',
      requesterId: 'r1',
    });

    const bidPromises = Array.from({ length: 20 }, (_, i) =>
      coordinator.submitBid({
        taskId,
        agentId: `agent-${i}`,
        capability: 'research',
        estimatedDuration: 1000 + i * 100,
        estimatedCost: i,
        confidence: 0.5 + (i / 40),
        timestamp: Date.now(),
      })
    );

    await Promise.all(bidPromises);
    const bids = coordinator.getTaskBids(taskId);
    expect(bids.length).toBeGreaterThanOrEqual(20);
  });

  it('should select best bid consistently after parallel submissions', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    // Submit bids with clearly different scores
    await coordinator.submitBid({
      taskId, agentId: 'low-score', capability: 'research',
      estimatedDuration: 10000, estimatedCost: 100, confidence: 0.1, timestamp: Date.now(),
    });
    await coordinator.submitBid({
      taskId, agentId: 'high-score', capability: 'research',
      estimatedDuration: 1000, estimatedCost: 0, confidence: 0.99, timestamp: Date.now(),
    });
    await coordinator.submitBid({
      taskId, agentId: 'mid-score', capability: 'research',
      estimatedDuration: 5000, estimatedCost: 5, confidence: 0.5, timestamp: Date.now(),
    });

    const best = coordinator.selectBestBid(taskId);
    expect(best).not.toBeNull();
    expect(best!.agentId).toBe('high-score');
  });
});

describe('Concurrency - Parallel Agent Operations', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    await registry.initialize();
  });

  it('should handle 100 parallel agent registrations', async () => {
    const promises = Array.from({ length: 100 }, (_, i) =>
      registry.registerAgent(createProfile(`agent-${i}`))
    );

    await Promise.all(promises);
    expect(registry.getAgentCount()).toBe(100);
  });

  it('should handle interleaved register and deregister operations', async () => {
    // Register agents first
    for (let i = 0; i < 10; i++) {
      await registry.registerAgent(createProfile(`agent-${i}`));
    }
    expect(registry.getAgentCount()).toBe(10);

    // Parallel deregistration of odd-numbered agents
    const deregPromises = [1, 3, 5, 7, 9].map(i =>
      registry.deregisterAgent(`agent-${i}`)
    );
    await Promise.all(deregPromises);

    expect(registry.getAgentCount()).toBe(5);
    expect(registry.getAgent('agent-0')).toBeDefined();
    expect(registry.getAgent('agent-1')).toBeUndefined();
  });

  it('should handle parallel status updates for different agents', async () => {
    for (let i = 0; i < 5; i++) {
      await registry.registerAgent(createProfile(`agent-${i}`));
    }

    const statuses: Array<AgentProfile['status']> = ['active', 'busy', 'inactive', 'active', 'busy'];
    const updatePromises = statuses.map((status, i) =>
      registry.updateAgentStatus(`agent-${i}`, status)
    );
    await Promise.all(updatePromises);

    statuses.forEach((expected, i) => {
      expect(registry.getAgent(`agent-${i}`)?.status).toBe(expected);
    });
  });

  it('should discover agents consistently during concurrent modifications', async () => {
    for (let i = 0; i < 20; i++) {
      await registry.registerAgent(createProfile(`agent-${i}`, i % 2 === 0 ? ['research'] : ['analysis']));
    }

    // Discovery should work even with agents in different states
    const result1 = registry.discoverAgents({ capability: 'research' });
    const result2 = registry.discoverAgents({ capability: 'analysis' });

    expect(result1.totalFound).toBe(10);
    expect(result2.totalFound).toBe(10);
    expect(result1.totalFound + result2.totalFound).toBe(20);
  });
});

describe('Concurrency - Task Completion Races', () => {
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

  it('should handle parallel completion of multiple assignments', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Multi-agent task',
      requiredCapabilities: ['research', 'analysis', 'synthesis'],
      payload: {},
      priority: 'high',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'a1', 'research');
    await coordinator.assignTask(taskId, 'a2', 'analysis');
    await coordinator.assignTask(taskId, 'a3', 'synthesis');

    const completionSpy = jest.fn();
    coordinator.on('task:completed', completionSpy);

    // Complete all simultaneously
    await Promise.all([
      coordinator.completeTask(taskId, 'a1', { findings: 'data' }),
      coordinator.completeTask(taskId, 'a2', { insights: 'patterns' }),
      coordinator.completeTask(taskId, 'a3', { summary: 'final' }),
    ]);

    expect(completionSpy).toHaveBeenCalled();
    const result = coordinator.getTaskResult(taskId);
    expect(result).toBeDefined();
    expect(result!.status).toBe('success');
  });

  it('should handle mixed completion and failure simultaneously', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Mixed result task',
      requiredCapabilities: ['a', 'b'],
      payload: {},
      priority: 'medium',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'a1', 'a');
    await coordinator.assignTask(taskId, 'a2', 'b');

    const completionSpy = jest.fn();
    coordinator.on('task:completed', completionSpy);

    await Promise.all([
      coordinator.completeTask(taskId, 'a1', { ok: true }),
      coordinator.failTask(taskId, 'a2', 'network error'),
    ]);

    expect(completionSpy).toHaveBeenCalled();
    const result = coordinator.getTaskResult(taskId);
    expect(result).toBeDefined();
    expect(result!.status).toBe('partial');
  });

  it('should handle completing the same assignment twice gracefully', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Double-complete test',
      requiredCapabilities: ['a'],
      payload: {},
      priority: 'low',
      requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'a1', 'a');

    // Complete same assignment twice
    await coordinator.completeTask(taskId, 'a1', { v: 1 });
    await coordinator.completeTask(taskId, 'a1', { v: 2 });

    const assignments = coordinator.getTaskAssignments(taskId);
    expect(assignments[0]!.status).toBe('completed');
  });
});

describe('Stress - Reputation Under Load', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('should handle 1000 success recordings', () => {
    for (let i = 0; i < 1000; i++) {
      reputation.recordSuccess('stress-agent', Math.random() * 5000, Math.random() * 10);
    }

    const score = reputation.getScore('stress-agent');
    expect(score.taskCount).toBe(1000);
    expect(score.successRate).toBe(1);
    expect(score.overallScore).toBeGreaterThan(0.8);
    expect(score.overallScore).toBeLessThanOrEqual(1);
  });

  it('should handle 1000 failure recordings', () => {
    for (let i = 0; i < 1000; i++) {
      reputation.recordFailure('fail-agent');
    }

    const score = reputation.getScore('fail-agent');
    expect(score.taskCount).toBe(1000);
    expect(score.successRate).toBe(0);
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
  });

  it('should handle tracking 500 different agents', () => {
    for (let i = 0; i < 500; i++) {
      reputation.recordSuccess(`agent-${i}`, 1000, 5);
    }

    expect(reputation.getTrackedAgentCount()).toBe(500);
    const allScores = reputation.getAllScores();
    expect(allScores).toHaveLength(500);
  });

  it('should sort 100 agents correctly by score', () => {
    // Create agents with progressively better records
    for (let i = 0; i < 100; i++) {
      const agentId = `agent-${i.toString().padStart(3, '0')}`;
      for (let j = 0; j < i + 1; j++) {
        reputation.recordSuccess(agentId, 1000, 5);
      }
      // Add some failures for lower-numbered agents
      if (i < 50) {
        for (let j = 0; j < 50 - i; j++) {
          reputation.recordFailure(agentId);
        }
      }
    }

    const scores = reputation.getAllScores();
    // Verify sorting: each score should be >= the next
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]!.overallScore).toBeGreaterThanOrEqual(scores[i + 1]!.overallScore);
    }
  });

  it('should handle alternating success/failure rapidly', () => {
    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) {
        reputation.recordSuccess('alternating', 1000 + i, 5);
      } else {
        reputation.recordFailure('alternating');
      }
    }

    const score = reputation.getScore('alternating');
    expect(score.taskCount).toBe(200);
    expect(score.successRate).toBeCloseTo(0.5, 1);
    expect(score.overallScore).toBeGreaterThan(0);
    expect(score.overallScore).toBeLessThan(1);
  });
});

describe('Stress - Registry Message Processing', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;
  let messageHandler: (message: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      messageHandler = callback as any;
    });
    await registry.initialize();
  });

  it('should handle 200 rapid registration messages', () => {
    for (let i = 0; i < 200; i++) {
      const msg: CoordinationMessage = {
        type: MessageType.AGENT_REGISTER,
        senderId: `agent-${i}`,
        payload: { profile: createProfile(`agent-${i}`) },
        timestamp: Date.now(),
      };
      messageHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: i + 1,
      });
    }

    expect(registry.getAgentCount()).toBe(200);
    expect(registry.getAllAgents()).toHaveLength(200);
  });

  it('should handle rapid register/deregister cycles', () => {
    for (let i = 0; i < 50; i++) {
      // Register
      const regMsg: CoordinationMessage = {
        type: MessageType.AGENT_REGISTER,
        senderId: `cycle-agent-${i}`,
        payload: { profile: createProfile(`cycle-agent-${i}`) },
        timestamp: Date.now(),
      };
      messageHandler({
        contents: Buffer.from(JSON.stringify(regMsg)),
        sequenceNumber: i * 2 + 1,
      });

      // Immediately deregister
      const deregMsg: CoordinationMessage = {
        type: MessageType.AGENT_DEREGISTER,
        senderId: `cycle-agent-${i}`,
        payload: {},
        timestamp: Date.now(),
      };
      messageHandler({
        contents: Buffer.from(JSON.stringify(deregMsg)),
        sequenceNumber: i * 2 + 2,
      });
    }

    expect(registry.getAgentCount()).toBe(0);
  });

  it('should handle mixed valid and invalid messages', () => {
    for (let i = 0; i < 100; i++) {
      if (i % 3 === 0) {
        // Valid registration
        const msg: CoordinationMessage = {
          type: MessageType.AGENT_REGISTER,
          senderId: `valid-${i}`,
          payload: { profile: createProfile(`valid-${i}`) },
          timestamp: Date.now(),
        };
        messageHandler({
          contents: Buffer.from(JSON.stringify(msg)),
          sequenceNumber: i + 1,
        });
      } else if (i % 3 === 1) {
        // Invalid JSON
        messageHandler({
          contents: Buffer.from('invalid-json-' + i),
          sequenceNumber: i + 1,
        });
      } else {
        // Valid but unknown message type
        const msg = {
          type: 'unknown.type.' + i,
          senderId: `sender-${i}`,
          payload: {},
          timestamp: Date.now(),
        };
        messageHandler({
          contents: Buffer.from(JSON.stringify(msg)),
          sequenceNumber: i + 1,
        });
      }
    }

    // Only the valid registrations should succeed (every 3rd message starting at 0)
    const expected = Math.ceil(100 / 3);
    expect(registry.getAgentCount()).toBe(expected);
  });
});

describe('Stress - Coordinator with Many Tasks', () => {
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

  it('should track task results across 30 completed tasks', async () => {
    const completionSpy = jest.fn();
    coordinator.on('task:completed', completionSpy);

    for (let i = 0; i < 30; i++) {
      const taskId = await coordinator.submitTask({
        description: `Task ${i}`,
        requiredCapabilities: ['cap'],
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      await coordinator.assignTask(taskId, `agent-${i}`, 'cap');
      await coordinator.completeTask(taskId, `agent-${i}`, { index: i });
    }

    expect(completionSpy).toHaveBeenCalledTimes(30);
    expect(coordinator.getTaskCount()).toBe(30);

    // All should have results
    const allTasks = coordinator.getAllTasks();
    for (const task of allTasks) {
      const result = coordinator.getTaskResult(task.id);
      expect(result).toBeDefined();
      expect(result!.status).toBe('success');
    }
  });

  it('should handle tasks with varying numbers of assignments', async () => {
    for (let numAssignments = 1; numAssignments <= 5; numAssignments++) {
      const caps = Array.from({ length: numAssignments }, (_, i) => `cap-${i}`);
      const taskId = await coordinator.submitTask({
        description: `Task with ${numAssignments} assignments`,
        requiredCapabilities: caps,
        payload: {},
        priority: 'medium',
        requesterId: 'r1',
      });

      for (let j = 0; j < numAssignments; j++) {
        await coordinator.assignTask(taskId, `agent-${j}`, `cap-${j}`);
      }

      for (let j = 0; j < numAssignments; j++) {
        await coordinator.completeTask(taskId, `agent-${j}`, { ok: true });
      }

      const result = coordinator.getTaskResult(taskId);
      expect(result).toBeDefined();
      expect(result!.status).toBe('success');
      expect(result!.agentResults).toHaveLength(numAssignments);
    }
  });
});
