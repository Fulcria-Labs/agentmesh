import { MCPServer } from '../mcp/mcp-server';
import { MeshNode } from '../core/mesh-node';
import { AgentProfile } from '../core/types';

// Create a minimal mock MeshNode
function createMockMeshNode(): jest.Mocked<MeshNode> {
  const mockRegistry = {
    discoverAgents: jest.fn().mockReturnValue({
      agents: [
        {
          id: 'agent-1',
          name: 'ResearchAgent',
          description: 'Research specialist',
          capabilities: [{ name: 'web_research', description: 'Research' }],
          status: 'active',
        },
      ],
      totalFound: 1,
      queryTime: 5,
    }),
    getAgent: jest.fn().mockReturnValue({
      id: 'agent-1',
      name: 'ResearchAgent',
      inboundTopicId: '0.0.200',
    }),
    getAgentCount: jest.fn().mockReturnValue(3),
  };

  const mockCoordinator = {
    getTaskCount: jest.fn().mockReturnValue(5),
    submitTask: jest.fn().mockResolvedValue('task-123'),
  };

  const mockHederaClient = {
    submitMessage: jest.fn().mockResolvedValue(1),
  };

  const mockProfile: AgentProfile = {
    id: 'node-1',
    name: 'TestNode',
    description: 'Test mesh node',
    capabilities: [
      { name: 'test_cap', description: 'Test capability', inputSchema: {}, outputSchema: {} },
    ],
    hederaAccountId: '0.0.12345',
    inboundTopicId: '0.0.100',
    outboundTopicId: '0.0.101',
    registryTopicId: '0.0.102',
    status: 'active',
    createdAt: Date.now(),
    metadata: {},
  };

  const mock = {
    discoverAgents: jest.fn().mockReturnValue({
      agents: mockRegistry.discoverAgents().agents,
      totalFound: 1,
      queryTime: 5,
    }),
    getProfile: jest.fn().mockReturnValue(mockProfile),
    getRegistry: jest.fn().mockReturnValue(mockRegistry),
    getCoordinator: jest.fn().mockReturnValue(mockCoordinator),
    getHederaClient: jest.fn().mockReturnValue(mockHederaClient),
    getBalance: jest.fn().mockResolvedValue(100),
    submitTask: jest.fn().mockResolvedValue('task-123'),
    executeCapability: jest.fn().mockResolvedValue({ result: 'executed' }),
  } as unknown as jest.Mocked<MeshNode>;

  return mock;
}

describe('MCPServer', () => {
  let server: MCPServer;
  let mockNode: jest.Mocked<MeshNode>;

  beforeEach(() => {
    mockNode = createMockMeshNode();
    server = new MCPServer(mockNode);
  });

  describe('initialization', () => {
    it('should register builtin tools', () => {
      const tools = server.listTools();
      expect(tools.length).toBeGreaterThanOrEqual(6);
    });

    it('should have discover_agents tool', () => {
      const tools = server.listTools();
      expect(tools.find(t => t.name === 'discover_agents')).toBeDefined();
    });

    it('should have submit_task tool', () => {
      const tools = server.listTools();
      expect(tools.find(t => t.name === 'submit_task')).toBeDefined();
    });

    it('should have mesh_status tool', () => {
      const tools = server.listTools();
      expect(tools.find(t => t.name === 'mesh_status')).toBeDefined();
    });

    it('should have send_message tool', () => {
      const tools = server.listTools();
      expect(tools.find(t => t.name === 'send_message')).toBeDefined();
    });

    it('should have execute_capability tool', () => {
      const tools = server.listTools();
      expect(tools.find(t => t.name === 'execute_capability')).toBeDefined();
    });

    it('should have list_capabilities tool', () => {
      const tools = server.listTools();
      expect(tools.find(t => t.name === 'list_capabilities')).toBeDefined();
    });
  });

  describe('discover_agents tool', () => {
    it('should return discovered agents', async () => {
      const result = await server.handleToolCall('discover_agents', {});
      const data = JSON.parse(result.content[0]!.text);
      expect(data.totalFound).toBe(1);
      expect(data.agents[0].name).toBe('ResearchAgent');
    });

    it('should pass capability filter', async () => {
      await server.handleToolCall('discover_agents', { capability: 'research' });
      expect(mockNode.discoverAgents).toHaveBeenCalledWith('research');
    });
  });

  describe('submit_task tool', () => {
    it('should submit a task', async () => {
      const result = await server.handleToolCall('submit_task', {
        description: 'Test task',
        capabilities: ['research'],
        priority: 'high',
      });

      const data = JSON.parse(result.content[0]!.text);
      expect(data.taskId).toBe('task-123');
      expect(data.status).toBe('submitted');
    });

    it('should use default priority', async () => {
      await server.handleToolCall('submit_task', {
        description: 'Test',
        capabilities: ['research'],
      });

      expect(mockNode.submitTask).toHaveBeenCalledWith(
        'Test', ['research'], {}, 'medium'
      );
    });
  });

  describe('mesh_status tool', () => {
    it('should return mesh status', async () => {
      const result = await server.handleToolCall('mesh_status', {});
      const data = JSON.parse(result.content[0]!.text);

      expect(data.node.name).toBe('TestNode');
      expect(data.network.totalAgents).toBe(3);
      expect(data.network.activeTasks).toBe(5);
      expect(data.network.balance).toBe(100);
    });
  });

  describe('send_message tool', () => {
    it('should send message to agent', async () => {
      const result = await server.handleToolCall('send_message', {
        agentId: 'agent-1',
        message: 'Hello',
      });

      const data = JSON.parse(result.content[0]!.text);
      expect(data.status).toBe('sent');
      expect(data.to).toBe('ResearchAgent');
    });

    it('should return error for unknown agent', async () => {
      mockNode.getRegistry().getAgent = jest.fn().mockReturnValue(undefined);

      const result = await server.handleToolCall('send_message', {
        agentId: 'unknown',
        message: 'Hello',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('execute_capability tool', () => {
    it('should execute a capability', async () => {
      const result = await server.handleToolCall('execute_capability', {
        capability: 'test_cap',
        input: { data: 'test' },
      });

      const data = JSON.parse(result.content[0]!.text);
      expect(data.result).toEqual({ result: 'executed' });
    });

    it('should return error on failure', async () => {
      mockNode.executeCapability = jest.fn().mockRejectedValue(new Error('not found'));

      const result = await server.handleToolCall('execute_capability', {
        capability: 'unknown',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('list_capabilities tool', () => {
    it('should list node capabilities', async () => {
      const result = await server.handleToolCall('list_capabilities', {});
      const data = JSON.parse(result.content[0]!.text);
      expect(data.capabilities).toHaveLength(1);
      expect(data.capabilities[0].name).toBe('test_cap');
    });
  });

  describe('unknown tool', () => {
    it('should return error for unknown tool', async () => {
      const result = await server.handleToolCall('nonexistent', {});
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Unknown tool');
    });
  });

  describe('registerTool', () => {
    it('should register custom tools', async () => {
      server.registerTool(
        {
          name: 'custom_tool',
          description: 'A custom tool',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({
          content: [{ type: 'text', text: 'custom result' }],
        })
      );

      expect(server.getToolCount()).toBe(7); // 6 builtin + 1 custom
      const result = await server.handleToolCall('custom_tool', {});
      expect(result.content[0]!.text).toBe('custom result');
    });
  });

  describe('getToolsListResponse', () => {
    it('should return MCP-compatible tools list', () => {
      const response = server.getToolsListResponse();
      expect(response.tools).toBeDefined();
      expect(Array.isArray(response.tools)).toBe(true);
      expect(response.tools.length).toBeGreaterThan(0);

      for (const tool of response.tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });

  describe('getToolCount', () => {
    it('should return correct count', () => {
      expect(server.getToolCount()).toBe(6);
    });
  });
});
