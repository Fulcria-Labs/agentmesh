/**
 * Reputation system edge cases and integration with TaskCoordinator.
 *
 * Tests: boundary values, zero/negative inputs, reliability calculation edge cases,
 * reputation recording during task complete/fail, bid scoring precision.
 */

import { ReputationManager } from '../core/reputation';
import { TaskCoordinator } from '../core/task-coordinator';
import { AgentRegistry } from '../core/agent-registry';
import { HederaClient } from '../core/hedera-client';

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

describe('Reputation - Boundary Values', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('should handle zero execution time', () => {
    reputation.recordSuccess('agent', 0, 5);
    const score = reputation.getScore('agent');
    expect(score.avgExecutionTime).toBe(0);
    expect(score.taskCount).toBe(1);
  });

  it('should handle zero cost', () => {
    reputation.recordSuccess('agent', 1000, 0);
    const score = reputation.getScore('agent');
    expect(score.avgCost).toBe(0);
  });

  it('should handle very large execution time', () => {
    reputation.recordSuccess('agent', Number.MAX_SAFE_INTEGER, 5);
    const record = reputation.getRecord('agent');
    expect(record!.totalExecutionTime).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('should handle very large cost', () => {
    reputation.recordSuccess('agent', 1000, Number.MAX_SAFE_INTEGER);
    const record = reputation.getRecord('agent');
    expect(record!.totalCost).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('should handle fractional execution time', () => {
    reputation.recordSuccess('agent', 0.5, 1);
    reputation.recordSuccess('agent', 1.5, 1);
    const score = reputation.getScore('agent');
    expect(score.avgExecutionTime).toBe(1); // (0.5 + 1.5) / 2 = 1
  });

  it('should handle fractional cost', () => {
    reputation.recordSuccess('agent', 1000, 0.001);
    reputation.recordSuccess('agent', 1000, 0.003);
    const score = reputation.getScore('agent');
    expect(score.avgCost).toBe(0); // Rounded: 0.002 rounds to 0.00 at 2 decimals
  });

  it('should maintain precision for avgCost to 2 decimal places', () => {
    reputation.recordSuccess('agent', 1000, 1.115);
    reputation.recordSuccess('agent', 1000, 1.125);
    const score = reputation.getScore('agent');
    // (1.115 + 1.125) / 2 = 1.12
    expect(score.avgCost).toBe(1.12);
  });
});

describe('Reputation - Reliability Calculation Edge Cases', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('should return 0.5 reliability with single data point', () => {
    reputation.recordSuccess('agent', 1000, 5);
    const score = reputation.getScore('agent');
    expect(score.reliability).toBe(0.5);
  });

  it('should return 1.0 reliability with identical execution times', () => {
    for (let i = 0; i < 10; i++) {
      reputation.recordSuccess('agent', 500, 5);
    }
    const score = reputation.getScore('agent');
    expect(score.reliability).toBe(1);
  });

  it('should return lower reliability with high variance', () => {
    reputation.recordSuccess('agent', 100, 5);
    reputation.recordSuccess('agent', 10000, 5);
    const score = reputation.getScore('agent');
    expect(score.reliability).toBeLessThan(0.5);
  });

  it('should handle all-zero execution times', () => {
    reputation.recordSuccess('agent', 0, 5);
    reputation.recordSuccess('agent', 0, 5);
    const score = reputation.getScore('agent');
    // Mean is 0, so cv calculation would divide by zero -> returns 0.5
    expect(score.reliability).toBe(0.5);
  });

  it('should cap reliability at 1.0', () => {
    for (let i = 0; i < 100; i++) {
      reputation.recordSuccess('agent', 1000, 5);
    }
    const score = reputation.getScore('agent');
    expect(score.reliability).toBeLessThanOrEqual(1);
  });

  it('should floor reliability at 0.0', () => {
    // Extreme variance
    reputation.recordSuccess('agent', 1, 5);
    reputation.recordSuccess('agent', 1000000, 5);
    const score = reputation.getScore('agent');
    expect(score.reliability).toBeGreaterThanOrEqual(0);
  });

  it('should not include failure execution times in reliability', () => {
    // Failures don't record execution times
    reputation.recordFailure('agent');
    reputation.recordFailure('agent');
    const score = reputation.getScore('agent');
    expect(score.reliability).toBe(0.5); // Neutral (no execution data)
  });
});

describe('Reputation - Score Computation Edge Cases', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('should produce overallScore of 0.5 for unknown agent', () => {
    const score = reputation.getScore('nobody');
    expect(score.overallScore).toBe(0.5);
  });

  it('should round overallScore to 3 decimal places', () => {
    reputation.recordSuccess('agent', 1000, 5);
    reputation.recordFailure('agent');
    const score = reputation.getScore('agent');
    // Check it has at most 3 decimal places
    const decimals = score.overallScore.toString().split('.')[1] || '';
    expect(decimals.length).toBeLessThanOrEqual(3);
  });

  it('should round successRate to 3 decimal places', () => {
    for (let i = 0; i < 3; i++) reputation.recordSuccess('agent', 1000, 5);
    for (let i = 0; i < 7; i++) reputation.recordFailure('agent');

    const score = reputation.getScore('agent');
    expect(score.successRate).toBe(0.3);
  });

  it('should round reliability to 3 decimal places', () => {
    reputation.recordSuccess('agent', 100, 5);
    reputation.recordSuccess('agent', 200, 5);
    reputation.recordSuccess('agent', 150, 5);

    const score = reputation.getScore('agent');
    const decimals = score.reliability.toString().split('.')[1] || '';
    expect(decimals.length).toBeLessThanOrEqual(3);
  });

  it('should have successRate 0 with only failures', () => {
    for (let i = 0; i < 10; i++) reputation.recordFailure('agent');
    const score = reputation.getScore('agent');
    expect(score.successRate).toBe(0);
    expect(score.avgExecutionTime).toBe(0);
    expect(score.avgCost).toBe(0);
  });

  it('should have successRate 1 with only successes', () => {
    for (let i = 0; i < 10; i++) reputation.recordSuccess('agent', 1000, 5);
    const score = reputation.getScore('agent');
    expect(score.successRate).toBe(1);
  });

  it('should cap experience bonus at 20 tasks', () => {
    // Agent with 20 tasks
    for (let i = 0; i < 20; i++) reputation.recordSuccess('a20', 1000, 5);
    const score20 = reputation.getScore('a20');

    // Agent with 100 tasks
    for (let i = 0; i < 100; i++) reputation.recordSuccess('a100', 1000, 5);
    const score100 = reputation.getScore('a100');

    // Both should have same score since experience bonus maxes at 20
    expect(score20.overallScore).toBe(score100.overallScore);
  });

  it('should give partial experience bonus for < 20 tasks', () => {
    reputation.recordSuccess('a5', 1000, 5);
    reputation.recordSuccess('a5', 1000, 5);
    reputation.recordSuccess('a5', 1000, 5);
    reputation.recordSuccess('a5', 1000, 5);
    reputation.recordSuccess('a5', 1000, 5);

    for (let i = 0; i < 20; i++) reputation.recordSuccess('a20', 1000, 5);

    const s5 = reputation.getScore('a5');
    const s20 = reputation.getScore('a20');

    // 5-task agent should have lower score than 20-task agent (less experience bonus)
    expect(s5.overallScore).toBeLessThan(s20.overallScore);
  });
});

describe('Reputation - Bid Score Calculations', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('should handle zero confidence', () => {
    const score = reputation.getReputationAdjustedBidScore('agent', 0, 10);
    expect(score).toBe(0);
  });

  it('should handle zero cost (denominator is cost + 1)', () => {
    const score = reputation.getReputationAdjustedBidScore('agent', 0.9, 0);
    // baseScore = 0.9 / 1 = 0.9
    // For unknown agent: multiplier = 0.5 + 0.5 = 1.0
    expect(score).toBeCloseTo(0.9, 1);
  });

  it('should handle very high cost', () => {
    const score = reputation.getReputationAdjustedBidScore('agent', 0.9, 1000000);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.001);
  });

  it('should handle confidence of 1.0', () => {
    const score = reputation.getReputationAdjustedBidScore('agent', 1.0, 0);
    expect(score).toBeGreaterThan(0);
  });

  it('should produce higher score for better-reputed agent with same bid params', () => {
    // Build good reputation
    for (let i = 0; i < 20; i++) {
      reputation.recordSuccess('good', 1000, 5);
    }
    // Build bad reputation
    for (let i = 0; i < 20; i++) {
      reputation.recordFailure('bad');
    }

    const goodScore = reputation.getReputationAdjustedBidScore('good', 0.8, 5);
    const badScore = reputation.getReputationAdjustedBidScore('bad', 0.8, 5);

    expect(goodScore).toBeGreaterThan(badScore);
  });

  it('should apply multiplier range correctly', () => {
    // Agent with minimum reputation (all failures)
    for (let i = 0; i < 20; i++) reputation.recordFailure('worst');
    const worstRep = reputation.getScore('worst').overallScore;
    const worstMultiplier = 0.5 + worstRep;

    // Agent with maximum reputation (all successes)
    for (let i = 0; i < 20; i++) reputation.recordSuccess('best', 1000, 5);
    const bestRep = reputation.getScore('best').overallScore;
    const bestMultiplier = 0.5 + bestRep;

    expect(worstMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(bestMultiplier).toBeLessThanOrEqual(1.5);
    expect(bestMultiplier).toBeGreaterThan(worstMultiplier);
  });
});

describe('Reputation - Reset Edge Cases', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('should not throw when resetting unknown agent', () => {
    expect(() => reputation.reset('nobody')).not.toThrow();
  });

  it('should return neutral score after reset', () => {
    for (let i = 0; i < 10; i++) reputation.recordSuccess('agent', 1000, 5);
    expect(reputation.getScore('agent').overallScore).toBeGreaterThan(0.5);

    reputation.reset('agent');
    expect(reputation.getScore('agent').overallScore).toBe(0.5);
    expect(reputation.getScore('agent').taskCount).toBe(0);
  });

  it('should decrease tracked agent count on reset', () => {
    reputation.recordSuccess('a1', 1000, 5);
    reputation.recordSuccess('a2', 1000, 5);
    expect(reputation.getTrackedAgentCount()).toBe(2);

    reputation.reset('a1');
    expect(reputation.getTrackedAgentCount()).toBe(1);
  });

  it('should allow re-recording after reset', () => {
    reputation.recordSuccess('agent', 1000, 5);
    reputation.reset('agent');
    reputation.recordSuccess('agent', 2000, 10);

    const record = reputation.getRecord('agent');
    expect(record!.totalTasks).toBe(1);
    expect(record!.totalExecutionTime).toBe(2000);
    expect(record!.totalCost).toBe(10);
  });
});

describe('Reputation - Event Emission', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('should emit score with all fields on success', () => {
    const spy = jest.fn();
    reputation.on('reputation:updated', spy);

    reputation.recordSuccess('agent', 1000, 5);

    expect(spy).toHaveBeenCalledTimes(1);
    const score = spy.mock.calls[0][0];
    expect(score).toHaveProperty('agentId', 'agent');
    expect(score).toHaveProperty('overallScore');
    expect(score).toHaveProperty('successRate');
    expect(score).toHaveProperty('avgExecutionTime');
    expect(score).toHaveProperty('avgCost');
    expect(score).toHaveProperty('reliability');
    expect(score).toHaveProperty('taskCount');
  });

  it('should emit updated score on each recording', () => {
    const spy = jest.fn();
    reputation.on('reputation:updated', spy);

    reputation.recordSuccess('agent', 1000, 5);
    reputation.recordSuccess('agent', 2000, 10);
    reputation.recordFailure('agent');

    expect(spy).toHaveBeenCalledTimes(3);

    // Scores should show progression
    const firstScore = spy.mock.calls[0][0];
    const lastScore = spy.mock.calls[2][0];

    expect(firstScore.taskCount).toBe(1);
    expect(lastScore.taskCount).toBe(3);
  });
});

describe('Reputation Integration with TaskCoordinator', () => {
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

  it('should record success in reputation when task completes', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test', requiredCapabilities: ['a'], payload: {},
      priority: 'medium', requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'agent-1', 'a');
    await coordinator.completeTask(taskId, 'agent-1', { data: 'done' });

    const score = coordinator.reputation.getScore('agent-1');
    expect(score.taskCount).toBe(1);
    expect(score.successRate).toBe(1);
  });

  it('should record failure in reputation when task fails', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test', requiredCapabilities: ['a'], payload: {},
      priority: 'medium', requesterId: 'r1',
    });

    await coordinator.assignTask(taskId, 'agent-1', 'a');
    await coordinator.failTask(taskId, 'agent-1', 'timeout');

    const score = coordinator.reputation.getScore('agent-1');
    expect(score.taskCount).toBe(1);
    expect(score.successRate).toBe(0);
  });

  it('should build up reputation across multiple tasks', async () => {
    for (let i = 0; i < 5; i++) {
      const taskId = await coordinator.submitTask({
        description: `Task ${i}`, requiredCapabilities: ['a'], payload: {},
        priority: 'medium', requesterId: 'r1',
      });
      await coordinator.assignTask(taskId, 'agent-1', 'a');
      await coordinator.completeTask(taskId, 'agent-1', { i });
    }

    const score = coordinator.reputation.getScore('agent-1');
    expect(score.taskCount).toBe(5);
    expect(score.successRate).toBe(1);
    expect(score.overallScore).toBeGreaterThan(0.5);
  });

  it('should use reputation in selectBestBid', async () => {
    // Build reputation for agent-1
    for (let i = 0; i < 10; i++) {
      coordinator.reputation.recordSuccess('agent-good', 1000, 5);
    }
    // Bad reputation for agent-2
    for (let i = 0; i < 10; i++) {
      coordinator.reputation.recordFailure('agent-bad');
    }

    const taskId = await coordinator.submitTask({
      description: 'Test', requiredCapabilities: ['a'], payload: {},
      priority: 'medium', requesterId: 'r1',
    });

    // Same bid parameters
    await coordinator.submitBid({
      taskId, agentId: 'agent-good', capability: 'a',
      estimatedDuration: 1000, estimatedCost: 5, confidence: 0.8, timestamp: Date.now(),
    });
    await coordinator.submitBid({
      taskId, agentId: 'agent-bad', capability: 'a',
      estimatedDuration: 1000, estimatedCost: 5, confidence: 0.8, timestamp: Date.now(),
    });

    const best = coordinator.selectBestBid(taskId);
    expect(best).not.toBeNull();
    expect(best!.agentId).toBe('agent-good');
  });

  it('should not record reputation for tasks without assignments', async () => {
    const taskId = await coordinator.submitTask({
      description: 'No assignments', requiredCapabilities: ['a'], payload: {},
      priority: 'low', requesterId: 'r1',
    });

    // Complete without assignment
    await coordinator.completeTask(taskId, 'phantom', { x: 1 });

    const score = coordinator.reputation.getScore('phantom');
    // Should still be neutral (no assignment found)
    expect(score.taskCount).toBe(0);
  });
});
