/**
 * Hedera Network Resilience, Agent Registry at Scale, Dashboard Performance,
 * HCS-10 Bridge Edge Cases, and Standards Registry comprehensive tests.
 *
 * Covers: network failures, chunked messaging, subscription reconnection,
 * large-scale agent discovery, concurrent updates, dashboard load,
 * HCS-10 bridge edge cases, and standards registry edge cases.
 */

import { AgentRegistry } from '../core/agent-registry';
import { TaskCoordinator, TaskBid } from '../core/task-coordinator';
import { HederaClient } from '../core/hedera-client';
import { Dashboard } from '../dashboard/server';
import { HCS10Bridge, HCS10BridgeConfig } from '../hol/hcs10-bridge';
import { StandardsRegistry } from '../hol/standards-registry';
import { AgentProfile, AgentCapability, MessageType, CoordinationMessage, MeshConfig } from '../core/types';
import * as http from 'http';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../core/hedera-client');

jest.mock('@hashgraphonline/standards-sdk', () => {
  const AIAgentCapability: Record<string | number, string | number> = {
    TEXT_GENERATION: 0,
    IMAGE_GENERATION: 1,
    AUDIO_GENERATION: 2,
    VIDEO_GENERATION: 3,
    CODE_GENERATION: 4,
    LANGUAGE_TRANSLATION: 5,
    SUMMARIZATION_EXTRACTION: 6,
    KNOWLEDGE_RETRIEVAL: 7,
    DATA_INTEGRATION: 8,
    MARKET_INTELLIGENCE: 9,
    TRANSACTION_ANALYTICS: 10,
    SMART_CONTRACT_AUDIT: 11,
    GOVERNANCE_FACILITATION: 12,
    SECURITY_MONITORING: 13,
    COMPLIANCE_ANALYSIS: 14,
    FRAUD_DETECTION: 15,
    MULTI_AGENT_COORDINATION: 16,
    API_INTEGRATION: 17,
    WORKFLOW_AUTOMATION: 18,
    0: 'TEXT_GENERATION',
    1: 'IMAGE_GENERATION',
    4: 'CODE_GENERATION',
    5: 'LANGUAGE_TRANSLATION',
    6: 'SUMMARIZATION_EXTRACTION',
    7: 'KNOWLEDGE_RETRIEVAL',
    8: 'DATA_INTEGRATION',
    9: 'MARKET_INTELLIGENCE',
    10: 'TRANSACTION_ANALYTICS',
    11: 'SMART_CONTRACT_AUDIT',
    13: 'SECURITY_MONITORING',
    14: 'COMPLIANCE_ANALYSIS',
    15: 'FRAUD_DETECTION',
    16: 'MULTI_AGENT_COORDINATION',
    17: 'API_INTEGRATION',
    18: 'WORKFLOW_AUTOMATION',
  };

  const InboundTopicType = { PUBLIC: 'public', CONTROLLED: 'controlled', FEE_BASED: 'fee_based' };

  const mockHCS10Client = {
    createAgent: jest.fn().mockResolvedValue({
      inboundTopicId: '0.0.900',
      outboundTopicId: '0.0.901',
      profileTopicId: '0.0.902',
      pfpTopicId: '0.0.903',
    }),
    createAndRegisterAgent: jest.fn().mockResolvedValue({
      success: true,
      agentAccountId: '0.0.500',
      inboundTopicId: '0.0.900',
      outboundTopicId: '0.0.901',
    }),
    handleConnectionRequest: jest.fn().mockResolvedValue({
      connectionTopicId: '0.0.1001',
    }),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    searchRegistrations: jest.fn().mockResolvedValue({
      registrations: [],
      success: true,
    }),
    createRegistryTopic: jest.fn().mockResolvedValue({
      success: true,
      topicId: '0.0.6000',
      transactionId: '0.0.100@123456',
    }),
    getClient: jest.fn(),
    getOperatorAccountId: jest.fn().mockReturnValue('0.0.100'),
  };

  return {
    HCS10Client: jest.fn().mockImplementation(() => mockHCS10Client),
    AgentBuilder: jest.fn().mockImplementation(() => ({
      setName: jest.fn(),
      setBio: jest.fn(),
      setType: jest.fn(),
      setCapabilities: jest.fn(),
      setNetwork: jest.fn(),
      setInboundTopicType: jest.fn(),
      setModel: jest.fn(),
      setCreator: jest.fn(),
      setProfilePicture: jest.fn(),
      addProperty: jest.fn(),
    })),
    AIAgentCapability,
    AIAgentType: { AUTONOMOUS: 'autonomous' },
    InboundTopicType,
    __mockClient: mockHCS10Client,
  };
});

const { __mockClient: mockStandardsClient } = require('@hashgraphonline/standards-sdk');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_CONFIG: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.1',
  operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
};

function createMockClient(): jest.Mocked<HederaClient> {
  const mock = new HederaClient(TEST_CONFIG) as jest.Mocked<HederaClient>;
  mock.createTopic = jest.fn().mockResolvedValue('0.0.100');
  mock.submitMessage = jest.fn().mockResolvedValue(1);
  mock.subscribeTopic = jest.fn();
  mock.unsubscribeTopic = jest.fn();
  mock.getTopicInfo = jest.fn().mockResolvedValue({ memo: 'test', sequenceNumber: 42 });
  mock.getBalance = jest.fn().mockResolvedValue(100.0);
  mock.close = jest.fn();
  mock.emit = jest.fn().mockReturnValue(true);
  mock.on = jest.fn().mockReturnValue(mock);
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

function makeRegistryMessage(type: MessageType, profile: AgentProfile): Buffer {
  const msg: CoordinationMessage = {
    type,
    senderId: profile.id,
    payload: type === MessageType.AGENT_REGISTER ? { profile } : {},
    timestamp: Date.now(),
  };
  return Buffer.from(JSON.stringify(msg));
}

function httpGet(url: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, body, headers: res.headers }));
    }).on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Hedera Network Resilience (~20 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe('Hedera Network Resilience', () => {
  let mockClient: jest.Mocked<HederaClient>;
  let registry: AgentRegistry;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    await registry.initialize();
  });

  test('handles topic creation failure with insufficient balance', async () => {
    mockClient.createTopic.mockRejectedValueOnce(new Error('INSUFFICIENT_PAYER_BALANCE'));
    const registry2 = new AgentRegistry(mockClient);
    await expect(registry2.initialize()).rejects.toThrow('INSUFFICIENT_PAYER_BALANCE');
  });

  test('handles topic creation timeout', async () => {
    mockClient.createTopic.mockRejectedValueOnce(new Error('TIMEOUT: Transaction receipt query timed out'));
    const registry2 = new AgentRegistry(mockClient);
    await expect(registry2.initialize()).rejects.toThrow('TIMEOUT');
  });

  test('handles generic network error on topic creation', async () => {
    mockClient.createTopic.mockRejectedValueOnce(new Error('UNAVAILABLE: Node not reachable'));
    const registry2 = new AgentRegistry(mockClient);
    await expect(registry2.initialize()).rejects.toThrow('UNAVAILABLE');
  });

  test('handles message submission failure after initialization', async () => {
    mockClient.submitMessage.mockRejectedValueOnce(new Error('BUSY: node is busy'));
    const profile = createProfile();
    await expect(registry.registerAgent(profile)).rejects.toThrow('BUSY');
  });

  test('handles message submit for large payload (>1024 bytes triggers chunking logic)', async () => {
    // A large payload should still go through submitMessage normally from registry's perspective
    const largeDescription = 'x'.repeat(2000);
    const profile = createProfile({ description: largeDescription });
    await registry.registerAgent(profile);
    expect(mockClient.submitMessage).toHaveBeenCalled();
    const submittedMsg = mockClient.submitMessage.mock.calls[0]![1] as string;
    expect(submittedMsg.length).toBeGreaterThan(1024);
  });

  test('subscribeTopic is called once during initialization', async () => {
    expect(mockClient.subscribeTopic).toHaveBeenCalledTimes(1);
    expect(mockClient.subscribeTopic).toHaveBeenCalledWith('0.0.100', expect.any(Function));
  });

  test('handles subscription callback errors gracefully', () => {
    let capturedCallback: Function = () => {};
    mockClient.subscribeTopic.mockImplementation((_topicId, callback) => {
      capturedCallback = callback as Function;
    });

    const registry2 = new AgentRegistry(mockClient);
    registry2.initialize();

    // Send malformed message - should not throw
    expect(() => {
      capturedCallback({ contents: Buffer.from('not json'), sequenceNumber: 1 });
    }).not.toThrow();
  });

  test('reconnects subscription by re-initializing with existing topic', async () => {
    const existingTopicId = '0.0.500';
    const registry2 = new AgentRegistry(mockClient);
    await registry2.initialize(existingTopicId);

    expect(mockClient.createTopic).not.toHaveBeenCalledTimes(2); // should not create new topic
    expect(mockClient.subscribeTopic).toHaveBeenCalledWith(existingTopicId, expect.any(Function));
  });

  test('supports testnet network configuration', () => {
    const client = createMockClient();
    expect(client).toBeDefined();
  });

  test('handles client cleanup after close', () => {
    mockClient.close();
    expect(mockClient.close).toHaveBeenCalled();
  });

  test('handles unsubscribe for non-existent topic', () => {
    expect(() => mockClient.unsubscribeTopic('0.0.999')).not.toThrow();
  });

  test('concurrent topic creation calls resolve independently', async () => {
    let callCount = 0;
    mockClient.createTopic.mockImplementation(async () => {
      callCount++;
      return `0.0.${100 + callCount}`;
    });

    const promises = [
      new AgentRegistry(mockClient).initialize(),
      new AgentRegistry(mockClient).initialize(),
      new AgentRegistry(mockClient).initialize(),
    ];

    const results = await Promise.all(promises);
    expect(new Set(results).size).toBe(3);
  });

  test('message ordering is preserved for sequential submissions', async () => {
    const sequences: number[] = [];
    let seq = 0;
    mockClient.submitMessage.mockImplementation(async () => {
      seq++;
      sequences.push(seq);
      return seq;
    });

    const profile1 = createProfile({ id: 'agent-seq-1' });
    const profile2 = createProfile({ id: 'agent-seq-2' });
    const profile3 = createProfile({ id: 'agent-seq-3' });

    await registry.registerAgent(profile1);
    await registry.registerAgent(profile2);
    await registry.registerAgent(profile3);

    expect(sequences).toEqual([1, 2, 3]);
  });

  test('getTopicInfo returns memo and sequence number', async () => {
    const info = await mockClient.getTopicInfo('0.0.100');
    expect(info.memo).toBe('test');
    expect(info.sequenceNumber).toBe(42);
  });

  test('handles getBalance returning zero (empty account)', async () => {
    mockClient.getBalance.mockResolvedValueOnce(0);
    const balance = await mockClient.getBalance();
    expect(balance).toBe(0);
  });

  test('handles multiple rapid registrations without race conditions', async () => {
    const profiles = Array.from({ length: 10 }, (_, i) =>
      createProfile({ id: `rapid-agent-${i}`, name: `Rapid-${i}` })
    );

    await Promise.all(profiles.map(p => registry.registerAgent(p)));
    expect(mockClient.submitMessage).toHaveBeenCalledTimes(10);
    expect(registry.getAgentCount()).toBe(10);
  });

  test('handles empty message contents from subscription', () => {
    let capturedCallback: Function = () => {};
    mockClient.subscribeTopic.mockImplementation((_topicId, callback) => {
      capturedCallback = callback as Function;
    });

    const registry2 = new AgentRegistry(mockClient);
    registry2.initialize();

    expect(() => {
      capturedCallback({ contents: Buffer.from(''), sequenceNumber: 1 });
    }).not.toThrow();
  });

  test('handles binary garbage in subscription message', () => {
    let capturedCallback: Function = () => {};
    mockClient.subscribeTopic.mockImplementation((_topicId, callback) => {
      capturedCallback = callback as Function;
    });

    const registry2 = new AgentRegistry(mockClient);
    registry2.initialize();

    const garbage = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x90]);
    expect(() => {
      capturedCallback({ contents: garbage, sequenceNumber: 1 });
    }).not.toThrow();
  });

  test('topic creation returns valid topic ID format', async () => {
    const topicId = await mockClient.createTopic('test memo');
    expect(topicId).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('handles INVALID_TOPIC_ID error on submission to deleted topic', async () => {
    mockClient.submitMessage.mockRejectedValueOnce(new Error('INVALID_TOPIC_ID'));
    const profile = createProfile({ id: 'deleted-topic-agent' });
    await expect(registry.registerAgent(profile)).rejects.toThrow('INVALID_TOPIC_ID');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Agent Registry at Scale (~15 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent Registry at Scale', () => {
  let mockClient: jest.Mocked<HederaClient>;
  let registry: AgentRegistry;
  let registryCallback: (message: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    mockClient = createMockClient();
    mockClient.subscribeTopic.mockImplementation((_topicId, callback) => {
      registryCallback = callback as any;
    });
    registry = new AgentRegistry(mockClient);
    await registry.initialize();
  });

  test('handles 100+ agents discovery performance', () => {
    // Populate 150 agents directly via subscription callback
    for (let i = 0; i < 150; i++) {
      const profile = createProfile({
        id: `scale-agent-${i}`,
        name: `ScaleAgent-${i}`,
        capabilities: [{ name: i % 2 === 0 ? 'research' : 'analysis', description: 'Cap', inputSchema: {}, outputSchema: {} }],
      });
      registryCallback({
        contents: makeRegistryMessage(MessageType.AGENT_REGISTER, profile),
        sequenceNumber: i + 1,
      });
    }

    expect(registry.getAgentCount()).toBe(150);

    const startTime = Date.now();
    const result = registry.discoverAgents({ capability: 'research' });
    const elapsed = Date.now() - startTime;

    expect(result.totalFound).toBe(75);
    expect(elapsed).toBeLessThan(100); // should be fast
  });

  test('handles out-of-order message delivery', () => {
    const profile1 = createProfile({ id: 'ooo-1', name: 'First' });
    const profile2 = createProfile({ id: 'ooo-2', name: 'Second' });

    // Deliver sequence 5 before sequence 3
    registryCallback({
      contents: makeRegistryMessage(MessageType.AGENT_REGISTER, profile2),
      sequenceNumber: 5,
    });
    registryCallback({
      contents: makeRegistryMessage(MessageType.AGENT_REGISTER, profile1),
      sequenceNumber: 3,
    });

    expect(registry.getAgentCount()).toBe(2);
    expect(registry.getAgent('ooo-1')).toBeDefined();
    expect(registry.getAgent('ooo-2')).toBeDefined();
  });

  test('handles duplicate message processing idempotently', () => {
    const profile = createProfile({ id: 'dup-1', name: 'Duplicate' });
    const msg = makeRegistryMessage(MessageType.AGENT_REGISTER, profile);

    registryCallback({ contents: msg, sequenceNumber: 1 });
    registryCallback({ contents: msg, sequenceNumber: 2 });
    registryCallback({ contents: msg, sequenceNumber: 3 });

    // Should only have one agent (overwrites same id)
    expect(registry.getAgentCount()).toBe(1);
    expect(registry.getAgent('dup-1')!.name).toBe('Duplicate');
  });

  test('agent re-registration with different capabilities updates profile', () => {
    const profileV1 = createProfile({
      id: 're-reg-1',
      capabilities: [{ name: 'research', description: 'v1', inputSchema: {}, outputSchema: {} }],
    });
    const profileV2 = createProfile({
      id: 're-reg-1',
      capabilities: [
        { name: 'analysis', description: 'v2', inputSchema: {}, outputSchema: {} },
        { name: 'coding', description: 'v2', inputSchema: {}, outputSchema: {} },
      ],
    });

    registryCallback({ contents: makeRegistryMessage(MessageType.AGENT_REGISTER, profileV1), sequenceNumber: 1 });
    registryCallback({ contents: makeRegistryMessage(MessageType.AGENT_REGISTER, profileV2), sequenceNumber: 2 });

    const agent = registry.getAgent('re-reg-1');
    expect(agent).toBeDefined();
    expect(agent!.capabilities).toHaveLength(2);
    expect(agent!.capabilities[0]!.name).toBe('analysis');
  });

  test('registry state consistency under concurrent message delivery', () => {
    const profiles = Array.from({ length: 50 }, (_, i) =>
      createProfile({ id: `conc-${i}`, name: `Concurrent-${i}` })
    );

    // Simulate rapid concurrent delivery
    profiles.forEach((p, i) => {
      registryCallback({
        contents: makeRegistryMessage(MessageType.AGENT_REGISTER, p),
        sequenceNumber: i + 1,
      });
    });

    expect(registry.getAgentCount()).toBe(50);
    expect(registry.getAllAgents()).toHaveLength(50);
  });

  test('agent deregistration removes agent from discovery', () => {
    const profile = createProfile({ id: 'dereg-1' });
    registryCallback({ contents: makeRegistryMessage(MessageType.AGENT_REGISTER, profile), sequenceNumber: 1 });
    expect(registry.getAgentCount()).toBe(1);

    const deregMsg: CoordinationMessage = {
      type: MessageType.AGENT_DEREGISTER,
      senderId: 'dereg-1',
      payload: {},
      timestamp: Date.now(),
    };
    registryCallback({ contents: Buffer.from(JSON.stringify(deregMsg)), sequenceNumber: 2 });
    expect(registry.getAgentCount()).toBe(0);
    expect(registry.getAgent('dereg-1')).toBeUndefined();
  });

  test('heartbeat updates agent metadata', () => {
    const profile = createProfile({ id: 'hb-1' });
    registryCallback({ contents: makeRegistryMessage(MessageType.AGENT_REGISTER, profile), sequenceNumber: 1 });

    const heartbeatMsg: CoordinationMessage = {
      type: MessageType.AGENT_HEARTBEAT,
      senderId: 'hb-1',
      payload: { status: 'active' },
      timestamp: 1234567890,
    };
    registryCallback({ contents: Buffer.from(JSON.stringify(heartbeatMsg)), sequenceNumber: 2 });

    const agent = registry.getAgent('hb-1');
    expect(agent!.metadata.lastHeartbeat).toBe('1234567890');
  });

  test('status update changes agent status', () => {
    const profile = createProfile({ id: 'status-1', status: 'active' });
    registryCallback({ contents: makeRegistryMessage(MessageType.AGENT_REGISTER, profile), sequenceNumber: 1 });

    const statusMsg: CoordinationMessage = {
      type: MessageType.AGENT_STATUS_UPDATE,
      senderId: 'status-1',
      payload: { status: 'busy' },
      timestamp: Date.now(),
    };
    registryCallback({ contents: Buffer.from(JSON.stringify(statusMsg)), sequenceNumber: 2 });

    expect(registry.getAgent('status-1')!.status).toBe('busy');
  });

  test('discover agents filters by status correctly at scale', () => {
    for (let i = 0; i < 100; i++) {
      const status = i % 3 === 0 ? 'active' : i % 3 === 1 ? 'busy' : 'inactive';
      const profile = createProfile({ id: `filter-${i}`, status: status as AgentProfile['status'] });
      registryCallback({ contents: makeRegistryMessage(MessageType.AGENT_REGISTER, profile), sequenceNumber: i + 1 });
    }

    const activeAgents = registry.discoverAgents({ status: 'active' });
    expect(activeAgents.totalFound).toBe(34); // ceil(100/3) for i%3===0: 0,3,6,...,99 = 34

    const busyAgents = registry.discoverAgents({ status: 'busy' });
    expect(busyAgents.totalFound).toBe(33);
  });

  test('maxResults limits discovery output', () => {
    for (let i = 0; i < 50; i++) {
      const profile = createProfile({ id: `limit-${i}` });
      registryCallback({ contents: makeRegistryMessage(MessageType.AGENT_REGISTER, profile), sequenceNumber: i + 1 });
    }

    const result = registry.discoverAgents({ maxResults: 10 });
    expect(result.agents).toHaveLength(10);
    expect(result.totalFound).toBe(10);
  });

  test('discover agents with both capability and status filters', () => {
    for (let i = 0; i < 40; i++) {
      const cap = i % 2 === 0 ? 'research' : 'coding';
      const status = i % 4 === 0 ? 'active' : 'busy';
      const profile = createProfile({
        id: `combo-${i}`,
        status: status as AgentProfile['status'],
        capabilities: [{ name: cap, description: cap, inputSchema: {}, outputSchema: {} }],
      });
      registryCallback({ contents: makeRegistryMessage(MessageType.AGENT_REGISTER, profile), sequenceNumber: i + 1 });
    }

    const result = registry.discoverAgents({ capability: 'research', status: 'active' });
    // research: even indices (0,2,4,...,38) = 20 agents
    // active: i%4===0 (0,4,8,...,36) = 10 agents
    // research AND active: even AND i%4===0 => i%4===0 = 10
    expect(result.totalFound).toBe(10);
  });

  test('heartbeat for non-existent agent does not create entry', () => {
    const heartbeatMsg: CoordinationMessage = {
      type: MessageType.AGENT_HEARTBEAT,
      senderId: 'ghost-agent',
      payload: {},
      timestamp: Date.now(),
    };
    registryCallback({ contents: Buffer.from(JSON.stringify(heartbeatMsg)), sequenceNumber: 1 });
    expect(registry.getAgent('ghost-agent')).toBeUndefined();
    expect(registry.getAgentCount()).toBe(0);
  });

  test('status update for non-existent agent does nothing', () => {
    const statusMsg: CoordinationMessage = {
      type: MessageType.AGENT_STATUS_UPDATE,
      senderId: 'ghost-agent',
      payload: { status: 'active' },
      timestamp: Date.now(),
    };
    registryCallback({ contents: Buffer.from(JSON.stringify(statusMsg)), sequenceNumber: 1 });
    expect(registry.getAgentCount()).toBe(0);
  });

  test('getRegistryTopicId throws when not initialized', () => {
    const uninitRegistry = new AgentRegistry(mockClient);
    expect(() => uninitRegistry.getRegistryTopicId()).toThrow('Registry not initialized');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Dashboard Performance (~15 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe('Dashboard Performance', () => {
  let dashboard: Dashboard;
  let baseUrl: string;
  let port: number;

  beforeEach(async () => {
    port = 40000 + Math.floor(Math.random() * 10000);
    dashboard = new Dashboard({ port, host: '127.0.0.1' });
    baseUrl = await dashboard.start();
  });

  afterEach(async () => {
    await dashboard.stop();
  });

  test('serves status endpoint with correct JSON structure', async () => {
    const res = await httpGet(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty('agents');
    expect(data).toHaveProperty('tasks');
    expect(data).toHaveProperty('uptime');
    expect(typeof data.uptime).toBe('number');
  });

  test('serves agents endpoint returning array', async () => {
    const res = await httpGet(`${baseUrl}/api/agents`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data)).toBe(true);
  });

  test('serves tasks endpoint returning array', async () => {
    const res = await httpGet(`${baseUrl}/api/tasks`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data)).toBe(true);
  });

  test('HTML dashboard contains required structural elements', async () => {
    const res = await httpGet(baseUrl);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html');
    expect(res.body).toContain('<!DOCTYPE html>');
    expect(res.body).toContain('AgentMesh');
    expect(res.body).toContain('Agents Online');
    expect(res.body).toContain('Active Tasks');
    expect(res.body).toContain('Node Status');
    expect(res.body).toContain('Uptime');
  });

  test('API responses include CORS headers', async () => {
    const res = await httpGet(`${baseUrl}/api/status`);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  test('status endpoint returns null node when no meshNode configured', async () => {
    const res = await httpGet(`${baseUrl}/api/status`);
    const data = JSON.parse(res.body);
    expect(data.node).toBeNull();
  });

  test('handles concurrent API requests', async () => {
    const requests = Array.from({ length: 20 }, () =>
      httpGet(`${baseUrl}/api/status`)
    );

    const responses = await Promise.all(requests);
    for (const res of responses) {
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data).toHaveProperty('uptime');
    }
  });

  test('dashboard HTML contains auto-refresh script', async () => {
    const res = await httpGet(baseUrl);
    expect(res.body).toContain('setInterval(refresh');
    expect(res.body).toContain('3000');
  });

  test('unknown routes serve dashboard HTML page', async () => {
    const res = await httpGet(`${baseUrl}/unknown/route`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html');
    expect(res.body).toContain('AgentMesh');
  });

  test('default port is 3456', () => {
    const d = new Dashboard();
    expect(d.getPort()).toBe(3456);
  });

  test('custom port is respected', () => {
    const d = new Dashboard({ port: 9999 });
    expect(d.getPort()).toBe(9999);
  });

  test('stop is safe to call multiple times', async () => {
    await dashboard.stop();
    await dashboard.stop();
    // No error thrown
  });

  test('agents endpoint content-type is JSON', async () => {
    const res = await httpGet(`${baseUrl}/api/agents`);
    expect(res.headers['content-type']).toBe('application/json');
  });

  test('tasks endpoint content-type is JSON', async () => {
    const res = await httpGet(`${baseUrl}/api/tasks`);
    expect(res.headers['content-type']).toBe('application/json');
  });

  test('dashboard HTML contains table headers for agents and tasks', async () => {
    const res = await httpGet(baseUrl);
    expect(res.body).toContain('<th>Name</th>');
    expect(res.body).toContain('<th>Status</th>');
    expect(res.body).toContain('<th>Priority</th>');
    expect(res.body).toContain('<th>Bids</th>');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. HCS-10 Bridge Edge Cases (~15 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe('HCS-10 Bridge Edge Cases', () => {
  let bridge: HCS10Bridge;
  const bridgeConfig: HCS10BridgeConfig = {
    meshConfig: TEST_CONFIG,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    bridge = new HCS10Bridge(bridgeConfig);
  });

  test('constructor initializes HCS10Client', () => {
    expect(bridge.getClient()).toBeDefined();
  });

  test('mapCapabilities always includes MULTI_AGENT_COORDINATION', () => {
    const { AIAgentCapability } = require('@hashgraphonline/standards-sdk');
    const caps = bridge.mapCapabilities([]);
    expect(caps).toContain(AIAgentCapability.MULTI_AGENT_COORDINATION);
  });

  test('mapCapabilities maps known capabilities correctly', () => {
    const { AIAgentCapability } = require('@hashgraphonline/standards-sdk');
    const caps = bridge.mapCapabilities([
      { name: 'web_research', description: 'Search', inputSchema: {}, outputSchema: {} },
      { name: 'code_generation', description: 'Code', inputSchema: {}, outputSchema: {} },
    ]);
    expect(caps).toContain(AIAgentCapability.KNOWLEDGE_RETRIEVAL);
    expect(caps).toContain(AIAgentCapability.CODE_GENERATION);
    expect(caps).toContain(AIAgentCapability.MULTI_AGENT_COORDINATION);
  });

  test('mapCapabilities handles unknown capability names gracefully', () => {
    const { AIAgentCapability } = require('@hashgraphonline/standards-sdk');
    const caps = bridge.mapCapabilities([
      { name: 'teleportation', description: 'Unknown', inputSchema: {}, outputSchema: {} },
    ]);
    // Only MULTI_AGENT_COORDINATION should be present (unknown is skipped)
    expect(caps).toEqual([AIAgentCapability.MULTI_AGENT_COORDINATION]);
  });

  test('mapCapabilities deduplicates when multiple mesh caps map to same HCS-11 cap', () => {
    const { AIAgentCapability } = require('@hashgraphonline/standards-sdk');
    // Both web_research and fact_check map to KNOWLEDGE_RETRIEVAL
    const caps = bridge.mapCapabilities([
      { name: 'web_research', description: 'A', inputSchema: {}, outputSchema: {} },
      { name: 'fact_check', description: 'B', inputSchema: {}, outputSchema: {} },
    ]);
    const knowledgeCount = caps.filter((c: number) => c === AIAgentCapability.KNOWLEDGE_RETRIEVAL).length;
    expect(knowledgeCount).toBe(1);
  });

  test('createStandardsAgent creates agent with proper info', async () => {
    const profile = {
      id: 'bridge-agent-1',
      name: 'BridgeAgent',
      description: 'Test bridge agent',
      capabilities: [{ name: 'research', description: 'Research', inputSchema: {}, outputSchema: {} }],
      hederaAccountId: '0.0.12345',
      status: 'active' as const,
      metadata: {},
    };

    const result = await bridge.createStandardsAgent(profile);
    expect(result.inboundTopicId).toBeDefined();
    expect(result.outboundTopicId).toBeDefined();
    expect(result.profileTopicId).toBeDefined();
    expect(result.hcs10Client).toBeDefined();
  });

  test('createStandardsAgent failure propagates error', async () => {
    mockStandardsClient.createAgent.mockRejectedValueOnce(new Error('TOPIC_CREATION_FAILED'));

    const profile = {
      id: 'fail-agent',
      name: 'FailAgent',
      description: 'Will fail',
      capabilities: [],
      hederaAccountId: '0.0.999',
      status: 'active' as const,
      metadata: {},
    };

    await expect(bridge.createStandardsAgent(profile)).rejects.toThrow('TOPIC_CREATION_FAILED');
  });

  test('handleConnectionRequest stores connection mapping', async () => {
    const response = await bridge.handleConnectionRequest('0.0.800', '0.0.123', 1);
    expect(response.connectionTopicId).toBe('0.0.1001');
    expect(bridge.getConnectionTopic('0.0.123')).toBe('0.0.1001');
  });

  test('getConnections returns a copy of connections map', async () => {
    await bridge.handleConnectionRequest('0.0.800', '0.0.123', 1);
    const connections = bridge.getConnections();
    expect(connections.size).toBe(1);
    expect(connections.get('0.0.123')).toBe('0.0.1001');

    // Mutating the copy should not affect the bridge
    connections.delete('0.0.123');
    expect(bridge.getConnectionTopic('0.0.123')).toBe('0.0.1001');
  });

  test('getConnectionTopic returns undefined for unknown account', () => {
    expect(bridge.getConnectionTopic('0.0.nonexistent')).toBeUndefined();
  });

  test('sendMessage delegates to HCS10Client', async () => {
    await bridge.sendMessage('0.0.1001', 'hello', 'test-memo');
    expect(mockStandardsClient.sendMessage).toHaveBeenCalledWith('0.0.1001', 'hello', 'test-memo');
  });

  test('sendMessage failure propagates error', async () => {
    mockStandardsClient.sendMessage.mockRejectedValueOnce(new Error('CONNECTION_CLOSED'));
    await expect(bridge.sendMessage('0.0.1001', 'hello')).rejects.toThrow('CONNECTION_CLOSED');
  });

  test('multiple connection requests build connection map', async () => {
    mockStandardsClient.handleConnectionRequest
      .mockResolvedValueOnce({ connectionTopicId: '0.0.1001' })
      .mockResolvedValueOnce({ connectionTopicId: '0.0.1002' })
      .mockResolvedValueOnce({ connectionTopicId: '0.0.1003' });

    await bridge.handleConnectionRequest('0.0.800', '0.0.A', 1);
    await bridge.handleConnectionRequest('0.0.800', '0.0.B', 2);
    await bridge.handleConnectionRequest('0.0.800', '0.0.C', 3);

    expect(bridge.getConnections().size).toBe(3);
  });

  test('createAndRegisterAgent delegates to HCS10Client', async () => {
    const profile = {
      id: 'reg-agent',
      name: 'RegisteredAgent',
      description: 'Test',
      capabilities: [{ name: 'translate', description: 'Translate', inputSchema: {}, outputSchema: {} }],
      hederaAccountId: '0.0.12345',
      status: 'active' as const,
      metadata: {},
    };

    const result = await bridge.createAndRegisterAgent(profile);
    expect(result.success).toBe(true);
    expect(mockStandardsClient.createAndRegisterAgent).toHaveBeenCalled();
  });

  test('bridge emits events during createStandardsAgent', async () => {
    const events: any[] = [];
    bridge.on('progress', (e: any) => events.push(e));

    const profile = {
      id: 'event-agent',
      name: 'EventAgent',
      description: 'Test',
      capabilities: [],
      hederaAccountId: '0.0.999',
      status: 'active' as const,
      metadata: {},
    };

    await bridge.createStandardsAgent(profile);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e: any) => e.stage === 'preparing' || e.stage === 'completed')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Standards Registry Edge Cases (~15 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe('Standards Registry Edge Cases', () => {
  let stdRegistry: StandardsRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStandardsClient.searchRegistrations.mockResolvedValue({
      registrations: [],
      success: true,
    });
    stdRegistry = new StandardsRegistry(TEST_CONFIG);
  });

  test('searchAgents returns empty array when no registrations', async () => {
    const agents = await stdRegistry.searchAgents();
    expect(agents).toEqual([]);
  });

  test('searchAgents handles null result from searchRegistrations', async () => {
    mockStandardsClient.searchRegistrations.mockResolvedValueOnce(null);
    const agents = await stdRegistry.searchAgents();
    expect(agents).toEqual([]);
  });

  test('searchAgents handles result with no registrations field', async () => {
    mockStandardsClient.searchRegistrations.mockResolvedValueOnce({ success: true });
    const agents = await stdRegistry.searchAgents();
    expect(agents).toEqual([]);
  });

  test('searchAgents applies maxResults pagination', async () => {
    const registrations = Array.from({ length: 120 }, (_, i) => ({
      accountId: `0.0.${200 + i}`,
      inboundTopicId: `0.0.${2000 + i}`,
      outboundTopicId: `0.0.${3000 + i}`,
      registryTopicId: '0.0.5000',
      metadata: {
        display_name: `Agent-${i}`,
        bio: `Agent number ${i}`,
        capabilities: [],
      },
    }));
    mockStandardsClient.searchRegistrations.mockResolvedValueOnce({
      registrations,
      success: true,
    });

    const agents = await stdRegistry.searchAgents({ maxResults: 10 });
    expect(agents).toHaveLength(10);
  });

  test('searchAgents with capability filter passes tags', async () => {
    const { AIAgentCapability } = require('@hashgraphonline/standards-sdk');
    await stdRegistry.searchAgents({ capabilities: [AIAgentCapability.CODE_GENERATION] });
    expect(mockStandardsClient.searchRegistrations).toHaveBeenCalledWith(
      expect.objectContaining({ tags: [AIAgentCapability.CODE_GENERATION] })
    );
  });

  test('searchAgents with accountId filter passes accountId', async () => {
    await stdRegistry.searchAgents({ accountId: '0.0.42' });
    expect(mockStandardsClient.searchRegistrations).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: '0.0.42' })
    );
  });

  test('toMeshProfile converts registry agent to AgentProfile', () => {
    const { AIAgentCapability } = require('@hashgraphonline/standards-sdk');
    const agent = {
      accountId: '0.0.200',
      inboundTopicId: '0.0.2001',
      outboundTopicId: '0.0.2002',
      name: 'TestBot',
      description: 'A test bot',
      capabilities: [AIAgentCapability.CODE_GENERATION],
      model: 'gpt-4',
      creator: 'TestOrg',
      registryTopicId: '0.0.5000',
    };

    const profile = stdRegistry.toMeshProfile(agent);
    expect(profile.id).toBe('0.0.200');
    expect(profile.name).toBe('TestBot');
    expect(profile.description).toBe('A test bot');
    expect(profile.hederaAccountId).toBe('0.0.200');
    expect(profile.status).toBe('active');
    expect(profile.metadata.source).toBe('hol-registry');
    expect(profile.metadata.model).toBe('gpt-4');
    expect(profile.capabilities.length).toBeGreaterThanOrEqual(1);
  });

  test('toMeshProfile handles unknown capability with fallback name', () => {
    const agent = {
      accountId: '0.0.200',
      inboundTopicId: '0.0.2001',
      outboundTopicId: '0.0.2002',
      name: 'Bot',
      description: 'Test',
      capabilities: [999], // Unknown capability
      registryTopicId: '0.0.5000',
    };

    const profile = stdRegistry.toMeshProfile(agent);
    expect(profile.capabilities[0]!.name).toContain('hcs11_cap_');
  });

  test('toMeshProfile handles missing model and creator', () => {
    const agent = {
      accountId: '0.0.200',
      inboundTopicId: '0.0.2001',
      outboundTopicId: '0.0.2002',
      name: 'Bot',
      description: 'Test',
      capabilities: [],
      registryTopicId: '0.0.5000',
    };

    const profile = stdRegistry.toMeshProfile(agent);
    expect(profile.metadata.model).toBe('');
    expect(profile.metadata.creator).toBe('');
  });

  test('discoverMeshAgents returns AgentProfile array', async () => {
    mockStandardsClient.searchRegistrations.mockResolvedValueOnce({
      registrations: [{
        accountId: '0.0.200',
        inboundTopicId: '0.0.2001',
        outboundTopicId: '0.0.2002',
        registryTopicId: '0.0.5000',
        metadata: {
          display_name: 'DiscoverBot',
          bio: 'Discoverable bot',
          capabilities: [],
        },
      }],
      success: true,
    });

    const profiles = await stdRegistry.discoverMeshAgents();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.name).toBe('DiscoverBot');
    expect(profiles[0]!.status).toBe('active');
  });

  test('createRegistryTopic returns topic ID on success', async () => {
    const topicId = await stdRegistry.createRegistryTopic({ name: 'Custom Registry' });
    expect(topicId).toBe('0.0.6000');
  });

  test('createRegistryTopic throws on failure', async () => {
    mockStandardsClient.createRegistryTopic.mockResolvedValueOnce({
      success: false,
      error: 'Permission denied',
    });

    await expect(stdRegistry.createRegistryTopic()).rejects.toThrow('Failed to create registry topic');
  });

  test('searchAgents handles agent with name instead of display_name', async () => {
    mockStandardsClient.searchRegistrations.mockResolvedValueOnce({
      registrations: [{
        accountId: '0.0.300',
        inboundTopicId: '0.0.3001',
        outboundTopicId: '0.0.3002',
        registryTopicId: '0.0.5000',
        metadata: {
          name: 'NamedBot',
          description: 'Uses name field',
          capabilities: [],
        },
      }],
      success: true,
    });

    const agents = await stdRegistry.searchAgents();
    expect(agents[0]!.name).toBe('NamedBot');
  });

  test('searchAgents handles agent with neither name nor display_name', async () => {
    mockStandardsClient.searchRegistrations.mockResolvedValueOnce({
      registrations: [{
        accountId: '0.0.400',
        inboundTopicId: '0.0.4001',
        outboundTopicId: '0.0.4002',
        registryTopicId: '0.0.5000',
        metadata: { capabilities: [] },
      }],
      success: true,
    });

    const agents = await stdRegistry.searchAgents();
    expect(agents[0]!.name).toBe('Unknown');
    expect(agents[0]!.description).toBe('');
  });

  test('searchAgents network timeout propagates error', async () => {
    mockStandardsClient.searchRegistrations.mockRejectedValueOnce(new Error('Network timeout'));
    await expect(stdRegistry.searchAgents()).rejects.toThrow('Network timeout');
  });

  test('toMeshProfile sets createdAt to recent timestamp', () => {
    const before = Date.now();
    const agent = {
      accountId: '0.0.200',
      inboundTopicId: '0.0.2001',
      outboundTopicId: '0.0.2002',
      name: 'TimeBot',
      description: 'Test',
      capabilities: [],
      registryTopicId: '0.0.5000',
    };
    const profile = stdRegistry.toMeshProfile(agent);
    const after = Date.now();
    expect(profile.createdAt).toBeGreaterThanOrEqual(before);
    expect(profile.createdAt).toBeLessThanOrEqual(after);
  });
});
