/**
 * Tests for HCS10Bridge - HCS-10/HCS-11 standards integration
 */

import { HCS10Bridge } from '../hol/hcs10-bridge';
import { AIAgentCapability } from '@hashgraphonline/standards-sdk';
import { AgentCapability, MeshConfig } from '../core/types';

// Mock the standards SDK
jest.mock('@hashgraphonline/standards-sdk', () => {
  const AIAgentCapability = {
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
  };

  const InboundTopicType = {
    PUBLIC: 'public',
    CONTROLLED: 'controlled',
    FEE_BASED: 'fee_based',
  };

  const mockHCS10Client = {
    createAgent: jest.fn().mockResolvedValue({
      inboundTopicId: '0.0.1001',
      outboundTopicId: '0.0.1002',
      profileTopicId: '0.0.1003',
      pfpTopicId: '0.0.1004',
    }),
    createAndRegisterAgent: jest.fn().mockResolvedValue({
      success: true,
      transactionId: '0.0.123@1234567890',
      confirmed: true,
      state: { currentStage: 'complete', completedPercentage: 100 },
      metadata: { capabilities: [AIAgentCapability.MULTI_AGENT_COORDINATION] },
    }),
    handleConnectionRequest: jest.fn().mockResolvedValue({
      connectionTopicId: '0.0.2001',
      confirmedConnectionSequenceNumber: 1,
      operatorId: '0.0.100',
    }),
    sendMessage: jest.fn().mockResolvedValue({}),
    getClient: jest.fn(),
    getOperatorAccountId: jest.fn().mockReturnValue('0.0.100'),
    getNetwork: jest.fn().mockReturnValue('testnet'),
  };

  return {
    HCS10Client: jest.fn().mockImplementation(() => mockHCS10Client),
    AgentBuilder: jest.fn().mockImplementation(() => ({
      setName: jest.fn().mockReturnThis(),
      setBio: jest.fn().mockReturnThis(),
      setType: jest.fn().mockReturnThis(),
      setCapabilities: jest.fn().mockReturnThis(),
      setNetwork: jest.fn().mockReturnThis(),
      setInboundTopicType: jest.fn().mockReturnThis(),
      setModel: jest.fn().mockReturnThis(),
      setCreator: jest.fn().mockReturnThis(),
      setProfilePicture: jest.fn().mockReturnThis(),
      addProperty: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({}),
    })),
    AIAgentCapability,
    AIAgentType: { MANUAL: 0, AUTONOMOUS: 1 },
    InboundTopicType,
    __mockClient: mockHCS10Client,
  };
});

const { __mockClient: mockClient } = require('@hashgraphonline/standards-sdk');

const TEST_CONFIG: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.100',
  operatorPrivateKey: 'test_key_for_unit_tests',
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
  {
    name: 'data_analysis',
    description: 'Analyze data sets',
    inputSchema: { type: 'object', properties: { data: { type: 'object' } } },
    outputSchema: { type: 'object', properties: { analysis: { type: 'object' } } },
  },
];

describe('HCS10Bridge', () => {
  let bridge: HCS10Bridge;

  beforeEach(() => {
    jest.clearAllMocks();
    bridge = new HCS10Bridge({
      meshConfig: TEST_CONFIG,
    });
  });

  describe('constructor', () => {
    it('should create bridge with mesh config', () => {
      expect(bridge).toBeDefined();
      expect(bridge.getClient()).toBeDefined();
    });

    it('should pass config to HCS10Client', () => {
      const { HCS10Client } = require('@hashgraphonline/standards-sdk');
      expect(HCS10Client).toHaveBeenCalledWith(
        expect.objectContaining({
          network: 'testnet',
          operatorId: '0.0.100',
          operatorPrivateKey: 'test_key_for_unit_tests',
        })
      );
    });
  });

  describe('mapCapabilities', () => {
    it('should map web_research to KNOWLEDGE_RETRIEVAL', () => {
      const caps = bridge.mapCapabilities([TEST_CAPABILITIES[0]!]);
      expect(caps).toContain(AIAgentCapability.KNOWLEDGE_RETRIEVAL);
    });

    it('should map summarize to SUMMARIZATION_EXTRACTION', () => {
      const caps = bridge.mapCapabilities([TEST_CAPABILITIES[1]!]);
      expect(caps).toContain(AIAgentCapability.SUMMARIZATION_EXTRACTION);
    });

    it('should map data_analysis to DATA_INTEGRATION', () => {
      const caps = bridge.mapCapabilities([TEST_CAPABILITIES[2]!]);
      expect(caps).toContain(AIAgentCapability.DATA_INTEGRATION);
    });

    it('should always include MULTI_AGENT_COORDINATION', () => {
      const caps = bridge.mapCapabilities([]);
      expect(caps).toContain(AIAgentCapability.MULTI_AGENT_COORDINATION);
    });

    it('should deduplicate capabilities', () => {
      const caps = bridge.mapCapabilities([
        TEST_CAPABILITIES[0]!,
        {
          name: 'fact_check',
          description: 'Check facts',
          inputSchema: { type: 'object', properties: {} },
          outputSchema: { type: 'object', properties: {} },
        },
      ]);
      // Both web_research and fact_check map to KNOWLEDGE_RETRIEVAL
      const retrieval = caps.filter(c => c === AIAgentCapability.KNOWLEDGE_RETRIEVAL);
      expect(retrieval).toHaveLength(1);
    });

    it('should handle multiple capabilities', () => {
      const caps = bridge.mapCapabilities(TEST_CAPABILITIES);
      expect(caps.length).toBeGreaterThanOrEqual(4); // 3 mapped + MULTI_AGENT_COORDINATION
      expect(caps).toContain(AIAgentCapability.KNOWLEDGE_RETRIEVAL);
      expect(caps).toContain(AIAgentCapability.SUMMARIZATION_EXTRACTION);
      expect(caps).toContain(AIAgentCapability.DATA_INTEGRATION);
      expect(caps).toContain(AIAgentCapability.MULTI_AGENT_COORDINATION);
    });

    it('should handle unknown capabilities gracefully', () => {
      const caps = bridge.mapCapabilities([
        {
          name: 'unknown_capability',
          description: 'Unknown',
          inputSchema: { type: 'object', properties: {} },
          outputSchema: { type: 'object', properties: {} },
        },
      ]);
      // Should still have MULTI_AGENT_COORDINATION
      expect(caps).toContain(AIAgentCapability.MULTI_AGENT_COORDINATION);
      expect(caps).toHaveLength(1);
    });

    it('should map translate to LANGUAGE_TRANSLATION', () => {
      const caps = bridge.mapCapabilities([{
        name: 'translate',
        description: 'Translate text',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      }]);
      expect(caps).toContain(AIAgentCapability.LANGUAGE_TRANSLATION);
    });

    it('should map sentiment_analysis to MARKET_INTELLIGENCE', () => {
      const caps = bridge.mapCapabilities([{
        name: 'sentiment_analysis',
        description: 'Analyze sentiment',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      }]);
      expect(caps).toContain(AIAgentCapability.MARKET_INTELLIGENCE);
    });

    it('should map risk_assessment to TRANSACTION_ANALYTICS', () => {
      const caps = bridge.mapCapabilities([{
        name: 'risk_assessment',
        description: 'Assess risk',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      }]);
      expect(caps).toContain(AIAgentCapability.TRANSACTION_ANALYTICS);
    });

    it('should map task_decomposition to MULTI_AGENT_COORDINATION', () => {
      const caps = bridge.mapCapabilities([{
        name: 'task_decomposition',
        description: 'Decompose tasks',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      }]);
      expect(caps).toContain(AIAgentCapability.MULTI_AGENT_COORDINATION);
    });

    it('should map all supported capabilities', () => {
      const allCaps: AgentCapability[] = [
        'web_research', 'summarize', 'fact_check', 'data_analysis',
        'sentiment_analysis', 'risk_assessment', 'task_decomposition',
        'result_synthesis', 'agent_selection', 'translate',
        'code_generation', 'text_generation', 'image_generation',
        'workflow_automation', 'smart_contract_audit', 'security_monitoring',
        'compliance_analysis', 'fraud_detection', 'api_integration',
      ].map(name => ({
        name,
        description: name,
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      }));

      const mapped = bridge.mapCapabilities(allCaps);
      expect(mapped.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('createStandardsAgent', () => {
    const agentProfile = {
      id: 'test-agent',
      name: 'TestAgent',
      description: 'A test agent',
      capabilities: TEST_CAPABILITIES,
      hederaAccountId: '0.0.100',
      status: 'active' as const,
      metadata: {},
    };

    it('should create a standards-compliant agent', async () => {
      const result = await bridge.createStandardsAgent(agentProfile);

      expect(result.inboundTopicId).toBe('0.0.1001');
      expect(result.outboundTopicId).toBe('0.0.1002');
      expect(result.profileTopicId).toBe('0.0.1003');
      expect(result.pfpTopicId).toBe('0.0.1004');
      expect(result.hcs10Client).toBeDefined();
    });

    it('should use AgentBuilder with correct properties', async () => {
      const { AgentBuilder } = require('@hashgraphonline/standards-sdk');
      await bridge.createStandardsAgent(agentProfile);

      const builderInstance = AgentBuilder.mock.results[AgentBuilder.mock.results.length - 1].value;
      expect(builderInstance.setName).toHaveBeenCalledWith('TestAgent');
      expect(builderInstance.setBio).toHaveBeenCalledWith('A test agent');
      expect(builderInstance.setType).toHaveBeenCalledWith('autonomous');
      expect(builderInstance.setNetwork).toHaveBeenCalledWith('testnet');
    });

    it('should set model when provided', async () => {
      const { AgentBuilder } = require('@hashgraphonline/standards-sdk');
      await bridge.createStandardsAgent(agentProfile, { model: 'gpt-4' });

      const builderInstance = AgentBuilder.mock.results[AgentBuilder.mock.results.length - 1].value;
      expect(builderInstance.setModel).toHaveBeenCalledWith('gpt-4');
    });

    it('should set creator when provided', async () => {
      const { AgentBuilder } = require('@hashgraphonline/standards-sdk');
      await bridge.createStandardsAgent(agentProfile, { creator: 'AgentMesh' });

      const builderInstance = AgentBuilder.mock.results[AgentBuilder.mock.results.length - 1].value;
      expect(builderInstance.setCreator).toHaveBeenCalledWith('AgentMesh');
    });

    it('should add framework metadata', async () => {
      const { AgentBuilder } = require('@hashgraphonline/standards-sdk');
      await bridge.createStandardsAgent(agentProfile);

      const builderInstance = AgentBuilder.mock.results[AgentBuilder.mock.results.length - 1].value;
      expect(builderInstance.addProperty).toHaveBeenCalledWith('framework', 'AgentMesh');
      expect(builderInstance.addProperty).toHaveBeenCalledWith('version', '1.0.0');
    });

    it('should emit progress events', async () => {
      const events: string[] = [];
      bridge.on('progress', (data: any) => events.push(data.stage));

      await bridge.createStandardsAgent(agentProfile);

      expect(events).toContain('preparing');
      expect(events).toContain('completed');
    });

    it('should call createAgent on HCS10Client', async () => {
      await bridge.createStandardsAgent(agentProfile);
      expect(mockClient.createAgent).toHaveBeenCalled();
    });
  });

  describe('createAndRegisterAgent', () => {
    const agentProfile = {
      id: 'test-agent',
      name: 'TestAgent',
      description: 'A test agent',
      capabilities: TEST_CAPABILITIES,
      hederaAccountId: '0.0.100',
      status: 'active' as const,
      metadata: {},
    };

    it('should register agent with guarded registry', async () => {
      const result = await bridge.createAndRegisterAgent(agentProfile);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBeDefined();
      expect(result.confirmed).toBe(true);
    });

    it('should pass initial balance option', async () => {
      await bridge.createAndRegisterAgent(agentProfile, { initialBalance: 100 });

      expect(mockClient.createAndRegisterAgent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ initialBalance: 100 })
      );
    });
  });

  describe('handleConnectionRequest', () => {
    it('should handle connection and store topic', async () => {
      const result = await bridge.handleConnectionRequest(
        '0.0.1001',
        '0.0.200',
        1
      );

      expect(result.connectionTopicId).toBe('0.0.2001');
      expect(bridge.getConnectionTopic('0.0.200')).toBe('0.0.2001');
    });

    it('should emit connection event', async () => {
      const events: any[] = [];
      bridge.on('connection:established', (data: any) => events.push(data));

      await bridge.handleConnectionRequest('0.0.1001', '0.0.200', 1);

      expect(events).toHaveLength(1);
      expect(events[0].accountId).toBe('0.0.200');
      expect(events[0].connectionTopicId).toBe('0.0.2001');
    });
  });

  describe('sendMessage', () => {
    it('should send message via HCS10Client', async () => {
      await bridge.sendMessage('0.0.2001', 'Hello agent!', 'greeting');
      expect(mockClient.sendMessage).toHaveBeenCalledWith('0.0.2001', 'Hello agent!', 'greeting');
    });
  });

  describe('getConnections', () => {
    it('should return empty map initially', () => {
      const connections = bridge.getConnections();
      expect(connections.size).toBe(0);
    });

    it('should return connections after establishing them', async () => {
      await bridge.handleConnectionRequest('0.0.1001', '0.0.200', 1);
      await bridge.handleConnectionRequest('0.0.1001', '0.0.300', 2);

      const connections = bridge.getConnections();
      expect(connections.size).toBe(2);
      expect(connections.get('0.0.200')).toBe('0.0.2001');
    });

    it('should return a copy of connections (not the original)', async () => {
      await bridge.handleConnectionRequest('0.0.1001', '0.0.200', 1);

      const connections = bridge.getConnections();
      connections.delete('0.0.200');

      expect(bridge.getConnectionTopic('0.0.200')).toBe('0.0.2001');
    });
  });
});
