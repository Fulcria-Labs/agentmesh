/**
 * Dashboard - Deep coverage tests
 *
 * Covers: constructor options, API response formats, component injection,
 * concurrent requests, port handling, and error scenarios.
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

describe('Dashboard - Constructor Options', () => {
  it('should use default port 3456', () => {
    const d = new Dashboard();
    expect(d.getPort()).toBe(3456);
  });

  it('should accept custom port', () => {
    const d = new Dashboard({ port: 9999 });
    expect(d.getPort()).toBe(9999);
  });

  it('should accept low port numbers', () => {
    const d = new Dashboard({ port: 1234 });
    expect(d.getPort()).toBe(1234);
  });

  it('should accept custom host', async () => {
    const port = 30000 + Math.floor(Math.random() * 10000);
    const d = new Dashboard({ port, host: '127.0.0.1' });
    const url = await d.start();
    expect(url).toContain('127.0.0.1');
    await d.stop();
  });

  it('should accept registry without meshNode', async () => {
    const mockRegistry = {
      getAgentCount: jest.fn().mockReturnValue(3),
      getAllAgents: jest.fn().mockReturnValue([]),
    };

    const port = 30000 + Math.floor(Math.random() * 10000);
    const d = new Dashboard({ port, host: '127.0.0.1', registry: mockRegistry as any });
    const url = await d.start();

    const res = await fetch(url + '/api/status');
    const data = JSON.parse(res.body);
    expect(data.agents).toBe(3);

    await d.stop();
  });

  it('should accept coordinator without meshNode', async () => {
    const mockCoordinator = {
      getTaskCount: jest.fn().mockReturnValue(7),
      getAllTasks: jest.fn().mockReturnValue([]),
      getTaskBids: jest.fn().mockReturnValue([]),
      getTaskAssignments: jest.fn().mockReturnValue([]),
    };

    const port = 30000 + Math.floor(Math.random() * 10000);
    const d = new Dashboard({ port, host: '127.0.0.1', coordinator: mockCoordinator as any });
    const url = await d.start();

    const res = await fetch(url + '/api/status');
    const data = JSON.parse(res.body);
    expect(data.tasks).toBe(7);

    await d.stop();
  });

  it('should derive registry and coordinator from meshNode', async () => {
    const mockMeshNode = {
      getProfile: jest.fn().mockReturnValue(null),
      getRegistry: jest.fn().mockReturnValue({
        getAgentCount: jest.fn().mockReturnValue(2),
        getAllAgents: jest.fn().mockReturnValue([]),
      }),
      getCoordinator: jest.fn().mockReturnValue({
        getTaskCount: jest.fn().mockReturnValue(1),
        getAllTasks: jest.fn().mockReturnValue([]),
        getTaskBids: jest.fn().mockReturnValue([]),
        getTaskAssignments: jest.fn().mockReturnValue([]),
      }),
    };

    const port = 30000 + Math.floor(Math.random() * 10000);
    const d = new Dashboard({ port, host: '127.0.0.1', meshNode: mockMeshNode as any });
    const url = await d.start();

    const res = await fetch(url + '/api/status');
    const data = JSON.parse(res.body);
    expect(data.agents).toBe(2);
    expect(data.tasks).toBe(1);

    await d.stop();
  });
});

describe('Dashboard - API Responses', () => {
  let dashboard: Dashboard;
  let baseUrl: string;

  const mockProfile = {
    id: 'test-node',
    name: 'TestNode',
    description: 'A test node',
    status: 'active',
    hederaAccountId: '0.0.555',
    capabilities: [
      { name: 'cap1', description: 'Cap 1', inputSchema: {}, outputSchema: {} },
      { name: 'cap2', description: 'Cap 2', inputSchema: {}, outputSchema: {} },
    ],
    inboundTopicId: '0.0.100',
    outboundTopicId: '0.0.101',
    registryTopicId: '0.0.102',
    createdAt: Date.now(),
    metadata: {},
  };

  const mockAgents = [
    { ...mockProfile, id: 'a1', name: 'Agent1', hederaAccountId: '0.0.100', description: 'First agent' },
    { ...mockProfile, id: 'a2', name: 'Agent2', hederaAccountId: '0.0.200', description: 'Second agent', status: 'busy' },
    { ...mockProfile, id: 'a3', name: 'Agent3', hederaAccountId: '0.0.300', description: 'Third agent', status: 'inactive' },
  ];

  const mockTasks = [
    { id: 't1', description: 'Task 1', requiredCapabilities: ['cap1'], payload: {}, priority: 'low' as const, requesterId: 'a1', createdAt: Date.now() },
    { id: 't2', description: 'Task 2', requiredCapabilities: ['cap1', 'cap2'], payload: {}, priority: 'high' as const, requesterId: 'a2', createdAt: Date.now() },
    { id: 't3', description: 'Task 3', requiredCapabilities: ['cap2'], payload: {}, priority: 'critical' as const, requesterId: 'a1', createdAt: Date.now() },
  ];

  beforeEach(async () => {
    const port = 30000 + Math.floor(Math.random() * 10000);
    dashboard = new Dashboard({
      port,
      host: '127.0.0.1',
      meshNode: {
        getProfile: jest.fn().mockReturnValue(mockProfile),
        getRegistry: jest.fn().mockReturnValue({
          getAgentCount: jest.fn().mockReturnValue(mockAgents.length),
          getAllAgents: jest.fn().mockReturnValue(mockAgents),
        }),
        getCoordinator: jest.fn().mockReturnValue({
          getTaskCount: jest.fn().mockReturnValue(mockTasks.length),
          getAllTasks: jest.fn().mockReturnValue(mockTasks),
          getTaskBids: jest.fn().mockImplementation((taskId: string) => {
            if (taskId === 't1') return [{ taskId: 't1' }, { taskId: 't1' }];
            return [];
          }),
          getTaskAssignments: jest.fn().mockImplementation((taskId: string) => {
            if (taskId === 't1') return [{ taskId: 't1' }];
            return [];
          }),
        }),
      } as any,
    });
    baseUrl = await dashboard.start();
  });

  afterEach(async () => {
    await dashboard.stop();
  });

  it('should return node capabilities in status', async () => {
    const res = await fetch(baseUrl + '/api/status');
    const data = JSON.parse(res.body);
    expect(data.node.capabilities).toEqual(['cap1', 'cap2']);
  });

  it('should return correct agent count in status', async () => {
    const res = await fetch(baseUrl + '/api/status');
    const data = JSON.parse(res.body);
    expect(data.agents).toBe(3);
  });

  it('should return correct task count in status', async () => {
    const res = await fetch(baseUrl + '/api/status');
    const data = JSON.parse(res.body);
    expect(data.tasks).toBe(3);
  });

  it('should return uptime as positive number', async () => {
    const res = await fetch(baseUrl + '/api/status');
    const data = JSON.parse(res.body);
    expect(data.uptime).toBeGreaterThan(0);
  });

  it('should return all agents with correct fields', async () => {
    const res = await fetch(baseUrl + '/api/agents');
    const data = JSON.parse(res.body);
    expect(data).toHaveLength(3);

    for (const agent of data) {
      expect(agent.id).toBeDefined();
      expect(agent.name).toBeDefined();
      expect(agent.description).toBeDefined();
      expect(agent.status).toBeDefined();
      expect(agent.capabilities).toBeInstanceOf(Array);
      expect(agent.account).toBeDefined();
    }
  });

  it('should return agent status values', async () => {
    const res = await fetch(baseUrl + '/api/agents');
    const data = JSON.parse(res.body);
    const statuses = data.map((a: any) => a.status);
    expect(statuses).toContain('active');
    expect(statuses).toContain('busy');
    expect(statuses).toContain('inactive');
  });

  it('should return tasks with bid and assignment counts', async () => {
    const res = await fetch(baseUrl + '/api/tasks');
    const data = JSON.parse(res.body);
    expect(data).toHaveLength(3);

    const t1 = data.find((t: any) => t.id === 't1');
    expect(t1.bids).toBe(2);
    expect(t1.assignments).toBe(1);

    const t2 = data.find((t: any) => t.id === 't2');
    expect(t2.bids).toBe(0);
    expect(t2.assignments).toBe(0);
  });

  it('should return task priorities', async () => {
    const res = await fetch(baseUrl + '/api/tasks');
    const data = JSON.parse(res.body);
    const priorities = data.map((t: any) => t.priority);
    expect(priorities).toContain('low');
    expect(priorities).toContain('high');
    expect(priorities).toContain('critical');
  });

  it('should return task required capabilities', async () => {
    const res = await fetch(baseUrl + '/api/tasks');
    const data = JSON.parse(res.body);
    const t2 = data.find((t: any) => t.id === 't2');
    expect(t2.capabilities).toEqual(['cap1', 'cap2']);
  });
});

describe('Dashboard - HTML Content', () => {
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

  it('should contain proper HTML structure', async () => {
    const res = await fetch(baseUrl);
    expect(res.body).toContain('<!DOCTYPE html>');
    expect(res.body).toContain('<html');
    expect(res.body).toContain('</html>');
    expect(res.body).toContain('<head>');
    expect(res.body).toContain('</head>');
    expect(res.body).toContain('<body>');
    expect(res.body).toContain('</body>');
  });

  it('should contain CSS styles', async () => {
    const res = await fetch(baseUrl);
    expect(res.body).toContain('<style>');
    expect(res.body).toContain('</style>');
  });

  it('should contain JavaScript refresh logic', async () => {
    const res = await fetch(baseUrl);
    expect(res.body).toContain('<script>');
    expect(res.body).toContain('</script>');
    expect(res.body).toContain('setInterval');
  });

  it('should reference all API endpoints', async () => {
    const res = await fetch(baseUrl);
    expect(res.body).toContain('/api/status');
    expect(res.body).toContain('/api/agents');
    expect(res.body).toContain('/api/tasks');
  });

  it('should contain status badges', async () => {
    const res = await fetch(baseUrl);
    expect(res.body).toContain('badge-active');
    expect(res.body).toContain('badge-busy');
    expect(res.body).toContain('badge-inactive');
  });

  it('should contain priority badges', async () => {
    const res = await fetch(baseUrl);
    expect(res.body).toContain('badge-high');
    expect(res.body).toContain('badge-medium');
    expect(res.body).toContain('badge-low');
    expect(res.body).toContain('badge-critical');
  });

  it('should serve same HTML for any unknown path', async () => {
    const paths = ['/unknown', '/foo/bar', '/api/unknown', '/dashboard/view'];
    for (const path of paths) {
      const res = await fetch(baseUrl + path);
      expect(res.status).toBe(200);
      expect(res.body).toContain('AgentMesh');
    }
  });
});

describe('Dashboard - Concurrent Requests', () => {
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

  it('should handle multiple simultaneous requests', async () => {
    const promises = [
      fetch(baseUrl + '/'),
      fetch(baseUrl + '/api/status'),
      fetch(baseUrl + '/api/agents'),
      fetch(baseUrl + '/api/tasks'),
      fetch(baseUrl + '/api/status'),
    ];

    const results = await Promise.all(promises);
    for (const res of results) {
      expect(res.status).toBe(200);
    }
  });

  it('should handle rapid sequential requests', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await fetch(baseUrl + '/api/status');
      expect(res.status).toBe(200);
    }
  });
});

describe('Dashboard - Stop Behavior', () => {
  it('should stop cleanly with no server', async () => {
    const d = new Dashboard();
    // stop without start should not throw
    await d.stop();
  });

  it('should handle double stop', async () => {
    const port = 30000 + Math.floor(Math.random() * 10000);
    const d = new Dashboard({ port, host: '127.0.0.1' });
    await d.start();
    await d.stop();
    await d.stop(); // Should not throw
  });
});

describe('Dashboard - CORS Headers', () => {
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

  it('should include CORS header on /api/status', async () => {
    const res = await fetch(baseUrl + '/api/status');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('should include CORS header on /api/agents', async () => {
    const res = await fetch(baseUrl + '/api/agents');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('should include CORS header on /api/tasks', async () => {
    const res = await fetch(baseUrl + '/api/tasks');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
