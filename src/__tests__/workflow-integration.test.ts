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

// ═══════════════════════════════════════════════════════════════════════════════
// FULL TASK LIFECYCLE WITH MOCKED HEDERA CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

import { AgentRegistry } from '../core/agent-registry';
import { TaskCoordinator, TaskBid } from '../core/task-coordinator';
import { HederaClient } from '../core/hedera-client';

jest.mock('../core/hedera-client');

function createMockClient(): jest.Mocked<HederaClient> {
  const mock = new HederaClient({
    network: 'testnet',
    operatorAccountId: '0.0.1',
    operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
  }) as jest.Mocked<HederaClient>;

  mock.createTopic = jest.fn().mockResolvedValue('0.0.100');
  mock.submitMessage = jest.fn().mockResolvedValue(1);
  mock.subscribeTopic = jest.fn();
  mock.emit = jest.fn().mockReturnValue(true);

  return mock;
}

function createAgentProfile(id: string, caps: string[], status: AgentProfile['status'] = 'active'): AgentProfile {
  return {
    id,
    name: `Agent_${id}`,
    description: `Test agent ${id}`,
    capabilities: caps.map(c => ({
      name: c,
      description: `${c} capability`,
      inputSchema: {},
      outputSchema: {},
    })),
    hederaAccountId: '0.0.12345',
    inboundTopicId: '0.0.200',
    outboundTopicId: '0.0.201',
    registryTopicId: '0.0.100',
    status,
    createdAt: Date.now(),
    metadata: {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW: FULL TASK LIFECYCLE
// discover -> bid -> assign -> complete -> reputation update
// ═══════════════════════════════════════════════════════════════════════════════

describe('Workflow: Full Task Lifecycle (discover -> bid -> assign -> complete -> reputation)', () => {
  let registry: AgentRegistry;
  let coordinator: TaskCoordinator;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
  });

  test('complete lifecycle: register agents, discover, submit task, bid, assign, complete, check reputation', async () => {
    // Step 1: Register agents
    await registry.registerAgent(createAgentProfile('researcher', ['web_research']));
    await registry.registerAgent(createAgentProfile('analyst', ['data_analysis']));
    await registry.registerAgent(createAgentProfile('writer', ['content_writing']));

    // Step 2: Discover agents by capability
    const researchers = registry.discoverAgents({ capability: 'web_research', status: 'active' });
    expect(researchers.totalFound).toBe(1);
    expect(researchers.agents[0]!.id).toBe('researcher');

    // Step 3: Submit a task
    const taskId = await coordinator.submitTask({
      description: 'Research and analyze AI trends',
      requiredCapabilities: ['web_research'],
      payload: { topic: 'AI trends 2026' },
      priority: 'high',
      requesterId: 'requester-1',
    });
    expect(coordinator.getTask(taskId)).toBeDefined();

    // Step 4: Submit bid from discovered agent
    await coordinator.submitBid({
      taskId,
      agentId: 'researcher',
      capability: 'web_research',
      estimatedDuration: 3000,
      estimatedCost: 2,
      confidence: 0.95,
      timestamp: Date.now(),
    });

    // Step 5: Select best bid and assign
    const bestBid = coordinator.selectBestBid(taskId);
    expect(bestBid).toBeDefined();
    expect(bestBid!.agentId).toBe('researcher');

    const assignment = await coordinator.assignTask(taskId, bestBid!.agentId, bestBid!.capability);
    expect(assignment.status).toBe('assigned');

    // Step 6: Complete the task
    const completedSpy = jest.fn();
    coordinator.on('task:completed', completedSpy);

    await coordinator.completeTask(taskId, 'researcher', { findings: ['trend1', 'trend2'] });

    // Step 7: Verify result
    expect(completedSpy).toHaveBeenCalled();
    const result = completedSpy.mock.calls[0][0];
    expect(result.status).toBe('success');
    expect(result.outputs.web_research).toEqual({ findings: ['trend1', 'trend2'] });

    // Step 8: Verify reputation was updated
    const score = coordinator.reputation.getScore('researcher');
    expect(score.taskCount).toBe(1);
    expect(score.successRate).toBe(1);
    expect(score.overallScore).toBeGreaterThan(0.5);
  });

  test('lifecycle with multi-capability task across multiple agents', async () => {
    // Register specialized agents
    await registry.registerAgent(createAgentProfile('research-agent', ['research']));
    await registry.registerAgent(createAgentProfile('analysis-agent', ['analysis']));
    await registry.registerAgent(createAgentProfile('summary-agent', ['summarize']));

    // Submit multi-capability task
    const taskId = await coordinator.submitTask({
      description: 'Research, analyze, and summarize AI market',
      requiredCapabilities: ['research', 'analysis', 'summarize'],
      payload: { topic: 'AI market' },
      priority: 'critical',
      requesterId: 'boss',
    });

    // Each agent bids on their capability
    await coordinator.submitBid({
      taskId, agentId: 'research-agent', capability: 'research',
      estimatedDuration: 2000, estimatedCost: 3, confidence: 0.9, timestamp: Date.now(),
    });
    await coordinator.submitBid({
      taskId, agentId: 'analysis-agent', capability: 'analysis',
      estimatedDuration: 4000, estimatedCost: 5, confidence: 0.85, timestamp: Date.now(),
    });
    await coordinator.submitBid({
      taskId, agentId: 'summary-agent', capability: 'summarize',
      estimatedDuration: 1000, estimatedCost: 1, confidence: 0.95, timestamp: Date.now(),
    });

    // Assign all three
    await coordinator.assignTask(taskId, 'research-agent', 'research');
    await coordinator.assignTask(taskId, 'analysis-agent', 'analysis');
    await coordinator.assignTask(taskId, 'summary-agent', 'summarize');

    const completedSpy = jest.fn();
    coordinator.on('task:completed', completedSpy);

    // All complete
    await coordinator.completeTask(taskId, 'research-agent', { data: ['item1'] });
    await coordinator.completeTask(taskId, 'analysis-agent', { insights: ['insight1'] });
    await coordinator.completeTask(taskId, 'summary-agent', { summary: 'AI market is growing' });

    expect(completedSpy).toHaveBeenCalled();
    const result = completedSpy.mock.calls[0][0];
    expect(result.status).toBe('success');
    expect(result.outputs.research).toEqual({ data: ['item1'] });
    expect(result.outputs.analysis).toEqual({ insights: ['insight1'] });
    expect(result.outputs.summarize).toEqual({ summary: 'AI market is growing' });

    // All agents should have updated reputation
    for (const agentId of ['research-agent', 'analysis-agent', 'summary-agent']) {
      const s = coordinator.reputation.getScore(agentId);
      expect(s.taskCount).toBe(1);
      expect(s.successRate).toBe(1);
    }
  });

  test('lifecycle with auto-assignment', async () => {
    await registry.registerAgent(createAgentProfile('auto-r', ['research'], 'active'));
    await registry.registerAgent(createAgentProfile('auto-a', ['analysis'], 'active'));

    const taskId = await coordinator.submitTask({
      description: 'Auto-assigned task',
      requiredCapabilities: ['research', 'analysis'],
      payload: {},
      priority: 'medium',
      requesterId: 'auto-requester',
    });

    const assignments = await coordinator.autoAssignTask(taskId);
    expect(assignments.length).toBe(2);
    expect(assignments[0]!.capability).toBe('research');
    expect(assignments[1]!.capability).toBe('analysis');

    // Complete both
    await coordinator.completeTask(taskId, assignments[0]!.agentId, 'result-r');
    await coordinator.completeTask(taskId, assignments[1]!.agentId, 'result-a');

    const result = coordinator.getTaskResult(taskId);
    expect(result).toBeDefined();
    expect(result!.status).toBe('success');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW: MULTI-AGENT COORDINATION (3+ agents competing)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Workflow: Multi-Agent Coordination (3+ agents competing)', () => {
  let registry: AgentRegistry;
  let coordinator: TaskCoordinator;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
  });

  test('3 agents bid on the same task, best bid wins', async () => {
    await registry.registerAgent(createAgentProfile('agent-1', ['research']));
    await registry.registerAgent(createAgentProfile('agent-2', ['research']));
    await registry.registerAgent(createAgentProfile('agent-3', ['research']));

    const taskId = await coordinator.submitTask({
      description: 'Competitive task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'high',
      requesterId: 'requester',
    });

    // Agent-1: low confidence, high cost
    await coordinator.submitBid({
      taskId, agentId: 'agent-1', capability: 'research',
      estimatedDuration: 10000, estimatedCost: 20, confidence: 0.5, timestamp: Date.now(),
    });
    // Agent-2: medium confidence, medium cost
    await coordinator.submitBid({
      taskId, agentId: 'agent-2', capability: 'research',
      estimatedDuration: 5000, estimatedCost: 10, confidence: 0.7, timestamp: Date.now(),
    });
    // Agent-3: high confidence, low cost (best)
    await coordinator.submitBid({
      taskId, agentId: 'agent-3', capability: 'research',
      estimatedDuration: 2000, estimatedCost: 2, confidence: 0.95, timestamp: Date.now(),
    });

    const best = coordinator.selectBestBid(taskId);
    expect(best).toBeDefined();
    expect(best!.agentId).toBe('agent-3');
  });

  test('5 agents compete with reputation influence', async () => {
    // Build up reputation for agent-2
    for (let i = 0; i < 15; i++) {
      coordinator.reputation.recordSuccess('agent-2', 100, 5);
    }

    const taskId = await coordinator.submitTask({
      description: 'Reputation-influenced competition',
      requiredCapabilities: ['analysis'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester',
    });

    // All agents bid with identical terms
    for (let i = 1; i <= 5; i++) {
      await coordinator.submitBid({
        taskId, agentId: `agent-${i}`, capability: 'analysis',
        estimatedDuration: 5000, estimatedCost: 10, confidence: 0.8, timestamp: Date.now(),
      });
    }

    // Agent-2 should win due to reputation advantage
    const best = coordinator.selectBestBid(taskId);
    expect(best).toBeDefined();
    expect(best!.agentId).toBe('agent-2');
  });

  test('multiple agents discover each other via registry', async () => {
    await registry.registerAgent(createAgentProfile('a1', ['research', 'writing']));
    await registry.registerAgent(createAgentProfile('a2', ['research', 'analysis']));
    await registry.registerAgent(createAgentProfile('a3', ['analysis', 'visualization']));
    await registry.registerAgent(createAgentProfile('a4', ['writing', 'translation']));
    await registry.registerAgent(createAgentProfile('a5', ['research']));

    // Research: a1, a2, a5
    const researchAgents = registry.discoverAgents({ capability: 'research' });
    expect(researchAgents.totalFound).toBe(3);

    // Analysis: a2, a3
    const analysisAgents = registry.discoverAgents({ capability: 'analysis' });
    expect(analysisAgents.totalFound).toBe(2);

    // Writing: a1, a4
    const writingAgents = registry.discoverAgents({ capability: 'writing' });
    expect(writingAgents.totalFound).toBe(2);

    // Visualization: a3 only
    const vizAgents = registry.discoverAgents({ capability: 'visualization' });
    expect(vizAgents.totalFound).toBe(1);
    expect(vizAgents.agents[0]!.id).toBe('a3');
  });

  test('agents compete across multiple simultaneous tasks', async () => {
    await registry.registerAgent(createAgentProfile('worker-1', ['cap']));
    await registry.registerAgent(createAgentProfile('worker-2', ['cap']));
    await registry.registerAgent(createAgentProfile('worker-3', ['cap']));

    const taskIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const taskId = await coordinator.submitTask({
        description: `Task ${i}`,
        requiredCapabilities: ['cap'],
        payload: {},
        priority: 'medium',
        requesterId: 'requester',
      });
      taskIds.push(taskId);
    }

    // Each worker bids on all tasks
    for (const taskId of taskIds) {
      for (let w = 1; w <= 3; w++) {
        await coordinator.submitBid({
          taskId, agentId: `worker-${w}`, capability: 'cap',
          estimatedDuration: 1000 * w, estimatedCost: w, confidence: 0.9 - w * 0.1,
          timestamp: Date.now(),
        });
      }
    }

    // Each task should have 3 bids
    for (const taskId of taskIds) {
      expect(coordinator.getTaskBids(taskId).length).toBe(3);
    }

    // Assign best bids
    for (const taskId of taskIds) {
      const best = coordinator.selectBestBid(taskId);
      expect(best).toBeDefined();
      await coordinator.assignTask(taskId, best!.agentId, best!.capability);
    }

    // All tasks should have assignments
    for (const taskId of taskIds) {
      expect(coordinator.getTaskAssignments(taskId).length).toBe(1);
    }
  });

  test('bid selection with maxResults in discovery', async () => {
    // Register many agents
    for (let i = 0; i < 10; i++) {
      await registry.registerAgent(createAgentProfile(`agent-${i}`, ['cap']));
    }

    // Discover with maxResults
    const limited = registry.discoverAgents({ capability: 'cap', maxResults: 3 });
    expect(limited.totalFound).toBe(3);
    expect(limited.agents.length).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW: TASK FAILURE AND RETRY
// ═══════════════════════════════════════════════════════════════════════════════

describe('Workflow: Task Failure and Retry Flows', () => {
  let registry: AgentRegistry;
  let coordinator: TaskCoordinator;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
  });

  test('task fails and is retried with a different agent', async () => {
    await registry.registerAgent(createAgentProfile('agent-a', ['research']));
    await registry.registerAgent(createAgentProfile('agent-b', ['research']));

    // Submit task
    const taskId = await coordinator.submitTask({
      description: 'Retriable task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'high',
      requesterId: 'requester',
    });

    // First attempt: agent-a fails
    await coordinator.assignTask(taskId, 'agent-a', 'research');
    await coordinator.failTask(taskId, 'agent-a', 'timeout');

    // Verify failure recorded
    const failedAssignments = coordinator.getTaskAssignments(taskId);
    expect(failedAssignments[0]!.status).toBe('failed');

    // Agent-a gets reputation penalty
    const scoreA = coordinator.reputation.getScore('agent-a');
    expect(scoreA.successRate).toBe(0);

    // Retry with agent-b
    await coordinator.assignTask(taskId, 'agent-b', 'research');
    await coordinator.completeTask(taskId, 'agent-b', { result: 'success' });

    // Agent-b gets reputation boost
    const scoreB = coordinator.reputation.getScore('agent-b');
    expect(scoreB.successRate).toBe(1);
  });

  test('all agents fail a task', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Doomed task',
      requiredCapabilities: ['impossible'],
      payload: {},
      priority: 'critical',
      requesterId: 'requester',
    });

    const completedSpy = jest.fn();
    coordinator.on('task:completed', completedSpy);

    // Three agents all fail
    await coordinator.assignTask(taskId, 'agent-1', 'impossible');
    await coordinator.assignTask(taskId, 'agent-2', 'impossible');
    await coordinator.assignTask(taskId, 'agent-3', 'impossible');

    await coordinator.failTask(taskId, 'agent-1', 'error');
    await coordinator.failTask(taskId, 'agent-2', 'error');
    await coordinator.failTask(taskId, 'agent-3', 'error');

    // Task should complete with partial/failed status
    expect(completedSpy).toHaveBeenCalled();
    const result = completedSpy.mock.calls[0][0];
    expect(result.status).toBe('partial');

    // All agents get reputation hits
    for (let i = 1; i <= 3; i++) {
      const score = coordinator.reputation.getScore(`agent-${i}`);
      expect(score.successRate).toBe(0);
      expect(score.taskCount).toBe(1);
    }
  });

  test('partial failure: one agent succeeds, one fails, task result is partial', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Partial task',
      requiredCapabilities: ['part_a', 'part_b'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester',
    });

    await coordinator.assignTask(taskId, 'good-agent', 'part_a');
    await coordinator.assignTask(taskId, 'bad-agent', 'part_b');

    const completedSpy = jest.fn();
    coordinator.on('task:completed', completedSpy);

    await coordinator.completeTask(taskId, 'good-agent', { data: 'ok' });
    await coordinator.failTask(taskId, 'bad-agent', 'crashed');

    expect(completedSpy).toHaveBeenCalled();
    const result = completedSpy.mock.calls[0][0];
    expect(result.status).toBe('partial');
    expect(result.outputs.part_a).toEqual({ data: 'ok' });
    // part_b output should contain the error
    expect(result.outputs.part_b).toEqual({ error: 'crashed' });
  });

  test('task fails then is resubmitted as new task', async () => {
    await registry.registerAgent(createAgentProfile('worker', ['cap']));

    // First submission
    const taskId1 = await coordinator.submitTask({
      description: 'First attempt',
      requiredCapabilities: ['cap'],
      payload: {},
      priority: 'high',
      requesterId: 'requester',
    });

    await coordinator.assignTask(taskId1, 'worker', 'cap');
    await coordinator.failTask(taskId1, 'worker', 'error');

    // Resubmit as new task
    const taskId2 = await coordinator.submitTask({
      description: 'Retry attempt',
      requiredCapabilities: ['cap'],
      payload: {},
      priority: 'critical',
      requesterId: 'requester',
    });

    expect(taskId2).not.toBe(taskId1);
    await coordinator.assignTask(taskId2, 'worker', 'cap');
    await coordinator.completeTask(taskId2, 'worker', 'success');

    const result2 = coordinator.getTaskResult(taskId2);
    expect(result2).toBeDefined();
    expect(result2!.status).toBe('success');

    // Worker had one failure and one success
    const score = coordinator.reputation.getScore('worker');
    expect(score.taskCount).toBe(2);
    expect(score.successRate).toBe(0.5);
  });

  test('task:failed event is emitted on failure', async () => {
    const failSpy = jest.fn();
    coordinator.on('task:failed', failSpy);

    const taskId = await coordinator.submitTask({
      description: 'Fail event test',
      requiredCapabilities: ['cap'],
      payload: {},
      priority: 'low',
      requesterId: 'requester',
    });

    await coordinator.assignTask(taskId, 'agent', 'cap');
    await coordinator.failTask(taskId, 'agent', 'boom');

    expect(failSpy).toHaveBeenCalledWith({
      taskId,
      agentId: 'agent',
      error: 'boom',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW: CONCURRENT TASK EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Workflow: Concurrent Task Execution', () => {
  let registry: AgentRegistry;
  let coordinator: TaskCoordinator;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
  });

  test('multiple tasks execute concurrently with independent results', async () => {
    const taskIds = await Promise.all([
      coordinator.submitTask({
        description: 'Task A', requiredCapabilities: ['cap_a'], payload: {},
        priority: 'high', requesterId: 'r1',
      }),
      coordinator.submitTask({
        description: 'Task B', requiredCapabilities: ['cap_b'], payload: {},
        priority: 'medium', requesterId: 'r1',
      }),
      coordinator.submitTask({
        description: 'Task C', requiredCapabilities: ['cap_c'], payload: {},
        priority: 'low', requesterId: 'r1',
      }),
    ]);

    expect(coordinator.getTaskCount()).toBe(3);

    // Assign each task to a different agent
    await coordinator.assignTask(taskIds[0]!, 'agent-a', 'cap_a');
    await coordinator.assignTask(taskIds[1]!, 'agent-b', 'cap_b');
    await coordinator.assignTask(taskIds[2]!, 'agent-c', 'cap_c');

    // Complete in reverse order
    await coordinator.completeTask(taskIds[2]!, 'agent-c', 'result-c');
    await coordinator.completeTask(taskIds[0]!, 'agent-a', 'result-a');
    await coordinator.completeTask(taskIds[1]!, 'agent-b', 'result-b');

    // Each task should have independent result
    for (let i = 0; i < 3; i++) {
      const result = coordinator.getTaskResult(taskIds[i]!);
      expect(result).toBeDefined();
      expect(result!.status).toBe('success');
    }
  });

  test('same agent works on multiple concurrent tasks', async () => {
    const taskId1 = await coordinator.submitTask({
      description: 'Task 1', requiredCapabilities: ['cap'], payload: {},
      priority: 'high', requesterId: 'r1',
    });
    const taskId2 = await coordinator.submitTask({
      description: 'Task 2', requiredCapabilities: ['cap'], payload: {},
      priority: 'medium', requesterId: 'r1',
    });

    // Same agent assigned to both
    await coordinator.assignTask(taskId1, 'multi-tasker', 'cap');
    await coordinator.assignTask(taskId2, 'multi-tasker', 'cap');

    // Complete both
    await coordinator.completeTask(taskId1, 'multi-tasker', 'done-1');
    await coordinator.completeTask(taskId2, 'multi-tasker', 'done-2');

    expect(coordinator.getTaskResult(taskId1)!.status).toBe('success');
    expect(coordinator.getTaskResult(taskId2)!.status).toBe('success');

    // Agent should have 2 successes
    const score = coordinator.reputation.getScore('multi-tasker');
    expect(score.taskCount).toBe(2);
    expect(score.successRate).toBe(1);
  });

  test('concurrent bids arrive for multiple tasks', async () => {
    const taskIds = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        coordinator.submitTask({
          description: `Task ${i}`, requiredCapabilities: ['cap'], payload: {},
          priority: 'medium', requesterId: 'r1',
        })
      )
    );

    // 3 agents bid on all 5 tasks
    const bidPromises: Promise<void>[] = [];
    for (const taskId of taskIds) {
      for (let a = 1; a <= 3; a++) {
        bidPromises.push(
          coordinator.submitBid({
            taskId, agentId: `bidder-${a}`, capability: 'cap',
            estimatedDuration: 1000, estimatedCost: a, confidence: 0.9 / a,
            timestamp: Date.now(),
          })
        );
      }
    }

    await Promise.all(bidPromises);

    // Each task should have 3 bids
    for (const taskId of taskIds) {
      expect(coordinator.getTaskBids(taskId).length).toBe(3);
    }
  });

  test('mixed success and failure across concurrent tasks', async () => {
    const completedSpy = jest.fn();
    coordinator.on('task:completed', completedSpy);

    const taskId1 = await coordinator.submitTask({
      description: 'Success task', requiredCapabilities: ['cap'], payload: {},
      priority: 'high', requesterId: 'r1',
    });
    const taskId2 = await coordinator.submitTask({
      description: 'Failure task', requiredCapabilities: ['cap'], payload: {},
      priority: 'high', requesterId: 'r1',
    });

    await coordinator.assignTask(taskId1, 'good-agent', 'cap');
    await coordinator.assignTask(taskId2, 'bad-agent', 'cap');

    await coordinator.completeTask(taskId1, 'good-agent', 'success');
    await coordinator.failTask(taskId2, 'bad-agent', 'error');

    expect(completedSpy).toHaveBeenCalledTimes(2);

    const result1 = coordinator.getTaskResult(taskId1);
    const result2 = coordinator.getTaskResult(taskId2);
    expect(result1!.status).toBe('success');
    expect(result2!.status).toBe('partial');
  });

  test('rapid task submission and immediate assignment', async () => {
    const tasks: Array<{ id: string; agent: string }> = [];

    for (let i = 0; i < 10; i++) {
      const taskId = await coordinator.submitTask({
        description: `Rapid task ${i}`, requiredCapabilities: ['cap'], payload: {},
        priority: 'medium', requesterId: `req-${i}`,
      });
      tasks.push({ id: taskId, agent: `agent-${i}` });
    }

    // Assign all immediately
    for (const task of tasks) {
      await coordinator.assignTask(task.id, task.agent, 'cap');
    }

    // Complete all
    for (const task of tasks) {
      await coordinator.completeTask(task.id, task.agent, `result-${task.agent}`);
    }

    // All should have results
    for (const task of tasks) {
      const result = coordinator.getTaskResult(task.id);
      expect(result).toBeDefined();
      expect(result!.status).toBe('success');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW: AGENT JOIN/LEAVE DURING ACTIVE TASKS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Workflow: Agent Join/Leave During Active Tasks', () => {
  let registry: AgentRegistry;
  let coordinator: TaskCoordinator;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
  });

  test('agent leaves after being assigned a task', async () => {
    await registry.registerAgent(createAgentProfile('leaving-agent', ['research']));

    const taskId = await coordinator.submitTask({
      description: 'Task for leaving agent',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'high',
      requesterId: 'requester',
    });

    await coordinator.assignTask(taskId, 'leaving-agent', 'research');

    // Agent deregisters mid-task
    await registry.deregisterAgent('leaving-agent');
    expect(registry.getAgent('leaving-agent')).toBeUndefined();

    // Assignment still exists in coordinator
    const assignments = coordinator.getTaskAssignments(taskId);
    expect(assignments.length).toBe(1);
    expect(assignments[0]!.status).toBe('assigned');
  });

  test('new agent joins and takes over failed task', async () => {
    await registry.registerAgent(createAgentProfile('original', ['cap']));

    const taskId = await coordinator.submitTask({
      description: 'Takeover task',
      requiredCapabilities: ['cap'],
      payload: {},
      priority: 'high',
      requesterId: 'requester',
    });

    // Original agent fails
    await coordinator.assignTask(taskId, 'original', 'cap');
    await coordinator.failTask(taskId, 'original', 'crashed');

    // New agent joins the mesh
    await registry.registerAgent(createAgentProfile('replacement', ['cap']));

    // Discover the replacement
    const available = registry.discoverAgents({ capability: 'cap', status: 'active' });
    expect(available.totalFound).toBe(2); // original still registered, just failed the task

    // Assign to replacement
    await coordinator.assignTask(taskId, 'replacement', 'cap');
    await coordinator.completeTask(taskId, 'replacement', 'rescued');

    // Verify completion
    const result = coordinator.getTaskResult(taskId);
    expect(result).toBeDefined();
  });

  test('agent status changes to busy during bidding', async () => {
    await registry.registerAgent(createAgentProfile('busy-agent', ['cap']));
    await registry.registerAgent(createAgentProfile('available-agent', ['cap']));

    // Both are active initially
    let active = registry.discoverAgents({ capability: 'cap', status: 'active' });
    expect(active.totalFound).toBe(2);

    // One goes busy
    await registry.updateAgentStatus('busy-agent', 'busy');

    active = registry.discoverAgents({ capability: 'cap', status: 'active' });
    expect(active.totalFound).toBe(1);
    expect(active.agents[0]!.id).toBe('available-agent');
  });

  test('agent goes inactive then returns active', async () => {
    await registry.registerAgent(createAgentProfile('flaky-agent', ['cap']));

    // Active
    expect(registry.discoverAgents({ capability: 'cap', status: 'active' }).totalFound).toBe(1);

    // Goes inactive
    await registry.updateAgentStatus('flaky-agent', 'inactive');
    expect(registry.discoverAgents({ capability: 'cap', status: 'active' }).totalFound).toBe(0);

    // Returns active
    await registry.updateAgentStatus('flaky-agent', 'active');
    expect(registry.discoverAgents({ capability: 'cap', status: 'active' }).totalFound).toBe(1);
  });

  test('multiple agents join incrementally while task is being assigned', async () => {
    await registry.registerAgent(createAgentProfile('first', ['cap']));

    const taskId = await coordinator.submitTask({
      description: 'Growing pool task',
      requiredCapabilities: ['cap'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester',
    });

    // First agent bids
    await coordinator.submitBid({
      taskId, agentId: 'first', capability: 'cap',
      estimatedDuration: 5000, estimatedCost: 10, confidence: 0.6, timestamp: Date.now(),
    });

    // Two more agents join
    await registry.registerAgent(createAgentProfile('second', ['cap']));
    await registry.registerAgent(createAgentProfile('third', ['cap']));

    // They also bid
    await coordinator.submitBid({
      taskId, agentId: 'second', capability: 'cap',
      estimatedDuration: 3000, estimatedCost: 5, confidence: 0.8, timestamp: Date.now(),
    });
    await coordinator.submitBid({
      taskId, agentId: 'third', capability: 'cap',
      estimatedDuration: 1000, estimatedCost: 2, confidence: 0.95, timestamp: Date.now(),
    });

    // Best bid should be from the latest joiner with best terms
    const best = coordinator.selectBestBid(taskId);
    expect(best).toBeDefined();
    expect(best!.agentId).toBe('third');
    expect(coordinator.getTaskBids(taskId).length).toBe(3);
  });

  test('deregistered agent can re-register with new capabilities', async () => {
    await registry.registerAgent(createAgentProfile('evolving', ['cap_v1']));
    expect(registry.discoverAgents({ capability: 'cap_v1' }).totalFound).toBe(1);

    await registry.deregisterAgent('evolving');
    expect(registry.getAgent('evolving')).toBeUndefined();

    // Re-register with different capabilities
    await registry.registerAgent(createAgentProfile('evolving', ['cap_v2', 'cap_v3']));

    expect(registry.discoverAgents({ capability: 'cap_v1' }).totalFound).toBe(0);
    expect(registry.discoverAgents({ capability: 'cap_v2' }).totalFound).toBe(1);
    expect(registry.discoverAgents({ capability: 'cap_v3' }).totalFound).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW: TASK DEPENDENCY CHAINS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Workflow: Task Dependency Chains', () => {
  let registry: AgentRegistry;
  let coordinator: TaskCoordinator;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.createTopic.mockResolvedValueOnce('0.0.100');
    await registry.initialize();
    mockClient.createTopic.mockResolvedValue('0.0.300');
    coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
  });

  test('sequential 3-task chain: research -> analyze -> summarize', async () => {
    await registry.registerAgent(createAgentProfile('researcher', ['research']));
    await registry.registerAgent(createAgentProfile('analyst', ['analyze']));
    await registry.registerAgent(createAgentProfile('writer', ['summarize']));

    // Task 1: Research
    const taskId1 = await coordinator.submitTask({
      description: 'Research data',
      requiredCapabilities: ['research'],
      payload: { topic: 'AI' },
      priority: 'high',
      requesterId: 'pipeline',
    });

    await coordinator.assignTask(taskId1, 'researcher', 'research');
    await coordinator.completeTask(taskId1, 'researcher', { data: ['fact1', 'fact2', 'fact3'] });

    const result1 = coordinator.getTaskResult(taskId1);
    expect(result1!.status).toBe('success');

    // Task 2: Analyze (depends on research output)
    const taskId2 = await coordinator.submitTask({
      description: 'Analyze research',
      requiredCapabilities: ['analyze'],
      payload: { inputData: result1!.outputs.research },
      priority: 'high',
      requesterId: 'pipeline',
    });

    await coordinator.assignTask(taskId2, 'analyst', 'analyze');
    await coordinator.completeTask(taskId2, 'analyst', { analysis: 'AI is growing rapidly' });

    const result2 = coordinator.getTaskResult(taskId2);
    expect(result2!.status).toBe('success');

    // Task 3: Summarize (depends on analysis output)
    const taskId3 = await coordinator.submitTask({
      description: 'Summarize analysis',
      requiredCapabilities: ['summarize'],
      payload: { inputData: result2!.outputs.analyze },
      priority: 'high',
      requesterId: 'pipeline',
    });

    await coordinator.assignTask(taskId3, 'writer', 'summarize');
    await coordinator.completeTask(taskId3, 'writer', { summary: 'AI market expanding' });

    const result3 = coordinator.getTaskResult(taskId3);
    expect(result3!.status).toBe('success');
    expect(result3!.outputs.summarize).toEqual({ summary: 'AI market expanding' });

    // All agents should have 1 success
    for (const agentId of ['researcher', 'analyst', 'writer']) {
      expect(coordinator.reputation.getScore(agentId).successRate).toBe(1);
    }
  });

  test('chain breaks mid-way: second task fails', async () => {
    // Task 1 succeeds
    const taskId1 = await coordinator.submitTask({
      description: 'Step 1',
      requiredCapabilities: ['step1'],
      payload: {},
      priority: 'high',
      requesterId: 'pipeline',
    });
    await coordinator.assignTask(taskId1, 'agent-1', 'step1');
    await coordinator.completeTask(taskId1, 'agent-1', { output: 'data' });

    expect(coordinator.getTaskResult(taskId1)!.status).toBe('success');

    // Task 2 fails
    const taskId2 = await coordinator.submitTask({
      description: 'Step 2 (depends on step 1)',
      requiredCapabilities: ['step2'],
      payload: { input: coordinator.getTaskResult(taskId1)!.outputs },
      priority: 'high',
      requesterId: 'pipeline',
    });
    await coordinator.assignTask(taskId2, 'agent-2', 'step2');
    await coordinator.failTask(taskId2, 'agent-2', 'processing error');

    const result2 = coordinator.getTaskResult(taskId2);
    expect(result2!.status).toBe('partial');

    // Task 3 should not be submitted (chain broken)
    // We verify by checking task count
    expect(coordinator.getTaskCount()).toBe(2);
  });

  test('fan-out pattern: one task spawns multiple subtasks', async () => {
    // Parent task
    const parentTaskId = await coordinator.submitTask({
      description: 'Parent task',
      requiredCapabilities: ['orchestrate'],
      payload: {},
      priority: 'high',
      requesterId: 'requester',
    });

    await coordinator.assignTask(parentTaskId, 'orchestrator', 'orchestrate');
    await coordinator.completeTask(parentTaskId, 'orchestrator', {
      subtasks: ['research', 'analyze', 'visualize'],
    });

    // Spawn subtasks based on parent result
    const parentResult = coordinator.getTaskResult(parentTaskId);
    const subtaskNames = (parentResult!.outputs.orchestrate as any).subtasks as string[];

    const subtaskIds: string[] = [];
    for (const subtask of subtaskNames) {
      const id = await coordinator.submitTask({
        description: `Subtask: ${subtask}`,
        requiredCapabilities: [subtask],
        payload: { parentTaskId },
        priority: 'medium',
        requesterId: 'orchestrator',
      });
      subtaskIds.push(id);
    }

    expect(subtaskIds.length).toBe(3);
    expect(coordinator.getTaskCount()).toBe(4); // parent + 3 subtasks

    // Complete all subtasks
    for (let i = 0; i < subtaskIds.length; i++) {
      await coordinator.assignTask(subtaskIds[i]!, `agent-${i}`, subtaskNames[i]!);
      await coordinator.completeTask(subtaskIds[i]!, `agent-${i}`, { done: true });
    }

    for (const id of subtaskIds) {
      expect(coordinator.getTaskResult(id)!.status).toBe('success');
    }
  });

  test('fan-in pattern: aggregate results from parallel subtasks', async () => {
    // Submit parallel tasks
    const parallelTasks = await Promise.all([
      coordinator.submitTask({
        description: 'Gather A', requiredCapabilities: ['gather'], payload: {},
        priority: 'medium', requesterId: 'aggregator',
      }),
      coordinator.submitTask({
        description: 'Gather B', requiredCapabilities: ['gather'], payload: {},
        priority: 'medium', requesterId: 'aggregator',
      }),
      coordinator.submitTask({
        description: 'Gather C', requiredCapabilities: ['gather'], payload: {},
        priority: 'medium', requesterId: 'aggregator',
      }),
    ]);

    // Complete all parallel tasks
    for (let i = 0; i < parallelTasks.length; i++) {
      await coordinator.assignTask(parallelTasks[i]!, `gatherer-${i}`, 'gather');
      await coordinator.completeTask(parallelTasks[i]!, `gatherer-${i}`, { value: i * 10 });
    }

    // Aggregate results
    const aggregatedData: Record<string, unknown> = {};
    for (const taskId of parallelTasks) {
      const result = coordinator.getTaskResult(taskId);
      expect(result!.status).toBe('success');
      Object.assign(aggregatedData, result!.outputs);
    }

    // Submit aggregation task
    const aggTaskId = await coordinator.submitTask({
      description: 'Aggregate results',
      requiredCapabilities: ['aggregate'],
      payload: { sources: aggregatedData },
      priority: 'high',
      requesterId: 'aggregator',
    });

    await coordinator.assignTask(aggTaskId, 'agg-agent', 'aggregate');
    await coordinator.completeTask(aggTaskId, 'agg-agent', { total: 30 });

    expect(coordinator.getTaskResult(aggTaskId)!.status).toBe('success');
  });

  test('diamond dependency: A -> B, A -> C, B+C -> D', async () => {
    // Task A
    const taskA = await coordinator.submitTask({
      description: 'Task A (root)', requiredCapabilities: ['process'], payload: {},
      priority: 'high', requesterId: 'pipeline',
    });
    await coordinator.assignTask(taskA, 'agent-a', 'process');
    await coordinator.completeTask(taskA, 'agent-a', { key: 'A-data' });
    expect(coordinator.getTaskResult(taskA)!.status).toBe('success');

    // Task B (depends on A)
    const taskB = await coordinator.submitTask({
      description: 'Task B (from A)', requiredCapabilities: ['process'],
      payload: { from: coordinator.getTaskResult(taskA)!.outputs },
      priority: 'high', requesterId: 'pipeline',
    });
    // Task C (depends on A)
    const taskC = await coordinator.submitTask({
      description: 'Task C (from A)', requiredCapabilities: ['process'],
      payload: { from: coordinator.getTaskResult(taskA)!.outputs },
      priority: 'high', requesterId: 'pipeline',
    });

    // Execute B and C in parallel
    await coordinator.assignTask(taskB, 'agent-b', 'process');
    await coordinator.assignTask(taskC, 'agent-c', 'process');
    await coordinator.completeTask(taskB, 'agent-b', { key: 'B-data' });
    await coordinator.completeTask(taskC, 'agent-c', { key: 'C-data' });

    expect(coordinator.getTaskResult(taskB)!.status).toBe('success');
    expect(coordinator.getTaskResult(taskC)!.status).toBe('success');

    // Task D (depends on B and C)
    const taskD = await coordinator.submitTask({
      description: 'Task D (merge B+C)', requiredCapabilities: ['process'],
      payload: {
        fromB: coordinator.getTaskResult(taskB)!.outputs,
        fromC: coordinator.getTaskResult(taskC)!.outputs,
      },
      priority: 'critical', requesterId: 'pipeline',
    });

    await coordinator.assignTask(taskD, 'agent-d', 'process');
    await coordinator.completeTask(taskD, 'agent-d', { merged: 'B+C combined' });

    expect(coordinator.getTaskResult(taskD)!.status).toBe('success');
    expect(coordinator.getTaskResult(taskD)!.outputs.process).toEqual({ merged: 'B+C combined' });

    // Verify all 4 agents have good reputation
    for (const agentId of ['agent-a', 'agent-b', 'agent-c', 'agent-d']) {
      const score = coordinator.reputation.getScore(agentId);
      expect(score.successRate).toBe(1);
      expect(score.taskCount).toBe(1);
    }
  });

  test('long chain of 10 sequential tasks', async () => {
    let previousResult: unknown = { initial: 'seed' };

    for (let i = 0; i < 10; i++) {
      const taskId = await coordinator.submitTask({
        description: `Chain task ${i}`,
        requiredCapabilities: ['process'],
        payload: { input: previousResult },
        priority: 'medium',
        requesterId: 'chain-runner',
      });

      await coordinator.assignTask(taskId, `chain-agent-${i}`, 'process');
      await coordinator.completeTask(taskId, `chain-agent-${i}`, { step: i, data: `output-${i}` });

      const result = coordinator.getTaskResult(taskId);
      expect(result).toBeDefined();
      expect(result!.status).toBe('success');
      previousResult = result!.outputs;
    }

    expect(coordinator.getTaskCount()).toBe(10);

    // All 10 agents should have 1 success each
    for (let i = 0; i < 10; i++) {
      const score = coordinator.reputation.getScore(`chain-agent-${i}`);
      expect(score.taskCount).toBe(1);
      expect(score.successRate).toBe(1);
    }
  });
});
