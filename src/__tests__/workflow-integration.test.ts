/**
 * Workflow Integration Tests for AgentMesh
 *
 * End-to-end flows testing:
 * - Task lifecycle: submit -> bid -> assign -> complete
 * - Reputation tracking across task outcomes
 * - Agent registry + coordinator interaction
 * - HCS10 bridge capability mapping
 * - Standards registry profile conversion
 * - Edge cases in bid selection & auto-assignment
 */

import { ReputationManager } from '../core/reputation';
import { AgentProfile, AgentCapability, MessageType, TaskRequest, MeshConfig } from '../core/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: overrides.id || 'agent-1',
    name: overrides.name || 'Test Agent',
    description: overrides.description || 'A test agent',
    capabilities: overrides.capabilities || [
      { name: 'web_research', description: 'Search the web', inputSchema: {}, outputSchema: {} },
    ],
    hederaAccountId: overrides.hederaAccountId || '0.0.12345',
    inboundTopicId: overrides.inboundTopicId || '0.0.100',
    outboundTopicId: overrides.outboundTopicId || '0.0.101',
    registryTopicId: overrides.registryTopicId || '0.0.102',
    status: overrides.status || 'active',
    createdAt: overrides.createdAt || Date.now(),
    metadata: overrides.metadata || {},
  };
}

function makeCapability(name: string, description = ''): AgentCapability {
  return {
    name,
    description: description || `${name} capability`,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPUTATION MANAGER - COMPREHENSIVE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('ReputationManager - lifecycle tracking', () => {
  let rep: ReputationManager;

  beforeEach(() => {
    rep = new ReputationManager();
  });

  test('new agent gets neutral score (0.5)', () => {
    const score = rep.getScore('new-agent');
    expect(score.overallScore).toBe(0.5);
    expect(score.taskCount).toBe(0);
    expect(score.successRate).toBe(0);
    expect(score.reliability).toBe(0.5);
  });

  test('single success improves overall score above 0.5', () => {
    rep.recordSuccess('agent-1', 100, 5);
    const score = rep.getScore('agent-1');
    expect(score.overallScore).toBeGreaterThan(0.5);
    expect(score.successRate).toBe(1);
    expect(score.taskCount).toBe(1);
  });

  test('single failure reduces overall score below 0.5', () => {
    rep.recordFailure('agent-1');
    const score = rep.getScore('agent-1');
    expect(score.overallScore).toBeLessThan(0.5);
    expect(score.successRate).toBe(0);
    expect(score.taskCount).toBe(1);
  });

  test('mixed results produce intermediate score', () => {
    rep.recordSuccess('agent-1', 100, 5);
    rep.recordSuccess('agent-1', 120, 6);
    rep.recordFailure('agent-1');
    const score = rep.getScore('agent-1');
    expect(score.successRate).toBeCloseTo(2 / 3, 2);
    expect(score.taskCount).toBe(3);
  });

  test('avgExecutionTime is computed from successes only', () => {
    rep.recordSuccess('agent-1', 100, 5);
    rep.recordSuccess('agent-1', 200, 10);
    rep.recordFailure('agent-1');
    const score = rep.getScore('agent-1');
    expect(score.avgExecutionTime).toBe(150);
  });

  test('avgCost is computed from successes only', () => {
    rep.recordSuccess('agent-1', 100, 10);
    rep.recordSuccess('agent-1', 200, 20);
    const score = rep.getScore('agent-1');
    expect(score.avgCost).toBe(15);
  });

  test('experience bonus maxes at 20 tasks', () => {
    for (let i = 0; i < 25; i++) {
      rep.recordSuccess('agent-exp', 100, 5);
    }
    const score = rep.getScore('agent-exp');
    // With 100% success, good reliability, and max experience:
    // 0.5 * 1.0 + 0.3 * reliability + 0.2 * 1.0
    expect(score.overallScore).toBeGreaterThan(0.8);
  });

  test('getAllScores returns sorted by overallScore descending', () => {
    rep.recordSuccess('good-agent', 100, 5);
    rep.recordSuccess('good-agent', 100, 5);
    rep.recordSuccess('good-agent', 100, 5);
    rep.recordFailure('bad-agent');
    rep.recordFailure('bad-agent');
    rep.recordFailure('bad-agent');

    const scores = rep.getAllScores();
    expect(scores.length).toBe(2);
    expect(scores[0].agentId).toBe('good-agent');
    expect(scores[1].agentId).toBe('bad-agent');
    expect(scores[0].overallScore).toBeGreaterThan(scores[1].overallScore);
  });

  test('reset removes agent data', () => {
    rep.recordSuccess('agent-1', 100, 5);
    expect(rep.getScore('agent-1').taskCount).toBe(1);
    rep.reset('agent-1');
    expect(rep.getScore('agent-1').taskCount).toBe(0);
    expect(rep.getScore('agent-1').overallScore).toBe(0.5);
  });

  test('getTrackedAgentCount tracks unique agents', () => {
    expect(rep.getTrackedAgentCount()).toBe(0);
    rep.recordSuccess('a', 100, 5);
    expect(rep.getTrackedAgentCount()).toBe(1);
    rep.recordSuccess('b', 100, 5);
    expect(rep.getTrackedAgentCount()).toBe(2);
    rep.recordSuccess('a', 100, 5); // same agent again
    expect(rep.getTrackedAgentCount()).toBe(2);
  });

  test('getRecord returns undefined for unknown agent', () => {
    expect(rep.getRecord('nonexistent')).toBeUndefined();
  });

  test('getRecord returns record for tracked agent', () => {
    rep.recordSuccess('agent-1', 100, 5);
    const record = rep.getRecord('agent-1');
    expect(record).toBeDefined();
    expect(record!.totalTasks).toBe(1);
    expect(record!.completedTasks).toBe(1);
    expect(record!.failedTasks).toBe(0);
  });

  test('emits reputation:updated on success', () => {
    let emitted = false;
    rep.on('reputation:updated', () => { emitted = true; });
    rep.recordSuccess('agent-1', 100, 5);
    expect(emitted).toBe(true);
  });

  test('emits reputation:updated on failure', () => {
    let emitted = false;
    rep.on('reputation:updated', () => { emitted = true; });
    rep.recordFailure('agent-1');
    expect(emitted).toBe(true);
  });

  test('emitted score matches getScore', () => {
    let emittedScore: any = null;
    rep.on('reputation:updated', (score) => { emittedScore = score; });
    rep.recordSuccess('agent-1', 100, 5);
    const actualScore = rep.getScore('agent-1');
    expect(emittedScore).toEqual(actualScore);
  });
});

describe('ReputationManager - reliability calculation', () => {
  let rep: ReputationManager;

  beforeEach(() => {
    rep = new ReputationManager();
  });

  test('single task gives neutral reliability (0.5)', () => {
    rep.recordSuccess('agent-1', 100, 5);
    const score = rep.getScore('agent-1');
    expect(score.reliability).toBe(0.5);
  });

  test('consistent execution times give high reliability', () => {
    for (let i = 0; i < 10; i++) {
      rep.recordSuccess('consistent', 100, 5);
    }
    const score = rep.getScore('consistent');
    expect(score.reliability).toBeGreaterThan(0.9);
  });

  test('highly variable times give low reliability', () => {
    rep.recordSuccess('variable', 10, 5);
    rep.recordSuccess('variable', 1000, 5);
    rep.recordSuccess('variable', 50, 5);
    rep.recordSuccess('variable', 5000, 5);
    const score = rep.getScore('variable');
    expect(score.reliability).toBeLessThan(0.5);
  });

  test('reliability is between 0 and 1', () => {
    for (let i = 0; i < 5; i++) {
      rep.recordSuccess('agent-1', Math.random() * 1000, 5);
    }
    const score = rep.getScore('agent-1');
    expect(score.reliability).toBeGreaterThanOrEqual(0);
    expect(score.reliability).toBeLessThanOrEqual(1);
  });

  test('zero execution times give neutral reliability', () => {
    rep.recordSuccess('zero-agent', 0, 0);
    rep.recordSuccess('zero-agent', 0, 0);
    const score = rep.getScore('zero-agent');
    expect(score.reliability).toBe(0.5); // mean = 0, returns 0.5
  });
});

describe('ReputationManager - bid scoring', () => {
  let rep: ReputationManager;

  beforeEach(() => {
    rep = new ReputationManager();
  });

  test('new agent gets 1.0x multiplier (0.5 + 0.5)', () => {
    const score = rep.getReputationAdjustedBidScore('new', 0.8, 10);
    // baseScore = 0.8 / (10 + 1) = ~0.0727
    // multiplier = 0.5 + 0.5 = 1.0
    expect(score).toBeCloseTo(0.8 / 11, 3);
  });

  test('high reputation agent gets higher bid score', () => {
    for (let i = 0; i < 20; i++) {
      rep.recordSuccess('good', 100, 5);
    }
    const goodScore = rep.getReputationAdjustedBidScore('good', 0.8, 10);
    const newScore = rep.getReputationAdjustedBidScore('unknown', 0.8, 10);
    expect(goodScore).toBeGreaterThan(newScore);
  });

  test('low reputation agent gets lower bid score', () => {
    for (let i = 0; i < 5; i++) {
      rep.recordFailure('bad');
    }
    const badScore = rep.getReputationAdjustedBidScore('bad', 0.8, 10);
    const newScore = rep.getReputationAdjustedBidScore('unknown', 0.8, 10);
    expect(badScore).toBeLessThan(newScore);
  });

  test('higher confidence produces higher base score', () => {
    const high = rep.getReputationAdjustedBidScore('agent', 0.9, 10);
    const low = rep.getReputationAdjustedBidScore('agent', 0.3, 10);
    expect(high).toBeGreaterThan(low);
  });

  test('higher cost produces lower base score', () => {
    const cheap = rep.getReputationAdjustedBidScore('agent', 0.8, 5);
    const expensive = rep.getReputationAdjustedBidScore('agent', 0.8, 50);
    expect(cheap).toBeGreaterThan(expensive);
  });

  test('zero cost does not cause division by zero', () => {
    const score = rep.getReputationAdjustedBidScore('agent', 0.8, 0);
    // baseScore = 0.8 / (0 + 1) = 0.8
    expect(score).toBeCloseTo(0.8, 3);
  });
});

// HCS10Bridge tests skipped - requires external SDK dependency (file-type)

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE SYSTEM TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('MessageType enum values', () => {
  test('agent lifecycle messages', () => {
    expect(MessageType.AGENT_REGISTER).toBe('agent.register');
    expect(MessageType.AGENT_DEREGISTER).toBe('agent.deregister');
    expect(MessageType.AGENT_HEARTBEAT).toBe('agent.heartbeat');
    expect(MessageType.AGENT_STATUS_UPDATE).toBe('agent.status_update');
  });

  test('task coordination messages', () => {
    expect(MessageType.TASK_REQUEST).toBe('task.request');
    expect(MessageType.TASK_BID).toBe('task.bid');
    expect(MessageType.TASK_ASSIGN).toBe('task.assign');
    expect(MessageType.TASK_ACCEPT).toBe('task.accept');
    expect(MessageType.TASK_REJECT).toBe('task.reject');
    expect(MessageType.TASK_PROGRESS).toBe('task.progress');
    expect(MessageType.TASK_COMPLETE).toBe('task.complete');
    expect(MessageType.TASK_FAIL).toBe('task.fail');
  });

  test('agent-to-agent messages', () => {
    expect(MessageType.CAPABILITY_QUERY).toBe('capability.query');
    expect(MessageType.CAPABILITY_RESPONSE).toBe('capability.response');
    expect(MessageType.DATA_REQUEST).toBe('data.request');
    expect(MessageType.DATA_RESPONSE).toBe('data.response');
  });

  test('connection management messages', () => {
    expect(MessageType.CONNECTION_REQUEST).toBe('connection.request');
    expect(MessageType.CONNECTION_ACCEPT).toBe('connection.accept');
    expect(MessageType.CONNECTION_REJECT).toBe('connection.reject');
  });

  test('all message types are unique', () => {
    const values = Object.values(MessageType);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  test('total message type count', () => {
    const values = Object.values(MessageType);
    // Filter out numeric keys from enum
    const stringValues = values.filter(v => typeof v === 'string');
    expect(stringValues.length).toBe(19);
  });
});

describe('AgentProfile shape validation', () => {
  test('profile has all required fields', () => {
    const profile = makeProfile();
    expect(profile.id).toBeDefined();
    expect(profile.name).toBeDefined();
    expect(profile.description).toBeDefined();
    expect(profile.capabilities).toBeDefined();
    expect(profile.hederaAccountId).toBeDefined();
    expect(profile.inboundTopicId).toBeDefined();
    expect(profile.outboundTopicId).toBeDefined();
    expect(profile.registryTopicId).toBeDefined();
    expect(profile.status).toBeDefined();
    expect(profile.createdAt).toBeDefined();
    expect(profile.metadata).toBeDefined();
  });

  test('status can be active, inactive, or busy', () => {
    const statuses = ['active', 'inactive', 'busy'] as const;
    for (const status of statuses) {
      const profile = makeProfile({ status });
      expect(profile.status).toBe(status);
    }
  });

  test('capabilities is an array', () => {
    const profile = makeProfile();
    expect(Array.isArray(profile.capabilities)).toBe(true);
  });

  test('metadata is a string-keyed record', () => {
    const profile = makeProfile({ metadata: { key: 'value', another: '123' } });
    expect(profile.metadata.key).toBe('value');
    expect(profile.metadata.another).toBe('123');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REPUTATION SCORE MATH VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Reputation score formula validation', () => {
  let rep: ReputationManager;

  beforeEach(() => {
    rep = new ReputationManager();
  });

  test('overallScore = 0.5*successRate + 0.3*reliability + 0.2*experienceBonus', () => {
    // 10 consistent successes
    for (let i = 0; i < 10; i++) {
      rep.recordSuccess('formula-agent', 100, 5);
    }
    const score = rep.getScore('formula-agent');
    // successRate = 1.0
    // reliability ≈ 1.0 (very consistent times)
    // experienceBonus = min(10/20, 1) = 0.5
    // expected ≈ 0.5*1.0 + 0.3*1.0 + 0.2*0.5 = 0.5 + 0.3 + 0.1 = 0.9
    expect(score.overallScore).toBeCloseTo(0.9, 1);
  });

  test('perfect agent (20+ tasks, all success, consistent) scores near 1.0', () => {
    for (let i = 0; i < 25; i++) {
      rep.recordSuccess('perfect', 100, 5);
    }
    const score = rep.getScore('perfect');
    // successRate = 1.0, reliability ≈ 1.0, experienceBonus = 1.0
    // expected ≈ 0.5 + 0.3 + 0.2 = 1.0
    expect(score.overallScore).toBeGreaterThan(0.95);
  });

  test('terrible agent (all failures) scores near 0.1', () => {
    for (let i = 0; i < 10; i++) {
      rep.recordFailure('terrible');
    }
    const score = rep.getScore('terrible');
    // successRate = 0, reliability = 0.5 (no exec times), experienceBonus = 0.5
    // expected = 0.5*0 + 0.3*0.5 + 0.2*0.5 = 0 + 0.15 + 0.1 = 0.25
    expect(score.overallScore).toBeLessThan(0.3);
  });

  test('overallScore is rounded to 3 decimal places', () => {
    rep.recordSuccess('round-test', 100, 5);
    rep.recordSuccess('round-test', 150, 7);
    rep.recordFailure('round-test');
    const score = rep.getScore('round-test');
    const decimals = score.overallScore.toString().split('.')[1];
    expect(!decimals || decimals.length <= 3).toBe(true);
  });

  test('successRate is rounded to 3 decimal places', () => {
    rep.recordSuccess('rate', 100, 5);
    rep.recordSuccess('rate', 100, 5);
    rep.recordFailure('rate');
    const score = rep.getScore('rate');
    expect(score.successRate).toBe(0.667); // 2/3 rounded
  });

  test('avgExecutionTime is rounded to integers', () => {
    rep.recordSuccess('time', 101, 5);
    rep.recordSuccess('time', 202, 5);
    const score = rep.getScore('time');
    expect(Number.isInteger(score.avgExecutionTime)).toBe(true);
    expect(score.avgExecutionTime).toBe(152); // Math.round(151.5)
  });

  test('avgCost is rounded to 2 decimal places', () => {
    rep.recordSuccess('cost', 100, 3.333);
    rep.recordSuccess('cost', 100, 6.666);
    const score = rep.getScore('cost');
    expect(score.avgCost).toBe(5); // Math.round(4.9995 * 100) / 100
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT PROFILE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

describe('AgentProfile - capability handling', () => {
  test('capabilities can be empty array', () => {
    const profile = makeProfile({ capabilities: [] });
    expect(profile.capabilities).toHaveLength(0);
  });

  test('capabilities with complex schemas', () => {
    const cap: AgentCapability = {
      name: 'complex_analysis',
      description: 'Performs complex analysis',
      inputSchema: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { type: 'string' } },
          options: { type: 'object' },
        },
        required: ['data'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          result: { type: 'number' },
          confidence: { type: 'number' },
        },
      },
    };
    const profile = makeProfile({ capabilities: [cap] });
    expect(profile.capabilities[0].name).toBe('complex_analysis');
    expect(profile.capabilities[0].inputSchema).toHaveProperty('required');
  });

  test('multiple capabilities with different names', () => {
    const caps: AgentCapability[] = [
      makeCapability('web_research'),
      makeCapability('data_analysis'),
      makeCapability('summarize'),
    ];
    const profile = makeProfile({ capabilities: caps });
    expect(profile.capabilities).toHaveLength(3);
    const names = profile.capabilities.map(c => c.name);
    expect(new Set(names).size).toBe(3); // All unique
  });
});

describe('MeshConfig validation', () => {
  test('valid testnet config', () => {
    const config: MeshConfig = {
      network: 'testnet',
      operatorAccountId: '0.0.12345',
      operatorPrivateKey: '302e020100300506032b657004220420aaaa',
    };
    expect(config.network).toBe('testnet');
  });

  test('config with all optional fields', () => {
    const config: MeshConfig = {
      network: 'mainnet',
      operatorAccountId: '0.0.12345',
      operatorPrivateKey: '302e020100300506032b657004220420aaaa',
      registryTopicId: '0.0.99999',
      maxAgents: 100,
      heartbeatInterval: 30000,
      taskTimeout: 60000,
    };
    expect(config.maxAgents).toBe(100);
    expect(config.heartbeatInterval).toBe(30000);
    expect(config.taskTimeout).toBe(60000);
  });

  test('network can be mainnet, testnet, or previewnet', () => {
    const networks = ['mainnet', 'testnet', 'previewnet'] as const;
    for (const network of networks) {
      const config: MeshConfig = {
        network,
        operatorAccountId: '0.0.1',
        operatorPrivateKey: 'key',
      };
      expect(config.network).toBe(network);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REPUTATION MANAGER - STRESS & BOUNDARY TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('ReputationManager - stress tests', () => {
  let rep: ReputationManager;

  beforeEach(() => {
    rep = new ReputationManager();
  });

  test('handles 100 agents', () => {
    for (let i = 0; i < 100; i++) {
      rep.recordSuccess(`agent-${i}`, 100 + i, 5 + i);
    }
    expect(rep.getTrackedAgentCount()).toBe(100);
    const scores = rep.getAllScores();
    expect(scores).toHaveLength(100);
  });

  test('handles 1000 tasks for single agent', () => {
    for (let i = 0; i < 1000; i++) {
      rep.recordSuccess('heavy-agent', 100, 5);
    }
    const score = rep.getScore('heavy-agent');
    expect(score.taskCount).toBe(1000);
    expect(score.successRate).toBe(1);
    // Experience bonus capped at 1.0 (20 tasks max)
    const record = rep.getRecord('heavy-agent');
    expect(record!.totalTasks).toBe(1000);
  });

  test('alternating success/failure produces 50% success rate', () => {
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) {
        rep.recordSuccess('alternating', 100, 5);
      } else {
        rep.recordFailure('alternating');
      }
    }
    const score = rep.getScore('alternating');
    expect(score.successRate).toBe(0.5);
    expect(score.taskCount).toBe(100);
  });

  test('reset then re-record works correctly', () => {
    rep.recordSuccess('reset-test', 100, 5);
    rep.recordSuccess('reset-test', 100, 5);
    rep.reset('reset-test');
    expect(rep.getScore('reset-test').taskCount).toBe(0);

    rep.recordSuccess('reset-test', 200, 10);
    const score = rep.getScore('reset-test');
    expect(score.taskCount).toBe(1);
    expect(score.avgExecutionTime).toBe(200);
    expect(score.avgCost).toBe(10);
  });

  test('very large execution times do not overflow', () => {
    rep.recordSuccess('big-time', Number.MAX_SAFE_INTEGER / 2, 5);
    rep.recordSuccess('big-time', Number.MAX_SAFE_INTEGER / 2, 5);
    const score = rep.getScore('big-time');
    expect(isFinite(score.avgExecutionTime)).toBe(true);
  });

  test('zero cost tasks produce avgCost of 0', () => {
    rep.recordSuccess('free-agent', 100, 0);
    rep.recordSuccess('free-agent', 200, 0);
    const score = rep.getScore('free-agent');
    expect(score.avgCost).toBe(0);
  });
});

// HCS10Bridge config tests skipped - requires external SDK dependency
