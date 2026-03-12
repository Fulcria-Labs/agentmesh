/**
 * Integration tests for MeshNode + StandardsRegistry + TaskCoordinator + AgentRegistry
 * Covers capability mapping, profile conversion, handler management,
 * state transitions, discovery delegation, and edge cases.
 */

import { MeshNode } from '../core/mesh-node';
import { AgentRegistry } from '../core/agent-registry';
import { TaskCoordinator } from '../core/task-coordinator';
import { HederaClient } from '../core/hedera-client';
import { StandardsRegistry } from '../hol/standards-registry';
import { MeshConfig, AgentCapability, AgentProfile } from '../core/types';

// ---------- mocks ----------

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
    // Reverse mapping for enum-style name lookup
    0: 'TEXT_GENERATION',
    1: 'IMAGE_GENERATION',
    2: 'AUDIO_GENERATION',
    3: 'VIDEO_GENERATION',
    4: 'CODE_GENERATION',
    5: 'LANGUAGE_TRANSLATION',
    6: 'SUMMARIZATION_EXTRACTION',
    7: 'KNOWLEDGE_RETRIEVAL',
    8: 'DATA_INTEGRATION',
    9: 'MARKET_INTELLIGENCE',
    10: 'TRANSACTION_ANALYTICS',
    11: 'SMART_CONTRACT_AUDIT',
    12: 'GOVERNANCE_FACILITATION',
    13: 'SECURITY_MONITORING',
    14: 'COMPLIANCE_ANALYSIS',
    15: 'FRAUD_DETECTION',
    16: 'MULTI_AGENT_COORDINATION',
    17: 'API_INTEGRATION',
    18: 'WORKFLOW_AUTOMATION',
  };

  const mockHCS10Client = {
    searchRegistrations: jest.fn().mockResolvedValue({ registrations: [], success: true }),
    createRegistryTopic: jest.fn().mockResolvedValue({ success: true, topicId: '0.0.6000' }),
    getClient: jest.fn(),
    getOperatorAccountId: jest.fn().mockReturnValue('0.0.100'),
  };

  return {
    HCS10Client: jest.fn().mockImplementation(() => mockHCS10Client),
    AIAgentCapability,
    __mockClient: mockHCS10Client,
  };
});

// ---------- shared helpers ----------

const TEST_CONFIG: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.12345',
  operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
};

const TEST_CAPABILITIES: AgentCapability[] = [
  {
    name: 'web_research',
    description: 'Research topics on the web',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
  },
  {
    name: 'summarize',
    description: 'Summarize text',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { summary: { type: 'string' } } },
  },
];

function setupMockClient(): void {
  const proto = HederaClient.prototype as any;
  proto.createTopic = jest.fn().mockResolvedValue('0.0.100');
  proto.submitMessage = jest.fn().mockResolvedValue(1);
  proto.subscribeTopic = jest.fn();
  proto.emit = jest.fn().mockReturnValue(true);
  proto.getOperatorAccountId = jest.fn().mockReturnValue('0.0.12345');
  proto.getBalance = jest.fn().mockResolvedValue(50.5);
  proto.close = jest.fn();
}

function createNode(overrides?: Partial<{ config: MeshConfig; agentName: string; agentDescription: string; capabilities: AgentCapability[] }>): MeshNode {
  return new MeshNode({
    config: overrides?.config ?? TEST_CONFIG,
    agentName: overrides?.agentName ?? 'TestNode',
    agentDescription: overrides?.agentDescription ?? 'A test node',
    capabilities: overrides?.capabilities ?? TEST_CAPABILITIES,
  });
}

// ====================================================================
// 1. StandardsRegistry REVERSE_CAPABILITY_MAP
// ====================================================================

describe('StandardsRegistry REVERSE_CAPABILITY_MAP', () => {
  let registry: StandardsRegistry;
  const { AIAgentCapability } = require('@hashgraphonline/standards-sdk');

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new StandardsRegistry(TEST_CONFIG);
  });

  const EXPECTED_MAPPINGS: Array<{ capEnum: number; capName: string; meshName: string }> = [
    { capEnum: AIAgentCapability.KNOWLEDGE_RETRIEVAL, capName: 'KNOWLEDGE_RETRIEVAL', meshName: 'web_research' },
    { capEnum: AIAgentCapability.SUMMARIZATION_EXTRACTION, capName: 'SUMMARIZATION_EXTRACTION', meshName: 'summarize' },
    { capEnum: AIAgentCapability.DATA_INTEGRATION, capName: 'DATA_INTEGRATION', meshName: 'data_analysis' },
    { capEnum: AIAgentCapability.MARKET_INTELLIGENCE, capName: 'MARKET_INTELLIGENCE', meshName: 'sentiment_analysis' },
    { capEnum: AIAgentCapability.TRANSACTION_ANALYTICS, capName: 'TRANSACTION_ANALYTICS', meshName: 'risk_assessment' },
    { capEnum: AIAgentCapability.MULTI_AGENT_COORDINATION, capName: 'MULTI_AGENT_COORDINATION', meshName: 'task_decomposition' },
    { capEnum: AIAgentCapability.LANGUAGE_TRANSLATION, capName: 'LANGUAGE_TRANSLATION', meshName: 'translate' },
    { capEnum: AIAgentCapability.CODE_GENERATION, capName: 'CODE_GENERATION', meshName: 'code_generation' },
    { capEnum: AIAgentCapability.TEXT_GENERATION, capName: 'TEXT_GENERATION', meshName: 'text_generation' },
    { capEnum: AIAgentCapability.IMAGE_GENERATION, capName: 'IMAGE_GENERATION', meshName: 'image_generation' },
    { capEnum: AIAgentCapability.WORKFLOW_AUTOMATION, capName: 'WORKFLOW_AUTOMATION', meshName: 'workflow_automation' },
    { capEnum: AIAgentCapability.SMART_CONTRACT_AUDIT, capName: 'SMART_CONTRACT_AUDIT', meshName: 'smart_contract_audit' },
    { capEnum: AIAgentCapability.SECURITY_MONITORING, capName: 'SECURITY_MONITORING', meshName: 'security_monitoring' },
    { capEnum: AIAgentCapability.COMPLIANCE_ANALYSIS, capName: 'COMPLIANCE_ANALYSIS', meshName: 'compliance_analysis' },
    { capEnum: AIAgentCapability.FRAUD_DETECTION, capName: 'FRAUD_DETECTION', meshName: 'fraud_detection' },
    { capEnum: AIAgentCapability.API_INTEGRATION, capName: 'API_INTEGRATION', meshName: 'api_integration' },
  ];

  it.each(EXPECTED_MAPPINGS)(
    'should map $capName (enum $capEnum) to mesh name "$meshName"',
    ({ capEnum, meshName }) => {
      const agent = {
        accountId: '0.0.500',
        inboundTopicId: '0.0.501',
        outboundTopicId: '0.0.502',
        name: 'MapTestAgent',
        description: 'Mapping test',
        capabilities: [capEnum],
        registryTopicId: '0.0.5000',
      };
      const profile = registry.toMeshProfile(agent);
      expect(profile.capabilities).toHaveLength(1);
      expect(profile.capabilities[0]!.name).toBe(meshName);
    },
  );

  it('should produce exactly 16 tested mappings', () => {
    expect(EXPECTED_MAPPINGS).toHaveLength(16);
  });

  it('should produce fallback name for unknown capability value 99', () => {
    const agent = {
      accountId: '0.0.500',
      inboundTopicId: '0.0.501',
      outboundTopicId: '0.0.502',
      name: 'UnknownCapAgent',
      description: 'Test',
      capabilities: [99],
      registryTopicId: '0.0.5000',
    };
    const profile = registry.toMeshProfile(agent);
    expect(profile.capabilities[0]!.name).toBe('hcs11_cap_99');
  });

  it('should produce fallback name for unknown capability value 255', () => {
    const agent = {
      accountId: '0.0.500',
      inboundTopicId: '0.0.501',
      outboundTopicId: '0.0.502',
      name: 'UnknownCapAgent',
      description: 'Test',
      capabilities: [255],
      registryTopicId: '0.0.5000',
    };
    const profile = registry.toMeshProfile(agent);
    expect(profile.capabilities[0]!.name).toBe('hcs11_cap_255');
  });

  it('should handle multiple unknown capabilities', () => {
    const agent = {
      accountId: '0.0.500',
      inboundTopicId: '0.0.501',
      outboundTopicId: '0.0.502',
      name: 'MultiUnknown',
      description: 'Test',
      capabilities: [77, 88],
      registryTopicId: '0.0.5000',
    };
    const profile = registry.toMeshProfile(agent);
    expect(profile.capabilities).toHaveLength(2);
    expect(profile.capabilities[0]!.name).toBe('hcs11_cap_77');
    expect(profile.capabilities[1]!.name).toBe('hcs11_cap_88');
  });

  it('should mix known and unknown capabilities correctly', () => {
    const agent = {
      accountId: '0.0.500',
      inboundTopicId: '0.0.501',
      outboundTopicId: '0.0.502',
      name: 'MixedAgent',
      description: 'Test',
      capabilities: [AIAgentCapability.CODE_GENERATION, 42, AIAgentCapability.FRAUD_DETECTION],
      registryTopicId: '0.0.5000',
    };
    const profile = registry.toMeshProfile(agent);
    expect(profile.capabilities).toHaveLength(3);
    expect(profile.capabilities[0]!.name).toBe('code_generation');
    expect(profile.capabilities[1]!.name).toBe('hcs11_cap_42');
    expect(profile.capabilities[2]!.name).toBe('fraud_detection');
  });
});

// ====================================================================
// 2. StandardsRegistry toMeshProfile
// ====================================================================

describe('StandardsRegistry toMeshProfile', () => {
  let registry: StandardsRegistry;
  const { AIAgentCapability } = require('@hashgraphonline/standards-sdk');

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new StandardsRegistry(TEST_CONFIG);
  });

  it('should convert a fully populated registry agent', () => {
    const agent = {
      accountId: '0.0.700',
      inboundTopicId: '0.0.701',
      outboundTopicId: '0.0.702',
      name: 'FullAgent',
      description: 'Full description here',
      capabilities: [AIAgentCapability.TEXT_GENERATION, AIAgentCapability.CODE_GENERATION],
      model: 'claude-3',
      creator: 'Anthropic',
      registryTopicId: '0.0.8000',
    };

    const profile = registry.toMeshProfile(agent);

    expect(profile.id).toBe('0.0.700');
    expect(profile.name).toBe('FullAgent');
    expect(profile.description).toBe('Full description here');
    expect(profile.hederaAccountId).toBe('0.0.700');
    expect(profile.inboundTopicId).toBe('0.0.701');
    expect(profile.outboundTopicId).toBe('0.0.702');
    expect(profile.registryTopicId).toBe('0.0.8000');
    expect(profile.status).toBe('active');
    expect(typeof profile.createdAt).toBe('number');
    expect(profile.createdAt).toBeGreaterThan(0);
    expect(profile.metadata.source).toBe('hol-registry');
    expect(profile.metadata.model).toBe('claude-3');
    expect(profile.metadata.creator).toBe('Anthropic');
    expect(profile.capabilities).toHaveLength(2);
    expect(profile.capabilities[0]!.name).toBe('text_generation');
    expect(profile.capabilities[1]!.name).toBe('code_generation');
  });

  it('should set model to empty string when undefined', () => {
    const agent = {
      accountId: '0.0.700',
      inboundTopicId: '0.0.701',
      outboundTopicId: '0.0.702',
      name: 'NoModelAgent',
      description: 'Test',
      capabilities: [],
      registryTopicId: '0.0.8000',
    };

    const profile = registry.toMeshProfile(agent);
    expect(profile.metadata.model).toBe('');
  });

  it('should set creator to empty string when undefined', () => {
    const agent = {
      accountId: '0.0.700',
      inboundTopicId: '0.0.701',
      outboundTopicId: '0.0.702',
      name: 'NoCreatorAgent',
      description: 'Test',
      capabilities: [],
      registryTopicId: '0.0.8000',
    };

    const profile = registry.toMeshProfile(agent);
    expect(profile.metadata.creator).toBe('');
  });

  it('should handle empty capabilities array', () => {
    const agent = {
      accountId: '0.0.700',
      inboundTopicId: '0.0.701',
      outboundTopicId: '0.0.702',
      name: 'NoCapsAgent',
      description: 'No capabilities',
      capabilities: [],
      registryTopicId: '0.0.8000',
    };

    const profile = registry.toMeshProfile(agent);
    expect(profile.capabilities).toEqual([]);
    expect(profile.capabilities).toHaveLength(0);
  });

  it('should include inputSchema and outputSchema on each capability', () => {
    const agent = {
      accountId: '0.0.700',
      inboundTopicId: '0.0.701',
      outboundTopicId: '0.0.702',
      name: 'SchemaAgent',
      description: 'Test',
      capabilities: [AIAgentCapability.API_INTEGRATION],
      registryTopicId: '0.0.8000',
    };

    const profile = registry.toMeshProfile(agent);
    const cap = profile.capabilities[0]!;
    expect(cap.inputSchema).toEqual({ type: 'object', properties: {} });
    expect(cap.outputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('should include HCS-11 capability description string', () => {
    const agent = {
      accountId: '0.0.700',
      inboundTopicId: '0.0.701',
      outboundTopicId: '0.0.702',
      name: 'DescAgent',
      description: 'Test',
      capabilities: [AIAgentCapability.KNOWLEDGE_RETRIEVAL],
      registryTopicId: '0.0.8000',
    };

    const profile = registry.toMeshProfile(agent);
    expect(profile.capabilities[0]!.description).toContain('HCS-11 capability');
  });

  it('should use accountId as profile id', () => {
    const agent = {
      accountId: '0.0.999',
      inboundTopicId: '0.0.9991',
      outboundTopicId: '0.0.9992',
      name: 'IdTest',
      description: 'Test',
      capabilities: [],
      registryTopicId: '0.0.8000',
    };

    const profile = registry.toMeshProfile(agent);
    expect(profile.id).toBe(agent.accountId);
  });

  it('should produce a createdAt close to current time', () => {
    const before = Date.now();
    const agent = {
      accountId: '0.0.700',
      inboundTopicId: '0.0.701',
      outboundTopicId: '0.0.702',
      name: 'TimeAgent',
      description: 'Test',
      capabilities: [],
      registryTopicId: '0.0.8000',
    };
    const profile = registry.toMeshProfile(agent);
    const after = Date.now();

    expect(profile.createdAt).toBeGreaterThanOrEqual(before);
    expect(profile.createdAt).toBeLessThanOrEqual(after);
  });
});

// ====================================================================
// 3. MeshNode capability handler management
// ====================================================================

describe('MeshNode capability handler management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMockClient();
  });

  afterEach(async () => {
    // Nodes that are not started don't need stopping.
  });

  it('should register a handler and execute it', async () => {
    const node = createNode();
    const handler = jest.fn().mockResolvedValue({ answer: 42 });

    node.registerCapabilityHandler('my_cap', handler);
    const result = await node.executeCapability('my_cap', { x: 1 });

    expect(handler).toHaveBeenCalledWith({ x: 1 });
    expect(result).toEqual({ answer: 42 });
  });

  it('should throw for unregistered capability', async () => {
    const node = createNode();
    await expect(node.executeCapability('missing', {})).rejects.toThrow(
      'No handler for capability: missing',
    );
  });

  it('should support multiple distinct handlers', async () => {
    const node = createNode();
    node.registerCapabilityHandler('alpha', async () => 'a');
    node.registerCapabilityHandler('beta', async () => 'b');

    expect(await node.executeCapability('alpha', {})).toBe('a');
    expect(await node.executeCapability('beta', {})).toBe('b');
  });

  it('should overwrite a handler on re-registration', async () => {
    const node = createNode();
    node.registerCapabilityHandler('cap', async () => 'first');
    node.registerCapabilityHandler('cap', async () => 'second');

    expect(await node.executeCapability('cap', {})).toBe('second');
  });

  it('should propagate handler errors', async () => {
    const node = createNode();
    node.registerCapabilityHandler('failing', async () => {
      throw new Error('handler boom');
    });

    await expect(node.executeCapability('failing', {})).rejects.toThrow('handler boom');
  });

  it('should pass complex input objects through', async () => {
    const node = createNode();
    node.registerCapabilityHandler('echo', async (input) => input);

    const complex = { nested: { a: [1, 2, 3] }, flag: true };
    const result = await node.executeCapability('echo', complex);
    expect(result).toEqual(complex);
  });

  it('should not interfere between different handler names', async () => {
    const node = createNode();
    const callOrder: string[] = [];

    node.registerCapabilityHandler('first', async () => {
      callOrder.push('first');
      return 1;
    });
    node.registerCapabilityHandler('second', async () => {
      callOrder.push('second');
      return 2;
    });

    await node.executeCapability('second', {});
    await node.executeCapability('first', {});

    expect(callOrder).toEqual(['second', 'first']);
  });
});

// ====================================================================
// 4. MeshNode state transitions
// ====================================================================

describe('MeshNode state transitions', () => {
  const startedNodes: MeshNode[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    setupMockClient();
  });

  afterEach(async () => {
    for (const n of startedNodes) {
      await n.stop();
    }
    startedNodes.length = 0;
  });

  async function startAndTrack(node: MeshNode): Promise<AgentProfile> {
    startedNodes.push(node);
    return node.start();
  }

  it('should have null profile before start', () => {
    const node = createNode();
    expect(node.getProfile()).toBeNull();
  });

  it('should have a non-null profile after start', async () => {
    const node = createNode();
    await startAndTrack(node);
    expect(node.getProfile()).not.toBeNull();
  });

  it('should throw on submitTask when not started', async () => {
    const node = createNode();
    await expect(node.submitTask('do something', ['cap'])).rejects.toThrow('Node not started');
  });

  it('should allow submitTask after start', async () => {
    const node = createNode();
    await startAndTrack(node);
    const taskId = await node.submitTask('task', ['research']);
    expect(typeof taskId).toBe('string');
    expect(taskId.length).toBeGreaterThan(0);
  });

  it('should clear heartbeat on stop (no more heartbeats sent)', async () => {
    const node = createNode({
      config: { ...TEST_CONFIG, heartbeatInterval: 50 },
    });

    await startAndTrack(node);
    await node.stop();
    // Remove from tracking since we already stopped
    startedNodes.pop();

    const submitMessage = node.getHederaClient().submitMessage as jest.Mock;
    const callsAtStop = submitMessage.mock.calls.length;

    await new Promise((r) => setTimeout(r, 150));
    expect(submitMessage.mock.calls.length).toBe(callsAtStop);
  });

  it('should emit started event with the profile', async () => {
    const node = createNode({ agentName: 'EventNode' });
    const spy = jest.fn();
    node.on('started', spy);

    await startAndTrack(node);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'EventNode' }));
  });

  it('should emit stopped event on stop', async () => {
    const node = createNode();
    await startAndTrack(node);

    const spy = jest.fn();
    node.on('stopped', spy);
    await node.stop();
    // Already stopped, remove from tracking
    startedNodes.pop();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should be safe to call stop without starting', async () => {
    const node = createNode();
    await expect(node.stop()).resolves.toBeUndefined();
  });

  it('should close the Hedera client on stop', async () => {
    const node = createNode();
    await startAndTrack(node);
    await node.stop();
    startedNodes.pop();

    expect(node.getHederaClient().close).toHaveBeenCalled();
  });

  it('should set profile status to active on start', async () => {
    const node = createNode();
    const profile = await startAndTrack(node);
    expect(profile.status).toBe('active');
  });
});

// ====================================================================
// 5. MeshNode discoverAgents
// ====================================================================

describe('MeshNode discoverAgents delegation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMockClient();
  });

  it('should return an AgentDiscoveryResult', () => {
    const node = createNode();
    const result = node.discoverAgents();
    expect(result).toBeDefined();
    expect(result).toHaveProperty('agents');
    expect(result).toHaveProperty('totalFound');
    expect(result).toHaveProperty('queryTime');
  });

  it('should delegate with capability filter', () => {
    const node = createNode();
    const registry = node.getRegistry();
    const spy = jest.spyOn(registry, 'discoverAgents');

    node.discoverAgents('web_research');

    expect(spy).toHaveBeenCalledWith({ capability: 'web_research', status: 'active' });
  });

  it('should delegate without capability filter', () => {
    const node = createNode();
    const registry = node.getRegistry();
    const spy = jest.spyOn(registry, 'discoverAgents');

    node.discoverAgents();

    expect(spy).toHaveBeenCalledWith({ capability: undefined, status: 'active' });
  });

  it('should always pass status "active"', () => {
    const node = createNode();
    const registry = node.getRegistry();
    const spy = jest.spyOn(registry, 'discoverAgents');

    node.discoverAgents('anything');

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('should return empty agents when registry is empty', () => {
    const node = createNode();
    const result = node.discoverAgents('web_research');
    expect(result.agents).toEqual([]);
    expect(result.totalFound).toBe(0);
  });
});

// ====================================================================
// 6. TaskCoordinator edge cases
// ====================================================================

describe('TaskCoordinator edge cases', () => {
  let coordinator: TaskCoordinator;

  beforeEach(() => {
    jest.clearAllMocks();
    setupMockClient();
    const client = new HederaClient(TEST_CONFIG);
    const registry = new AgentRegistry(client);
    coordinator = new TaskCoordinator(client, registry);
  });

  it('should return undefined for getTask with nonexistent id', () => {
    expect(coordinator.getTask('nonexistent-id')).toBeUndefined();
  });

  it('should return empty array from getAllTasks when no tasks exist', () => {
    expect(coordinator.getAllTasks()).toEqual([]);
  });

  it('should return 0 from getTaskCount when empty', () => {
    expect(coordinator.getTaskCount()).toBe(0);
  });

  it('should return empty bids for unknown task', () => {
    expect(coordinator.getTaskBids('unknown-task')).toEqual([]);
  });

  it('should return empty assignments for unknown task', () => {
    expect(coordinator.getTaskAssignments('unknown-task')).toEqual([]);
  });

  it('should return undefined for getTaskResult on unknown task', () => {
    expect(coordinator.getTaskResult('unknown-task')).toBeUndefined();
  });

  it('should return null from selectBestBid when no bids exist', () => {
    expect(coordinator.selectBestBid('no-such-task')).toBeNull();
  });

  it('should initialize with existing topic id', async () => {
    const topicId = await coordinator.initialize('0.0.888');
    expect(topicId).toBe('0.0.888');
    expect(coordinator.getCoordinationTopicId()).toBe('0.0.888');
  });

  it('should initialize by creating new topic when no id provided', async () => {
    const topicId = await coordinator.initialize();
    expect(topicId).toBe('0.0.100'); // from mock
  });

  it('should throw on getCoordinationTopicId before initialize', () => {
    const freshCoordinator = new TaskCoordinator(
      new HederaClient(TEST_CONFIG),
      new AgentRegistry(new HederaClient(TEST_CONFIG)),
    );
    expect(() => freshCoordinator.getCoordinationTopicId()).toThrow('Coordinator not initialized');
  });

  it('should submit a task and increment task count', async () => {
    await coordinator.initialize('0.0.888');

    const taskId = await coordinator.submitTask({
      description: 'Test task',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'medium',
      requesterId: 'agent-1',
    });

    expect(typeof taskId).toBe('string');
    expect(coordinator.getTaskCount()).toBe(1);
    expect(coordinator.getTask(taskId)).toBeDefined();
    expect(coordinator.getAllTasks()).toHaveLength(1);
  });

  it('should track multiple tasks independently', async () => {
    await coordinator.initialize('0.0.888');

    const id1 = await coordinator.submitTask({
      description: 'Task 1',
      requiredCapabilities: ['cap1'],
      payload: {},
      priority: 'low',
      requesterId: 'agent-1',
    });

    const id2 = await coordinator.submitTask({
      description: 'Task 2',
      requiredCapabilities: ['cap2'],
      payload: { extra: true },
      priority: 'high',
      requesterId: 'agent-2',
    });

    expect(coordinator.getTaskCount()).toBe(2);
    expect(coordinator.getTask(id1)!.description).toBe('Task 1');
    expect(coordinator.getTask(id2)!.description).toBe('Task 2');
    expect(id1).not.toBe(id2);
  });

  it('should throw on submitTask before initialize', async () => {
    const fresh = new TaskCoordinator(
      new HederaClient(TEST_CONFIG),
      new AgentRegistry(new HederaClient(TEST_CONFIG)),
    );
    await expect(
      fresh.submitTask({
        description: 'Test',
        requiredCapabilities: [],
        payload: {},
        priority: 'medium',
        requesterId: 'x',
      }),
    ).rejects.toThrow('Coordinator not initialized');
  });
});

// ====================================================================
// 7. AgentRegistry discoverAgents filtering
// ====================================================================

describe('AgentRegistry discoverAgents filtering', () => {
  let registry: AgentRegistry;

  function makeProfile(overrides: Partial<AgentProfile> & { id: string }): AgentProfile {
    return {
      name: 'Agent',
      description: 'Default',
      capabilities: [],
      hederaAccountId: '0.0.1',
      inboundTopicId: '0.0.2',
      outboundTopicId: '0.0.3',
      registryTopicId: '0.0.4',
      status: 'active',
      createdAt: Date.now(),
      metadata: {},
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    setupMockClient();
    const client = new HederaClient(TEST_CONFIG);
    registry = new AgentRegistry(client);
    await registry.initialize('0.0.999');
  });

  it('should return all agents when no filter is applied', async () => {
    await registry.registerAgent(makeProfile({ id: 'a1', name: 'Alpha' }));
    await registry.registerAgent(makeProfile({ id: 'a2', name: 'Beta' }));

    const result = registry.discoverAgents();
    expect(result.agents).toHaveLength(2);
    expect(result.totalFound).toBe(2);
  });

  it('should filter by status', async () => {
    await registry.registerAgent(makeProfile({ id: 'a1', status: 'active' }));
    await registry.registerAgent(makeProfile({ id: 'a2', status: 'inactive' }));
    await registry.registerAgent(makeProfile({ id: 'a3', status: 'busy' }));

    const activeResult = registry.discoverAgents({ status: 'active' });
    expect(activeResult.agents).toHaveLength(1);
    expect(activeResult.agents[0]!.id).toBe('a1');

    const inactiveResult = registry.discoverAgents({ status: 'inactive' });
    expect(inactiveResult.agents).toHaveLength(1);
    expect(inactiveResult.agents[0]!.id).toBe('a2');

    const busyResult = registry.discoverAgents({ status: 'busy' });
    expect(busyResult.agents).toHaveLength(1);
    expect(busyResult.agents[0]!.id).toBe('a3');
  });

  it('should filter by capability name', async () => {
    await registry.registerAgent(
      makeProfile({
        id: 'researcher',
        capabilities: [{ name: 'web_research', description: 'Web research', inputSchema: {}, outputSchema: {} }],
      }),
    );
    await registry.registerAgent(
      makeProfile({
        id: 'coder',
        capabilities: [{ name: 'code_generation', description: 'Code gen', inputSchema: {}, outputSchema: {} }],
      }),
    );

    const result = registry.discoverAgents({ capability: 'web_research' });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]!.id).toBe('researcher');
  });

  it('should do case-insensitive capability matching', async () => {
    await registry.registerAgent(
      makeProfile({
        id: 'a1',
        capabilities: [{ name: 'Web_Research', description: 'Research', inputSchema: {}, outputSchema: {} }],
      }),
    );

    const result = registry.discoverAgents({ capability: 'web_research' });
    expect(result.agents).toHaveLength(1);
  });

  it('should match capability by description too', async () => {
    await registry.registerAgent(
      makeProfile({
        id: 'a1',
        capabilities: [{ name: 'analyze', description: 'Perform data analysis', inputSchema: {}, outputSchema: {} }],
      }),
    );

    const result = registry.discoverAgents({ capability: 'data analysis' });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]!.id).toBe('a1');
  });

  it('should apply combined status and capability filters', async () => {
    await registry.registerAgent(
      makeProfile({
        id: 'active-researcher',
        status: 'active',
        capabilities: [{ name: 'research', description: 'Research', inputSchema: {}, outputSchema: {} }],
      }),
    );
    await registry.registerAgent(
      makeProfile({
        id: 'inactive-researcher',
        status: 'inactive',
        capabilities: [{ name: 'research', description: 'Research', inputSchema: {}, outputSchema: {} }],
      }),
    );
    await registry.registerAgent(
      makeProfile({
        id: 'active-coder',
        status: 'active',
        capabilities: [{ name: 'coding', description: 'Coding', inputSchema: {}, outputSchema: {} }],
      }),
    );

    const result = registry.discoverAgents({ status: 'active', capability: 'research' });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]!.id).toBe('active-researcher');
  });

  it('should limit results with maxResults', async () => {
    await registry.registerAgent(makeProfile({ id: 'a1' }));
    await registry.registerAgent(makeProfile({ id: 'a2' }));
    await registry.registerAgent(makeProfile({ id: 'a3' }));

    const result = registry.discoverAgents({ maxResults: 2 });
    expect(result.agents).toHaveLength(2);
  });

  it('should return empty when no agents match filter', async () => {
    await registry.registerAgent(makeProfile({ id: 'a1', status: 'inactive' }));

    const result = registry.discoverAgents({ status: 'active' });
    expect(result.agents).toHaveLength(0);
    expect(result.totalFound).toBe(0);
  });

  it('should return empty when registry has no agents', () => {
    const result = registry.discoverAgents();
    expect(result.agents).toEqual([]);
    expect(result.totalFound).toBe(0);
  });

  it('should include queryTime in the result', async () => {
    await registry.registerAgent(makeProfile({ id: 'a1' }));

    const result = registry.discoverAgents();
    expect(typeof result.queryTime).toBe('number');
    expect(result.queryTime).toBeGreaterThanOrEqual(0);
  });

  it('should support partial capability name matching', async () => {
    await registry.registerAgent(
      makeProfile({
        id: 'a1',
        capabilities: [{ name: 'web_research_advanced', description: 'Advanced research', inputSchema: {}, outputSchema: {} }],
      }),
    );

    const result = registry.discoverAgents({ capability: 'research' });
    expect(result.agents).toHaveLength(1);
  });

  it('should match agents with multiple capabilities', async () => {
    await registry.registerAgent(
      makeProfile({
        id: 'multi',
        capabilities: [
          { name: 'research', description: 'Research', inputSchema: {}, outputSchema: {} },
          { name: 'coding', description: 'Code gen', inputSchema: {}, outputSchema: {} },
        ],
      }),
    );

    const researchResult = registry.discoverAgents({ capability: 'research' });
    expect(researchResult.agents).toHaveLength(1);

    const codingResult = registry.discoverAgents({ capability: 'coding' });
    expect(codingResult.agents).toHaveLength(1);
  });
});
