/**
 * AgentNegotiation - Multi-round negotiation protocol for agent coordination
 *
 * Enables agents to negotiate task assignments, resource allocation, and pricing
 * through a structured offer/counter-offer/accept/reject protocol with timeouts,
 * deadlines, and automatic resolution strategies.
 *
 * Integrates with ReputationManager for trust-weighted negotiation scoring
 * and TaskCoordinator for seamless task lifecycle management.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { ReputationManager } from './reputation';

// ─── Types ──────────────────────────────────────────────────────────────────

/** The current phase of a negotiation */
export enum NegotiationPhase {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  COUNTER_OFFERED = 'counter_offered',
}

/** Strategy for automatically resolving negotiations */
export enum ResolutionStrategy {
  /** Accept the best offer by weighted score (confidence, cost, reputation) */
  BEST_SCORE = 'best_score',
  /** Accept the lowest cost offer */
  LOWEST_COST = 'lowest_cost',
  /** Accept the fastest estimated completion */
  FASTEST = 'fastest',
  /** Accept the highest confidence offer */
  HIGHEST_CONFIDENCE = 'highest_confidence',
  /** Accept the offer from the agent with highest reputation */
  HIGHEST_REPUTATION = 'highest_reputation',
  /** Manual resolution only (no auto-accept) */
  MANUAL = 'manual',
}

/** Represents a negotiation offer (initial or counter) */
export interface NegotiationOffer {
  id: string;
  negotiationId: string;
  fromAgentId: string;
  toAgentId: string;
  /** Which round of negotiation this offer belongs to (1-based) */
  round: number;
  /** Task capability being negotiated */
  capability: string;
  /** Proposed price in HBAR */
  proposedPrice: number;
  /** Estimated duration in milliseconds */
  estimatedDuration: number;
  /** Agent's confidence in completing the task (0-1) */
  confidence: number;
  /** Optional terms/conditions as key-value pairs */
  terms: Record<string, unknown>;
  /** When this offer was created */
  createdAt: number;
  /** When this offer expires (0 = no expiry) */
  expiresAt: number;
  /** Whether this is a counter-offer */
  isCounterOffer: boolean;
  /** Status of this specific offer */
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'superseded';
}

/** Full negotiation session between two or more agents */
export interface Negotiation {
  id: string;
  /** Agent who initiated the negotiation (task requester) */
  initiatorId: string;
  /** Task ID this negotiation is for (optional) */
  taskId?: string;
  /** Capability being negotiated */
  capability: string;
  /** Description of what is being negotiated */
  description: string;
  /** All participating agent IDs */
  participants: string[];
  /** All offers in chronological order */
  offers: NegotiationOffer[];
  /** Current phase */
  phase: NegotiationPhase;
  /** Maximum number of negotiation rounds allowed */
  maxRounds: number;
  /** Current round number */
  currentRound: number;
  /** Resolution strategy for auto-accepting */
  strategy: ResolutionStrategy;
  /** When the entire negotiation expires */
  deadline: number;
  /** The winning/accepted offer (if any) */
  acceptedOffer?: NegotiationOffer;
  /** Reason for rejection/cancellation (if applicable) */
  rejectionReason?: string;
  /** When negotiation was created */
  createdAt: number;
  /** When negotiation was last updated */
  updatedAt: number;
  /** Minimum acceptable price (set by initiator, optional) */
  minPrice?: number;
  /** Maximum acceptable price (set by initiator, optional) */
  maxPrice?: number;
  /** Priority level */
  priority: 'low' | 'medium' | 'high' | 'critical';
  /** Custom metadata */
  metadata: Record<string, unknown>;
}

/** Summary of a negotiation for reporting */
export interface NegotiationSummary {
  negotiationId: string;
  phase: NegotiationPhase;
  participantCount: number;
  offerCount: number;
  currentRound: number;
  maxRounds: number;
  bestOfferPrice?: number;
  bestOfferAgentId?: string;
  timeRemaining: number;
  capability: string;
}

/** Statistics about negotiations for an agent */
export interface NegotiationAgentStats {
  agentId: string;
  totalNegotiations: number;
  initiatedCount: number;
  participatedCount: number;
  wonCount: number;
  lostCount: number;
  expiredCount: number;
  cancelledCount: number;
  averageRoundsToAccept: number;
  averageAcceptedPrice: number;
  averageConfidence: number;
  winRate: number;
}

/** Configuration for the negotiation engine */
export interface NegotiationConfig {
  /** Default maximum rounds per negotiation (default: 5) */
  defaultMaxRounds: number;
  /** Default negotiation deadline in ms from creation (default: 5 minutes) */
  defaultDeadlineMs: number;
  /** Default offer expiry in ms from creation (default: 60 seconds) */
  defaultOfferExpiryMs: number;
  /** Default resolution strategy (default: BEST_SCORE) */
  defaultStrategy: ResolutionStrategy;
  /** Minimum confidence to participate (default: 0.1) */
  minConfidence: number;
  /** Maximum concurrent negotiations per agent (default: 10) */
  maxConcurrentPerAgent: number;
  /** Enable reputation weighting in scoring (default: true) */
  useReputationWeighting: boolean;
  /** Weight for price in scoring (default: 0.3) */
  priceWeight: number;
  /** Weight for confidence in scoring (default: 0.3) */
  confidenceWeight: number;
  /** Weight for duration in scoring (default: 0.2) */
  durationWeight: number;
  /** Weight for reputation in scoring (default: 0.2) */
  reputationWeight: number;
  /** Auto-resolve when deadline expires (default: true) */
  autoResolveOnDeadline: boolean;
  /** Counter-offer price adjustment limit as fraction (default: 0.5 = 50%) */
  maxPriceAdjustment: number;
}

const DEFAULT_CONFIG: NegotiationConfig = {
  defaultMaxRounds: 5,
  defaultDeadlineMs: 300000, // 5 minutes
  defaultOfferExpiryMs: 60000, // 1 minute
  defaultStrategy: ResolutionStrategy.BEST_SCORE,
  minConfidence: 0.1,
  maxConcurrentPerAgent: 10,
  useReputationWeighting: true,
  priceWeight: 0.3,
  confidenceWeight: 0.3,
  durationWeight: 0.2,
  reputationWeight: 0.2,
  autoResolveOnDeadline: true,
  maxPriceAdjustment: 0.5,
};

// ─── Main Class ─────────────────────────────────────────────────────────────

export class AgentNegotiation extends EventEmitter {
  private negotiations: Map<string, Negotiation> = new Map();
  private config: NegotiationConfig;
  private reputation: ReputationManager | null;
  private deadlineTimers: Map<string, NodeJS.Timeout> = new Map();
  private offerExpiryTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config?: Partial<NegotiationConfig>, reputation?: ReputationManager) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.reputation = reputation ?? null;
  }

  // ─── Negotiation Lifecycle ───────────────────────────────────────────────

  /**
   * Create a new negotiation session
   */
  createNegotiation(params: {
    initiatorId: string;
    capability: string;
    description: string;
    participants?: string[];
    taskId?: string;
    maxRounds?: number;
    strategy?: ResolutionStrategy;
    deadlineMs?: number;
    minPrice?: number;
    maxPrice?: number;
    priority?: Negotiation['priority'];
    metadata?: Record<string, unknown>;
  }): Negotiation {
    const {
      initiatorId,
      capability,
      description,
      participants = [],
      taskId,
      maxRounds = this.config.defaultMaxRounds,
      strategy = this.config.defaultStrategy,
      deadlineMs = this.config.defaultDeadlineMs,
      minPrice,
      maxPrice,
      priority = 'medium',
      metadata = {},
    } = params;

    if (!initiatorId) {
      throw new Error('Negotiation requires an initiatorId');
    }
    if (!capability) {
      throw new Error('Negotiation requires a capability');
    }
    if (!description) {
      throw new Error('Negotiation requires a description');
    }
    if (maxRounds < 1) {
      throw new Error('maxRounds must be at least 1');
    }
    if (maxRounds > 100) {
      throw new Error('maxRounds cannot exceed 100');
    }
    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      throw new Error('minPrice cannot exceed maxPrice');
    }
    if (deadlineMs < 0) {
      throw new Error('deadlineMs cannot be negative');
    }

    // Check concurrent negotiation limit for initiator
    const activeCount = this.getActiveNegotiationsForAgent(initiatorId).length;
    if (activeCount >= this.config.maxConcurrentPerAgent) {
      throw new Error(
        `Agent ${initiatorId} has reached the maximum concurrent negotiation limit (${this.config.maxConcurrentPerAgent})`
      );
    }

    const now = Date.now();
    const allParticipants = [initiatorId, ...participants.filter(p => p !== initiatorId)];

    const negotiation: Negotiation = {
      id: uuidv4(),
      initiatorId,
      taskId,
      capability,
      description,
      participants: allParticipants,
      offers: [],
      phase: NegotiationPhase.OPEN,
      maxRounds,
      currentRound: 0,
      strategy,
      deadline: deadlineMs > 0 ? now + deadlineMs : 0,
      createdAt: now,
      updatedAt: now,
      minPrice,
      maxPrice,
      priority,
      metadata,
    };

    this.negotiations.set(negotiation.id, negotiation);

    // Set deadline timer if applicable
    if (negotiation.deadline > 0 && deadlineMs > 0) {
      const timer = setTimeout(() => {
        this.handleDeadlineExpired(negotiation.id);
      }, deadlineMs);
      this.deadlineTimers.set(negotiation.id, timer);
    }

    this.emit('negotiation:created', negotiation);
    return negotiation;
  }

  /**
   * Submit an offer to a negotiation
   */
  submitOffer(params: {
    negotiationId: string;
    fromAgentId: string;
    toAgentId: string;
    proposedPrice: number;
    estimatedDuration: number;
    confidence: number;
    terms?: Record<string, unknown>;
    expiresInMs?: number;
  }): NegotiationOffer {
    const {
      negotiationId,
      fromAgentId,
      toAgentId,
      proposedPrice,
      estimatedDuration,
      confidence,
      terms = {},
      expiresInMs = this.config.defaultOfferExpiryMs,
    } = params;

    const negotiation = this.getNegotiationOrThrow(negotiationId);

    // Validate negotiation state - allow offers while negotiation is active
    const activePhases = [NegotiationPhase.OPEN, NegotiationPhase.IN_PROGRESS, NegotiationPhase.COUNTER_OFFERED];
    if (!activePhases.includes(negotiation.phase)) {
      throw new Error(`Cannot submit offer: negotiation is ${negotiation.phase}`);
    }

    // Validate deadline
    if (negotiation.deadline > 0 && Date.now() > negotiation.deadline) {
      this.handleDeadlineExpired(negotiationId);
      throw new Error('Cannot submit offer: negotiation deadline has passed');
    }

    // Validate round limit
    if (negotiation.currentRound >= negotiation.maxRounds) {
      throw new Error(`Cannot submit offer: maximum rounds (${negotiation.maxRounds}) reached`);
    }

    // Validate confidence
    if (confidence < 0 || confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }
    if (confidence < this.config.minConfidence) {
      throw new Error(`Confidence must be at least ${this.config.minConfidence}`);
    }

    // Validate price
    if (proposedPrice < 0) {
      throw new Error('Proposed price cannot be negative');
    }
    if (negotiation.maxPrice !== undefined && proposedPrice > negotiation.maxPrice) {
      throw new Error(`Proposed price ${proposedPrice} exceeds maximum ${negotiation.maxPrice}`);
    }

    // Validate duration
    if (estimatedDuration < 0) {
      throw new Error('Estimated duration cannot be negative');
    }

    // Validate participant
    if (!negotiation.participants.includes(fromAgentId)) {
      // Auto-add participant if negotiation is open
      negotiation.participants.push(fromAgentId);
    }

    const now = Date.now();
    const offer: NegotiationOffer = {
      id: uuidv4(),
      negotiationId,
      fromAgentId,
      toAgentId,
      round: negotiation.currentRound + 1,
      capability: negotiation.capability,
      proposedPrice,
      estimatedDuration,
      confidence,
      terms,
      createdAt: now,
      expiresAt: expiresInMs > 0 ? now + expiresInMs : 0,
      isCounterOffer: false,
      status: 'pending',
    };

    negotiation.offers.push(offer);
    negotiation.currentRound = offer.round;
    negotiation.phase = NegotiationPhase.IN_PROGRESS;
    negotiation.updatedAt = now;

    // Set offer expiry timer
    if (offer.expiresAt > 0 && expiresInMs > 0) {
      const timer = setTimeout(() => {
        this.handleOfferExpired(offer.id, negotiationId);
      }, expiresInMs);
      this.offerExpiryTimers.set(offer.id, timer);
    }

    this.emit('negotiation:offer', offer);
    return offer;
  }

  /**
   * Submit a counter-offer in response to an existing offer
   */
  submitCounterOffer(params: {
    negotiationId: string;
    originalOfferId: string;
    fromAgentId: string;
    toAgentId: string;
    proposedPrice: number;
    estimatedDuration: number;
    confidence: number;
    terms?: Record<string, unknown>;
    expiresInMs?: number;
  }): NegotiationOffer {
    const {
      negotiationId,
      originalOfferId,
      fromAgentId,
      toAgentId,
      proposedPrice,
      estimatedDuration,
      confidence,
      terms = {},
      expiresInMs = this.config.defaultOfferExpiryMs,
    } = params;

    const negotiation = this.getNegotiationOrThrow(negotiationId);

    // Find the original offer
    const originalOffer = negotiation.offers.find(o => o.id === originalOfferId);
    if (!originalOffer) {
      throw new Error(`Original offer ${originalOfferId} not found`);
    }
    if (originalOffer.status !== 'pending') {
      throw new Error(`Cannot counter a ${originalOffer.status} offer`);
    }

    // Validate round limit
    if (negotiation.currentRound >= negotiation.maxRounds) {
      throw new Error(`Cannot submit counter-offer: maximum rounds (${negotiation.maxRounds}) reached`);
    }

    if (proposedPrice < 0) {
      throw new Error('Proposed price cannot be negative');
    }

    // Validate price adjustment limit
    if (this.config.maxPriceAdjustment > 0 && originalOffer.proposedPrice > 0) {
      const priceChange = Math.abs(proposedPrice - originalOffer.proposedPrice) / originalOffer.proposedPrice;
      if (priceChange > this.config.maxPriceAdjustment) {
        throw new Error(
          `Price adjustment ${(priceChange * 100).toFixed(1)}% exceeds limit of ${(this.config.maxPriceAdjustment * 100).toFixed(1)}%`
        );
      }
    }

    // Validate confidence
    if (confidence < 0 || confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }
    if (confidence < this.config.minConfidence) {
      throw new Error(`Confidence must be at least ${this.config.minConfidence}`);
    }

    if (estimatedDuration < 0) {
      throw new Error('Estimated duration cannot be negative');
    }

    // Validate deadline
    if (negotiation.deadline > 0 && Date.now() > negotiation.deadline) {
      this.handleDeadlineExpired(negotiationId);
      throw new Error('Cannot submit counter-offer: negotiation deadline has passed');
    }

    // Mark original offer as superseded
    originalOffer.status = 'superseded';

    const now = Date.now();
    const counterOffer: NegotiationOffer = {
      id: uuidv4(),
      negotiationId,
      fromAgentId,
      toAgentId,
      round: negotiation.currentRound + 1,
      capability: negotiation.capability,
      proposedPrice,
      estimatedDuration,
      confidence,
      terms,
      createdAt: now,
      expiresAt: expiresInMs > 0 ? now + expiresInMs : 0,
      isCounterOffer: true,
      status: 'pending',
    };

    negotiation.offers.push(counterOffer);
    negotiation.currentRound = counterOffer.round;
    negotiation.phase = NegotiationPhase.COUNTER_OFFERED;
    negotiation.updatedAt = now;

    if (!negotiation.participants.includes(fromAgentId)) {
      negotiation.participants.push(fromAgentId);
    }

    // Set offer expiry timer
    if (counterOffer.expiresAt > 0 && expiresInMs > 0) {
      const timer = setTimeout(() => {
        this.handleOfferExpired(counterOffer.id, negotiationId);
      }, expiresInMs);
      this.offerExpiryTimers.set(counterOffer.id, timer);
    }

    this.emit('negotiation:counterOffer', counterOffer);
    return counterOffer;
  }

  /**
   * Accept an offer, completing the negotiation
   */
  acceptOffer(negotiationId: string, offerId: string, acceptingAgentId: string): Negotiation {
    const negotiation = this.getNegotiationOrThrow(negotiationId);

    if (negotiation.phase === NegotiationPhase.ACCEPTED) {
      throw new Error('Negotiation already has an accepted offer');
    }
    if (negotiation.phase === NegotiationPhase.CANCELLED) {
      throw new Error('Cannot accept offer on cancelled negotiation');
    }
    if (negotiation.phase === NegotiationPhase.EXPIRED) {
      throw new Error('Cannot accept offer on expired negotiation');
    }

    const offer = negotiation.offers.find(o => o.id === offerId);
    if (!offer) {
      throw new Error(`Offer ${offerId} not found`);
    }
    if (offer.status !== 'pending') {
      throw new Error(`Cannot accept a ${offer.status} offer`);
    }

    // Only the recipient of the offer can accept it
    if (offer.toAgentId !== acceptingAgentId) {
      throw new Error(`Agent ${acceptingAgentId} is not the recipient of this offer`);
    }

    // Check offer expiry
    if (offer.expiresAt > 0 && Date.now() > offer.expiresAt) {
      offer.status = 'expired';
      throw new Error('Offer has expired');
    }

    // Accept the offer
    offer.status = 'accepted';

    // Mark all other pending offers as rejected
    for (const o of negotiation.offers) {
      if (o.id !== offerId && o.status === 'pending') {
        o.status = 'rejected';
      }
    }

    negotiation.acceptedOffer = offer;
    negotiation.phase = NegotiationPhase.ACCEPTED;
    negotiation.updatedAt = Date.now();

    // Clean up timers
    this.clearTimersForNegotiation(negotiationId);

    this.emit('negotiation:accepted', { negotiation, offer });
    return negotiation;
  }

  /**
   * Reject an offer
   */
  rejectOffer(negotiationId: string, offerId: string, rejectingAgentId: string, reason?: string): NegotiationOffer {
    const negotiation = this.getNegotiationOrThrow(negotiationId);

    const offer = negotiation.offers.find(o => o.id === offerId);
    if (!offer) {
      throw new Error(`Offer ${offerId} not found`);
    }
    if (offer.status !== 'pending') {
      throw new Error(`Cannot reject a ${offer.status} offer`);
    }

    // Only the recipient of the offer can reject it
    if (offer.toAgentId !== rejectingAgentId) {
      throw new Error(`Agent ${rejectingAgentId} is not the recipient of this offer`);
    }

    offer.status = 'rejected';
    negotiation.updatedAt = Date.now();

    // Check if all offers in the current round are rejected
    const pendingOffers = negotiation.offers.filter(o => o.status === 'pending');
    if (pendingOffers.length === 0 && negotiation.currentRound >= negotiation.maxRounds) {
      negotiation.phase = NegotiationPhase.REJECTED;
      negotiation.rejectionReason = reason || 'All offers rejected and max rounds reached';
      this.clearTimersForNegotiation(negotiationId);
      this.emit('negotiation:rejected', negotiation);
    }

    this.emit('negotiation:offerRejected', { negotiationId, offer, reason });
    return offer;
  }

  /**
   * Cancel a negotiation (only initiator can cancel)
   */
  cancelNegotiation(negotiationId: string, agentId: string, reason?: string): Negotiation {
    const negotiation = this.getNegotiationOrThrow(negotiationId);

    if (negotiation.initiatorId !== agentId) {
      throw new Error('Only the initiator can cancel a negotiation');
    }
    if (negotiation.phase === NegotiationPhase.ACCEPTED) {
      throw new Error('Cannot cancel an accepted negotiation');
    }

    // Mark all pending offers as rejected
    for (const offer of negotiation.offers) {
      if (offer.status === 'pending') {
        offer.status = 'rejected';
      }
    }

    negotiation.phase = NegotiationPhase.CANCELLED;
    negotiation.rejectionReason = reason || 'Cancelled by initiator';
    negotiation.updatedAt = Date.now();

    this.clearTimersForNegotiation(negotiationId);
    this.emit('negotiation:cancelled', negotiation);
    return negotiation;
  }

  // ─── Resolution ──────────────────────────────────────────────────────────

  /**
   * Auto-resolve a negotiation using its configured strategy
   * Returns the winning offer or null if no suitable offer exists
   */
  autoResolve(negotiationId: string): NegotiationOffer | null {
    const negotiation = this.getNegotiationOrThrow(negotiationId);

    if (negotiation.phase === NegotiationPhase.ACCEPTED) {
      return negotiation.acceptedOffer || null;
    }
    if (negotiation.phase === NegotiationPhase.CANCELLED || negotiation.phase === NegotiationPhase.EXPIRED) {
      return null;
    }

    const pendingOffers = negotiation.offers.filter(o => o.status === 'pending');
    if (pendingOffers.length === 0) {
      return null;
    }

    const bestOffer = this.selectBestOffer(pendingOffers, negotiation.strategy);
    if (!bestOffer) return null;

    // Accept the best offer
    this.acceptOffer(negotiationId, bestOffer.id, bestOffer.toAgentId);
    return bestOffer;
  }

  /**
   * Score an offer based on weighted criteria
   */
  scoreOffer(offer: NegotiationOffer): number {
    const maxDuration = 60000; // Normalize against 60s max
    const maxPrice = 100; // Normalize against 100 HBAR max

    // Normalize each component to 0-1 (higher is better)
    const priceScore = maxPrice > 0 ? Math.max(0, 1 - offer.proposedPrice / maxPrice) : 1;
    const durationScore = maxDuration > 0 ? Math.max(0, 1 - offer.estimatedDuration / maxDuration) : 1;
    const confidenceScore = offer.confidence;

    let reputationScore = 0.5; // Neutral default
    if (this.reputation && this.config.useReputationWeighting) {
      const rep = this.reputation.getScore(offer.fromAgentId);
      reputationScore = rep.overallScore;
    }

    const score =
      priceScore * this.config.priceWeight +
      confidenceScore * this.config.confidenceWeight +
      durationScore * this.config.durationWeight +
      reputationScore * this.config.reputationWeight;

    return Math.round(score * 1000) / 1000;
  }

  /**
   * Select the best offer from a list based on strategy
   */
  selectBestOffer(offers: NegotiationOffer[], strategy: ResolutionStrategy): NegotiationOffer | null {
    if (offers.length === 0) return null;

    switch (strategy) {
      case ResolutionStrategy.LOWEST_COST:
        return offers.reduce((best, curr) =>
          curr.proposedPrice < best.proposedPrice ? curr : best
        );

      case ResolutionStrategy.FASTEST:
        return offers.reduce((best, curr) =>
          curr.estimatedDuration < best.estimatedDuration ? curr : best
        );

      case ResolutionStrategy.HIGHEST_CONFIDENCE:
        return offers.reduce((best, curr) =>
          curr.confidence > best.confidence ? curr : best
        );

      case ResolutionStrategy.HIGHEST_REPUTATION:
        if (!this.reputation) {
          // Fall back to best score if no reputation manager
          return this.selectBestOffer(offers, ResolutionStrategy.BEST_SCORE);
        }
        return offers.reduce((best, curr) => {
          const bestRep = this.reputation!.getScore(best.fromAgentId).overallScore;
          const currRep = this.reputation!.getScore(curr.fromAgentId).overallScore;
          return currRep > bestRep ? curr : best;
        });

      case ResolutionStrategy.BEST_SCORE:
      default:
        return offers.reduce((best, curr) => {
          const bestScore = this.scoreOffer(best);
          const currScore = this.scoreOffer(curr);
          return currScore > bestScore ? curr : best;
        });
    }
  }

  // ─── Queries ─────────────────────────────────────────────────────────────

  /**
   * Get a negotiation by ID
   */
  getNegotiation(negotiationId: string): Negotiation | undefined {
    return this.negotiations.get(negotiationId);
  }

  /**
   * Get all negotiations
   */
  getAllNegotiations(): Negotiation[] {
    return Array.from(this.negotiations.values());
  }

  /**
   * Get all active (non-terminal) negotiations
   */
  getActiveNegotiations(): Negotiation[] {
    return Array.from(this.negotiations.values()).filter(n =>
      n.phase === NegotiationPhase.OPEN ||
      n.phase === NegotiationPhase.IN_PROGRESS ||
      n.phase === NegotiationPhase.COUNTER_OFFERED
    );
  }

  /**
   * Get all active negotiations for a specific agent
   */
  getActiveNegotiationsForAgent(agentId: string): Negotiation[] {
    return this.getActiveNegotiations().filter(n =>
      n.participants.includes(agentId)
    );
  }

  /**
   * Get all negotiations for a specific agent (all phases)
   */
  getNegotiationsForAgent(agentId: string): Negotiation[] {
    return Array.from(this.negotiations.values()).filter(n =>
      n.participants.includes(agentId)
    );
  }

  /**
   * Get negotiations by task ID
   */
  getNegotiationsForTask(taskId: string): Negotiation[] {
    return Array.from(this.negotiations.values()).filter(n => n.taskId === taskId);
  }

  /**
   * Get negotiations by phase
   */
  getNegotiationsByPhase(phase: NegotiationPhase): Negotiation[] {
    return Array.from(this.negotiations.values()).filter(n => n.phase === phase);
  }

  /**
   * Get negotiations by capability
   */
  getNegotiationsByCapability(capability: string): Negotiation[] {
    return Array.from(this.negotiations.values()).filter(
      n => n.capability.toLowerCase() === capability.toLowerCase()
    );
  }

  /**
   * Get a summary of a negotiation
   */
  getNegotiationSummary(negotiationId: string): NegotiationSummary {
    const negotiation = this.getNegotiationOrThrow(negotiationId);
    const pendingOffers = negotiation.offers.filter(o => o.status === 'pending');

    let bestOfferPrice: number | undefined;
    let bestOfferAgentId: string | undefined;

    if (pendingOffers.length > 0) {
      const best = this.selectBestOffer(pendingOffers, negotiation.strategy);
      if (best) {
        bestOfferPrice = best.proposedPrice;
        bestOfferAgentId = best.fromAgentId;
      }
    } else if (negotiation.acceptedOffer) {
      bestOfferPrice = negotiation.acceptedOffer.proposedPrice;
      bestOfferAgentId = negotiation.acceptedOffer.fromAgentId;
    }

    const timeRemaining = negotiation.deadline > 0
      ? Math.max(0, negotiation.deadline - Date.now())
      : -1; // -1 indicates no deadline

    return {
      negotiationId: negotiation.id,
      phase: negotiation.phase,
      participantCount: negotiation.participants.length,
      offerCount: negotiation.offers.length,
      currentRound: negotiation.currentRound,
      maxRounds: negotiation.maxRounds,
      bestOfferPrice,
      bestOfferAgentId,
      timeRemaining,
      capability: negotiation.capability,
    };
  }

  /**
   * Get offers for a specific negotiation
   */
  getOffers(negotiationId: string): NegotiationOffer[] {
    const negotiation = this.getNegotiationOrThrow(negotiationId);
    return [...negotiation.offers];
  }

  /**
   * Get pending offers for a specific negotiation
   */
  getPendingOffers(negotiationId: string): NegotiationOffer[] {
    const negotiation = this.getNegotiationOrThrow(negotiationId);
    return negotiation.offers.filter(o => o.status === 'pending');
  }

  /**
   * Get offers from a specific agent in a negotiation
   */
  getAgentOffers(negotiationId: string, agentId: string): NegotiationOffer[] {
    const negotiation = this.getNegotiationOrThrow(negotiationId);
    return negotiation.offers.filter(o => o.fromAgentId === agentId);
  }

  /**
   * Get the total negotiation count
   */
  getNegotiationCount(): number {
    return this.negotiations.size;
  }

  // ─── Statistics ──────────────────────────────────────────────────────────

  /**
   * Get negotiation statistics for a specific agent
   */
  getAgentStats(agentId: string): NegotiationAgentStats {
    const allNegotiations = this.getNegotiationsForAgent(agentId);
    const initiated = allNegotiations.filter(n => n.initiatorId === agentId);
    const participated = allNegotiations.filter(n => n.initiatorId !== agentId);

    const won = allNegotiations.filter(n =>
      n.phase === NegotiationPhase.ACCEPTED &&
      n.acceptedOffer?.fromAgentId === agentId
    );

    const lost = allNegotiations.filter(n =>
      n.phase === NegotiationPhase.ACCEPTED &&
      n.participants.includes(agentId) &&
      n.acceptedOffer?.fromAgentId !== agentId &&
      n.initiatorId !== agentId
    );

    const expired = allNegotiations.filter(n => n.phase === NegotiationPhase.EXPIRED);
    const cancelled = allNegotiations.filter(n => n.phase === NegotiationPhase.CANCELLED);

    // Average rounds to accept for won negotiations
    const acceptedRounds = won.map(n => n.currentRound).filter(r => r > 0);
    const averageRoundsToAccept = acceptedRounds.length > 0
      ? acceptedRounds.reduce((a, b) => a + b, 0) / acceptedRounds.length
      : 0;

    // Average accepted price
    const acceptedPrices = won
      .map(n => n.acceptedOffer?.proposedPrice)
      .filter((p): p is number => p !== undefined);
    const averageAcceptedPrice = acceptedPrices.length > 0
      ? acceptedPrices.reduce((a, b) => a + b, 0) / acceptedPrices.length
      : 0;

    // Average confidence across all offers
    const agentOffers = allNegotiations.flatMap(n =>
      n.offers.filter(o => o.fromAgentId === agentId)
    );
    const avgConfidence = agentOffers.length > 0
      ? agentOffers.reduce((sum, o) => sum + o.confidence, 0) / agentOffers.length
      : 0;

    // Win rate: won / (won + lost)
    const totalCompeted = won.length + lost.length;
    const winRate = totalCompeted > 0 ? won.length / totalCompeted : 0;

    return {
      agentId,
      totalNegotiations: allNegotiations.length,
      initiatedCount: initiated.length,
      participatedCount: participated.length,
      wonCount: won.length,
      lostCount: lost.length,
      expiredCount: expired.length,
      cancelledCount: cancelled.length,
      averageRoundsToAccept: Math.round(averageRoundsToAccept * 100) / 100,
      averageAcceptedPrice: Math.round(averageAcceptedPrice * 100) / 100,
      averageConfidence: Math.round(avgConfidence * 1000) / 1000,
      winRate: Math.round(winRate * 1000) / 1000,
    };
  }

  // ─── Configuration ──────────────────────────────────────────────────────

  /**
   * Get the current configuration
   */
  getConfig(): NegotiationConfig {
    return { ...this.config };
  }

  /**
   * Update the configuration
   */
  updateConfig(partial: Partial<NegotiationConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * Set the reputation manager
   */
  setReputationManager(reputation: ReputationManager): void {
    this.reputation = reputation;
  }

  /**
   * Get the reputation manager
   */
  getReputationManager(): ReputationManager | null {
    return this.reputation;
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  /**
   * Clear all timers and negotiations
   */
  destroy(): void {
    for (const timer of this.deadlineTimers.values()) {
      clearTimeout(timer);
    }
    for (const timer of this.offerExpiryTimers.values()) {
      clearTimeout(timer);
    }
    this.deadlineTimers.clear();
    this.offerExpiryTimers.clear();
    this.negotiations.clear();
    this.removeAllListeners();
  }

  /**
   * Remove a completed/terminal negotiation from memory
   */
  removeNegotiation(negotiationId: string): boolean {
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) return false;

    const terminalPhases: NegotiationPhase[] = [
      NegotiationPhase.ACCEPTED,
      NegotiationPhase.REJECTED,
      NegotiationPhase.EXPIRED,
      NegotiationPhase.CANCELLED,
    ];

    if (!terminalPhases.includes(negotiation.phase)) {
      throw new Error('Cannot remove an active negotiation');
    }

    this.clearTimersForNegotiation(negotiationId);
    this.negotiations.delete(negotiationId);
    return true;
  }

  /**
   * Check and expire any negotiations/offers past their deadlines.
   * Useful for manual tick-based expiry instead of relying on timers.
   */
  checkExpired(): { expiredNegotiations: string[]; expiredOffers: string[] } {
    const now = Date.now();
    const expiredNegotiations: string[] = [];
    const expiredOffers: string[] = [];

    for (const [id, negotiation] of this.negotiations) {
      // Check negotiation deadline
      if (
        negotiation.deadline > 0 &&
        now > negotiation.deadline &&
        negotiation.phase !== NegotiationPhase.ACCEPTED &&
        negotiation.phase !== NegotiationPhase.CANCELLED &&
        negotiation.phase !== NegotiationPhase.EXPIRED &&
        negotiation.phase !== NegotiationPhase.REJECTED
      ) {
        this.handleDeadlineExpired(id);
        expiredNegotiations.push(id);
        continue;
      }

      // Check individual offer expiries
      for (const offer of negotiation.offers) {
        if (
          offer.status === 'pending' &&
          offer.expiresAt > 0 &&
          now > offer.expiresAt
        ) {
          offer.status = 'expired';
          expiredOffers.push(offer.id);
          this.emit('negotiation:offerExpired', { negotiationId: id, offer });
        }
      }
    }

    return { expiredNegotiations, expiredOffers };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private getNegotiationOrThrow(negotiationId: string): Negotiation {
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) {
      throw new Error(`Negotiation ${negotiationId} not found`);
    }
    return negotiation;
  }

  private handleDeadlineExpired(negotiationId: string): void {
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) return;

    // Already in terminal state
    if (
      negotiation.phase === NegotiationPhase.ACCEPTED ||
      negotiation.phase === NegotiationPhase.CANCELLED ||
      negotiation.phase === NegotiationPhase.EXPIRED ||
      negotiation.phase === NegotiationPhase.REJECTED
    ) {
      return;
    }

    // Try auto-resolve if configured
    if (this.config.autoResolveOnDeadline && negotiation.strategy !== ResolutionStrategy.MANUAL) {
      const pendingOffers = negotiation.offers.filter(o => o.status === 'pending');
      if (pendingOffers.length > 0) {
        const best = this.selectBestOffer(pendingOffers, negotiation.strategy);
        if (best) {
          this.acceptOffer(negotiationId, best.id, best.toAgentId);
          return;
        }
      }
    }

    // Mark all pending offers as expired
    for (const offer of negotiation.offers) {
      if (offer.status === 'pending') {
        offer.status = 'expired';
      }
    }

    negotiation.phase = NegotiationPhase.EXPIRED;
    negotiation.updatedAt = Date.now();
    this.clearTimersForNegotiation(negotiationId);

    this.emit('negotiation:expired', negotiation);
  }

  private handleOfferExpired(offerId: string, negotiationId: string): void {
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) return;

    const offer = negotiation.offers.find(o => o.id === offerId);
    if (!offer || offer.status !== 'pending') return;

    offer.status = 'expired';
    negotiation.updatedAt = Date.now();

    this.emit('negotiation:offerExpired', { negotiationId, offer });
  }

  private clearTimersForNegotiation(negotiationId: string): void {
    const deadlineTimer = this.deadlineTimers.get(negotiationId);
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
      this.deadlineTimers.delete(negotiationId);
    }

    // Clear any offer expiry timers for this negotiation
    const negotiation = this.negotiations.get(negotiationId);
    if (negotiation) {
      for (const offer of negotiation.offers) {
        const offerTimer = this.offerExpiryTimers.get(offer.id);
        if (offerTimer) {
          clearTimeout(offerTimer);
          this.offerExpiryTimers.delete(offer.id);
        }
      }
    }
  }
}
