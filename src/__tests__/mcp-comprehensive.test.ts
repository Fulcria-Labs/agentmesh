/**
 * Comprehensive MCP Server tests - covers tool schema validation,
 * error paths, edge cases for each tool, and custom tool registration.
 */

import { MCPServer } from '../mcp/mcp-server';
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
    ...overrides.registry,
  };

  const mockCoordinator = {
    getTaskCount: jest.fn().mockReturnValue(0),
    submitTask: jest.fn().mockResolvedValue('task-abc'),
    ...overrides.coordinator,
  };

  const mockHederaClient = {
    submitMessage: jest.fn().mockResolvedValue(1),
    ...overrides.hederaClient,
  };

  const mockProfile: AgentProfile = {
    id: 'node-1',
    name: 'TestNode',
    description: 'Test mesh node',
    capabilities: overrides.capabilities || [
      { name: 'test_cap', description: 'Test', inputSchema: {}, outputSchema: {} },
    ],
    hederaAccountId: '0.0.12345',
    inboundTopicId: '0.0.100',
    outboundTopicId: '0.0.101',
    registryTopicId: '0.0.102',
    status: 'active',
    createdAt: Date.now(),
    metadata: {},
    ...overrides.profile,
  };

  return {
    discoverAgents: jest.fn().mockReturnValue(mockRegistry.discoverAgents()),
    getProfile: jest.fn().mockReturnValue(overrides.nullProfile ? null : mockProfile),
    getRegistry: jest.fn().mockReturnValue(mockRegistry),
    getCoordinator: jest.fn().mockReturnValue(mockCoordinator),
    getHederaClient: jest.fn().mockReturnValue(mockHederaClient),
    getBalance: jest.fn().mockResolvedValue(overrides.balance ?? 100),
    submitTask: jest.fn().mockResolvedValue('task-abc'),
    executeCapability: jest.fn().mockResolvedValue(overrides.capResult ?? { result: 'ok' }),
  } as unknown as jest.Mocked<MeshNode>;
}

describe('MCP Server - Tool Schema Validation', () => {
  let server: MCPServer;

  beforeEach(() => {
    server = new MCPServer(createMockMeshNode());
  });

  it('should have proper schema for each tool', () => {
    const tools = server.listTools();
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('should have required fields on submit_task', () => {
    const tools = server.listTools();
    const submitTask = tools.find(t => t.name === 'submit_task');
    expect(submitTask).toBeDefined();
    expect(submitTask!.inputSchema.required).toContain('description');
    expect(submitTask!.inputSchema.required).toContain('capabilities');
  });

  it('should have required fields on send_message', () => {
    const tools = server.listTools();
    const sendMessage = tools.find(t => t.name === 'send_message');
    expect(sendMessage).toBeDefined();
    expect(sendMessage!.inputSchema.required).toContain('agentId');
    expect(sendMessage!.inputSchema.required).toContain('message');
  });

  it('should have required fields on execute_capability', () => {
    const tools = server.listTools();
    const execCap = tools.find(t => t.name === 'execute_capability');
    expect(execCap).toBeDefined();
    expect(execCap!.inputSchema.required).toContain('capability');
  });

  it('should have no required fields for discover_agents', () => {
    const tools = server.listTools();
    const discover = tools.find(t => t.name === 'discover_agents');
    expect(discover).toBeDefined();
    expect(discover!.inputSchema.required).toBeUndefined();
  });

  it('should have no required fields for mesh_status', () => {
    const tools = server.listTools();
    const status = tools.find(t => t.name === 'mesh_status');
    expect(status).toBeDefined();
    expect(status!.inputSchema.required).toBeUndefined();
  });
});

describe('MCP Server - discover_agents Edge Cases', () => {
  it('should return empty agents list when none found', async () => {
    const server = new MCPServer(createMockMeshNode());
    const result = await server.handleToolCall('discover_agents', {});
    const data = JSON.parse(result.content[0]!.text);
    expect(data.agents).toEqual([]);
    expect(data.totalFound).toBe(0);
  });

  it('should pass capability filter to mesh node', async () => {
    const mock = createMockMeshNode();
    const server = new MCPServer(mock);

    await server.handleToolCall('discover_agents', { capability: 'data_analysis' });
    expect(mock.discoverAgents).toHaveBeenCalledWith('data_analysis');
  });

  it('should pass undefined when no capability specified', async () => {
    const mock = createMockMeshNode();
    const server = new MCPServer(mock);

    await server.handleToolCall('discover_agents', {});
    expect(mock.discoverAgents).toHaveBeenCalledWith(undefined);
  });

  it('should return agent capabilities as name strings', async () => {
    const mock = createMockMeshNode({
      registry: {
        discoverAgents: jest.fn().mockReturnValue({
          agents: [{
            id: 'a1', name: 'Agent1', description: 'Test',
            capabilities: [
              { name: 'cap1', description: 'Cap 1' },
              { name: 'cap2', description: 'Cap 2' },
            ],
            status: 'active',
          }],
          totalFound: 1,
          queryTime: 3,
        }),
      },
    });
    mock.discoverAgents = jest.fn().mockReturnValue(
      mock.getRegistry().discoverAgents()
    );

    const server = new MCPServer(mock);
    const result = await server.handleToolCall('discover_agents', {});
    const data = JSON.parse(result.content[0]!.text);

    expect(data.agents[0].capabilities).toEqual(['cap1', 'cap2']);
  });
});

describe('MCP Server - submit_task Edge Cases', () => {
  it('should use empty payload when not provided', async () => {
    const mock = createMockMeshNode();
    const server = new MCPServer(mock);

    await server.handleToolCall('submit_task', {
      description: 'Test task',
      capabilities: ['research'],
    });

    expect(mock.submitTask).toHaveBeenCalledWith(
      'Test task', ['research'], {}, 'medium'
    );
  });

  it('should pass payload when provided', async () => {
    const mock = createMockMeshNode();
    const server = new MCPServer(mock);

    await server.handleToolCall('submit_task', {
      description: 'Test',
      capabilities: ['research'],
      payload: { key: 'value' },
      priority: 'critical',
    });

    expect(mock.submitTask).toHaveBeenCalledWith(
      'Test', ['research'], { key: 'value' }, 'critical'
    );
  });

  it('should return task ID in response', async () => {
    const server = new MCPServer(createMockMeshNode());
    const result = await server.handleToolCall('submit_task', {
      description: 'Test',
      capabilities: ['a'],
    });

    const data = JSON.parse(result.content[0]!.text);
    expect(data.taskId).toBe('task-abc');
    expect(data.status).toBe('submitted');
  });
});

describe('MCP Server - mesh_status Edge Cases', () => {
  it('should handle null profile', async () => {
    const mock = createMockMeshNode({ nullProfile: true });
    const server = new MCPServer(mock);

    const result = await server.handleToolCall('mesh_status', {});
    const data = JSON.parse(result.content[0]!.text);
    expect(data.node).toBeNull();
  });

  it('should handle balance error gracefully', async () => {
    const mock = createMockMeshNode();
    mock.getBalance = jest.fn().mockRejectedValue(new Error('No network'));

    const server = new MCPServer(mock);
    const result = await server.handleToolCall('mesh_status', {});
    const data = JSON.parse(result.content[0]!.text);

    expect(data.network.balance).toBe('unknown');
  });

  it('should include all expected fields', async () => {
    const server = new MCPServer(createMockMeshNode());
    const result = await server.handleToolCall('mesh_status', {});
    const data = JSON.parse(result.content[0]!.text);

    expect(data).toHaveProperty('node');
    expect(data).toHaveProperty('network');
    expect(data.network).toHaveProperty('totalAgents');
    expect(data.network).toHaveProperty('activeTasks');
    expect(data.network).toHaveProperty('balance');
  });

  it('should return correct node fields', async () => {
    const server = new MCPServer(createMockMeshNode());
    const result = await server.handleToolCall('mesh_status', {});
    const data = JSON.parse(result.content[0]!.text);

    expect(data.node.id).toBe('node-1');
    expect(data.node.name).toBe('TestNode');
    expect(data.node.status).toBe('active');
    expect(data.node.hederaAccount).toBe('0.0.12345');
  });
});

describe('MCP Server - send_message Edge Cases', () => {
  it('should return error when agent not found', async () => {
    const server = new MCPServer(createMockMeshNode());
    const result = await server.handleToolCall('send_message', {
      agentId: 'nonexistent',
      message: 'Hello',
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.error).toBe('Agent not found');
  });

  it('should send message to found agent', async () => {
    const mock = createMockMeshNode({
      registry: {
        getAgent: jest.fn().mockReturnValue({
          id: 'a1', name: 'FoundAgent', inboundTopicId: '0.0.500',
        }),
        discoverAgents: jest.fn().mockReturnValue({ agents: [], totalFound: 0, queryTime: 0 }),
        getAgentCount: jest.fn().mockReturnValue(0),
      },
    });

    const server = new MCPServer(mock);
    const result = await server.handleToolCall('send_message', {
      agentId: 'a1',
      message: 'Hello agent!',
    });

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.status).toBe('sent');
    expect(data.to).toBe('FoundAgent');
  });

  it('should include sender ID in message payload', async () => {
    const mockHederaClient = { submitMessage: jest.fn().mockResolvedValue(1) };
    const mock = createMockMeshNode({
      registry: {
        getAgent: jest.fn().mockReturnValue({
          id: 'a1', name: 'Target', inboundTopicId: '0.0.500',
        }),
        discoverAgents: jest.fn().mockReturnValue({ agents: [], totalFound: 0, queryTime: 0 }),
        getAgentCount: jest.fn().mockReturnValue(0),
      },
      hederaClient: mockHederaClient,
    });

    const server = new MCPServer(mock);
    await server.handleToolCall('send_message', {
      agentId: 'a1',
      message: 'Test',
    });

    expect(mockHederaClient.submitMessage).toHaveBeenCalled();
    const call = mockHederaClient.submitMessage.mock.calls[0];
    expect(call[0]).toBe('0.0.500');
    const payload = JSON.parse(call[1]);
    expect(payload.type).toBe('data.request');
    expect(payload.senderId).toBe('node-1');
    expect(payload.payload.message).toBe('Test');
  });
});

describe('MCP Server - execute_capability Edge Cases', () => {
  it('should pass empty input when not provided', async () => {
    const mock = createMockMeshNode();
    const server = new MCPServer(mock);

    await server.handleToolCall('execute_capability', {
      capability: 'test_cap',
    });

    expect(mock.executeCapability).toHaveBeenCalledWith('test_cap', {});
  });

  it('should pass input when provided', async () => {
    const mock = createMockMeshNode();
    const server = new MCPServer(mock);

    await server.handleToolCall('execute_capability', {
      capability: 'test_cap',
      input: { key: 'value' },
    });

    expect(mock.executeCapability).toHaveBeenCalledWith('test_cap', { key: 'value' });
  });

  it('should return error on capability failure', async () => {
    const mock = createMockMeshNode();
    mock.executeCapability = jest.fn().mockRejectedValue(new Error('Capability failed'));

    const server = new MCPServer(mock);
    const result = await server.handleToolCall('execute_capability', {
      capability: 'broken',
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.error).toContain('Capability failed');
  });

  it('should return result on success', async () => {
    const mock = createMockMeshNode({ capResult: { computed: true, value: 42 } });
    const server = new MCPServer(mock);

    const result = await server.handleToolCall('execute_capability', {
      capability: 'test_cap',
      input: {},
    });

    const data = JSON.parse(result.content[0]!.text);
    expect(data.result).toEqual({ computed: true, value: 42 });
  });
});

describe('MCP Server - list_capabilities Edge Cases', () => {
  it('should return empty capabilities when profile has none', async () => {
    const mock = createMockMeshNode({ capabilities: [] });
    const server = new MCPServer(mock);

    const result = await server.handleToolCall('list_capabilities', {});
    const data = JSON.parse(result.content[0]!.text);
    expect(data.capabilities).toEqual([]);
  });

  it('should return null capabilities when profile is null', async () => {
    const mock = createMockMeshNode({ nullProfile: true });
    const server = new MCPServer(mock);

    const result = await server.handleToolCall('list_capabilities', {});
    const data = JSON.parse(result.content[0]!.text);
    // profile?.capabilities || [] -> should be empty
    expect(data.capabilities).toEqual([]);
  });

  it('should return multiple capabilities', async () => {
    const mock = createMockMeshNode({
      capabilities: [
        { name: 'cap1', description: 'Cap 1', inputSchema: {}, outputSchema: {} },
        { name: 'cap2', description: 'Cap 2', inputSchema: {}, outputSchema: {} },
        { name: 'cap3', description: 'Cap 3', inputSchema: {}, outputSchema: {} },
      ],
    });
    const server = new MCPServer(mock);

    const result = await server.handleToolCall('list_capabilities', {});
    const data = JSON.parse(result.content[0]!.text);
    expect(data.capabilities).toHaveLength(3);
  });
});

describe('MCP Server - Custom Tool Registration', () => {
  it('should allow registering a tool with handler', async () => {
    const server = new MCPServer(createMockMeshNode());

    server.registerTool(
      {
        name: 'my_tool',
        description: 'Custom tool',
        inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      },
      async (args) => ({
        content: [{ type: 'text', text: JSON.stringify({ doubled: (args.x as number) * 2 }) }],
      })
    );

    const result = await server.handleToolCall('my_tool', { x: 21 });
    const data = JSON.parse(result.content[0]!.text);
    expect(data.doubled).toBe(42);
  });

  it('should overwrite existing tool with same name', async () => {
    const server = new MCPServer(createMockMeshNode());
    const initialCount = server.getToolCount();

    server.registerTool(
      { name: 'discover_agents', description: 'Overridden', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: 'overridden' }] })
    );

    expect(server.getToolCount()).toBe(initialCount); // Same count, overwritten
    const result = await server.handleToolCall('discover_agents', {});
    expect(result.content[0]!.text).toBe('overridden');
  });

  it('should list custom tools in getToolsListResponse', () => {
    const server = new MCPServer(createMockMeshNode());

    server.registerTool(
      { name: 'custom', description: 'Custom', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: '' }] })
    );

    const response = server.getToolsListResponse();
    const names = response.tools.map(t => t.name);
    expect(names).toContain('custom');
  });

  it('should handle async error in custom tool handler', async () => {
    const server = new MCPServer(createMockMeshNode());

    server.registerTool(
      { name: 'error_tool', description: 'Fails', inputSchema: { type: 'object', properties: {} } },
      async () => { throw new Error('custom error'); }
    );

    // The handler will throw, which should propagate
    await expect(server.handleToolCall('error_tool', {})).rejects.toThrow('custom error');
  });
});

describe('MCP Server - Response Format', () => {
  it('should always return content array with text type', async () => {
    const server = new MCPServer(createMockMeshNode());

    const tools = ['discover_agents', 'mesh_status', 'list_capabilities'];
    for (const tool of tools) {
      const result = await server.handleToolCall(tool, {});
      expect(result.content).toBeInstanceOf(Array);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0]!.type).toBe('text');
      expect(typeof result.content[0]!.text).toBe('string');
    }
  });

  it('should return valid JSON in text field for all built-in tools', async () => {
    const server = new MCPServer(createMockMeshNode());

    const tools = ['discover_agents', 'mesh_status', 'list_capabilities'];
    for (const tool of tools) {
      const result = await server.handleToolCall(tool, {});
      expect(() => JSON.parse(result.content[0]!.text)).not.toThrow();
    }
  });

  it('should set isError flag for unknown tools', async () => {
    const server = new MCPServer(createMockMeshNode());
    const result = await server.handleToolCall('nonexistent_tool', {});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Unknown tool');
    expect(result.content[0]!.text).toContain('nonexistent_tool');
  });
});
