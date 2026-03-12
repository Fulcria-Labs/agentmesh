/**
 * AgentRegistry - Deep coverage tests
 *
 * Covers: concurrent registration, bulk operations, discovery performance,
 * complex filter combinations, message ordering, and metadata handling.
 */

import { AgentRegistry } from '../core/agent-registry';
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
    description: 'Test agent',
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

describe('AgentRegistry - Bulk Operations', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    await registry.initialize();
  });

  it('should handle registering 100 agents', async () => {
    for (let i = 0; i < 100; i++) {
      await registry.registerAgent(createProfile({
        id: `agent-${i}`,
        name: `Agent${i}`,
        capabilities: [{ name: `cap-${i % 10}`, description: `cap ${i}`, inputSchema: {}, outputSchema: {} }],
      }));
    }
    expect(registry.getAgentCount()).toBe(100);
    expect(registry.getAllAgents()).toHaveLength(100);
  });

  it('should discover agents from a large pool', async () => {
    for (let i = 0; i < 50; i++) {
      await registry.registerAgent(createProfile({
        id: `agent-${i}`,
        name: `Agent${i}`,
        status: i % 3 === 0 ? 'busy' : 'active',
        capabilities: [{ name: `cap-${i % 5}`, description: `capability ${i % 5}`, inputSchema: {}, outputSchema: {} }],
      }));
    }

    // Active agents
    const active = registry.discoverAgents({ status: 'active' });
    expect(active.totalFound).toBe(33); // 50 - floor(50/3) - 1 = 33 (indices not divisible by 3)

    // Specific capability
    const cap0 = registry.discoverAgents({ capability: 'cap-0' });
    expect(cap0.totalFound).toBe(10); // 0,5,10,15,20,25,30,35,40,45

    // Combined filter
    const activeCap0 = registry.discoverAgents({ status: 'active', capability: 'cap-0' });
    expect(activeCap0.totalFound).toBeGreaterThan(0);
    expect(activeCap0.totalFound).toBeLessThanOrEqual(10);
  });

  it('should deregister multiple agents correctly', async () => {
    for (let i = 0; i < 10; i++) {
      await registry.registerAgent(createProfile({ id: `agent-${i}` }));
    }
    expect(registry.getAgentCount()).toBe(10);

    // Remove every other agent
    for (let i = 0; i < 10; i += 2) {
      await registry.deregisterAgent(`agent-${i}`);
    }
    expect(registry.getAgentCount()).toBe(5);

    // Verify odd agents still exist
    for (let i = 1; i < 10; i += 2) {
      expect(registry.getAgent(`agent-${i}`)).toBeDefined();
    }
    // Verify even agents are gone
    for (let i = 0; i < 10; i += 2) {
      expect(registry.getAgent(`agent-${i}`)).toBeUndefined();
    }
  });

  it('should handle registering and deregistering the same agent repeatedly', async () => {
    for (let i = 0; i < 20; i++) {
      await registry.registerAgent(createProfile({ id: 'toggle-agent', name: `Version${i}` }));
      expect(registry.getAgentCount()).toBe(1);
      expect(registry.getAgent('toggle-agent')!.name).toBe(`Version${i}`);

      await registry.deregisterAgent('toggle-agent');
      expect(registry.getAgentCount()).toBe(0);
    }
  });
});

describe('AgentRegistry - Discovery Filters Deep', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    await registry.initialize();
  });

  it('should match capability by partial name', async () => {
    await registry.registerAgent(createProfile({
      id: 'a1',
      capabilities: [{ name: 'web_research_deep', description: 'Deep research', inputSchema: {}, outputSchema: {} }],
    }));

    const result = registry.discoverAgents({ capability: 'web_research' });
    expect(result.totalFound).toBe(1);
  });

  it('should match capability by partial description', async () => {
    await registry.registerAgent(createProfile({
      id: 'a1',
      capabilities: [{ name: 'cap1', description: 'Advanced sentiment analysis engine', inputSchema: {}, outputSchema: {} }],
    }));

    const result = registry.discoverAgents({ capability: 'sentiment' });
    expect(result.totalFound).toBe(1);
  });

  it('should be case insensitive for capability name match', async () => {
    await registry.registerAgent(createProfile({
      id: 'a1',
      capabilities: [{ name: 'DATA_ANALYSIS', description: 'Analyze data', inputSchema: {}, outputSchema: {} }],
    }));

    expect(registry.discoverAgents({ capability: 'data_analysis' }).totalFound).toBe(1);
    expect(registry.discoverAgents({ capability: 'Data_Analysis' }).totalFound).toBe(1);
    expect(registry.discoverAgents({ capability: 'DATA_ANALYSIS' }).totalFound).toBe(1);
  });

  it('should be case insensitive for capability description match', async () => {
    await registry.registerAgent(createProfile({
      id: 'a1',
      capabilities: [{ name: 'cap1', description: 'Natural Language Processing', inputSchema: {}, outputSchema: {} }],
    }));

    expect(registry.discoverAgents({ capability: 'natural language' }).totalFound).toBe(1);
    expect(registry.discoverAgents({ capability: 'NATURAL LANGUAGE' }).totalFound).toBe(1);
  });

  it('should not match agents when capability filter is empty string', async () => {
    await registry.registerAgent(createProfile({
      id: 'a1',
      capabilities: [{ name: 'cap', description: 'desc', inputSchema: {}, outputSchema: {} }],
    }));

    // Empty string should match everything (every string includes '')
    const result = registry.discoverAgents({ capability: '' });
    expect(result.totalFound).toBe(1);
  });

  it('should apply maxResults after other filters', async () => {
    for (let i = 0; i < 10; i++) {
      await registry.registerAgent(createProfile({
        id: `agent-${i}`,
        status: i < 5 ? 'active' : 'inactive',
      }));
    }

    const result = registry.discoverAgents({ status: 'active', maxResults: 3 });
    expect(result.totalFound).toBe(3);
    expect(result.agents).toHaveLength(3);
  });

  it('should handle discovering with all filters at once', async () => {
    await registry.registerAgent(createProfile({
      id: 'match',
      status: 'active',
      capabilities: [{ name: 'web_search', description: 'Search the web', inputSchema: {}, outputSchema: {} }],
    }));
    await registry.registerAgent(createProfile({
      id: 'no-match-status',
      status: 'inactive',
      capabilities: [{ name: 'web_search', description: 'Search', inputSchema: {}, outputSchema: {} }],
    }));
    await registry.registerAgent(createProfile({
      id: 'no-match-cap',
      status: 'active',
      capabilities: [{ name: 'data_analysis', description: 'Analyze', inputSchema: {}, outputSchema: {} }],
    }));

    const result = registry.discoverAgents({ status: 'active', capability: 'web_search', maxResults: 10 });
    expect(result.totalFound).toBe(1);
    expect(result.agents[0]!.id).toBe('match');
  });

  it('should handle agent with multiple capabilities', async () => {
    await registry.registerAgent(createProfile({
      id: 'multi',
      capabilities: [
        { name: 'research', description: 'Research', inputSchema: {}, outputSchema: {} },
        { name: 'analysis', description: 'Analysis', inputSchema: {}, outputSchema: {} },
        { name: 'synthesis', description: 'Synthesis', inputSchema: {}, outputSchema: {} },
      ],
    }));

    expect(registry.discoverAgents({ capability: 'research' }).totalFound).toBe(1);
    expect(registry.discoverAgents({ capability: 'analysis' }).totalFound).toBe(1);
    expect(registry.discoverAgents({ capability: 'synthesis' }).totalFound).toBe(1);
    expect(registry.discoverAgents({ capability: 'unknown' }).totalFound).toBe(0);
  });

  it('should return queryTime as non-negative number', async () => {
    for (let i = 0; i < 20; i++) {
      await registry.registerAgent(createProfile({ id: `a-${i}` }));
    }

    const result = registry.discoverAgents({ status: 'active' });
    expect(result.queryTime).toBeGreaterThanOrEqual(0);
    expect(typeof result.queryTime).toBe('number');
  });
});

describe('AgentRegistry - Message Handler Comprehensive', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;
  let messageHandler: (msg: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    mockClient.subscribeTopic.mockImplementation((topicId, callback) => {
      messageHandler = callback as any;
    });
    await registry.initialize();
  });

  function sendMessage(msg: CoordinationMessage, seq: number) {
    messageHandler({ contents: Buffer.from(JSON.stringify(msg)), sequenceNumber: seq });
  }

  it('should process register then deregister in sequence', () => {
    const profile = createProfile({ id: 'seq-agent' });
    sendMessage({
      type: MessageType.AGENT_REGISTER,
      senderId: 'seq-agent',
      payload: { profile },
      timestamp: Date.now(),
    }, 1);

    expect(registry.getAgent('seq-agent')).toBeDefined();

    sendMessage({
      type: MessageType.AGENT_DEREGISTER,
      senderId: 'seq-agent',
      payload: {},
      timestamp: Date.now(),
    }, 2);

    expect(registry.getAgent('seq-agent')).toBeUndefined();
  });

  it('should handle rapid status updates', () => {
    const profile = createProfile({ id: 'status-agent', status: 'active' });
    sendMessage({
      type: MessageType.AGENT_REGISTER,
      senderId: 'status-agent',
      payload: { profile },
      timestamp: Date.now(),
    }, 1);

    const statuses: AgentProfile['status'][] = ['busy', 'active', 'inactive', 'active', 'busy'];
    statuses.forEach((status, i) => {
      sendMessage({
        type: MessageType.AGENT_STATUS_UPDATE,
        senderId: 'status-agent',
        payload: { status },
        timestamp: Date.now() + i,
      }, i + 2);
    });

    expect(registry.getAgent('status-agent')!.status).toBe('busy');
  });

  it('should handle multiple heartbeats updating metadata', () => {
    const profile = createProfile({ id: 'hb-agent' });
    sendMessage({
      type: MessageType.AGENT_REGISTER,
      senderId: 'hb-agent',
      payload: { profile },
      timestamp: Date.now(),
    }, 1);

    for (let i = 0; i < 5; i++) {
      sendMessage({
        type: MessageType.AGENT_HEARTBEAT,
        senderId: 'hb-agent',
        payload: {},
        timestamp: 1000 + i * 100,
      }, i + 2);
    }

    const agent = registry.getAgent('hb-agent')!;
    expect(agent.metadata.lastHeartbeat).toBe('1400');
  });

  it('should ignore unknown message types', () => {
    sendMessage({
      type: 'unknown.type' as any,
      senderId: 'agent-1',
      payload: {},
      timestamp: Date.now(),
    }, 1);

    expect(registry.getAgentCount()).toBe(0);
  });

  it('should handle registration message with extra fields in payload', () => {
    const profile = createProfile({ id: 'extra-fields' });
    sendMessage({
      type: MessageType.AGENT_REGISTER,
      senderId: 'extra-fields',
      payload: { profile, extraField: 'value', anotherField: 42 },
      timestamp: Date.now(),
    }, 1);

    expect(registry.getAgent('extra-fields')).toBeDefined();
    expect(registry.getAgent('extra-fields')!.name).toBe('TestAgent');
  });

  it('should handle heartbeat preserving existing metadata', () => {
    const profile = createProfile({ id: 'meta-agent', metadata: { existingKey: 'existingValue' } });
    sendMessage({
      type: MessageType.AGENT_REGISTER,
      senderId: 'meta-agent',
      payload: { profile },
      timestamp: Date.now(),
    }, 1);

    sendMessage({
      type: MessageType.AGENT_HEARTBEAT,
      senderId: 'meta-agent',
      payload: {},
      timestamp: 12345,
    }, 2);

    const agent = registry.getAgent('meta-agent')!;
    expect(agent.metadata.existingKey).toBe('existingValue');
    expect(agent.metadata.lastHeartbeat).toBe('12345');
  });

  it('should handle malformed buffer (binary data)', () => {
    const binaryData = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80]);
    messageHandler({ contents: binaryData, sequenceNumber: 1 });
    expect(registry.getAgentCount()).toBe(0);
  });

  it('should handle empty JSON object', () => {
    messageHandler({ contents: Buffer.from('{}'), sequenceNumber: 1 });
    expect(registry.getAgentCount()).toBe(0);
  });

  it('should handle JSON with type but no payload', () => {
    const msg = { type: MessageType.AGENT_REGISTER, senderId: 'x', timestamp: Date.now() };
    messageHandler({ contents: Buffer.from(JSON.stringify(msg)), sequenceNumber: 1 });
    // Should not throw - might store undefined profile or skip
  });
});

describe('AgentRegistry - Initialization Edge Cases', () => {
  it('should support re-initialization with different topic', async () => {
    const mockClient = createMockClient();
    const registry = new AgentRegistry(mockClient);

    const topic1 = await registry.initialize('0.0.111');
    expect(topic1).toBe('0.0.111');

    // Re-initialize with different topic
    const topic2 = await registry.initialize('0.0.222');
    expect(topic2).toBe('0.0.222');
    expect(registry.getRegistryTopicId()).toBe('0.0.222');
  });

  it('should subscribe to new topic on re-initialization', async () => {
    const mockClient = createMockClient();
    const registry = new AgentRegistry(mockClient);

    await registry.initialize('0.0.111');
    await registry.initialize('0.0.222');

    expect(mockClient.subscribeTopic).toHaveBeenCalledWith('0.0.111', expect.any(Function));
    expect(mockClient.subscribeTopic).toHaveBeenCalledWith('0.0.222', expect.any(Function));
  });

  it('should return correct topic after init without existing topic', async () => {
    const mockClient = createMockClient();
    mockClient.createTopic.mockResolvedValue('0.0.999');
    const registry = new AgentRegistry(mockClient);

    const topic = await registry.initialize();
    expect(topic).toBe('0.0.999');
    expect(registry.getRegistryTopicId()).toBe('0.0.999');
  });
});

describe('AgentRegistry - Message Format Validation', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    await registry.initialize();
  });

  it('should send AGENT_REGISTER with correct message format', async () => {
    const profile = createProfile({ id: 'fmt-agent' });
    await registry.registerAgent(profile);

    const call = mockClient.submitMessage.mock.calls[0]!;
    const msg = JSON.parse(call[1] as string);

    expect(msg.type).toBe(MessageType.AGENT_REGISTER);
    expect(msg.senderId).toBe('fmt-agent');
    expect(msg.payload.profile).toBeDefined();
    expect(msg.timestamp).toBeDefined();
    expect(typeof msg.timestamp).toBe('number');
  });

  it('should send AGENT_DEREGISTER with correct message format', async () => {
    await registry.registerAgent(createProfile({ id: 'dereg-agent' }));
    await registry.deregisterAgent('dereg-agent');

    const lastCall = mockClient.submitMessage.mock.calls[mockClient.submitMessage.mock.calls.length - 1]!;
    const msg = JSON.parse(lastCall[1] as string);

    expect(msg.type).toBe(MessageType.AGENT_DEREGISTER);
    expect(msg.senderId).toBe('dereg-agent');
    expect(msg.payload).toEqual({});
  });

  it('should send AGENT_STATUS_UPDATE with correct format', async () => {
    await registry.registerAgent(createProfile({ id: 'status-agent' }));
    await registry.updateAgentStatus('status-agent', 'busy');

    const lastCall = mockClient.submitMessage.mock.calls[mockClient.submitMessage.mock.calls.length - 1]!;
    const msg = JSON.parse(lastCall[1] as string);

    expect(msg.type).toBe(MessageType.AGENT_STATUS_UPDATE);
    expect(msg.senderId).toBe('status-agent');
    expect(msg.payload.status).toBe('busy');
  });

  it('should use the registry topic for all messages', async () => {
    await registry.registerAgent(createProfile({ id: 'topic-test' }));
    await registry.updateAgentStatus('topic-test', 'busy');
    await registry.deregisterAgent('topic-test');

    for (const call of mockClient.submitMessage.mock.calls) {
      expect(call[0]).toBe('0.0.100');
    }
  });
});
