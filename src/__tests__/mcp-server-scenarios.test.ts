/**
 * MCPServer - Comprehensive tool registration, handling, and integration tests
 */

import { MCPServer, MCPTool, MCPToolResult } from '../mcp/mcp-server';
import { MeshNode } from '../core/mesh-node';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile, AgentCapability } from '../core/types';
import { AgentRegistry } from '../core/agent-registry';
import { TaskCoordinator } from '../core/task-coordinator';

jest.mock('../core/hedera-client');

function createMockMeshNode(): MeshNode {
  const config = {
    network: 'testnet' as const,
    operatorAccountId: '0.0.1',
    operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
  };

  const node = new MeshNode({
    config,
    agentName: 'TestNode',
    agentDescription: 'Test node for MCP tests',
    capabilities: [
      { name: 'test_cap', description: 'Test capability', inputSchema: {}, outputSchema: {} },
    ],
  });

  return node;
}

function setupMockNodeWithProfile(node: MeshNode): void {
  const profile: AgentProfile = {
    id: 'node-1',
    name: 'TestNode',
    description: 'Test node',
    capabilities: [
      { name: 'test_cap', description: 'Test', inputSchema: {}, outputSchema: {} },
    ],
    hederaAccountId: '0.0.12345',
    inboundTopicId: '0.0.200',
    outboundTopicId: '0.0.201',
    registryTopicId: '0.0.100',
    status: 'active',
    createdAt: Date.now(),
    metadata: {},
  };
  (node as any).profile = profile;
}

describe('MCPServer - Comprehensive', () => {
  let server: MCPServer;
  let node: MeshNode;

  beforeEach(() => {
    node = createMockMeshNode();
    server = new MCPServer(node);
  });

  describe('Built-in Tools Registration', () => {
    it('should register 6 built-in tools', () => {
      expect(server.getToolCount()).toBe(6);
    });

    it('should register discover_agents tool', () => {
      const tools = server.listTools();
      const tool = tools.find(t => t.name === 'discover_agents');
      expect(tool).toBeDefined();
      expect(tool!.description).toContain('Discover');
    });

    it('should register submit_task tool', () => {
      const tools = server.listTools();
      const tool = tools.find(t => t.name === 'submit_task');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('description');
    });

    it('should register mesh_status tool', () => {
      const tools = server.listTools();
      const tool = tools.find(t => t.name === 'mesh_status');
      expect(tool).toBeDefined();
    });

    it('should register send_message tool', () => {
      const tools = server.listTools();
      const tool = tools.find(t => t.name === 'send_message');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('agentId');
      expect(tool!.inputSchema.required).toContain('message');
    });

    it('should register execute_capability tool', () => {
      const tools = server.listTools();
      const tool = tools.find(t => t.name === 'execute_capability');
      expect(tool).toBeDefined();
    });

    it('should register list_capabilities tool', () => {
      const tools = server.listTools();
      const tool = tools.find(t => t.name === 'list_capabilities');
      expect(tool).toBeDefined();
    });
  });

  describe('Custom Tool Registration', () => {
    it('should register a custom tool', () => {
      server.registerTool(
        {
          name: 'custom_tool',
          description: 'A custom tool',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ content: [{ type: 'text', text: 'ok' }] })
      );

      expect(server.getToolCount()).toBe(7);
    });

    it('should be able to call custom tool', async () => {
      server.registerTool(
        {
          name: 'greet',
          description: 'Greet someone',
          inputSchema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
        async (args) => ({
          content: [{ type: 'text', text: `Hello, ${args.name}!` }],
        })
      );

      const result = await server.handleToolCall('greet', { name: 'World' });
      expect(result.content[0].text).toBe('Hello, World!');
      expect(result.isError).toBeUndefined();
    });

    it('should allow overriding built-in tools', () => {
      server.registerTool(
        {
          name: 'discover_agents',
          description: 'Custom discover',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ content: [{ type: 'text', text: 'custom' }] })
      );

      // Count stays the same since name overwrites
      expect(server.getToolCount()).toBe(6);
    });

    it('should register multiple custom tools', () => {
      for (let i = 0; i < 10; i++) {
        server.registerTool(
          {
            name: `tool_${i}`,
            description: `Tool ${i}`,
            inputSchema: { type: 'object', properties: {} },
          },
          async () => ({ content: [{ type: 'text', text: `tool ${i}` }] })
        );
      }

      expect(server.getToolCount()).toBe(16);
    });
  });

  describe('handleToolCall', () => {
    it('should return error for unknown tool', async () => {
      const result = await server.handleToolCall('nonexistent', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool');
    });

    it('should handle discover_agents with no args', async () => {
      const result = await server.handleToolCall('discover_agents', {});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveProperty('agents');
      expect(data).toHaveProperty('totalFound');
    });

    it('should handle discover_agents with capability filter', async () => {
      const result = await server.handleToolCall('discover_agents', {
        capability: 'web_research',
      });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveProperty('agents');
    });

    it('should handle mesh_status tool', async () => {
      const result = await server.handleToolCall('mesh_status', {});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveProperty('network');
      expect(data.network).toHaveProperty('totalAgents');
      expect(data.network).toHaveProperty('activeTasks');
    });

    it('should handle mesh_status when node not started', async () => {
      const result = await server.handleToolCall('mesh_status', {});
      const data = JSON.parse(result.content[0].text);
      expect(data.node).toBeNull();
    });

    it('should handle mesh_status when node has profile', async () => {
      setupMockNodeWithProfile(node);
      const result = await server.handleToolCall('mesh_status', {});
      const data = JSON.parse(result.content[0].text);
      expect(data.node).not.toBeNull();
      expect(data.node.name).toBe('TestNode');
    });

    it('should handle list_capabilities when node not started', async () => {
      const result = await server.handleToolCall('list_capabilities', {});
      const data = JSON.parse(result.content[0].text);
      expect(data.capabilities).toEqual([]);
    });

    it('should handle list_capabilities with profile', async () => {
      setupMockNodeWithProfile(node);
      const result = await server.handleToolCall('list_capabilities', {});
      const data = JSON.parse(result.content[0].text);
      expect(data.capabilities).toHaveLength(1);
      expect(data.capabilities[0].name).toBe('test_cap');
    });

    it('should handle send_message for non-existent agent', async () => {
      const result = await server.handleToolCall('send_message', {
        agentId: 'nonexistent',
        message: 'hello',
      });
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toBe('Agent not found');
    });

    it('should handle execute_capability with no handler', async () => {
      const result = await server.handleToolCall('execute_capability', {
        capability: 'nonexistent',
      });
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain('No handler for capability');
    });

    it('should handle execute_capability with registered handler', async () => {
      node.registerCapabilityHandler('test_cap', async (input) => {
        return { success: true, input };
      });

      const result = await server.handleToolCall('execute_capability', {
        capability: 'test_cap',
        input: { key: 'value' },
      });

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.result.success).toBe(true);
    });

    it('should handle execute_capability with no input arg', async () => {
      node.registerCapabilityHandler('test_cap', async (input) => {
        return { received: input };
      });

      const result = await server.handleToolCall('execute_capability', {
        capability: 'test_cap',
      });

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.result.received).toEqual({});
    });
  });

  describe('listTools', () => {
    it('should return array of MCPTool objects', () => {
      const tools = server.listTools();
      expect(Array.isArray(tools)).toBe(true);
      tools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool.inputSchema.type).toBe('object');
      });
    });

    it('should include all tool properties', () => {
      const tools = server.listTools();
      const submitTool = tools.find(t => t.name === 'submit_task')!;
      expect(submitTool.inputSchema.properties).toHaveProperty('description');
      expect(submitTool.inputSchema.properties).toHaveProperty('capabilities');
      expect(submitTool.inputSchema.properties).toHaveProperty('priority');
    });
  });

  describe('getToolsListResponse', () => {
    it('should return MCP-compatible response', () => {
      const response = server.getToolsListResponse();
      expect(response).toHaveProperty('tools');
      expect(Array.isArray(response.tools)).toBe(true);
      expect(response.tools.length).toBe(6);
    });

    it('should match listTools output', () => {
      const response = server.getToolsListResponse();
      expect(response.tools).toEqual(server.listTools());
    });
  });

  describe('Tool Input Schema Validation', () => {
    it('should have proper schema for discover_agents', () => {
      const tools = server.listTools();
      const tool = tools.find(t => t.name === 'discover_agents')!;
      expect(tool.inputSchema.properties).toHaveProperty('capability');
      expect(tool.inputSchema.properties).toHaveProperty('maxResults');
    });

    it('should have proper schema for submit_task', () => {
      const tools = server.listTools();
      const tool = tools.find(t => t.name === 'submit_task')!;
      expect(tool.inputSchema.required).toContain('description');
      expect(tool.inputSchema.required).toContain('capabilities');
    });

    it('should have proper schema for send_message', () => {
      const tools = server.listTools();
      const tool = tools.find(t => t.name === 'send_message')!;
      expect(tool.inputSchema.required).toContain('agentId');
      expect(tool.inputSchema.required).toContain('message');
    });

    it('should have proper schema for execute_capability', () => {
      const tools = server.listTools();
      const tool = tools.find(t => t.name === 'execute_capability')!;
      expect(tool.inputSchema.required).toContain('capability');
    });

    it('should have empty required for mesh_status', () => {
      const tools = server.listTools();
      const tool = tools.find(t => t.name === 'mesh_status')!;
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('should have empty required for list_capabilities', () => {
      const tools = server.listTools();
      const tool = tools.find(t => t.name === 'list_capabilities')!;
      expect(tool.inputSchema.required).toBeUndefined();
    });
  });

  describe('Error Resilience', () => {
    it('should handle tool handler that throws', async () => {
      server.registerTool(
        {
          name: 'buggy_tool',
          description: 'This tool throws',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => {
          throw new Error('Tool crashed');
        }
      );

      await expect(server.handleToolCall('buggy_tool', {})).rejects.toThrow('Tool crashed');
    });

    it('should handle empty string tool name', async () => {
      const result = await server.handleToolCall('', {});
      expect(result.isError).toBe(true);
    });

    it('should handle tool with complex args', async () => {
      server.registerTool(
        {
          name: 'complex',
          description: 'Complex args',
          inputSchema: { type: 'object', properties: {} },
        },
        async (args) => ({
          content: [{ type: 'text', text: JSON.stringify(args) }],
        })
      );

      const result = await server.handleToolCall('complex', {
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
        bool: true,
        nullVal: null,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.nested.deep.value).toBe(42);
      expect(data.array).toEqual([1, 2, 3]);
    });
  });

  describe('Multiple Server Instances', () => {
    it('should maintain independent tool registries', () => {
      const node2 = createMockMeshNode();
      const server2 = new MCPServer(node2);

      server.registerTool(
        {
          name: 'extra_tool',
          description: 'Extra',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ content: [{ type: 'text', text: 'ok' }] })
      );

      expect(server.getToolCount()).toBe(7);
      expect(server2.getToolCount()).toBe(6);
    });
  });
});
