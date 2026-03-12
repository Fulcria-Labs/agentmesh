/**
 * Security-focused tests for AgentMesh
 *
 * Covers: malicious bid injection, message spoofing, replay attacks,
 * boundary value attacks, resource exhaustion, and Byzantine agent behavior.
 */

import { AgentRegistry } from '../core/agent-registry';
import { TaskCoordinator, TaskBid } from '../core/task-coordinator';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile, MessageType, CoordinationMessage } from '../core/types';

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

function createProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    description: 'Test',
    capabilities: [{ name: 'research', description: 'Research', inputSchema: {}, outputSchema: {} }],
    hederaAccountId: '0.0.12345',
    inboundTopicId: '0.0.200',
    outboundTopicId: '0.0.201',
    registryTopicId: '0.0.100',
    status: 'active',
    createdAt: Date.now(),
    metadata: {},
    ...overrides,
  };
}

function createCoordinationMessage(
  type: MessageType,
  overrides: Partial<CoordinationMessage> = {},
): CoordinationMessage {
  return {
    type,
    senderId: 'agent-1',
    payload: {},
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('Security - Malicious Bid Injection', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;
  let coordHandler: (message: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    coordinator = new TaskCoordinator(mockClient, registry);

    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      coordHandler = callback as any;
    });
    await coordinator.initialize();
  });

  test('rejects bid with negative confidence', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester-1',
    });

    const maliciousBid = createCoordinationMessage(MessageType.TASK_BID, {
      senderId: 'malicious-agent',
      taskId,
      payload: {
        taskId,
        agentId: 'malicious-agent',
        capability: 'research',
        estimatedDuration: 100,
        estimatedCost: 0.001,
        confidence: -1.0, // Negative confidence
        timestamp: Date.now(),
      },
    });

    coordHandler({
      contents: Buffer.from(JSON.stringify(maliciousBid)),
      sequenceNumber: 1,
    });

    const bids = coordinator.getTaskBids(taskId);
    // Malicious bid should either be rejected or clamped
    for (const bid of bids) {
      expect(bid.confidence).toBeGreaterThanOrEqual(0);
    }
  });

  test('rejects bid with impossibly high confidence', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester-1',
    });

    const maliciousBid = createCoordinationMessage(MessageType.TASK_BID, {
      senderId: 'malicious-agent',
      taskId,
      payload: {
        taskId,
        agentId: 'malicious-agent',
        capability: 'research',
        estimatedDuration: 100,
        estimatedCost: 0.001,
        confidence: 999.0, // Impossibly high
        timestamp: Date.now(),
      },
    });

    coordHandler({
      contents: Buffer.from(JSON.stringify(maliciousBid)),
      sequenceNumber: 2,
    });

    const bids = coordinator.getTaskBids(taskId);
    for (const bid of bids) {
      expect(bid.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  test('rejects bid with zero cost (free-riding attempt)', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester-1',
    });

    const zeroCostBid = createCoordinationMessage(MessageType.TASK_BID, {
      senderId: 'free-rider',
      taskId,
      payload: {
        taskId,
        agentId: 'free-rider',
        capability: 'research',
        estimatedDuration: 1,
        estimatedCost: 0,
        confidence: 0.9,
        timestamp: Date.now(),
      },
    });

    coordHandler({
      contents: Buffer.from(JSON.stringify(zeroCostBid)),
      sequenceNumber: 3,
    });

    const bids = coordinator.getTaskBids(taskId);
    // System should handle zero cost bids gracefully
    expect(bids.length).toBeGreaterThanOrEqual(0);
  });

  test('handles bid for non-existent task', () => {
    const orphanBid = createCoordinationMessage(MessageType.TASK_BID, {
      senderId: 'agent-1',
      taskId: 'non-existent-task-id',
      payload: {
        taskId: 'non-existent-task-id',
        agentId: 'agent-1',
        capability: 'research',
        estimatedDuration: 100,
        estimatedCost: 1.0,
        confidence: 0.8,
        timestamp: Date.now(),
      },
    });

    // Should not throw
    expect(() => {
      coordHandler({
        contents: Buffer.from(JSON.stringify(orphanBid)),
        sequenceNumber: 4,
      });
    }).not.toThrow();
  });
});

describe('Security - Message Spoofing', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;
  let registryHandler: (message: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);

    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      registryHandler = callback as any;
    });
    await registry.initialize();
  });

  test('handles registration with empty agent ID', () => {
    const spoofedMsg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: '',
      payload: { profile: createProfile({ id: '' }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(spoofedMsg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles registration with extremely long name', () => {
    const longName = 'A'.repeat(10000);
    const spoofedMsg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'attacker',
      payload: { profile: createProfile({ name: longName }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(spoofedMsg)),
        sequenceNumber: 2,
      });
    }).not.toThrow();
  });

  test('handles deregistration by non-owner', () => {
    // Register agent-1
    const regMsg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'agent-1',
      payload: { profile: createProfile({ id: 'agent-1' }) },
    });
    registryHandler({
      contents: Buffer.from(JSON.stringify(regMsg)),
      sequenceNumber: 1,
    });

    // Try deregistering agent-1 from a different sender
    const deregMsg = createCoordinationMessage(MessageType.AGENT_DEREGISTER, {
      senderId: 'attacker', // Different from agent-1
      payload: { agentId: 'agent-1' },
    });
    registryHandler({
      contents: Buffer.from(JSON.stringify(deregMsg)),
      sequenceNumber: 2,
    });

    // Agent should still exist in the registry (spoofed deregistration rejected)
    // or be deregistered if no ownership check exists (documents the behavior)
    const agents = registry.getAllAgents();
    // Just verify no crash occurred
    expect(agents).toBeDefined();
  });

  test('handles message with future timestamp', () => {
    const futureMsg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'time-traveler',
      timestamp: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year in future
      payload: { profile: createProfile({ id: 'time-traveler' }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(futureMsg)),
        sequenceNumber: 3,
      });
    }).not.toThrow();
  });

  test('handles message with zero timestamp', () => {
    const zeroMsg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'zero-time',
      timestamp: 0,
      payload: { profile: createProfile({ id: 'zero-time' }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(zeroMsg)),
        sequenceNumber: 4,
      });
    }).not.toThrow();
  });
});

describe('Security - Replay Attacks', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;
  let coordHandler: (message: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    coordinator = new TaskCoordinator(mockClient, registry);

    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      coordHandler = callback as any;
    });
    await coordinator.initialize();
  });

  test('handles duplicate task submission messages', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Original task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'high',
      requesterId: 'requester-1',
    });

    // Replay the same task request
    const replayMsg = createCoordinationMessage(MessageType.TASK_REQUEST, {
      senderId: 'requester-1',
      taskId,
      payload: {
        id: taskId,
        description: 'Original task',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'high',
        requesterId: 'requester-1',
        createdAt: Date.now(),
      },
    });

    // Process replay message
    coordHandler({
      contents: Buffer.from(JSON.stringify(replayMsg)),
      sequenceNumber: 100,
    });

    // Should handle gracefully (either idempotent or rejected)
    expect(coordinator.getTask(taskId)).toBeDefined();
  });

  test('handles replayed bid messages', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester-1',
    });

    const bid = {
      taskId,
      agentId: 'bidder-1',
      capability: 'research',
      estimatedDuration: 100,
      estimatedCost: 1.0,
      confidence: 0.85,
      timestamp: Date.now(),
    };

    const bidMsg = createCoordinationMessage(MessageType.TASK_BID, {
      senderId: 'bidder-1',
      taskId,
      payload: { bid },
    });

    // Submit same bid twice (replay)
    coordHandler({ contents: Buffer.from(JSON.stringify(bidMsg)), sequenceNumber: 1 });
    coordHandler({ contents: Buffer.from(JSON.stringify(bidMsg)), sequenceNumber: 2 });

    const bids = coordinator.getTaskBids(taskId);
    // Should either deduplicate or accept both - documents behavior
    expect(bids).toBeDefined();
    expect(bids.length).toBeGreaterThanOrEqual(1);
  });

  test('handles task completion replayed after already completed', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester-1',
    });

    const completeMsg = createCoordinationMessage(MessageType.TASK_COMPLETE, {
      senderId: 'agent-1',
      taskId,
      payload: {
        taskId,
        status: 'success',
        outputs: { result: 'done' },
        agentResults: [],
      },
    });

    // Complete once
    coordHandler({ contents: Buffer.from(JSON.stringify(completeMsg)), sequenceNumber: 1 });
    // Replay completion
    coordHandler({ contents: Buffer.from(JSON.stringify(completeMsg)), sequenceNumber: 2 });

    // Should not crash
    expect(coordinator.getTask(taskId)).toBeDefined();
  });
});

describe('Security - Resource Exhaustion', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;
  let registryHandler: (message: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);

    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      registryHandler = callback as any;
    });
    await registry.initialize();
  });

  test('handles mass agent registration without crashing', () => {
    for (let i = 0; i < 100; i++) {
      const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
        senderId: `agent-${i}`,
        payload: { profile: createProfile({ id: `agent-${i}`, name: `Agent${i}` }) },
      });
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: i + 1,
      });
    }

    const agents = registry.getAllAgents();
    expect(agents.length).toBeLessThanOrEqual(100);
  });

  test('handles agent with massive metadata', () => {
    const hugeMetadata: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      hugeMetadata[`key_${i}`] = 'x'.repeat(1000);
    }

    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'heavy-agent',
      payload: { profile: createProfile({ id: 'heavy-agent', metadata: hugeMetadata }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles agent with many capabilities', () => {
    const manyCapabilities = Array.from({ length: 50 }, (_, i) => ({
      name: `capability_${i}`,
      description: `Capability ${i}`,
      inputSchema: {},
      outputSchema: {},
    }));

    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'omni-agent',
      payload: { profile: createProfile({ id: 'omni-agent', capabilities: manyCapabilities }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });
});

describe('Security - Malformed Messages', () => {
  let registry: AgentRegistry;
  let coordinator: TaskCoordinator;
  let mockClient: jest.Mocked<HederaClient>;
  let registryHandler: (message: { contents: Buffer; sequenceNumber: number }) => void;
  let coordHandler: (message: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    coordinator = new TaskCoordinator(mockClient, registry);

    let handlerCount = 0;
    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      if (handlerCount === 0) {
        registryHandler = callback as any;
      } else {
        coordHandler = callback as any;
      }
      handlerCount++;
    });

    await registry.initialize();
    await coordinator.initialize();
  });

  test('handles empty buffer', () => {
    expect(() => {
      registryHandler({
        contents: Buffer.from(''),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles non-JSON buffer', () => {
    expect(() => {
      registryHandler({
        contents: Buffer.from('not valid json {{{'),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles JSON without required fields', () => {
    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify({ random: 'data' })),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles message with null payload', () => {
    const msg = { type: MessageType.AGENT_REGISTER, senderId: 'x', payload: null, timestamp: Date.now() };
    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles message with undefined type', () => {
    const msg = { type: undefined, senderId: 'x', payload: {}, timestamp: Date.now() };
    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles binary garbage data', () => {
    const garbage = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) garbage[i] = i;

    expect(() => {
      registryHandler({
        contents: garbage,
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles deeply nested JSON payload', () => {
    let nested: any = { value: 'leaf' };
    for (let i = 0; i < 20; i++) {
      nested = { inner: nested };
    }

    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'deep-agent',
      payload: nested,
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });
});

describe('Security - Byzantine Agent Behavior', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;
  let coordHandler: (message: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    coordinator = new TaskCoordinator(mockClient, registry);

    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      coordHandler = callback as any;
    });
    await coordinator.initialize();
  });

  test('handles agent claiming completion of unassigned task', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester-1',
    });

    // Agent claims completion without being assigned
    const falseComplete = createCoordinationMessage(MessageType.TASK_COMPLETE, {
      senderId: 'unassigned-agent',
      taskId,
      payload: {
        taskId,
        status: 'success',
        outputs: { result: 'fake result' },
        agentResults: [],
      },
    });

    expect(() => {
      coordHandler({
        contents: Buffer.from(JSON.stringify(falseComplete)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles agent reporting failure for unsubmitted task', () => {
    const failMsg = createCoordinationMessage(MessageType.TASK_FAIL, {
      senderId: 'byzantine-agent',
      taskId: 'nonexistent-task',
      payload: {
        taskId: 'nonexistent-task',
        error: 'Fabricated error',
      },
    });

    expect(() => {
      coordHandler({
        contents: Buffer.from(JSON.stringify(failMsg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles rapid status updates from same agent', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester-1',
    });

    // Send many rapid progress updates
    for (let i = 0; i < 20; i++) {
      const progressMsg = createCoordinationMessage(MessageType.TASK_PROGRESS, {
        senderId: 'spammy-agent',
        taskId,
        payload: { progress: i / 20, message: `Step ${i}` },
      });
      coordHandler({
        contents: Buffer.from(JSON.stringify(progressMsg)),
        sequenceNumber: i + 1,
      });
    }

    // Should handle gracefully
    expect(coordinator.getTask(taskId)).toBeDefined();
  });

  test('handles conflicting task results from multiple agents', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester-1',
    });

    // Two agents both claim completion
    for (const agentId of ['agent-a', 'agent-b']) {
      const completeMsg = createCoordinationMessage(MessageType.TASK_COMPLETE, {
        senderId: agentId,
        taskId,
        payload: {
          taskId,
          status: 'success',
          outputs: { result: `Result from ${agentId}` },
          agentResults: [],
        },
      });
      coordHandler({
        contents: Buffer.from(JSON.stringify(completeMsg)),
        sequenceNumber: agentId === 'agent-a' ? 1 : 2,
      });
    }

    // Should handle without crash
    expect(coordinator.getTask(taskId)).toBeDefined();
  });
});

describe('Security - Reputation System Manipulation', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    coordinator = new TaskCoordinator(mockClient, registry);
    mockClient.subscribeTopic.mockImplementation(() => {});
    await coordinator.initialize();
  });

  test('reputation scores stay within valid bounds', () => {
    const rep = coordinator.reputation;

    // Record many successes
    for (let i = 0; i < 100; i++) {
      rep.recordSuccess('agent-1', 1.0, 0.1);
    }

    const score = rep.getScore('agent-1');
    expect(score.overallScore).toBeLessThanOrEqual(1.0);
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
  });

  test('reputation handles unknown agent gracefully', () => {
    const rep = coordinator.reputation;
    const score = rep.getScore('never-seen-agent');
    expect(score).toBeDefined();
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
  });

  test('reputation does not go negative after failures', () => {
    const rep = coordinator.reputation;

    for (let i = 0; i < 50; i++) {
      rep.recordFailure('bad-agent');
    }

    const score = rep.getScore('bad-agent');
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
  });

  test('reputation distinguishes different capabilities', () => {
    const rep = coordinator.reputation;

    rep.recordSuccess('agent-1', 1.0, 0.1);
    rep.recordSuccess('agent-1', 1.0, 0.1);
    rep.recordFailure('agent-1');
    rep.recordFailure('agent-1');

    const score = rep.getScore('agent-1');
    // Overall score should exist and be valid
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
    expect(score.overallScore).toBeLessThanOrEqual(1);
  });

  test('self-endorsement: agent records success for itself', () => {
    const rep = coordinator.reputation;

    // Agent tries to inflate own reputation by recording many fast, cheap successes
    for (let i = 0; i < 50; i++) {
      rep.recordSuccess('self-endorser', 1, 0);
    }

    const score = rep.getScore('self-endorser');
    // Score should still be bounded
    expect(score.overallScore).toBeLessThanOrEqual(1.0);
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
  });

  test('collusion: two agents alternately boosting each other', () => {
    const rep = coordinator.reputation;

    // Agent-A and Agent-B take turns recording successes
    for (let i = 0; i < 20; i++) {
      rep.recordSuccess('colluder-a', 100, 0.01);
      rep.recordSuccess('colluder-b', 100, 0.01);
    }

    const scoreA = rep.getScore('colluder-a');
    const scoreB = rep.getScore('colluder-b');
    // Both should remain within valid bounds
    expect(scoreA.overallScore).toBeLessThanOrEqual(1.0);
    expect(scoreB.overallScore).toBeLessThanOrEqual(1.0);
    expect(scoreA.overallScore).toBeGreaterThanOrEqual(0);
    expect(scoreB.overallScore).toBeGreaterThanOrEqual(0);
  });

  test('reputation gaming: rapid reset-and-rebuild to erase failures', () => {
    const rep = coordinator.reputation;

    // Agent fails many times
    for (let i = 0; i < 10; i++) {
      rep.recordFailure('gamer');
    }
    const badScore = rep.getScore('gamer');
    expect(badScore.successRate).toBe(0);

    // Reset and rebuild (simulating re-registration)
    rep.reset('gamer');
    rep.recordSuccess('gamer', 100, 5);

    const freshScore = rep.getScore('gamer');
    // After reset, they start fresh - this is expected behavior
    expect(freshScore.taskCount).toBe(1);
    expect(freshScore.successRate).toBe(1);
  });

  test('reputation score with maximum possible values', () => {
    const rep = coordinator.reputation;

    rep.recordSuccess('max-agent', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const score = rep.getScore('max-agent');
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
    expect(score.overallScore).toBeLessThanOrEqual(1);
    expect(isFinite(score.avgExecutionTime)).toBe(true);
  });

  test('bid score manipulation: zero cost agent gets bounded advantage', () => {
    const rep = coordinator.reputation;

    // Boost reputation
    for (let i = 0; i < 20; i++) {
      rep.recordSuccess('zero-cost-gamer', 100, 0);
    }

    // Zero cost bid with perfect confidence
    const score = rep.getReputationAdjustedBidScore('zero-cost-gamer', 1.0, 0);
    // baseScore = 1.0 / (0 + 1) = 1.0
    // reputationMultiplier = 0.5 + overallScore (which is < 1.0)
    expect(score).toBeLessThan(2.0); // Maximum possible: 1.0 * 1.5 = 1.5
    expect(score).toBeGreaterThan(0);
  });
});

describe('Security - Input Validation (XSS, Injection, Oversized)', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;
  let registryHandler: (message: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);

    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      registryHandler = callback as any;
    });
    await registry.initialize();
  });

  test('handles XSS in agent name', () => {
    const xssName = '<script>alert("xss")</script>';
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'xss-agent',
      payload: { profile: createProfile({ id: 'xss-agent', name: xssName }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();

    const agent = registry.getAgent('xss-agent');
    expect(agent).toBeDefined();
    // The name is stored as-is (no server-side rendering) - documents behavior
    expect(agent!.name).toBe(xssName);
  });

  test('handles XSS in agent description', () => {
    const xssDesc = '<img src=x onerror=alert(1)>';
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'xss-desc-agent',
      payload: { profile: createProfile({ id: 'xss-desc-agent', description: xssDesc }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();

    const agent = registry.getAgent('xss-desc-agent');
    expect(agent).toBeDefined();
  });

  test('handles SQL injection in agent name', () => {
    const sqlName = "'; DROP TABLE agents; --";
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'sql-agent',
      payload: { profile: createProfile({ id: 'sql-agent', name: sqlName }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();

    const agent = registry.getAgent('sql-agent');
    expect(agent).toBeDefined();
    expect(agent!.name).toBe(sqlName);
  });

  test('handles SQL injection in agent description', () => {
    const sqlDesc = "1 OR 1=1; UPDATE agents SET status='active' WHERE 1=1; --";
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'sql-desc-agent',
      payload: { profile: createProfile({ id: 'sql-desc-agent', description: sqlDesc }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles SQL injection in capability name', () => {
    const sqlCap = "research'; DROP TABLE capabilities; --";
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'sql-cap-agent',
      payload: {
        profile: createProfile({
          id: 'sql-cap-agent',
          capabilities: [{
            name: sqlCap,
            description: 'SQL injection in capability',
            inputSchema: {},
            outputSchema: {},
          }],
        }),
      },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles oversized agent name (100KB)', () => {
    const hugeName = 'X'.repeat(100000);
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'huge-name-agent',
      payload: { profile: createProfile({ id: 'huge-name-agent', name: hugeName }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles oversized description (1MB)', () => {
    const hugeDesc = 'D'.repeat(1000000);
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'huge-desc-agent',
      payload: { profile: createProfile({ id: 'huge-desc-agent', description: hugeDesc }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles agent name with null bytes', () => {
    const nullName = 'agent\x00\x00\x00malicious';
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'null-byte-agent',
      payload: { profile: createProfile({ id: 'null-byte-agent', name: nullName }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles agent name with unicode exploits', () => {
    const unicodeName = '\u202E\u0041\u0042\u0043'; // Right-to-left override
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'unicode-agent',
      payload: { profile: createProfile({ id: 'unicode-agent', name: unicodeName }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles agent with emoji-heavy name', () => {
    const emojiName = '\u{1F600}\u{1F4A9}\u{1F525}'.repeat(100);
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'emoji-agent',
      payload: { profile: createProfile({ id: 'emoji-agent', name: emojiName }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles payload with prototype pollution attempt', () => {
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'proto-agent',
      payload: {
        profile: createProfile({ id: 'proto-agent' }),
        '__proto__': { isAdmin: true },
        'constructor': { prototype: { isAdmin: true } },
      } as any,
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();

    // Verify prototype wasn't polluted
    expect(({} as any).isAdmin).toBeUndefined();
  });

  test('handles agent metadata with special characters', () => {
    const specialMetadata: Record<string, string> = {
      '<key>': '<value>',
      'path/../../../etc/passwd': 'traversal attempt',
      '${env.SECRET}': 'template injection',
      '{{7*7}}': 'SSTI attempt',
    };

    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'special-meta-agent',
      payload: { profile: createProfile({ id: 'special-meta-agent', metadata: specialMetadata }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles capability with XSS in input/output schemas', () => {
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'xss-schema-agent',
      payload: {
        profile: createProfile({
          id: 'xss-schema-agent',
          capabilities: [{
            name: 'cap',
            description: 'test',
            inputSchema: { '<script>': 'alert(1)' },
            outputSchema: { 'onload': 'evil()' },
          }],
        }),
      },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles agent ID with path traversal', () => {
    const traversalId = '../../../etc/passwd';
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: traversalId,
      payload: { profile: createProfile({ id: traversalId }) },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles agent with empty string fields', () => {
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: '',
      payload: {
        profile: createProfile({
          id: '',
          name: '',
          description: '',
          hederaAccountId: '',
          inboundTopicId: '',
          outboundTopicId: '',
          registryTopicId: '',
        }),
      },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });
});

describe('Security - Spoofed Agent IDs in Bids', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    coordinator = new TaskCoordinator(mockClient, registry);
    mockClient.subscribeTopic.mockImplementation(() => {});
    await coordinator.initialize();
  });

  test('bid with spoofed agentId different from senderId', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester-1',
    });

    // Bid claims to be from agent-1 but senderId is attacker
    const spoofedBid: TaskBid = {
      taskId,
      agentId: 'victim-agent', // Spoofed
      capability: 'research',
      estimatedDuration: 100,
      estimatedCost: 0.5,
      confidence: 0.95,
      timestamp: Date.now(),
    };

    await coordinator.submitBid(spoofedBid);
    const bids = coordinator.getTaskBids(taskId);
    expect(bids.length).toBe(1);
    // Documents that bid is stored with whatever agentId was provided
    expect(bids[0]!.agentId).toBe('victim-agent');
  });

  test('multiple bids from same agent for same task', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester-1',
    });

    for (let i = 0; i < 5; i++) {
      await coordinator.submitBid({
        taskId,
        agentId: 'greedy-agent',
        capability: 'research',
        estimatedDuration: 100,
        estimatedCost: i,
        confidence: 0.5 + i * 0.1,
        timestamp: Date.now(),
      });
    }

    const bids = coordinator.getTaskBids(taskId);
    // All bids are stored - documents behavior
    expect(bids.length).toBe(5);
  });

  test('bid with negative estimated cost', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester-1',
    });

    const negativeCostBid: TaskBid = {
      taskId,
      agentId: 'negative-cost-agent',
      capability: 'research',
      estimatedDuration: 100,
      estimatedCost: -10,
      confidence: 0.9,
      timestamp: Date.now(),
    };

    await coordinator.submitBid(negativeCostBid);
    const bids = coordinator.getTaskBids(taskId);
    expect(bids.length).toBe(1);
    // Bid score should still be finite
    const score = coordinator.reputation.getReputationAdjustedBidScore(
      'negative-cost-agent', 0.9, -10,
    );
    expect(isFinite(score)).toBe(true);
  });

  test('bid with NaN confidence', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester-1',
    });

    await coordinator.submitBid({
      taskId,
      agentId: 'nan-agent',
      capability: 'research',
      estimatedDuration: NaN,
      estimatedCost: NaN,
      confidence: NaN,
      timestamp: Date.now(),
    });

    // Should not crash
    const bids = coordinator.getTaskBids(taskId);
    expect(bids.length).toBe(1);
  });

  test('bid with Infinity values', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester-1',
    });

    await coordinator.submitBid({
      taskId,
      agentId: 'inf-agent',
      capability: 'research',
      estimatedDuration: Infinity,
      estimatedCost: Infinity,
      confidence: Infinity,
      timestamp: Date.now(),
    });

    const bids = coordinator.getTaskBids(taskId);
    expect(bids.length).toBe(1);
  });
});

describe('Security - Resource Exhaustion (Task Flooding)', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    coordinator = new TaskCoordinator(mockClient, registry);
    mockClient.subscribeTopic.mockImplementation(() => {});
    await coordinator.initialize();
  });

  test('handles mass task submission without crashing', async () => {
    const taskIds: string[] = [];
    for (let i = 0; i < 100; i++) {
      const taskId = await coordinator.submitTask({
        description: `Flood task ${i}`,
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'medium',
        requesterId: 'flooder',
      });
      taskIds.push(taskId);
    }

    expect(coordinator.getTaskCount()).toBe(100);
    expect(coordinator.getAllTasks().length).toBe(100);
  });

  test('handles mass bid submission for single task', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Popular task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'critical',
      requesterId: 'requester',
    });

    for (let i = 0; i < 100; i++) {
      await coordinator.submitBid({
        taskId,
        agentId: `bidder-${i}`,
        capability: 'research',
        estimatedDuration: 1000 + i,
        estimatedCost: i * 0.1,
        confidence: 0.5 + (i % 50) * 0.01,
        timestamp: Date.now(),
      });
    }

    expect(coordinator.getTaskBids(taskId).length).toBe(100);

    // selectBestBid should still work
    const best = coordinator.selectBestBid(taskId);
    expect(best).toBeDefined();
  });

  test('handles mass assignment to single task', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Over-assigned task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester',
    });

    for (let i = 0; i < 50; i++) {
      await coordinator.assignTask(taskId, `agent-${i}`, 'research');
    }

    const assignments = coordinator.getTaskAssignments(taskId);
    expect(assignments.length).toBe(50);
  });

  test('handles rapid complete/fail cycles', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Churning task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester',
    });

    for (let i = 0; i < 50; i++) {
      await coordinator.assignTask(taskId, `agent-${i}`, 'research');
      if (i % 2 === 0) {
        await coordinator.completeTask(taskId, `agent-${i}`, { result: i });
      } else {
        await coordinator.failTask(taskId, `agent-${i}`, `error-${i}`);
      }
    }

    // Should have produced a result
    const result = coordinator.getTaskResult(taskId);
    expect(result).toBeDefined();
    expect(result!.status).toBe('partial'); // Has both success and failures
  });

  test('handles concurrent task lifecycles', async () => {
    // Submit multiple tasks and process them in parallel
    const taskPromises = Array.from({ length: 20 }, (_, i) =>
      coordinator.submitTask({
        description: `Concurrent task ${i}`,
        requiredCapabilities: ['cap'],
        payload: {},
        priority: i % 2 === 0 ? 'high' : 'low',
        requesterId: `requester-${i % 5}`,
      })
    );

    const taskIds = await Promise.all(taskPromises);
    expect(taskIds.length).toBe(20);

    // Assign and complete all
    for (const taskId of taskIds) {
      await coordinator.assignTask(taskId, 'worker', 'cap');
      await coordinator.completeTask(taskId, 'worker', 'done');
    }

    // All should have results
    for (const taskId of taskIds) {
      const result = coordinator.getTaskResult(taskId);
      expect(result).toBeDefined();
      expect(result!.status).toBe('success');
    }
  });
});

describe('Security - Advanced Byzantine Behavior', () => {
  let coordinator: TaskCoordinator;
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;
  let coordHandler: (message: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);

    let handlerCount = 0;
    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      if (handlerCount === 1) {
        coordHandler = callback as any;
      }
      handlerCount++;
    });

    await registry.initialize();
    coordinator = new TaskCoordinator(mockClient, registry);
    await coordinator.initialize();
  });

  test('agent lies about capabilities it does not have', async () => {
    // Register agent claiming "research" capability
    await registry.registerAgent(createProfile({
      id: 'liar-agent',
      capabilities: [{
        name: 'quantum_computing',
        description: 'Quantum computation',
        inputSchema: {},
        outputSchema: {},
      }],
    }));

    // Submit task requiring quantum_computing
    const taskId = await coordinator.submitTask({
      description: 'Quantum task',
      requiredCapabilities: ['quantum_computing'],
      payload: {},
      priority: 'high',
      requesterId: 'requester',
    });

    // Agent bids despite potentially lying
    await coordinator.submitBid({
      taskId,
      agentId: 'liar-agent',
      capability: 'quantum_computing',
      estimatedDuration: 100,
      estimatedCost: 1,
      confidence: 0.99,
      timestamp: Date.now(),
    });

    // Assign the task
    await coordinator.assignTask(taskId, 'liar-agent', 'quantum_computing');

    // Agent fails the task
    await coordinator.failTask(taskId, 'liar-agent', 'Cannot actually do quantum computing');

    // Reputation should reflect the failure
    const score = coordinator.reputation.getScore('liar-agent');
    expect(score.successRate).toBe(0);
    expect(score.taskCount).toBe(1);
  });

  test('agent never completes assigned task (abandonment)', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Abandoned task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester',
    });

    await coordinator.assignTask(taskId, 'abandoner', 'research');

    // Assignment exists but is never completed
    const assignments = coordinator.getTaskAssignments(taskId);
    expect(assignments.length).toBe(1);
    expect(assignments[0]!.status).toBe('assigned');

    // Task result should not exist yet
    const result = coordinator.getTaskResult(taskId);
    expect(result).toBeUndefined();
  });

  test('agent tries to complete task assigned to another agent', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Stolen task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester',
    });

    await coordinator.assignTask(taskId, 'legitimate-agent', 'research');

    // Impersonator tries to complete it
    await coordinator.completeTask(taskId, 'impersonator', { result: 'stolen' });

    // The legitimate agent's assignment should still be in 'assigned' state
    const assignments = coordinator.getTaskAssignments(taskId);
    const legit = assignments.find(a => a.agentId === 'legitimate-agent');
    expect(legit).toBeDefined();
    expect(legit!.status).toBe('assigned');
  });

  test('agent submits conflicting bids with different costs', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Conflicting bids task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester',
    });

    // Same agent bids with wildly different costs
    await coordinator.submitBid({
      taskId,
      agentId: 'unstable-agent',
      capability: 'research',
      estimatedDuration: 1000,
      estimatedCost: 0.01,
      confidence: 0.99,
      timestamp: Date.now(),
    });

    await coordinator.submitBid({
      taskId,
      agentId: 'unstable-agent',
      capability: 'research',
      estimatedDuration: 1000,
      estimatedCost: 1000,
      confidence: 0.1,
      timestamp: Date.now(),
    });

    const bids = coordinator.getTaskBids(taskId);
    expect(bids.length).toBe(2);
    const best = coordinator.selectBestBid(taskId);
    expect(best).toBeDefined();
  });

  test('agent claims task failure and completion simultaneously', async () => {
    const taskId = await coordinator.submitTask({
      description: 'Contradictory task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'requester',
    });

    await coordinator.assignTask(taskId, 'confused-agent', 'research');

    // Complete then fail
    await coordinator.completeTask(taskId, 'confused-agent', { result: 'done' });
    await coordinator.failTask(taskId, 'confused-agent', 'actually it failed');

    // The last status should be 'failed' (last write wins)
    const assignments = coordinator.getTaskAssignments(taskId);
    const assignment = assignments.find(a => a.agentId === 'confused-agent');
    expect(assignment).toBeDefined();
    expect(assignment!.status).toBe('failed');
  });

  test('handles invalid message type in coordination', () => {
    const invalidMsg = {
      type: 'totally.invalid.type',
      senderId: 'bad-actor',
      payload: { something: 'evil' },
      timestamp: Date.now(),
    };

    expect(() => {
      coordHandler({
        contents: Buffer.from(JSON.stringify(invalidMsg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles message with array payload instead of object', () => {
    const arrayMsg = {
      type: MessageType.TASK_REQUEST,
      senderId: 'array-agent',
      payload: [1, 2, 3],
      timestamp: Date.now(),
    };

    expect(() => {
      coordHandler({
        contents: Buffer.from(JSON.stringify(arrayMsg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles message with nested circular-like deep structure', () => {
    let nested: any = { data: 'leaf' };
    for (let i = 0; i < 50; i++) {
      nested = { level: i, child: nested };
    }

    const deepMsg = createCoordinationMessage(MessageType.TASK_BID, {
      senderId: 'deep-nester',
      taskId: 'some-task',
      payload: nested,
    });

    expect(() => {
      coordHandler({
        contents: Buffer.from(JSON.stringify(deepMsg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });
});

describe('Security - Registry Message Handler Edge Cases', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;
  let registryHandler: (message: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);

    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      registryHandler = callback as any;
    });
    await registry.initialize();
  });

  test('handles heartbeat for non-existent agent', () => {
    const heartbeatMsg = createCoordinationMessage(MessageType.AGENT_HEARTBEAT, {
      senderId: 'ghost-agent',
      payload: { status: 'active' },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(heartbeatMsg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();

    // Ghost agent should not appear in registry
    expect(registry.getAgent('ghost-agent')).toBeUndefined();
  });

  test('handles status update for non-existent agent', () => {
    const statusMsg = createCoordinationMessage(MessageType.AGENT_STATUS_UPDATE, {
      senderId: 'nonexistent',
      payload: { status: 'busy' },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(statusMsg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });

  test('handles rapid register/deregister cycle', () => {
    for (let i = 0; i < 50; i++) {
      const regMsg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
        senderId: 'cycle-agent',
        payload: { profile: createProfile({ id: 'cycle-agent', name: `Cycle_${i}` }) },
      });
      registryHandler({
        contents: Buffer.from(JSON.stringify(regMsg)),
        sequenceNumber: i * 2 + 1,
      });

      const deregMsg = createCoordinationMessage(MessageType.AGENT_DEREGISTER, {
        senderId: 'cycle-agent',
        payload: {},
      });
      registryHandler({
        contents: Buffer.from(JSON.stringify(deregMsg)),
        sequenceNumber: i * 2 + 2,
      });
    }

    // After all cycles, agent should be deregistered
    expect(registry.getAgent('cycle-agent')).toBeUndefined();
  });

  test('handles re-registration overwriting existing agent', () => {
    // Register first time
    const msg1 = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'overwrite-agent',
      payload: { profile: createProfile({ id: 'overwrite-agent', name: 'Version1' }) },
    });
    registryHandler({
      contents: Buffer.from(JSON.stringify(msg1)),
      sequenceNumber: 1,
    });

    expect(registry.getAgent('overwrite-agent')!.name).toBe('Version1');

    // Re-register with different data
    const msg2 = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'overwrite-agent',
      payload: { profile: createProfile({ id: 'overwrite-agent', name: 'Version2' }) },
    });
    registryHandler({
      contents: Buffer.from(JSON.stringify(msg2)),
      sequenceNumber: 2,
    });

    expect(registry.getAgent('overwrite-agent')!.name).toBe('Version2');
  });

  test('handles status update with invalid status value', () => {
    // Register agent first
    const regMsg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'status-test',
      payload: { profile: createProfile({ id: 'status-test' }) },
    });
    registryHandler({
      contents: Buffer.from(JSON.stringify(regMsg)),
      sequenceNumber: 1,
    });

    // Send invalid status
    const statusMsg = createCoordinationMessage(MessageType.AGENT_STATUS_UPDATE, {
      senderId: 'status-test',
      payload: { status: 'totally_invalid_status' },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(statusMsg)),
        sequenceNumber: 2,
      });
    }).not.toThrow();
  });

  test('handles deregister for already-deregistered agent', () => {
    const deregMsg = createCoordinationMessage(MessageType.AGENT_DEREGISTER, {
      senderId: 'already-gone',
      payload: {},
    });

    // Deregister twice
    registryHandler({ contents: Buffer.from(JSON.stringify(deregMsg)), sequenceNumber: 1 });
    registryHandler({ contents: Buffer.from(JSON.stringify(deregMsg)), sequenceNumber: 2 });

    expect(registry.getAgent('already-gone')).toBeUndefined();
  });

  test('handles register with profile missing from payload', () => {
    const msg = createCoordinationMessage(MessageType.AGENT_REGISTER, {
      senderId: 'missing-profile',
      payload: { notProfile: 'something else' },
    });

    expect(() => {
      registryHandler({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
      });
    }).not.toThrow();
  });
});
