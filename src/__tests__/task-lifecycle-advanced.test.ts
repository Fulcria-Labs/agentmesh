import { TaskCoordinator, TaskBid } from '../core/task-coordinator';
import { AgentRegistry } from '../core/agent-registry';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile } from '../core/types';

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
    status: 'active' as const,
    createdAt: Date.now(),
    metadata: {},
  };
}

function makeBid(
  taskId: string,
  agentId: string,
  capability: string,
  confidence: number,
  cost: number,
  duration = 5000,
): TaskBid {
  return {
    taskId,
    agentId,
    capability,
    estimatedDuration: duration,
    estimatedCost: cost,
    confidence,
    timestamp: Date.now(),
  };
}

describe('Task Lifecycle Advanced', () => {
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

  // =====================================================================
  // 1. Multi-bid competition (5 tests)
  // =====================================================================
  describe('Multi-bid competition', () => {
    let taskId: string;

    beforeEach(async () => {
      await coordinator.initialize();
      taskId = await coordinator.submitTask({
        description: 'Competitive task',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'medium',
        requesterId: 'requester-1',
      });
    });

    it('should select the bid with the highest reputation-adjusted score from multiple bids', async () => {
      // All agents are new (0.5 reputation), so score = confidence / (cost+1) * (0.5 + 0.5)
      // Agent A: 0.7 / (10+1) * 1.0 = 0.0636
      // Agent B: 0.95 / (2+1) * 1.0 = 0.3167 (best)
      // Agent C: 0.8 / (5+1) * 1.0 = 0.1333
      await coordinator.submitBid(makeBid(taskId, 'agentA', 'research', 0.7, 10));
      await coordinator.submitBid(makeBid(taskId, 'agentB', 'research', 0.95, 2));
      await coordinator.submitBid(makeBid(taskId, 'agentC', 'research', 0.8, 5));

      const best = coordinator.selectBestBid(taskId);
      expect(best).toBeDefined();
      expect(best!.agentId).toBe('agentB');
    });

    it('should favor experienced agent over higher-confidence newcomer via reputation adjustment', async () => {
      // Give agentVet a strong reputation: 10 successes with consistent times
      for (let i = 0; i < 10; i++) {
        coordinator.reputation.recordSuccess('agentVet', 1000, 2);
      }
      // agentVet score: successRate=1.0, reliability~1.0, experience=10/20=0.5
      // overall ~ 0.5*1.0 + 0.3*1.0 + 0.2*0.5 = 0.9
      // multiplier = 0.5 + 0.9 = 1.4
      // bid score = 0.7 / (3+1) * 1.4 = 0.245

      // agentNew is a newcomer with 0.5 overall -> multiplier = 1.0
      // bid score = 0.9 / (3+1) * 1.0 = 0.225

      await coordinator.submitBid(makeBid(taskId, 'agentVet', 'research', 0.7, 3));
      await coordinator.submitBid(makeBid(taskId, 'agentNew', 'research', 0.9, 3));

      const best = coordinator.selectBestBid(taskId);
      expect(best).toBeDefined();
      expect(best!.agentId).toBe('agentVet');
    });

    it('should pick highest confidence when all bids have zero cost', async () => {
      // With zero cost: score = confidence / (0+1) * multiplier
      // All new agents -> multiplier = 1.0
      // Highest confidence wins
      await coordinator.submitBid(makeBid(taskId, 'a1', 'research', 0.6, 0));
      await coordinator.submitBid(makeBid(taskId, 'a2', 'research', 0.95, 0));
      await coordinator.submitBid(makeBid(taskId, 'a3', 'research', 0.8, 0));

      const best = coordinator.selectBestBid(taskId);
      expect(best).toBeDefined();
      expect(best!.agentId).toBe('a2');
    });

    it('should pick lowest cost when all bids have equal confidence', async () => {
      // Equal confidence: score = 0.8 / (cost+1) * 1.0
      // Lowest cost gives highest score
      await coordinator.submitBid(makeBid(taskId, 'a1', 'research', 0.8, 10));
      await coordinator.submitBid(makeBid(taskId, 'a2', 'research', 0.8, 1));
      await coordinator.submitBid(makeBid(taskId, 'a3', 'research', 0.8, 5));

      const best = coordinator.selectBestBid(taskId);
      expect(best).toBeDefined();
      expect(best!.agentId).toBe('a2');
    });

    it('should correctly select the best bid from 20 competing bids', async () => {
      // Submit 20 bids with varying costs (1-20) and confidence (0.5)
      for (let i = 1; i <= 20; i++) {
        await coordinator.submitBid(makeBid(taskId, `agent-${i}`, 'research', 0.5, i));
      }
      // Also submit one with very low cost for a clear winner
      await coordinator.submitBid(makeBid(taskId, 'agent-champion', 'research', 0.99, 0));

      const bids = coordinator.getTaskBids(taskId);
      expect(bids).toHaveLength(21);

      const best = coordinator.selectBestBid(taskId);
      expect(best).toBeDefined();
      expect(best!.agentId).toBe('agent-champion');
    });
  });

  // =====================================================================
  // 2. Task assignment lifecycle (5 tests)
  // =====================================================================
  describe('Task assignment lifecycle', () => {
    beforeEach(async () => {
      await coordinator.initialize();
    });

    it('should complete full lifecycle: submit -> bid -> assign -> complete -> result available', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Full lifecycle task',
        requiredCapabilities: ['research'],
        payload: { query: 'AI trends' },
        priority: 'high',
        requesterId: 'req-1',
      });

      await coordinator.submitBid(makeBid(taskId, 'worker-1', 'research', 0.9, 5));
      const best = coordinator.selectBestBid(taskId);
      expect(best).toBeDefined();

      await coordinator.assignTask(taskId, best!.agentId, best!.capability);
      await coordinator.completeTask(taskId, best!.agentId, { findings: ['trend-1', 'trend-2'] });

      const result = coordinator.getTaskResult(taskId);
      expect(result).toBeDefined();
      expect(result!.status).toBe('success');
      expect(result!.outputs['research']).toEqual({ findings: ['trend-1', 'trend-2'] });
    });

    it('should mark result as partial when assigned agent fails', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Failing task',
        requiredCapabilities: ['analysis'],
        payload: {},
        priority: 'medium',
        requesterId: 'req-1',
      });

      await coordinator.assignTask(taskId, 'worker-1', 'analysis');
      await coordinator.failTask(taskId, 'worker-1', 'Out of memory');

      const result = coordinator.getTaskResult(taskId);
      expect(result).toBeDefined();
      expect(result!.status).toBe('partial');
    });

    it('should mark as success when multiple capabilities all complete', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Multi-cap task',
        requiredCapabilities: ['research', 'analysis', 'summary'],
        payload: {},
        priority: 'high',
        requesterId: 'req-1',
      });

      await coordinator.assignTask(taskId, 'agent-r', 'research');
      await coordinator.assignTask(taskId, 'agent-a', 'analysis');
      await coordinator.assignTask(taskId, 'agent-s', 'summary');

      await coordinator.completeTask(taskId, 'agent-r', { data: 'raw' });
      await coordinator.completeTask(taskId, 'agent-a', { insight: 'deep' });
      await coordinator.completeTask(taskId, 'agent-s', { text: 'brief' });

      const result = coordinator.getTaskResult(taskId);
      expect(result).toBeDefined();
      expect(result!.status).toBe('success');
      expect(result!.agentResults).toHaveLength(3);
    });

    it('should mark as partial when one agent completes and another fails', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Mixed results task',
        requiredCapabilities: ['research', 'analysis'],
        payload: {},
        priority: 'medium',
        requesterId: 'req-1',
      });

      await coordinator.assignTask(taskId, 'agent-ok', 'research');
      await coordinator.assignTask(taskId, 'agent-bad', 'analysis');

      await coordinator.completeTask(taskId, 'agent-ok', { result: 'good' });
      await coordinator.failTask(taskId, 'agent-bad', 'crashed');

      const result = coordinator.getTaskResult(taskId);
      expect(result).toBeDefined();
      expect(result!.status).toBe('partial');
      expect(result!.outputs['research']).toEqual({ result: 'good' });
      expect(result!.outputs['analysis']).toEqual({ error: 'crashed' });
    });

    it('should return undefined for getTaskResult before task completion', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Incomplete task',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'low',
        requesterId: 'req-1',
      });

      await coordinator.assignTask(taskId, 'worker-1', 'research');
      // Not yet completed

      const result = coordinator.getTaskResult(taskId);
      expect(result).toBeUndefined();
    });
  });

  // =====================================================================
  // 3. Auto-assign scenarios (5 tests)
  // =====================================================================
  describe('Auto-assign scenarios', () => {
    beforeEach(async () => {
      await coordinator.initialize();
    });

    it('should assign all capabilities when matching agents exist', async () => {
      await registry.registerAgent(createTestProfile('r-agent', ['research']));
      await registry.registerAgent(createTestProfile('a-agent', ['analysis']));
      await registry.registerAgent(createTestProfile('s-agent', ['summary']));

      const taskId = await coordinator.submitTask({
        description: 'Full auto-assign',
        requiredCapabilities: ['research', 'analysis', 'summary'],
        payload: {},
        priority: 'high',
        requesterId: 'req-1',
      });

      const assignments = await coordinator.autoAssignTask(taskId);
      expect(assignments).toHaveLength(3);

      const assignedCaps = assignments.map(a => a.capability).sort();
      expect(assignedCaps).toEqual(['analysis', 'research', 'summary']);
    });

    it('should assign only matched capabilities with partial matches', async () => {
      await registry.registerAgent(createTestProfile('r-agent', ['research']));
      // No agent for 'quantum-computing'

      const taskId = await coordinator.submitTask({
        description: 'Partial match task',
        requiredCapabilities: ['research', 'quantum-computing'],
        payload: {},
        priority: 'medium',
        requesterId: 'req-1',
      });

      const assignments = await coordinator.autoAssignTask(taskId);
      expect(assignments).toHaveLength(1);
      expect(assignments[0]!.capability).toBe('research');
    });

    it('should return empty assignments when no agents match', async () => {
      const taskId = await coordinator.submitTask({
        description: 'No match task',
        requiredCapabilities: ['exotic-capability'],
        payload: {},
        priority: 'low',
        requesterId: 'req-1',
      });

      const assignments = await coordinator.autoAssignTask(taskId);
      expect(assignments).toHaveLength(0);
    });

    it('should throw when auto-assigning a nonexistent task', async () => {
      await expect(coordinator.autoAssignTask('does-not-exist'))
        .rejects.toThrow('not found');
    });

    it('should pick the first agent when multiple agents have the same capability', async () => {
      await registry.registerAgent(createTestProfile('first-agent', ['research']));
      await registry.registerAgent(createTestProfile('second-agent', ['research']));

      const taskId = await coordinator.submitTask({
        description: 'Duplicate cap task',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'medium',
        requesterId: 'req-1',
      });

      const assignments = await coordinator.autoAssignTask(taskId);
      expect(assignments).toHaveLength(1);
      expect(assignments[0]!.agentId).toBe('first-agent');
    });
  });

  // =====================================================================
  // 4. Reputation-influenced task allocation (5 tests)
  // =====================================================================
  describe('Reputation-influenced task allocation', () => {
    it('should give a higher bid score to an agent with high success rate', () => {
      // Build a strong reputation: 10 successes, 0 failures
      for (let i = 0; i < 10; i++) {
        coordinator.reputation.recordSuccess('good-agent', 1000, 5);
      }

      const goodScore = coordinator.reputation.getReputationAdjustedBidScore('good-agent', 0.8, 5);
      const newScore = coordinator.reputation.getReputationAdjustedBidScore('new-agent', 0.8, 5);

      // good-agent has higher overall -> higher multiplier -> higher score
      expect(goodScore).toBeGreaterThan(newScore);
    });

    it('should give a reliability bonus to agents with consistent execution times', () => {
      // Consistent agent: always 1000ms
      for (let i = 0; i < 5; i++) {
        coordinator.reputation.recordSuccess('consistent', 1000, 5);
      }
      // Inconsistent agent: wildly varying times
      coordinator.reputation.recordSuccess('inconsistent', 100, 5);
      coordinator.reputation.recordSuccess('inconsistent', 5000, 5);
      coordinator.reputation.recordSuccess('inconsistent', 200, 5);
      coordinator.reputation.recordSuccess('inconsistent', 8000, 5);
      coordinator.reputation.recordSuccess('inconsistent', 50, 5);

      const consistentScore = coordinator.reputation.getScore('consistent');
      const inconsistentScore = coordinator.reputation.getScore('inconsistent');

      expect(consistentScore.reliability).toBeGreaterThan(inconsistentScore.reliability);
    });

    it('should give a neutral 0.5 overall score to a new agent with zero tasks', () => {
      const score = coordinator.reputation.getScore('brand-new-agent');

      expect(score.overallScore).toBe(0.5);
      expect(score.taskCount).toBe(0);
      expect(score.successRate).toBe(0);
      expect(score.reliability).toBe(0.5);
    });

    it('should give full experience bonus (0.2) to an agent with 20+ tasks', () => {
      // 20 successful tasks with consistent timing
      for (let i = 0; i < 20; i++) {
        coordinator.reputation.recordSuccess('veteran', 1000, 5);
      }

      const score = coordinator.reputation.getScore('veteran');
      // successRate=1.0, reliability~1.0, experience=20/20=1.0
      // overall = 0.5*1.0 + 0.3*~1.0 + 0.2*1.0 = ~1.0
      expect(score.taskCount).toBe(20);
      expect(score.overallScore).toBeGreaterThanOrEqual(0.95);
    });

    it('should give near-zero overall score to an agent with all failures', () => {
      for (let i = 0; i < 10; i++) {
        coordinator.reputation.recordFailure('bad-agent');
      }

      const score = coordinator.reputation.getScore('bad-agent');
      // successRate=0, reliability=0.5 (no execution times), experience=10/20=0.5
      // overall = 0.5*0 + 0.3*0.5 + 0.2*0.5 = 0.15 + 0.1 = 0.25
      expect(score.overallScore).toBeLessThan(0.3);
      expect(score.successRate).toBe(0);
      expect(score.taskCount).toBe(10);
    });
  });

  // =====================================================================
  // 5. Task events and notifications (5 tests)
  // =====================================================================
  describe('Task events and notifications', () => {
    beforeEach(async () => {
      await coordinator.initialize();
    });

    it('should fire task:submitted event on submitTask', async () => {
      const spy = jest.fn();
      coordinator.on('task:submitted', spy);

      const taskId = await coordinator.submitTask({
        description: 'Event test',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'medium',
        requesterId: 'req-1',
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].id).toBe(taskId);
    });

    it('should fire task:bid event on submitBid', async () => {
      const spy = jest.fn();
      coordinator.on('task:bid', spy);

      const taskId = await coordinator.submitTask({
        description: 'Bid event test',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'medium',
        requesterId: 'req-1',
      });

      const bid = makeBid(taskId, 'bidder-1', 'research', 0.9, 5);
      await coordinator.submitBid(bid);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].agentId).toBe('bidder-1');
    });

    it('should fire task:assigned event on assignTask', async () => {
      const spy = jest.fn();
      coordinator.on('task:assigned', spy);

      await coordinator.assignTask('task-evt', 'agent-evt', 'research');

      expect(spy).toHaveBeenCalledTimes(1);
      const assignment = spy.mock.calls[0][0];
      expect(assignment.taskId).toBe('task-evt');
      expect(assignment.agentId).toBe('agent-evt');
      expect(assignment.status).toBe('assigned');
    });

    it('should fire task:failed event on failTask', async () => {
      const spy = jest.fn();
      coordinator.on('task:failed', spy);

      await coordinator.failTask('task-f', 'agent-f', 'connection timeout');

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toEqual({
        taskId: 'task-f',
        agentId: 'agent-f',
        error: 'connection timeout',
      });
    });

    it('should fire task:completed event when all assignments finish', async () => {
      const spy = jest.fn();
      coordinator.on('task:completed', spy);

      const taskId = await coordinator.submitTask({
        description: 'Complete event test',
        requiredCapabilities: ['analysis'],
        payload: {},
        priority: 'low',
        requesterId: 'req-1',
      });

      await coordinator.assignTask(taskId, 'worker-c', 'analysis');
      expect(spy).not.toHaveBeenCalled();

      await coordinator.completeTask(taskId, 'worker-c', { done: true });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].taskId).toBe(taskId);
      expect(spy.mock.calls[0][0].status).toBe('success');
    });
  });

  // =====================================================================
  // 6. Edge cases and boundary conditions (5 tests)
  // =====================================================================
  describe('Edge cases and boundary conditions', () => {
    it('should throw on submitTask before coordinator is initialized', async () => {
      const uninit = new TaskCoordinator(mockClient, registry);
      await expect(
        uninit.submitTask({
          description: 'Pre-init task',
          requiredCapabilities: [],
          payload: {},
          priority: 'low',
          requesterId: 'req-1',
        }),
      ).rejects.toThrow('Coordinator not initialized');
    });

    it('should throw on submitBid before coordinator is initialized', async () => {
      const uninit = new TaskCoordinator(mockClient, registry);
      await expect(
        uninit.submitBid(makeBid('task-x', 'agent-x', 'research', 0.9, 5)),
      ).rejects.toThrow('Coordinator not initialized');
    });

    it('should throw on assignTask before coordinator is initialized', async () => {
      const uninit = new TaskCoordinator(mockClient, registry);
      await expect(
        uninit.assignTask('task-x', 'agent-x', 'research'),
      ).rejects.toThrow('Coordinator not initialized');
    });

    it('should handle completeTask gracefully when no prior assignment exists', async () => {
      await coordinator.initialize();

      // Should not throw - just submits the message without finding an assignment
      await expect(
        coordinator.completeTask('phantom-task', 'phantom-agent', { data: 'ok' }),
      ).resolves.not.toThrow();

      // No result since there was no tracked task with assignments
      const result = coordinator.getTaskResult('phantom-task');
      expect(result).toBeUndefined();
    });

    it('should handle failTask gracefully when no prior assignment exists', async () => {
      await coordinator.initialize();

      // Should not throw - records failure in reputation and emits event
      await expect(
        coordinator.failTask('phantom-task', 'phantom-agent', 'no assignment'),
      ).resolves.not.toThrow();

      // Reputation should still record the failure
      const score = coordinator.reputation.getScore('phantom-agent');
      expect(score.taskCount).toBe(1);
      expect(score.successRate).toBe(0);
    });
  });
});
