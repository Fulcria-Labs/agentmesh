/**
 * Tests for AgentStaking — pool lifecycle, staking mechanics,
 * reward distribution, slashing, and token economics.
 */

import {
  StakingPool,
  calculateReward,
  calculateSlashAmount,
  getEconomicMetrics,
  estimateAPY,
  SlashSeverity,
  SLASH_RATES,
  SLASH_COOLDOWNS,
  StakingConfig,
  StakingPoolState,
  HederaTokenConfig,
  PoolStatus,
} from '../core/agent-staking';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const DEFAULT_CONFIG: StakingConfig = {
  minStake: 10,
  maxStake: 1000,
  baseReward: 100,
};

function makePool(overrides?: Partial<StakingConfig>): StakingPool {
  return new StakingPool();
}

function stakeAgent(
  pool: StakingPool,
  taskId: string,
  agentId: string,
  amount = 50,
): void {
  pool.stake(agentId, taskId, amount);
}

// ─────────────────────────────────────────────
// 1. Pool Creation
// ─────────────────────────────────────────────

describe('StakingPool — pool creation', () => {
  let pool: StakingPool;
  beforeEach(() => { pool = new StakingPool(); });

  it('creates a pool with correct taskId', () => {
    pool.createPool('task-1', DEFAULT_CONFIG);
    const status = pool.getPoolStatus('task-1');
    expect(status.taskId).toBe('task-1');
  });

  it('creates a pool with status "open"', () => {
    pool.createPool('task-1', DEFAULT_CONFIG);
    expect(pool.getPoolStatus('task-1').status).toBe('open');
  });

  it('stores the supplied config', () => {
    pool.createPool('task-1', DEFAULT_CONFIG);
    const status = pool.getPoolStatus('task-1');
    expect(status.config.minStake).toBe(10);
    expect(status.config.maxStake).toBe(1000);
    expect(status.config.baseReward).toBe(100);
  });

  it('initialises totalStaked to 0', () => {
    pool.createPool('task-1', DEFAULT_CONFIG);
    expect(pool.getPoolStatus('task-1').totalStaked).toBe(0);
  });

  it('initialises participantCount to 0', () => {
    pool.createPool('task-1', DEFAULT_CONFIG);
    expect(pool.getPoolStatus('task-1').participantCount).toBe(0);
  });

  it('throws when creating a duplicate pool', () => {
    pool.createPool('task-1', DEFAULT_CONFIG);
    expect(() => pool.createPool('task-1', DEFAULT_CONFIG)).toThrow(/already exists/);
  });

  it('throws when minStake is negative', () => {
    expect(() =>
      pool.createPool('task-1', { ...DEFAULT_CONFIG, minStake: -1 }),
    ).toThrow(/minStake/);
  });

  it('throws when maxStake < minStake', () => {
    expect(() =>
      pool.createPool('task-1', { ...DEFAULT_CONFIG, minStake: 100, maxStake: 50 }),
    ).toThrow(/maxStake/);
  });

  it('throws when baseReward is negative', () => {
    expect(() =>
      pool.createPool('task-1', { ...DEFAULT_CONFIG, baseReward: -5 }),
    ).toThrow(/baseReward/);
  });

  it('allows zero minStake', () => {
    expect(() =>
      pool.createPool('task-1', { ...DEFAULT_CONFIG, minStake: 0 }),
    ).not.toThrow();
  });

  it('allows minStake === maxStake', () => {
    expect(() =>
      pool.createPool('task-1', { ...DEFAULT_CONFIG, minStake: 50, maxStake: 50 }),
    ).not.toThrow();
  });

  it('creates multiple independent pools', () => {
    pool.createPool('task-a', DEFAULT_CONFIG);
    pool.createPool('task-b', { ...DEFAULT_CONFIG, baseReward: 200 });
    expect(pool.getPoolStatus('task-a').config.baseReward).toBe(100);
    expect(pool.getPoolStatus('task-b').config.baseReward).toBe(200);
  });

  it('emits pool:created event', () => {
    const events: unknown[] = [];
    pool.on('pool:created', e => events.push(e));
    pool.createPool('task-1', DEFAULT_CONFIG);
    expect(events).toHaveLength(1);
  });

  it('accepts optional HederaTokenConfig in constructor', () => {
    const htsConfig: HederaTokenConfig = {
      tokenId: '0.0.12345',
      treasuryAccountId: '0.0.1',
      decimals: 8,
      symbol: 'AMSH',
      initialSupply: 1_000_000,
    };
    const p = new StakingPool(htsConfig);
    expect(() => p.createPool('task-1', DEFAULT_CONFIG)).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// 2. Staking Lifecycle
// ─────────────────────────────────────────────

describe('StakingPool — staking', () => {
  let pool: StakingPool;
  const taskId = 'task-1';

  beforeEach(() => {
    pool = new StakingPool();
    pool.createPool(taskId, DEFAULT_CONFIG);
  });

  it('allows an agent to stake', () => {
    const pos = pool.stake('agent-1', taskId, 50);
    expect(pos.agentId).toBe('agent-1');
    expect(pos.amount).toBe(50);
    expect(pos.status).toBe('active');
  });

  it('increases totalStaked on the pool', () => {
    pool.stake('agent-1', taskId, 50);
    expect(pool.getPoolStatus(taskId).totalStaked).toBe(50);
  });

  it('increases participantCount on the pool', () => {
    pool.stake('agent-1', taskId, 50);
    expect(pool.getPoolStatus(taskId).participantCount).toBe(1);
  });

  it('updates agent balance', () => {
    pool.stake('agent-1', taskId, 50);
    expect(pool.getStakeBalance('agent-1')).toBe(50);
  });

  it('allows multiple agents to stake', () => {
    pool.stake('agent-1', taskId, 50);
    pool.stake('agent-2', taskId, 100);
    expect(pool.getPoolStatus(taskId).totalStaked).toBe(150);
    expect(pool.getPoolStatus(taskId).participantCount).toBe(2);
  });

  it('throws when amount is zero', () => {
    expect(() => pool.stake('agent-1', taskId, 0)).toThrow(/positive/);
  });

  it('throws when amount is negative', () => {
    expect(() => pool.stake('agent-1', taskId, -10)).toThrow(/positive/);
  });

  it('throws when amount is below minStake', () => {
    expect(() => pool.stake('agent-1', taskId, 5)).toThrow(/minimum/);
  });

  it('throws when amount exceeds maxStake', () => {
    expect(() => pool.stake('agent-1', taskId, 2000)).toThrow(/maximum/);
  });

  it('throws on double stake from same agent', () => {
    pool.stake('agent-1', taskId, 50);
    expect(() => pool.stake('agent-1', taskId, 50)).toThrow(/already has a stake/);
  });

  it('throws on staking into non-existent pool', () => {
    expect(() => pool.stake('agent-1', 'no-such-task', 50)).toThrow(/No staking pool/);
  });

  it('throws when staking into a locked pool', () => {
    pool.resolveTask(taskId, 'agent-1', 1.0); // closes pool
    const pool2 = new StakingPool();
    pool2.createPool('t2', DEFAULT_CONFIG);
    pool2.stake('a1', 't2', 50);
    pool2.resolveTask('t2', 'a1', 1.0);
    // Try to stake into an already-resolved pool
    expect(() => pool2.stake('a2', 't2', 50)).toThrow(/not open/);
  });

  it('emits stake:added event', () => {
    const events: unknown[] = [];
    pool.on('stake:added', e => events.push(e));
    pool.stake('agent-1', taskId, 50);
    expect(events).toHaveLength(1);
  });

  it('records a stake transaction', () => {
    pool.stake('agent-1', taskId, 50);
    const txs = pool.getTransactions();
    expect(txs.some(t => t.type === 'stake' && t.agentId === 'agent-1')).toBe(true);
  });
});

// ─────────────────────────────────────────────
// 3. Unstaking
// ─────────────────────────────────────────────

describe('StakingPool — unstaking', () => {
  let pool: StakingPool;
  const taskId = 'task-1';

  beforeEach(() => {
    pool = new StakingPool();
    pool.createPool(taskId, DEFAULT_CONFIG);
    pool.stake('agent-1', taskId, 50);
  });

  it('sets position status to unstaked', () => {
    const pos = pool.unstake('agent-1', taskId);
    expect(pos.status).toBe('unstaked');
  });

  it('reduces totalStaked on the pool', () => {
    pool.unstake('agent-1', taskId);
    expect(pool.getPoolStatus(taskId).totalStaked).toBe(0);
  });

  it('reduces agent balance', () => {
    pool.unstake('agent-1', taskId);
    expect(pool.getStakeBalance('agent-1')).toBe(0);
  });

  it('throws when agent has no stake', () => {
    expect(() => pool.unstake('agent-99', taskId)).toThrow(/no stake/);
  });

  it('throws when task does not exist', () => {
    expect(() => pool.unstake('agent-1', 'fake-task')).toThrow(/No staking pool/);
  });

  it('throws when position is already unstaked', () => {
    pool.unstake('agent-1', taskId);
    expect(() => pool.unstake('agent-1', taskId)).toThrow(/status is unstaked/);
  });

  it('emits stake:removed event', () => {
    const events: unknown[] = [];
    pool.on('stake:removed', e => events.push(e));
    pool.unstake('agent-1', taskId);
    expect(events).toHaveLength(1);
  });

  it('records an unstake transaction', () => {
    pool.unstake('agent-1', taskId);
    const txs = pool.getTransactions();
    expect(txs.some(t => t.type === 'unstake' && t.agentId === 'agent-1')).toBe(true);
  });

  it('prevents unstake from resolved pool by default', () => {
    const p = new StakingPool();
    p.createPool('t2', DEFAULT_CONFIG);
    p.stake('a1', 't2', 50);
    p.stake('a2', 't2', 50);
    p.resolveTask('t2', 'a1', 0.9);
    // a2 was returned via resolveTask; trying to unstake again should fail
    expect(() => p.unstake('a2', 't2')).toThrow(/status is unstaked/);
  });

  it('partial unstake restores balance correctly for two stakers', () => {
    pool.stake('agent-2', taskId, 100);
    pool.unstake('agent-1', taskId);
    expect(pool.getStakeBalance('agent-1')).toBe(0);
    expect(pool.getStakeBalance('agent-2')).toBe(100);
    expect(pool.getPoolStatus(taskId).totalStaked).toBe(100);
  });
});

// ─────────────────────────────────────────────
// 4. Reward Distribution
// ─────────────────────────────────────────────

describe('StakingPool — resolveTask / rewards', () => {
  let pool: StakingPool;
  const taskId = 'task-1';

  beforeEach(() => {
    pool = new StakingPool();
    pool.createPool(taskId, DEFAULT_CONFIG);
    pool.stake('winner', taskId, 100);
    pool.stake('loser', taskId, 80);
  });

  it('sets pool status to resolved', () => {
    pool.resolveTask(taskId, 'winner', 0.9);
    expect(pool.getPoolStatus(taskId).status).toBe('resolved');
  });

  it('sets winnerId and winnerQuality', () => {
    pool.resolveTask(taskId, 'winner', 0.8);
    const status = pool.getPoolStatus(taskId);
    expect(status.winnerId).toBe('winner');
    expect(status.winnerQuality).toBeCloseTo(0.8);
  });

  it('awards a positive reward to the winner', () => {
    pool.resolveTask(taskId, 'winner', 0.9);
    const poolState = pool.getPool(taskId)!;
    const pos = poolState.positions.get('winner')!;
    expect(pos.rewardAmount).toBeGreaterThan(0);
    expect(pos.status).toBe('rewarded');
  });

  it('returns stake to non-winners (status becomes unstaked)', () => {
    pool.resolveTask(taskId, 'winner', 0.9);
    const poolState = pool.getPool(taskId)!;
    const loser = poolState.positions.get('loser')!;
    expect(loser.status).toBe('unstaked');
  });

  it('emits pool:resolved event', () => {
    const events: unknown[] = [];
    pool.on('pool:resolved', e => events.push(e));
    pool.resolveTask(taskId, 'winner', 1.0);
    expect(events).toHaveLength(1);
  });

  it('emits reward:distributed event', () => {
    const events: unknown[] = [];
    pool.on('reward:distributed', e => events.push(e));
    pool.resolveTask(taskId, 'winner', 1.0);
    expect(events).toHaveLength(1);
  });

  it('throws when resolving an already resolved pool', () => {
    pool.resolveTask(taskId, 'winner', 0.9);
    expect(() => pool.resolveTask(taskId, 'winner', 0.9)).toThrow(/already/);
  });

  it('clamps quality above 1 to 1', () => {
    pool.resolveTask(taskId, 'winner', 1.5);
    const poolState = pool.getPool(taskId)!;
    expect(poolState.winnerQuality).toBe(1);
  });

  it('clamps quality below 0 to 0', () => {
    pool.resolveTask(taskId, 'winner', -0.5);
    const poolState = pool.getPool(taskId)!;
    expect(poolState.winnerQuality).toBe(0);
  });

  it('higher quality produces higher reward', () => {
    const pool1 = new StakingPool();
    pool1.createPool('t1', DEFAULT_CONFIG);
    pool1.stake('w', 't1', 50);
    pool1.resolveTask('t1', 'w', 0.5);
    const reward1 = pool1.getPool('t1')!.positions.get('w')!.rewardAmount!;

    const pool2 = new StakingPool();
    pool2.createPool('t2', DEFAULT_CONFIG);
    pool2.stake('w', 't2', 50);
    pool2.resolveTask('t2', 'w', 1.0);
    const reward2 = pool2.getPool('t2')!.positions.get('w')!.rewardAmount!;

    expect(reward2).toBeGreaterThan(reward1);
  });

  it('records a reward transaction', () => {
    pool.resolveTask(taskId, 'winner', 0.9);
    const txs = pool.getTransactions();
    expect(txs.some(t => t.type === 'reward' && t.agentId === 'winner')).toBe(true);
  });
});

// ─────────────────────────────────────────────
// 5. Slashing
// ─────────────────────────────────────────────

describe('StakingPool — slashing', () => {
  let pool: StakingPool;
  const taskId = 'task-1';

  beforeEach(() => {
    pool = new StakingPool();
    pool.createPool(taskId, DEFAULT_CONFIG);
    pool.stake('agent-1', taskId, 100);
  });

  it('reduces pool totalStaked by slash amount', () => {
    pool.slash('agent-1', taskId, 25);
    expect(pool.getPoolStatus(taskId).totalStaked).toBe(75);
  });

  it('reduces agent balance by slash amount', () => {
    pool.slash('agent-1', taskId, 25);
    expect(pool.getStakeBalance('agent-1')).toBe(75);
  });

  it('sets position status to slashed', () => {
    pool.slash('agent-1', taskId, 25);
    const pos = pool.getPool(taskId)!.positions.get('agent-1')!;
    expect(pos.status).toBe('slashed');
  });

  it('records the slash amount on the position', () => {
    pool.slash('agent-1', taskId, 50);
    const pos = pool.getPool(taskId)!.positions.get('agent-1')!;
    expect(pos.slashAmount).toBeCloseTo(50);
  });

  it('throws when slashing agent with no active stake', () => {
    expect(() => pool.slash('agent-99', taskId, 10)).toThrow(/no active stake/);
  });

  it('throws on slash percentage < 0', () => {
    expect(() => pool.slash('agent-1', taskId, -5)).toThrow(/percentage/);
  });

  it('throws on slash percentage > 100', () => {
    expect(() => pool.slash('agent-1', taskId, 110)).toThrow(/percentage/);
  });

  it('emits stake:slashed event', () => {
    const events: unknown[] = [];
    pool.on('stake:slashed', e => events.push(e));
    pool.slash('agent-1', taskId, 10);
    expect(events).toHaveLength(1);
  });

  it('records a slash transaction', () => {
    pool.slash('agent-1', taskId, 10);
    const txs = pool.getTransactions();
    expect(txs.some(t => t.type === 'slash' && t.agentId === 'agent-1')).toBe(true);
  });

  it('adds to slash history', () => {
    pool.slash('agent-1', taskId, 10, SlashSeverity.MINOR);
    expect(pool.getSlashHistory('agent-1')).toHaveLength(1);
  });

  it('100% slash leaves zero balance', () => {
    pool.slash('agent-1', taskId, 100);
    expect(pool.getStakeBalance('agent-1')).toBe(0);
  });
});

// ─────────────────────────────────────────────
// 6. Slash Severity & Cooldowns
// ─────────────────────────────────────────────

describe('SlashSeverity and cooldowns', () => {
  it('MINOR rate is 10%', () => {
    expect(SLASH_RATES[SlashSeverity.MINOR]).toBe(0.10);
  });

  it('MODERATE rate is 25%', () => {
    expect(SLASH_RATES[SlashSeverity.MODERATE]).toBe(0.25);
  });

  it('SEVERE rate is 50%', () => {
    expect(SLASH_RATES[SlashSeverity.SEVERE]).toBe(0.50);
  });

  it('CRITICAL rate is 100%', () => {
    expect(SLASH_RATES[SlashSeverity.CRITICAL]).toBe(1.00);
  });

  it('MINOR cooldown is 5 minutes', () => {
    expect(SLASH_COOLDOWNS[SlashSeverity.MINOR]).toBe(5 * 60 * 1000);
  });

  it('CRITICAL cooldown is 7 days', () => {
    expect(SLASH_COOLDOWNS[SlashSeverity.CRITICAL]).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('agent is flagged as in cooldown after slash', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('agent-1', 't1', 50);
    pool.slash('agent-1', 't1', 10, SlashSeverity.SEVERE);
    expect(pool.isInCooldown('agent-1')).toBe(true);
  });

  it('agent NOT in cooldown before any slash', () => {
    const pool = new StakingPool();
    expect(pool.isInCooldown('new-agent')).toBe(false);
  });

  it('prevents staking during cooldown', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('agent-1', 't1', 50);
    pool.slash('agent-1', 't1', 10, SlashSeverity.CRITICAL);

    pool.createPool('t2', DEFAULT_CONFIG);
    expect(() => pool.stake('agent-1', 't2', 50)).toThrow(/cooldown/);
  });

  it('slash record captures cooldownEndsAt', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('agent-1', 't1', 50);
    const before = Date.now();
    pool.slash('agent-1', 't1', 10, SlashSeverity.MODERATE);
    const record = pool.getSlashHistory('agent-1')[0]!;
    expect(record.cooldownEndsAt).toBeGreaterThan(before);
    expect(record.severity).toBe(SlashSeverity.MODERATE);
  });
});

// ─────────────────────────────────────────────
// 7. calculateReward
// ─────────────────────────────────────────────

describe('calculateReward', () => {
  it('returns zero reward for zero base', () => {
    expect(calculateReward(0, 1.0, 1.0)).toBe(0);
  });

  it('throws on negative base reward', () => {
    expect(() => calculateReward(-10, 1.0, 1.0)).toThrow(/non-negative/);
  });

  it('quality=0 gives 0.5× quality multiplier', () => {
    const r = calculateReward(100, 0, 0);
    // qualityMul=0.5, repMul=1.0 → 50
    expect(r).toBeCloseTo(50);
  });

  it('quality=1 gives 2.0× quality multiplier', () => {
    const r = calculateReward(100, 1, 0);
    // qualityMul=2.0, repMul=1.0 → 200
    expect(r).toBeCloseTo(200);
  });

  it('reputation=0 gives 1.0× rep multiplier', () => {
    const r = calculateReward(100, 0.5, 0);
    // qualityMul=1.25, repMul=1.0 → 125
    expect(r).toBeCloseTo(125);
  });

  it('reputation=1 gives 1.5× rep multiplier', () => {
    const r = calculateReward(100, 0.5, 1);
    // qualityMul=1.25, repMul=1.5 → 187.5
    expect(r).toBeCloseTo(187.5);
  });

  it('clamps quality above 1', () => {
    expect(calculateReward(100, 2.0, 0.5)).toBe(calculateReward(100, 1.0, 0.5));
  });

  it('clamps quality below 0', () => {
    expect(calculateReward(100, -1.0, 0.5)).toBe(calculateReward(100, 0, 0.5));
  });

  it('clamps reputation above 1', () => {
    expect(calculateReward(100, 0.5, 2.0)).toBe(calculateReward(100, 0.5, 1.0));
  });

  it('higher quality always yields higher reward', () => {
    expect(calculateReward(100, 0.8, 0.5)).toBeGreaterThan(calculateReward(100, 0.4, 0.5));
  });

  it('higher reputation always yields higher reward', () => {
    expect(calculateReward(100, 0.5, 0.8)).toBeGreaterThan(calculateReward(100, 0.5, 0.2));
  });
});

// ─────────────────────────────────────────────
// 8. calculateSlashAmount
// ─────────────────────────────────────────────

describe('calculateSlashAmount', () => {
  it('MINOR severity slashes 10%', () => {
    expect(calculateSlashAmount(100, SlashSeverity.MINOR)).toBeCloseTo(10);
  });

  it('MODERATE severity slashes 25%', () => {
    expect(calculateSlashAmount(100, SlashSeverity.MODERATE)).toBeCloseTo(25);
  });

  it('SEVERE severity slashes 50%', () => {
    expect(calculateSlashAmount(100, SlashSeverity.SEVERE)).toBeCloseTo(50);
  });

  it('CRITICAL severity slashes 100%', () => {
    expect(calculateSlashAmount(100, SlashSeverity.CRITICAL)).toBeCloseTo(100);
  });

  it('percentage override works', () => {
    expect(calculateSlashAmount(200, SlashSeverity.MINOR, 30)).toBeCloseTo(60);
  });

  it('percentage=0 gives 0 slash', () => {
    expect(calculateSlashAmount(100, SlashSeverity.CRITICAL, 0)).toBe(0);
  });

  it('percentage=100 gives full slash', () => {
    expect(calculateSlashAmount(100, SlashSeverity.MINOR, 100)).toBeCloseTo(100);
  });

  it('throws on negative stakeAmount', () => {
    expect(() => calculateSlashAmount(-10, SlashSeverity.MINOR)).toThrow(/non-negative/);
  });

  it('throws on percentage < 0', () => {
    expect(() => calculateSlashAmount(100, SlashSeverity.MINOR, -5)).toThrow(/percentage/);
  });

  it('throws on percentage > 100', () => {
    expect(() => calculateSlashAmount(100, SlashSeverity.MINOR, 105)).toThrow(/percentage/);
  });
});

// ─────────────────────────────────────────────
// 9. getEconomicMetrics
// ─────────────────────────────────────────────

describe('getEconomicMetrics', () => {
  it('returns zeroes for empty pool list', () => {
    const m = getEconomicMetrics([]);
    expect(m.totalPools).toBe(0);
    expect(m.totalStaked).toBe(0);
    expect(m.avgQuality).toBe(0);
  });

  it('counts total pools', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.createPool('t2', DEFAULT_CONFIG);
    const m = getEconomicMetrics(pool.getAllPools());
    expect(m.totalPools).toBe(2);
  });

  it('aggregates totalStaked across pools', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.createPool('t2', DEFAULT_CONFIG);
    pool.stake('a1', 't1', 100);
    pool.stake('a2', 't2', 200);
    const m = getEconomicMetrics(pool.getAllPools());
    expect(m.totalStaked).toBe(300);
  });

  it('aggregates totalRewarded from resolved pools', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('a1', 't1', 100);
    pool.resolveTask('t1', 'a1', 1.0);
    const m = getEconomicMetrics(pool.getAllPools());
    expect(m.totalRewarded).toBeGreaterThan(0);
  });

  it('aggregates totalSlashed', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('a1', 't1', 100);
    pool.slash('a1', 't1', 25);
    const m = getEconomicMetrics(pool.getAllPools());
    expect(m.totalSlashed).toBeCloseTo(25);
  });

  it('calculates avgQuality over resolved pools', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.createPool('t2', DEFAULT_CONFIG);
    pool.stake('a1', 't1', 50);
    pool.stake('a2', 't2', 50);
    pool.resolveTask('t1', 'a1', 0.8);
    pool.resolveTask('t2', 'a2', 0.4);
    const m = getEconomicMetrics(pool.getAllPools());
    expect(m.avgQuality).toBeCloseTo(0.6);
  });

  it('counts active pools separately from resolved', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.createPool('t2', DEFAULT_CONFIG);
    pool.stake('a1', 't1', 50);
    pool.resolveTask('t1', 'a1', 0.9);
    const m = getEconomicMetrics(pool.getAllPools());
    expect(m.resolvedPoolCount).toBe(1);
    expect(m.activePoolCount).toBe(1);
  });
});

// ─────────────────────────────────────────────
// 10. estimateAPY
// ─────────────────────────────────────────────

describe('estimateAPY', () => {
  it('returns 0 for zero staked amount', () => {
    expect(estimateAPY(0, 1, 0.8)).toBe(0);
  });

  it('returns positive APY for normal inputs', () => {
    expect(estimateAPY(1000, 1, 0.8)).toBeGreaterThan(0);
  });

  it('higher task completion rate increases APY', () => {
    const apy1 = estimateAPY(1000, 1, 0.8);
    const apy2 = estimateAPY(1000, 5, 0.8);
    expect(apy2).toBeGreaterThan(apy1);
  });

  it('higher quality increases APY', () => {
    expect(estimateAPY(1000, 1, 1.0)).toBeGreaterThan(estimateAPY(1000, 1, 0.0));
  });

  it('negative staked amount returns 0', () => {
    expect(estimateAPY(-100, 1, 0.8)).toBe(0);
  });
});

// ─────────────────────────────────────────────
// 11. Edge Cases & Balance Tracking
// ─────────────────────────────────────────────

describe('StakingPool — edge cases and balance tracking', () => {
  it('balance starts at 0 for unknown agent', () => {
    const pool = new StakingPool();
    expect(pool.getStakeBalance('nobody')).toBe(0);
  });

  it('aggregate balance across multiple tasks', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.createPool('t2', DEFAULT_CONFIG);
    pool.stake('agent-1', 't1', 100);
    pool.stake('agent-1', 't2', 200);
    expect(pool.getStakeBalance('agent-1')).toBe(300);
  });

  it('getAllPools returns all created pools', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.createPool('t2', DEFAULT_CONFIG);
    pool.createPool('t3', DEFAULT_CONFIG);
    expect(pool.getAllPools()).toHaveLength(3);
  });

  it('getPool returns undefined for unknown task', () => {
    const pool = new StakingPool();
    expect(pool.getPool('unknown')).toBeUndefined();
  });

  it('getPoolStatus throws for unknown task', () => {
    const pool = new StakingPool();
    expect(() => pool.getPoolStatus('unknown')).toThrow(/No staking pool/);
  });

  it('stake transaction has correct from/to fields', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('agent-1', 't1', 50);
    const tx = pool.getTransactions().find(t => t.type === 'stake')!;
    expect(tx.transfer.from).toBe('agent-1');
    expect(tx.transfer.to).toBe('treasury');
    expect(tx.transfer.amount).toBe(50);
  });

  it('reward transaction has correct from/to fields', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    pool.stake('a1', 't1', 50);
    pool.resolveTask('t1', 'a1', 1.0);
    const tx = pool.getTransactions().find(t => t.type === 'reward')!;
    expect(tx.transfer.from).toBe('treasury');
    expect(tx.transfer.to).toBe('a1');
  });

  it('resolveTask with no participants does not throw', () => {
    const pool = new StakingPool();
    pool.createPool('t1', DEFAULT_CONFIG);
    expect(() => pool.resolveTask('t1', 'nobody', 0.9)).not.toThrow();
  });

  it('slash history is empty for fresh agent', () => {
    const pool = new StakingPool();
    expect(pool.getSlashHistory('fresh')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// 12. Minimum Stake Enforcement
// ─────────────────────────────────────────────

describe('StakingPool — minimum stake enforcement', () => {
  it('global minStake param is respected via pool config', () => {
    const pool = new StakingPool();
    pool.createPool('t1', { ...DEFAULT_CONFIG, minStake: 500 });
    expect(() => pool.stake('a1', 't1', 100)).toThrow(/minimum/);
  });

  it('exact minStake is accepted', () => {
    const pool = new StakingPool();
    pool.createPool('t1', { ...DEFAULT_CONFIG, minStake: 10 });
    expect(() => pool.stake('a1', 't1', 10)).not.toThrow();
  });

  it('one below minStake is rejected', () => {
    const pool = new StakingPool();
    pool.createPool('t1', { ...DEFAULT_CONFIG, minStake: 10 });
    expect(() => pool.stake('a1', 't1', 9)).toThrow(/minimum/);
  });
});
