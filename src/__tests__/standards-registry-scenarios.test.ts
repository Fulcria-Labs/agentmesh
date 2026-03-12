/**
 * StandardsRegistry - Comprehensive search, profile conversion, and edge case tests
 */

import { StandardsRegistry } from '../hol/standards-registry';
import { MeshConfig, AgentProfile } from '../core/types';
import { AIAgentCapability } from '@hashgraphonline/standards-sdk';

jest.mock('@hashgraphonline/standards-sdk', () => {
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
    0: 'KNOWLEDGE_RETRIEVAL',
    1: 'SUMMARIZATION_EXTRACTION',
    2: 'DATA_INTEGRATION',
    3: 'MARKET_INTELLIGENCE',
    4: 'TRANSACTION_ANALYTICS',
    5: 'MULTI_AGENT_COORDINATION',
    6: 'LANGUAGE_TRANSLATION',
    7: 'CODE_GENERATION',
    8: 'TEXT_GENERATION',
    9: 'IMAGE_GENERATION',
    10: 'WORKFLOW_AUTOMATION',
    11: 'SMART_CONTRACT_AUDIT',
    12: 'SECURITY_MONITORING',
    13: 'COMPLIANCE_ANALYSIS',
    14: 'FRAUD_DETECTION',
    15: 'API_INTEGRATION',
  };

  return {
    HCS10Client: jest.fn().mockImplementation(() => ({
      searchRegistrations: jest.fn().mockResolvedValue({
        registrations: [
          {
            accountId: '0.0.100',
            inboundTopicId: '0.0.101',
            outboundTopicId: '0.0.102',
            registryTopicId: '0.0.103',
            metadata: {
              display_name: 'Agent Alpha',
              bio: 'First test agent',
              capabilities: [0, 5],
              ai_agent: { model: 'gpt-4', creator: 'TestCorp' },
            },
          },
          {
            accountId: '0.0.200',
            inboundTopicId: '0.0.201',
            outboundTopicId: '0.0.202',
            registryTopicId: '0.0.203',
            metadata: {
              name: 'Agent Beta',
              description: 'Second test agent',
              capabilities: [2, 3],
              ai_agent: { model: 'claude-3', creator: 'AnotherCorp' },
            },
          },
        ],
      }),
      createRegistryTopic: jest.fn().mockResolvedValue({
        success: true,
        topicId: '0.0.999',
      }),
    })),
    AIAgentCapability: mockAIAgentCapability,
  };
});

const TEST_CONFIG: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.1',
  operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
};

describe('StandardsRegistry - Comprehensive', () => {
  let registry: StandardsRegistry;

  beforeEach(() => {
    registry = new StandardsRegistry(TEST_CONFIG);
  });

  describe('Constructor', () => {
    it('should create with testnet config', () => {
      expect(registry).toBeDefined();
    });

    it('should create with mainnet config', () => {
      const mainnetRegistry = new StandardsRegistry({
        ...TEST_CONFIG,
        network: 'mainnet',
      });
      expect(mainnetRegistry).toBeDefined();
    });
  });

  describe('searchAgents', () => {
    it('should return agents from registry', async () => {
      const agents = await registry.searchAgents();
      expect(agents).toHaveLength(2);
    });

    it('should map agent fields correctly for display_name', async () => {
      const agents = await registry.searchAgents();
      const alpha = agents.find(a => a.accountId === '0.0.100');
      expect(alpha!.name).toBe('Agent Alpha');
      expect(alpha!.description).toBe('First test agent');
    });

    it('should fall back to name metadata field', async () => {
      const agents = await registry.searchAgents();
      const beta = agents.find(a => a.accountId === '0.0.200');
      expect(beta!.name).toBe('Agent Beta');
    });

    it('should fall back to description metadata field', async () => {
      const agents = await registry.searchAgents();
      const beta = agents.find(a => a.accountId === '0.0.200');
      expect(beta!.description).toBe('Second test agent');
    });

    it('should include topic IDs', async () => {
      const agents = await registry.searchAgents();
      expect(agents[0].inboundTopicId).toBe('0.0.101');
      expect(agents[0].outboundTopicId).toBe('0.0.102');
      expect(agents[0].registryTopicId).toBe('0.0.103');
    });

    it('should include AI agent metadata', async () => {
      const agents = await registry.searchAgents();
      expect(agents[0].model).toBe('gpt-4');
      expect(agents[0].creator).toBe('TestCorp');
    });

    it('should include capabilities', async () => {
      const agents = await registry.searchAgents();
      expect(agents[0].capabilities).toEqual([0, 5]);
    });

    it('should respect maxResults option', async () => {
      const agents = await registry.searchAgents({ maxResults: 1 });
      expect(agents).toHaveLength(1);
    });

    it('should pass capabilities filter to search', async () => {
      const agents = await registry.searchAgents({
        capabilities: [AIAgentCapability.KNOWLEDGE_RETRIEVAL],
      });
      expect(agents).toBeDefined();
    });

    it('should pass accountId filter to search', async () => {
      const agents = await registry.searchAgents({
        accountId: '0.0.100',
      });
      expect(agents).toBeDefined();
    });

    it('should handle no options', async () => {
      const agents = await registry.searchAgents();
      expect(agents.length).toBeGreaterThan(0);
    });

    it('should handle empty options', async () => {
      const agents = await registry.searchAgents({});
      expect(agents.length).toBeGreaterThan(0);
    });
  });

  describe('toMeshProfile', () => {
    it('should convert registry agent to mesh profile', () => {
      const agent = {
        accountId: '0.0.100',
        inboundTopicId: '0.0.101',
        outboundTopicId: '0.0.102',
        name: 'TestAgent',
        description: 'A test agent',
        capabilities: [AIAgentCapability.KNOWLEDGE_RETRIEVAL],
        model: 'gpt-4',
        creator: 'TestCorp',
        registryTopicId: '0.0.103',
      };

      const profile = registry.toMeshProfile(agent);
      expect(profile.id).toBe('0.0.100');
      expect(profile.name).toBe('TestAgent');
      expect(profile.status).toBe('active');
    });

    it('should map KNOWLEDGE_RETRIEVAL to web_research', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [AIAgentCapability.KNOWLEDGE_RETRIEVAL],
        registryTopicId: '0.0.4',
      };

      const profile = registry.toMeshProfile(agent);
      expect(profile.capabilities[0].name).toBe('web_research');
    });

    it('should map SUMMARIZATION_EXTRACTION to summarize', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [AIAgentCapability.SUMMARIZATION_EXTRACTION],
        registryTopicId: '0.0.4',
      };

      const profile = registry.toMeshProfile(agent);
      expect(profile.capabilities[0].name).toBe('summarize');
    });

    it('should map DATA_INTEGRATION to data_analysis', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [AIAgentCapability.DATA_INTEGRATION],
        registryTopicId: '0.0.4',
      };

      const profile = registry.toMeshProfile(agent);
      expect(profile.capabilities[0].name).toBe('data_analysis');
    });

    it('should map MULTI_AGENT_COORDINATION to task_decomposition', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [AIAgentCapability.MULTI_AGENT_COORDINATION],
        registryTopicId: '0.0.4',
      };

      const profile = registry.toMeshProfile(agent);
      expect(profile.capabilities[0].name).toBe('task_decomposition');
    });

    it('should handle unknown capabilities with fallback name', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [99 as AIAgentCapability],
        registryTopicId: '0.0.4',
      };

      const profile = registry.toMeshProfile(agent);
      expect(profile.capabilities[0].name).toBe('hcs11_cap_99');
    });

    it('should set hederaAccountId from accountId', () => {
      const agent = {
        accountId: '0.0.555',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [],
        registryTopicId: '0.0.4',
      };

      const profile = registry.toMeshProfile(agent);
      expect(profile.hederaAccountId).toBe('0.0.555');
    });

    it('should set source metadata to hol-registry', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [],
        registryTopicId: '0.0.4',
      };

      const profile = registry.toMeshProfile(agent);
      expect(profile.metadata.source).toBe('hol-registry');
    });

    it('should include model in metadata', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [],
        model: 'gpt-4',
        registryTopicId: '0.0.4',
      };

      const profile = registry.toMeshProfile(agent);
      expect(profile.metadata.model).toBe('gpt-4');
    });

    it('should handle missing model', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [],
        registryTopicId: '0.0.4',
      };

      const profile = registry.toMeshProfile(agent);
      expect(profile.metadata.model).toBe('');
    });

    it('should handle missing creator', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [],
        registryTopicId: '0.0.4',
      };

      const profile = registry.toMeshProfile(agent);
      expect(profile.metadata.creator).toBe('');
    });

    it('should set createdAt to current time', () => {
      const before = Date.now();
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [],
        registryTopicId: '0.0.4',
      };

      const profile = registry.toMeshProfile(agent);
      const after = Date.now();
      expect(profile.createdAt).toBeGreaterThanOrEqual(before);
      expect(profile.createdAt).toBeLessThanOrEqual(after);
    });

    it('should convert multiple capabilities', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [
          AIAgentCapability.KNOWLEDGE_RETRIEVAL,
          AIAgentCapability.DATA_INTEGRATION,
          AIAgentCapability.MULTI_AGENT_COORDINATION,
        ],
        registryTopicId: '0.0.4',
      };

      const profile = registry.toMeshProfile(agent);
      expect(profile.capabilities).toHaveLength(3);
      const names = profile.capabilities.map(c => c.name);
      expect(names).toContain('web_research');
      expect(names).toContain('data_analysis');
      expect(names).toContain('task_decomposition');
    });
  });

  describe('discoverMeshAgents', () => {
    it('should return AgentProfile array', async () => {
      const profiles = await registry.discoverMeshAgents();
      expect(profiles).toHaveLength(2);
      profiles.forEach(p => {
        expect(p).toHaveProperty('id');
        expect(p).toHaveProperty('name');
        expect(p).toHaveProperty('capabilities');
        expect(p).toHaveProperty('status');
      });
    });

    it('should pass options through to searchAgents', async () => {
      const profiles = await registry.discoverMeshAgents({ maxResults: 1 });
      expect(profiles).toHaveLength(1);
    });

    it('should convert all agents to mesh profiles', async () => {
      const profiles = await registry.discoverMeshAgents();
      expect(profiles[0].status).toBe('active');
      expect(profiles[0].metadata.source).toBe('hol-registry');
    });
  });

  describe('createRegistryTopic', () => {
    it('should create a registry topic', async () => {
      const topicId = await registry.createRegistryTopic();
      expect(topicId).toBe('0.0.999');
    });

    it('should accept custom name', async () => {
      const topicId = await registry.createRegistryTopic({ name: 'Custom Registry' });
      expect(topicId).toBe('0.0.999');
    });

    it('should accept custom description', async () => {
      const topicId = await registry.createRegistryTopic({ description: 'My custom registry' });
      expect(topicId).toBe('0.0.999');
    });

    it('should accept both name and description', async () => {
      const topicId = await registry.createRegistryTopic({
        name: 'My Registry',
        description: 'A custom registry for agents',
      });
      expect(topicId).toBe('0.0.999');
    });
  });

  describe('Capability Mapping Completeness', () => {
    it('should map LANGUAGE_TRANSLATION to translate', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [AIAgentCapability.LANGUAGE_TRANSLATION],
        registryTopicId: '0.0.4',
      };
      const profile = registry.toMeshProfile(agent);
      expect(profile.capabilities[0].name).toBe('translate');
    });

    it('should map CODE_GENERATION to code_generation', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [AIAgentCapability.CODE_GENERATION],
        registryTopicId: '0.0.4',
      };
      const profile = registry.toMeshProfile(agent);
      expect(profile.capabilities[0].name).toBe('code_generation');
    });

    it('should map WORKFLOW_AUTOMATION to workflow_automation', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [AIAgentCapability.WORKFLOW_AUTOMATION],
        registryTopicId: '0.0.4',
      };
      const profile = registry.toMeshProfile(agent);
      expect(profile.capabilities[0].name).toBe('workflow_automation');
    });

    it('should map SECURITY_MONITORING to security_monitoring', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [AIAgentCapability.SECURITY_MONITORING],
        registryTopicId: '0.0.4',
      };
      const profile = registry.toMeshProfile(agent);
      expect(profile.capabilities[0].name).toBe('security_monitoring');
    });

    it('should map FRAUD_DETECTION to fraud_detection', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [AIAgentCapability.FRAUD_DETECTION],
        registryTopicId: '0.0.4',
      };
      const profile = registry.toMeshProfile(agent);
      expect(profile.capabilities[0].name).toBe('fraud_detection');
    });

    it('should map API_INTEGRATION to api_integration', () => {
      const agent = {
        accountId: '0.0.1',
        inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3',
        name: 'Agent',
        description: '',
        capabilities: [AIAgentCapability.API_INTEGRATION],
        registryTopicId: '0.0.4',
      };
      const profile = registry.toMeshProfile(agent);
      expect(profile.capabilities[0].name).toBe('api_integration');
    });
  });
});
