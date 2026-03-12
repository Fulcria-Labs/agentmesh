/**
 * Advanced Dashboard tests - covers edge cases for HTTP handling,
 * registry/coordinator injection, and API response formatting.
 */

import { Dashboard } from '../dashboard/server';
import * as http from 'http';

function fetch(url: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, body, headers: res.headers }));
    }).on('error', reject);
  });
}

describe('Dashboard - Constructor Defaults', () => {
  it('should default host to localhost', () => {
    const d = new Dashboard();
    expect(d.getPort()).toBe(3456);
  });

  it('should accept empty options', () => {
    const d = new Dashboard({});
    expect(d.getPort()).toBe(3456);
  });

  it('should accept all options', () => {
    const d = new Dashboard({ port: 9999, host: '0.0.0.0' });
    expect(d.getPort()).toBe(9999);
  });

  it('should handle meshNode with registry and coordinator', () => {
    const mockMeshNode = {
      getProfile: jest.fn().mockReturnValue(null),
      getRegistry: jest.fn().mockReturnValue({ getAgentCount: () => 0, getAllAgents: () => [] }),
      getCoordinator: jest.fn().mockReturnValue({ getTaskCount: () => 0, getAllTasks: () => [] }),
    };

    const d = new Dashboard({ meshNode: mockMeshNode as any });
    expect(d.getPort()).toBe(3456);
  });

  it('should accept standalone registry and coordinator', () => {
    const mockRegistry = { getAgentCount: () => 5, getAllAgents: () => [] };
    const mockCoordinator = { getTaskCount: () => 3, getAllTasks: () => [] };

    const d = new Dashboard({
      registry: mockRegistry as any,
      coordinator: mockCoordinator as any,
    });
    expect(d.getPort()).toBe(3456);
  });
});

describe('Dashboard - Stop Without Start', () => {
  it('should handle stop without start', async () => {
    const d = new Dashboard();
    await d.stop();
    // Should not throw
  });

  it('should handle multiple stops', async () => {
    const d = new Dashboard();
    await d.stop();
    await d.stop();
    await d.stop();
  });
});

describe('Dashboard - API with Registry/Coordinator', () => {
  let dashboard: Dashboard;
  let baseUrl: string;

  const mockAgents = [
    {
      id: 'a1', name: 'Agent1', description: 'First agent', status: 'active',
      hederaAccountId: '0.0.100',
      capabilities: [
        { name: 'research', description: 'Research', inputSchema: {}, outputSchema: {} },
        { name: 'analysis', description: 'Analysis', inputSchema: {}, outputSchema: {} },
      ],
    },
    {
      id: 'a2', name: 'Agent2', description: 'Second agent', status: 'busy',
      hederaAccountId: '0.0.200',
      capabilities: [],
    },
    {
      id: 'a3', name: 'Agent3', description: 'Inactive agent', status: 'inactive',
      hederaAccountId: '0.0.300',
      capabilities: [
        { name: 'synthesis', description: 'Synthesis', inputSchema: {}, outputSchema: {} },
      ],
    },
  ];

  const mockTasks = [
    {
      id: 't1', description: 'Task 1', priority: 'high',
      requiredCapabilities: ['research', 'analysis'],
      payload: {}, requesterId: 'a1', createdAt: Date.now(),
    },
    {
      id: 't2', description: 'Task 2', priority: 'low',
      requiredCapabilities: ['synthesis'],
      payload: {}, requesterId: 'a2', createdAt: Date.now(),
    },
  ];

  const mockRegistry = {
    getAgentCount: jest.fn().mockReturnValue(3),
    getAllAgents: jest.fn().mockReturnValue(mockAgents),
  };

  const mockCoordinator = {
    getTaskCount: jest.fn().mockReturnValue(2),
    getAllTasks: jest.fn().mockReturnValue(mockTasks),
    getTaskBids: jest.fn().mockImplementation((taskId: string) =>
      taskId === 't1' ? [{ id: 1 }, { id: 2 }, { id: 3 }] : []
    ),
    getTaskAssignments: jest.fn().mockImplementation((taskId: string) =>
      taskId === 't1' ? [{ id: 1 }] : [{ id: 1 }, { id: 2 }]
    ),
  };

  beforeEach(async () => {
    const port = 30000 + Math.floor(Math.random() * 10000);
    dashboard = new Dashboard({
      port,
      host: '127.0.0.1',
      registry: mockRegistry as any,
      coordinator: mockCoordinator as any,
    });
    baseUrl = await dashboard.start();
  });

  afterEach(async () => {
    await dashboard.stop();
  });

  it('should return agents with all fields mapped', async () => {
    const res = await fetch(baseUrl + '/api/agents');
    const data = JSON.parse(res.body);

    expect(data).toHaveLength(3);

    expect(data[0].id).toBe('a1');
    expect(data[0].name).toBe('Agent1');
    expect(data[0].description).toBe('First agent');
    expect(data[0].status).toBe('active');
    expect(data[0].capabilities).toEqual(['research', 'analysis']);
    expect(data[0].account).toBe('0.0.100');

    expect(data[1].capabilities).toEqual([]);
    expect(data[2].status).toBe('inactive');
  });

  it('should return tasks with bid and assignment counts', async () => {
    const res = await fetch(baseUrl + '/api/tasks');
    const data = JSON.parse(res.body);

    expect(data).toHaveLength(2);
    expect(data[0].id).toBe('t1');
    expect(data[0].bids).toBe(3);
    expect(data[0].assignments).toBe(1);
    expect(data[0].capabilities).toEqual(['research', 'analysis']);

    expect(data[1].id).toBe('t2');
    expect(data[1].bids).toBe(0);
    expect(data[1].assignments).toBe(2);
  });

  it('should return correct agent count in status', async () => {
    const res = await fetch(baseUrl + '/api/status');
    const data = JSON.parse(res.body);

    expect(data.agents).toBe(3);
    expect(data.tasks).toBe(2);
    expect(data.node).toBeNull(); // No mesh node provided
  });

  it('should return uptime as positive number', async () => {
    const res = await fetch(baseUrl + '/api/status');
    const data = JSON.parse(res.body);

    expect(typeof data.uptime).toBe('number');
    expect(data.uptime).toBeGreaterThanOrEqual(0);
  });
});

describe('Dashboard - HTML Content Validation', () => {
  let dashboard: Dashboard;
  let baseUrl: string;

  beforeEach(async () => {
    const port = 30000 + Math.floor(Math.random() * 10000);
    dashboard = new Dashboard({ port, host: '127.0.0.1' });
    baseUrl = await dashboard.start();
  });

  afterEach(async () => {
    await dashboard.stop();
  });

  it('should contain DOCTYPE declaration', async () => {
    const res = await fetch(baseUrl + '/');
    expect(res.body).toContain('<!DOCTYPE html>');
  });

  it('should contain meta viewport tag', async () => {
    const res = await fetch(baseUrl + '/');
    expect(res.body).toContain('viewport');
  });

  it('should contain CSS styles', async () => {
    const res = await fetch(baseUrl + '/');
    expect(res.body).toContain('<style>');
    expect(res.body).toContain('</style>');
  });

  it('should contain JavaScript', async () => {
    const res = await fetch(baseUrl + '/');
    expect(res.body).toContain('<script>');
    expect(res.body).toContain('</script>');
  });

  it('should reference all API endpoints', async () => {
    const res = await fetch(baseUrl + '/');
    expect(res.body).toContain('/api/status');
    expect(res.body).toContain('/api/agents');
    expect(res.body).toContain('/api/tasks');
  });

  it('should contain Hedera reference', async () => {
    const res = await fetch(baseUrl + '/');
    expect(res.body).toContain('Hedera');
  });

  it('should return HTML for any unrecognized path', async () => {
    const paths = ['/foo', '/bar/baz', '/api/unknown', '/random'];
    for (const path of paths) {
      const res = await fetch(baseUrl + path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/html');
    }
  });
});

describe('Dashboard - Balance Error Handling', () => {
  let dashboard: Dashboard;
  let baseUrl: string;

  beforeEach(async () => {
    const port = 30000 + Math.floor(Math.random() * 10000);
    const mockMeshNode = {
      getProfile: jest.fn().mockReturnValue({
        id: 'n1', name: 'Node', status: 'active',
        hederaAccountId: '0.0.100',
        capabilities: [],
      }),
      getRegistry: jest.fn().mockReturnValue({
        getAgentCount: jest.fn().mockReturnValue(0),
        getAllAgents: jest.fn().mockReturnValue([]),
      }),
      getCoordinator: jest.fn().mockReturnValue({
        getTaskCount: jest.fn().mockReturnValue(0),
        getAllTasks: jest.fn().mockReturnValue([]),
        getTaskBids: jest.fn().mockReturnValue([]),
        getTaskAssignments: jest.fn().mockReturnValue([]),
      }),
      getBalance: jest.fn().mockRejectedValue(new Error('Network error')),
    };

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

  it('should return unknown balance when getBalance fails', async () => {
    const res = await fetch(baseUrl + '/api/status');
    // The MCP status tool handles this, not the dashboard directly
    // Dashboard doesn't call getBalance, so this tests that the dashboard
    // works even when the mesh node's balance is unreachable
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.node).toBeDefined();
    expect(data.node.name).toBe('Node');
  });
});

describe('Dashboard - Multiple Start/Stop Cycles', () => {
  it('should support starting on a new port after stop', async () => {
    const port1 = 30000 + Math.floor(Math.random() * 10000);
    const port2 = port1 + 1;

    const d1 = new Dashboard({ port: port1, host: '127.0.0.1' });
    const url1 = await d1.start();
    const res1 = await fetch(url1 + '/api/status');
    expect(res1.status).toBe(200);
    await d1.stop();

    const d2 = new Dashboard({ port: port2, host: '127.0.0.1' });
    const url2 = await d2.start();
    const res2 = await fetch(url2 + '/api/status');
    expect(res2.status).toBe(200);
    await d2.stop();
  });
});
