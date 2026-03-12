/**
 * ReputationManager - Mathematical edge cases and statistical properties
 *
 * Covers: extreme values, mathematical boundaries, floating-point edge cases,
 * coefficient of variation edge cases, experience bonus saturation, and
 * reputation-adjusted bid scoring formulas.
 */

import { ReputationManager } from '../core/reputation';

describe('ReputationManager - Mathematical Edge Cases', () => {
  let rep: ReputationManager;

  beforeEach(() => {
    rep = new ReputationManager();
  });

  describe('score bounds', () => {
    it('should never produce overallScore > 1', () => {
      for (let i = 0; i < 100; i++) {
        rep.recordSuccess('super-agent', 1000, 5);
      }
      const score = rep.getScore('super-agent');
      expect(score.overallScore).toBeLessThanOrEqual(1);
    });

    it('should never produce overallScore < 0', () => {
      for (let i = 0; i < 100; i++) {
        rep.recordFailure('bad-agent');
      }
      const score = rep.getScore('bad-agent');
      expect(score.overallScore).toBeGreaterThanOrEqual(0);
    });

    it('should never produce successRate > 1', () => {
      rep.recordSuccess('a', 100, 1);
      expect(rep.getScore('a').successRate).toBeLessThanOrEqual(1);
    });

    it('should produce successRate of 0 for all-failure agent', () => {
      rep.recordFailure('f');
      rep.recordFailure('f');
      expect(rep.getScore('f').successRate).toBe(0);
    });

    it('should produce successRate of 1 for all-success agent', () => {
      rep.recordSuccess('s', 100, 1);
      rep.recordSuccess('s', 200, 2);
      expect(rep.getScore('s').successRate).toBe(1);
    });

    it('should never produce reliability > 1', () => {
      for (let i = 0; i < 50; i++) {
        rep.recordSuccess('r', 1000, 1);
      }
      expect(rep.getScore('r').reliability).toBeLessThanOrEqual(1);
    });

    it('should never produce reliability < 0', () => {
      rep.recordSuccess('v', 1, 0);
      rep.recordSuccess('v', 100000, 0);
      expect(rep.getScore('v').reliability).toBeGreaterThanOrEqual(0);
    });
  });

  describe('experience bonus', () => {
    it('should cap at 20 tasks', () => {
      for (let i = 0; i < 20; i++) {
        rep.recordSuccess('exp20', 1000, 1);
      }
      const score20 = rep.getScore('exp20').overallScore;

      for (let i = 0; i < 30; i++) {
        rep.recordSuccess('exp50', 1000, 1);
      }
      const score50 = rep.getScore('exp50').overallScore;

      // Beyond 20, experience bonus doesn't increase, so scores should be equal
      expect(score20).toBe(score50);
    });

    it('should be 0.1 for 10 tasks (10/20 = 0.5, times 0.2 = 0.1)', () => {
      for (let i = 0; i < 10; i++) {
        rep.recordSuccess('exp10', 1000, 1);
      }
      const score = rep.getScore('exp10');
      // experienceBonus = min(10/20, 1) = 0.5
      // Overall = successRate*0.5 + reliability*0.3 + 0.5*0.2
      // successRate = 1.0 -> 0.5
      // reliability = 1.0 (constant times) -> 0.3
      // experienceBonus = 0.5 -> 0.1
      // Total = 0.5 + 0.3 + 0.1 = 0.9
      expect(score.overallScore).toBe(0.9);
    });

    it('should be maximized at 0.2 for 20+ tasks', () => {
      for (let i = 0; i < 20; i++) {
        rep.recordSuccess('exp20', 1000, 1);
      }
      const score = rep.getScore('exp20');
      // experienceBonus = min(20/20, 1) = 1.0
      // Overall = 1.0*0.5 + 1.0*0.3 + 1.0*0.2 = 1.0
      expect(score.overallScore).toBe(1);
    });

    it('should be 0.05 for 1 task (1/20 = 0.05, times 0.2 = 0.01)', () => {
      rep.recordSuccess('exp1', 1000, 1);
      const score = rep.getScore('exp1');
      // Only 1 execution time => reliability = 0.5
      // experienceBonus = 1/20 = 0.05
      // Overall = 1.0*0.5 + 0.5*0.3 + 0.05*0.2 = 0.5 + 0.15 + 0.01 = 0.66
      expect(score.overallScore).toBe(0.66);
    });
  });

  describe('reliability calculation (coefficient of variation)', () => {
    it('should return 0.5 for single execution time (insufficient data)', () => {
      rep.recordSuccess('one', 1000, 1);
      expect(rep.getScore('one').reliability).toBe(0.5);
    });

    it('should return 1.0 for perfectly consistent times', () => {
      rep.recordSuccess('const', 5000, 1);
      rep.recordSuccess('const', 5000, 1);
      rep.recordSuccess('const', 5000, 1);
      expect(rep.getScore('const').reliability).toBe(1);
    });

    it('should return value < 1.0 for slightly variable times', () => {
      rep.recordSuccess('slight', 1000, 1);
      rep.recordSuccess('slight', 1100, 1);
      rep.recordSuccess('slight', 900, 1);
      const rel = rep.getScore('slight').reliability;
      expect(rel).toBeGreaterThan(0.9);
      expect(rel).toBeLessThan(1);
    });

    it('should return low value for wildly variable times', () => {
      rep.recordSuccess('wild', 10, 1);
      rep.recordSuccess('wild', 10000, 1);
      rep.recordSuccess('wild', 50, 1);
      rep.recordSuccess('wild', 20000, 1);
      expect(rep.getScore('wild').reliability).toBeLessThan(0.3);
    });

    it('should handle zero execution times', () => {
      rep.recordSuccess('zero', 0, 0);
      rep.recordSuccess('zero', 0, 0);
      // mean = 0, so CV calculation would divide by zero
      // Should return 0.5 (the guard clause for mean === 0)
      expect(rep.getScore('zero').reliability).toBe(0.5);
    });

    it('should handle identical non-zero times with two data points', () => {
      rep.recordSuccess('pair', 500, 1);
      rep.recordSuccess('pair', 500, 1);
      expect(rep.getScore('pair').reliability).toBe(1);
    });

    it('should handle very large execution times', () => {
      rep.recordSuccess('big', Number.MAX_SAFE_INTEGER / 2, 1);
      rep.recordSuccess('big', Number.MAX_SAFE_INTEGER / 2, 1);
      const rel = rep.getScore('big').reliability;
      expect(rel).toBeGreaterThanOrEqual(0);
      expect(rel).toBeLessThanOrEqual(1);
    });

    it('should produce lower reliability for increasing variance', () => {
      // Low variance
      rep.recordSuccess('low-var', 100, 1);
      rep.recordSuccess('low-var', 110, 1);
      rep.recordSuccess('low-var', 105, 1);
      const lowVar = rep.getScore('low-var').reliability;

      // High variance
      rep.recordSuccess('high-var', 100, 1);
      rep.recordSuccess('high-var', 500, 1);
      rep.recordSuccess('high-var', 50, 1);
      const highVar = rep.getScore('high-var').reliability;

      expect(lowVar).toBeGreaterThan(highVar);
    });
  });

  describe('average execution time', () => {
    it('should return 0 when no successes', () => {
      rep.recordFailure('f');
      expect(rep.getScore('f').avgExecutionTime).toBe(0);
    });

    it('should compute correct average', () => {
      rep.recordSuccess('a', 100, 1);
      rep.recordSuccess('a', 200, 1);
      rep.recordSuccess('a', 300, 1);
      expect(rep.getScore('a').avgExecutionTime).toBe(200);
    });

    it('should round to integer', () => {
      rep.recordSuccess('a', 100, 1);
      rep.recordSuccess('a', 201, 1);
      // Average = 150.5 -> rounds to 151
      expect(rep.getScore('a').avgExecutionTime).toBe(151);
    });

    it('should not count failures in execution time average', () => {
      rep.recordSuccess('a', 100, 1);
      rep.recordFailure('a');
      rep.recordSuccess('a', 200, 1);
      // Only successes: (100+200)/2 = 150
      expect(rep.getScore('a').avgExecutionTime).toBe(150);
    });
  });

  describe('average cost', () => {
    it('should return 0 when no successes', () => {
      rep.recordFailure('f');
      expect(rep.getScore('f').avgCost).toBe(0);
    });

    it('should compute correct average', () => {
      rep.recordSuccess('a', 100, 10);
      rep.recordSuccess('a', 100, 20);
      rep.recordSuccess('a', 100, 30);
      expect(rep.getScore('a').avgCost).toBe(20);
    });

    it('should round to 2 decimal places', () => {
      rep.recordSuccess('a', 100, 1);
      rep.recordSuccess('a', 100, 2);
      rep.recordSuccess('a', 100, 3);
      // Average = 2.0
      expect(rep.getScore('a').avgCost).toBe(2);
    });

    it('should handle zero costs', () => {
      rep.recordSuccess('a', 100, 0);
      rep.recordSuccess('a', 100, 0);
      expect(rep.getScore('a').avgCost).toBe(0);
    });

    it('should handle fractional costs', () => {
      rep.recordSuccess('a', 100, 0.1);
      rep.recordSuccess('a', 100, 0.2);
      expect(rep.getScore('a').avgCost).toBe(0.15);
    });
  });

  describe('reputation-adjusted bid scoring', () => {
    it('should handle zero cost (divides by cost+1=1)', () => {
      const score = rep.getReputationAdjustedBidScore('agent', 0.8, 0);
      // baseScore = 0.8 / (0+1) = 0.8
      // unknown agent: overall 0.5, multiplier = 0.5 + 0.5 = 1.0
      expect(score).toBe(0.8);
    });

    it('should handle zero confidence', () => {
      const score = rep.getReputationAdjustedBidScore('agent', 0, 10);
      expect(score).toBe(0);
    });

    it('should handle very high cost', () => {
      const score = rep.getReputationAdjustedBidScore('agent', 1.0, 1000000);
      expect(score).toBeCloseTo(0, 4);
    });

    it('should handle confidence of 1.0 with cost 0 for perfect reputation', () => {
      for (let i = 0; i < 20; i++) {
        rep.recordSuccess('perfect', 1000, 1);
      }
      const score = rep.getReputationAdjustedBidScore('perfect', 1.0, 0);
      // baseScore = 1.0 / 1 = 1.0
      // perfect agent: overallScore = 1.0, multiplier = 1.5
      expect(score).toBe(1.5);
    });

    it('should produce monotonically increasing scores with increasing reputation', () => {
      const scores: number[] = [];
      for (let i = 1; i <= 20; i++) {
        const agentId = `agent-${i}`;
        for (let j = 0; j < i; j++) {
          rep.recordSuccess(agentId, 1000, 1);
        }
        scores.push(rep.getReputationAdjustedBidScore(agentId, 0.8, 5));
      }

      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]!);
      }
    });

    it('should produce lower score for failed agents vs unknown', () => {
      for (let i = 0; i < 5; i++) {
        rep.recordFailure('bad');
      }
      const badScore = rep.getReputationAdjustedBidScore('bad', 0.8, 5);
      const unknownScore = rep.getReputationAdjustedBidScore('unknown', 0.8, 5);
      expect(badScore).toBeLessThan(unknownScore);
    });

    it('should handle negative (invalid) confidence gracefully', () => {
      const score = rep.getReputationAdjustedBidScore('agent', -0.5, 5);
      // Result will be negative but should not throw
      expect(typeof score).toBe('number');
      expect(isFinite(score)).toBe(true);
    });

    it('should handle negative cost', () => {
      // cost+1 = 0 would be division by zero, but -1+1=0
      // With cost=-1, cost+1=0, causes Infinity
      const score = rep.getReputationAdjustedBidScore('agent', 0.8, -1);
      // 0.8 / (-1+1) = 0.8/0 = Infinity
      expect(score).toBe(Infinity);
    });
  });

  describe('record state consistency', () => {
    it('should maintain totalTasks = completedTasks + failedTasks', () => {
      rep.recordSuccess('a', 100, 1);
      rep.recordSuccess('a', 200, 2);
      rep.recordFailure('a');
      rep.recordSuccess('a', 300, 3);
      rep.recordFailure('a');

      const record = rep.getRecord('a')!;
      expect(record.totalTasks).toBe(record.completedTasks + record.failedTasks);
      expect(record.totalTasks).toBe(5);
      expect(record.completedTasks).toBe(3);
      expect(record.failedTasks).toBe(2);
    });

    it('should accumulate totalExecutionTime correctly', () => {
      rep.recordSuccess('a', 100, 1);
      rep.recordSuccess('a', 200, 1);
      rep.recordSuccess('a', 300, 1);
      expect(rep.getRecord('a')!.totalExecutionTime).toBe(600);
    });

    it('should accumulate totalCost correctly', () => {
      rep.recordSuccess('a', 100, 10);
      rep.recordSuccess('a', 100, 20);
      rep.recordSuccess('a', 100, 30);
      expect(rep.getRecord('a')!.totalCost).toBe(60);
    });

    it('should update lastUpdated on success', () => {
      const before = Date.now();
      rep.recordSuccess('a', 100, 1);
      const after = Date.now();
      const record = rep.getRecord('a')!;
      expect(record.lastUpdated).toBeGreaterThanOrEqual(before);
      expect(record.lastUpdated).toBeLessThanOrEqual(after);
    });

    it('should update lastUpdated on failure', () => {
      const before = Date.now();
      rep.recordFailure('a');
      const after = Date.now();
      const record = rep.getRecord('a')!;
      expect(record.lastUpdated).toBeGreaterThanOrEqual(before);
      expect(record.lastUpdated).toBeLessThanOrEqual(after);
    });
  });

  describe('multiple agents isolation', () => {
    it('should track agents independently', () => {
      rep.recordSuccess('agent-a', 100, 5);
      rep.recordFailure('agent-b');

      expect(rep.getScore('agent-a').successRate).toBe(1);
      expect(rep.getScore('agent-b').successRate).toBe(0);
    });

    it('should reset one agent without affecting others', () => {
      rep.recordSuccess('agent-a', 100, 5);
      rep.recordSuccess('agent-b', 200, 10);

      rep.reset('agent-a');

      expect(rep.getRecord('agent-a')).toBeUndefined();
      expect(rep.getRecord('agent-b')).toBeDefined();
      expect(rep.getTrackedAgentCount()).toBe(1);
    });

    it('should sort multiple agents correctly in getAllScores', () => {
      // Perfect agent
      for (let i = 0; i < 20; i++) {
        rep.recordSuccess('perfect', 1000, 1);
      }

      // Good agent
      for (let i = 0; i < 10; i++) {
        rep.recordSuccess('good', 1000, 1);
      }
      rep.recordFailure('good');

      // Bad agent
      for (let i = 0; i < 10; i++) {
        rep.recordFailure('bad');
      }

      const scores = rep.getAllScores();
      expect(scores[0]!.agentId).toBe('perfect');
      expect(scores[scores.length - 1]!.agentId).toBe('bad');

      // Check descending order
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]!.overallScore).toBeLessThanOrEqual(scores[i - 1]!.overallScore);
      }
    });
  });

  describe('edge case: many operations', () => {
    it('should handle 1000 successes without degradation', () => {
      for (let i = 0; i < 1000; i++) {
        rep.recordSuccess('heavy', 1000 + Math.random() * 100, 1);
      }
      const score = rep.getScore('heavy');
      expect(score.overallScore).toBeGreaterThan(0.9);
      expect(score.taskCount).toBe(1000);
      expect(isFinite(score.avgExecutionTime)).toBe(true);
      expect(isFinite(score.avgCost)).toBe(true);
    });

    it('should handle alternating success/failure', () => {
      for (let i = 0; i < 100; i++) {
        rep.recordSuccess('alt', 1000, 1);
        rep.recordFailure('alt');
      }
      const score = rep.getScore('alt');
      expect(score.successRate).toBe(0.5);
      expect(score.taskCount).toBe(200);
    });
  });
});
