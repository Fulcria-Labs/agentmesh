/**
 * Advanced reputation system tests
 *
 * Covers: boundary values, zero-cost operations, large datasets,
 * reliability calculation edge cases, and bid scoring scenarios.
 */

import { ReputationManager } from '../core/reputation';

describe('ReputationManager - Boundary Values', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('should handle zero execution time', () => {
    reputation.recordSuccess('agent-1', 0, 5);
    const score = reputation.getScore('agent-1');
    expect(score.avgExecutionTime).toBe(0);
    expect(score.taskCount).toBe(1);
  });

  it('should handle zero cost', () => {
    reputation.recordSuccess('agent-1', 1000, 0);
    const score = reputation.getScore('agent-1');
    expect(score.avgCost).toBe(0);
    expect(score.taskCount).toBe(1);
  });

  it('should handle very large execution times', () => {
    reputation.recordSuccess('agent-1', 999999999, 5);
    const score = reputation.getScore('agent-1');
    expect(score.avgExecutionTime).toBe(999999999);
  });

  it('should handle very large costs', () => {
    reputation.recordSuccess('agent-1', 1000, 999999);
    const score = reputation.getScore('agent-1');
    expect(score.avgCost).toBe(999999);
  });

  it('should handle agent with only failures', () => {
    for (let i = 0; i < 10; i++) {
      reputation.recordFailure('agent-1');
    }

    const score = reputation.getScore('agent-1');
    expect(score.successRate).toBe(0);
    expect(score.avgExecutionTime).toBe(0);
    expect(score.avgCost).toBe(0);
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
    expect(score.overallScore).toBeLessThanOrEqual(1);
  });

  it('should maintain bounded overall score for 100% failure rate', () => {
    for (let i = 0; i < 25; i++) {
      reputation.recordFailure('all-fail');
    }

    const score = reputation.getScore('all-fail');
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
    // With 0% success rate, 0.5 reliability, and full experience bonus:
    // (0 * 0.5) + (0.5 * 0.3) + (1.0 * 0.2) = 0.35
    expect(score.overallScore).toBeLessThanOrEqual(0.4);
  });

  it('should cap experience bonus at 20 tasks', () => {
    for (let i = 0; i < 20; i++) {
      reputation.recordSuccess('at-20', 1000, 5);
    }
    const scoreAt20 = reputation.getScore('at-20').overallScore;

    for (let i = 0; i < 40; i++) {
      reputation.recordSuccess('at-40', 1000, 5);
    }
    const scoreAt40 = reputation.getScore('at-40').overallScore;

    // Experience bonus should be identical at 20 and 40 tasks
    // The overall scores should be very close (same success rate, reliability)
    expect(Math.abs(scoreAt20 - scoreAt40)).toBeLessThan(0.01);
  });
});

describe('ReputationManager - Reliability Calculation', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('should return neutral reliability with single execution time', () => {
    reputation.recordSuccess('agent-1', 1000, 5);
    const score = reputation.getScore('agent-1');
    expect(score.reliability).toBe(0.5); // Insufficient data
  });

  it('should return perfect reliability for identical execution times', () => {
    for (let i = 0; i < 5; i++) {
      reputation.recordSuccess('agent-1', 500, 5);
    }
    const score = reputation.getScore('agent-1');
    expect(score.reliability).toBe(1);
  });

  it('should return low reliability for widely varying times', () => {
    reputation.recordSuccess('agent-1', 10, 5);
    reputation.recordSuccess('agent-1', 10000, 5);
    reputation.recordSuccess('agent-1', 50, 5);
    reputation.recordSuccess('agent-1', 9500, 5);

    const score = reputation.getScore('agent-1');
    expect(score.reliability).toBeLessThan(0.5);
  });

  it('should return moderate reliability for somewhat varied times', () => {
    reputation.recordSuccess('agent-1', 900, 5);
    reputation.recordSuccess('agent-1', 1000, 5);
    reputation.recordSuccess('agent-1', 1100, 5);
    reputation.recordSuccess('agent-1', 950, 5);
    reputation.recordSuccess('agent-1', 1050, 5);

    const score = reputation.getScore('agent-1');
    expect(score.reliability).toBeGreaterThan(0.8);
    expect(score.reliability).toBeLessThanOrEqual(1);
  });

  it('should handle all zero execution times', () => {
    reputation.recordSuccess('agent-1', 0, 5);
    reputation.recordSuccess('agent-1', 0, 5);
    reputation.recordSuccess('agent-1', 0, 5);

    const score = reputation.getScore('agent-1');
    // Mean is 0, so CV calculation returns 0.5 (neutral)
    expect(score.reliability).toBe(0.5);
  });

  it('should clamp reliability between 0 and 1', () => {
    // Extremely variable times
    reputation.recordSuccess('extreme', 1, 5);
    reputation.recordSuccess('extreme', 100000, 5);

    const score = reputation.getScore('extreme');
    expect(score.reliability).toBeGreaterThanOrEqual(0);
    expect(score.reliability).toBeLessThanOrEqual(1);
  });
});

describe('ReputationManager - Bid Scoring Scenarios', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('should handle zero confidence bid', () => {
    const score = reputation.getReputationAdjustedBidScore('agent-1', 0, 10);
    expect(score).toBe(0);
  });

  it('should handle zero cost bid', () => {
    const score = reputation.getReputationAdjustedBidScore('agent-1', 0.9, 0);
    // baseScore = 0.9 / (0 + 1) = 0.9
    // multiplier for unknown = 0.5 + 0.5 = 1.0
    expect(score).toBeCloseTo(0.9, 1);
  });

  it('should handle very high cost reducing score significantly', () => {
    const lowCostScore = reputation.getReputationAdjustedBidScore('agent-1', 0.9, 1);
    const highCostScore = reputation.getReputationAdjustedBidScore('agent-1', 0.9, 1000);

    expect(highCostScore).toBeLessThan(lowCostScore);
  });

  it('should properly compare agents with different reputations and same bid', () => {
    // Build a perfect agent
    for (let i = 0; i < 10; i++) {
      reputation.recordSuccess('perfect', 1000, 5);
    }

    // Build a mediocre agent
    for (let i = 0; i < 5; i++) {
      reputation.recordSuccess('mediocre', 1000, 5);
    }
    for (let i = 0; i < 5; i++) {
      reputation.recordFailure('mediocre');
    }

    // Same bid parameters
    const perfectScore = reputation.getReputationAdjustedBidScore('perfect', 0.8, 10);
    const mediocreScore = reputation.getReputationAdjustedBidScore('mediocre', 0.8, 10);

    expect(perfectScore).toBeGreaterThan(mediocreScore);
  });

  it('should allow high-confidence low-rep agent to beat low-confidence high-rep agent', () => {
    // High reputation agent
    for (let i = 0; i < 15; i++) {
      reputation.recordSuccess('high-rep', 1000, 5);
    }

    // Low confidence, high cost from high-rep agent
    const highRepScore = reputation.getReputationAdjustedBidScore('high-rep', 0.1, 100);

    // Unknown agent with high confidence, low cost
    const newAgentScore = reputation.getReputationAdjustedBidScore('new-agent', 0.95, 0);

    expect(newAgentScore).toBeGreaterThan(highRepScore);
  });
});

describe('ReputationManager - Multiple Agent Tracking', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('should independently track multiple agents', () => {
    reputation.recordSuccess('agent-1', 1000, 5);
    reputation.recordFailure('agent-2');
    reputation.recordSuccess('agent-3', 2000, 10);

    expect(reputation.getTrackedAgentCount()).toBe(3);
    expect(reputation.getScore('agent-1').successRate).toBe(1);
    expect(reputation.getScore('agent-2').successRate).toBe(0);
    expect(reputation.getScore('agent-3').successRate).toBe(1);
  });

  it('should sort getAllScores correctly with many agents', () => {
    // Create agents with decreasing quality
    for (let i = 0; i < 5; i++) {
      const agentId = `agent-${i}`;
      const successCount = 5 - i; // 5, 4, 3, 2, 1
      const failCount = i; // 0, 1, 2, 3, 4

      for (let s = 0; s < successCount; s++) {
        reputation.recordSuccess(agentId, 1000, 5);
      }
      for (let f = 0; f < failCount; f++) {
        reputation.recordFailure(agentId);
      }
    }

    const scores = reputation.getAllScores();
    expect(scores).toHaveLength(5);

    // Verify sorted descending
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]!.overallScore).toBeGreaterThanOrEqual(scores[i]!.overallScore);
    }
  });

  it('should only reset one agent without affecting others', () => {
    reputation.recordSuccess('agent-1', 1000, 5);
    reputation.recordSuccess('agent-2', 2000, 10);

    reputation.reset('agent-1');

    expect(reputation.getTrackedAgentCount()).toBe(1);
    expect(reputation.getRecord('agent-1')).toBeUndefined();
    expect(reputation.getRecord('agent-2')).toBeDefined();
  });

  it('should handle reset of non-existent agent gracefully', () => {
    reputation.reset('nonexistent');
    expect(reputation.getTrackedAgentCount()).toBe(0);
  });
});

describe('ReputationManager - Score Precision', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('should round scores to 3 decimal places', () => {
    reputation.recordSuccess('agent-1', 1000, 5);
    reputation.recordSuccess('agent-1', 2000, 5);
    reputation.recordFailure('agent-1');

    const score = reputation.getScore('agent-1');

    // Check that values are properly rounded
    const successRateStr = score.successRate.toString();
    const decimalPlaces = successRateStr.includes('.')
      ? successRateStr.split('.')[1]!.length
      : 0;
    expect(decimalPlaces).toBeLessThanOrEqual(3);
  });

  it('should round avgCost to 2 decimal places', () => {
    reputation.recordSuccess('agent-1', 1000, 3.333);
    reputation.recordSuccess('agent-1', 1000, 6.667);

    const score = reputation.getScore('agent-1');
    const costStr = score.avgCost.toString();
    const decimalPlaces = costStr.includes('.')
      ? costStr.split('.')[1]!.length
      : 0;
    expect(decimalPlaces).toBeLessThanOrEqual(2);
  });

  it('should round avgExecutionTime to integer', () => {
    reputation.recordSuccess('agent-1', 1001, 5);
    reputation.recordSuccess('agent-1', 1002, 5);
    reputation.recordSuccess('agent-1', 1003, 5);

    const score = reputation.getScore('agent-1');
    expect(score.avgExecutionTime).toBe(Math.round(score.avgExecutionTime));
  });
});

describe('ReputationManager - Event Emissions', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('should emit updated event with complete score data on success', () => {
    const events: any[] = [];
    reputation.on('reputation:updated', (score) => events.push(score));

    reputation.recordSuccess('agent-1', 1000, 5);

    expect(events).toHaveLength(1);
    expect(events[0]).toHaveProperty('agentId', 'agent-1');
    expect(events[0]).toHaveProperty('overallScore');
    expect(events[0]).toHaveProperty('successRate');
    expect(events[0]).toHaveProperty('reliability');
    expect(events[0]).toHaveProperty('taskCount', 1);
  });

  it('should emit updated event with correct incremental data', () => {
    const events: any[] = [];
    reputation.on('reputation:updated', (score) => events.push(score));

    reputation.recordSuccess('agent-1', 1000, 5);
    reputation.recordSuccess('agent-1', 2000, 10);
    reputation.recordFailure('agent-1');

    expect(events).toHaveLength(3);
    expect(events[0].taskCount).toBe(1);
    expect(events[1].taskCount).toBe(2);
    expect(events[2].taskCount).toBe(3);
    expect(events[2].successRate).toBeCloseTo(0.667, 2);
  });
});
