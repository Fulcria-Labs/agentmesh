import { ReputationManager } from '../core/reputation';

describe('ReputationManager', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  describe('new agent (no history)', () => {
    it('returns neutral score for unknown agent', () => {
      const score = reputation.getScore('unknown-agent');
      expect(score.overallScore).toBe(0.5);
      expect(score.successRate).toBe(0);
      expect(score.taskCount).toBe(0);
      expect(score.reliability).toBe(0.5);
    });

    it('returns undefined record for unknown agent', () => {
      expect(reputation.getRecord('unknown-agent')).toBeUndefined();
    });
  });

  describe('recording successes', () => {
    it('records a successful task completion', () => {
      reputation.recordSuccess('agent-1', 1000, 5);
      const record = reputation.getRecord('agent-1');
      expect(record).toBeDefined();
      expect(record!.totalTasks).toBe(1);
      expect(record!.completedTasks).toBe(1);
      expect(record!.failedTasks).toBe(0);
      expect(record!.totalExecutionTime).toBe(1000);
      expect(record!.totalCost).toBe(5);
    });

    it('accumulates multiple successes', () => {
      reputation.recordSuccess('agent-1', 1000, 5);
      reputation.recordSuccess('agent-1', 2000, 10);
      reputation.recordSuccess('agent-1', 1500, 7);
      const record = reputation.getRecord('agent-1');
      expect(record!.totalTasks).toBe(3);
      expect(record!.completedTasks).toBe(3);
      expect(record!.totalExecutionTime).toBe(4500);
      expect(record!.totalCost).toBe(22);
    });

    it('increases score with more successes', () => {
      reputation.recordSuccess('agent-1', 1000, 5);
      const score1 = reputation.getScore('agent-1').overallScore;

      reputation.recordSuccess('agent-1', 1000, 5);
      reputation.recordSuccess('agent-1', 1000, 5);
      const score3 = reputation.getScore('agent-1').overallScore;

      expect(score3).toBeGreaterThanOrEqual(score1);
    });
  });

  describe('recording failures', () => {
    it('records a failed task', () => {
      reputation.recordFailure('agent-1');
      const record = reputation.getRecord('agent-1');
      expect(record!.totalTasks).toBe(1);
      expect(record!.completedTasks).toBe(0);
      expect(record!.failedTasks).toBe(1);
    });

    it('lowers score when failures occur', () => {
      // Agent with perfect record
      for (let i = 0; i < 5; i++) {
        reputation.recordSuccess('good-agent', 1000, 5);
      }

      // Agent with mixed record
      for (let i = 0; i < 3; i++) {
        reputation.recordSuccess('mixed-agent', 1000, 5);
      }
      reputation.recordFailure('mixed-agent');
      reputation.recordFailure('mixed-agent');

      const goodScore = reputation.getScore('good-agent');
      const mixedScore = reputation.getScore('mixed-agent');

      expect(goodScore.overallScore).toBeGreaterThan(mixedScore.overallScore);
      expect(goodScore.successRate).toBe(1);
      expect(mixedScore.successRate).toBe(0.6);
    });
  });

  describe('score computation', () => {
    it('calculates correct success rate', () => {
      reputation.recordSuccess('agent-1', 1000, 5);
      reputation.recordSuccess('agent-1', 1000, 5);
      reputation.recordFailure('agent-1');
      const score = reputation.getScore('agent-1');
      expect(score.successRate).toBeCloseTo(0.667, 2);
    });

    it('calculates correct average execution time', () => {
      reputation.recordSuccess('agent-1', 1000, 5);
      reputation.recordSuccess('agent-1', 2000, 5);
      reputation.recordSuccess('agent-1', 3000, 5);
      const score = reputation.getScore('agent-1');
      expect(score.avgExecutionTime).toBe(2000);
    });

    it('calculates correct average cost', () => {
      reputation.recordSuccess('agent-1', 1000, 10);
      reputation.recordSuccess('agent-1', 1000, 20);
      const score = reputation.getScore('agent-1');
      expect(score.avgCost).toBe(15);
    });

    it('calculates high reliability for consistent execution times', () => {
      // Very consistent times (low variance)
      reputation.recordSuccess('consistent', 1000, 5);
      reputation.recordSuccess('consistent', 1000, 5);
      reputation.recordSuccess('consistent', 1000, 5);
      reputation.recordSuccess('consistent', 1000, 5);

      const score = reputation.getScore('consistent');
      expect(score.reliability).toBe(1); // Perfect consistency
    });

    it('calculates lower reliability for inconsistent execution times', () => {
      // Highly variable times
      reputation.recordSuccess('inconsistent', 100, 5);
      reputation.recordSuccess('inconsistent', 5000, 5);
      reputation.recordSuccess('inconsistent', 200, 5);
      reputation.recordSuccess('inconsistent', 8000, 5);

      const score = reputation.getScore('inconsistent');
      expect(score.reliability).toBeLessThan(0.5);
    });

    it('overall score stays between 0 and 1', () => {
      // Pure success agent
      for (let i = 0; i < 30; i++) {
        reputation.recordSuccess('max-agent', 1000, 5);
      }
      expect(reputation.getScore('max-agent').overallScore).toBeLessThanOrEqual(1);

      // Pure failure agent
      for (let i = 0; i < 10; i++) {
        reputation.recordFailure('min-agent');
      }
      expect(reputation.getScore('min-agent').overallScore).toBeGreaterThanOrEqual(0);
    });

    it('experience bonus increases with task count up to 20', () => {
      reputation.recordSuccess('new', 1000, 5);
      const newScore = reputation.getScore('new').overallScore;

      for (let i = 0; i < 19; i++) {
        reputation.recordSuccess('experienced', 1000, 5);
      }
      // Must add one more for 'experienced' to have 20
      reputation.recordSuccess('experienced', 1000, 5);
      const expScore = reputation.getScore('experienced').overallScore;

      expect(expScore).toBeGreaterThan(newScore);
    });
  });

  describe('reputation-adjusted bid scoring', () => {
    it('boosts score for high-reputation agents', () => {
      // Build up good reputation
      for (let i = 0; i < 10; i++) {
        reputation.recordSuccess('trusted', 1000, 5);
      }

      const trustedScore = reputation.getReputationAdjustedBidScore('trusted', 0.8, 10);
      const unknownScore = reputation.getReputationAdjustedBidScore('unknown', 0.8, 10);

      expect(trustedScore).toBeGreaterThan(unknownScore);
    });

    it('penalizes score for low-reputation agents', () => {
      // Build up bad reputation
      for (let i = 0; i < 10; i++) {
        reputation.recordFailure('unreliable');
      }

      const unreliableScore = reputation.getReputationAdjustedBidScore('unreliable', 0.8, 10);
      const unknownScore = reputation.getReputationAdjustedBidScore('unknown', 0.8, 10);

      expect(unreliableScore).toBeLessThan(unknownScore);
    });

    it('multiplier ranges from 0.5x to 1.5x', () => {
      // Score for agent with overall reputation 0 → multiplier 0.5
      // Score for agent with overall reputation 1 → multiplier 1.5
      for (let i = 0; i < 20; i++) {
        reputation.recordSuccess('perfect', 1000, 5);
      }

      const perfectScore = reputation.getReputationAdjustedBidScore('perfect', 1.0, 0);
      const unknownScore = reputation.getReputationAdjustedBidScore('brand-new', 1.0, 0);

      // Perfect agent has ~1.5x multiplier, unknown has ~1.0x (0.5 + 0.5)
      expect(perfectScore).toBeGreaterThan(unknownScore);
    });
  });

  describe('getAllScores', () => {
    it('returns empty array when no agents tracked', () => {
      expect(reputation.getAllScores()).toEqual([]);
    });

    it('returns scores sorted by overall score descending', () => {
      reputation.recordSuccess('good', 1000, 5);
      reputation.recordSuccess('good', 1000, 5);
      reputation.recordSuccess('good', 1000, 5);

      reputation.recordSuccess('ok', 1000, 5);
      reputation.recordFailure('ok');

      reputation.recordFailure('bad');

      const scores = reputation.getAllScores();
      expect(scores.length).toBe(3);
      expect(scores[0].agentId).toBe('good');
      expect(scores[scores.length - 1].agentId).toBe('bad');
    });
  });

  describe('reset', () => {
    it('clears agent reputation data', () => {
      reputation.recordSuccess('agent-1', 1000, 5);
      expect(reputation.getRecord('agent-1')).toBeDefined();

      reputation.reset('agent-1');
      expect(reputation.getRecord('agent-1')).toBeUndefined();
      expect(reputation.getScore('agent-1').overallScore).toBe(0.5); // Back to neutral
    });
  });

  describe('getTrackedAgentCount', () => {
    it('tracks agent count', () => {
      expect(reputation.getTrackedAgentCount()).toBe(0);
      reputation.recordSuccess('agent-1', 1000, 5);
      expect(reputation.getTrackedAgentCount()).toBe(1);
      reputation.recordFailure('agent-2');
      expect(reputation.getTrackedAgentCount()).toBe(2);
    });
  });

  describe('events', () => {
    it('emits reputation:updated on success', (done) => {
      reputation.on('reputation:updated', (score) => {
        expect(score.agentId).toBe('agent-1');
        expect(score.taskCount).toBe(1);
        done();
      });
      reputation.recordSuccess('agent-1', 1000, 5);
    });

    it('emits reputation:updated on failure', (done) => {
      reputation.on('reputation:updated', (score) => {
        expect(score.agentId).toBe('agent-1');
        done();
      });
      reputation.recordFailure('agent-1');
    });
  });
});
