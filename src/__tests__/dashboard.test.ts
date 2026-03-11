/**
 * Tests for AgentMesh Dashboard
 */

import { Dashboard } from '../dashboard/server';
import * as http from 'http';

// Helper to make HTTP requests to the dashboard
function fetch(url: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, body, headers: res.headers }));
    }).on('error', reject);
  });
}

describe('Dashboard', () => {
  let dashboard: Dashboard;
  let baseUrl: string;

  beforeEach(async () => {
    // Use random port to avoid conflicts
    const port = 30000 + Math.floor(Math.random() * 10000);
    dashboard = new Dashboard({ port, host: '127.0.0.1' });
    baseUrl = await dashboard.start();
  });

  afterEach(async () => {
    await dashboard.stop();
  });

  describe('constructor', () => {
    it('should use default port 3456', () => {
      const d = new Dashboard();
      expect(d.getPort()).toBe(3456);
    });

    it('should accept custom port', () => {
      const d = new Dashboard({ port: 8080 });
      expect(d.getPort()).toBe(8080);
    });
  });

  describe('start/stop', () => {
    it('should start and return URL', () => {
      expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    });

    it('should serve requests after start', async () => {
      const res = await fetch(baseUrl);
      expect(res.status).toBe(200);
    });

    it('should stop cleanly', async () => {
      await dashboard.stop();
      // Double stop should be safe
      await dashboard.stop();
    });
  });

  describe('HTML dashboard', () => {
    it('should return HTML for root path', async () => {
      const res = await fetch(baseUrl + '/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/html');
      expect(res.body).toContain('AgentMesh');
    });

    it('should contain dashboard elements', async () => {
      const res = await fetch(baseUrl + '/');
      expect(res.body).toContain('Agents Online');
      expect(res.body).toContain('Active Tasks');
      expect(res.body).toContain('Node Status');
      expect(res.body).toContain('Uptime');
    });

    it('should contain auto-refresh script', async () => {
      const res = await fetch(baseUrl + '/');
      expect(res.body).toContain('setInterval');
      expect(res.body).toContain('/api/status');
    });

    it('should return HTML for unknown paths', async () => {
      const res = await fetch(baseUrl + '/unknown');
      expect(res.status).toBe(200);
      expect(res.body).toContain('AgentMesh');
    });
  });

  describe('API: /api/status', () => {
    it('should return JSON status', async () => {
      const res = await fetch(baseUrl + '/api/status');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/json');

      const data = JSON.parse(res.body);
      expect(data).toHaveProperty('node');
      expect(data).toHaveProperty('agents');
      expect(data).toHaveProperty('tasks');
      expect(data).toHaveProperty('uptime');
    });

    it('should return null node when no mesh node', async () => {
      const res = await fetch(baseUrl + '/api/status');
      const data = JSON.parse(res.body);
      expect(data.node).toBeNull();
    });

    it('should return 0 agents when no registry', async () => {
      const res = await fetch(baseUrl + '/api/status');
      const data = JSON.parse(res.body);
      expect(data.agents).toBe(0);
    });

    it('should return 0 tasks when no coordinator', async () => {
      const res = await fetch(baseUrl + '/api/status');
      const data = JSON.parse(res.body);
      expect(data.tasks).toBe(0);
    });

    it('should include CORS header', async () => {
      const res = await fetch(baseUrl + '/api/status');
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('API: /api/agents', () => {
    it('should return empty array when no registry', async () => {
      const res = await fetch(baseUrl + '/api/agents');
      expect(res.status).toBe(200);

      const data = JSON.parse(res.body);
      expect(data).toEqual([]);
    });

    it('should include CORS header', async () => {
      const res = await fetch(baseUrl + '/api/agents');
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('API: /api/tasks', () => {
    it('should return empty array when no coordinator', async () => {
      const res = await fetch(baseUrl + '/api/tasks');
      expect(res.status).toBe(200);

      const data = JSON.parse(res.body);
      expect(data).toEqual([]);
    });

    it('should include CORS header', async () => {
      const res = await fetch(baseUrl + '/api/tasks');
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });
  });
});

describe('Dashboard with mock mesh node', () => {
  let dashboard: Dashboard;
  let baseUrl: string;

  const mockProfile = {
    id: 'agent-1',
    name: 'TestAgent',
    description: 'A test agent',
    status: 'active',
    hederaAccountId: '0.0.100',
    capabilities: [
      { name: 'research', description: 'Research', inputSchema: {}, outputSchema: {} },
    ],
    inboundTopicId: '0.0.1001',
    outboundTopicId: '0.0.1002',
    registryTopicId: '0.0.2000',
    createdAt: Date.now(),
    metadata: {},
  };

  const mockAgents = [
    mockProfile,
    { ...mockProfile, id: 'agent-2', name: 'Agent2', hederaAccountId: '0.0.200' },
  ];

  const mockTasks = [
    {
      id: 'task-1',
      description: 'Research AI trends',
      requiredCapabilities: ['research'],
      payload: {},
      priority: 'high' as const,
      requesterId: 'agent-1',
      createdAt: Date.now(),
    },
  ];

  const mockRegistry = {
    getAgentCount: jest.fn().mockReturnValue(2),
    getAllAgents: jest.fn().mockReturnValue(mockAgents),
  };

  const mockCoordinator = {
    getTaskCount: jest.fn().mockReturnValue(1),
    getAllTasks: jest.fn().mockReturnValue(mockTasks),
    getTaskBids: jest.fn().mockReturnValue([{ taskId: 'task-1', agentId: 'agent-1' }]),
    getTaskAssignments: jest.fn().mockReturnValue([]),
  };

  const mockMeshNode = {
    getProfile: jest.fn().mockReturnValue(mockProfile),
    getRegistry: jest.fn().mockReturnValue(mockRegistry),
    getCoordinator: jest.fn().mockReturnValue(mockCoordinator),
  };

  beforeEach(async () => {
    const port = 30000 + Math.floor(Math.random() * 10000);
    dashboard = new Dashboard({
      port,
      host: '127.0.0.1',
      meshNode: mockMeshNode as any,
    });
    baseUrl = await dashboard.start();
  });

  afterEach(async () => {
    await dashboard.stop();
  });

  it('should return node info in status', async () => {
    const res = await fetch(baseUrl + '/api/status');
    const data = JSON.parse(res.body);

    expect(data.node).toBeDefined();
    expect(data.node.name).toBe('TestAgent');
    expect(data.node.id).toBe('agent-1');
    expect(data.node.account).toBe('0.0.100');
    expect(data.agents).toBe(2);
    expect(data.tasks).toBe(1);
  });

  it('should return agents list', async () => {
    const res = await fetch(baseUrl + '/api/agents');
    const data = JSON.parse(res.body);

    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('TestAgent');
    expect(data[0].capabilities).toEqual(['research']);
    expect(data[1].name).toBe('Agent2');
  });

  it('should return tasks with bid/assignment counts', async () => {
    const res = await fetch(baseUrl + '/api/tasks');
    const data = JSON.parse(res.body);

    expect(data).toHaveLength(1);
    expect(data[0].description).toBe('Research AI trends');
    expect(data[0].priority).toBe('high');
    expect(data[0].bids).toBe(1);
    expect(data[0].assignments).toBe(0);
  });
});
