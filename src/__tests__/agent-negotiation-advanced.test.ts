/**
 * AgentNegotiation - Advanced test suite
 *
 * Covers: multi-round negotiations, complex workflows, edge cases,
 * concurrent negotiations, deadline handling, strategy comparisons,
 * statistical validation, and integration scenarios.
 */

import {
  AgentNegotiation,
  NegotiationPhase,
  ResolutionStrategy,
  NegotiationOffer,
} from '../core/agent-negotiation';
import { ReputationManager } from '../core/reputation';

// ─── Multi-Round Negotiation Flows ──────────────────────────────────────────

describe('AgentNegotiation - Multi-Round Flows', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
      maxPriceAdjustment: 0.5,
    });
  });

  afterEach(() => {
    neg.destroy();
  });

  it('supports full offer-counter-accept flow', () => {
    const n = neg.createNegotiation({
      initiatorId: 'requester',
      capability: 'data_analysis',
      description: 'Analyze sales data',
      maxRounds: 5,
    });

    // Round 1: Agent offers
    const offer1 = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'analyst',
      toAgentId: 'requester',
      proposedPrice: 30,
      estimatedDuration: 10000,
      confidence: 0.85,
    });

    expect(neg.getNegotiation(n.id)!.currentRound).toBe(1);

    // Round 2: Requester counters
    const counter1 = neg.submitCounterOffer({
      negotiationId: n.id,
      originalOfferId: offer1.id,
      fromAgentId: 'requester',
      toAgentId: 'analyst',
      proposedPrice: 20,
      estimatedDuration: 8000,
      confidence: 0.9,
    });

    expect(counter1.round).toBe(2);
    expect(neg.getNegotiation(n.id)!.phase).toBe(NegotiationPhase.COUNTER_OFFERED);

    // Round 3: Analyst counters again
    const counter2 = neg.submitCounterOffer({
      negotiationId: n.id,
      originalOfferId: counter1.id,
      fromAgentId: 'analyst',
      toAgentId: 'requester',
      proposedPrice: 25,
      estimatedDuration: 9000,
      confidence: 0.88,
    });

    expect(counter2.round).toBe(3);

    // Requester accepts
    neg.acceptOffer(n.id, counter2.id, 'requester');

    const result = neg.getNegotiation(n.id)!;
    expect(result.phase).toBe(NegotiationPhase.ACCEPTED);
    expect(result.acceptedOffer!.proposedPrice).toBe(25);
    expect(result.currentRound).toBe(3);
  });

  it('supports multiple bidders competing', () => {
    const n = neg.createNegotiation({
      initiatorId: 'requester',
      capability: 'web_research',
      description: 'Find competitors',
      maxRounds: 10,
      strategy: ResolutionStrategy.LOWEST_COST,
    });

    // Multiple agents submit competing offers
    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'agent-a',
      toAgentId: 'requester',
      proposedPrice: 25,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'agent-b',
      toAgentId: 'requester',
      proposedPrice: 15,
      estimatedDuration: 8000,
      confidence: 0.8,
    });

    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'agent-c',
      toAgentId: 'requester',
      proposedPrice: 20,
      estimatedDuration: 3000,
      confidence: 0.95,
    });

    const winner = neg.autoResolve(n.id);
    expect(winner!.fromAgentId).toBe('agent-b'); // Lowest cost: 15
    expect(neg.getNegotiation(n.id)!.participants).toHaveLength(4); // requester + 3 agents
  });

  it('supports negotiation ending in rejection after max rounds', () => {
    const n = neg.createNegotiation({
      initiatorId: 'req',
      capability: 'test',
      description: 'test',
      maxRounds: 2,
    });

    const o1 = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'bidder',
      toAgentId: 'req',
      proposedPrice: 50,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    // Counter (round 2)
    const o2 = neg.submitCounterOffer({
      negotiationId: n.id,
      originalOfferId: o1.id,
      fromAgentId: 'req',
      toAgentId: 'bidder',
      proposedPrice: 30,
      estimatedDuration: 4000,
      confidence: 0.85,
    });

    // Round 2 is max, reject the counter
    neg.rejectOffer(n.id, o2.id, 'bidder', 'Price too low');

    const result = neg.getNegotiation(n.id)!;
    expect(result.phase).toBe(NegotiationPhase.REJECTED);
    // The rejection reason is the reason passed to rejectOffer when it's the last one
    expect(result.rejectionReason).toBe('Price too low');
  });

  it('tracks round progression correctly through complex flow', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 10,
    });

    // Round 1: Two parallel offers
    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 20,
      estimatedDuration: 5000,
      confidence: 0.8,
    });

    expect(neg.getNegotiation(n.id)!.currentRound).toBe(1);

    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'c',
      toAgentId: 'a',
      proposedPrice: 25,
      estimatedDuration: 3000,
      confidence: 0.9,
    });

    expect(neg.getNegotiation(n.id)!.currentRound).toBe(2);

    // Round 3: Another offer
    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'd',
      toAgentId: 'a',
      proposedPrice: 15,
      estimatedDuration: 7000,
      confidence: 0.7,
    });

    expect(neg.getNegotiation(n.id)!.currentRound).toBe(3);
    expect(neg.getOffers(n.id)).toHaveLength(3);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe('AgentNegotiation - Edge Cases', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });
  });

  afterEach(() => {
    neg.destroy();
  });

  it('handles negotiation with maxRounds = 1', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 1,
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    // Can accept it
    neg.acceptOffer(n.id, offer.id, 'a');
    expect(neg.getNegotiation(n.id)!.phase).toBe(NegotiationPhase.ACCEPTED);
  });

  it('handles zero-cost negotiation', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 0,
      estimatedDuration: 0,
      confidence: 0.5,
    });

    const score = neg.scoreOffer(offer);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('handles very high price offers', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 999999,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    expect(offer.proposedPrice).toBe(999999);
    const score = neg.scoreOffer(offer);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('handles negotiation with minPrice = maxPrice', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      minPrice: 10,
      maxPrice: 10,
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    expect(offer.proposedPrice).toBe(10);
  });

  it('handles single-participant negotiation', () => {
    const n = neg.createNegotiation({
      initiatorId: 'solo',
      capability: 'test',
      description: 'test',
    });

    expect(n.participants).toHaveLength(1);
  });

  it('handles very long description', () => {
    const longDesc = 'x'.repeat(10000);
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: longDesc,
    });

    expect(n.description).toBe(longDesc);
  });

  it('handles special characters in terms', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
      terms: {
        'special-key': 'value with "quotes"',
        nested: { a: 1, b: [1, 2, 3] },
        empty: '',
        unicode: '\u00e9\u00e8\u00ea',
      },
    });

    expect(offer.terms['special-key']).toBe('value with "quotes"');
  });

  it('allows counter-offer from third party', () => {
    const n = neg.createNegotiation({
      initiatorId: 'requester',
      capability: 'test',
      description: 'test',
      maxRounds: 5,
    });

    const o1 = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'agent-a',
      toAgentId: 'requester',
      proposedPrice: 20,
      estimatedDuration: 5000,
      confidence: 0.8,
    });

    // Third-party counter-offer
    const counter = neg.submitCounterOffer({
      negotiationId: n.id,
      originalOfferId: o1.id,
      fromAgentId: 'agent-b',
      toAgentId: 'agent-a',
      proposedPrice: 18,
      estimatedDuration: 4000,
      confidence: 0.85,
    });

    expect(counter.fromAgentId).toBe('agent-b');
    expect(neg.getNegotiation(n.id)!.participants).toContain('agent-b');
  });

  it('handles negotiation with all priority levels', () => {
    const priorities: Array<'low' | 'medium' | 'high' | 'critical'> = ['low', 'medium', 'high', 'critical'];

    for (const priority of priorities) {
      const n = neg.createNegotiation({
        initiatorId: 'a',
        capability: 'test',
        description: `test ${priority}`,
        priority,
      });
      expect(n.priority).toBe(priority);
    }
  });

  it('counter-offer with zero original price skips adjustment check', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 5,
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 0,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    // Counter with any price should work since original is 0
    const counter = neg.submitCounterOffer({
      negotiationId: n.id,
      originalOfferId: offer.id,
      fromAgentId: 'a',
      toAgentId: 'b',
      proposedPrice: 100,
      estimatedDuration: 3000,
      confidence: 0.85,
    });

    expect(counter.proposedPrice).toBe(100);
  });

  it('handles metadata in negotiation', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      metadata: {
        source: 'mesh',
        version: '2.0',
        tags: ['urgent', 'research'],
      },
    });

    expect(n.metadata.source).toBe('mesh');
    expect((n.metadata.tags as string[])).toContain('urgent');
  });
});

// ─── Concurrent Negotiations ────────────────────────────────────────────────

describe('AgentNegotiation - Concurrent Negotiations', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
      maxConcurrentPerAgent: 10,
    });
  });

  afterEach(() => {
    neg.destroy();
  });

  it('tracks multiple active negotiations independently', () => {
    const n1 = neg.createNegotiation({
      initiatorId: 'agent-1',
      capability: 'research',
      description: 'Research 1',
    });

    const n2 = neg.createNegotiation({
      initiatorId: 'agent-1',
      capability: 'analysis',
      description: 'Analysis 1',
    });

    neg.submitOffer({
      negotiationId: n1.id,
      fromAgentId: 'agent-2',
      toAgentId: 'agent-1',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    neg.submitOffer({
      negotiationId: n2.id,
      fromAgentId: 'agent-3',
      toAgentId: 'agent-1',
      proposedPrice: 20,
      estimatedDuration: 3000,
      confidence: 0.85,
    });

    expect(neg.getNegotiation(n1.id)!.offers).toHaveLength(1);
    expect(neg.getNegotiation(n2.id)!.offers).toHaveLength(1);
    expect(neg.getActiveNegotiationsForAgent('agent-1')).toHaveLength(2);
  });

  it('same agent participates in multiple negotiations', () => {
    const n1 = neg.createNegotiation({
      initiatorId: 'agent-1',
      capability: 'test',
      description: 'test 1',
    });

    const n2 = neg.createNegotiation({
      initiatorId: 'agent-2',
      capability: 'test',
      description: 'test 2',
    });

    // agent-3 offers in both
    neg.submitOffer({
      negotiationId: n1.id,
      fromAgentId: 'agent-3',
      toAgentId: 'agent-1',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    neg.submitOffer({
      negotiationId: n2.id,
      fromAgentId: 'agent-3',
      toAgentId: 'agent-2',
      proposedPrice: 15,
      estimatedDuration: 3000,
      confidence: 0.85,
    });

    const agent3Negotiations = neg.getNegotiationsForAgent('agent-3');
    expect(agent3Negotiations).toHaveLength(2);
  });

  it('accepting one negotiation does not affect others', () => {
    const n1 = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test 1',
    });

    const n2 = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test 2',
    });

    const o1 = neg.submitOffer({
      negotiationId: n1.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    neg.submitOffer({
      negotiationId: n2.id,
      fromAgentId: 'c',
      toAgentId: 'a',
      proposedPrice: 20,
      estimatedDuration: 3000,
      confidence: 0.85,
    });

    neg.acceptOffer(n1.id, o1.id, 'a');

    expect(neg.getNegotiation(n1.id)!.phase).toBe(NegotiationPhase.ACCEPTED);
    expect(neg.getNegotiation(n2.id)!.phase).toBe(NegotiationPhase.IN_PROGRESS);
  });

  it('concurrent limit only counts active negotiations', () => {
    const limited = new AgentNegotiation({
      maxConcurrentPerAgent: 2,
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });

    const n1 = limited.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test 1',
    });

    limited.cancelNegotiation(n1.id, 'a'); // No longer active

    const n2 = limited.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test 2',
    });

    const n3 = limited.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test 3',
    });

    expect(limited.getActiveNegotiationsForAgent('a')).toHaveLength(2);
    limited.destroy();
  });
});

// ─── Strategy Comparison ────────────────────────────────────────────────────

describe('AgentNegotiation - Strategy Comparison', () => {
  let neg: AgentNegotiation;
  const offers: NegotiationOffer[] = [];

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });

    const n = neg.createNegotiation({
      initiatorId: 'req',
      capability: 'test',
      description: 'test',
      maxRounds: 10,
    });

    // Create diverse offers
    offers.length = 0;

    offers.push(neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'cheap-slow',
      toAgentId: 'req',
      proposedPrice: 5,
      estimatedDuration: 30000,
      confidence: 0.7,
    }));

    offers.push(neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'expensive-fast',
      toAgentId: 'req',
      proposedPrice: 50,
      estimatedDuration: 1000,
      confidence: 0.8,
    }));

    offers.push(neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'balanced',
      toAgentId: 'req',
      proposedPrice: 20,
      estimatedDuration: 10000,
      confidence: 0.9,
    }));

    offers.push(neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'confident',
      toAgentId: 'req',
      proposedPrice: 30,
      estimatedDuration: 15000,
      confidence: 0.99,
    }));
  });

  afterEach(() => {
    neg.destroy();
  });

  it('different strategies select different winners', () => {
    const cheapest = neg.selectBestOffer(offers, ResolutionStrategy.LOWEST_COST);
    const fastest = neg.selectBestOffer(offers, ResolutionStrategy.FASTEST);
    const confident = neg.selectBestOffer(offers, ResolutionStrategy.HIGHEST_CONFIDENCE);

    expect(cheapest!.fromAgentId).toBe('cheap-slow');
    expect(fastest!.fromAgentId).toBe('expensive-fast');
    expect(confident!.fromAgentId).toBe('confident');
  });

  it('BEST_SCORE balances multiple factors', () => {
    const best = neg.selectBestOffer(offers, ResolutionStrategy.BEST_SCORE);
    expect(best).toBeDefined();
    // The balanced agent should score well
    // It has moderate price (20), moderate duration (10000), high confidence (0.9)
  });

  it('all strategies handle single offer correctly', () => {
    const single = [offers[0]];
    const strategies = [
      ResolutionStrategy.LOWEST_COST,
      ResolutionStrategy.FASTEST,
      ResolutionStrategy.HIGHEST_CONFIDENCE,
      ResolutionStrategy.BEST_SCORE,
      ResolutionStrategy.HIGHEST_REPUTATION,
    ];

    for (const strategy of strategies) {
      const result = neg.selectBestOffer(single, strategy);
      expect(result).toBe(single[0]);
    }
  });

  it('strategies are deterministic', () => {
    for (let i = 0; i < 5; i++) {
      const result = neg.selectBestOffer(offers, ResolutionStrategy.BEST_SCORE);
      expect(result!.fromAgentId).toBe(
        neg.selectBestOffer(offers, ResolutionStrategy.BEST_SCORE)!.fromAgentId
      );
    }
  });
});

// ─── Scoring Deep Dive ──────────────────────────────────────────────────────

describe('AgentNegotiation - Scoring', () => {
  it('custom weight configuration affects scores', () => {
    const priceHeavy = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
      priceWeight: 0.8,
      confidenceWeight: 0.1,
      durationWeight: 0.05,
      reputationWeight: 0.05,
    });

    const speedHeavy = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
      priceWeight: 0.05,
      confidenceWeight: 0.1,
      durationWeight: 0.8,
      reputationWeight: 0.05,
    });

    const n1 = priceHeavy.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 10,
    });

    const n2 = speedHeavy.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 10,
    });

    // Cheap but slow
    const cheapOffer1 = priceHeavy.submitOffer({
      negotiationId: n1.id,
      fromAgentId: 'cheap',
      toAgentId: 'a',
      proposedPrice: 2,
      estimatedDuration: 50000,
      confidence: 0.5,
    });

    // Expensive but fast
    const fastOffer1 = priceHeavy.submitOffer({
      negotiationId: n1.id,
      fromAgentId: 'fast',
      toAgentId: 'a',
      proposedPrice: 80,
      estimatedDuration: 1000,
      confidence: 0.5,
    });

    const cheapOffer2 = speedHeavy.submitOffer({
      negotiationId: n2.id,
      fromAgentId: 'cheap',
      toAgentId: 'a',
      proposedPrice: 2,
      estimatedDuration: 50000,
      confidence: 0.5,
    });

    const fastOffer2 = speedHeavy.submitOffer({
      negotiationId: n2.id,
      fromAgentId: 'fast',
      toAgentId: 'a',
      proposedPrice: 80,
      estimatedDuration: 1000,
      confidence: 0.5,
    });

    // Price-heavy should favor cheap
    expect(priceHeavy.scoreOffer(cheapOffer1)).toBeGreaterThan(priceHeavy.scoreOffer(fastOffer1));

    // Speed-heavy should favor fast
    expect(speedHeavy.scoreOffer(fastOffer2)).toBeGreaterThan(speedHeavy.scoreOffer(cheapOffer2));

    priceHeavy.destroy();
    speedHeavy.destroy();
  });

  it('reputation weighting can be disabled', () => {
    const rep = new ReputationManager();
    for (let i = 0; i < 20; i++) {
      rep.recordSuccess('good-agent', 1000, 5);
    }
    for (let i = 0; i < 20; i++) {
      rep.recordFailure('bad-agent');
    }

    const withRep = new AgentNegotiation(
      { defaultDeadlineMs: 0, defaultOfferExpiryMs: 0, useReputationWeighting: true },
      rep,
    );
    const withoutRep = new AgentNegotiation(
      { defaultDeadlineMs: 0, defaultOfferExpiryMs: 0, useReputationWeighting: false },
      rep,
    );

    const n1 = withRep.createNegotiation({ initiatorId: 'a', capability: 'test', description: 'test' });
    const n2 = withoutRep.createNegotiation({ initiatorId: 'a', capability: 'test', description: 'test' });

    const goodOffer1 = withRep.submitOffer({
      negotiationId: n1.id,
      fromAgentId: 'good-agent',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    const badOffer1 = withRep.submitOffer({
      negotiationId: n1.id,
      fromAgentId: 'bad-agent',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    const goodOffer2 = withoutRep.submitOffer({
      negotiationId: n2.id,
      fromAgentId: 'good-agent',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    const badOffer2 = withoutRep.submitOffer({
      negotiationId: n2.id,
      fromAgentId: 'bad-agent',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    // With reputation: scores differ
    const goodScoreWithRep = withRep.scoreOffer(goodOffer1);
    const badScoreWithRep = withRep.scoreOffer(badOffer1);
    expect(goodScoreWithRep).toBeGreaterThan(badScoreWithRep);

    // Without reputation: scores same (reputation uses neutral 0.5)
    const goodScoreWithoutRep = withoutRep.scoreOffer(goodOffer2);
    const badScoreWithoutRep = withoutRep.scoreOffer(badOffer2);
    expect(goodScoreWithoutRep).toBe(badScoreWithoutRep);

    withRep.destroy();
    withoutRep.destroy();
  });
});

// ─── Event Emissions ────────────────────────────────────────────────────────

describe('AgentNegotiation - Events', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });
  });

  afterEach(() => {
    neg.destroy();
  });

  it('emits all lifecycle events in correct order', () => {
    const events: string[] = [];

    neg.on('negotiation:created', () => events.push('created'));
    neg.on('negotiation:offer', () => events.push('offer'));
    neg.on('negotiation:counterOffer', () => events.push('counterOffer'));
    neg.on('negotiation:accepted', () => events.push('accepted'));

    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 5,
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 20,
      estimatedDuration: 5000,
      confidence: 0.8,
    });

    const counter = neg.submitCounterOffer({
      negotiationId: n.id,
      originalOfferId: offer.id,
      fromAgentId: 'a',
      toAgentId: 'b',
      proposedPrice: 15,
      estimatedDuration: 4000,
      confidence: 0.85,
    });

    neg.acceptOffer(n.id, counter.id, 'b');

    expect(events).toEqual(['created', 'offer', 'counterOffer', 'accepted']);
  });

  it('emits cancelled event with negotiation data', () => {
    const handler = jest.fn();
    neg.on('negotiation:cancelled', handler);

    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    neg.cancelNegotiation(n.id, 'a', 'Changed mind');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].rejectionReason).toBe('Changed mind');
  });

  it('emits offerRejected with details', () => {
    const handler = jest.fn();
    neg.on('negotiation:offerRejected', handler);

    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    neg.rejectOffer(n.id, offer.id, 'a', 'Not good enough');

    expect(handler.mock.calls[0][0].reason).toBe('Not good enough');
    expect(handler.mock.calls[0][0].offer.id).toBe(offer.id);
  });

  it('emits multiple events for batch operations', () => {
    const offerEvents: string[] = [];
    neg.on('negotiation:offer', (offer) => offerEvents.push(offer.fromAgentId));

    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 10,
    });

    for (let i = 0; i < 5; i++) {
      neg.submitOffer({
        negotiationId: n.id,
        fromAgentId: `agent-${i}`,
        toAgentId: 'a',
        proposedPrice: 10 + i,
        estimatedDuration: 5000,
        confidence: 0.9,
      });
    }

    expect(offerEvents).toHaveLength(5);
    expect(offerEvents).toContain('agent-0');
    expect(offerEvents).toContain('agent-4');
  });
});

// ─── Statistics Deep Dive ───────────────────────────────────────────────────

describe('AgentNegotiation - Statistics', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });
  });

  afterEach(() => {
    neg.destroy();
  });

  it('tracks expired and cancelled counts', () => {
    // Create and cancel
    const n1 = neg.createNegotiation({
      initiatorId: 'agent-1',
      capability: 'test',
      description: 'test 1',
    });
    neg.cancelNegotiation(n1.id, 'agent-1');

    // Create another
    neg.createNegotiation({
      initiatorId: 'agent-1',
      capability: 'test',
      description: 'test 2',
    });

    const stats = neg.getAgentStats('agent-1');
    expect(stats.cancelledCount).toBe(1);
    expect(stats.totalNegotiations).toBe(2);
  });

  it('averageRoundsToAccept calculates correctly', () => {
    for (let rounds = 1; rounds <= 3; rounds++) {
      const n = neg.createNegotiation({
        initiatorId: 'a',
        capability: 'test',
        description: `test ${rounds}`,
        maxRounds: 10,
      });

      let lastOffer;
      for (let r = 0; r < rounds; r++) {
        lastOffer = neg.submitOffer({
          negotiationId: n.id,
          fromAgentId: 'b',
          toAgentId: 'a',
          proposedPrice: 10,
          estimatedDuration: 5000,
          confidence: 0.9,
        });
      }

      neg.acceptOffer(n.id, lastOffer!.id, 'a');
    }

    const stats = neg.getAgentStats('b');
    expect(stats.wonCount).toBe(3);
    // Rounds: 1, 2, 3 -> average = 2
    expect(stats.averageRoundsToAccept).toBe(2);
  });

  it('winRate handles zero total competed', () => {
    neg.createNegotiation({
      initiatorId: 'agent-1',
      capability: 'test',
      description: 'test',
    });

    const stats = neg.getAgentStats('agent-1');
    expect(stats.winRate).toBe(0);
  });

  it('stats handle agent participating as initiator and bidder', () => {
    // agent-1 initiates n1, bids on n2
    const n1 = neg.createNegotiation({
      initiatorId: 'agent-1',
      capability: 'test',
      description: 'test 1',
    });

    const n2 = neg.createNegotiation({
      initiatorId: 'agent-2',
      capability: 'test',
      description: 'test 2',
      participants: ['agent-1'],
    });

    const o1 = neg.submitOffer({
      negotiationId: n2.id,
      fromAgentId: 'agent-1',
      toAgentId: 'agent-2',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    neg.acceptOffer(n2.id, o1.id, 'agent-2');

    const stats = neg.getAgentStats('agent-1');
    expect(stats.initiatedCount).toBe(1);
    expect(stats.participatedCount).toBe(1);
    expect(stats.wonCount).toBe(1);
  });
});

// ─── Boundary Values ────────────────────────────────────────────────────────

describe('AgentNegotiation - Boundary Values', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });
  });

  afterEach(() => {
    neg.destroy();
  });

  it('confidence exactly at minimum threshold', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.1, // Exactly at default min
    });

    expect(offer.confidence).toBe(0.1);
  });

  it('confidence exactly at 1.0', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 1.0,
    });

    expect(offer.confidence).toBe(1.0);
  });

  it('maxRounds exactly at 1', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 1,
    });

    expect(n.maxRounds).toBe(1);
  });

  it('maxRounds exactly at 100', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 100,
    });

    expect(n.maxRounds).toBe(100);
  });

  it('price at exactly maxPrice', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxPrice: 50,
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 50,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    expect(offer.proposedPrice).toBe(50);
  });

  it('price exceeding maxPrice by 0.01', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxPrice: 50,
    });

    expect(() =>
      neg.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'b',
        toAgentId: 'a',
        proposedPrice: 50.01,
        estimatedDuration: 5000,
        confidence: 0.9,
      })
    ).toThrow('exceeds maximum');
  });

  it('counter-offer at exact price adjustment limit', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 5,
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 100,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    // 50% adjustment from 100 = 50 or 150
    const counter = neg.submitCounterOffer({
      negotiationId: n.id,
      originalOfferId: offer.id,
      fromAgentId: 'a',
      toAgentId: 'b',
      proposedPrice: 50, // Exactly 50% reduction
      estimatedDuration: 4000,
      confidence: 0.85,
    });

    expect(counter.proposedPrice).toBe(50);
  });

  it('counter-offer exceeding price adjustment limit', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 5,
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 100,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    expect(() =>
      neg.submitCounterOffer({
        negotiationId: n.id,
        originalOfferId: offer.id,
        fromAgentId: 'a',
        toAgentId: 'b',
        proposedPrice: 49, // 51% reduction - exceeds 50% limit
        estimatedDuration: 4000,
        confidence: 0.85,
      })
    ).toThrow('exceeds limit');
  });
});

// ─── Integration with ReputationManager ─────────────────────────────────────

describe('AgentNegotiation - Reputation Integration', () => {
  it('reputation affects scoring proportionally', () => {
    const rep = new ReputationManager();

    // Build diverse reputation profiles
    for (let i = 0; i < 20; i++) {
      rep.recordSuccess('excellent', 1000, 5);
    }
    for (let i = 0; i < 10; i++) {
      rep.recordSuccess('good', 1000, 5);
    }
    for (let i = 0; i < 5; i++) {
      rep.recordSuccess('good', 1000, 5);
      rep.recordFailure('good');
    }

    const neg = new AgentNegotiation(
      { defaultDeadlineMs: 0, defaultOfferExpiryMs: 0 },
      rep,
    );

    const n = neg.createNegotiation({
      initiatorId: 'req',
      capability: 'test',
      description: 'test',
    });

    const excellentOffer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'excellent',
      toAgentId: 'req',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    const goodOffer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'good',
      toAgentId: 'req',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    expect(neg.scoreOffer(excellentOffer)).toBeGreaterThan(neg.scoreOffer(goodOffer));
    neg.destroy();
  });

  it('reputation-based auto-resolve picks highest reputation agent', () => {
    const rep = new ReputationManager();
    for (let i = 0; i < 20; i++) {
      rep.recordSuccess('reliable', 1000, 5);
    }
    for (let i = 0; i < 20; i++) {
      rep.recordFailure('flaky');
    }

    const neg = new AgentNegotiation(
      { defaultDeadlineMs: 0, defaultOfferExpiryMs: 0 },
      rep,
    );

    const n = neg.createNegotiation({
      initiatorId: 'req',
      capability: 'test',
      description: 'test',
      strategy: ResolutionStrategy.HIGHEST_REPUTATION,
    });

    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'reliable',
      toAgentId: 'req',
      proposedPrice: 50,
      estimatedDuration: 10000,
      confidence: 0.7,
    });

    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'flaky',
      toAgentId: 'req',
      proposedPrice: 5,
      estimatedDuration: 1000,
      confidence: 0.99,
    });

    const winner = neg.autoResolve(n.id);
    expect(winner!.fromAgentId).toBe('reliable');
    neg.destroy();
  });
});

// ─── MANUAL Strategy ────────────────────────────────────────────────────────

describe('AgentNegotiation - MANUAL Strategy', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });
  });

  afterEach(() => {
    neg.destroy();
  });

  it('MANUAL strategy does not auto-accept in selectBestOffer', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      strategy: ResolutionStrategy.MANUAL,
    });

    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    // selectBestOffer with MANUAL falls through to BEST_SCORE
    const offers = neg.getPendingOffers(n.id);
    const result = neg.selectBestOffer(offers, ResolutionStrategy.MANUAL);
    expect(result).toBeDefined();
  });

  it('MANUAL negotiation requires explicit accept', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      strategy: ResolutionStrategy.MANUAL,
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    // Must explicitly accept
    neg.acceptOffer(n.id, offer.id, 'a');
    expect(neg.getNegotiation(n.id)!.phase).toBe(NegotiationPhase.ACCEPTED);
  });
});

// ─── Expired Offer in AcceptOffer ───────────────────────────────────────────

describe('AgentNegotiation - Expired Offer Handling', () => {
  it('cannot accept an expired offer', () => {
    const neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });

    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
      expiresInMs: 0, // Set a non-timer expiry
    });

    // Manually set expiresAt to past
    const negotiation = neg.getNegotiation(n.id)!;
    const offerObj = negotiation.offers.find(o => o.id === offer.id)!;
    offerObj.expiresAt = Date.now() - 1000;

    expect(() =>
      neg.acceptOffer(n.id, offer.id, 'a')
    ).toThrow('expired');

    neg.destroy();
  });
});

// ─── Accept on Cancelled/Expired Negotiation ────────────────────────────────

describe('AgentNegotiation - Terminal State Guards', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });
  });

  afterEach(() => {
    neg.destroy();
  });

  it('cannot accept on cancelled negotiation', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    neg.cancelNegotiation(n.id, 'a');

    expect(() =>
      neg.acceptOffer(n.id, offer.id, 'a')
    ).toThrow('cancelled');
  });

  it('cannot accept on expired negotiation', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    // Force expired state
    const negotiation = neg.getNegotiation(n.id)!;
    negotiation.phase = NegotiationPhase.EXPIRED;

    expect(() =>
      neg.acceptOffer(n.id, offer.id, 'a')
    ).toThrow('expired');
  });
});

// ─── Large Scale Tests ──────────────────────────────────────────────────────

describe('AgentNegotiation - Large Scale', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
      maxConcurrentPerAgent: 100,
    });
  });

  afterEach(() => {
    neg.destroy();
  });

  it('handles 50 concurrent negotiations', () => {
    const negotiations: string[] = [];

    for (let i = 0; i < 50; i++) {
      const n = neg.createNegotiation({
        initiatorId: 'agent-1',
        capability: `cap-${i}`,
        description: `task-${i}`,
      });
      negotiations.push(n.id);
    }

    expect(neg.getNegotiationCount()).toBe(50);
    expect(neg.getActiveNegotiationsForAgent('agent-1')).toHaveLength(50);
  });

  it('handles negotiation with many offers', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 50,
    });

    for (let i = 0; i < 30; i++) {
      neg.submitOffer({
        negotiationId: n.id,
        fromAgentId: `agent-${i}`,
        toAgentId: 'a',
        proposedPrice: 10 + i,
        estimatedDuration: 5000 + i * 100,
        confidence: 0.5 + (i / 60),
      });
    }

    expect(neg.getOffers(n.id)).toHaveLength(30);
    expect(neg.getPendingOffers(n.id)).toHaveLength(30);

    // Auto resolve should work
    const winner = neg.autoResolve(n.id);
    expect(winner).toBeDefined();
    expect(neg.getPendingOffers(n.id)).toHaveLength(0);
  });

  it('stats calculation works with many negotiations', () => {
    for (let i = 0; i < 20; i++) {
      const n = neg.createNegotiation({
        initiatorId: 'requester',
        capability: 'test',
        description: `test-${i}`,
      });

      const offer = neg.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'bidder',
        toAgentId: 'requester',
        proposedPrice: 10 + i,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      if (i % 2 === 0) {
        neg.acceptOffer(n.id, offer.id, 'requester');
      } else {
        neg.cancelNegotiation(n.id, 'requester');
      }
    }

    const stats = neg.getAgentStats('bidder');
    expect(stats.totalNegotiations).toBe(20);
    expect(stats.wonCount).toBe(10);
    expect(stats.cancelledCount).toBe(10);
  });
});

// ─── removeNegotiation with Different States ────────────────────────────────

describe('AgentNegotiation - Remove Negotiation', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });
  });

  afterEach(() => {
    neg.destroy();
  });

  it('removes accepted negotiation', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    neg.acceptOffer(n.id, offer.id, 'a');
    expect(neg.removeNegotiation(n.id)).toBe(true);
    expect(neg.getNegotiationCount()).toBe(0);
  });

  it('removes rejected negotiation', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 1,
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    neg.rejectOffer(n.id, offer.id, 'a');
    expect(neg.removeNegotiation(n.id)).toBe(true);
  });

  it('removes cancelled negotiation', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    neg.cancelNegotiation(n.id, 'a');
    expect(neg.removeNegotiation(n.id)).toBe(true);
  });

  it('throws when trying to remove in_progress negotiation', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    expect(() => neg.removeNegotiation(n.id)).toThrow('active');
  });

  it('throws when trying to remove counter_offered negotiation', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 5,
    });

    const offer = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 20,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    neg.submitCounterOffer({
      negotiationId: n.id,
      originalOfferId: offer.id,
      fromAgentId: 'a',
      toAgentId: 'b',
      proposedPrice: 15,
      estimatedDuration: 4000,
      confidence: 0.85,
    });

    expect(() => neg.removeNegotiation(n.id)).toThrow('active');
  });
});
