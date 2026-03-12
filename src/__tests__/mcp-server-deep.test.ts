/**
 * MCPServer - Deep coverage tests
 *
 * Covers: tool registration edge cases, handler error paths, JSON format validation,
 * custom tool overriding, concurrent calls, mesh_status with balance error,
 * tool listing, and MCP protocol compliance.
 */

import { MCPServer, MCPTool, MCPToolResult } from '../mcp/mcp-server';
import { MeshNode } from '../core/mesh-node';
import { AgentProfile } from '../core/types';

function createMockProfile(): AgentProfile {
  return {
    id: 'node-1',
    name: 'TestNode',
    description: 'Test mesh node',
    capabilities: [
      { name: 'web_research', description: 'Web research', inputSchema: {}, outputSchema: {} },
      { name: 'data_analysis', description: 'Data analysis', inputSchema: {}, outputSchema: {} },
    ],
    hederaAccountId: '0.0.12345',
    inboundTopicId: '0.0.100',
    outboundTopicId: '0.0.101',
    registryTopicId: '0.0.102',
    status: 'active',
    createdAt: Date.now(),
    metadata: {},
  };
}

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

  return {
    discoverAgents: jest.fn().mockReturnValue({
      agents: [],
      totalFound: 0,
      queryTime: 1,
    }),
    getProfile: jest.fn().mockReturnValue(createMockProfile()),
    getRegistry: jest.fn().mockReturnValue(mockRegistry),
    getCoordinator: jest.fn().mockReturnValue(mockCoordinator),
    getHederaClient: jest.fn().mockReturnValue(mockHederaClient),
    getBalance: jest.fn().mockResolvedValue(100),
    submitTask: jest.fn().mockResolvedValue('task-new'),
    executeCapability: jest.fn().mockResolvedValue({ result: 'done' }),
    ...overrides,
  } as unknown as jest.Mocked<MeshNode>;
}

describe('MCPServer - Tool Registration', () => {
  it('should register custom tool with handler', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    server.registerTool(
      {
        name: 'my_tool',
        description: 'My custom tool',
        inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
      },
      async (args) => ({
        content: [{ type: 'text', text: `Processed: ${args.input}` }],
      })
    );

    const result = await server.handleToolCall('my_tool', { input: 'test' });
    expect(result.content[0]!.text).toBe('Processed: test');
  });

  it('should overwrite existing tool with same name', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    server.registerTool(
      { name: 'dup_tool', description: 'V1', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: 'v1' }] })
    );

    server.registerTool(
      { name: 'dup_tool', description: 'V2', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: 'v2' }] })
    );

    const result = await server.handleToolCall('dup_tool', {});
    expect(result.content[0]!.text).toBe('v2');

    const tools = server.listTools();
    const dupTool = tools.find(t => t.name === 'dup_tool');
    expect(dupTool!.description).toBe('V2');
  });

  it('should not affect other tools when overwriting', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);
    const initialCount = server.getToolCount();

    server.registerTool(
      { name: 'tool_a', description: 'A', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: 'a' }] })
    );

    server.registerTool(
      { name: 'tool_b', description: 'B', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: 'b' }] })
    );

    expect(server.getToolCount()).toBe(initialCount + 2);

    const resultA = await server.handleToolCall('tool_a', {});
    const resultB = await server.handleToolCall('tool_b', {});
    expect(resultA.content[0]!.text).toBe('a');
    expect(resultB.content[0]!.text).toBe('b');
  });

  it('should allow overriding builtin tools', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    server.registerTool(
      { name: 'discover_agents', description: 'Custom discover', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: 'custom_discover' }] })
    );

    const result = await server.handleToolCall('discover_agents', {});
    expect(result.content[0]!.text).toBe('custom_discover');
  });
});

describe('MCPServer - discover_agents Tool', () => {
  it('should pass undefined capability for no filter', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    await server.handleToolCall('discover_agents', {});
    expect(node.discoverAgents).toHaveBeenCalledWith(undefined);
  });

  it('should pass capability string filter', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    await server.handleToolCall('discover_agents', { capability: 'web_research' });
    expect(node.discoverAgents).toHaveBeenCalledWith('web_research');
  });

  it('should return properly formatted JSON', async () => {
    const mockAgents = [
      {
        id: 'a1', name: 'Agent1', description: 'Desc1',
        capabilities: [{ name: 'cap1' }], status: 'active',
      },
      {
        id: 'a2', name: 'Agent2', description: 'Desc2',
        capabilities: [{ name: 'cap2' }], status: 'busy',
      },
    ];
    const node = createMockMeshNode({
      discoverAgents: jest.fn().mockReturnValue({
        agents: mockAgents,
        totalFound: 2,
        queryTime: 3,
      }),
    });
    const server = new MCPServer(node);

    const result = await server.handleToolCall('discover_agents', {});
    const data = JSON.parse(result.content[0]!.text);

    expect(data.agents).toHaveLength(2);
    expect(data.agents[0].id).toBe('a1');
    expect(data.agents[1].id).toBe('a2');
    expect(data.totalFound).toBe(2);
    expect(data.queryTime).toBe(3);
  });
});

describe('MCPServer - submit_task Tool', () => {
  it('should submit task with all parameters', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    const result = await server.handleToolCall('submit_task', {
      description: 'Research AI trends',
      capabilities: ['web_research', 'analysis'],
      priority: 'critical',
      payload: { topic: 'AI', depth: 'deep' },
    });

    expect(node.submitTask).toHaveBeenCalledWith(
      'Research AI trends',
      ['web_research', 'analysis'],
      { topic: 'AI', depth: 'deep' },
      'critical'
    );

    const data = JSON.parse(result.content[0]!.text);
    expect(data.taskId).toBe('task-new');
    expect(data.status).toBe('submitted');
  });

  it('should default priority to medium and payload to empty', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    await server.handleToolCall('submit_task', {
      description: 'Simple task',
      capabilities: ['a'],
    });

    expect(node.submitTask).toHaveBeenCalledWith('Simple task', ['a'], {}, 'medium');
  });
});

describe('MCPServer - mesh_status Tool', () => {
  it('should return full status with balance', async () => {
    const node = createMockMeshNode();
    node.getRegistry().getAgentCount = jest.fn().mockReturnValue(5);
    node.getCoordinator().getTaskCount = jest.fn().mockReturnValue(3);
    const server = new MCPServer(node);

    const result = await server.handleToolCall('mesh_status', {});
    const data = JSON.parse(result.content[0]!.text);

    expect(data.node.id).toBe('node-1');
    expect(data.node.name).toBe('TestNode');
    expect(data.node.status).toBe('active');
    expect(data.network.totalAgents).toBe(5);
    expect(data.network.activeTasks).toBe(3);
    expect(data.network.balance).toBe(100);
  });

  it('should return unknown balance on error', async () => {
    const node = createMockMeshNode({
      getBalance: jest.fn().mockRejectedValue(new Error('Network error')),
    });
    const server = new MCPServer(node);

    const result = await server.handleToolCall('mesh_status', {});
    const data = JSON.parse(result.content[0]!.text);
    expect(data.network.balance).toBe('unknown');
  });

  it('should return null node when profile is null', async () => {
    const node = createMockMeshNode({
      getProfile: jest.fn().mockReturnValue(null),
    });
    const server = new MCPServer(node);

    const result = await server.handleToolCall('mesh_status', {});
    const data = JSON.parse(result.content[0]!.text);
    expect(data.node).toBeNull();
  });
});

describe('MCPServer - send_message Tool', () => {
  it('should send message to existing agent', async () => {
    const mockAgent = {
      id: 'target-agent',
      name: 'TargetAgent',
      inboundTopicId: '0.0.500',
    };
    const node = createMockMeshNode();
    node.getRegistry().getAgent = jest.fn().mockReturnValue(mockAgent);
    const server = new MCPServer(node);

    const result = await server.handleToolCall('send_message', {
      agentId: 'target-agent',
      message: 'Hello there',
    });

    const data = JSON.parse(result.content[0]!.text);
    expect(data.status).toBe('sent');
    expect(data.to).toBe('TargetAgent');

    // Verify the message was submitted to the agent's inbound topic
    const hederaClient = node.getHederaClient();
    expect(hederaClient.submitMessage).toHaveBeenCalledWith(
      '0.0.500',
      expect.any(String)
    );

    // Verify message format
    const sentMsg = JSON.parse((hederaClient.submitMessage as jest.Mock).mock.calls[0][1]);
    expect(sentMsg.type).toBe('data.request');
    expect(sentMsg.recipientId).toBe('target-agent');
    expect(sentMsg.payload.message).toBe('Hello there');
  });

  it('should return error for non-existent agent', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    const result = await server.handleToolCall('send_message', {
      agentId: 'nonexistent',
      message: 'Hello',
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.error).toBe('Agent not found');
  });
});

describe('MCPServer - execute_capability Tool', () => {
  it('should execute capability with input', async () => {
    const node = createMockMeshNode({
      executeCapability: jest.fn().mockResolvedValue({ analysis: 'complete', score: 0.95 }),
    });
    const server = new MCPServer(node);

    const result = await server.handleToolCall('execute_capability', {
      capability: 'data_analysis',
      input: { data: [1, 2, 3] },
    });

    const data = JSON.parse(result.content[0]!.text);
    expect(data.result.analysis).toBe('complete');
    expect(data.result.score).toBe(0.95);
  });

  it('should use empty input when not provided', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    await server.handleToolCall('execute_capability', {
      capability: 'test_cap',
    });

    expect(node.executeCapability).toHaveBeenCalledWith('test_cap', {});
  });

  it('should return error when capability throws', async () => {
    const node = createMockMeshNode({
      executeCapability: jest.fn().mockRejectedValue(new Error('No handler for capability: xyz')),
    });
    const server = new MCPServer(node);

    const result = await server.handleToolCall('execute_capability', {
      capability: 'xyz',
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.error).toContain('No handler');
  });
});

describe('MCPServer - list_capabilities Tool', () => {
  it('should list all node capabilities', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    const result = await server.handleToolCall('list_capabilities', {});
    const data = JSON.parse(result.content[0]!.text);

    expect(data.capabilities).toHaveLength(2);
    expect(data.capabilities[0].name).toBe('web_research');
    expect(data.capabilities[1].name).toBe('data_analysis');
  });

  it('should return empty capabilities when profile is null', async () => {
    const node = createMockMeshNode({
      getProfile: jest.fn().mockReturnValue(null),
    });
    const server = new MCPServer(node);

    const result = await server.handleToolCall('list_capabilities', {});
    const data = JSON.parse(result.content[0]!.text);
    expect(data.capabilities).toEqual([]);
  });
});

describe('MCPServer - getToolsListResponse', () => {
  it('should return all tools including custom ones', () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    server.registerTool(
      { name: 'custom', description: 'Custom', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: 'ok' }] })
    );

    const response = server.getToolsListResponse();
    expect(response.tools.length).toBe(7); // 6 builtin + 1 custom
    expect(response.tools.find(t => t.name === 'custom')).toBeDefined();
  });

  it('should include all required MCP tool fields', () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    const response = server.getToolsListResponse();
    for (const tool of response.tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe('object');
      expect(typeof tool.inputSchema.properties).toBe('object');
    }
  });
});

describe('MCPServer - Unknown Tool Handling', () => {
  it('should return isError=true for unknown tool', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    const result = await server.handleToolCall('nonexistent_tool', {});
    expect(result.isError).toBe(true);
  });

  it('should include tool name in error message', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    const result = await server.handleToolCall('my_unknown_tool', {});
    expect(result.content[0]!.text).toContain('my_unknown_tool');
  });

  it('should return single content item for unknown tool error', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    const result = await server.handleToolCall('x', {});
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');
  });
});

describe('MCPServer - Concurrent Tool Calls', () => {
  it('should handle multiple simultaneous tool calls', async () => {
    const node = createMockMeshNode();
    const server = new MCPServer(node);

    const promises = [
      server.handleToolCall('discover_agents', {}),
      server.handleToolCall('mesh_status', {}),
      server.handleToolCall('list_capabilities', {}),
      server.handleToolCall('discover_agents', { capability: 'research' }),
    ];

    const results = await Promise.all(promises);
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.isError).toBeFalsy();
    }
  });
});
