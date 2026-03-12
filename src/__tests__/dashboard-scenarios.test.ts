/**
 * Dashboard - Comprehensive API endpoint and server lifecycle tests
 */

import { Dashboard, DashboardOptions } from '../dashboard/server';
import { MeshNode } from '../core/mesh-node';
import { HederaClient } from '../core/hedera-client';
import { AgentRegistry } from '../core/agent-registry';
import { TaskCoordinator } from '../core/task-coordinator';
import { AgentProfile, MeshConfig } from '../core/types';
import * as http from 'http';

jest.mock('../core/hedera-client');

const TEST_CONFIG: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.1',
  operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
};

function createMockRegistry(): AgentRegistry {
  const client = new HederaClient(TEST_CONFIG) as jest.Mocked<HederaClient>;
  client.createTopic = jest.fn().mockResolvedValue('0.0.100');
  client.submitMessage = jest.fn().mockResolvedValue(1);
  client.subscribeTopic = jest.fn();
  client.emit = jest.fn().mockReturnValue(true);
  return new AgentRegistry(client);
}

function createMockCoordinator(registry: AgentRegistry): TaskCoordinator {
  const client = new HederaClient(TEST_CONFIG) as jest.Mocked<HederaClient>;
  client.createTopic = jest.fn().mockResolvedValue('0.0.200');
  client.submitMessage = jest.fn().mockResolvedValue(1);
  client.subscribeTopic = jest.fn();
  client.emit = jest.fn().mockReturnValue(true);
  return new TaskCoordinator(client, registry);
}

describe('Dashboard - Comprehensive', () => {
  describe('Constructor Options', () => {
    it('should use default port 3456', () => {
      const dashboard = new Dashboard();
      expect(dashboard.getPort()).toBe(3456);
    });

    it('should accept custom port', () => {
      const dashboard = new Dashboard({ port: 8080 });
      expect(dashboard.getPort()).toBe(8080);
    });

    it('should accept custom host', () => {
      const dashboard = new Dashboard({ host: '0.0.0.0' });
      expect(dashboard).toBeDefined();
    });

    it('should accept null meshNode', () => {
      const dashboard = new Dashboard({ meshNode: undefined });
      expect(dashboard).toBeDefined();
    });

    it('should accept registry directly', () => {
      const registry = createMockRegistry();
      const dashboard = new Dashboard({ registry });
      expect(dashboard).toBeDefined();
    });

    it('should accept coordinator directly', () => {
      const registry = createMockRegistry();
      const coordinator = createMockCoordinator(registry);
      const dashboard = new Dashboard({ coordinator });
      expect(dashboard).toBeDefined();
    });

    it('should create with empty options', () => {
      const dashboard = new Dashboard({});
      expect(dashboard).toBeDefined();
    });
  });

  describe('Server Lifecycle', () => {
    it('should start and return URL', async () => {
      const port = 17000 + Math.floor(Math.random() * 1000);
      const dashboard = new Dashboard({ port });
      try {
        const url = await dashboard.start();
        expect(url).toBe(`http://localhost:${port}`);
      } finally {
        await dashboard.stop();
      }
    });

    it('should stop gracefully', async () => {
      const port = 17000 + Math.floor(Math.random() * 1000);
      const dashboard = new Dashboard({ port });
      await dashboard.start();
      await dashboard.stop();
    });

    it('should handle stop when not started', async () => {
      const dashboard = new Dashboard({ port: 17999 });
      await dashboard.stop();
    });

    it('should handle double stop', async () => {
      const port = 17000 + Math.floor(Math.random() * 1000);
      const dashboard = new Dashboard({ port });
      await dashboard.start();
      await dashboard.stop();
      await dashboard.stop();
    });
  });

  describe('API Endpoint Logic', () => {
    // Test the dashboard using a single server instance with sequential requests
    let dashboard: Dashboard;
    let registry: AgentRegistry;
    let coordinator: TaskCoordinator;
    let testPort: number;

    beforeAll(async () => {
      testPort = 16000 + Math.floor(Math.random() * 500);
      registry = createMockRegistry();
      coordinator = createMockCoordinator(registry);
      await registry.initialize('0.0.100');
      await coordinator.initialize('0.0.200');
      dashboard = new Dashboard({
        port: testPort,
        registry,
        coordinator,
      });
      await dashboard.start();
    });

    afterAll(async () => {
      await dashboard.stop();
    });

    function makeRequest(path: string): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
      return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${testPort}${path}`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({
            statusCode: res.statusCode || 0,
            body: data,
            headers: res.headers,
          }));
        });
        req.on('error', reject);
        req.setTimeout(5000, () => {
          req.destroy();
          reject(new Error('Request timed out'));
        });
      });
    }

    it('should respond to /api/status with 200', async () => {
      const res = await makeRequest('/api/status');
      expect(res.statusCode).toBe(200);
    });

    it('should return agents and tasks in status', async () => {
      const res = await makeRequest('/api/status');
      const data = JSON.parse(res.body);
      expect(data).toHaveProperty('agents');
      expect(data).toHaveProperty('tasks');
      expect(data).toHaveProperty('uptime');
    });

    it('should return node as null when no meshNode', async () => {
      const res = await makeRequest('/api/status');
      const data = JSON.parse(res.body);
      expect(data.node).toBeNull();
    });

    it('should respond to /api/agents with 200', async () => {
      const res = await makeRequest('/api/agents');
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(Array.isArray(data)).toBe(true);
    });

    it('should return registered agents via API', async () => {
      const profile: AgentProfile = {
        id: 'api-test-agent',
        name: 'APITestAgent',
        description: 'Agent for API test',
        capabilities: [
          { name: 'api_cap', description: 'API Cap', inputSchema: {}, outputSchema: {} },
        ],
        hederaAccountId: '0.0.555',
        inboundTopicId: '0.0.200',
        outboundTopicId: '0.0.201',
        registryTopicId: '0.0.100',
        status: 'active',
        createdAt: Date.now(),
        metadata: {},
      };
      await registry.registerAgent(profile);

      const res = await makeRequest('/api/agents');
      const data = JSON.parse(res.body);
      const found = data.find((a: any) => a.name === 'APITestAgent');
      expect(found).toBeDefined();
      expect(found.capabilities).toContain('api_cap');
    });

    it('should respond to /api/tasks with 200', async () => {
      const res = await makeRequest('/api/tasks');
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(Array.isArray(data)).toBe(true);
    });

    it('should return submitted tasks via API', async () => {
      await coordinator.submitTask({
        description: 'API test task',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'high',
        requesterId: 'requester-1',
      });

      const res = await makeRequest('/api/tasks');
      const data = JSON.parse(res.body);
      const found = data.find((t: any) => t.description === 'API test task');
      expect(found).toBeDefined();
      expect(found.priority).toBe('high');
    });

    it('should serve dashboard HTML on root path', async () => {
      const res = await makeRequest('/');
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('AgentMesh');
      expect(res.body).toContain('<!DOCTYPE html>');
    });

    it('should serve dashboard for unknown paths', async () => {
      const res = await makeRequest('/some/unknown/path');
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('AgentMesh');
    });

    it('should include CORS headers on API routes', async () => {
      const res = await makeRequest('/api/status');
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('should set content type to JSON for API routes', async () => {
      const res = await makeRequest('/api/status');
      expect(res.headers['content-type']).toBe('application/json');
    });

    it('should set content type to JSON for agents API', async () => {
      const res = await makeRequest('/api/agents');
      expect(res.headers['content-type']).toBe('application/json');
    });

    it('should set content type to HTML for dashboard', async () => {
      const res = await makeRequest('/');
      expect(res.headers['content-type']).toBe('text/html');
    });

    it('should show uptime as positive number', async () => {
      const res = await makeRequest('/api/status');
      const data = JSON.parse(res.body);
      expect(typeof data.uptime).toBe('number');
      expect(data.uptime).toBeGreaterThan(0);
    });
  });

  describe('Dashboard Without Components', () => {
    it('should return 0 agents when no registry', async () => {
      const port = 15000 + Math.floor(Math.random() * 500);
      const dashboard = new Dashboard({ port });
      await dashboard.start();
      try {
        const res = await new Promise<any>((resolve, reject) => {
          http.get(`http://localhost:${port}/api/status`, (r) => {
            let data = '';
            r.on('data', chunk => data += chunk);
            r.on('end', () => resolve(JSON.parse(data)));
          }).on('error', reject);
        });
        expect(res.agents).toBe(0);
      } finally {
        await dashboard.stop();
      }
    });

    it('should return 0 tasks when no coordinator', async () => {
      const port = 15000 + Math.floor(Math.random() * 500);
      const dashboard = new Dashboard({ port });
      await dashboard.start();
      try {
        const res = await new Promise<any>((resolve, reject) => {
          http.get(`http://localhost:${port}/api/status`, (r) => {
            let data = '';
            r.on('data', chunk => data += chunk);
            r.on('end', () => resolve(JSON.parse(data)));
          }).on('error', reject);
        });
        expect(res.tasks).toBe(0);
      } finally {
        await dashboard.stop();
      }
    });

    it('should return empty agents list when no registry', async () => {
      const port = 15000 + Math.floor(Math.random() * 500);
      const dashboard = new Dashboard({ port });
      await dashboard.start();
      try {
        const res = await new Promise<any>((resolve, reject) => {
          http.get(`http://localhost:${port}/api/agents`, (r) => {
            let data = '';
            r.on('data', chunk => data += chunk);
            r.on('end', () => resolve(JSON.parse(data)));
          }).on('error', reject);
        });
        expect(res).toEqual([]);
      } finally {
        await dashboard.stop();
      }
    });

    it('should return empty tasks list when no coordinator', async () => {
      const port = 15000 + Math.floor(Math.random() * 500);
      const dashboard = new Dashboard({ port });
      await dashboard.start();
      try {
        const res = await new Promise<any>((resolve, reject) => {
          http.get(`http://localhost:${port}/api/tasks`, (r) => {
            let data = '';
            r.on('data', chunk => data += chunk);
            r.on('end', () => resolve(JSON.parse(data)));
          }).on('error', reject);
        });
        expect(res).toEqual([]);
      } finally {
        await dashboard.stop();
      }
    });
  });
});
