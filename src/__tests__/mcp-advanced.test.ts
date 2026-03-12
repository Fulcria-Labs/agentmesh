/**
 * Advanced MCP Server tests
 *
 * Covers: balance error handling, null profile scenarios,
 * custom tool registration edge cases, tool schema validation,
 * and send_message edge cases.
 */

import { MCPServer, MCPTool, MCPToolResult } from '../mcp/mcp-server';
import { MeshNode } from '../core/mesh-node';
import { AgentProfile } from '../core/types';

function createMockMeshNode(overrides: Record<string, any> = {}): jest.Mocked<MeshNode> {
  const mockRegistry = {
    discoverAgents: jest.fn().mockReturnValue({
      agents: [],
      totalFound: 0,
      queryTime: 1,
    }),
    getAgent: jest.fn().mockReturnValue(undefined),
    getAgentCount: jest.fn().mockReturnValue(0),
  };

  const mockCoordinator = {
    getTaskCount: jest.fn().mockReturnValue(0),
  };

  const mockHederaClient = {
    submitMessage: jest.fn().mockResolvedValue(1),
  };

  const mock = {
    discoverAgents: jest.fn().mockReturnValue({
      agents: [],
      totalFound: 0,
      queryTime: 1,
    }),
    getProfile: jest.fn().mockReturnValue(null),
    getRegistry: jest.fn().mockReturnValue(mockRegistry),
    getCoordinator: jest.fn().mockReturnValue(mockCoordinator),
    getHederaClient: jest.fn().mockReturnValue(mockHederaClient),
    getBalance: jest.fn().mockResolvedValue(100),
    submitTask: jest.fn().mockResolvedValue('task-001'),
    executeCapability: jest.fn().mockResolvedValue({ data: 'result' }),
    ...overrides,
  } as unknown as jest.Mocked<MeshNode>;

  return mock;
}

describe('MCPServer - Null Profile Handling', () => {
  it('should handle mesh_status when profile is null', async () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    const result = await server.handleToolCall('mesh_status', {});
    const data = JSON.parse(result.content[0]!.text);

    expect(data.node).toBeNull();
    expect(data.network.totalAgents).toBe(0);
    expect(data.network.activeTasks).toBe(0);
  });

  it('should handle list_capabilities when profile is null', async () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    const result = await server.handleToolCall('list_capabilities', {});
    const data = JSON.parse(result.content[0]!.text);

    expect(data.capabilities).toEqual([]);
  });

  it('should handle send_message with null sender profile', async () => {
    const targetAgent = {
      id: 'target',
      name: 'TargetAgent',
      inboundTopicId: '0.0.500',
    };

    const mockRegistry = {
      discoverAgents: jest.fn(),
      getAgent: jest.fn().mockReturnValue(targetAgent),
      getAgentCount: jest.fn().mockReturnValue(1),
    };

    const mockNode = createMockMeshNode();
    mockNode.getRegistry = jest.fn().mockReturnValue(mockRegistry) as any;

    const server = new MCPServer(mockNode);
    const result = await server.handleToolCall('send_message', {
      agentId: 'target',
      message: 'hello from null profile',
    });

    const data = JSON.parse(result.content[0]!.text);
    expect(data.status).toBe('sent');
    expect(data.to).toBe('TargetAgent');
  });
});

describe('MCPServer - Balance Error Handling', () => {
  it('should show unknown balance when getBalance fails', async () => {
    const mockNode = createMockMeshNode({
      getBalance: jest.fn().mockRejectedValue(new Error('Network error')),
    });

    const server = new MCPServer(mockNode);
    const result = await server.handleToolCall('mesh_status', {});
    const data = JSON.parse(result.content[0]!.text);

    expect(data.network.balance).toBe('unknown');
  });
});

describe('MCPServer - Submit Task Variations', () => {
  it('should submit task with all parameters', async () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    const result = await server.handleToolCall('submit_task', {
      description: 'Complex research task',
      capabilities: ['research', 'analysis', 'writing'],
      priority: 'critical',
      payload: { topic: 'AI', depth: 'deep' },
    });

    const data = JSON.parse(result.content[0]!.text);
    expect(data.taskId).toBe('task-001');
    expect(data.status).toBe('submitted');

    expect(mockNode.submitTask).toHaveBeenCalledWith(
      'Complex research task',
      ['research', 'analysis', 'writing'],
      { topic: 'AI', depth: 'deep' },
      'critical'
    );
  });

  it('should submit task with minimal parameters', async () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    await server.handleToolCall('submit_task', {
      description: 'Simple task',
      capabilities: ['basic'],
    });

    expect(mockNode.submitTask).toHaveBeenCalledWith(
      'Simple task',
      ['basic'],
      {},
      'medium'
    );
  });
});

describe('MCPServer - Execute Capability Variations', () => {
  it('should pass input to capability handler', async () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    await server.handleToolCall('execute_capability', {
      capability: 'analysis',
      input: { data: [1, 2, 3], type: 'trend' },
    });

    expect(mockNode.executeCapability).toHaveBeenCalledWith(
      'analysis',
      { data: [1, 2, 3], type: 'trend' }
    );
  });

  it('should use empty object as default input', async () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    await server.handleToolCall('execute_capability', {
      capability: 'analysis',
    });

    expect(mockNode.executeCapability).toHaveBeenCalledWith('analysis', {});
  });

  it('should return error details when capability fails', async () => {
    const mockNode = createMockMeshNode({
      executeCapability: jest.fn().mockRejectedValue(new Error('Handler crashed: out of memory')),
    });

    const server = new MCPServer(mockNode);
    const result = await server.handleToolCall('execute_capability', {
      capability: 'broken',
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.error).toContain('out of memory');
  });
});

describe('MCPServer - Custom Tool Registration', () => {
  it('should register and execute multiple custom tools', async () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    server.registerTool(
      {
        name: 'custom_a',
        description: 'Custom tool A',
        inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      },
      async (args) => ({
        content: [{ type: 'text', text: `A: ${args.x}` }],
      })
    );

    server.registerTool(
      {
        name: 'custom_b',
        description: 'Custom tool B',
        inputSchema: { type: 'object', properties: {} },
      },
      async () => ({
        content: [{ type: 'text', text: 'B result' }],
      })
    );

    expect(server.getToolCount()).toBe(8); // 6 builtin + 2 custom

    const resultA = await server.handleToolCall('custom_a', { x: 42 });
    expect(resultA.content[0]!.text).toBe('A: 42');

    const resultB = await server.handleToolCall('custom_b', {});
    expect(resultB.content[0]!.text).toBe('B result');
  });

  it('should allow overriding a builtin tool', async () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    server.registerTool(
      {
        name: 'discover_agents',
        description: 'Overridden discover',
        inputSchema: { type: 'object', properties: {} },
      },
      async () => ({
        content: [{ type: 'text', text: 'custom discovery' }],
      })
    );

    const result = await server.handleToolCall('discover_agents', {});
    expect(result.content[0]!.text).toBe('custom discovery');
    // Tool count should remain the same (replaced, not added)
    expect(server.getToolCount()).toBe(6);
  });

  it('should register tool with required fields in schema', async () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    const tool: MCPTool = {
      name: 'validated_tool',
      description: 'A tool with required fields',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['name', 'count'],
      },
    };

    server.registerTool(tool, async (args) => ({
      content: [{ type: 'text', text: JSON.stringify(args) }],
    }));

    const result = await server.handleToolCall('validated_tool', { name: 'test', count: 5 });
    const data = JSON.parse(result.content[0]!.text);
    expect(data.name).toBe('test');
    expect(data.count).toBe(5);
  });
});

describe('MCPServer - Tool Schema Validation', () => {
  it('should have proper inputSchema on all builtin tools', () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    const tools = server.listTools();
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('should have required fields defined for tools that need them', () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    const tools = server.listTools();
    const submitTask = tools.find(t => t.name === 'submit_task');
    expect(submitTask!.inputSchema.required).toContain('description');
    expect(submitTask!.inputSchema.required).toContain('capabilities');

    const sendMessage = tools.find(t => t.name === 'send_message');
    expect(sendMessage!.inputSchema.required).toContain('agentId');
    expect(sendMessage!.inputSchema.required).toContain('message');

    const executeCap = tools.find(t => t.name === 'execute_capability');
    expect(executeCap!.inputSchema.required).toContain('capability');
  });

  it('should have proper tool names (no spaces, lowercase)', () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    const tools = server.listTools();
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
    }
  });
});

describe('MCPServer - Discover Agents Variations', () => {
  it('should handle discovery with no results', async () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    const result = await server.handleToolCall('discover_agents', { capability: 'rare_skill' });
    const data = JSON.parse(result.content[0]!.text);

    expect(data.totalFound).toBe(0);
    expect(data.agents).toEqual([]);
  });

  it('should format discovered agents with essential fields', async () => {
    const mockNode = createMockMeshNode({
      discoverAgents: jest.fn().mockReturnValue({
        agents: [
          {
            id: 'a1',
            name: 'Agent1',
            description: 'First agent',
            capabilities: [{ name: 'research' }, { name: 'analysis' }],
            status: 'active',
          },
        ],
        totalFound: 1,
        queryTime: 3,
      }),
    });

    const server = new MCPServer(mockNode);
    const result = await server.handleToolCall('discover_agents', {});
    const data = JSON.parse(result.content[0]!.text);

    expect(data.agents[0].id).toBe('a1');
    expect(data.agents[0].name).toBe('Agent1');
    expect(data.agents[0].description).toBe('First agent');
    expect(data.agents[0].capabilities).toEqual(['research', 'analysis']);
    expect(data.agents[0].status).toBe('active');
    expect(data.queryTime).toBe(3);
  });
});

describe('MCPServer - getToolsListResponse', () => {
  it('should return response in MCP-compatible format', () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    const response = server.getToolsListResponse();

    expect(response).toHaveProperty('tools');
    expect(Array.isArray(response.tools)).toBe(true);
    expect(response.tools.length).toBe(6);

    // Each tool should have the MCP-required fields
    for (const tool of response.tools) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('inputSchema');
      expect(tool.inputSchema).toHaveProperty('type', 'object');
      expect(tool.inputSchema).toHaveProperty('properties');
    }
  });

  it('should include custom tools in the response', () => {
    const mockNode = createMockMeshNode();
    const server = new MCPServer(mockNode);

    server.registerTool(
      {
        name: 'custom_tool',
        description: 'Custom',
        inputSchema: { type: 'object', properties: {} },
      },
      async () => ({ content: [{ type: 'text', text: 'ok' }] })
    );

    const response = server.getToolsListResponse();
    expect(response.tools.length).toBe(7);
    expect(response.tools.find(t => t.name === 'custom_tool')).toBeDefined();
  });
});
