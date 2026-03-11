/**
 * MeshNode - main entry point for AgentMesh
 * Combines HederaClient, AgentRegistry, and TaskCoordinator
 */

import { HederaClient } from './hedera-client';
import { AgentRegistry } from './agent-registry';
import { TaskCoordinator } from './task-coordinator';
import { AgentProfile, MeshConfig, AgentCapability, TaskRequest, TaskResult } from './types';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

export interface MeshNodeOptions {
  config: MeshConfig;
  agentName: string;
  agentDescription: string;
  capabilities: AgentCapability[];
}

export class MeshNode extends EventEmitter {
  private hederaClient: HederaClient;
  private registry: AgentRegistry;
  private coordinator: TaskCoordinator;
  private profile: AgentProfile | null = null;
  private options: MeshNodeOptions;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private capabilityHandlers: Map<string, (input: Record<string, unknown>) => Promise<unknown>> = new Map();

  constructor(options: MeshNodeOptions) {
    super();
    this.options = options;
    this.hederaClient = new HederaClient(options.config);
    this.registry = new AgentRegistry(this.hederaClient);
    this.coordinator = new TaskCoordinator(this.hederaClient, this.registry);
  }

  async start(existingRegistryTopicId?: string, existingCoordinationTopicId?: string): Promise<AgentProfile> {
    // Initialize registry
    const registryTopicId = await this.registry.initialize(existingRegistryTopicId);

    // Initialize coordinator
    const coordinationTopicId = await this.coordinator.initialize(existingCoordinationTopicId);

    // Create agent-specific topics
    const inboundTopicId = await this.hederaClient.createTopic(
      `AgentMesh:${this.options.agentName}:inbound`
    );
    const outboundTopicId = await this.hederaClient.createTopic(
      `AgentMesh:${this.options.agentName}:outbound`
    );

    // Build profile
    this.profile = {
      id: uuidv4(),
      name: this.options.agentName,
      description: this.options.agentDescription,
      capabilities: this.options.capabilities,
      hederaAccountId: this.hederaClient.getOperatorAccountId(),
      inboundTopicId,
      outboundTopicId,
      registryTopicId,
      status: 'active',
      createdAt: Date.now(),
      metadata: {
        coordinationTopicId,
        version: '1.0.0',
      },
    };

    // Register in the mesh
    await this.registry.registerAgent(this.profile);

    // Listen for inbound messages
    this.hederaClient.subscribeTopic(inboundTopicId, (message) => {
      this.handleInboundMessage(message.contents);
    });

    // Listen for task assignments
    this.coordinator.on('task:received', (task: TaskRequest) => {
      this.handleTaskRequest(task);
    });

    // Start heartbeat
    const heartbeatInterval = this.options.config.heartbeatInterval || 60000;
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat().catch(() => {});
    }, heartbeatInterval);

    this.emit('started', this.profile);
    return this.profile;
  }

  registerCapabilityHandler(
    capabilityName: string,
    handler: (input: Record<string, unknown>) => Promise<unknown>
  ): void {
    this.capabilityHandlers.set(capabilityName, handler);
  }

  async submitTask(
    description: string,
    requiredCapabilities: string[],
    payload: Record<string, unknown> = {},
    priority: TaskRequest['priority'] = 'medium'
  ): Promise<string> {
    if (!this.profile) throw new Error('Node not started');

    return this.coordinator.submitTask({
      description,
      requiredCapabilities,
      payload,
      priority,
      requesterId: this.profile.id,
    });
  }

  async executeCapability(capabilityName: string, input: Record<string, unknown>): Promise<unknown> {
    const handler = this.capabilityHandlers.get(capabilityName);
    if (!handler) {
      throw new Error(`No handler for capability: ${capabilityName}`);
    }
    return handler(input);
  }

  getProfile(): AgentProfile | null {
    return this.profile;
  }

  getRegistry(): AgentRegistry {
    return this.registry;
  }

  getCoordinator(): TaskCoordinator {
    return this.coordinator;
  }

  getHederaClient(): HederaClient {
    return this.hederaClient;
  }

  async getBalance(): Promise<number> {
    return this.hederaClient.getBalance();
  }

  discoverAgents(capability?: string) {
    return this.registry.discoverAgents({ capability, status: 'active' });
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.profile) {
      await this.registry.updateAgentStatus(this.profile.id, 'inactive');
    }

    this.hederaClient.close();
    this.emit('stopped');
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.profile) return;

    const registryTopicId = this.registry.getRegistryTopicId();
    const message = JSON.stringify({
      type: 'agent.heartbeat',
      senderId: this.profile.id,
      payload: {
        status: this.profile.status,
        capabilities: this.profile.capabilities.map(c => c.name),
      },
      timestamp: Date.now(),
    });

    await this.hederaClient.submitMessage(registryTopicId, message);
  }

  private handleInboundMessage(contents: Buffer): void {
    try {
      const message = JSON.parse(contents.toString());
      this.emit('message', message);
    } catch {
      // Ignore malformed messages
    }
  }

  private async handleTaskRequest(task: TaskRequest): Promise<void> {
    if (!this.profile) return;

    // Check if we have any of the required capabilities
    for (const required of task.requiredCapabilities) {
      const hasCapability = this.profile.capabilities.some(
        c => c.name.toLowerCase() === required.toLowerCase()
      );

      if (hasCapability && this.capabilityHandlers.has(required)) {
        // Auto-bid with high confidence if we have the handler
        await this.coordinator.submitBid({
          taskId: task.id,
          agentId: this.profile.id,
          capability: required,
          estimatedDuration: 5000,
          estimatedCost: 0,
          confidence: 0.9,
          timestamp: Date.now(),
        });

        this.emit('task:bidSubmitted', { taskId: task.id, capability: required });
      }
    }
  }
}
