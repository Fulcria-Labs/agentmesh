/**
 * AgentNegotiation - Core test suite
 *
 * Covers: negotiation lifecycle, offer management, counter-offers,
 * acceptance/rejection, resolution strategies, scoring, queries, and events.
 */

import {
  AgentNegotiation,
  NegotiationPhase,
  ResolutionStrategy,
} from '../core/agent-negotiation';
import { ReputationManager } from '../core/reputation';

describe('AgentNegotiation', () => {
  let negotiation: AgentNegotiation;

  beforeEach(() => {
    negotiation = new AgentNegotiation({
      defaultDeadlineMs: 0, // No deadline by default in tests
      defaultOfferExpiryMs: 0, // No offer expiry by default in tests
    });
  });

  afterEach(() => {
    negotiation.destroy();
  });

  // ─── Creation ──────────────────────────────────────────────────────────

  describe('createNegotiation', () => {
    it('creates a negotiation with required fields', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'web_research',
        description: 'Research AI agents',
      });

      expect(n.id).toBeDefined();
      expect(n.initiatorId).toBe('agent-1');
      expect(n.capability).toBe('web_research');
      expect(n.description).toBe('Research AI agents');
      expect(n.phase).toBe(NegotiationPhase.OPEN);
      expect(n.participants).toContain('agent-1');
      expect(n.offers).toHaveLength(0);
      expect(n.currentRound).toBe(0);
      expect(n.createdAt).toBeGreaterThan(0);
    });

    it('creates a negotiation with all optional fields', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'data_analysis',
        description: 'Analyze market data',
        participants: ['agent-2', 'agent-3'],
        taskId: 'task-123',
        maxRounds: 10,
        strategy: ResolutionStrategy.LOWEST_COST,
        deadlineMs: 0,
        minPrice: 1,
        maxPrice: 50,
        priority: 'high',
        metadata: { source: 'test' },
      });

      expect(n.participants).toContain('agent-1');
      expect(n.participants).toContain('agent-2');
      expect(n.participants).toContain('agent-3');
      expect(n.taskId).toBe('task-123');
      expect(n.maxRounds).toBe(10);
      expect(n.strategy).toBe(ResolutionStrategy.LOWEST_COST);
      expect(n.minPrice).toBe(1);
      expect(n.maxPrice).toBe(50);
      expect(n.priority).toBe('high');
      expect(n.metadata).toEqual({ source: 'test' });
    });

    it('deduplicates initiator from participants list', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
        participants: ['agent-1', 'agent-2'],
      });

      const agentOneCount = n.participants.filter(p => p === 'agent-1').length;
      expect(agentOneCount).toBe(1);
      expect(n.participants).toHaveLength(2);
    });

    it('throws on missing initiatorId', () => {
      expect(() =>
        negotiation.createNegotiation({
          initiatorId: '',
          capability: 'test',
          description: 'test',
        })
      ).toThrow('initiatorId');
    });

    it('throws on missing capability', () => {
      expect(() =>
        negotiation.createNegotiation({
          initiatorId: 'agent-1',
          capability: '',
          description: 'test',
        })
      ).toThrow('capability');
    });

    it('throws on missing description', () => {
      expect(() =>
        negotiation.createNegotiation({
          initiatorId: 'agent-1',
          capability: 'test',
          description: '',
        })
      ).toThrow('description');
    });

    it('throws on maxRounds < 1', () => {
      expect(() =>
        negotiation.createNegotiation({
          initiatorId: 'agent-1',
          capability: 'test',
          description: 'test',
          maxRounds: 0,
        })
      ).toThrow('maxRounds must be at least 1');
    });

    it('throws on maxRounds > 100', () => {
      expect(() =>
        negotiation.createNegotiation({
          initiatorId: 'agent-1',
          capability: 'test',
          description: 'test',
          maxRounds: 101,
        })
      ).toThrow('maxRounds cannot exceed 100');
    });

    it('throws on minPrice > maxPrice', () => {
      expect(() =>
        negotiation.createNegotiation({
          initiatorId: 'agent-1',
          capability: 'test',
          description: 'test',
          minPrice: 100,
          maxPrice: 50,
        })
      ).toThrow('minPrice cannot exceed maxPrice');
    });

    it('throws on negative deadlineMs', () => {
      expect(() =>
        negotiation.createNegotiation({
          initiatorId: 'agent-1',
          capability: 'test',
          description: 'test',
          deadlineMs: -1,
        })
      ).toThrow('deadlineMs cannot be negative');
    });

    it('throws when concurrent negotiation limit reached', () => {
      const limited = new AgentNegotiation({
        maxConcurrentPerAgent: 2,
        defaultDeadlineMs: 0,
        defaultOfferExpiryMs: 0,
      });

      limited.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'a',
        description: 'a',
      });
      limited.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'b',
        description: 'b',
      });

      expect(() =>
        limited.createNegotiation({
          initiatorId: 'agent-1',
          capability: 'c',
          description: 'c',
        })
      ).toThrow('maximum concurrent negotiation limit');

      limited.destroy();
    });

    it('emits negotiation:created event', () => {
      const handler = jest.fn();
      negotiation.on('negotiation:created', handler);

      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      expect(handler).toHaveBeenCalledWith(n);
    });

    it('assigns unique IDs to each negotiation', () => {
      const n1 = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test 1',
      });
      const n2 = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test 2',
      });

      expect(n1.id).not.toBe(n2.id);
    });

    it('defaults to medium priority', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      expect(n.priority).toBe('medium');
    });

    it('sets deadline to 0 when deadlineMs is 0', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
        deadlineMs: 0,
      });

      expect(n.deadline).toBe(0);
    });
  });

  // ─── Submit Offer ──────────────────────────────────────────────────────

  describe('submitOffer', () => {
    let negotiationId: string;

    beforeEach(() => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'web_research',
        description: 'Research task',
        participants: ['agent-2'],
      });
      negotiationId = n.id;
    });

    it('submits a valid offer', () => {
      const offer = negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      expect(offer.id).toBeDefined();
      expect(offer.negotiationId).toBe(negotiationId);
      expect(offer.fromAgentId).toBe('agent-2');
      expect(offer.toAgentId).toBe('agent-1');
      expect(offer.proposedPrice).toBe(10);
      expect(offer.estimatedDuration).toBe(5000);
      expect(offer.confidence).toBe(0.9);
      expect(offer.round).toBe(1);
      expect(offer.isCounterOffer).toBe(false);
      expect(offer.status).toBe('pending');
    });

    it('updates negotiation phase to IN_PROGRESS', () => {
      negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      const n = negotiation.getNegotiation(negotiationId)!;
      expect(n.phase).toBe(NegotiationPhase.IN_PROGRESS);
      expect(n.currentRound).toBe(1);
    });

    it('increments round with each offer', () => {
      negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 8,
        estimatedDuration: 4000,
        confidence: 0.95,
      });

      const n = negotiation.getNegotiation(negotiationId)!;
      expect(n.currentRound).toBe(2);
      expect(n.offers).toHaveLength(2);
    });

    it('adds unknown participant automatically', () => {
      negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-new',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      const n = negotiation.getNegotiation(negotiationId)!;
      expect(n.participants).toContain('agent-new');
    });

    it('accepts custom terms', () => {
      const offer = negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
        terms: { priority: 'rush', deliveryFormat: 'pdf' },
      });

      expect(offer.terms).toEqual({ priority: 'rush', deliveryFormat: 'pdf' });
    });

    it('throws for non-existent negotiation', () => {
      expect(() =>
        negotiation.submitOffer({
          negotiationId: 'non-existent',
          fromAgentId: 'agent-2',
          toAgentId: 'agent-1',
          proposedPrice: 10,
          estimatedDuration: 5000,
          confidence: 0.9,
        })
      ).toThrow('not found');
    });

    it('throws for negative price', () => {
      expect(() =>
        negotiation.submitOffer({
          negotiationId,
          fromAgentId: 'agent-2',
          toAgentId: 'agent-1',
          proposedPrice: -1,
          estimatedDuration: 5000,
          confidence: 0.9,
        })
      ).toThrow('negative');
    });

    it('throws for negative duration', () => {
      expect(() =>
        negotiation.submitOffer({
          negotiationId,
          fromAgentId: 'agent-2',
          toAgentId: 'agent-1',
          proposedPrice: 10,
          estimatedDuration: -1,
          confidence: 0.9,
        })
      ).toThrow('negative');
    });

    it('throws for confidence > 1', () => {
      expect(() =>
        negotiation.submitOffer({
          negotiationId,
          fromAgentId: 'agent-2',
          toAgentId: 'agent-1',
          proposedPrice: 10,
          estimatedDuration: 5000,
          confidence: 1.5,
        })
      ).toThrow('between 0 and 1');
    });

    it('throws for confidence < 0', () => {
      expect(() =>
        negotiation.submitOffer({
          negotiationId,
          fromAgentId: 'agent-2',
          toAgentId: 'agent-1',
          proposedPrice: 10,
          estimatedDuration: 5000,
          confidence: -0.1,
        })
      ).toThrow('between 0 and 1');
    });

    it('throws for confidence below minimum', () => {
      expect(() =>
        negotiation.submitOffer({
          negotiationId,
          fromAgentId: 'agent-2',
          toAgentId: 'agent-1',
          proposedPrice: 10,
          estimatedDuration: 5000,
          confidence: 0.05,
        })
      ).toThrow('at least');
    });

    it('throws when max rounds reached', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-a',
        capability: 'test',
        description: 'test',
        maxRounds: 1,
      });

      negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-b',
        toAgentId: 'agent-a',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      expect(() =>
        negotiation.submitOffer({
          negotiationId: n.id,
          fromAgentId: 'agent-b',
          toAgentId: 'agent-a',
          proposedPrice: 8,
          estimatedDuration: 4000,
          confidence: 0.95,
        })
      ).toThrow('maximum rounds');
    });

    it('throws when price exceeds maxPrice', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-a',
        capability: 'test',
        description: 'test',
        maxPrice: 20,
      });

      expect(() =>
        negotiation.submitOffer({
          negotiationId: n.id,
          fromAgentId: 'agent-b',
          toAgentId: 'agent-a',
          proposedPrice: 25,
          estimatedDuration: 5000,
          confidence: 0.9,
        })
      ).toThrow('exceeds maximum');
    });

    it('throws when negotiation is accepted', () => {
      const offer = negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      negotiation.acceptOffer(negotiationId, offer.id, 'agent-1');

      expect(() =>
        negotiation.submitOffer({
          negotiationId,
          fromAgentId: 'agent-2',
          toAgentId: 'agent-1',
          proposedPrice: 8,
          estimatedDuration: 4000,
          confidence: 0.95,
        })
      ).toThrow('accepted');
    });

    it('emits negotiation:offer event', () => {
      const handler = jest.fn();
      negotiation.on('negotiation:offer', handler);

      const offer = negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      expect(handler).toHaveBeenCalledWith(offer);
    });

    it('allows zero price offers', () => {
      const offer = negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 0,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      expect(offer.proposedPrice).toBe(0);
    });

    it('allows zero duration offers', () => {
      const offer = negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 0,
        confidence: 0.9,
      });

      expect(offer.estimatedDuration).toBe(0);
    });
  });

  // ─── Counter Offers ────────────────────────────────────────────────────

  describe('submitCounterOffer', () => {
    let negotiationId: string;
    let originalOfferId: string;

    beforeEach(() => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'web_research',
        description: 'Research task',
        maxRounds: 5,
      });
      negotiationId = n.id;

      const offer = negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 20,
        estimatedDuration: 5000,
        confidence: 0.8,
      });
      originalOfferId = offer.id;
    });

    it('creates a valid counter-offer', () => {
      const counter = negotiation.submitCounterOffer({
        negotiationId,
        originalOfferId,
        fromAgentId: 'agent-1',
        toAgentId: 'agent-2',
        proposedPrice: 15,
        estimatedDuration: 4000,
        confidence: 0.85,
      });

      expect(counter.isCounterOffer).toBe(true);
      expect(counter.proposedPrice).toBe(15);
      expect(counter.round).toBe(2);
      expect(counter.status).toBe('pending');
    });

    it('marks original offer as superseded', () => {
      negotiation.submitCounterOffer({
        negotiationId,
        originalOfferId,
        fromAgentId: 'agent-1',
        toAgentId: 'agent-2',
        proposedPrice: 15,
        estimatedDuration: 4000,
        confidence: 0.85,
      });

      const offers = negotiation.getOffers(negotiationId);
      const original = offers.find(o => o.id === originalOfferId);
      expect(original?.status).toBe('superseded');
    });

    it('updates negotiation phase to COUNTER_OFFERED', () => {
      negotiation.submitCounterOffer({
        negotiationId,
        originalOfferId,
        fromAgentId: 'agent-1',
        toAgentId: 'agent-2',
        proposedPrice: 15,
        estimatedDuration: 4000,
        confidence: 0.85,
      });

      const n = negotiation.getNegotiation(negotiationId)!;
      expect(n.phase).toBe(NegotiationPhase.COUNTER_OFFERED);
    });

    it('throws when original offer not found', () => {
      expect(() =>
        negotiation.submitCounterOffer({
          negotiationId,
          originalOfferId: 'non-existent',
          fromAgentId: 'agent-1',
          toAgentId: 'agent-2',
          proposedPrice: 15,
          estimatedDuration: 4000,
          confidence: 0.85,
        })
      ).toThrow('not found');
    });

    it('throws when original offer already accepted', () => {
      negotiation.acceptOffer(negotiationId, originalOfferId, 'agent-1');

      expect(() =>
        negotiation.submitCounterOffer({
          negotiationId,
          originalOfferId,
          fromAgentId: 'agent-1',
          toAgentId: 'agent-2',
          proposedPrice: 15,
          estimatedDuration: 4000,
          confidence: 0.85,
        })
      ).toThrow();
    });

    it('throws when price adjustment exceeds limit', () => {
      expect(() =>
        negotiation.submitCounterOffer({
          negotiationId,
          originalOfferId,
          fromAgentId: 'agent-1',
          toAgentId: 'agent-2',
          proposedPrice: 2, // 90% reduction from 20
          estimatedDuration: 4000,
          confidence: 0.85,
        })
      ).toThrow('exceeds limit');
    });

    it('allows counter-offer within price adjustment limit', () => {
      const counter = negotiation.submitCounterOffer({
        negotiationId,
        originalOfferId,
        fromAgentId: 'agent-1',
        toAgentId: 'agent-2',
        proposedPrice: 12, // 40% reduction from 20
        estimatedDuration: 4000,
        confidence: 0.85,
      });

      expect(counter.proposedPrice).toBe(12);
    });

    it('throws when max rounds reached', () => {
      const n2 = negotiation.createNegotiation({
        initiatorId: 'a',
        capability: 'test',
        description: 'test',
        maxRounds: 2,
      });

      const o1 = negotiation.submitOffer({
        negotiationId: n2.id,
        fromAgentId: 'b',
        toAgentId: 'a',
        proposedPrice: 20,
        estimatedDuration: 5000,
        confidence: 0.8,
      });

      negotiation.submitCounterOffer({
        negotiationId: n2.id,
        originalOfferId: o1.id,
        fromAgentId: 'a',
        toAgentId: 'b',
        proposedPrice: 15,
        estimatedDuration: 4000,
        confidence: 0.85,
      });

      // Now at round 2, which is the max
      // Need another offer to counter, but we can test with the last counter
      const lastOffer = negotiation.getOffers(n2.id).find(o => o.status === 'pending')!;
      expect(() =>
        negotiation.submitCounterOffer({
          negotiationId: n2.id,
          originalOfferId: lastOffer.id,
          fromAgentId: 'b',
          toAgentId: 'a',
          proposedPrice: 17,
          estimatedDuration: 4500,
          confidence: 0.9,
        })
      ).toThrow('maximum rounds');
    });

    it('emits negotiation:counterOffer event', () => {
      const handler = jest.fn();
      negotiation.on('negotiation:counterOffer', handler);

      const counter = negotiation.submitCounterOffer({
        negotiationId,
        originalOfferId,
        fromAgentId: 'agent-1',
        toAgentId: 'agent-2',
        proposedPrice: 15,
        estimatedDuration: 4000,
        confidence: 0.85,
      });

      expect(handler).toHaveBeenCalledWith(counter);
    });

    it('adds new participant when counter-offering', () => {
      negotiation.submitCounterOffer({
        negotiationId,
        originalOfferId,
        fromAgentId: 'agent-3',
        toAgentId: 'agent-2',
        proposedPrice: 15,
        estimatedDuration: 4000,
        confidence: 0.85,
      });

      const n = negotiation.getNegotiation(negotiationId)!;
      expect(n.participants).toContain('agent-3');
    });

    it('throws for negative price', () => {
      // Use a new negotiation with no price adjustment limit issue
      const n2 = negotiation.createNegotiation({
        initiatorId: 'x',
        capability: 'test',
        description: 'test',
        maxRounds: 5,
      });
      const o2 = negotiation.submitOffer({
        negotiationId: n2.id,
        fromAgentId: 'y',
        toAgentId: 'x',
        proposedPrice: 20,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      expect(() =>
        negotiation.submitCounterOffer({
          negotiationId: n2.id,
          originalOfferId: o2.id,
          fromAgentId: 'x',
          toAgentId: 'y',
          proposedPrice: -5,
          estimatedDuration: 4000,
          confidence: 0.85,
        })
      ).toThrow('negative');
    });

    it('throws for negative duration', () => {
      expect(() =>
        negotiation.submitCounterOffer({
          negotiationId,
          originalOfferId,
          fromAgentId: 'agent-1',
          toAgentId: 'agent-2',
          proposedPrice: 15,
          estimatedDuration: -1,
          confidence: 0.85,
        })
      ).toThrow('negative');
    });

    it('throws for invalid confidence', () => {
      expect(() =>
        negotiation.submitCounterOffer({
          negotiationId,
          originalOfferId,
          fromAgentId: 'agent-1',
          toAgentId: 'agent-2',
          proposedPrice: 15,
          estimatedDuration: 4000,
          confidence: 1.5,
        })
      ).toThrow('between 0 and 1');
    });
  });

  // ─── Accept Offer ──────────────────────────────────────────────────────

  describe('acceptOffer', () => {
    let negotiationId: string;
    let offerId: string;

    beforeEach(() => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'web_research',
        description: 'Research task',
      });
      negotiationId = n.id;

      const offer = negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });
      offerId = offer.id;
    });

    it('accepts a pending offer', () => {
      const result = negotiation.acceptOffer(negotiationId, offerId, 'agent-1');

      expect(result.phase).toBe(NegotiationPhase.ACCEPTED);
      expect(result.acceptedOffer?.id).toBe(offerId);
      expect(result.acceptedOffer?.status).toBe('accepted');
    });

    it('rejects other pending offers when one is accepted', () => {
      const offer2 = negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-3',
        toAgentId: 'agent-1',
        proposedPrice: 12,
        estimatedDuration: 6000,
        confidence: 0.85,
      });

      negotiation.acceptOffer(negotiationId, offerId, 'agent-1');

      const offers = negotiation.getOffers(negotiationId);
      const rejected = offers.find(o => o.id === offer2.id);
      expect(rejected?.status).toBe('rejected');
    });

    it('throws when negotiation is already accepted', () => {
      negotiation.acceptOffer(negotiationId, offerId, 'agent-1');

      const offer2 = negotiation.submitOffer({
        negotiationId: negotiation.createNegotiation({
          initiatorId: 'a',
          capability: 'b',
          description: 'c',
        }).id,
        fromAgentId: 'x',
        toAgentId: 'a',
        proposedPrice: 5,
        estimatedDuration: 1000,
        confidence: 0.9,
      });

      expect(() =>
        negotiation.acceptOffer(negotiationId, offerId, 'agent-1')
      ).toThrow('already has an accepted offer');
    });

    it('throws when non-recipient tries to accept', () => {
      expect(() =>
        negotiation.acceptOffer(negotiationId, offerId, 'agent-2')
      ).toThrow('not the recipient');
    });

    it('throws for non-existent offer', () => {
      expect(() =>
        negotiation.acceptOffer(negotiationId, 'non-existent', 'agent-1')
      ).toThrow('not found');
    });

    it('throws for non-existent negotiation', () => {
      expect(() =>
        negotiation.acceptOffer('non-existent', offerId, 'agent-1')
      ).toThrow('not found');
    });

    it('emits negotiation:accepted event', () => {
      const handler = jest.fn();
      negotiation.on('negotiation:accepted', handler);

      negotiation.acceptOffer(negotiationId, offerId, 'agent-1');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].negotiation.id).toBe(negotiationId);
      expect(handler.mock.calls[0][0].offer.id).toBe(offerId);
    });

    it('throws when accepting a rejected offer', () => {
      negotiation.rejectOffer(negotiationId, offerId, 'agent-1');

      expect(() =>
        negotiation.acceptOffer(negotiationId, offerId, 'agent-1')
      ).toThrow('rejected');
    });
  });

  // ─── Reject Offer ──────────────────────────────────────────────────────

  describe('rejectOffer', () => {
    let negotiationId: string;
    let offerId: string;

    beforeEach(() => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'web_research',
        description: 'Research task',
        maxRounds: 1,
      });
      negotiationId = n.id;

      const offer = negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });
      offerId = offer.id;
    });

    it('rejects a pending offer', () => {
      const rejected = negotiation.rejectOffer(negotiationId, offerId, 'agent-1', 'Too expensive');

      expect(rejected.status).toBe('rejected');
    });

    it('transitions to REJECTED when all offers rejected and max rounds reached', () => {
      negotiation.rejectOffer(negotiationId, offerId, 'agent-1');

      const n = negotiation.getNegotiation(negotiationId)!;
      expect(n.phase).toBe(NegotiationPhase.REJECTED);
    });

    it('throws when non-recipient tries to reject', () => {
      expect(() =>
        negotiation.rejectOffer(negotiationId, offerId, 'agent-2')
      ).toThrow('not the recipient');
    });

    it('throws for non-existent offer', () => {
      expect(() =>
        negotiation.rejectOffer(negotiationId, 'non-existent', 'agent-1')
      ).toThrow('not found');
    });

    it('throws when rejecting already rejected offer', () => {
      negotiation.rejectOffer(negotiationId, offerId, 'agent-1');

      expect(() =>
        negotiation.rejectOffer(negotiationId, offerId, 'agent-1')
      ).toThrow('rejected');
    });

    it('emits negotiation:offerRejected event', () => {
      const handler = jest.fn();
      negotiation.on('negotiation:offerRejected', handler);

      negotiation.rejectOffer(negotiationId, offerId, 'agent-1', 'Too expensive');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].reason).toBe('Too expensive');
    });

    it('emits negotiation:rejected when terminal', () => {
      const handler = jest.fn();
      negotiation.on('negotiation:rejected', handler);

      negotiation.rejectOffer(negotiationId, offerId, 'agent-1');

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Cancel Negotiation ────────────────────────────────────────────────

  describe('cancelNegotiation', () => {
    it('cancels an open negotiation', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const cancelled = negotiation.cancelNegotiation(n.id, 'agent-1', 'No longer needed');

      expect(cancelled.phase).toBe(NegotiationPhase.CANCELLED);
      expect(cancelled.rejectionReason).toBe('No longer needed');
    });

    it('marks pending offers as rejected on cancel', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      negotiation.cancelNegotiation(n.id, 'agent-1');

      const offers = negotiation.getOffers(n.id);
      expect(offers[0].status).toBe('rejected');
    });

    it('throws when non-initiator tries to cancel', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      expect(() =>
        negotiation.cancelNegotiation(n.id, 'agent-2')
      ).toThrow('Only the initiator');
    });

    it('throws when cancelling accepted negotiation', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const offer = negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      negotiation.acceptOffer(n.id, offer.id, 'agent-1');

      expect(() =>
        negotiation.cancelNegotiation(n.id, 'agent-1')
      ).toThrow('Cannot cancel an accepted');
    });

    it('emits negotiation:cancelled event', () => {
      const handler = jest.fn();
      negotiation.on('negotiation:cancelled', handler);

      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      negotiation.cancelNegotiation(n.id, 'agent-1');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('defaults rejection reason when not provided', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const cancelled = negotiation.cancelNegotiation(n.id, 'agent-1');
      expect(cancelled.rejectionReason).toBe('Cancelled by initiator');
    });
  });

  // ─── Resolution Strategies ─────────────────────────────────────────────

  describe('resolution strategies', () => {
    let negotiationId: string;
    let offerId1: string;
    let offerId2: string;
    let offerId3: string;

    beforeEach(() => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
        maxRounds: 10,
      });
      negotiationId = n.id;

      const o1 = negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 20,
        estimatedDuration: 3000,
        confidence: 0.7,
      });
      offerId1 = o1.id;

      const o2 = negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-3',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 8000,
        confidence: 0.95,
      });
      offerId2 = o2.id;

      const o3 = negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-4',
        toAgentId: 'agent-1',
        proposedPrice: 15,
        estimatedDuration: 2000,
        confidence: 0.8,
      });
      offerId3 = o3.id;
    });

    it('LOWEST_COST selects cheapest offer', () => {
      const offers = negotiation.getPendingOffers(negotiationId);
      const best = negotiation.selectBestOffer(offers, ResolutionStrategy.LOWEST_COST);
      expect(best?.fromAgentId).toBe('agent-3'); // price: 10
    });

    it('FASTEST selects shortest duration', () => {
      const offers = negotiation.getPendingOffers(negotiationId);
      const best = negotiation.selectBestOffer(offers, ResolutionStrategy.FASTEST);
      expect(best?.fromAgentId).toBe('agent-4'); // duration: 2000
    });

    it('HIGHEST_CONFIDENCE selects most confident', () => {
      const offers = negotiation.getPendingOffers(negotiationId);
      const best = negotiation.selectBestOffer(offers, ResolutionStrategy.HIGHEST_CONFIDENCE);
      expect(best?.fromAgentId).toBe('agent-3'); // confidence: 0.95
    });

    it('BEST_SCORE uses weighted scoring', () => {
      const offers = negotiation.getPendingOffers(negotiationId);
      const best = negotiation.selectBestOffer(offers, ResolutionStrategy.BEST_SCORE);
      expect(best).toBeDefined();
      // Should pick agent-4 (good price, fast, decent confidence)
      // or agent-3 depending on weights
    });

    it('returns null for empty offers list', () => {
      const best = negotiation.selectBestOffer([], ResolutionStrategy.LOWEST_COST);
      expect(best).toBeNull();
    });

    it('HIGHEST_REPUTATION falls back to BEST_SCORE without reputation manager', () => {
      const offers = negotiation.getPendingOffers(negotiationId);
      const best = negotiation.selectBestOffer(offers, ResolutionStrategy.HIGHEST_REPUTATION);
      expect(best).toBeDefined();
    });
  });

  // ─── Scoring ───────────────────────────────────────────────────────────

  describe('scoreOffer', () => {
    it('scores a standard offer', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const offer = negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      const score = negotiation.scoreOffer(offer);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('higher confidence yields higher score (all else equal)', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const low = negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.3,
      });

      const high = negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-3',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.95,
      });

      expect(negotiation.scoreOffer(high)).toBeGreaterThan(negotiation.scoreOffer(low));
    });

    it('lower price yields higher score (all else equal)', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const expensive = negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 80,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      const cheap = negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-3',
        toAgentId: 'agent-1',
        proposedPrice: 5,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      expect(negotiation.scoreOffer(cheap)).toBeGreaterThan(negotiation.scoreOffer(expensive));
    });

    it('shorter duration yields higher score (all else equal)', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const slow = negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 50000,
        confidence: 0.9,
      });

      const fast = negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-3',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 1000,
        confidence: 0.9,
      });

      expect(negotiation.scoreOffer(fast)).toBeGreaterThan(negotiation.scoreOffer(slow));
    });

    it('factors in reputation when manager is set', () => {
      const rep = new ReputationManager();
      for (let i = 0; i < 20; i++) {
        rep.recordSuccess('agent-trusted', 1000, 5);
      }
      for (let i = 0; i < 20; i++) {
        rep.recordFailure('agent-unreliable');
      }

      const negWithRep = new AgentNegotiation(
        { defaultDeadlineMs: 0, defaultOfferExpiryMs: 0 },
        rep,
      );

      const n = negWithRep.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const trusted = negWithRep.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-trusted',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      const unreliable = negWithRep.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-unreliable',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      expect(negWithRep.scoreOffer(trusted)).toBeGreaterThan(negWithRep.scoreOffer(unreliable));
      negWithRep.destroy();
    });

    it('score stays between 0 and 1 for extreme values', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const extremeHigh = negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 0,
        estimatedDuration: 0,
        confidence: 1.0,
      });

      const extremeLow = negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-3',
        toAgentId: 'agent-1',
        proposedPrice: 99,
        estimatedDuration: 59000,
        confidence: 0.1,
      });

      expect(negotiation.scoreOffer(extremeHigh)).toBeLessThanOrEqual(1);
      expect(negotiation.scoreOffer(extremeLow)).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Auto Resolve ──────────────────────────────────────────────────────

  describe('autoResolve', () => {
    it('auto-resolves by accepting best offer', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
        strategy: ResolutionStrategy.LOWEST_COST,
      });

      negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 20,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-3',
        toAgentId: 'agent-1',
        proposedPrice: 5,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      const winner = negotiation.autoResolve(n.id);
      expect(winner?.fromAgentId).toBe('agent-3');

      const resolved = negotiation.getNegotiation(n.id)!;
      expect(resolved.phase).toBe(NegotiationPhase.ACCEPTED);
    });

    it('returns accepted offer if already resolved', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const offer = negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      negotiation.acceptOffer(n.id, offer.id, 'agent-1');
      const result = negotiation.autoResolve(n.id);
      expect(result?.id).toBe(offer.id);
    });

    it('returns null for cancelled negotiation', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      negotiation.cancelNegotiation(n.id, 'agent-1');
      const result = negotiation.autoResolve(n.id);
      expect(result).toBeNull();
    });

    it('returns null when no pending offers exist', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const result = negotiation.autoResolve(n.id);
      expect(result).toBeNull();
    });
  });

  // ─── Queries ───────────────────────────────────────────────────────────

  describe('queries', () => {
    beforeEach(() => {
      // Create multiple negotiations in different states
      const n1 = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'web_research',
        description: 'Research 1',
        taskId: 'task-1',
      });

      const n2 = negotiation.createNegotiation({
        initiatorId: 'agent-2',
        capability: 'data_analysis',
        description: 'Analysis 1',
        taskId: 'task-1',
        participants: ['agent-1'],
      });

      const n3 = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'web_research',
        description: 'Research 2',
        taskId: 'task-2',
      });

      // Accept one
      const offer = negotiation.submitOffer({
        negotiationId: n3.id,
        fromAgentId: 'agent-3',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });
      negotiation.acceptOffer(n3.id, offer.id, 'agent-1');
    });

    it('getAllNegotiations returns all', () => {
      expect(negotiation.getAllNegotiations()).toHaveLength(3);
    });

    it('getActiveNegotiations excludes terminal states', () => {
      const active = negotiation.getActiveNegotiations();
      expect(active).toHaveLength(2); // 3rd is accepted
    });

    it('getActiveNegotiationsForAgent filters by agent', () => {
      const active = negotiation.getActiveNegotiationsForAgent('agent-1');
      expect(active).toHaveLength(2); // n1 (open, agent-1 initiated), n2 (open, agent-1 as participant), n3 is accepted
      const all = negotiation.getNegotiationsForAgent('agent-1');
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('getNegotiationsForTask returns all for a task', () => {
      const task1 = negotiation.getNegotiationsForTask('task-1');
      expect(task1).toHaveLength(2);
    });

    it('getNegotiationsByPhase returns correct phase', () => {
      const accepted = negotiation.getNegotiationsByPhase(NegotiationPhase.ACCEPTED);
      expect(accepted).toHaveLength(1);

      const open = negotiation.getNegotiationsByPhase(NegotiationPhase.OPEN);
      expect(open).toHaveLength(2);
    });

    it('getNegotiationsByCapability is case insensitive', () => {
      const results = negotiation.getNegotiationsByCapability('WEB_RESEARCH');
      expect(results).toHaveLength(2);
    });

    it('getNegotiationCount returns total count', () => {
      expect(negotiation.getNegotiationCount()).toBe(3);
    });

    it('getNegotiation returns undefined for non-existent', () => {
      expect(negotiation.getNegotiation('non-existent')).toBeUndefined();
    });
  });

  // ─── Negotiation Summary ───────────────────────────────────────────────

  describe('getNegotiationSummary', () => {
    it('summarizes an open negotiation', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const summary = negotiation.getNegotiationSummary(n.id);
      expect(summary.negotiationId).toBe(n.id);
      expect(summary.phase).toBe(NegotiationPhase.OPEN);
      expect(summary.participantCount).toBe(1);
      expect(summary.offerCount).toBe(0);
      expect(summary.capability).toBe('test');
    });

    it('summarizes with offers', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
        strategy: ResolutionStrategy.LOWEST_COST,
      });

      negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 20,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-3',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 3000,
        confidence: 0.8,
      });

      const summary = negotiation.getNegotiationSummary(n.id);
      expect(summary.offerCount).toBe(2);
      expect(summary.bestOfferPrice).toBe(10);
      expect(summary.bestOfferAgentId).toBe('agent-3');
    });

    it('summarizes accepted negotiation', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const offer = negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 15,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      negotiation.acceptOffer(n.id, offer.id, 'agent-1');

      const summary = negotiation.getNegotiationSummary(n.id);
      expect(summary.phase).toBe(NegotiationPhase.ACCEPTED);
      expect(summary.bestOfferPrice).toBe(15);
      expect(summary.bestOfferAgentId).toBe('agent-2');
    });

    it('returns -1 timeRemaining when no deadline', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
        deadlineMs: 0,
      });

      const summary = negotiation.getNegotiationSummary(n.id);
      expect(summary.timeRemaining).toBe(-1);
    });

    it('throws for non-existent negotiation', () => {
      expect(() =>
        negotiation.getNegotiationSummary('non-existent')
      ).toThrow('not found');
    });
  });

  // ─── Agent Stats ───────────────────────────────────────────────────────

  describe('getAgentStats', () => {
    it('returns zero stats for unknown agent', () => {
      const stats = negotiation.getAgentStats('unknown');
      expect(stats.totalNegotiations).toBe(0);
      expect(stats.wonCount).toBe(0);
      expect(stats.winRate).toBe(0);
    });

    it('tracks initiated vs participated', () => {
      const n1 = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
        participants: ['agent-2'],
      });

      const n2 = negotiation.createNegotiation({
        initiatorId: 'agent-2',
        capability: 'test',
        description: 'test',
        participants: ['agent-1'],
      });

      const stats1 = negotiation.getAgentStats('agent-1');
      expect(stats1.initiatedCount).toBe(1);
      expect(stats1.participatedCount).toBe(1);
      expect(stats1.totalNegotiations).toBe(2);
    });

    it('tracks win rate', () => {
      // agent-2 wins
      const n1 = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test 1',
        participants: ['agent-2', 'agent-3'],
      });

      const o1 = negotiation.submitOffer({
        negotiationId: n1.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      negotiation.submitOffer({
        negotiationId: n1.id,
        fromAgentId: 'agent-3',
        toAgentId: 'agent-1',
        proposedPrice: 20,
        estimatedDuration: 5000,
        confidence: 0.8,
      });

      negotiation.acceptOffer(n1.id, o1.id, 'agent-1');

      const stats2 = negotiation.getAgentStats('agent-2');
      expect(stats2.wonCount).toBe(1);
      expect(stats2.winRate).toBe(1); // 1/1

      const stats3 = negotiation.getAgentStats('agent-3');
      expect(stats3.lostCount).toBe(1);
      expect(stats3.winRate).toBe(0); // 0/1
    });

    it('calculates average accepted price', () => {
      for (let i = 0; i < 3; i++) {
        const n = negotiation.createNegotiation({
          initiatorId: 'agent-1',
          capability: 'test',
          description: `test ${i}`,
        });

        const offer = negotiation.submitOffer({
          negotiationId: n.id,
          fromAgentId: 'agent-2',
          toAgentId: 'agent-1',
          proposedPrice: 10 * (i + 1), // 10, 20, 30
          estimatedDuration: 5000,
          confidence: 0.9,
        });

        negotiation.acceptOffer(n.id, offer.id, 'agent-1');
      }

      const stats = negotiation.getAgentStats('agent-2');
      expect(stats.averageAcceptedPrice).toBe(20); // (10+20+30)/3
    });

    it('calculates average confidence', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
        maxRounds: 10,
      });

      negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.8,
      });

      negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 12,
        estimatedDuration: 4000,
        confidence: 0.6,
      });

      const stats = negotiation.getAgentStats('agent-2');
      expect(stats.averageConfidence).toBe(0.7); // (0.8+0.6)/2
    });
  });

  // ─── Offer Queries ─────────────────────────────────────────────────────

  describe('offer queries', () => {
    let negotiationId: string;

    beforeEach(() => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
        maxRounds: 10,
      });
      negotiationId = n.id;

      negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      negotiation.submitOffer({
        negotiationId,
        fromAgentId: 'agent-3',
        toAgentId: 'agent-1',
        proposedPrice: 15,
        estimatedDuration: 3000,
        confidence: 0.85,
      });
    });

    it('getOffers returns all offers', () => {
      const offers = negotiation.getOffers(negotiationId);
      expect(offers).toHaveLength(2);
    });

    it('getPendingOffers returns only pending', () => {
      const pending = negotiation.getPendingOffers(negotiationId);
      expect(pending).toHaveLength(2);

      // Accept one
      negotiation.acceptOffer(negotiationId, pending[0].id, 'agent-1');

      const remainingPending = negotiation.getPendingOffers(negotiationId);
      expect(remainingPending).toHaveLength(0); // All others rejected
    });

    it('getAgentOffers filters by agent', () => {
      const agent2Offers = negotiation.getAgentOffers(negotiationId, 'agent-2');
      expect(agent2Offers).toHaveLength(1);
      expect(agent2Offers[0].fromAgentId).toBe('agent-2');
    });

    it('getAgentOffers returns empty for non-participant', () => {
      const offers = negotiation.getAgentOffers(negotiationId, 'agent-99');
      expect(offers).toHaveLength(0);
    });

    it('getOffers returns defensive copy', () => {
      const offers1 = negotiation.getOffers(negotiationId);
      const offers2 = negotiation.getOffers(negotiationId);
      expect(offers1).not.toBe(offers2);
    });
  });

  // ─── Configuration ─────────────────────────────────────────────────────

  describe('configuration', () => {
    it('returns a copy of config', () => {
      const config = negotiation.getConfig();
      config.defaultMaxRounds = 999;
      expect(negotiation.getConfig().defaultMaxRounds).not.toBe(999);
    });

    it('updates config partially', () => {
      negotiation.updateConfig({ defaultMaxRounds: 20 });
      expect(negotiation.getConfig().defaultMaxRounds).toBe(20);
      // Other values unchanged
      expect(negotiation.getConfig().minConfidence).toBe(0.1);
    });

    it('sets and gets reputation manager', () => {
      expect(negotiation.getReputationManager()).toBeNull();

      const rep = new ReputationManager();
      negotiation.setReputationManager(rep);
      expect(negotiation.getReputationManager()).toBe(rep);
    });
  });

  // ─── Cleanup ───────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('removeNegotiation removes terminal negotiation', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      negotiation.cancelNegotiation(n.id, 'agent-1');

      const removed = negotiation.removeNegotiation(n.id);
      expect(removed).toBe(true);
      expect(negotiation.getNegotiation(n.id)).toBeUndefined();
    });

    it('removeNegotiation throws for active negotiation', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      expect(() => negotiation.removeNegotiation(n.id)).toThrow('active');
    });

    it('removeNegotiation returns false for non-existent', () => {
      expect(negotiation.removeNegotiation('non-existent')).toBe(false);
    });

    it('destroy clears everything', () => {
      negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      negotiation.destroy();
      expect(negotiation.getNegotiationCount()).toBe(0);
    });
  });

  // ─── checkExpired ──────────────────────────────────────────────────────

  describe('checkExpired', () => {
    it('returns empty when nothing expired', () => {
      negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
        deadlineMs: 0,
      });

      const result = negotiation.checkExpired();
      expect(result.expiredNegotiations).toHaveLength(0);
      expect(result.expiredOffers).toHaveLength(0);
    });

    it('does not expire already terminal negotiations', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      negotiation.cancelNegotiation(n.id, 'agent-1');

      const result = negotiation.checkExpired();
      expect(result.expiredNegotiations).toHaveLength(0);
    });
  });

  // ─── Reputation Integration ────────────────────────────────────────────

  describe('reputation integration', () => {
    it('HIGHEST_REPUTATION strategy uses reputation scores', () => {
      const rep = new ReputationManager();
      for (let i = 0; i < 10; i++) {
        rep.recordSuccess('agent-good', 1000, 5);
      }
      for (let i = 0; i < 10; i++) {
        rep.recordFailure('agent-bad');
      }

      const neg = new AgentNegotiation(
        { defaultDeadlineMs: 0, defaultOfferExpiryMs: 0 },
        rep,
      );

      const n = neg.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
        strategy: ResolutionStrategy.HIGHEST_REPUTATION,
      });

      neg.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-good',
        toAgentId: 'agent-1',
        proposedPrice: 20,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      neg.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-bad',
        toAgentId: 'agent-1',
        proposedPrice: 5,
        estimatedDuration: 1000,
        confidence: 0.95,
      });

      const winner = neg.autoResolve(n.id);
      expect(winner?.fromAgentId).toBe('agent-good');

      neg.destroy();
    });

    it('scoring without reputation uses neutral default', () => {
      const n = negotiation.createNegotiation({
        initiatorId: 'agent-1',
        capability: 'test',
        description: 'test',
      });

      const offer = negotiation.submitOffer({
        negotiationId: n.id,
        fromAgentId: 'agent-2',
        toAgentId: 'agent-1',
        proposedPrice: 10,
        estimatedDuration: 5000,
        confidence: 0.9,
      });

      const score = negotiation.scoreOffer(offer);
      // Neutral reputation (0.5) * 0.2 weight = 0.1 reputation component
      expect(score).toBeGreaterThan(0);
    });
  });
});
