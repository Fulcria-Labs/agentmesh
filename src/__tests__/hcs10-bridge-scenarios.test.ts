/**
 * HCS10Bridge - Comprehensive capability mapping, connection management, event tests
 */

import { HCS10Bridge, HCS10BridgeConfig } from '../hol/hcs10-bridge';
import { AgentCapability, MeshConfig } from '../core/types';
import { AIAgentCapability, InboundTopicType } from '@hashgraphonline/standards-sdk';

jest.mock('@hashgraphonline/standards-sdk', () => {
  const mockInboundTopicType = { PUBLIC: 0, CONTROLLED: 1, FEE_BASED: 2 };
  const mockAIAgentCapability = {
    KNOWLEDGE_RETRIEVAL: 0,
    SUMMARIZATION_EXTRACTION: 1,
    DATA_INTEGRATION: 2,
    MARKET_INTELLIGENCE: 3,
    TRANSACTION_ANALYTICS: 4,
    MULTI_AGENT_COORDINATION: 5,
    LANGUAGE_TRANSLATION: 6,
    CODE_GENERATION: 7,
    TEXT_GENERATION: 8,
    IMAGE_GENERATION: 9,
    WORKFLOW_AUTOMATION: 10,
    SMART_CONTRACT_AUDIT: 11,
    SECURITY_MONITORING: 12,
    COMPLIANCE_ANALYSIS: 13,
    FRAUD_DETECTION: 14,
    API_INTEGRATION: 15,
  };
  const mockAIAgentType = { AUTONOMOUS: 'autonomous', MANUAL: 'manual' };
  return {
    HCS10Client: jest.fn().mockImplementation(() => ({
      createAgent: jest.fn().mockResolvedValue({
        inboundTopicId: '0.0.300',
        outboundTopicId: '0.0.301',
        profileTopicId: '0.0.302',
        pfpTopicId: '0.0.303',
      }),
      createAndRegisterAgent: jest.fn().mockResolvedValue({
        success: true,
        agentAccountId: '0.0.400',
        inboundTopicId: '0.0.401',
        outboundTopicId: '0.0.402',
      }),
      handleConnectionRequest: jest.fn().mockResolvedValue({
        connectionTopicId: '0.0.500',
      }),
      sendMessage: jest.fn().mockResolvedValue(undefined),
      searchRegistrations: jest.fn().mockResolvedValue({
        registrations: [],
      }),
      createRegistryTopic: jest.fn().mockResolvedValue({
        success: true,
        topicId: '0.0.600',
      }),
    })),
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
    AIAgentCapability: mockAIAgentCapability,
    AIAgentType: mockAIAgentType,
    InboundTopicType: mockInboundTopicType,
  };
});

const TEST_CONFIG: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.1',
  operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
};

describe('HCS10Bridge - Comprehensive', () => {
  let bridge: HCS10Bridge;

  beforeEach(() => {
    bridge = new HCS10Bridge({
      meshConfig: TEST_CONFIG,
    });
  });

  describe('Constructor', () => {
    it('should create with minimal config', () => {
      expect(bridge).toBeDefined();
    });

    it('should create with guarded registry option', () => {
      const b = new HCS10Bridge({
        meshConfig: TEST_CONFIG,
        useGuardedRegistry: true,
      });
      expect(b).toBeDefined();
    });

    it('should create with custom inbound topic type', () => {
      const b = new HCS10Bridge({
        meshConfig: TEST_CONFIG,
        inboundTopicType: InboundTopicType.CONTROLLED,
      });
      expect(b).toBeDefined();
    });

    it('should create with progress callback', () => {
      const callback = jest.fn();
      const b = new HCS10Bridge({
        meshConfig: TEST_CONFIG,
        progressCallback: callback,
      });
      expect(b).toBeDefined();
    });
  });

  describe('getClient', () => {
    it('should return the HCS10Client instance', () => {
      const client = bridge.getClient();
      expect(client).toBeDefined();
    });
  });

  describe('mapCapabilities', () => {
    it('should map web_research to KNOWLEDGE_RETRIEVAL', () => {
      const caps: AgentCapability[] = [
        { name: 'web_research', description: '', inputSchema: {}, outputSchema: {} },
      ];
      const mapped = bridge.mapCapabilities(caps);
      expect(mapped).toContain(AIAgentCapability.KNOWLEDGE_RETRIEVAL);
    });

    it('should map summarize to SUMMARIZATION_EXTRACTION', () => {
      const caps: AgentCapability[] = [
        { name: 'summarize', description: '', inputSchema: {}, outputSchema: {} },
      ];
      const mapped = bridge.mapCapabilities(caps);
      expect(mapped).toContain(AIAgentCapability.SUMMARIZATION_EXTRACTION);
    });

    it('should map data_analysis to DATA_INTEGRATION', () => {
      const caps: AgentCapability[] = [
        { name: 'data_analysis', description: '', inputSchema: {}, outputSchema: {} },
      ];
      const mapped = bridge.mapCapabilities(caps);
      expect(mapped).toContain(AIAgentCapability.DATA_INTEGRATION);
    });

    it('should map sentiment_analysis to MARKET_INTELLIGENCE', () => {
      const caps: AgentCapability[] = [
        { name: 'sentiment_analysis', description: '', inputSchema: {}, outputSchema: {} },
      ];
      const mapped = bridge.mapCapabilities(caps);
      expect(mapped).toContain(AIAgentCapability.MARKET_INTELLIGENCE);
    });

    it('should map risk_assessment to TRANSACTION_ANALYTICS', () => {
      const caps: AgentCapability[] = [
        { name: 'risk_assessment', description: '', inputSchema: {}, outputSchema: {} },
      ];
      const mapped = bridge.mapCapabilities(caps);
      expect(mapped).toContain(AIAgentCapability.TRANSACTION_ANALYTICS);
    });

    it('should map task_decomposition to MULTI_AGENT_COORDINATION', () => {
      const caps: AgentCapability[] = [
        { name: 'task_decomposition', description: '', inputSchema: {}, outputSchema: {} },
      ];
      const mapped = bridge.mapCapabilities(caps);
      expect(mapped).toContain(AIAgentCapability.MULTI_AGENT_COORDINATION);
    });

    it('should always include MULTI_AGENT_COORDINATION', () => {
      const caps: AgentCapability[] = [
        { name: 'web_research', description: '', inputSchema: {}, outputSchema: {} },
      ];
      const mapped = bridge.mapCapabilities(caps);
      expect(mapped).toContain(AIAgentCapability.MULTI_AGENT_COORDINATION);
    });

    it('should handle empty capabilities', () => {
      const mapped = bridge.mapCapabilities([]);
      expect(mapped).toContain(AIAgentCapability.MULTI_AGENT_COORDINATION);
      expect(mapped).toHaveLength(1);
    });

    it('should handle unknown capability names', () => {
      const caps: AgentCapability[] = [
        { name: 'unknown_cap', description: '', inputSchema: {}, outputSchema: {} },
      ];
      const mapped = bridge.mapCapabilities(caps);
      // Only MULTI_AGENT_COORDINATION since unknown_cap isn't mapped
      expect(mapped).toContain(AIAgentCapability.MULTI_AGENT_COORDINATION);
    });

    it('should deduplicate mapped capabilities', () => {
      const caps: AgentCapability[] = [
        { name: 'web_research', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'fact_check', description: '', inputSchema: {}, outputSchema: {} },
        // Both map to KNOWLEDGE_RETRIEVAL
      ];
      const mapped = bridge.mapCapabilities(caps);
      const knowledgeCount = mapped.filter(c => c === AIAgentCapability.KNOWLEDGE_RETRIEVAL).length;
      expect(knowledgeCount).toBe(1);
    });

    it('should map all known capabilities', () => {
      const allCaps: AgentCapability[] = [
        { name: 'web_research', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'summarize', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'data_analysis', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'sentiment_analysis', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'risk_assessment', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'task_decomposition', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'translate', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'code_generation', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'text_generation', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'image_generation', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'workflow_automation', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'smart_contract_audit', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'security_monitoring', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'compliance_analysis', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'fraud_detection', description: '', inputSchema: {}, outputSchema: {} },
        { name: 'api_integration', description: '', inputSchema: {}, outputSchema: {} },
      ];
      const mapped = bridge.mapCapabilities(allCaps);
      // Should have many unique capabilities
      expect(mapped.length).toBeGreaterThan(5);
    });

    it('should map result_synthesis to SUMMARIZATION_EXTRACTION', () => {
      const caps: AgentCapability[] = [
        { name: 'result_synthesis', description: '', inputSchema: {}, outputSchema: {} },
      ];
      const mapped = bridge.mapCapabilities(caps);
      expect(mapped).toContain(AIAgentCapability.SUMMARIZATION_EXTRACTION);
    });

    it('should map agent_selection to MULTI_AGENT_COORDINATION', () => {
      const caps: AgentCapability[] = [
        { name: 'agent_selection', description: '', inputSchema: {}, outputSchema: {} },
      ];
      const mapped = bridge.mapCapabilities(caps);
      expect(mapped).toContain(AIAgentCapability.MULTI_AGENT_COORDINATION);
    });
  });

  describe('Connection Management', () => {
    it('should handle connection request', async () => {
      const result = await bridge.handleConnectionRequest(
        '0.0.100',
        '0.0.999',
        1
      );

      expect(result.connectionTopicId).toBe('0.0.500');
    });

    it('should store connection after handling request', async () => {
      await bridge.handleConnectionRequest('0.0.100', '0.0.999', 1);

      const topic = bridge.getConnectionTopic('0.0.999');
      expect(topic).toBe('0.0.500');
    });

    it('should emit connection:established event', async () => {
      const handler = jest.fn();
      bridge.on('connection:established', handler);

      await bridge.handleConnectionRequest('0.0.100', '0.0.999', 1);

      expect(handler).toHaveBeenCalledWith({
        accountId: '0.0.999',
        connectionTopicId: '0.0.500',
      });
    });

    it('should return undefined for non-existent connection', () => {
      expect(bridge.getConnectionTopic('0.0.nonexistent')).toBeUndefined();
    });

    it('should track multiple connections', async () => {
      await bridge.handleConnectionRequest('0.0.100', '0.0.991', 1);
      await bridge.handleConnectionRequest('0.0.100', '0.0.992', 2);
      await bridge.handleConnectionRequest('0.0.100', '0.0.993', 3);

      const connections = bridge.getConnections();
      expect(connections.size).toBe(3);
    });

    it('should return independent copy from getConnections', async () => {
      await bridge.handleConnectionRequest('0.0.100', '0.0.999', 1);

      const connections = bridge.getConnections();
      connections.clear(); // Modifying copy shouldn't affect bridge

      expect(bridge.getConnectionTopic('0.0.999')).toBe('0.0.500');
    });
  });

  describe('Send Message', () => {
    it('should send message to connection topic', async () => {
      await bridge.sendMessage('0.0.500', 'Hello, agent!');

      const client = bridge.getClient();
      expect(client.sendMessage).toHaveBeenCalledWith('0.0.500', 'Hello, agent!', undefined);
    });

    it('should send message with memo', async () => {
      await bridge.sendMessage('0.0.500', 'data', 'memo-text');

      const client = bridge.getClient();
      expect(client.sendMessage).toHaveBeenCalledWith('0.0.500', 'data', 'memo-text');
    });

    it('should send JSON data as string', async () => {
      const data = JSON.stringify({ action: 'request', payload: { key: 'value' } });
      await bridge.sendMessage('0.0.500', data);

      const client = bridge.getClient();
      expect(client.sendMessage).toHaveBeenCalledWith('0.0.500', data, undefined);
    });
  });

  describe('Create Standards Agent', () => {
    it('should create agent with required fields', async () => {
      const result = await bridge.createStandardsAgent({
        id: 'agent-1',
        name: 'TestAgent',
        description: 'Test agent description',
        capabilities: [
          { name: 'web_research', description: 'Research', inputSchema: {}, outputSchema: {} },
        ],
        hederaAccountId: '0.0.1',
        status: 'active',
        metadata: {},
      });

      expect(result.inboundTopicId).toBe('0.0.300');
      expect(result.outboundTopicId).toBe('0.0.301');
      expect(result.profileTopicId).toBe('0.0.302');
      expect(result.pfpTopicId).toBe('0.0.303');
      expect(result.hcs10Client).toBeDefined();
    });

    it('should emit progress events during creation', async () => {
      const handler = jest.fn();
      bridge.on('progress', handler);

      await bridge.createStandardsAgent({
        id: 'agent-1',
        name: 'TestAgent',
        description: 'Test',
        capabilities: [],
        hederaAccountId: '0.0.1',
        status: 'active',
        metadata: {},
      });

      expect(handler).toHaveBeenCalled();
      const stages = handler.mock.calls.map((c: any) => c[0].stage);
      expect(stages).toContain('preparing');
      expect(stages).toContain('completed');
    });

    it('should accept model option', async () => {
      const result = await bridge.createStandardsAgent(
        {
          id: 'agent-1',
          name: 'ModelAgent',
          description: 'Agent with model',
          capabilities: [],
          hederaAccountId: '0.0.1',
          status: 'active',
          metadata: {},
        },
        { model: 'gpt-4' }
      );

      expect(result).toBeDefined();
    });

    it('should accept creator option', async () => {
      const result = await bridge.createStandardsAgent(
        {
          id: 'agent-1',
          name: 'CreatorAgent',
          description: 'Agent with creator',
          capabilities: [],
          hederaAccountId: '0.0.1',
          status: 'active',
          metadata: {},
        },
        { creator: 'AgentMesh Team' }
      );

      expect(result).toBeDefined();
    });

    it('should accept pfp options', async () => {
      const result = await bridge.createStandardsAgent(
        {
          id: 'agent-1',
          name: 'PfpAgent',
          description: 'Agent with pfp',
          capabilities: [],
          hederaAccountId: '0.0.1',
          status: 'active',
          metadata: {},
        },
        { pfpBuffer: Buffer.from('fake-image'), pfpFileName: 'avatar.png' }
      );

      expect(result).toBeDefined();
    });
  });

  describe('Create and Register Agent', () => {
    it('should create and register in one step', async () => {
      const result = await bridge.createAndRegisterAgent({
        id: 'agent-1',
        name: 'RegisteredAgent',
        description: 'Agent to register',
        capabilities: [
          { name: 'data_analysis', description: 'Analyze', inputSchema: {}, outputSchema: {} },
        ],
        hederaAccountId: '0.0.1',
        status: 'active',
        metadata: {},
      });

      expect(result).toBeDefined();
    });

    it('should accept all optional parameters', async () => {
      const result = await bridge.createAndRegisterAgent(
        {
          id: 'agent-1',
          name: 'FullAgent',
          description: 'Full registration',
          capabilities: [],
          hederaAccountId: '0.0.1',
          status: 'active',
          metadata: {},
        },
        {
          model: 'claude-3',
          creator: 'AgentMesh',
          pfpBuffer: Buffer.from('image'),
          pfpFileName: 'photo.jpg',
          initialBalance: 50,
        }
      );

      expect(result).toBeDefined();
    });
  });

  describe('EventEmitter', () => {
    it('should support event listeners', () => {
      const handler = jest.fn();
      bridge.on('test', handler);
      bridge.emit('test', 'data');
      expect(handler).toHaveBeenCalledWith('data');
    });

    it('should support removeListener', () => {
      const handler = jest.fn();
      bridge.on('test', handler);
      bridge.removeListener('test', handler);
      bridge.emit('test', 'data');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should support once', () => {
      const handler = jest.fn();
      bridge.once('oneshot', handler);
      bridge.emit('oneshot', 'first');
      bridge.emit('oneshot', 'second');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
