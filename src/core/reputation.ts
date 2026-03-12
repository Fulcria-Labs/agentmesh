/**
 * Agent Reputation System
 *
 * Tracks agent performance metrics to enable trust-based task allocation.
 * Reputation scores are computed from historical task execution data and
 * influence bid selection in the TaskCoordinator.
 */

import { EventEmitter } from 'events';

export interface ReputationRecord {
  agentId: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalExecutionTime: number;
  totalCost: number;
  lastUpdated: number;
}

export interface ReputationScore {
  agentId: string;
  overallScore: number; // 0-1
  successRate: number;  // 0-1
  avgExecutionTime: number; // ms
  avgCost: number;
  reliability: number;  // 0-1 (based on consistency)
  taskCount: number;
}

export class ReputationManager extends EventEmitter {
  private records: Map<string, ReputationRecord> = new Map();
  private executionTimes: Map<string, number[]> = new Map();

  /**
   * Record a successful task completion
   */
  recordSuccess(agentId: string, executionTime: number, cost: number): void {
    const record = this.getOrCreateRecord(agentId);
    record.totalTasks++;
    record.completedTasks++;
    record.totalExecutionTime += executionTime;
    record.totalCost += cost;
    record.lastUpdated = Date.now();

    const times = this.executionTimes.get(agentId) || [];
    times.push(executionTime);
    this.executionTimes.set(agentId, times);

    this.emit('reputation:updated', this.getScore(agentId));
  }

  /**
   * Record a failed task
   */
  recordFailure(agentId: string): void {
    const record = this.getOrCreateRecord(agentId);
    record.totalTasks++;
    record.failedTasks++;
    record.lastUpdated = Date.now();

    this.emit('reputation:updated', this.getScore(agentId));
  }

  /**
   * Get the reputation score for an agent
   */
  getScore(agentId: string): ReputationScore {
    const record = this.records.get(agentId);

    if (!record || record.totalTasks === 0) {
      return {
        agentId,
        overallScore: 0.5, // Neutral score for new agents
        successRate: 0,
        avgExecutionTime: 0,
        avgCost: 0,
        reliability: 0.5,
        taskCount: 0,
      };
    }

    const successRate = record.completedTasks / record.totalTasks;
    const avgExecutionTime = record.completedTasks > 0
      ? record.totalExecutionTime / record.completedTasks
      : 0;
    const avgCost = record.completedTasks > 0
      ? record.totalCost / record.completedTasks
      : 0;

    // Reliability based on consistency of execution times
    const reliability = this.calculateReliability(agentId);

    // Overall score: weighted combination
    // 50% success rate + 30% reliability + 20% experience bonus
    const experienceBonus = Math.min(record.totalTasks / 20, 1); // Maxes at 20 tasks
    const overallScore = (successRate * 0.5) + (reliability * 0.3) + (experienceBonus * 0.2);

    return {
      agentId,
      overallScore: Math.round(overallScore * 1000) / 1000,
      successRate: Math.round(successRate * 1000) / 1000,
      avgExecutionTime: Math.round(avgExecutionTime),
      avgCost: Math.round(avgCost * 100) / 100,
      reliability: Math.round(reliability * 1000) / 1000,
      taskCount: record.totalTasks,
    };
  }

  /**
   * Get scores for all tracked agents, sorted by overall score (descending)
   */
  getAllScores(): ReputationScore[] {
    return Array.from(this.records.keys())
      .map(id => this.getScore(id))
      .sort((a, b) => b.overallScore - a.overallScore);
  }

  /**
   * Get the raw reputation record for an agent
   */
  getRecord(agentId: string): ReputationRecord | undefined {
    return this.records.get(agentId);
  }

  /**
   * Apply reputation-weighted scoring to a bid
   * Returns adjusted bid score that factors in agent reputation
   */
  getReputationAdjustedBidScore(
    agentId: string,
    confidence: number,
    estimatedCost: number,
  ): number {
    const reputation = this.getScore(agentId);
    // Base score from confidence and cost
    const baseScore = confidence / (estimatedCost + 1);
    // Reputation multiplier: 0.5x to 1.5x based on overall score
    const reputationMultiplier = 0.5 + reputation.overallScore;
    return baseScore * reputationMultiplier;
  }

  /**
   * Reset reputation for an agent
   */
  reset(agentId: string): void {
    this.records.delete(agentId);
    this.executionTimes.delete(agentId);
  }

  /**
   * Get the number of tracked agents
   */
  getTrackedAgentCount(): number {
    return this.records.size;
  }

  private getOrCreateRecord(agentId: string): ReputationRecord {
    let record = this.records.get(agentId);
    if (!record) {
      record = {
        agentId,
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        totalExecutionTime: 0,
        totalCost: 0,
        lastUpdated: Date.now(),
      };
      this.records.set(agentId, record);
    }
    return record;
  }

  /**
   * Calculate reliability score based on consistency of execution times
   * Low coefficient of variation = high reliability
   */
  private calculateReliability(agentId: string): number {
    const times = this.executionTimes.get(agentId);
    if (!times || times.length < 2) return 0.5; // Neutral for insufficient data

    const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
    if (mean === 0) return 0.5;

    const variance = times.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / times.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean; // Coefficient of variation

    // CV of 0 = perfect reliability (1.0), CV >= 1 = unreliable (0.0)
    return Math.max(0, Math.min(1, 1 - cv));
  }
}
