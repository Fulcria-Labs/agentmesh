/**
 * AgentNegotiation - Scenario-based test suite
 *
 * Covers: real-world negotiation scenarios, phased workflows,
 * configuration edge cases, export verification, and comprehensive
 * validation of the negotiation protocol.
 */

import {
  AgentNegotiation,
  NegotiationPhase,
  ResolutionStrategy,
  NegotiationConfig,
} from '../core/agent-negotiation';
import { ReputationManager } from '../core/reputation';

// ─── Real-World Scenarios ───────────────────────────────────────────────────

describe('Scenario: Multi-Agent Research Task Negotiation', () => {
  let neg: AgentNegotiation;
  let rep: ReputationManager;

  beforeEach(() => {
    rep = new ReputationManager();
    // Build reputation profiles
    for (let i = 0; i < 15; i++) rep.recordSuccess('researcher-alpha', 2000, 8);
    for (let i = 0; i < 8; i++) rep.recordSuccess('researcher-beta', 3000, 5);
    for (let i = 0; i < 3; i++) rep.recordFailure('researcher-beta');
    for (let i = 0; i < 2; i++) rep.recordSuccess('researcher-gamma', 1500, 12);

    neg = new AgentNegotiation(
      { defaultDeadlineMs: 0, defaultOfferExpiryMs: 0 },
      rep,
    );
  });

  afterEach(() => neg.destroy());

  it('coordinator negotiates research task with three agents', () => {
    const n = neg.createNegotiation({
      initiatorId: 'coordinator',
      capability: 'web_research',
      description: 'Research top 10 DeFi protocols',
      priority: 'high',
      maxRounds: 4,
      maxPrice: 30,
      strategy: ResolutionStrategy.BEST_SCORE,
    });

    // All three researchers bid
    const bid1 = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'researcher-alpha',
      toAgentId: 'coordinator',
      proposedPrice: 25,
      estimatedDuration: 8000,
      confidence: 0.92,
      terms: { depth: 'comprehensive', sources: 10 },
    });

    const bid2 = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'researcher-beta',
      toAgentId: 'coordinator',
      proposedPrice: 15,
      estimatedDuration: 12000,
      confidence: 0.78,
      terms: { depth: 'standard', sources: 5 },
    });

    const bid3 = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'researcher-gamma',
      toAgentId: 'coordinator',
      proposedPrice: 28,
      estimatedDuration: 5000,
      confidence: 0.88,
      terms: { depth: 'deep', sources: 15 },
    });

    // Coordinator counter-offers to alpha (best reputation)
    const counter = neg.submitCounterOffer({
      negotiationId: n.id,
      originalOfferId: bid1.id,
      fromAgentId: 'coordinator',
      toAgentId: 'researcher-alpha',
      proposedPrice: 20,
      estimatedDuration: 7000,
      confidence: 0.95,
      terms: { depth: 'comprehensive', sources: 12, rush: true },
    });

    // Alpha accepts the counter
    neg.acceptOffer(n.id, counter.id, 'researcher-alpha');

    const result = neg.getNegotiation(n.id)!;
    expect(result.phase).toBe(NegotiationPhase.ACCEPTED);
    expect(result.acceptedOffer!.proposedPrice).toBe(20);
    expect(result.participants).toHaveLength(4); // coordinator + 3 researchers

    // Other bids should be rejected
    const allOffers = neg.getOffers(n.id);
    const pendingCount = allOffers.filter(o => o.status === 'pending').length;
    expect(pendingCount).toBe(0);
  });
});

describe('Scenario: Price Negotiation Convergence', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
      maxPriceAdjustment: 0.3, // 30% max change per round
    });
  });

  afterEach(() => neg.destroy());

  it('buyer and seller converge on price through counter-offers', () => {
    const n = neg.createNegotiation({
      initiatorId: 'buyer',
      capability: 'data_analysis',
      description: 'Analyze market data',
      maxRounds: 6,
    });

    // Seller starts high
    const o1 = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'seller',
      toAgentId: 'buyer',
      proposedPrice: 100,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    // Buyer counters low (30% max adjustment)
    const o2 = neg.submitCounterOffer({
      negotiationId: n.id,
      originalOfferId: o1.id,
      fromAgentId: 'buyer',
      toAgentId: 'seller',
      proposedPrice: 75,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    // Seller comes down (within 30% of 75)
    const o3 = neg.submitCounterOffer({
      negotiationId: n.id,
      originalOfferId: o2.id,
      fromAgentId: 'seller',
      toAgentId: 'buyer',
      proposedPrice: 85,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    // Buyer meets in the middle
    neg.acceptOffer(n.id, o3.id, 'buyer');

    const result = neg.getNegotiation(n.id)!;
    expect(result.acceptedOffer!.proposedPrice).toBe(85);
    expect(result.currentRound).toBe(3);
  });
});

describe('Scenario: Competitive Bidding with Auto-Resolution', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });
  });

  afterEach(() => neg.destroy());

  it('auto-resolves lowest cost among many bidders', () => {
    const n = neg.createNegotiation({
      initiatorId: 'platform',
      capability: 'sentiment_analysis',
      description: 'Analyze 1000 tweets',
      strategy: ResolutionStrategy.LOWEST_COST,
      maxRounds: 20,
    });

    const prices = [45, 32, 58, 21, 37, 15, 42, 28, 50, 19];
    for (let i = 0; i < prices.length; i++) {
      neg.submitOffer({
        negotiationId: n.id,
        fromAgentId: `bidder-${i}`,
        toAgentId: 'platform',
        proposedPrice: prices[i],
        estimatedDuration: 5000 + i * 500,
        confidence: 0.7 + Math.random() * 0.3,
      });
    }

    expect(neg.getOffers(n.id)).toHaveLength(10);

    const winner = neg.autoResolve(n.id);
    expect(winner!.fromAgentId).toBe('bidder-5'); // Price: 15
    expect(winner!.proposedPrice).toBe(15);
  });

  it('auto-resolves fastest among many bidders', () => {
    const n = neg.createNegotiation({
      initiatorId: 'platform',
      capability: 'translation',
      description: 'Translate document',
      strategy: ResolutionStrategy.FASTEST,
      maxRounds: 10,
    });

    const durations = [8000, 3000, 12000, 1500, 5000];
    for (let i = 0; i < durations.length; i++) {
      neg.submitOffer({
        negotiationId: n.id,
        fromAgentId: `translator-${i}`,
        toAgentId: 'platform',
        proposedPrice: 10 + i * 5,
        estimatedDuration: durations[i],
        confidence: 0.85,
      });
    }

    const winner = neg.autoResolve(n.id);
    expect(winner!.fromAgentId).toBe('translator-3'); // Duration: 1500
  });
});

// ─── Phase Transitions ──────────────────────────────────────────────────────

describe('NegotiationPhase Transitions', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });
  });

  afterEach(() => neg.destroy());

  it('OPEN -> IN_PROGRESS on first offer', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    expect(n.phase).toBe(NegotiationPhase.OPEN);

    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    expect(neg.getNegotiation(n.id)!.phase).toBe(NegotiationPhase.IN_PROGRESS);
  });

  it('IN_PROGRESS -> COUNTER_OFFERED on counter', () => {
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

    expect(neg.getNegotiation(n.id)!.phase).toBe(NegotiationPhase.COUNTER_OFFERED);
  });

  it('IN_PROGRESS -> ACCEPTED on accept', () => {
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
    expect(neg.getNegotiation(n.id)!.phase).toBe(NegotiationPhase.ACCEPTED);
  });

  it('COUNTER_OFFERED -> ACCEPTED on accept', () => {
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
    expect(neg.getNegotiation(n.id)!.phase).toBe(NegotiationPhase.ACCEPTED);
  });

  it('OPEN -> CANCELLED', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    neg.cancelNegotiation(n.id, 'a');
    expect(neg.getNegotiation(n.id)!.phase).toBe(NegotiationPhase.CANCELLED);
  });

  it('IN_PROGRESS -> CANCELLED', () => {
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

    neg.cancelNegotiation(n.id, 'a');
    expect(neg.getNegotiation(n.id)!.phase).toBe(NegotiationPhase.CANCELLED);
  });

  it('IN_PROGRESS -> REJECTED when all rejected at max rounds', () => {
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
    expect(neg.getNegotiation(n.id)!.phase).toBe(NegotiationPhase.REJECTED);
  });
});

// ─── Configuration Validation ───────────────────────────────────────────────

describe('NegotiationConfig', () => {
  it('uses all default values when no config provided', () => {
    const neg = new AgentNegotiation();
    const config = neg.getConfig();

    expect(config.defaultMaxRounds).toBe(5);
    expect(config.defaultDeadlineMs).toBe(300000);
    expect(config.defaultOfferExpiryMs).toBe(60000);
    expect(config.defaultStrategy).toBe(ResolutionStrategy.BEST_SCORE);
    expect(config.minConfidence).toBe(0.1);
    expect(config.maxConcurrentPerAgent).toBe(10);
    expect(config.useReputationWeighting).toBe(true);
    expect(config.priceWeight).toBe(0.3);
    expect(config.confidenceWeight).toBe(0.3);
    expect(config.durationWeight).toBe(0.2);
    expect(config.reputationWeight).toBe(0.2);
    expect(config.autoResolveOnDeadline).toBe(true);
    expect(config.maxPriceAdjustment).toBe(0.5);

    neg.destroy();
  });

  it('partial config overrides only specified values', () => {
    const neg = new AgentNegotiation({
      defaultMaxRounds: 10,
      minConfidence: 0.5,
    });

    const config = neg.getConfig();
    expect(config.defaultMaxRounds).toBe(10);
    expect(config.minConfidence).toBe(0.5);
    expect(config.defaultDeadlineMs).toBe(300000); // Default unchanged

    neg.destroy();
  });

  it('updateConfig merges with existing config', () => {
    const neg = new AgentNegotiation({ defaultDeadlineMs: 0, defaultOfferExpiryMs: 0 });

    neg.updateConfig({ priceWeight: 0.5, durationWeight: 0.1 });

    const config = neg.getConfig();
    expect(config.priceWeight).toBe(0.5);
    expect(config.durationWeight).toBe(0.1);
    expect(config.confidenceWeight).toBe(0.3); // Unchanged

    neg.destroy();
  });

  it('config changes affect subsequent scoring', () => {
    const neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
      priceWeight: 0.3,
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
    });

    const score1 = neg.scoreOffer(offer);

    neg.updateConfig({ priceWeight: 0.9 });
    const score2 = neg.scoreOffer(offer);

    // Scores should differ after weight change
    expect(score1).not.toBe(score2);

    neg.destroy();
  });

  it('minConfidence affects offer validation', () => {
    const neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
      minConfidence: 0.5,
    });

    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    expect(() =>
      neg.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'b',
        toAgentId: 'a',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.3, // Below 0.5 min
      })
    ).toThrow('at least 0.5');

    neg.destroy();
  });
});

// ─── Enum Values ────────────────────────────────────────────────────────────

describe('Enum Validation', () => {
  it('NegotiationPhase has all expected values', () => {
    expect(NegotiationPhase.OPEN).toBe('open');
    expect(NegotiationPhase.IN_PROGRESS).toBe('in_progress');
    expect(NegotiationPhase.ACCEPTED).toBe('accepted');
    expect(NegotiationPhase.REJECTED).toBe('rejected');
    expect(NegotiationPhase.EXPIRED).toBe('expired');
    expect(NegotiationPhase.CANCELLED).toBe('cancelled');
    expect(NegotiationPhase.COUNTER_OFFERED).toBe('counter_offered');
  });

  it('ResolutionStrategy has all expected values', () => {
    expect(ResolutionStrategy.BEST_SCORE).toBe('best_score');
    expect(ResolutionStrategy.LOWEST_COST).toBe('lowest_cost');
    expect(ResolutionStrategy.FASTEST).toBe('fastest');
    expect(ResolutionStrategy.HIGHEST_CONFIDENCE).toBe('highest_confidence');
    expect(ResolutionStrategy.HIGHEST_REPUTATION).toBe('highest_reputation');
    expect(ResolutionStrategy.MANUAL).toBe('manual');
  });
});

// ─── Export Verification ────────────────────────────────────────────────────

describe('Module Exports', () => {
  it('exports AgentNegotiation class', () => {
    expect(AgentNegotiation).toBeDefined();
    expect(typeof AgentNegotiation).toBe('function');
  });

  it('exports NegotiationPhase enum', () => {
    expect(NegotiationPhase).toBeDefined();
    expect(Object.keys(NegotiationPhase).length).toBeGreaterThan(0);
  });

  it('exports ResolutionStrategy enum', () => {
    expect(ResolutionStrategy).toBeDefined();
    expect(Object.keys(ResolutionStrategy).length).toBeGreaterThan(0);
  });

  it('AgentNegotiation can be instantiated with no args', () => {
    const n = new AgentNegotiation();
    expect(n).toBeInstanceOf(AgentNegotiation);
    n.destroy();
  });

  it('AgentNegotiation can be instantiated with config only', () => {
    const n = new AgentNegotiation({ defaultMaxRounds: 3 });
    expect(n.getConfig().defaultMaxRounds).toBe(3);
    n.destroy();
  });

  it('AgentNegotiation can be instantiated with reputation only', () => {
    const rep = new ReputationManager();
    const n = new AgentNegotiation(undefined, rep);
    expect(n.getReputationManager()).toBe(rep);
    n.destroy();
  });

  it('AgentNegotiation can be instantiated with both config and reputation', () => {
    const rep = new ReputationManager();
    const n = new AgentNegotiation({ defaultMaxRounds: 7 }, rep);
    expect(n.getConfig().defaultMaxRounds).toBe(7);
    expect(n.getReputationManager()).toBe(rep);
    n.destroy();
  });
});

// ─── Offer Status Transitions ───────────────────────────────────────────────

describe('Offer Status Transitions', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });
  });

  afterEach(() => neg.destroy());

  it('offer starts as pending', () => {
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

    expect(offer.status).toBe('pending');
  });

  it('offer transitions to accepted', () => {
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

    const offers = neg.getOffers(n.id);
    expect(offers[0].status).toBe('accepted');
  });

  it('offer transitions to rejected', () => {
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

    neg.rejectOffer(n.id, offer.id, 'a');

    const offers = neg.getOffers(n.id);
    expect(offers[0].status).toBe('rejected');
  });

  it('offer transitions to superseded on counter-offer', () => {
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

    const offers = neg.getOffers(n.id);
    expect(offers[0].status).toBe('superseded');
    expect(offers[1].status).toBe('pending');
  });

  it('non-accepted offers become rejected when one is accepted', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      maxRounds: 10,
    });

    const o1 = neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'c',
      toAgentId: 'a',
      proposedPrice: 15,
      estimatedDuration: 3000,
      confidence: 0.85,
    });

    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'd',
      toAgentId: 'a',
      proposedPrice: 20,
      estimatedDuration: 2000,
      confidence: 0.8,
    });

    neg.acceptOffer(n.id, o1.id, 'a');

    const offers = neg.getOffers(n.id);
    expect(offers[0].status).toBe('accepted');
    expect(offers[1].status).toBe('rejected');
    expect(offers[2].status).toBe('rejected');
  });
});

// ─── updatedAt Tracking ─────────────────────────────────────────────────────

describe('Timestamp Tracking', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });
  });

  afterEach(() => neg.destroy());

  it('createdAt and updatedAt are set on creation', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    expect(n.createdAt).toBeGreaterThan(0);
    expect(n.updatedAt).toBe(n.createdAt);
  });

  it('updatedAt changes on offer submission', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    const originalUpdatedAt = n.updatedAt;

    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'b',
      toAgentId: 'a',
      proposedPrice: 10,
      estimatedDuration: 5000,
      confidence: 0.9,
    });

    expect(neg.getNegotiation(n.id)!.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
  });

  it('updatedAt changes on acceptance', () => {
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

    const beforeAccept = neg.getNegotiation(n.id)!.updatedAt;
    neg.acceptOffer(n.id, offer.id, 'a');
    expect(neg.getNegotiation(n.id)!.updatedAt).toBeGreaterThanOrEqual(beforeAccept);
  });

  it('updatedAt changes on cancellation', () => {
    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    const beforeCancel = n.updatedAt;
    neg.cancelNegotiation(n.id, 'a');
    expect(neg.getNegotiation(n.id)!.updatedAt).toBeGreaterThanOrEqual(beforeCancel);
  });

  it('offer createdAt is set', () => {
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

    expect(offer.createdAt).toBeGreaterThan(0);
  });
});

// ─── Mixed Strategy Scenarios ───────────────────────────────────────────────

describe('Mixed Strategy Scenarios', () => {
  it('changing strategy mid-flow via config update', () => {
    const neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
      defaultStrategy: ResolutionStrategy.LOWEST_COST,
    });

    const n = neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
      strategy: ResolutionStrategy.LOWEST_COST,
      maxRounds: 10,
    });

    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'cheap',
      toAgentId: 'a',
      proposedPrice: 5,
      estimatedDuration: 30000,
      confidence: 0.5,
    });

    neg.submitOffer({
      negotiationId: n.id,
      fromAgentId: 'fast',
      toAgentId: 'a',
      proposedPrice: 50,
      estimatedDuration: 1000,
      confidence: 0.95,
    });

    // By LOWEST_COST, cheap wins
    const pending = neg.getPendingOffers(n.id);
    const lowestCostWinner = neg.selectBestOffer(pending, ResolutionStrategy.LOWEST_COST);
    expect(lowestCostWinner!.fromAgentId).toBe('cheap');

    // By FASTEST, fast wins
    const fastestWinner = neg.selectBestOffer(pending, ResolutionStrategy.FASTEST);
    expect(fastestWinner!.fromAgentId).toBe('fast');

    neg.destroy();
  });
});

// ─── Task ID Association ────────────────────────────────────────────────────

describe('Task ID Association', () => {
  let neg: AgentNegotiation;

  beforeEach(() => {
    neg = new AgentNegotiation({
      defaultDeadlineMs: 0,
      defaultOfferExpiryMs: 0,
    });
  });

  afterEach(() => neg.destroy());

  it('multiple negotiations can reference same task', () => {
    neg.createNegotiation({
      initiatorId: 'a',
      capability: 'research',
      description: 'Research part 1',
      taskId: 'task-abc',
    });

    neg.createNegotiation({
      initiatorId: 'a',
      capability: 'analysis',
      description: 'Analysis part 1',
      taskId: 'task-abc',
    });

    const taskNegs = neg.getNegotiationsForTask('task-abc');
    expect(taskNegs).toHaveLength(2);
  });

  it('negotiation without taskId is not returned for task queries', () => {
    neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    const taskNegs = neg.getNegotiationsForTask('any-task');
    expect(taskNegs).toHaveLength(0);
  });
});

// ─── Destroy Idempotence ────────────────────────────────────────────────────

describe('Destroy Behavior', () => {
  it('destroy can be called multiple times safely', () => {
    const neg = new AgentNegotiation({ defaultDeadlineMs: 0, defaultOfferExpiryMs: 0 });

    neg.createNegotiation({
      initiatorId: 'a',
      capability: 'test',
      description: 'test',
    });

    neg.destroy();
    neg.destroy(); // Second call should not throw

    expect(neg.getNegotiationCount()).toBe(0);
  });

  it('destroy clears all timers without errors', () => {
    const neg = new AgentNegotiation({
      defaultDeadlineMs: 60000, // Enable deadline timers
      defaultOfferExpiryMs: 30000,
    });

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

    // This should cleanly clear all timers
    expect(() => neg.destroy()).not.toThrow();
  });
});
