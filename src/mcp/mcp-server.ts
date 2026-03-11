/**
 * MCP Server - exposes AgentMesh capabilities as MCP tools
 * Enables integration with any MCP-compatible AI system
 */

import { MeshNode } from '../core/mesh-node';
import { AgentCapability } from '../core/types';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export class MCPServer {
  private meshNode: MeshNode;
  private tools: Map<string, MCPTool> = new Map();
  private handlers: Map<string, (args: Record<string, unknown>) => Promise<MCPToolResult>> = new Map();

  constructor(meshNode: MeshNode) {
    this.meshNode = meshNode;
    this.registerBuiltinTools();
  }

  private registerBuiltinTools(): void {
    // Tool: discover agents
    this.registerTool(
      {
        name: 'discover_agents',
        description: 'Discover available AI agents in the mesh network by capability',
        inputSchema: {
          type: 'object',
          properties: {
            capability: { type: 'string', description: 'Capability to search for' },
            maxResults: { type: 'number', description: 'Maximum results to return' },
          },
        },
      },
      async (args) => {
        const result = this.meshNode.discoverAgents(args.capability as string | undefined);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              agents: result.agents.map(a => ({
                id: a.id,
                name: a.name,
                description: a.description,
                capabilities: a.capabilities.map(c => c.name),
                status: a.status,
              })),
              totalFound: result.totalFound,
              queryTime: result.queryTime,
            }, null, 2),
          }],
        };
      }
    );

    // Tool: submit task
    this.registerTool(
      {
        name: 'submit_task',
        description: 'Submit a task for AI agents in the mesh to collaborate on',
        inputSchema: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Task description' },
            capabilities: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required agent capabilities',
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
              description: 'Task priority',
            },
            payload: { type: 'object', description: 'Task-specific data' },
          },
          required: ['description', 'capabilities'],
        },
      },
      async (args) => {
        const taskId = await this.meshNode.submitTask(
          args.description as string,
          args.capabilities as string[],
          (args.payload as Record<string, unknown>) || {},
          (args.priority as 'low' | 'medium' | 'high' | 'critical') || 'medium'
        );
        return {
          content: [{ type: 'text', text: JSON.stringify({ taskId, status: 'submitted' }) }],
        };
      }
    );

    // Tool: get mesh status
    this.registerTool(
      {
        name: 'mesh_status',
        description: 'Get the current status of the AgentMesh network',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        const profile = this.meshNode.getProfile();
        const registry = this.meshNode.getRegistry();
        const coordinator = this.meshNode.getCoordinator();
        let balance: number | string;
        try {
          balance = await this.meshNode.getBalance();
        } catch {
          balance = 'unknown';
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              node: profile ? {
                id: profile.id,
                name: profile.name,
                status: profile.status,
                hederaAccount: profile.hederaAccountId,
              } : null,
              network: {
                totalAgents: registry.getAgentCount(),
                activeTasks: coordinator.getTaskCount(),
                balance,
              },
            }, null, 2),
          }],
        };
      }
    );

    // Tool: send message to agent
    this.registerTool(
      {
        name: 'send_message',
        description: 'Send a direct message to another agent in the mesh',
        inputSchema: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Target agent ID' },
            message: { type: 'string', description: 'Message content' },
          },
          required: ['agentId', 'message'],
        },
      },
      async (args) => {
        const targetAgent = this.meshNode.getRegistry().getAgent(args.agentId as string);
        if (!targetAgent) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Agent not found' }) }],
            isError: true,
          };
        }

        const profile = this.meshNode.getProfile();
        const message = JSON.stringify({
          type: 'data.request',
          senderId: profile?.id,
          recipientId: args.agentId,
          payload: { message: args.message },
          timestamp: Date.now(),
        });

        await this.meshNode.getHederaClient().submitMessage(
          targetAgent.inboundTopicId,
          message
        );

        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'sent', to: targetAgent.name }) }],
        };
      }
    );

    // Tool: execute capability
    this.registerTool(
      {
        name: 'execute_capability',
        description: 'Execute a specific capability on this agent',
        inputSchema: {
          type: 'object',
          properties: {
            capability: { type: 'string', description: 'Capability name to execute' },
            input: { type: 'object', description: 'Input data for the capability' },
          },
          required: ['capability'],
        },
      },
      async (args) => {
        try {
          const result = await this.meshNode.executeCapability(
            args.capability as string,
            (args.input as Record<string, unknown>) || {}
          );
          return {
            content: [{ type: 'text', text: JSON.stringify({ result }) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }],
            isError: true,
          };
        }
      }
    );

    // Tool: get agent capabilities
    this.registerTool(
      {
        name: 'list_capabilities',
        description: 'List all capabilities of this agent node',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        const profile = this.meshNode.getProfile();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              capabilities: profile?.capabilities || [],
            }, null, 2),
          }],
        };
      }
    );
  }

  registerTool(
    tool: MCPTool,
    handler: (args: Record<string, unknown>) => Promise<MCPToolResult>
  ): void {
    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, handler);
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const handler = this.handlers.get(toolName);
    if (!handler) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }
    return handler(args);
  }

  listTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  getToolCount(): number {
    return this.tools.size;
  }

  /**
   * Generate MCP-compatible JSON-RPC response for tools/list
   */
  getToolsListResponse(): { tools: MCPTool[] } {
    return { tools: this.listTools() };
  }
}
