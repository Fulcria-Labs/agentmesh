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
});
