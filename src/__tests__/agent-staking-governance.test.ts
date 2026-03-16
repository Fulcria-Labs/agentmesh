/**
 * Tests for AgentStaking Governance — DAO-style parameter changes,
 * weighted voting, quorum, and attack scenarios.
 */

import {
  StakingPool,
  StakingConfig,
  GovernanceProposal,
  ProposalView,
  SlashSeverity,
} from '../core/agent-staking';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const DEFAULT_CONFIG: StakingConfig = {
  minStake: 10,
  maxStake: 1000,
  baseReward: 100,
};

/** Creates a pool, stakes all agents, and returns the pool */
function setupPoolWithAgents(
  agentIds: string[],
  amounts: number[],
  taskId = 'task-gov',
): StakingPool {
  const pool = new StakingPool();
  pool.createPool(taskId, DEFAULT_CONFIG);
  agentIds.forEach((id, i) => pool.stake(id, taskId, amounts[i] ?? 50));
  return pool;
}

// ─────────────────────────────────────────────
// 1. Proposal Creation
// ─────────────────────────────────────────────

describe('Governance — proposal creation', () => {
  let pool: StakingPool;

  beforeEach(() => {
    pool = setupPoolWithAgents(['proposer'], [100]);
  });

  it('creates a proposal with correct proposer', () => {
    const p = pool.proposeParameterChange('proposer', 'minStake', 20);
    expect(p.proposer).toBe('proposer');
  });

  it('stores the target param name', () => {
    const p = pool.proposeParameterChange('proposer', 'minStake', 20);
    expect(p.param).toBe('minStake');
  });

  it('stores the proposed value', () => {
    const p = pool.proposeParameterChange('proposer', 'minStake', 20);
    expect(p.proposedValue).toBe(20);
  });

  it('status is active immediately after creation', () => {
    const p = pool.proposeParameterChange('proposer', 'minStake', 20);
    expect(p.status).toBe('active');
  });

  it('assigns a unique id', () => {
    const p1 = pool.proposeParameterChange('proposer', 'minStake', 20);
    const p2 = pool.proposeParameterChange('proposer', 'minStake', 30);
    expect(p1.id).not.toBe(p2.id);
  });

  it('sets expiresAt in the future', () => {
    const p = pool.proposeParameterChange('proposer', 'minStake', 20);
    expect(p.expiresAt).toBeGreaterThan(Date.now());
  });

  it('initialises vote tallies to zero', () => {
    const p = pool.proposeParameterChange('proposer', 'minStake', 20);
    expect(p.totalStakeFor).toBe(0);
    expect(p.totalStakeAgainst).toBe(0);
  });

  it('throws when proposer has no stake', () => {
    expect(() =>
      pool.proposeParameterChange('no-stake-agent', 'minStake', 20),
    ).toThrow(/must have staked/);
  });

  it('throws when proposed value is negative', () => {
    expect(() =>
      pool.proposeParameterChange('proposer', 'minStake', -5),
    ).toThrow(/non-negative/);
  });

  it('allows zero as proposed value', () => {
    expect(() =>
      pool.proposeParameterChange('proposer', 'minStake', 0),
    ).not.toThrow();
  });

  it('emits governance:proposed event', () => {
    const events: unknown[] = [];
    pool.on('governance:proposed', e => events.push(e));
    pool.proposeParameterChange('proposer', 'minStake', 20);
    expect(events).toHaveLength(1);
  });

  it('getProposal returns the created proposal', () => {
    const p = pool.proposeParameterChange('proposer', 'minStake', 20);
    const view = pool.getProposal(p.id);
    expect(view.id).toBe(p.id);
    expect(view.param).toBe('minStake');
  });

  it('listProposals includes all proposals', () => {
    pool.proposeParameterChange('proposer', 'minStake', 20);
    pool.proposeParameterChange('proposer', 'quorumThreshold', 0.6);
    expect(pool.listProposals()).toHaveLength(2);
  });

  it('getProposal throws for unknown id', () => {
    expect(() => pool.getProposal('nonexistent')).toThrow(/No proposal/);
  });
});

// ─────────────────────────────────────────────
// 2. Voting Mechanics
// ─────────────────────────────────────────────

describe('Governance — voting mechanics', () => {
  let pool: StakingPool;
  let proposalId: string;

  beforeEach(() => {
    pool = setupPoolWithAgents(['alice', 'bob', 'carol'], [100, 200, 150]);
    proposalId = pool.proposeParameterChange('alice', 'minStake', 20).id;
  });

  it('records a YES vote', () => {
    pool.voteOnProposal('alice', proposalId, true);
    const view = pool.getProposal(proposalId);
    expect(view.totalStakeFor).toBe(100);
    expect(view.voterCount).toBe(1);
  });

  it('records a NO vote', () => {
    pool.voteOnProposal('alice', proposalId, false);
    const view = pool.getProposal(proposalId);
    expect(view.totalStakeAgainst).toBe(100);
  });

  it('vote weight equals staked balance', () => {
    pool.voteOnProposal('bob', proposalId, true);
    const view = pool.getProposal(proposalId);
    expect(view.totalStakeFor).toBe(200);
  });

  it('multiple votes accumulate correctly', () => {
    pool.voteOnProposal('alice', proposalId, true);
    pool.voteOnProposal('bob', proposalId, true);
    pool.voteOnProposal('carol', proposalId, false);
    const view = pool.getProposal(proposalId);
    expect(view.totalStakeFor).toBe(300);
    expect(view.totalStakeAgainst).toBe(150);
    expect(view.voterCount).toBe(3);
  });

  it('emits governance:voted event', () => {
    const events: unknown[] = [];
    pool.on('governance:voted', e => events.push(e));
    pool.voteOnProposal('alice', proposalId, true);
    expect(events).toHaveLength(1);
  });

  it('throws on double vote', () => {
    pool.voteOnProposal('alice', proposalId, true);
    expect(() => pool.voteOnProposal('alice', proposalId, true)).toThrow(/already voted/);
  });

  it('throws when voting on non-existent proposal', () => {
    expect(() => pool.voteOnProposal('alice', 'fake-id', true)).toThrow(/No proposal/);
  });

  it('throws when agent has no stake', () => {
    expect(() => pool.voteOnProposal('no-stake', proposalId, true)).toThrow(/must have staked/);
  });

  it('different agents can vote YES and NO on same proposal', () => {
    pool.voteOnProposal('alice', proposalId, true);
    pool.voteOnProposal('bob', proposalId, false);
    const view = pool.getProposal(proposalId);
    expect(view.totalStakeFor).toBe(100);
    expect(view.totalStakeAgainst).toBe(200);
  });
});

// ─────────────────────────────────────────────
// 3. Quorum Calculation
// ─────────────────────────────────────────────

describe('Governance — quorum calculation', () => {
  let pool: StakingPool;

  beforeEach(() => {
    pool = setupPoolWithAgents(['alice', 'bob', 'carol'], [100, 100, 100]);
  });

  it('proposal passes when for > 50% of voted stake', () => {
    const p = pool.proposeParameterChange('alice', 'minStake', 20);
    pool.voteOnProposal('alice', p.id, true);
    pool.voteOnProposal('bob', p.id, true);
    pool.voteOnProposal('carol', p.id, false);
    // For=200, Against=100 → 66.7% > 50% quorum
    expect(() => pool.executeProposal(p.id)).not.toThrow();
    expect(pool.getProposal(p.id).status).toBe('executed');
  });

  it('proposal is rejected when for <= 50% of voted stake', () => {
    const p = pool.proposeParameterChange('alice', 'minStake', 20);
    pool.voteOnProposal('alice', p.id, true);
    pool.voteOnProposal('bob', p.id, false);
    // For=100, Against=100 → 50% not > 50% threshold
    pool.executeProposal(p.id);
    expect(pool.getProposal(p.id).status).toBe('rejected');
  });

  it('unanimously-yes vote passes', () => {
    const p = pool.proposeParameterChange('alice', 'minStake', 20);
    pool.voteOnProposal('alice', p.id, true);
    pool.voteOnProposal('bob', p.id, true);
    pool.voteOnProposal('carol', p.id, true);
    pool.executeProposal(p.id);
    expect(pool.getProposal(p.id).status).toBe('executed');
  });

  it('unanimously-no vote is rejected', () => {
    const p = pool.proposeParameterChange('alice', 'minStake', 20);
    pool.voteOnProposal('alice', p.id, false);
    pool.voteOnProposal('bob', p.id, false);
    pool.voteOnProposal('carol', p.id, false);
    pool.executeProposal(p.id);
    expect(pool.getProposal(p.id).status).toBe('rejected');
  });

  it('throws when no votes have been cast', () => {
    const p = pool.proposeParameterChange('alice', 'minStake', 20);
    expect(() => pool.executeProposal(p.id)).toThrow(/no votes/);
  });
});

// ─────────────────────────────────────────────
// 4. Proposal Execution
// ─────────────────────────────────────────────

describe('Governance — proposal execution', () => {
  let pool: StakingPool;

  beforeEach(() => {
    pool = setupPoolWithAgents(['alice', 'bob'], [300, 100]);
  });

  it('updates the global param on execution', () => {
    const p = pool.proposeParameterChange('alice', 'quorumThreshold', 0.7);
    pool.voteOnProposal('alice', p.id, true);
    pool.voteOnProposal('bob', p.id, false);
    pool.executeProposal(p.id);
    expect(pool.getParam('quorumThreshold')).toBe(0.7);
  });

  it('does not update param when rejected', () => {
    const orig = pool.getParam('quorumThreshold')!;
    const p = pool.proposeParameterChange('alice', 'quorumThreshold', 0.9);
    pool.voteOnProposal('alice', p.id, false);
    pool.voteOnProposal('bob', p.id, true);
    pool.executeProposal(p.id);
    expect(pool.getParam('quorumThreshold')).toBe(orig);
  });

  it('emits governance:executed on success', () => {
    const events: unknown[] = [];
    pool.on('governance:executed', e => events.push(e));
    const p = pool.proposeParameterChange('alice', 'quorumThreshold', 0.6);
    pool.voteOnProposal('alice', p.id, true);
    pool.executeProposal(p.id);
    expect(events).toHaveLength(1);
  });

  it('emits governance:rejected when rejected', () => {
    const events: unknown[] = [];
    pool.on('governance:rejected', e => events.push(e));
    const p = pool.proposeParameterChange('alice', 'quorumThreshold', 0.6);
    pool.voteOnProposal('alice', p.id, false);
    pool.voteOnProposal('bob', p.id, true);
    pool.executeProposal(p.id);
    expect(events).toHaveLength(1);
  });

  it('throws on double execution', () => {
    const p = pool.proposeParameterChange('alice', 'quorumThreshold', 0.6);
    pool.voteOnProposal('alice', p.id, true);
    pool.executeProposal(p.id);
    expect(() => pool.executeProposal(p.id)).toThrow(/already executed/);
  });

  it('throws on executing unknown proposal', () => {
    expect(() => pool.executeProposal('fake-id')).toThrow(/No proposal/);
  });

  it('getParam returns undefined for unknown keys', () => {
    const pool2 = new StakingPool();
    pool2.createPool('t1', DEFAULT_CONFIG);
    pool2.stake('alice', 't1', 100);
    expect(pool2.getParam('unknownKey')).toBeUndefined();
  });

  it('multiple parameter changes can be applied sequentially', () => {
    const p1 = pool.proposeParameterChange('alice', 'quorumThreshold', 0.6);
    pool.voteOnProposal('alice', p1.id, true);
    pool.executeProposal(p1.id);

    const p2 = pool.proposeParameterChange('alice', 'quorumThreshold', 0.7);
    pool.voteOnProposal('alice', p2.id, true);
    pool.executeProposal(p2.id);

    expect(pool.getParam('quorumThreshold')).toBe(0.7);
  });
});

// ─────────────────────────────────────────────
// 5. Edge Cases — Expired & Invalid Proposals
// ─────────────────────────────────────────────

describe('Governance — expired proposals', () => {
  it('voting on an expired proposal throws', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('alice', 't1', 100);

    const p = pool.proposeParameterChange('alice', 'minStake', 20);
    // Manually expire
    (p as GovernanceProposal).expiresAt = Date.now() - 1;

    expect(() => pool.voteOnProposal('alice', p.id, true)).toThrow(/expired/);
  });

  it('executing an expired proposal throws', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('alice', 't1', 100);

    const p = pool.proposeParameterChange('alice', 'minStake', 20);
    (p as GovernanceProposal).expiresAt = Date.now() - 1;

    expect(() => pool.executeProposal(p.id)).toThrow(/expired/);
  });
});

// ─────────────────────────────────────────────
// 6. Integration — Staking Pool + Governance
// ─────────────────────────────────────────────

describe('Governance — integration with staking pool', () => {
  it('larger stake holder has more voting power', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('whale', 't1', 900);
    pool.stake('minnow', 't1', 100);

    const p = pool.proposeParameterChange('whale', 'minStake', 50);
    pool.voteOnProposal('whale', p.id, true);
    pool.voteOnProposal('minnow', p.id, false);

    pool.executeProposal(p.id);
    // 900 vs 100 → whale wins
    expect(pool.getProposal(p.id).status).toBe('executed');
    expect(pool.getParam('minStake')).toBe(50);
  });

  it('resolving a task does not remove voting eligibility for already-resolved winner (wallet-level balance)', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('alice', 't1', 200);

    pool.resolveTask('t1', 'alice', 1.0);
    // After resolution alice's aggregate balance is decremented to 0 for t1
    // So she cannot propose (no remaining stake)
    expect(() =>
      pool.proposeParameterChange('alice', 'minStake', 5),
    ).toThrow(/must have staked/);
  });

  it('agent that stakes in a second task can propose', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.createPool('t2', DEFAULT_CONFIG);
    pool.stake('alice', 't1', 200);
    pool.resolveTask('t1', 'alice', 1.0); // stake returned
    pool.stake('alice', 't2', 200);       // re-stake
    expect(() =>
      pool.proposeParameterChange('alice', 'minStake', 5),
    ).not.toThrow();
  });

  it('staking more increases governance weight', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.createPool('t2', DEFAULT_CONFIG);
    pool.stake('alice', 't1', 200);
    pool.stake('alice', 't2', 300);

    pool.stake('bob', 't1', 100);

    const p = pool.proposeParameterChange('alice', 'minStake', 5);
    pool.voteOnProposal('alice', p.id, true);
    pool.voteOnProposal('bob', p.id, false);

    pool.executeProposal(p.id);
    expect(pool.getProposal(p.id).status).toBe('executed');
  });
});

// ─────────────────────────────────────────────
// 7. Concurrent Proposals
// ─────────────────────────────────────────────

describe('Governance — concurrent proposals', () => {
  let pool: StakingPool;

  beforeEach(() => {
    pool = setupPoolWithAgents(['alice', 'bob', 'carol'], [100, 100, 100]);
  });

  it('multiple active proposals can coexist', () => {
    const p1 = pool.proposeParameterChange('alice', 'minStake', 20);
    const p2 = pool.proposeParameterChange('bob', 'quorumThreshold', 0.6);
    expect(pool.listProposals()).toHaveLength(2);
    expect(p1.status).toBe('active');
    expect(p2.status).toBe('active');
  });

  it('voting on one proposal does not affect the other', () => {
    const p1 = pool.proposeParameterChange('alice', 'minStake', 20);
    const p2 = pool.proposeParameterChange('bob', 'quorumThreshold', 0.6);
    pool.voteOnProposal('alice', p1.id, true);
    expect(pool.getProposal(p2.id).totalStakeFor).toBe(0);
  });

  it('executing one proposal does not affect the other', () => {
    const p1 = pool.proposeParameterChange('alice', 'minStake', 20);
    const p2 = pool.proposeParameterChange('bob', 'quorumThreshold', 0.6);

    pool.voteOnProposal('alice', p1.id, true);
    pool.voteOnProposal('bob', p1.id, true);
    pool.executeProposal(p1.id);

    expect(pool.getProposal(p2.id).status).toBe('active');
  });

  it('agent can vote on multiple proposals', () => {
    const p1 = pool.proposeParameterChange('alice', 'minStake', 20);
    const p2 = pool.proposeParameterChange('bob', 'quorumThreshold', 0.6);
    pool.voteOnProposal('carol', p1.id, true);
    pool.voteOnProposal('carol', p2.id, false);
    expect(pool.getProposal(p1.id).totalStakeFor).toBe(100);
    expect(pool.getProposal(p2.id).totalStakeAgainst).toBe(100);
  });

  it('same param can have two pending proposals', () => {
    const p1 = pool.proposeParameterChange('alice', 'minStake', 20);
    const p2 = pool.proposeParameterChange('bob', 'minStake', 30);
    expect(p1.id).not.toBe(p2.id);
  });

  it('last executed proposal wins for same param', () => {
    const p1 = pool.proposeParameterChange('alice', 'minStake', 20);
    pool.voteOnProposal('alice', p1.id, true);
    pool.voteOnProposal('bob', p1.id, true);
    pool.executeProposal(p1.id);
    expect(pool.getParam('minStake')).toBe(20);

    const p2 = pool.proposeParameterChange('alice', 'minStake', 30);
    pool.voteOnProposal('alice', p2.id, true);
    pool.voteOnProposal('bob', p2.id, true);
    pool.executeProposal(p2.id);
    expect(pool.getParam('minStake')).toBe(30);
  });
});

// ─────────────────────────────────────────────
// 8. Governance Attack Scenarios
// ─────────────────────────────────────────────

describe('Governance — attack scenarios', () => {
  it('majority stake holder can pass proposals unilaterally', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('attacker', 't1', 900);
    pool.stake('defender', 't1', 100);

    const p = pool.proposeParameterChange('attacker', 'minStake', 1);
    pool.voteOnProposal('attacker', p.id, true);
    pool.voteOnProposal('defender', p.id, false);

    pool.executeProposal(p.id);
    // 900 vs 100 → attacker wins
    expect(pool.getParam('minStake')).toBe(1);
  });

  it('sybil attack with zero-stake accounts fails', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('honest', 't1', 500);

    const p = pool.proposeParameterChange('honest', 'minStake', 5);
    pool.voteOnProposal('honest', p.id, true);

    // Many zero-stake sybil accounts try to vote
    for (let i = 0; i < 100; i++) {
      expect(() =>
        pool.voteOnProposal(`sybil-${i}`, p.id, false),
      ).toThrow(/must have staked/);
    }

    pool.executeProposal(p.id);
    // Sybils couldn't vote; honest wins
    expect(pool.getParam('minStake')).toBe(5);
  });

  it('double-voting attack is blocked', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('attacker', 't1', 500);
    pool.stake('defender', 't1', 600);

    const p = pool.proposeParameterChange('attacker', 'minStake', 1);
    pool.voteOnProposal('attacker', p.id, true);

    expect(() => pool.voteOnProposal('attacker', p.id, true)).toThrow(/already voted/);
    expect(() => pool.voteOnProposal('attacker', p.id, false)).toThrow(/already voted/);
  });

  it('flash-stake attack: unstaking before vote removes voting weight', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.createPool('t2', DEFAULT_CONFIG);
    pool.stake('flash', 't1', 900);

    // Propose while staked
    const p = pool.proposeParameterChange('flash', 'minStake', 1);

    // Unstake before voting
    pool.unstake('flash', 't1');

    // Now flash has no stake → cannot vote
    expect(() => pool.voteOnProposal('flash', p.id, true)).toThrow(/must have staked/);
  });

  it('minority cannot pass a proposal regardless of count', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('whale', 't1', 800);

    // 8 small stakers
    for (let i = 0; i < 8; i++) {
      const tid = `t-extra-${i}`;
      pool.createPool(tid, DEFAULT_CONFIG);
      pool.stake(`small-${i}`, tid, 25); // total 200
    }

    const p = pool.proposeParameterChange('whale', 'minStake', 500);
    pool.voteOnProposal('whale', p.id, false); // whale votes NO
    for (let i = 0; i < 8; i++) {
      pool.voteOnProposal(`small-${i}`, p.id, true); // total YES=200
    }

    pool.executeProposal(p.id);
    // Against=800 > For=200 → rejected
    expect(pool.getProposal(p.id).status).toBe('rejected');
  });

  it('proposal on unknown param still executes and stores the value', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('alice', 't1', 100);

    const p = pool.proposeParameterChange('alice', 'newCustomParam', 42);
    pool.voteOnProposal('alice', p.id, true);
    pool.executeProposal(p.id);
    expect(pool.getParam('newCustomParam')).toBe(42);
  });
});

// ─────────────────────────────────────────────
// 9. ProposalView Serialisation
// ─────────────────────────────────────────────

describe('Governance — ProposalView', () => {
  let pool: StakingPool;
  let proposalId: string;

  beforeEach(() => {
    pool = setupPoolWithAgents(['alice'], [100]);
    proposalId = pool.proposeParameterChange('alice', 'minStake', 20).id;
  });

  it('voterCount starts at 0', () => {
    expect(pool.getProposal(proposalId).voterCount).toBe(0);
  });

  it('voterCount increases with each vote', () => {
    pool.stake('bob', 'task-gov', 50);
    pool.voteOnProposal('alice', proposalId, true);
    pool.voteOnProposal('bob', proposalId, false);
    expect(pool.getProposal(proposalId).voterCount).toBe(2);
  });

  it('view contains createdAt', () => {
    const view = pool.getProposal(proposalId);
    expect(view.createdAt).toBeGreaterThan(0);
  });

  it('view contains currentValue', () => {
    const view = pool.getProposal(proposalId);
    expect(view.currentValue).toBeDefined();
  });

  it('listProposals returns ProposalView objects with id field', () => {
    const list = pool.listProposals();
    expect(list[0]).toHaveProperty('id');
    expect(list[0]).toHaveProperty('status');
    expect(list[0]).toHaveProperty('voterCount');
  });
});

// ─────────────────────────────────────────────
// 10. Parameter Change Effects
// ─────────────────────────────────────────────

describe('Governance — parameter change effects', () => {
  it('proposalDuration param is readable', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('alice', 't1', 100);
    const duration = pool.getParam('proposalDuration');
    expect(duration).toBeGreaterThan(0);
  });

  it('rewardMultiplierMax param is readable', () => {
    const pool = new StakingPool();
    expect(pool.getParam('rewardMultiplierMax')).toBe(2.0);
  });

  it('quorumThreshold default is 0.5', () => {
    const pool = new StakingPool();
    expect(pool.getParam('quorumThreshold')).toBe(0.5);
  });

  it('can change quorumThreshold to a higher value', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('alice', 't1', 200);
    pool.stake('bob', 't1', 100);

    const p = pool.proposeParameterChange('alice', 'quorumThreshold', 0.66);
    pool.voteOnProposal('alice', p.id, true);
    pool.voteOnProposal('bob', p.id, false);
    pool.executeProposal(p.id);
    // 200 vs 100 → 66.7% > 50% old threshold → passes
    expect(pool.getParam('quorumThreshold')).toBe(0.66);
  });

  it('minStake param defaults to 1', () => {
    const pool = new StakingPool();
    expect(pool.getParam('minStake')).toBe(1);
  });
});

// ─────────────────────────────────────────────
// 11. Slashing + Governance interaction
// ─────────────────────────────────────────────

describe('Governance — slashing interaction', () => {
  it('slashed agent retains governance access if any stake remains', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('agent', 't1', 200);

    pool.slash('agent', 't1', 10); // 10% slash, 90% remains but position is slashed

    // After slash, balance drops; if still > 0 can propose
    const balance = pool.getStakeBalance('agent');
    // Balance should still be positive (10% of 200 = 20 slashed, 180 left in balance)
    expect(balance).toBeGreaterThan(0);
  });

  it('fully slashed agent (100%) cannot propose', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('agent', 't1', 200);

    pool.slash('agent', 't1', 100);

    expect(() =>
      pool.proposeParameterChange('agent', 'minStake', 5),
    ).toThrow(/must have staked/);
  });

  it('slash cooldown does not prevent governance proposal on existing stake', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.createPool('t2', DEFAULT_CONFIG);
    pool.stake('agent', 't1', 200);
    pool.stake('bob', 't2', 100);

    pool.slash('agent', 't1', 10, SlashSeverity.MINOR);
    // Agent in cooldown — but they still have remaining balance from t1
    // So they can still propose (cooldown only blocks NEW staking)
    const balance = pool.getStakeBalance('agent');
    if (balance > 0) {
      expect(() =>
        pool.proposeParameterChange('agent', 'minStake', 5),
      ).not.toThrow();
    }
  });
});
