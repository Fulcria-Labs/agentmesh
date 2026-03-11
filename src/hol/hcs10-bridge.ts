/**
 * HCS10Bridge - Bridge between AgentMesh and HCS-10/HCS-11 standards
 *
 * Enables AgentMesh agents to register with the Hashgraph Online (HOL)
 * ecosystem using proper HCS-10 communication standards and HCS-11 profiles.
 */

import {
  HCS10Client,
  AgentBuilder,
  AIAgentCapability,
  AIAgentType,
  InboundTopicType,
} from '@hashgraphonline/standards-sdk';
import type {
  HCSClientConfig,
  CreateAgentResponse,
  AgentRegistrationResult,
  RegistrationProgressCallback,
  HandleConnectionRequestResponse,
} from '@hashgraphonline/standards-sdk';
import { AgentProfile, AgentCapability, MeshConfig } from '../core/types';
import { EventEmitter } from 'events';

/**
 * Maps AgentMesh capability names to HCS-11 AIAgentCapability enum values
 */
const CAPABILITY_MAP: Record<string, AIAgentCapability> = {
  web_research: AIAgentCapability.KNOWLEDGE_RETRIEVAL,
  summarize: AIAgentCapability.SUMMARIZATION_EXTRACTION,
  fact_check: AIAgentCapability.KNOWLEDGE_RETRIEVAL,
  data_analysis: AIAgentCapability.DATA_INTEGRATION,
  sentiment_analysis: AIAgentCapability.MARKET_INTELLIGENCE,
  risk_assessment: AIAgentCapability.TRANSACTION_ANALYTICS,
  task_decomposition: AIAgentCapability.MULTI_AGENT_COORDINATION,
  result_synthesis: AIAgentCapability.SUMMARIZATION_EXTRACTION,
  agent_selection: AIAgentCapability.MULTI_AGENT_COORDINATION,
  translate: AIAgentCapability.LANGUAGE_TRANSLATION,
  code_generation: AIAgentCapability.CODE_GENERATION,
  text_generation: AIAgentCapability.TEXT_GENERATION,
  image_generation: AIAgentCapability.IMAGE_GENERATION,
  workflow_automation: AIAgentCapability.WORKFLOW_AUTOMATION,
  smart_contract_audit: AIAgentCapability.SMART_CONTRACT_AUDIT,
  security_monitoring: AIAgentCapability.SECURITY_MONITORING,
  compliance_analysis: AIAgentCapability.COMPLIANCE_ANALYSIS,
  fraud_detection: AIAgentCapability.FRAUD_DETECTION,
  api_integration: AIAgentCapability.API_INTEGRATION,
};

export interface HCS10BridgeConfig {
  meshConfig: MeshConfig;
  /** Use the HOL Guarded Registry for agent registration */
  useGuardedRegistry?: boolean;
  /** Inbound topic type: public (default), controlled, or fee-based */
  inboundTopicType?: InboundTopicType;
  /** Progress callback for registration steps */
  progressCallback?: RegistrationProgressCallback;
}

export interface StandardsAgentInfo {
  inboundTopicId: string;
  outboundTopicId: string;
  profileTopicId: string;
  pfpTopicId: string;
  hcs10Client: HCS10Client;
}

export class HCS10Bridge extends EventEmitter {
  private hcs10Client: HCS10Client;
  private config: HCS10BridgeConfig;
  private connections: Map<string, string> = new Map(); // agentId -> connectionTopicId

  constructor(config: HCS10BridgeConfig) {
    super();
    this.config = config;

    const clientConfig: HCSClientConfig = {
      network: config.meshConfig.network as 'testnet' | 'mainnet',
      operatorId: config.meshConfig.operatorAccountId,
      operatorPrivateKey: config.meshConfig.operatorPrivateKey,
      logLevel: 'error' as any,
    };

    this.hcs10Client = new HCS10Client(clientConfig);
  }

  getClient(): HCS10Client {
    return this.hcs10Client;
  }

  /**
   * Maps AgentMesh capabilities to HCS-11 AIAgentCapability values
   */
  mapCapabilities(capabilities: AgentCapability[]): AIAgentCapability[] {
    const mapped = new Set<AIAgentCapability>();

    for (const cap of capabilities) {
      const hcs11Cap = CAPABILITY_MAP[cap.name];
      if (hcs11Cap !== undefined) {
        mapped.add(hcs11Cap);
      }
    }

    // Always include MULTI_AGENT_COORDINATION since AgentMesh is a coordination framework
    mapped.add(AIAgentCapability.MULTI_AGENT_COORDINATION);

    return Array.from(mapped);
  }

  /**
   * Creates a standards-compliant HCS-10 agent with HCS-11 profile
   */
  async createStandardsAgent(
    profile: Omit<AgentProfile, 'inboundTopicId' | 'outboundTopicId' | 'registryTopicId' | 'createdAt'>,
    options?: {
      model?: string;
      creator?: string;
      pfpBuffer?: Buffer;
      pfpFileName?: string;
    }
  ): Promise<StandardsAgentInfo> {
    const builder = new AgentBuilder();
    builder.setName(profile.name);
    builder.setBio(profile.description);
    builder.setType('autonomous');
    builder.setCapabilities(this.mapCapabilities(profile.capabilities));
    builder.setNetwork(this.config.meshConfig.network as 'testnet' | 'mainnet');
    builder.setInboundTopicType(
      this.config.inboundTopicType || InboundTopicType.PUBLIC
    );

    if (options?.model) {
      builder.setModel(options.model);
    }
    if (options?.creator) {
      builder.setCreator(options.creator);
    }
    if (options?.pfpBuffer && options?.pfpFileName) {
      builder.setProfilePicture(options.pfpBuffer, options.pfpFileName);
    }

    // Add AgentMesh metadata
    builder.addProperty('framework', 'AgentMesh');
    builder.addProperty('version', '1.0.0');
    builder.addProperty('meshCapabilities', profile.capabilities.map(c => c.name).join(','));

    this.emit('progress', { stage: 'preparing', message: 'Creating HCS-10 agent...' });

    const response: CreateAgentResponse = await this.hcs10Client.createAgent(
      builder,
      60,
      undefined,
      this.config.progressCallback
    );

    this.emit('progress', { stage: 'completed', message: 'Agent created with HCS-10 standards' });

    return {
      inboundTopicId: response.inboundTopicId,
      outboundTopicId: response.outboundTopicId,
      profileTopicId: response.profileTopicId,
      pfpTopicId: response.pfpTopicId,
      hcs10Client: this.hcs10Client,
    };
  }

  /**
   * Creates and registers an agent with the HOL Guarded Registry
   * This enables global discovery through the HOL ecosystem
   */
  async createAndRegisterAgent(
    profile: Omit<AgentProfile, 'inboundTopicId' | 'outboundTopicId' | 'registryTopicId' | 'createdAt'>,
    options?: {
      model?: string;
      creator?: string;
      pfpBuffer?: Buffer;
      pfpFileName?: string;
      initialBalance?: number;
    }
  ): Promise<AgentRegistrationResult> {
    const builder = new AgentBuilder();
    builder.setName(profile.name);
    builder.setBio(profile.description);
    builder.setType('autonomous');
    builder.setCapabilities(this.mapCapabilities(profile.capabilities));
    builder.setNetwork(this.config.meshConfig.network as 'testnet' | 'mainnet');

    if (options?.model) builder.setModel(options.model);
    if (options?.creator) builder.setCreator(options.creator);
    if (options?.pfpBuffer && options?.pfpFileName) {
      builder.setProfilePicture(options.pfpBuffer, options.pfpFileName);
    }

    builder.addProperty('framework', 'AgentMesh');
    builder.addProperty('version', '1.0.0');

    return this.hcs10Client.createAndRegisterAgent(builder, {
      progressCallback: this.config.progressCallback,
      initialBalance: options?.initialBalance,
    });
  }

  /**
   * Handle an incoming connection request from another HCS-10 agent
   */
  async handleConnectionRequest(
    inboundTopicId: string,
    requestingAccountId: string,
    connectionRequestId: number
  ): Promise<HandleConnectionRequestResponse> {
    const response = await this.hcs10Client.handleConnectionRequest(
      inboundTopicId,
      requestingAccountId,
      connectionRequestId
    );

    this.connections.set(requestingAccountId, response.connectionTopicId);
    this.emit('connection:established', {
      accountId: requestingAccountId,
      connectionTopicId: response.connectionTopicId,
    });

    return response;
  }

  /**
   * Send a message over an established HCS-10 connection
   */
  async sendMessage(connectionTopicId: string, data: string, memo?: string): Promise<void> {
    await this.hcs10Client.sendMessage(connectionTopicId, data, memo);
  }

  /**
   * Get the connection topic for a given account
   */
  getConnectionTopic(accountId: string): string | undefined {
    return this.connections.get(accountId);
  }

  /**
   * Get all active connections
   */
  getConnections(): Map<string, string> {
    return new Map(this.connections);
  }
}
