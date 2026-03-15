import {
  ServiceMesh,
  ServiceMeshConfig,
  RoutingStrategy,
  LoadMetrics,
} from '../core/service-mesh';
import { AgentProfile, TaskRequest } from '../core/types';

function makeAgent(id: string, capabilities: string[], status: 'active' | 'inactive' = 'active'): AgentProfile {
  return {
    id,
    name: `Agent-${id}`,
    description: `Test agent ${id}`,
    capabilities: capabilities.map(name => ({
      name,
      description: `${name} capability`,
      inputSchema: {},
      outputSchema: {},
    })),
    hederaAccountId: `0.0.${id}`,
    inboundTopicId: `0.0.${id}00`,
    outboundTopicId: `0.0.${id}01`,
    registryTopicId: '0.0.1000',
    status,
    createdAt: Date.now(),
    metadata: {},
  };
}

function makeTask(id: string, capabilities: string[], priority: 'low' | 'medium' | 'high' | 'critical' = 'medium'): TaskRequest {
  return {
    id,
    description: `Task ${id}`,
    requiredCapabilities: capabilities,
    payload: {},
    priority,
    requesterId: 'requester-1',
    createdAt: Date.now(),
  };
}

describe('ServiceMesh', () => {
  let mesh: ServiceMesh;

  beforeEach(() => {
    mesh = new ServiceMesh();
  });

  describe('constructor', () => {
    it('creates with default config', () => {
      expect(mesh).toBeDefined();
    });

    it('accepts partial config override', () => {
      const custom = new ServiceMesh({ maxRoutesPerDecision: 10 });
      expect(custom).toBeDefined();
    });

    it('throws if weights do not sum to 1', () => {
      expect(() => new ServiceMesh({
        reputationWeight: 0.5,
        availabilityWeight: 0.5,
        costWeight: 0.5,
        latencyWeight: 0.5,
      })).toThrow('weights must sum to 1.0');
    });

    it('accepts weights that sum exactly to 1', () => {
      const m = new ServiceMesh({
        reputationWeight: 0.25,
        availabilityWeight: 0.25,
        costWeight: 0.25,
        latencyWeight: 0.25,
      });
      expect(m).toBeDefined();
    });

    it('tolerates small floating point errors in weight sum', () => {
      // 0.1 + 0.2 + 0.3 + 0.4 = 0.9999999999999999 in JS
      const m = new ServiceMesh({
        reputationWeight: 0.1,
        availabilityWeight: 0.2,
        costWeight: 0.3,
        latencyWeight: 0.4,
      });
      expect(m).toBeDefined();
    });
  });

  describe('registerAgent', () => {
    it('registers an agent', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      const topology = mesh.getMeshTopology();
      expect(topology.totalAgents).toBe(1);
    });

    it('throws for agent without ID', () => {
      const agent = makeAgent('1', ['research']);
      agent.id = '';
      expect(() => mesh.registerAgent(agent)).toThrow('Agent ID is required');
    });

    it('throws for agent without capabilities', () => {
      const agent = makeAgent('1', ['research']);
      agent.capabilities = [];
      expect(() => mesh.registerAgent(agent)).toThrow('at least one capability');
    });

    it('registers multiple agents', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.registerAgent(makeAgent('2', ['analysis']));
      mesh.registerAgent(makeAgent('3', ['coding']));
      expect(mesh.getMeshTopology().totalAgents).toBe(3);
    });

    it('overwrites existing agent on re-register', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.registerAgent(makeAgent('1', ['research', 'analysis']));
      expect(mesh.getMeshTopology().totalAgents).toBe(1);
    });

    it('initializes load metrics for new agents', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      const metrics = mesh.getAllLoadMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].activeTasks).toBe(0);
    });

    it('preserves existing load metrics on re-register', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.updateLoadMetrics('1', { activeTasks: 3 });
      mesh.registerAgent(makeAgent('1', ['research']));
      const metrics = mesh.getAllLoadMetrics();
      expect(metrics[0].activeTasks).toBe(3);
    });
  });

  describe('deregisterAgent', () => {
    it('removes a registered agent', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      expect(mesh.deregisterAgent('1')).toBe(true);
      expect(mesh.getMeshTopology().totalAgents).toBe(0);
    });

    it('returns false for unknown agent', () => {
      expect(mesh.deregisterAgent('nonexistent')).toBe(false);
    });

    it('cleans up load metrics', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.deregisterAgent('1');
      expect(mesh.getAllLoadMetrics().length).toBe(0);
    });
  });

  describe('updateLoadMetrics', () => {
    beforeEach(() => {
      mesh.registerAgent(makeAgent('1', ['research']));
    });

    it('updates active tasks', () => {
      mesh.updateLoadMetrics('1', { activeTasks: 3 });
      expect(mesh.getAllLoadMetrics()[0].activeTasks).toBe(3);
    });

    it('updates response time', () => {
      mesh.updateLoadMetrics('1', { avgResponseTime: 500 });
      expect(mesh.getAllLoadMetrics()[0].avgResponseTime).toBe(500);
    });

    it('updates success rate', () => {
      mesh.updateLoadMetrics('1', { successRate: 0.95 });
      expect(mesh.getAllLoadMetrics()[0].successRate).toBe(0.95);
    });

    it('updates heartbeat', () => {
      const ts = Date.now();
      mesh.updateLoadMetrics('1', { lastHeartbeat: ts });
      expect(mesh.getAllLoadMetrics()[0].lastHeartbeat).toBe(ts);
    });

    it('throws for unknown agent', () => {
      expect(() => mesh.updateLoadMetrics('unknown', { activeTasks: 1 })).toThrow('Unknown agent');
    });

    it('preserves unmodified fields', () => {
      mesh.updateLoadMetrics('1', { activeTasks: 5 });
      mesh.updateLoadMetrics('1', { successRate: 0.8 });
      const m = mesh.getAllLoadMetrics()[0];
      expect(m.activeTasks).toBe(5);
      expect(m.successRate).toBe(0.8);
    });
  });

  describe('updateReputation', () => {
    it('sets reputation score', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.updateReputation('1', 0.9);
      // Verify through routing - higher reputation should give higher score
      expect(() => mesh.updateReputation('1', 0.9)).not.toThrow();
    });

    it('throws for out of range reputation', () => {
      expect(() => mesh.updateReputation('1', 1.5)).toThrow('between 0 and 1');
      expect(() => mesh.updateReputation('1', -0.1)).toThrow('between 0 and 1');
    });

    it('accepts boundary values', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      expect(() => mesh.updateReputation('1', 0)).not.toThrow();
      expect(() => mesh.updateReputation('1', 1)).not.toThrow();
    });
  });

  describe('routeTask', () => {
    beforeEach(() => {
      mesh.registerAgent(makeAgent('1', ['research', 'analysis']));
      mesh.registerAgent(makeAgent('2', ['research']));
      mesh.registerAgent(makeAgent('3', ['coding']));
    });

    it('routes to agent with matching capability', () => {
      const decision = mesh.routeTask(makeTask('t1', ['coding']));
      expect(decision.selectedRoute).not.toBeNull();
      expect(decision.selectedRoute!.agentId).toBe('3');
    });

    it('returns empty when no agents match', () => {
      const decision = mesh.routeTask(makeTask('t1', ['quantum-computing']));
      expect(decision.selectedRoute).toBeNull();
      expect(decision.routes.length).toBe(0);
      expect(decision.reason).toContain('No agents available');
    });

    it('returns multiple routes when multiple agents match', () => {
      const decision = mesh.routeTask(makeTask('t1', ['research']));
      expect(decision.routes.length).toBe(2);
    });

    it('selects best-score route by default', () => {
      mesh.updateReputation('1', 0.9);
      mesh.updateReputation('2', 0.5);
      const decision = mesh.routeTask(makeTask('t1', ['research']));
      expect(decision.strategy).toBe('best-score');
      expect(decision.selectedRoute!.agentId).toBe('1');
    });

    it('respects maxRoutesPerDecision config', () => {
      for (let i = 10; i < 20; i++) {
        mesh.registerAgent(makeAgent(`${i}`, ['research']));
      }
      const m = new ServiceMesh({ maxRoutesPerDecision: 3 });
      for (let i = 10; i < 20; i++) {
        m.registerAgent(makeAgent(`${i}`, ['research']));
      }
      const decision = m.routeTask(makeTask('t1', ['research']));
      expect(decision.routes.length).toBeLessThanOrEqual(3);
    });

    it('records routing decision in history', () => {
      mesh.routeTask(makeTask('t1', ['research']));
      mesh.routeTask(makeTask('t2', ['coding']));
      expect(mesh.getRoutingHistory().length).toBe(2);
    });

    it('skips inactive agents', () => {
      mesh.registerAgent(makeAgent('inactive', ['research']));
      const agent = makeAgent('inactive', ['research']);
      agent.status = 'inactive';
      mesh.registerAgent(agent);

      const decision = mesh.routeTask(makeTask('t1', ['research']));
      const ids = decision.routes.map(r => r.agentId);
      expect(ids).not.toContain('inactive');
    });

    it('skips agents at max capacity', () => {
      mesh.updateLoadMetrics('1', { activeTasks: 5, maxConcurrency: 5 });
      const decision = mesh.routeTask(makeTask('t1', ['research']));
      const ids = decision.routes.map(r => r.agentId);
      expect(ids).not.toContain('1');
    });

    it('skips agents with stale heartbeat', () => {
      mesh.updateLoadMetrics('1', { lastHeartbeat: Date.now() - 60000 });
      const decision = mesh.routeTask(makeTask('t1', ['research']));
      const ids = decision.routes.map(r => r.agentId);
      expect(ids).not.toContain('1');
    });
  });

  describe('routing strategies', () => {
    beforeEach(() => {
      mesh.registerAgent(makeAgent('fast', ['research']));
      mesh.registerAgent(makeAgent('cheap', ['research']));
      mesh.registerAgent(makeAgent('reputable', ['research']));

      mesh.updateLoadMetrics('fast', { avgResponseTime: 100 });
      mesh.updateLoadMetrics('cheap', { avgResponseTime: 5000 });
      mesh.updateLoadMetrics('reputable', { avgResponseTime: 2000 });

      mesh.updateReputation('fast', 0.5);
      mesh.updateReputation('cheap', 0.5);
      mesh.updateReputation('reputable', 0.95);
    });

    it('best-score considers all factors', () => {
      const decision = mesh.routeTask(makeTask('t1', ['research']), 'best-score');
      expect(decision.strategy).toBe('best-score');
      expect(decision.selectedRoute).not.toBeNull();
    });

    it('lowest-cost selects cheapest agent', () => {
      const decision = mesh.routeTask(makeTask('t1', ['research']), 'lowest-cost');
      expect(decision.strategy).toBe('lowest-cost');
      // Agent with lowest avgResponseTime has lowest estimated cost
      expect(decision.selectedRoute!.agentId).toBe('fast');
    });

    it('fastest selects lowest latency agent', () => {
      const decision = mesh.routeTask(makeTask('t1', ['research']), 'fastest');
      expect(decision.strategy).toBe('fastest');
      expect(decision.selectedRoute!.agentId).toBe('fast');
    });

    it('round-robin distributes across agents', () => {
      const results = new Set<string>();
      for (let i = 0; i < 6; i++) {
        const d = mesh.routeTask(makeTask(`t${i}`, ['research']), 'round-robin');
        if (d.selectedRoute) results.add(d.selectedRoute.agentId);
      }
      expect(results.size).toBeGreaterThanOrEqual(2);
    });

    it('failover orders by reputation', () => {
      const decision = mesh.routeTask(makeTask('t1', ['research']), 'failover');
      expect(decision.strategy).toBe('failover');
      // Most reputable agent should be primary
      expect(decision.selectedRoute!.agentId).toBe('reputable');
      // Should have fallback routes
      expect(decision.routes.length).toBe(3);
    });
  });

  describe('getMeshTopology', () => {
    it('returns empty topology when no agents', () => {
      const t = mesh.getMeshTopology();
      expect(t.totalAgents).toBe(0);
      expect(t.activeAgents).toBe(0);
      expect(t.avgLoad).toBe(0);
    });

    it('counts active agents', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      const inactive = makeAgent('2', ['coding']);
      inactive.status = 'inactive';
      mesh.registerAgent(inactive);

      const t = mesh.getMeshTopology();
      expect(t.totalAgents).toBe(2);
      expect(t.activeAgents).toBe(1);
    });

    it('aggregates capabilities across agents', () => {
      mesh.registerAgent(makeAgent('1', ['research', 'analysis']));
      mesh.registerAgent(makeAgent('2', ['research']));
      mesh.registerAgent(makeAgent('3', ['coding']));

      const t = mesh.getMeshTopology();
      expect(t.capabilities.get('research')).toBe(2);
      expect(t.capabilities.get('analysis')).toBe(1);
      expect(t.capabilities.get('coding')).toBe(1);
    });

    it('computes average load', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.registerAgent(makeAgent('2', ['research']));
      mesh.updateLoadMetrics('1', { activeTasks: 2, maxConcurrency: 5 });
      mesh.updateLoadMetrics('2', { activeTasks: 4, maxConcurrency: 5 });

      const t = mesh.getMeshTopology();
      // avg = ((2/5) + (4/5)) / 2 = 0.6
      expect(t.avgLoad).toBeCloseTo(0.6, 1);
    });

    it('tracks routing decisions count', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.routeTask(makeTask('t1', ['research']));
      mesh.routeTask(makeTask('t2', ['research']));
      expect(mesh.getMeshTopology().routingDecisions).toBe(2);
    });
  });

  describe('healthCheck', () => {
    it('returns healthy when all agents are fine', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      const health = mesh.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.issues.length).toBe(0);
      expect(health.agentStatuses.get('1')).toBe('healthy');
    });

    it('detects offline agents (stale heartbeat)', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.updateLoadMetrics('1', { lastHeartbeat: Date.now() - 60000 });
      const health = mesh.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.agentStatuses.get('1')).toBe('offline');
    });

    it('detects degraded agents (low success rate)', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.updateLoadMetrics('1', { successRate: 0.5 });
      const health = mesh.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.agentStatuses.get('1')).toBe('degraded');
    });

    it('detects degraded agents (at capacity)', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.updateLoadMetrics('1', { activeTasks: 5, maxConcurrency: 5 });
      const health = mesh.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.agentStatuses.get('1')).toBe('degraded');
    });

    it('reports multiple issues', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.registerAgent(makeAgent('2', ['coding']));
      mesh.updateLoadMetrics('1', { lastHeartbeat: Date.now() - 60000 });
      mesh.updateLoadMetrics('2', { successRate: 0.3 });
      const health = mesh.healthCheck();
      expect(health.issues.length).toBeGreaterThanOrEqual(2);
    });

    it('handles mixed healthy and unhealthy agents', () => {
      mesh.registerAgent(makeAgent('healthy', ['research']));
      mesh.registerAgent(makeAgent('unhealthy', ['coding']));
      mesh.updateLoadMetrics('unhealthy', { lastHeartbeat: Date.now() - 60000 });
      const health = mesh.healthCheck();
      expect(health.agentStatuses.get('healthy')).toBe('healthy');
      expect(health.agentStatuses.get('unhealthy')).toBe('offline');
    });
  });

  describe('getRoutingHistory', () => {
    it('returns empty when no decisions made', () => {
      expect(mesh.getRoutingHistory()).toEqual([]);
    });

    it('returns all decisions by default', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      for (let i = 0; i < 10; i++) {
        mesh.routeTask(makeTask(`t${i}`, ['research']));
      }
      expect(mesh.getRoutingHistory().length).toBe(10);
    });

    it('respects limit parameter', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      for (let i = 0; i < 10; i++) {
        mesh.routeTask(makeTask(`t${i}`, ['research']));
      }
      expect(mesh.getRoutingHistory(3).length).toBe(3);
    });

    it('returns most recent when limited', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      for (let i = 0; i < 5; i++) {
        mesh.routeTask(makeTask(`t${i}`, ['research']));
      }
      const last2 = mesh.getRoutingHistory(2);
      expect(last2[0].taskId).toBe('t3');
      expect(last2[1].taskId).toBe('t4');
    });
  });

  describe('ServiceRoute scoring', () => {
    it('scores higher for better reputation', () => {
      mesh.registerAgent(makeAgent('low-rep', ['research']));
      mesh.registerAgent(makeAgent('high-rep', ['research']));
      mesh.updateReputation('low-rep', 0.2);
      mesh.updateReputation('high-rep', 0.9);

      const decision = mesh.routeTask(makeTask('t1', ['research']), 'best-score');
      expect(decision.routes[0].agentId).toBe('high-rep');
    });

    it('scores higher for more available agents', () => {
      mesh.registerAgent(makeAgent('busy', ['research']));
      mesh.registerAgent(makeAgent('free', ['research']));
      mesh.updateLoadMetrics('busy', { activeTasks: 4, maxConcurrency: 5 });
      mesh.updateLoadMetrics('free', { activeTasks: 0, maxConcurrency: 5 });
      // Equalize reputation
      mesh.updateReputation('busy', 0.5);
      mesh.updateReputation('free', 0.5);

      const decision = mesh.routeTask(makeTask('t1', ['research']), 'best-score');
      expect(decision.routes[0].agentId).toBe('free');
    });

    it('score is bounded between 0 and 1', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.updateReputation('1', 1.0);
      const decision = mesh.routeTask(makeTask('t1', ['research']));
      expect(decision.routes[0].score).toBeGreaterThanOrEqual(0);
      expect(decision.routes[0].score).toBeLessThanOrEqual(1);
    });

    it('includes all scoring factors in route', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      const decision = mesh.routeTask(makeTask('t1', ['research']));
      const route = decision.routes[0];
      expect(route).toHaveProperty('score');
      expect(route).toHaveProperty('reputation');
      expect(route).toHaveProperty('availability');
      expect(route).toHaveProperty('estimatedCost');
      expect(route).toHaveProperty('estimatedLatency');
    });
  });

  describe('capability matching', () => {
    beforeEach(() => {
      mesh.registerAgent(makeAgent('1', ['research', 'analysis']));
      mesh.registerAgent(makeAgent('2', ['coding', 'testing']));
    });

    it('matches exact capability name', () => {
      const d = mesh.routeTask(makeTask('t1', ['coding']));
      expect(d.selectedRoute!.capability).toBe('coding');
    });

    it('is case insensitive', () => {
      const d = mesh.routeTask(makeTask('t1', ['RESEARCH']));
      expect(d.routes.length).toBeGreaterThan(0);
    });

    it('matches first available capability from required list', () => {
      const d = mesh.routeTask(makeTask('t1', ['nonexistent', 'analysis']));
      expect(d.selectedRoute!.capability).toBe('analysis');
    });

    it('handles multiple required capabilities', () => {
      const d = mesh.routeTask(makeTask('t1', ['research']));
      expect(d.routes.length).toBe(1);
      expect(d.selectedRoute!.agentId).toBe('1');
    });
  });

  describe('edge cases', () => {
    it('handles routing with zero agents', () => {
      const d = mesh.routeTask(makeTask('t1', ['anything']));
      expect(d.selectedRoute).toBeNull();
    });

    it('handles agent with many capabilities', () => {
      const caps = Array.from({ length: 50 }, (_, i) => `cap-${i}`);
      mesh.registerAgent(makeAgent('multi', caps));
      const d = mesh.routeTask(makeTask('t1', ['cap-25']));
      expect(d.selectedRoute!.agentId).toBe('multi');
    });

    it('handles concurrent routing of many tasks', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.registerAgent(makeAgent('2', ['research']));
      const decisions = [];
      for (let i = 0; i < 100; i++) {
        decisions.push(mesh.routeTask(makeTask(`t${i}`, ['research'])));
      }
      expect(decisions.length).toBe(100);
      expect(decisions.every(d => d.selectedRoute !== null)).toBe(true);
    });

    it('handles empty required capabilities gracefully', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      const d = mesh.routeTask(makeTask('t1', []));
      expect(d.selectedRoute).toBeNull();
    });

    it('handles agents with identical scores', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.registerAgent(makeAgent('2', ['research']));
      const d = mesh.routeTask(makeTask('t1', ['research']));
      expect(d.routes.length).toBe(2);
      // Both should have very similar scores
      expect(Math.abs(d.routes[0].score - d.routes[1].score)).toBeLessThan(0.1);
    });
  });

  describe('getAllLoadMetrics', () => {
    it('returns metrics for all registered agents', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.registerAgent(makeAgent('2', ['coding']));
      const metrics = mesh.getAllLoadMetrics();
      expect(metrics.length).toBe(2);
    });

    it('returns empty when no agents', () => {
      expect(mesh.getAllLoadMetrics()).toEqual([]);
    });

    it('returns updated metrics', () => {
      mesh.registerAgent(makeAgent('1', ['research']));
      mesh.updateLoadMetrics('1', { totalTasksHandled: 100 });
      expect(mesh.getAllLoadMetrics()[0].totalTasksHandled).toBe(100);
    });
  });
});
