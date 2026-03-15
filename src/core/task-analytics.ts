/**
 * TaskAnalytics - Comprehensive performance analytics for the AgentMesh network
 *
 * Tracks task completion statistics, generates performance reports, identifies
 * bottleneck agents, computes agent specialization scores, and performs trend
 * analysis across configurable time windows.
 *
 * Designed to integrate with TaskCoordinator and ReputationManager for
 * data-driven mesh optimization and load balancing recommendations.
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single recorded task event used as the atomic unit of analytics */
export interface TaskEvent {
  taskId: string;
  agentId: string;
  taskType: string;
  status: 'success' | 'failure';
  duration: number; // ms
  cost: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/** Per-agent statistics aggregated from task events */
export interface AgentStats {
  agentId: string;
  totalTasks: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  averageDuration: number;
  medianDuration: number;
  p95Duration: number;
  p99Duration: number;
  minDuration: number;
  maxDuration: number;
  totalCost: number;
  averageCost: number;
  taskTypes: string[];
  firstTaskAt: number;
  lastTaskAt: number;
}

/** Per-task-type statistics */
export interface TaskTypeStats {
  taskType: string;
  totalTasks: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  averageDuration: number;
  medianDuration: number;
  totalCost: number;
  agentCount: number;
  topAgents: Array<{ agentId: string; successRate: number; avgDuration: number }>;
}

/** Comprehensive mesh-wide performance report */
export interface PerformanceReport {
  generatedAt: number;
  timeRange: { start: number; end: number };
  totalTasks: number;
  totalSuccesses: number;
  totalFailures: number;
  overallSuccessRate: number;
  averageDuration: number;
  medianDuration: number;
  totalCost: number;
  activeAgents: number;
  taskTypeBreakdown: TaskTypeStats[];
  agentRankings: Array<{ agentId: string; score: number; successRate: number; avgDuration: number }>;
  bottlenecks: BottleneckReport[];
  loadBalancingRecommendations: LoadBalancingRecommendation[];
}

/** Identifies agents that are performance bottlenecks */
export interface BottleneckReport {
  agentId: string;
  reason: BottleneckReason;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metric: number;
  threshold: number;
  recommendation: string;
}

export enum BottleneckReason {
  HIGH_FAILURE_RATE = 'high_failure_rate',
  SLOW_EXECUTION = 'slow_execution',
  OVERLOADED = 'overloaded',
  DEGRADING_PERFORMANCE = 'degrading_performance',
  HIGH_COST = 'high_cost',
}

/** Suggests how to redistribute tasks across agents */
export interface LoadBalancingRecommendation {
  taskType: string;
  currentDistribution: Array<{ agentId: string; taskCount: number; percentage: number }>;
  suggestedDistribution: Array<{ agentId: string; targetPercentage: number; reason: string }>;
  expectedImprovement: string;
}

/** Agent specialization: how good an agent is at a specific task type */
export interface SpecializationScore {
  agentId: string;
  taskType: string;
  score: number; // 0-1
  confidence: number; // 0-1 based on sample size
  successRate: number;
  averageDuration: number;
  taskCount: number;
}

/** Trend direction for performance over time */
export enum TrendDirection {
  IMPROVING = 'improving',
  STABLE = 'stable',
  DEGRADING = 'degrading',
  INSUFFICIENT_DATA = 'insufficient_data',
}

/** Trend analysis result for an agent or the mesh overall */
export interface TrendAnalysis {
  entityId: string; // agentId or '__mesh__' for overall
  entityType: 'agent' | 'mesh' | 'task_type';
  metric: 'success_rate' | 'duration' | 'cost' | 'throughput';
  direction: TrendDirection;
  changePercent: number;
  windowStart: number;
  windowEnd: number;
  dataPoints: number;
  values: Array<{ timestamp: number; value: number }>;
  movingAverage: number[];
}

/** Configuration for the TaskAnalytics engine */
export interface TaskAnalyticsConfig {
  /** Minimum tasks before flagging bottlenecks (default: 5) */
  minTasksForBottleneck: number;
  /** Failure rate threshold for bottleneck detection (default: 0.3 = 30%) */
  failureRateThreshold: number;
  /** Percentile threshold for slow execution detection (default: 1.5x median) */
  slowExecutionMultiplier: number;
  /** Task count threshold for overloaded agents (default: 2x mean) */
  overloadMultiplier: number;
  /** Minimum data points for trend analysis (default: 3) */
  minDataPointsForTrend: number;
  /** Default time window for trend analysis in ms (default: 1 hour) */
  defaultTrendWindow: number;
  /** Number of buckets for trend analysis (default: 5) */
  trendBuckets: number;
  /** Minimum tasks for specialization score confidence (default: 3) */
  minTasksForSpecialization: number;
  /** Cost threshold multiplier for high-cost bottleneck (default: 2x mean) */
  highCostMultiplier: number;
}

const DEFAULT_CONFIG: TaskAnalyticsConfig = {
  minTasksForBottleneck: 5,
  failureRateThreshold: 0.3,
  slowExecutionMultiplier: 1.5,
  overloadMultiplier: 2.0,
  minDataPointsForTrend: 3,
  defaultTrendWindow: 3600000, // 1 hour
  trendBuckets: 5,
  minTasksForSpecialization: 3,
  highCostMultiplier: 2.0,
};

// ─── Main Class ─────────────────────────────────────────────────────────────

export class TaskAnalytics extends EventEmitter {
  private events: TaskEvent[] = [];
  private config: TaskAnalyticsConfig;

  constructor(config?: Partial<TaskAnalyticsConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Event Recording ────────────────────────────────────────────────────

  /**
   * Record a completed (success or failure) task event
   */
  recordTask(event: TaskEvent): void {
    if (!event.taskId || !event.agentId || !event.taskType) {
      throw new Error('TaskEvent requires taskId, agentId, and taskType');
    }
    if (event.duration < 0) {
      throw new Error('TaskEvent duration cannot be negative');
    }
    if (event.cost < 0) {
      throw new Error('TaskEvent cost cannot be negative');
    }
    if (event.status !== 'success' && event.status !== 'failure') {
      throw new Error('TaskEvent status must be "success" or "failure"');
    }

    this.events.push({ ...event });
    this.emit('task:recorded', event);
  }

  /**
   * Record a batch of task events
   */
  recordBatch(events: TaskEvent[]): number {
    let recorded = 0;
    for (const event of events) {
      try {
        this.recordTask(event);
        recorded++;
      } catch {
        // Skip invalid events in batch mode
      }
    }
    return recorded;
  }

  /**
   * Get the total count of recorded events
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Get all recorded events (optionally filtered by time range)
   */
  getEvents(startTime?: number, endTime?: number): TaskEvent[] {
    let filtered = this.events;
    if (startTime !== undefined) {
      filtered = filtered.filter(e => e.timestamp >= startTime);
    }
    if (endTime !== undefined) {
      filtered = filtered.filter(e => e.timestamp <= endTime);
    }
    return [...filtered];
  }

  /**
   * Clear all recorded events
   */
  clearEvents(): void {
    this.events = [];
    this.emit('events:cleared');
  }

  // ─── Agent Statistics ───────────────────────────────────────────────────

  /**
   * Compute statistics for a single agent
   */
  getAgentStats(agentId: string): AgentStats {
    const agentEvents = this.events.filter(e => e.agentId === agentId);
    return this.computeAgentStats(agentId, agentEvents);
  }

  /**
   * Compute statistics for all agents
   */
  getAllAgentStats(): AgentStats[] {
    const agentIds = this.getUniqueAgentIds();
    return agentIds.map(id => this.getAgentStats(id));
  }

  /**
   * Get the IDs of all agents that have recorded events
   */
  getUniqueAgentIds(): string[] {
    return [...new Set(this.events.map(e => e.agentId))];
  }

  /**
   * Get the unique task types seen across all events
   */
  getUniqueTaskTypes(): string[] {
    return [...new Set(this.events.map(e => e.taskType))];
  }

  // ─── Task Type Statistics ───────────────────────────────────────────────

  /**
   * Compute statistics for a specific task type
   */
  getTaskTypeStats(taskType: string): TaskTypeStats {
    const typeEvents = this.events.filter(e => e.taskType === taskType);
    return this.computeTaskTypeStats(taskType, typeEvents);
  }

  /**
   * Compute statistics for all task types
   */
  getAllTaskTypeStats(): TaskTypeStats[] {
    const taskTypes = this.getUniqueTaskTypes();
    return taskTypes.map(tt => this.getTaskTypeStats(tt));
  }

  // ─── Performance Report ─────────────────────────────────────────────────

  /**
   * Generate a comprehensive mesh-wide performance report
   */
  generateReport(startTime?: number, endTime?: number): PerformanceReport {
    const now = Date.now();
    const filteredEvents = this.getEvents(startTime, endTime);

    const totalTasks = filteredEvents.length;
    const totalSuccesses = filteredEvents.filter(e => e.status === 'success').length;
    const totalFailures = filteredEvents.filter(e => e.status === 'failure').length;
    const overallSuccessRate = totalTasks > 0 ? totalSuccesses / totalTasks : 0;
    const durations = filteredEvents.map(e => e.duration);
    const averageDuration = totalTasks > 0
      ? durations.reduce((a, b) => a + b, 0) / totalTasks
      : 0;
    const medianDuration = this.computeMedian(durations);
    const totalCost = filteredEvents.reduce((sum, e) => sum + e.cost, 0);

    const agentIds = [...new Set(filteredEvents.map(e => e.agentId))];
    const taskTypes = [...new Set(filteredEvents.map(e => e.taskType))];

    // Build per-type stats from filtered events
    const taskTypeBreakdown = taskTypes.map(tt => {
      const typeEvents = filteredEvents.filter(e => e.taskType === tt);
      return this.computeTaskTypeStats(tt, typeEvents);
    });

    // Rank agents by composite score
    const agentRankings = agentIds.map(agentId => {
      const agentEvents = filteredEvents.filter(e => e.agentId === agentId);
      const stats = this.computeAgentStats(agentId, agentEvents);
      const score = this.computeAgentCompositeScore(stats);
      return {
        agentId,
        score: Math.round(score * 1000) / 1000,
        successRate: stats.successRate,
        avgDuration: stats.averageDuration,
      };
    }).sort((a, b) => b.score - a.score);

    // Detect bottlenecks
    const bottlenecks = this.detectBottlenecks(filteredEvents);

    // Load balancing recommendations
    const loadBalancingRecommendations = this.computeLoadBalancingRecommendations(filteredEvents);

    const start = filteredEvents.length > 0
      ? Math.min(...filteredEvents.map(e => e.timestamp))
      : startTime ?? now;
    const end = filteredEvents.length > 0
      ? Math.max(...filteredEvents.map(e => e.timestamp))
      : endTime ?? now;

    return {
      generatedAt: now,
      timeRange: { start, end },
      totalTasks,
      totalSuccesses,
      totalFailures,
      overallSuccessRate: Math.round(overallSuccessRate * 1000) / 1000,
      averageDuration: Math.round(averageDuration),
      medianDuration,
      totalCost: Math.round(totalCost * 100) / 100,
      activeAgents: agentIds.length,
      taskTypeBreakdown,
      agentRankings,
      bottlenecks,
      loadBalancingRecommendations,
    };
  }

  // ─── Bottleneck Detection ───────────────────────────────────────────────

  /**
   * Identify agents that are bottlenecks in the mesh
   */
  detectBottlenecks(eventsOrUndefined?: TaskEvent[]): BottleneckReport[] {
    const events = eventsOrUndefined ?? this.events;
    const bottlenecks: BottleneckReport[] = [];

    const agentIds = [...new Set(events.map(e => e.agentId))];

    // Compute mesh-wide averages
    const allDurations = events.filter(e => e.status === 'success').map(e => e.duration);
    const meshMedianDuration = this.computeMedian(allDurations);
    const meshMeanCost = events.length > 0
      ? events.reduce((sum, e) => sum + e.cost, 0) / events.length
      : 0;
    const meshMeanTaskCount = agentIds.length > 0
      ? events.length / agentIds.length
      : 0;

    for (const agentId of agentIds) {
      const agentEvents = events.filter(e => e.agentId === agentId);

      if (agentEvents.length < this.config.minTasksForBottleneck) {
        continue;
      }

      // 1) High failure rate
      const failureCount = agentEvents.filter(e => e.status === 'failure').length;
      const failureRate = failureCount / agentEvents.length;
      if (failureRate >= this.config.failureRateThreshold) {
        const severity = failureRate >= 0.7 ? 'critical'
          : failureRate >= 0.5 ? 'high'
          : failureRate >= 0.4 ? 'medium'
          : 'low';
        bottlenecks.push({
          agentId,
          reason: BottleneckReason.HIGH_FAILURE_RATE,
          severity,
          metric: Math.round(failureRate * 1000) / 1000,
          threshold: this.config.failureRateThreshold,
          recommendation: `Agent ${agentId} has a ${(failureRate * 100).toFixed(1)}% failure rate. Consider reducing task assignments or investigating root cause.`,
        });
      }

      // 2) Slow execution
      const successDurations = agentEvents
        .filter(e => e.status === 'success')
        .map(e => e.duration);
      if (successDurations.length > 0 && meshMedianDuration > 0) {
        const agentMedian = this.computeMedian(successDurations);
        const slowThreshold = meshMedianDuration * this.config.slowExecutionMultiplier;
        if (agentMedian > slowThreshold) {
          const ratio = agentMedian / meshMedianDuration;
          const severity = ratio >= 4 ? 'critical'
            : ratio >= 3 ? 'high'
            : ratio >= 2 ? 'medium'
            : 'low';
          bottlenecks.push({
            agentId,
            reason: BottleneckReason.SLOW_EXECUTION,
            severity,
            metric: Math.round(agentMedian),
            threshold: Math.round(slowThreshold),
            recommendation: `Agent ${agentId} median execution time (${Math.round(agentMedian)}ms) is ${ratio.toFixed(1)}x the mesh median. Consider offloading tasks to faster agents.`,
          });
        }
      }

      // 3) Overloaded
      if (meshMeanTaskCount > 0) {
        const overloadThreshold = meshMeanTaskCount * this.config.overloadMultiplier;
        if (agentEvents.length > overloadThreshold) {
          const ratio = agentEvents.length / meshMeanTaskCount;
          const severity = ratio >= 5 ? 'critical'
            : ratio >= 4 ? 'high'
            : ratio >= 3 ? 'medium'
            : 'low';
          bottlenecks.push({
            agentId,
            reason: BottleneckReason.OVERLOADED,
            severity,
            metric: agentEvents.length,
            threshold: Math.round(overloadThreshold),
            recommendation: `Agent ${agentId} is handling ${agentEvents.length} tasks (${ratio.toFixed(1)}x average). Distribute work to underutilized agents.`,
          });
        }
      }

      // 4) High cost
      if (meshMeanCost > 0) {
        const agentMeanCost = agentEvents.reduce((s, e) => s + e.cost, 0) / agentEvents.length;
        const costThreshold = meshMeanCost * this.config.highCostMultiplier;
        if (agentMeanCost > costThreshold) {
          const ratio = agentMeanCost / meshMeanCost;
          const severity = ratio >= 5 ? 'critical'
            : ratio >= 3 ? 'high'
            : ratio >= 2.5 ? 'medium'
            : 'low';
          bottlenecks.push({
            agentId,
            reason: BottleneckReason.HIGH_COST,
            severity,
            metric: Math.round(agentMeanCost * 100) / 100,
            threshold: Math.round(costThreshold * 100) / 100,
            recommendation: `Agent ${agentId} average cost (${agentMeanCost.toFixed(2)}) is ${ratio.toFixed(1)}x the mesh average. Evaluate cost efficiency.`,
          });
        }
      }
    }

    // Sort by severity (critical first)
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    bottlenecks.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return bottlenecks;
  }

  // ─── Load Balancing ─────────────────────────────────────────────────────

  /**
   * Compute load balancing recommendations per task type
   */
  computeLoadBalancingRecommendations(eventsOrUndefined?: TaskEvent[]): LoadBalancingRecommendation[] {
    const events = eventsOrUndefined ?? this.events;
    const taskTypes = [...new Set(events.map(e => e.taskType))];
    const recommendations: LoadBalancingRecommendation[] = [];

    for (const taskType of taskTypes) {
      const typeEvents = events.filter(e => e.taskType === taskType);
      const agentIds = [...new Set(typeEvents.map(e => e.agentId))];

      if (agentIds.length < 2) continue; // Can't rebalance with one agent

      // Current distribution
      const currentDistribution = agentIds.map(agentId => {
        const count = typeEvents.filter(e => e.agentId === agentId).length;
        return {
          agentId,
          taskCount: count,
          percentage: Math.round((count / typeEvents.length) * 1000) / 10,
        };
      }).sort((a, b) => b.taskCount - a.taskCount);

      // Check if distribution is imbalanced (top agent handles >60% or >2x the mean)
      const meanTasks = typeEvents.length / agentIds.length;
      const maxTaskCount = currentDistribution[0]!.taskCount;
      const isImbalanced = maxTaskCount > meanTasks * 1.5 || currentDistribution[0]!.percentage > 60;

      if (!isImbalanced) continue;

      // Compute suggested distribution based on agent performance scores
      const agentScores = agentIds.map(agentId => {
        const agentTypeEvents = typeEvents.filter(e => e.agentId === agentId);
        const successCount = agentTypeEvents.filter(e => e.status === 'success').length;
        const successRate = agentTypeEvents.length > 0 ? successCount / agentTypeEvents.length : 0;
        const avgDuration = agentTypeEvents.length > 0
          ? agentTypeEvents.filter(e => e.status === 'success').reduce((s, e) => s + e.duration, 0) / Math.max(successCount, 1)
          : Infinity;
        // Score: higher is better. Prefer high success + low duration.
        const speedScore = avgDuration > 0 ? 1 / (avgDuration / 1000) : 0;
        return {
          agentId,
          score: (successRate * 0.6) + (speedScore * 0.4),
          successRate,
          avgDuration,
        };
      });

      const totalScore = agentScores.reduce((s, a) => s + a.score, 0);
      const suggestedDistribution = agentScores.map(a => ({
        agentId: a.agentId,
        targetPercentage: totalScore > 0
          ? Math.round((a.score / totalScore) * 1000) / 10
          : Math.round(1000 / agentIds.length) / 10,
        reason: a.successRate >= 0.8
          ? `High success rate (${(a.successRate * 100).toFixed(0)}%) — assign more tasks`
          : a.successRate < 0.5
          ? `Low success rate (${(a.successRate * 100).toFixed(0)}%) — reduce assignments`
          : `Moderate performance — maintain current load`,
      }));

      recommendations.push({
        taskType,
        currentDistribution,
        suggestedDistribution,
        expectedImprovement: `Rebalancing ${taskType} tasks across ${agentIds.length} agents should improve overall success rate and reduce latency.`,
      });
    }

    return recommendations;
  }

  // ─── Specialization Scores ──────────────────────────────────────────────

  /**
   * Compute specialization scores for a single agent across all task types
   */
  getAgentSpecializations(agentId: string): SpecializationScore[] {
    const agentEvents = this.events.filter(e => e.agentId === agentId);
    const taskTypes = [...new Set(agentEvents.map(e => e.taskType))];

    return taskTypes.map(taskType => {
      const typeEvents = agentEvents.filter(e => e.taskType === taskType);
      return this.computeSpecializationScore(agentId, taskType, typeEvents);
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Compute specialization score for a specific agent+taskType pair
   */
  getSpecializationScore(agentId: string, taskType: string): SpecializationScore {
    const typeEvents = this.events.filter(
      e => e.agentId === agentId && e.taskType === taskType
    );
    return this.computeSpecializationScore(agentId, taskType, typeEvents);
  }

  /**
   * Find the best agent for a given task type
   */
  getBestAgentForTaskType(taskType: string): SpecializationScore | null {
    const typeEvents = this.events.filter(e => e.taskType === taskType);
    const agentIds = [...new Set(typeEvents.map(e => e.agentId))];

    if (agentIds.length === 0) return null;

    const scores = agentIds.map(agentId => {
      const agentTypeEvents = typeEvents.filter(e => e.agentId === agentId);
      return this.computeSpecializationScore(agentId, taskType, agentTypeEvents);
    });

    // Return agent with the highest specialization score (weighted by confidence)
    scores.sort((a, b) => (b.score * b.confidence) - (a.score * a.confidence));
    return scores[0] ?? null;
  }

  /**
   * Get all specialization scores (agent x taskType matrix)
   */
  getAllSpecializations(): SpecializationScore[] {
    const result: SpecializationScore[] = [];
    const agentIds = this.getUniqueAgentIds();
    const taskTypes = this.getUniqueTaskTypes();

    for (const agentId of agentIds) {
      for (const taskType of taskTypes) {
        const typeEvents = this.events.filter(
          e => e.agentId === agentId && e.taskType === taskType
        );
        if (typeEvents.length > 0) {
          result.push(this.computeSpecializationScore(agentId, taskType, typeEvents));
        }
      }
    }

    return result.sort((a, b) => b.score - a.score);
  }

  // ─── Trend Analysis ─────────────────────────────────────────────────────

  /**
   * Analyze performance trend for a specific agent
   */
  getAgentTrend(
    agentId: string,
    metric: TrendAnalysis['metric'] = 'success_rate',
    windowMs?: number,
  ): TrendAnalysis {
    const window = windowMs ?? this.config.defaultTrendWindow;
    const agentEvents = this.events.filter(e => e.agentId === agentId);
    return this.computeTrend(agentId, 'agent', metric, agentEvents, window);
  }

  /**
   * Analyze performance trend for the entire mesh
   */
  getMeshTrend(
    metric: TrendAnalysis['metric'] = 'success_rate',
    windowMs?: number,
  ): TrendAnalysis {
    const window = windowMs ?? this.config.defaultTrendWindow;
    return this.computeTrend('__mesh__', 'mesh', metric, this.events, window);
  }

  /**
   * Analyze performance trend for a specific task type
   */
  getTaskTypeTrend(
    taskType: string,
    metric: TrendAnalysis['metric'] = 'success_rate',
    windowMs?: number,
  ): TrendAnalysis {
    const window = windowMs ?? this.config.defaultTrendWindow;
    const typeEvents = this.events.filter(e => e.taskType === taskType);
    return this.computeTrend(taskType, 'task_type', metric, typeEvents, window);
  }

  /**
   * Detect degrading agents — those whose recent performance is worse than historical
   */
  getDegradingAgents(windowMs?: number): TrendAnalysis[] {
    const agentIds = this.getUniqueAgentIds();
    return agentIds
      .map(id => this.getAgentTrend(id, 'success_rate', windowMs))
      .filter(t => t.direction === TrendDirection.DEGRADING);
  }

  /**
   * Detect improving agents
   */
  getImprovingAgents(windowMs?: number): TrendAnalysis[] {
    const agentIds = this.getUniqueAgentIds();
    return agentIds
      .map(id => this.getAgentTrend(id, 'success_rate', windowMs))
      .filter(t => t.direction === TrendDirection.IMPROVING);
  }

  // ─── Configuration ──────────────────────────────────────────────────────

  /**
   * Get the current configuration
   */
  getConfig(): TaskAnalyticsConfig {
    return { ...this.config };
  }

  /**
   * Update the configuration
   */
  updateConfig(partial: Partial<TaskAnalyticsConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private computeAgentStats(agentId: string, events: TaskEvent[]): AgentStats {
    const totalTasks = events.length;
    const successCount = events.filter(e => e.status === 'success').length;
    const failureCount = events.filter(e => e.status === 'failure').length;
    const successRate = totalTasks > 0 ? successCount / totalTasks : 0;

    const successDurations = events
      .filter(e => e.status === 'success')
      .map(e => e.duration);
    const allDurations = events.map(e => e.duration);

    const averageDuration = allDurations.length > 0
      ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length
      : 0;
    const medianDuration = this.computeMedian(allDurations);
    const p95Duration = this.computePercentile(allDurations, 95);
    const p99Duration = this.computePercentile(allDurations, 99);
    const minDuration = allDurations.length > 0 ? Math.min(...allDurations) : 0;
    const maxDuration = allDurations.length > 0 ? Math.max(...allDurations) : 0;

    const totalCost = events.reduce((sum, e) => sum + e.cost, 0);
    const averageCost = totalTasks > 0 ? totalCost / totalTasks : 0;
    const taskTypes = [...new Set(events.map(e => e.taskType))];

    const timestamps = events.map(e => e.timestamp);
    const firstTaskAt = timestamps.length > 0 ? Math.min(...timestamps) : 0;
    const lastTaskAt = timestamps.length > 0 ? Math.max(...timestamps) : 0;

    return {
      agentId,
      totalTasks,
      successCount,
      failureCount,
      successRate: Math.round(successRate * 1000) / 1000,
      averageDuration: Math.round(averageDuration),
      medianDuration,
      p95Duration,
      p99Duration,
      minDuration,
      maxDuration,
      totalCost: Math.round(totalCost * 100) / 100,
      averageCost: Math.round(averageCost * 100) / 100,
      taskTypes,
      firstTaskAt,
      lastTaskAt,
    };
  }

  private computeTaskTypeStats(taskType: string, events: TaskEvent[]): TaskTypeStats {
    const totalTasks = events.length;
    const successCount = events.filter(e => e.status === 'success').length;
    const failureCount = events.filter(e => e.status === 'failure').length;
    const successRate = totalTasks > 0 ? successCount / totalTasks : 0;

    const durations = events.map(e => e.duration);
    const averageDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
    const medianDuration = this.computeMedian(durations);
    const totalCost = events.reduce((sum, e) => sum + e.cost, 0);

    const agentIds = [...new Set(events.map(e => e.agentId))];

    // Top agents for this task type
    const topAgents = agentIds.map(agentId => {
      const agentEvents = events.filter(e => e.agentId === agentId);
      const agentSuccess = agentEvents.filter(e => e.status === 'success').length;
      const sr = agentEvents.length > 0 ? agentSuccess / agentEvents.length : 0;
      const agentDurations = agentEvents.map(e => e.duration);
      const avgDur = agentDurations.length > 0
        ? agentDurations.reduce((a, b) => a + b, 0) / agentDurations.length
        : 0;
      return {
        agentId,
        successRate: Math.round(sr * 1000) / 1000,
        avgDuration: Math.round(avgDur),
      };
    }).sort((a, b) => b.successRate - a.successRate || a.avgDuration - b.avgDuration);

    return {
      taskType,
      totalTasks,
      successCount,
      failureCount,
      successRate: Math.round(successRate * 1000) / 1000,
      averageDuration: Math.round(averageDuration),
      medianDuration,
      totalCost: Math.round(totalCost * 100) / 100,
      agentCount: agentIds.length,
      topAgents: topAgents.slice(0, 5),
    };
  }

  private computeSpecializationScore(
    agentId: string,
    taskType: string,
    events: TaskEvent[],
  ): SpecializationScore {
    const taskCount = events.length;
    const successCount = events.filter(e => e.status === 'success').length;
    const successRate = taskCount > 0 ? successCount / taskCount : 0;

    const successDurations = events
      .filter(e => e.status === 'success')
      .map(e => e.duration);
    const averageDuration = successDurations.length > 0
      ? successDurations.reduce((a, b) => a + b, 0) / successDurations.length
      : 0;

    // Confidence grows with sample size, approaching 1.0 asymptotically
    const confidence = taskCount >= this.config.minTasksForSpecialization
      ? Math.min(1, taskCount / (this.config.minTasksForSpecialization * 5))
      : taskCount / (this.config.minTasksForSpecialization * 5);

    // Compare to mesh-wide performance for this task type
    const allTypeEvents = this.events.filter(e => e.taskType === taskType);
    const meshSuccessRate = allTypeEvents.length > 0
      ? allTypeEvents.filter(e => e.status === 'success').length / allTypeEvents.length
      : 0;
    const meshSuccessDurations = allTypeEvents
      .filter(e => e.status === 'success')
      .map(e => e.duration);
    const meshAvgDuration = meshSuccessDurations.length > 0
      ? meshSuccessDurations.reduce((a, b) => a + b, 0) / meshSuccessDurations.length
      : 1;

    // Score is relative: how much better than average is this agent at this task type?
    // Success rate advantage (0-0.5) + speed advantage (0-0.5)
    const successAdvantage = meshSuccessRate > 0
      ? Math.min(0.5, (successRate / meshSuccessRate) * 0.25)
      : successRate * 0.5;
    const speedAdvantage = averageDuration > 0 && meshAvgDuration > 0
      ? Math.min(0.5, (meshAvgDuration / averageDuration) * 0.25)
      : 0;

    const score = Math.min(1, Math.max(0, successAdvantage + speedAdvantage));

    return {
      agentId,
      taskType,
      score: Math.round(score * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      successRate: Math.round(successRate * 1000) / 1000,
      averageDuration: Math.round(averageDuration),
      taskCount,
    };
  }

  private computeAgentCompositeScore(stats: AgentStats): number {
    // Composite score: 50% success rate + 30% inverse normalized duration + 20% volume bonus
    const successComponent = stats.successRate * 0.5;
    // Normalize duration: lower is better, cap at 10 seconds
    const durationNorm = stats.averageDuration > 0
      ? Math.max(0, 1 - stats.averageDuration / 10000)
      : 0.5;
    const durationComponent = durationNorm * 0.3;
    // Volume bonus: more tasks = more reliable data
    const volumeBonus = Math.min(1, stats.totalTasks / 20) * 0.2;

    return successComponent + durationComponent + volumeBonus;
  }

  private computeTrend(
    entityId: string,
    entityType: TrendAnalysis['entityType'],
    metric: TrendAnalysis['metric'],
    events: TaskEvent[],
    windowMs: number,
  ): TrendAnalysis {
    if (events.length < this.config.minDataPointsForTrend) {
      return {
        entityId,
        entityType,
        metric,
        direction: TrendDirection.INSUFFICIENT_DATA,
        changePercent: 0,
        windowStart: 0,
        windowEnd: 0,
        dataPoints: events.length,
        values: [],
        movingAverage: [],
      };
    }

    // Sort events by timestamp
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const windowStart = sorted[0]!.timestamp;
    const windowEnd = sorted[sorted.length - 1]!.timestamp;
    const totalSpan = windowEnd - windowStart;

    // Divide into buckets
    const bucketCount = Math.min(this.config.trendBuckets, events.length);
    const bucketSize = totalSpan > 0 ? totalSpan / bucketCount : 1;

    const values: Array<{ timestamp: number; value: number }> = [];

    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = windowStart + i * bucketSize;
      const bucketEnd = bucketStart + bucketSize;
      const bucketEvents = sorted.filter(
        e => e.timestamp >= bucketStart && (i === bucketCount - 1 ? e.timestamp <= bucketEnd : e.timestamp < bucketEnd)
      );

      if (bucketEvents.length === 0) {
        // If bucket is empty, skip it to avoid polluting the trend
        continue;
      }

      const value = this.computeMetricValue(metric, bucketEvents);
      values.push({
        timestamp: Math.round(bucketStart + bucketSize / 2),
        value: Math.round(value * 1000) / 1000,
      });
    }

    // Compute moving average (simple 3-point)
    const movingAverage = this.computeMovingAverage(values.map(v => v.value), Math.min(3, values.length));

    // Determine trend direction using linear regression
    const direction = this.determineTrendDirection(values.map(v => v.value));
    const changePercent = values.length >= 2
      ? this.computeChangePercent(values[0]!.value, values[values.length - 1]!.value)
      : 0;

    return {
      entityId,
      entityType,
      metric,
      direction,
      changePercent: Math.round(changePercent * 10) / 10,
      windowStart,
      windowEnd,
      dataPoints: events.length,
      values,
      movingAverage,
    };
  }

  private computeMetricValue(metric: TrendAnalysis['metric'], events: TaskEvent[]): number {
    switch (metric) {
      case 'success_rate': {
        const successes = events.filter(e => e.status === 'success').length;
        return events.length > 0 ? successes / events.length : 0;
      }
      case 'duration': {
        const durations = events.map(e => e.duration);
        return durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0;
      }
      case 'cost': {
        return events.reduce((sum, e) => sum + e.cost, 0) / Math.max(events.length, 1);
      }
      case 'throughput': {
        return events.length;
      }
      default:
        return 0;
    }
  }

  private determineTrendDirection(values: number[]): TrendDirection {
    if (values.length < this.config.minDataPointsForTrend) {
      return TrendDirection.INSUFFICIENT_DATA;
    }

    // Simple linear regression slope
    const n = values.length;
    const indices = values.map((_, i) => i);
    const sumX = indices.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = indices.reduce((sum, x, i) => sum + x * values[i]!, 0);
    const sumX2 = indices.reduce((sum, x) => sum + x * x, 0);

    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) return TrendDirection.STABLE;

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const meanY = sumY / n;

    // Normalized slope: relative to the mean value
    const normalizedSlope = meanY !== 0 ? slope / meanY : slope;

    // Threshold: 5% change per bucket is considered meaningful
    if (normalizedSlope > 0.05) return TrendDirection.IMPROVING;
    if (normalizedSlope < -0.05) return TrendDirection.DEGRADING;
    return TrendDirection.STABLE;
  }

  private computeMovingAverage(values: number[], windowSize: number): number[] {
    if (values.length === 0 || windowSize <= 0) return [];

    const result: number[] = [];
    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const windowValues = values.slice(start, i + 1);
      const avg = windowValues.reduce((a, b) => a + b, 0) / windowValues.length;
      result.push(Math.round(avg * 1000) / 1000);
    }
    return result;
  }

  private computeChangePercent(first: number, last: number): number {
    if (first === 0 && last === 0) return 0;
    if (first === 0) return last > 0 ? 100 : -100;
    return ((last - first) / Math.abs(first)) * 100;
  }

  private computeMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
    }
    return sorted[mid]!;
  }

  private computePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)]!;
  }
}
