/**
 * StandardsRegistry - Agent discovery through HOL ecosystem
 *
 * Integrates with the Hashgraph Online Guarded Registry for
 * global agent discovery across the HCS-10 ecosystem.
 */

import {
  HCS10Client,
  AIAgentCapability,
} from '@hashgraphonline/standards-sdk';
import type {
  HCSClientConfig,
  RegistrationSearchResult,
} from '@hashgraphonline/standards-sdk';
import { MeshConfig, AgentProfile, AgentCapability } from '../core/types';

export interface RegistrySearchOptions {
  /** Filter by HCS-11 capability tags */
  capabilities?: AIAgentCapability[];
  /** Filter by account ID */
  accountId?: string;
  /** Maximum results */
  maxResults?: number;
}

export interface RegistryAgent {
  accountId: string;
  inboundTopicId: string;
  outboundTopicId: string;
  name: string;
  description: string;
  capabilities: AIAgentCapability[];
  model?: string;
  creator?: string;
  registryTopicId: string;
}

/**
 * Reverse map from HCS-11 capabilities to AgentMesh capability names
 */
const REVERSE_CAPABILITY_MAP: Record<number, string> = {
  [AIAgentCapability.KNOWLEDGE_RETRIEVAL]: 'web_research',
  [AIAgentCapability.SUMMARIZATION_EXTRACTION]: 'summarize',
  [AIAgentCapability.DATA_INTEGRATION]: 'data_analysis',
  [AIAgentCapability.MARKET_INTELLIGENCE]: 'sentiment_analysis',
  [AIAgentCapability.TRANSACTION_ANALYTICS]: 'risk_assessment',
  [AIAgentCapability.MULTI_AGENT_COORDINATION]: 'task_decomposition',
  [AIAgentCapability.LANGUAGE_TRANSLATION]: 'translate',
  [AIAgentCapability.CODE_GENERATION]: 'code_generation',
  [AIAgentCapability.TEXT_GENERATION]: 'text_generation',
  [AIAgentCapability.IMAGE_GENERATION]: 'image_generation',
  [AIAgentCapability.WORKFLOW_AUTOMATION]: 'workflow_automation',
  [AIAgentCapability.SMART_CONTRACT_AUDIT]: 'smart_contract_audit',
  [AIAgentCapability.SECURITY_MONITORING]: 'security_monitoring',
  [AIAgentCapability.COMPLIANCE_ANALYSIS]: 'compliance_analysis',
  [AIAgentCapability.FRAUD_DETECTION]: 'fraud_detection',
  [AIAgentCapability.API_INTEGRATION]: 'api_integration',
};

export class StandardsRegistry {
  private hcs10Client: HCS10Client;
  private config: MeshConfig;

  constructor(config: MeshConfig) {
    this.config = config;

    const clientConfig: HCSClientConfig = {
      network: config.network as 'testnet' | 'mainnet',
      operatorId: config.operatorAccountId,
      operatorPrivateKey: config.operatorPrivateKey,
      logLevel: 'error' as any,
    };

    this.hcs10Client = new HCS10Client(clientConfig);
  }

  /**
   * Search the HOL Guarded Registry for agents matching criteria
   */
  async searchAgents(options?: RegistrySearchOptions): Promise<RegistryAgent[]> {
    const searchOptions: any = {
      network: this.config.network,
    };

    if (options?.capabilities) {
      searchOptions.tags = options.capabilities;
    }
    if (options?.accountId) {
      searchOptions.accountId = options.accountId;
    }

    const result = await (this.hcs10Client as any).searchRegistrations(searchOptions);

    if (!result?.registrations) {
      return [];
    }

    let agents: RegistryAgent[] = result.registrations.map((reg: any) => ({
      accountId: reg.accountId,
      inboundTopicId: reg.inboundTopicId,
      outboundTopicId: reg.outboundTopicId,
      name: reg.metadata?.display_name || reg.metadata?.name || 'Unknown',
      description: reg.metadata?.bio || reg.metadata?.description || '',
      capabilities: reg.metadata?.capabilities || [],
      model: reg.metadata?.ai_agent?.model,
      creator: reg.metadata?.ai_agent?.creator,
      registryTopicId: reg.registryTopicId,
    }));

    if (options?.maxResults) {
      agents = agents.slice(0, options.maxResults);
    }

    return agents;
  }

  /**
   * Convert a HOL registry agent to an AgentMesh AgentProfile
   */
  toMeshProfile(agent: RegistryAgent): AgentProfile {
    const capabilities: AgentCapability[] = agent.capabilities.map(cap => {
      const name = REVERSE_CAPABILITY_MAP[cap] || `hcs11_cap_${cap}`;
      return {
        name,
        description: `HCS-11 capability: ${AIAgentCapability[cap] || cap}`,
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      };
    });

    return {
      id: agent.accountId,
      name: agent.name,
      description: agent.description,
      capabilities,
      hederaAccountId: agent.accountId,
      inboundTopicId: agent.inboundTopicId,
      outboundTopicId: agent.outboundTopicId,
      registryTopicId: agent.registryTopicId,
      status: 'active',
      createdAt: Date.now(),
      metadata: {
        source: 'hol-registry',
        model: agent.model || '',
        creator: agent.creator || '',
      },
    };
  }

  /**
   * Search for agents and return them as AgentMesh profiles
   */
  async discoverMeshAgents(options?: RegistrySearchOptions): Promise<AgentProfile[]> {
    const agents = await this.searchAgents(options);
    return agents.map(a => this.toMeshProfile(a));
  }

  /**
   * Create a new registry topic for custom agent directories
   */
  async createRegistryTopic(options?: {
    name?: string;
    description?: string;
  }): Promise<string> {
    const result = await this.hcs10Client.createRegistryTopic({
      metadata: {
        version: '1.0.0',
        name: options?.name || 'AgentMesh Registry',
        description: options?.description || 'AgentMesh decentralized agent coordination registry',
        operator: {
          account: this.config.operatorAccountId,
          name: 'AgentMesh',
        },
        categories: ['ai-agents', 'multi-agent', 'coordination'],
        tags: ['agentmesh', 'hcs-10', 'mcp'],
      },
    });

    if (!result.success || !result.topicId) {
      throw new Error(`Failed to create registry topic: ${result.error}`);
    }

    return result.topicId;
  }
}
