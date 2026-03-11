/**
 * AgentRegistry - manages agent registration and discovery on Hedera
 * Uses HCS topics for a decentralized agent directory
 */

import { HederaClient } from './hedera-client';
import { AgentProfile, AgentDiscoveryResult, CoordinationMessage, MessageType } from './types';

export class AgentRegistry {
  private hederaClient: HederaClient;
  private registryTopicId: string | null = null;
  private agents: Map<string, AgentProfile> = new Map();
  private initialized = false;

  constructor(hederaClient: HederaClient) {
    this.hederaClient = hederaClient;
  }

  async initialize(existingRegistryTopicId?: string): Promise<string> {
    if (existingRegistryTopicId) {
      this.registryTopicId = existingRegistryTopicId;
    } else {
      this.registryTopicId = await this.hederaClient.createTopic('AgentMesh Registry v1');
    }

    // Subscribe to registry updates
    this.hederaClient.subscribeTopic(this.registryTopicId, (message) => {
      this.handleRegistryMessage(message.contents, message.sequenceNumber);
    });

    this.initialized = true;
    return this.registryTopicId;
  }

  getRegistryTopicId(): string {
    if (!this.registryTopicId) {
      throw new Error('Registry not initialized');
    }
    return this.registryTopicId;
  }

  async registerAgent(profile: AgentProfile): Promise<number> {
    if (!this.registryTopicId) {
      throw new Error('Registry not initialized');
    }

    const message: CoordinationMessage = {
      type: MessageType.AGENT_REGISTER,
      senderId: profile.id,
      payload: {
        profile,
      },
      timestamp: Date.now(),
    };

    const sequenceNumber = await this.hederaClient.submitMessage(
      this.registryTopicId,
      JSON.stringify(message)
    );

    this.agents.set(profile.id, profile);
    return sequenceNumber;
  }

  async deregisterAgent(agentId: string): Promise<void> {
    if (!this.registryTopicId) {
      throw new Error('Registry not initialized');
    }

    const message: CoordinationMessage = {
      type: MessageType.AGENT_DEREGISTER,
      senderId: agentId,
      payload: {},
      timestamp: Date.now(),
    };

    await this.hederaClient.submitMessage(
      this.registryTopicId,
      JSON.stringify(message)
    );

    this.agents.delete(agentId);
  }

  async updateAgentStatus(agentId: string, status: AgentProfile['status']): Promise<void> {
    if (!this.registryTopicId) {
      throw new Error('Registry not initialized');
    }

    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
    }

    const message: CoordinationMessage = {
      type: MessageType.AGENT_STATUS_UPDATE,
      senderId: agentId,
      payload: { status },
      timestamp: Date.now(),
    };

    await this.hederaClient.submitMessage(
      this.registryTopicId,
      JSON.stringify(message)
    );
  }

  discoverAgents(filter?: {
    capability?: string;
    status?: AgentProfile['status'];
    maxResults?: number;
  }): AgentDiscoveryResult {
    const startTime = Date.now();
    let agents = Array.from(this.agents.values());

    if (filter?.status) {
      agents = agents.filter(a => a.status === filter.status);
    }

    if (filter?.capability) {
      agents = agents.filter(a =>
        a.capabilities.some(c =>
          c.name.toLowerCase().includes(filter.capability!.toLowerCase()) ||
          c.description.toLowerCase().includes(filter.capability!.toLowerCase())
        )
      );
    }

    if (filter?.maxResults) {
      agents = agents.slice(0, filter.maxResults);
    }

    return {
      agents,
      totalFound: agents.length,
      queryTime: Date.now() - startTime,
    };
  }

  getAgent(agentId: string): AgentProfile | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentProfile[] {
    return Array.from(this.agents.values());
  }

  getAgentCount(): number {
    return this.agents.size;
  }

  private handleRegistryMessage(contents: Buffer, sequenceNumber: number): void {
    try {
      const message: CoordinationMessage = JSON.parse(contents.toString());

      switch (message.type) {
        case MessageType.AGENT_REGISTER: {
          const profile = message.payload.profile as AgentProfile;
          this.agents.set(profile.id, profile);
          this.hederaClient.emit('agent:registered', profile);
          break;
        }
        case MessageType.AGENT_DEREGISTER: {
          this.agents.delete(message.senderId);
          this.hederaClient.emit('agent:deregistered', message.senderId);
          break;
        }
        case MessageType.AGENT_STATUS_UPDATE: {
          const agent = this.agents.get(message.senderId);
          if (agent) {
            agent.status = message.payload.status as AgentProfile['status'];
            this.hederaClient.emit('agent:statusChanged', { agentId: message.senderId, status: agent.status });
          }
          break;
        }
        case MessageType.AGENT_HEARTBEAT: {
          const heartbeatAgent = this.agents.get(message.senderId);
          if (heartbeatAgent) {
            heartbeatAgent.metadata = { ...heartbeatAgent.metadata, lastHeartbeat: String(message.timestamp) };
          }
          break;
        }
      }
    } catch (error) {
      // Ignore malformed messages
    }
  }
}
