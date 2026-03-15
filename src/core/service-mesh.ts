/**
 * ServiceMesh - Intelligent service discovery and load balancing for AgentMesh.
 *
 * Routes task requests to optimal agents based on:
 * - Capability matching (required skills)
 * - Agent reputation scores
 * - Current availability and load
 * - Geographic/network proximity (via Hedera topic locality)
 * - Cost optimization (budget constraints)
 */

import { AgentProfile, TaskRequest } from './types';

export interface ServiceRoute {
  agentId: string;
  agentName: string;
  capability: string;
  score: number;         // 0-1 composite routing score
  reputation: number;    // 0-1 reputation factor
  availability: number;  // 0-1 availability factor
  estimatedCost: number;
  estimatedLatency: number; // ms
}

export interface RoutingDecision {
  taskId: string;
  routes: ServiceRoute[];
  selectedRoute: ServiceRoute | null;
  strategy: RoutingStrategy;
  evaluatedAt: number;
  reason: string;
}

export type RoutingStrategy =
  | 'best-score'      // highest composite score
  | 'lowest-cost'     // cheapest available agent
  | 'fastest'         // lowest latency
  | 'round-robin'     // distribute evenly
  | 'failover';       // primary -> backup chain

export interface LoadMetrics {
  agentId: string;
  activeTasks: number;
  maxConcurrency: number;
  avgResponseTime: number;      // ms
  successRate: number;           // 0-1
  lastHeartbeat: number;         // timestamp
  totalTasksHandled: number;
}

export interface ServiceMeshConfig {
  maxRoutesPerDecision: number;
  defaultStrategy: RoutingStrategy;
  heartbeatTimeout: number;      // ms - consider agent offline after this
  reputationWeight: number;      // 0-1
  availabilityWeight: number;    // 0-1
  costWeight: number;            // 0-1
  latencyWeight: number;         // 0-1
}

const DEFAULT_CONFIG: ServiceMeshConfig = {
  maxRoutesPerDecision: 5,
  defaultStrategy: 'best-score',
  heartbeatTimeout: 30000,
  reputationWeight: 0.3,
  availabilityWeight: 0.3,
  costWeight: 0.2,
  latencyWeight: 0.2,
};

export class ServiceMesh {
  private agents: Map<string, AgentProfile> = new Map();
  private loadMetrics: Map<string, LoadMetrics> = new Map();
  private reputationScores: Map<string, number> = new Map();
  private routingHistory: RoutingDecision[] = [];
  private roundRobinIndex: Map<string, number> = new Map();
  private config: ServiceMeshConfig;

  constructor(config: Partial<ServiceMeshConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Validate weights sum to ~1
    const totalWeight =
      this.config.reputationWeight +
      this.config.availabilityWeight +
      this.config.costWeight +
      this.config.latencyWeight;
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      throw new Error(`Routing weights must sum to 1.0, got ${totalWeight.toFixed(2)}`);
    }
  }

  /**
   * Register an agent in the service mesh.
   */
  registerAgent(agent: AgentProfile): void {
    if (!agent.id) throw new Error('Agent ID is required');
    if (!agent.capabilities || agent.capabilities.length === 0) {
      throw new Error('Agent must have at least one capability');
    }
    this.agents.set(agent.id, agent);
    if (!this.loadMetrics.has(agent.id)) {
      this.loadMetrics.set(agent.id, {
        agentId: agent.id,
        activeTasks: 0,
        maxConcurrency: 5,
        avgResponseTime: 1000,
        successRate: 1.0,
        lastHeartbeat: Date.now(),
        totalTasksHandled: 0,
      });
    }
    if (!this.reputationScores.has(agent.id)) {
      this.reputationScores.set(agent.id, 0.5); // neutral starting reputation
    }
  }

  /**
   * Deregister an agent from the service mesh.
   */
  deregisterAgent(agentId: string): boolean {
    const existed = this.agents.delete(agentId);
    this.loadMetrics.delete(agentId);
    return existed;
  }

  /**
   * Update load metrics for an agent (e.g., from heartbeat).
   */
  updateLoadMetrics(agentId: string, metrics: Partial<LoadMetrics>): void {
    const existing = this.loadMetrics.get(agentId);
    if (!existing) throw new Error(`Unknown agent: ${agentId}`);
    this.loadMetrics.set(agentId, { ...existing, ...metrics, agentId });
  }

  /**
   * Update reputation score for an agent.
   */
  updateReputation(agentId: string, score: number): void {
    if (score < 0 || score > 1) throw new Error('Reputation must be between 0 and 1');
    this.reputationScores.set(agentId, score);
  }

  /**
   * Route a task to the best available agent(s).
   */
  routeTask(task: TaskRequest, strategy?: RoutingStrategy): RoutingDecision {
    const strat = strategy ?? this.config.defaultStrategy;
    const now = Date.now();

    // Find agents with matching capabilities
    const candidates = this.findCandidates(task, now);

    if (candidates.length === 0) {
      const decision: RoutingDecision = {
        taskId: task.id,
        routes: [],
        selectedRoute: null,
        strategy: strat,
        evaluatedAt: now,
        reason: 'No agents available with required capabilities',
      };
      this.routingHistory.push(decision);
      return decision;
    }

    // Score each candidate
    const routes = candidates.map(c => this.scoreCandidate(c, task));

    // Apply routing strategy
    const sorted = this.applyStrategy(routes, strat, task.requiredCapabilities[0] || '');

    const trimmed = sorted.slice(0, this.config.maxRoutesPerDecision);
    const selected = trimmed[0] ?? null;

    const decision: RoutingDecision = {
      taskId: task.id,
      routes: trimmed,
      selectedRoute: selected,
      strategy: strat,
      evaluatedAt: now,
      reason: selected
        ? `Routed to ${selected.agentName} (score: ${selected.score.toFixed(3)})`
        : 'No suitable route found',
    };

    this.routingHistory.push(decision);
    return decision;
  }

  /**
   * Find agents whose capabilities match the task requirements.
   */
  private findCandidates(task: TaskRequest, now: number): Array<{ agent: AgentProfile; matchedCapability: string }> {
    const results: Array<{ agent: AgentProfile; matchedCapability: string }> = [];

    for (const agent of this.agents.values()) {
      // Skip inactive agents
      if (agent.status !== 'active') continue;

      // Check heartbeat freshness
      const metrics = this.loadMetrics.get(agent.id);
      if (metrics && (now - metrics.lastHeartbeat) > this.config.heartbeatTimeout) continue;

      // Check capacity
      if (metrics && metrics.activeTasks >= metrics.maxConcurrency) continue;

      // Match capabilities
      for (const required of task.requiredCapabilities) {
        const match = agent.capabilities.find(
          c => c.name.toLowerCase() === required.toLowerCase()
        );
        if (match) {
          results.push({ agent, matchedCapability: match.name });
          break;
        }
      }
    }

    return results;
  }

  /**
   * Score a candidate agent for routing.
   */
  private scoreCandidate(
    candidate: { agent: AgentProfile; matchedCapability: string },
    task: TaskRequest
  ): ServiceRoute {
    const { agent, matchedCapability } = candidate;
    const metrics = this.loadMetrics.get(agent.id)!;
    const reputation = this.reputationScores.get(agent.id) ?? 0.5;

    // Availability: ratio of remaining capacity
    const availability = metrics.maxConcurrency > 0
      ? 1 - (metrics.activeTasks / metrics.maxConcurrency)
      : 0;

    // Cost factor (lower is better, normalized 0-1)
    const estimatedCost = metrics.avgResponseTime * 0.001; // simplified cost model
    const costScore = Math.max(0, 1 - estimatedCost / 10);

    // Latency factor (lower is better, normalized 0-1)
    const latencyScore = Math.max(0, 1 - metrics.avgResponseTime / 10000);

    // Composite score
    const score =
      reputation * this.config.reputationWeight +
      availability * this.config.availabilityWeight +
      costScore * this.config.costWeight +
      latencyScore * this.config.latencyWeight;

    return {
      agentId: agent.id,
      agentName: agent.name,
      capability: matchedCapability,
      score: Math.min(1, Math.max(0, score)),
      reputation,
      availability,
      estimatedCost,
      estimatedLatency: metrics.avgResponseTime,
    };
  }

  /**
   * Apply routing strategy to order candidates.
   */
  private applyStrategy(routes: ServiceRoute[], strategy: RoutingStrategy, capability: string): ServiceRoute[] {
    switch (strategy) {
      case 'best-score':
        return [...routes].sort((a, b) => b.score - a.score);

      case 'lowest-cost':
        return [...routes].sort((a, b) => a.estimatedCost - b.estimatedCost);

      case 'fastest':
        return [...routes].sort((a, b) => a.estimatedLatency - b.estimatedLatency);

      case 'round-robin': {
        const key = capability || '__default__';
        const idx = (this.roundRobinIndex.get(key) ?? 0) % Math.max(1, routes.length);
        this.roundRobinIndex.set(key, idx + 1);
        // Rotate array so current index is first
        return [...routes.slice(idx), ...routes.slice(0, idx)];
      }

      case 'failover':
        // Primary = best score, then ordered by reputation as fallback chain
        return [...routes].sort((a, b) => b.reputation - a.reputation);

      default:
        return routes;
    }
  }

  /**
   * Get routing history for analytics.
   */
  getRoutingHistory(limit?: number): RoutingDecision[] {
    const history = [...this.routingHistory];
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Get current mesh topology summary.
   */
  getMeshTopology(): {
    totalAgents: number;
    activeAgents: number;
    capabilities: Map<string, number>;
    avgLoad: number;
    routingDecisions: number;
  } {
    let activeCount = 0;
    let totalLoad = 0;
    const capabilities = new Map<string, number>();

    for (const agent of this.agents.values()) {
      if (agent.status === 'active') activeCount++;
      const metrics = this.loadMetrics.get(agent.id);
      if (metrics && metrics.maxConcurrency > 0) {
        totalLoad += metrics.activeTasks / metrics.maxConcurrency;
      }
      for (const cap of agent.capabilities) {
        capabilities.set(cap.name, (capabilities.get(cap.name) ?? 0) + 1);
      }
    }

    return {
      totalAgents: this.agents.size,
      activeAgents: activeCount,
      capabilities,
      avgLoad: this.agents.size > 0 ? totalLoad / this.agents.size : 0,
      routingDecisions: this.routingHistory.length,
    };
  }

  /**
   * Get load metrics for all agents.
   */
  getAllLoadMetrics(): LoadMetrics[] {
    return Array.from(this.loadMetrics.values());
  }

  /**
   * Health check across the mesh.
   */
  healthCheck(): {
    healthy: boolean;
    issues: string[];
    agentStatuses: Map<string, 'healthy' | 'degraded' | 'offline'>;
  } {
    const now = Date.now();
    const issues: string[] = [];
    const agentStatuses = new Map<string, 'healthy' | 'degraded' | 'offline'>();

    for (const [id, agent] of this.agents) {
      const metrics = this.loadMetrics.get(id);
      if (!metrics) {
        agentStatuses.set(id, 'offline');
        issues.push(`Agent ${agent.name}: no metrics available`);
        continue;
      }

      const timeSinceHeartbeat = now - metrics.lastHeartbeat;
      if (timeSinceHeartbeat > this.config.heartbeatTimeout) {
        agentStatuses.set(id, 'offline');
        issues.push(`Agent ${agent.name}: heartbeat timeout (${Math.floor(timeSinceHeartbeat / 1000)}s ago)`);
      } else if (metrics.successRate < 0.8 || metrics.activeTasks >= metrics.maxConcurrency) {
        agentStatuses.set(id, 'degraded');
        if (metrics.successRate < 0.8) {
          issues.push(`Agent ${agent.name}: low success rate (${(metrics.successRate * 100).toFixed(0)}%)`);
        }
        if (metrics.activeTasks >= metrics.maxConcurrency) {
          issues.push(`Agent ${agent.name}: at capacity (${metrics.activeTasks}/${metrics.maxConcurrency})`);
        }
      } else {
        agentStatuses.set(id, 'healthy');
      }
    }

    return {
      healthy: issues.length === 0,
      issues,
      agentStatuses,
    };
  }
}
