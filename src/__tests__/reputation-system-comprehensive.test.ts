/**
 * ReputationManager - Comprehensive tests for scoring, reliability, and edge cases
 */

import { ReputationManager, ReputationScore, ReputationRecord } from '../core/reputation';

describe('ReputationManager - Comprehensive', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  describe('New Agent Scores', () => {
    it('should return neutral score for unknown agent', () => {
      const score = reputation.getScore('unknown');
      expect(score.overallScore).toBe(0.5);
      expect(score.successRate).toBe(0);
      expect(score.avgExecutionTime).toBe(0);
      expect(score.avgCost).toBe(0);
      expect(score.reliability).toBe(0.5);
      expect(score.taskCount).toBe(0);
    });

    it('should return agentId in score', () => {
      const score = reputation.getScore('specific-id');
      expect(score.agentId).toBe('specific-id');
    });

    it('should return undefined record for unknown agent', () => {
      expect(reputation.getRecord('unknown')).toBeUndefined();
    });

    it('should have zero tracked agents initially', () => {
      expect(reputation.getTrackedAgentCount()).toBe(0);
    });
  });

  describe('Success Recording', () => {
    it('should increment completed tasks on success', () => {
      reputation.recordSuccess('a1', 100, 5);
      const record = reputation.getRecord('a1');
      expect(record!.completedTasks).toBe(1);
      expect(record!.totalTasks).toBe(1);
      expect(record!.failedTasks).toBe(0);
    });

    it('should accumulate execution time', () => {
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordSuccess('a1', 200, 10);
      const record = reputation.getRecord('a1');
      expect(record!.totalExecutionTime).toBe(300);
    });

    it('should accumulate total cost', () => {
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordSuccess('a1', 200, 15);
      const record = reputation.getRecord('a1');
      expect(record!.totalCost).toBe(20);
    });

    it('should update lastUpdated timestamp', () => {
      const before = Date.now();
      reputation.recordSuccess('a1', 100, 5);
      const after = Date.now();
      const record = reputation.getRecord('a1');
      expect(record!.lastUpdated).toBeGreaterThanOrEqual(before);
      expect(record!.lastUpdated).toBeLessThanOrEqual(after);
    });

    it('should emit reputation:updated on success', () => {
      const handler = jest.fn();
      reputation.on('reputation:updated', handler);
      reputation.recordSuccess('a1', 100, 5);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].agentId).toBe('a1');
    });

    it('should handle zero execution time', () => {
      reputation.recordSuccess('a1', 0, 5);
      const score = reputation.getScore('a1');
      expect(score.avgExecutionTime).toBe(0);
    });

    it('should handle zero cost', () => {
      reputation.recordSuccess('a1', 100, 0);
      const score = reputation.getScore('a1');
      expect(score.avgCost).toBe(0);
    });

    it('should handle very large execution times', () => {
      reputation.recordSuccess('a1', 999999999, 0);
      const score = reputation.getScore('a1');
      expect(score.avgExecutionTime).toBe(999999999);
    });

    it('should handle fractional costs', () => {
      reputation.recordSuccess('a1', 100, 0.001);
      reputation.recordSuccess('a1', 100, 0.002);
      const score = reputation.getScore('a1');
      expect(score.avgCost).toBeCloseTo(0.0015, 2);
    });
  });

  describe('Failure Recording', () => {
    it('should increment failed tasks', () => {
      reputation.recordFailure('a1');
      const record = reputation.getRecord('a1');
      expect(record!.failedTasks).toBe(1);
      expect(record!.totalTasks).toBe(1);
      expect(record!.completedTasks).toBe(0);
    });

    it('should not affect execution time or cost', () => {
      reputation.recordFailure('a1');
      const record = reputation.getRecord('a1');
      expect(record!.totalExecutionTime).toBe(0);
      expect(record!.totalCost).toBe(0);
    });

    it('should emit reputation:updated on failure', () => {
      const handler = jest.fn();
      reputation.on('reputation:updated', handler);
      reputation.recordFailure('a1');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should reduce success rate', () => {
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordFailure('a1');

      const score = reputation.getScore('a1');
      expect(score.successRate).toBeCloseTo(0.667, 2);
    });
  });

  describe('Score Calculation', () => {
    it('should calculate 100% success rate for all successes', () => {
      for (let i = 0; i < 10; i++) {
        reputation.recordSuccess('a1', 100, 5);
      }
      expect(reputation.getScore('a1').successRate).toBe(1);
    });

    it('should calculate 0% success rate for all failures', () => {
      for (let i = 0; i < 10; i++) {
        reputation.recordFailure('a1');
      }
      expect(reputation.getScore('a1').successRate).toBe(0);
    });

    it('should calculate average execution time correctly', () => {
      reputation.recordSuccess('a1', 100, 0);
      reputation.recordSuccess('a1', 300, 0);
      expect(reputation.getScore('a1').avgExecutionTime).toBe(200);
    });

    it('should calculate average cost correctly', () => {
      reputation.recordSuccess('a1', 100, 10);
      reputation.recordSuccess('a1', 100, 20);
      expect(reputation.getScore('a1').avgCost).toBe(15);
    });

    it('should calculate experience bonus capped at 1.0', () => {
      // 20+ tasks should max out experience bonus
      for (let i = 0; i < 30; i++) {
        reputation.recordSuccess('a1', 100, 5);
      }

      const score = reputation.getScore('a1');
      // overallScore = successRate * 0.5 + reliability * 0.3 + 1.0 * 0.2
      // With perfect success and consistent times: should be close to 1.0
      expect(score.overallScore).toBeGreaterThan(0.8);
    });

    it('should give partial experience bonus for fewer tasks', () => {
      reputation.recordSuccess('a1', 100, 5);
      const score = reputation.getScore('a1');
      // 1/20 = 0.05 experience bonus
      // overallScore = 1.0 * 0.5 + reliability * 0.3 + 0.05 * 0.2
      expect(score.overallScore).toBeLessThan(1);
    });

    it('should round overallScore to 3 decimal places', () => {
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordSuccess('a1', 120, 5);
      reputation.recordFailure('a1');

      const score = reputation.getScore('a1');
      const decimalStr = score.overallScore.toString();
      const parts = decimalStr.split('.');
      if (parts.length > 1) {
        expect(parts[1].length).toBeLessThanOrEqual(3);
      }
    });

    it('should round successRate to 3 decimal places', () => {
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordFailure('a1');

      const score = reputation.getScore('a1');
      expect(score.successRate).toBe(0.667);
    });

    it('should return 0 avgExecutionTime when no successes', () => {
      reputation.recordFailure('a1');
      expect(reputation.getScore('a1').avgExecutionTime).toBe(0);
    });

    it('should return 0 avgCost when no successes', () => {
      reputation.recordFailure('a1');
      expect(reputation.getScore('a1').avgCost).toBe(0);
    });
  });

  describe('Reliability Calculation', () => {
    it('should return 0.5 for single data point', () => {
      reputation.recordSuccess('a1', 100, 5);
      const score = reputation.getScore('a1');
      expect(score.reliability).toBe(0.5);
    });

    it('should return high reliability for consistent times', () => {
      for (let i = 0; i < 10; i++) {
        reputation.recordSuccess('a1', 100, 5); // Same time every time
      }
      const score = reputation.getScore('a1');
      expect(score.reliability).toBe(1); // Perfect consistency
    });

    it('should return lower reliability for inconsistent times', () => {
      reputation.recordSuccess('a1', 50, 5);
      reputation.recordSuccess('a1', 500, 5);
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordSuccess('a1', 1000, 5);

      const score = reputation.getScore('a1');
      expect(score.reliability).toBeLessThan(0.8);
    });

    it('should bound reliability between 0 and 1', () => {
      // Very inconsistent
      reputation.recordSuccess('a1', 1, 5);
      reputation.recordSuccess('a1', 100000, 5);

      const score = reputation.getScore('a1');
      expect(score.reliability).toBeGreaterThanOrEqual(0);
      expect(score.reliability).toBeLessThanOrEqual(1);
    });

    it('should return 0.5 for agent with no execution time data', () => {
      reputation.recordFailure('a1');
      const score = reputation.getScore('a1');
      expect(score.reliability).toBe(0.5);
    });
  });

  describe('Reputation-Adjusted Bid Scoring', () => {
    it('should return base score for new agent', () => {
      const score = reputation.getReputationAdjustedBidScore('new-agent', 0.9, 10);
      // reputation = 0.5, multiplier = 0.5 + 0.5 = 1.0
      // base = 0.9 / (10 + 1) = 0.0818
      expect(score).toBeCloseTo(0.0818, 2);
    });

    it('should give higher score to reputable agents', () => {
      for (let i = 0; i < 20; i++) {
        reputation.recordSuccess('good-agent', 100, 5);
      }

      const goodScore = reputation.getReputationAdjustedBidScore('good-agent', 0.9, 10);
      const newScore = reputation.getReputationAdjustedBidScore('new-agent', 0.9, 10);

      expect(goodScore).toBeGreaterThan(newScore);
    });

    it('should penalize agents with poor reputation', () => {
      for (let i = 0; i < 10; i++) {
        reputation.recordFailure('bad-agent');
      }

      const badScore = reputation.getReputationAdjustedBidScore('bad-agent', 0.9, 10);
      const newScore = reputation.getReputationAdjustedBidScore('new-agent', 0.9, 10);

      expect(badScore).toBeLessThan(newScore);
    });

    it('should handle zero confidence', () => {
      const score = reputation.getReputationAdjustedBidScore('a1', 0, 10);
      expect(score).toBe(0);
    });

    it('should handle zero cost', () => {
      const score = reputation.getReputationAdjustedBidScore('a1', 0.9, 0);
      // base = 0.9 / 1 = 0.9, multiplier = 1.0
      expect(score).toBe(0.9);
    });

    it('should handle very high cost', () => {
      const score = reputation.getReputationAdjustedBidScore('a1', 0.9, 1000000);
      expect(score).toBeCloseTo(0, 4);
    });
  });

  describe('Multiple Agents', () => {
    it('should track agents independently', () => {
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordFailure('a2');

      expect(reputation.getScore('a1').successRate).toBe(1);
      expect(reputation.getScore('a2').successRate).toBe(0);
    });

    it('should sort all scores by overall score descending', () => {
      // Agent 1: all successes
      for (let i = 0; i < 10; i++) {
        reputation.recordSuccess('top-agent', 100, 5);
      }

      // Agent 2: mixed
      reputation.recordSuccess('mid-agent', 100, 5);
      reputation.recordFailure('mid-agent');

      // Agent 3: all failures
      for (let i = 0; i < 5; i++) {
        reputation.recordFailure('bad-agent');
      }

      const scores = reputation.getAllScores();
      expect(scores[0].agentId).toBe('top-agent');
      expect(scores[scores.length - 1].agentId).toBe('bad-agent');

      // Verify sorted order
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1].overallScore).toBeGreaterThanOrEqual(scores[i].overallScore);
      }
    });

    it('should count all tracked agents', () => {
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordSuccess('a2', 100, 5);
      reputation.recordFailure('a3');

      expect(reputation.getTrackedAgentCount()).toBe(3);
    });

    it('should handle 100 agents', () => {
      for (let i = 0; i < 100; i++) {
        reputation.recordSuccess(`agent-${i}`, 100 + i, 5);
      }

      expect(reputation.getTrackedAgentCount()).toBe(100);
      const scores = reputation.getAllScores();
      expect(scores).toHaveLength(100);
    });
  });

  describe('Reset', () => {
    it('should clear all data for an agent', () => {
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordSuccess('a1', 200, 10);
      reputation.recordFailure('a1');

      reputation.reset('a1');

      expect(reputation.getRecord('a1')).toBeUndefined();
      const score = reputation.getScore('a1');
      expect(score.overallScore).toBe(0.5); // Back to neutral
      expect(score.taskCount).toBe(0);
    });

    it('should not affect other agents when resetting', () => {
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordSuccess('a2', 100, 5);

      reputation.reset('a1');

      expect(reputation.getRecord('a1')).toBeUndefined();
      expect(reputation.getRecord('a2')).toBeDefined();
    });

    it('should reduce tracked agent count', () => {
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordSuccess('a2', 100, 5);

      reputation.reset('a1');
      expect(reputation.getTrackedAgentCount()).toBe(1);
    });

    it('should be safe to reset non-existent agent', () => {
      reputation.reset('nonexistent');
      expect(reputation.getTrackedAgentCount()).toBe(0);
    });

    it('should allow re-recording after reset', () => {
      reputation.recordSuccess('a1', 100, 5);
      reputation.reset('a1');
      reputation.recordSuccess('a1', 200, 10);

      const score = reputation.getScore('a1');
      expect(score.taskCount).toBe(1);
      expect(score.avgExecutionTime).toBe(200);
    });
  });

  describe('Edge Cases with Execution Time Patterns', () => {
    it('should handle all identical execution times', () => {
      for (let i = 0; i < 5; i++) {
        reputation.recordSuccess('a1', 100, 5);
      }
      const score = reputation.getScore('a1');
      expect(score.reliability).toBe(1); // Zero variance = perfect reliability
    });

    it('should handle linearly increasing execution times', () => {
      for (let i = 1; i <= 10; i++) {
        reputation.recordSuccess('a1', i * 100, 5);
      }
      const score = reputation.getScore('a1');
      expect(score.reliability).toBeLessThan(1);
      expect(score.reliability).toBeGreaterThan(0);
    });

    it('should handle execution time with one outlier', () => {
      for (let i = 0; i < 9; i++) {
        reputation.recordSuccess('a1', 100, 5);
      }
      reputation.recordSuccess('a1', 10000, 5); // outlier

      const score = reputation.getScore('a1');
      expect(score.reliability).toBeLessThan(0.9);
    });

    it('should handle very small execution times', () => {
      reputation.recordSuccess('a1', 1, 5);
      reputation.recordSuccess('a1', 2, 5);
      reputation.recordSuccess('a1', 1, 5);

      const score = reputation.getScore('a1');
      expect(score.avgExecutionTime).toBeGreaterThan(0);
    });
  });

  describe('Score Bounds', () => {
    it('should keep overall score between 0 and 1', () => {
      // All failures = lowest possible score
      for (let i = 0; i < 20; i++) {
        reputation.recordFailure('worst');
      }
      const worstScore = reputation.getScore('worst');
      expect(worstScore.overallScore).toBeGreaterThanOrEqual(0);
      expect(worstScore.overallScore).toBeLessThanOrEqual(1);

      // All successes with consistent times = highest possible score
      for (let i = 0; i < 20; i++) {
        reputation.recordSuccess('best', 100, 5);
      }
      const bestScore = reputation.getScore('best');
      expect(bestScore.overallScore).toBeGreaterThanOrEqual(0);
      expect(bestScore.overallScore).toBeLessThanOrEqual(1);
    });

    it('should keep success rate between 0 and 1', () => {
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordFailure('a1');
      const score = reputation.getScore('a1');
      expect(score.successRate).toBeGreaterThanOrEqual(0);
      expect(score.successRate).toBeLessThanOrEqual(1);
    });

    it('should keep reliability between 0 and 1', () => {
      reputation.recordSuccess('a1', 1, 5);
      reputation.recordSuccess('a1', 100000, 5);
      const score = reputation.getScore('a1');
      expect(score.reliability).toBeGreaterThanOrEqual(0);
      expect(score.reliability).toBeLessThanOrEqual(1);
    });
  });

  describe('Event Emission', () => {
    it('should emit updated score in event', () => {
      const handler = jest.fn();
      reputation.on('reputation:updated', handler);

      reputation.recordSuccess('a1', 100, 5);

      const emittedScore = handler.mock.calls[0][0] as ReputationScore;
      expect(emittedScore.agentId).toBe('a1');
      expect(emittedScore.taskCount).toBe(1);
      expect(emittedScore.successRate).toBe(1);
    });

    it('should emit on every success', () => {
      const handler = jest.fn();
      reputation.on('reputation:updated', handler);

      reputation.recordSuccess('a1', 100, 5);
      reputation.recordSuccess('a1', 100, 5);
      reputation.recordSuccess('a1', 100, 5);

      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('should emit on every failure', () => {
      const handler = jest.fn();
      reputation.on('reputation:updated', handler);

      reputation.recordFailure('a1');
      reputation.recordFailure('a1');

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should allow multiple listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      reputation.on('reputation:updated', handler1);
      reputation.on('reputation:updated', handler2);

      reputation.recordSuccess('a1', 100, 5);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });
});
