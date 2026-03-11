/**
 * Tests for StandardsRegistry - HOL Guarded Registry integration
 */

import { StandardsRegistry } from '../hol/standards-registry';
import { AIAgentCapability } from '@hashgraphonline/standards-sdk';
import { MeshConfig } from '../core/types';

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
    // Reverse mapping for name lookup
    0: 'TEXT_GENERATION',
    1: 'IMAGE_GENERATION',
    4: 'CODE_GENERATION',
    5: 'LANGUAGE_TRANSLATION',
    6: 'SUMMARIZATION_EXTRACTION',
    7: 'KNOWLEDGE_RETRIEVAL',
    8: 'DATA_INTEGRATION',
    9: 'MARKET_INTELLIGENCE',
    10: 'TRANSACTION_ANALYTICS',
    16: 'MULTI_AGENT_COORDINATION',
  };

  const mockRegistrations = [
    {
      accountId: '0.0.200',
      inboundTopicId: '0.0.2001',
      outboundTopicId: '0.0.2002',
      registryTopicId: '0.0.5000',
      metadata: {
        display_name: 'ResearchBot',
        bio: 'A research-focused AI agent',
        capabilities: [AIAgentCapability.KNOWLEDGE_RETRIEVAL, AIAgentCapability.SUMMARIZATION_EXTRACTION],
        ai_agent: { model: 'gpt-4', creator: 'TestOrg' },
      },
    },
    {
      accountId: '0.0.300',
      inboundTopicId: '0.0.3001',
      outboundTopicId: '0.0.3002',
      registryTopicId: '0.0.5000',
      metadata: {
        display_name: 'AnalystBot',
        bio: 'Data analysis specialist',
        capabilities: [AIAgentCapability.DATA_INTEGRATION, AIAgentCapability.MARKET_INTELLIGENCE],
        ai_agent: { model: 'claude-3', creator: 'TestOrg' },
      },
    },
    {
      accountId: '0.0.400',
      inboundTopicId: '0.0.4001',
      outboundTopicId: '0.0.4002',
      registryTopicId: '0.0.5000',
      metadata: {
        name: 'CoordBot',
        description: 'Multi-agent coordinator',
        capabilities: [AIAgentCapability.MULTI_AGENT_COORDINATION],
      },
    },
  ];

  const mockHCS10Client = {
    searchRegistrations: jest.fn().mockResolvedValue({
      registrations: mockRegistrations,
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
    AIAgentCapability,
    __mockClient: mockHCS10Client,
    __mockRegistrations: mockRegistrations,
  };
});

const { __mockClient: mockClient } = require('@hashgraphonline/standards-sdk');

const TEST_CONFIG: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.100',
  operatorPrivateKey: 'test_key_for_unit_tests',
};

describe('StandardsRegistry', () => {
  let registry: StandardsRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new StandardsRegistry(TEST_CONFIG);
  });

  describe('constructor', () => {
    it('should create registry with config', () => {
      expect(registry).toBeDefined();
    });

    it('should initialize HCS10Client with correct config', () => {
      const { HCS10Client } = require('@hashgraphonline/standards-sdk');
      expect(HCS10Client).toHaveBeenCalledWith(
        expect.objectContaining({
          network: 'testnet',
          operatorId: '0.0.100',
        })
      );
    });
  });

  describe('searchAgents', () => {
    it('should return agents from registry', async () => {
      const agents = await registry.searchAgents();

      expect(agents).toHaveLength(3);
      expect(agents[0]!.name).toBe('ResearchBot');
      expect(agents[1]!.name).toBe('AnalystBot');
      expect(agents[2]!.name).toBe('CoordBot');
    });

    it('should include agent details', async () => {
      const agents = await registry.searchAgents();

      expect(agents[0]!.accountId).toBe('0.0.200');
      expect(agents[0]!.inboundTopicId).toBe('0.0.2001');
      expect(agents[0]!.outboundTopicId).toBe('0.0.2002');
      expect(agents[0]!.description).toBe('A research-focused AI agent');
      expect(agents[0]!.model).toBe('gpt-4');
      expect(agents[0]!.creator).toBe('TestOrg');
    });

    it('should handle agents with name instead of display_name', async () => {
      const agents = await registry.searchAgents();
      expect(agents[2]!.name).toBe('CoordBot');
    });

    it('should handle agents with description instead of bio', async () => {
      const agents = await registry.searchAgents();
      expect(agents[2]!.description).toBe('Multi-agent coordinator');
    });

    it('should handle agents without model/creator', async () => {
      const agents = await registry.searchAgents();
      expect(agents[2]!.model).toBeUndefined();
      expect(agents[2]!.creator).toBeUndefined();
    });

    it('should limit results with maxResults', async () => {
      const agents = await registry.searchAgents({ maxResults: 2 });
      expect(agents).toHaveLength(2);
    });

    it('should pass capabilities filter', async () => {
      await registry.searchAgents({
        capabilities: [AIAgentCapability.KNOWLEDGE_RETRIEVAL],
      });

      expect(mockClient.searchRegistrations).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: [AIAgentCapability.KNOWLEDGE_RETRIEVAL],
        })
      );
    });

    it('should pass accountId filter', async () => {
      await registry.searchAgents({ accountId: '0.0.200' });

      expect(mockClient.searchRegistrations).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: '0.0.200',
        })
      );
    });

    it('should handle empty results', async () => {
      mockClient.searchRegistrations.mockResolvedValueOnce({
        registrations: [],
        success: true,
      });

      const agents = await registry.searchAgents();
      expect(agents).toHaveLength(0);
    });

    it('should handle null result', async () => {
      mockClient.searchRegistrations.mockResolvedValueOnce(null);

      const agents = await registry.searchAgents();
      expect(agents).toHaveLength(0);
    });

    it('should handle missing registrations field', async () => {
      mockClient.searchRegistrations.mockResolvedValueOnce({ success: true });

      const agents = await registry.searchAgents();
      expect(agents).toHaveLength(0);
    });
  });

  describe('toMeshProfile', () => {
    it('should convert registry agent to AgentProfile', () => {
      const registryAgent = {
        accountId: '0.0.200',
        inboundTopicId: '0.0.2001',
        outboundTopicId: '0.0.2002',
        name: 'TestAgent',
        description: 'A test agent',
        capabilities: [AIAgentCapability.KNOWLEDGE_RETRIEVAL, AIAgentCapability.MULTI_AGENT_COORDINATION],
        model: 'gpt-4',
        creator: 'TestOrg',
        registryTopicId: '0.0.5000',
      };

      const profile = registry.toMeshProfile(registryAgent);

      expect(profile.id).toBe('0.0.200');
      expect(profile.name).toBe('TestAgent');
      expect(profile.description).toBe('A test agent');
      expect(profile.hederaAccountId).toBe('0.0.200');
      expect(profile.inboundTopicId).toBe('0.0.2001');
      expect(profile.outboundTopicId).toBe('0.0.2002');
      expect(profile.registryTopicId).toBe('0.0.5000');
      expect(profile.status).toBe('active');
      expect(profile.metadata.source).toBe('hol-registry');
      expect(profile.metadata.model).toBe('gpt-4');
      expect(profile.metadata.creator).toBe('TestOrg');
    });

    it('should map HCS-11 capabilities to AgentMesh capabilities', () => {
      const registryAgent = {
        accountId: '0.0.200',
        inboundTopicId: '0.0.2001',
        outboundTopicId: '0.0.2002',
        name: 'TestAgent',
        description: 'Test',
        capabilities: [AIAgentCapability.KNOWLEDGE_RETRIEVAL],
        registryTopicId: '0.0.5000',
      };

      const profile = registry.toMeshProfile(registryAgent);

      expect(profile.capabilities).toHaveLength(1);
      expect(profile.capabilities[0]!.name).toBe('web_research');
    });

    it('should handle capabilities without reverse mapping', () => {
      const registryAgent = {
        accountId: '0.0.200',
        inboundTopicId: '0.0.2001',
        outboundTopicId: '0.0.2002',
        name: 'TestAgent',
        description: 'Test',
        capabilities: [99], // Unknown capability
        registryTopicId: '0.0.5000',
      };

      const profile = registry.toMeshProfile(registryAgent);

      expect(profile.capabilities).toHaveLength(1);
      expect(profile.capabilities[0]!.name).toBe('hcs11_cap_99');
    });

    it('should handle missing model and creator', () => {
      const registryAgent = {
        accountId: '0.0.200',
        inboundTopicId: '0.0.2001',
        outboundTopicId: '0.0.2002',
        name: 'TestAgent',
        description: 'Test',
        capabilities: [],
        registryTopicId: '0.0.5000',
      };

      const profile = registry.toMeshProfile(registryAgent);

      expect(profile.metadata.model).toBe('');
      expect(profile.metadata.creator).toBe('');
    });
  });

  describe('discoverMeshAgents', () => {
    it('should return AgentProfile array', async () => {
      const profiles = await registry.discoverMeshAgents();

      expect(profiles).toHaveLength(3);
      expect(profiles[0]!.name).toBe('ResearchBot');
      expect(profiles[0]!.id).toBe('0.0.200');
      expect(profiles[0]!.status).toBe('active');
    });

    it('should properly map capabilities in discovered agents', async () => {
      const profiles = await registry.discoverMeshAgents();

      const researchBot = profiles[0]!;
      const capNames = researchBot.capabilities.map(c => c.name);
      expect(capNames).toContain('web_research');
      expect(capNames).toContain('summarize');
    });

    it('should respect maxResults', async () => {
      const profiles = await registry.discoverMeshAgents({ maxResults: 1 });
      expect(profiles).toHaveLength(1);
    });
  });

  describe('createRegistryTopic', () => {
    it('should create registry topic with defaults', async () => {
      const topicId = await registry.createRegistryTopic();

      expect(topicId).toBe('0.0.6000');
      expect(mockClient.createRegistryTopic).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            name: 'AgentMesh Registry',
            version: '1.0.0',
          }),
        })
      );
    });

    it('should create registry topic with custom name', async () => {
      const topicId = await registry.createRegistryTopic({
        name: 'Custom Registry',
        description: 'My custom registry',
      });

      expect(topicId).toBe('0.0.6000');
      expect(mockClient.createRegistryTopic).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            name: 'Custom Registry',
            description: 'My custom registry',
          }),
        })
      );
    });

    it('should include AgentMesh tags in registry metadata', async () => {
      await registry.createRegistryTopic();

      expect(mockClient.createRegistryTopic).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            tags: ['agentmesh', 'hcs-10', 'mcp'],
            categories: ['ai-agents', 'multi-agent', 'coordination'],
          }),
        })
      );
    });

    it('should throw on failure', async () => {
      mockClient.createRegistryTopic.mockResolvedValueOnce({
        success: false,
        error: 'Insufficient balance',
      });

      await expect(registry.createRegistryTopic()).rejects.toThrow('Insufficient balance');
    });

    it('should throw when topicId is missing', async () => {
      mockClient.createRegistryTopic.mockResolvedValueOnce({
        success: true,
        topicId: null,
      });

      await expect(registry.createRegistryTopic()).rejects.toThrow();
    });
  });
});
