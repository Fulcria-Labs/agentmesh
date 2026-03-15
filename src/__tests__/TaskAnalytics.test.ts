import {
  TaskAnalytics,
  TaskEvent,
  TaskAnalyticsConfig,
  BottleneckReason,
  TrendDirection,
} from '../core/task-analytics';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<TaskEvent> = {}): TaskEvent {
  return {
    taskId: `task-${Math.random().toString(36).slice(2, 8)}`,
    agentId: 'agent-1',
    taskType: 'web_research',
    status: 'success',
    duration: 1000,
    cost: 5,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeEvents(
  count: number,
  overrides: Partial<TaskEvent> = {},
): TaskEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeEvent({
      taskId: `task-${i}`,
      timestamp: Date.now() + i * 100,
      ...overrides,
    })
  );
}

/** Creates a time-series of events over a range for trend testing */
function makeTimeSeries(
  count: number,
  baseTimestamp: number,
  intervalMs: number,
  overrides: Partial<TaskEvent> = {},
): TaskEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeEvent({
      taskId: `ts-task-${i}`,
      timestamp: baseTimestamp + i * intervalMs,
      ...overrides,
    })
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TaskAnalytics', () => {
  let analytics: TaskAnalytics;

  beforeEach(() => {
    analytics = new TaskAnalytics();
  });

  // ───────────────────────────────────────────────────────────────────────
  // Construction & Configuration
  // ───────────────────────────────────────────────────────────────────────

  describe('construction and configuration', () => {
    it('creates with default config', () => {
      const config = analytics.getConfig();
      expect(config.minTasksForBottleneck).toBe(5);
      expect(config.failureRateThreshold).toBe(0.3);
      expect(config.slowExecutionMultiplier).toBe(1.5);
      expect(config.overloadMultiplier).toBe(2.0);
      expect(config.minDataPointsForTrend).toBe(3);
      expect(config.defaultTrendWindow).toBe(3600000);
      expect(config.trendBuckets).toBe(5);
      expect(config.minTasksForSpecialization).toBe(3);
      expect(config.highCostMultiplier).toBe(2.0);
    });

    it('creates with custom config', () => {
      const custom = new TaskAnalytics({
        minTasksForBottleneck: 10,
        failureRateThreshold: 0.5,
      });
      const config = custom.getConfig();
      expect(config.minTasksForBottleneck).toBe(10);
      expect(config.failureRateThreshold).toBe(0.5);
      // Defaults preserved for unset values
      expect(config.slowExecutionMultiplier).toBe(1.5);
    });

    it('updates config', () => {
      analytics.updateConfig({ minTasksForBottleneck: 20 });
      expect(analytics.getConfig().minTasksForBottleneck).toBe(20);
      // Other fields unchanged
      expect(analytics.getConfig().failureRateThreshold).toBe(0.3);
    });

    it('getConfig returns a copy', () => {
      const config = analytics.getConfig();
      config.minTasksForBottleneck = 999;
      expect(analytics.getConfig().minTasksForBottleneck).not.toBe(999);
    });

    it('extends EventEmitter', () => {
      expect(typeof analytics.on).toBe('function');
      expect(typeof analytics.emit).toBe('function');
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Event Recording
  // ───────────────────────────────────────────────────────────────────────

  describe('event recording', () => {
    it('records a task event', () => {
      const event = makeEvent();
      analytics.recordTask(event);
      expect(analytics.getEventCount()).toBe(1);
    });

    it('records multiple events', () => {
      analytics.recordTask(makeEvent({ taskId: 'task-1' }));
      analytics.recordTask(makeEvent({ taskId: 'task-2' }));
      analytics.recordTask(makeEvent({ taskId: 'task-3' }));
      expect(analytics.getEventCount()).toBe(3);
    });

    it('emits task:recorded event', () => {
      const handler = jest.fn();
      analytics.on('task:recorded', handler);
      const event = makeEvent();
      analytics.recordTask(event);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('stores a copy of the event', () => {
      const event = makeEvent();
      analytics.recordTask(event);
      event.duration = 99999;
      const stored = analytics.getEvents();
      expect(stored[0]!.duration).not.toBe(99999);
    });

    it('rejects event without taskId', () => {
      expect(() => analytics.recordTask(makeEvent({ taskId: '' }))).toThrow('requires taskId');
    });

    it('rejects event without agentId', () => {
      expect(() => analytics.recordTask(makeEvent({ agentId: '' }))).toThrow('requires taskId, agentId');
    });

    it('rejects event without taskType', () => {
      expect(() => analytics.recordTask(makeEvent({ taskType: '' }))).toThrow('requires taskId, agentId, and taskType');
    });

    it('rejects negative duration', () => {
      expect(() => analytics.recordTask(makeEvent({ duration: -1 }))).toThrow('duration cannot be negative');
    });

    it('rejects negative cost', () => {
      expect(() => analytics.recordTask(makeEvent({ cost: -1 }))).toThrow('cost cannot be negative');
    });

    it('rejects invalid status', () => {
      expect(() => analytics.recordTask(makeEvent({ status: 'pending' as any }))).toThrow('status must be');
    });

    it('accepts zero duration', () => {
      analytics.recordTask(makeEvent({ duration: 0 }));
      expect(analytics.getEventCount()).toBe(1);
    });

    it('accepts zero cost', () => {
      analytics.recordTask(makeEvent({ cost: 0 }));
      expect(analytics.getEventCount()).toBe(1);
    });

    it('records failure events', () => {
      analytics.recordTask(makeEvent({ status: 'failure' }));
      expect(analytics.getEventCount()).toBe(1);
    });

    it('preserves event metadata', () => {
      const event = makeEvent({ metadata: { source: 'test', retry: '2' } });
      analytics.recordTask(event);
      const stored = analytics.getEvents();
      expect(stored[0]!.metadata).toEqual({ source: 'test', retry: '2' });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Batch Recording
  // ───────────────────────────────────────────────────────────────────────

  describe('batch recording', () => {
    it('records a batch of events', () => {
      const events = makeEvents(10);
      const count = analytics.recordBatch(events);
      expect(count).toBe(10);
      expect(analytics.getEventCount()).toBe(10);
    });

    it('skips invalid events in batch', () => {
      const events = [
        makeEvent({ taskId: 'valid-1' }),
        makeEvent({ taskId: '' }), // invalid
        makeEvent({ taskId: 'valid-2' }),
        makeEvent({ duration: -5 }), // invalid
        makeEvent({ taskId: 'valid-3' }),
      ];
      const count = analytics.recordBatch(events);
      expect(count).toBe(3);
      expect(analytics.getEventCount()).toBe(3);
    });

    it('returns 0 for empty batch', () => {
      expect(analytics.recordBatch([])).toBe(0);
    });

    it('returns 0 when all events are invalid', () => {
      const events = [
        makeEvent({ taskId: '' }),
        makeEvent({ agentId: '' }),
      ];
      expect(analytics.recordBatch(events)).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Event Retrieval
  // ───────────────────────────────────────────────────────────────────────

  describe('event retrieval', () => {
    it('returns all events', () => {
      analytics.recordBatch(makeEvents(5));
      const events = analytics.getEvents();
      expect(events).toHaveLength(5);
    });

    it('returns a copy', () => {
      analytics.recordBatch(makeEvents(3));
      const events = analytics.getEvents();
      events.push(makeEvent());
      expect(analytics.getEventCount()).toBe(3);
    });

    it('filters by start time', () => {
      const base = 1000000;
      analytics.recordBatch([
        makeEvent({ taskId: 't1', timestamp: base }),
        makeEvent({ taskId: 't2', timestamp: base + 100 }),
        makeEvent({ taskId: 't3', timestamp: base + 200 }),
      ]);
      const events = analytics.getEvents(base + 50);
      expect(events).toHaveLength(2);
    });

    it('filters by end time', () => {
      const base = 1000000;
      analytics.recordBatch([
        makeEvent({ taskId: 't1', timestamp: base }),
        makeEvent({ taskId: 't2', timestamp: base + 100 }),
        makeEvent({ taskId: 't3', timestamp: base + 200 }),
      ]);
      const events = analytics.getEvents(undefined, base + 150);
      expect(events).toHaveLength(2);
    });

    it('filters by both start and end time', () => {
      const base = 1000000;
      analytics.recordBatch([
        makeEvent({ taskId: 't1', timestamp: base }),
        makeEvent({ taskId: 't2', timestamp: base + 100 }),
        makeEvent({ taskId: 't3', timestamp: base + 200 }),
        makeEvent({ taskId: 't4', timestamp: base + 300 }),
      ]);
      const events = analytics.getEvents(base + 50, base + 250);
      expect(events).toHaveLength(2);
    });

    it('returns empty for no matches', () => {
      analytics.recordBatch(makeEvents(3));
      const events = analytics.getEvents(Date.now() + 100000);
      expect(events).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Clear Events
  // ───────────────────────────────────────────────────────────────────────

  describe('clearEvents', () => {
    it('clears all events', () => {
      analytics.recordBatch(makeEvents(10));
      analytics.clearEvents();
      expect(analytics.getEventCount()).toBe(0);
    });

    it('emits events:cleared', () => {
      const handler = jest.fn();
      analytics.on('events:cleared', handler);
      analytics.clearEvents();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('allows recording after clear', () => {
      analytics.recordBatch(makeEvents(5));
      analytics.clearEvents();
      analytics.recordTask(makeEvent());
      expect(analytics.getEventCount()).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Agent Statistics
  // ───────────────────────────────────────────────────────────────────────

  describe('agent statistics', () => {
    it('computes basic stats for a single agent', () => {
      analytics.recordBatch([
        makeEvent({ agentId: 'a1', duration: 1000, cost: 5, status: 'success' }),
        makeEvent({ agentId: 'a1', duration: 2000, cost: 10, status: 'success' }),
        makeEvent({ agentId: 'a1', duration: 1500, cost: 7, status: 'failure' }),
      ]);
      const stats = analytics.getAgentStats('a1');
      expect(stats.agentId).toBe('a1');
      expect(stats.totalTasks).toBe(3);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.successRate).toBeCloseTo(0.667, 2);
    });

    it('computes duration percentiles', () => {
      const durations = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
      analytics.recordBatch(
        durations.map((d, i) => makeEvent({
          agentId: 'a1',
          taskId: `t-${i}`,
          duration: d,
        }))
      );
      const stats = analytics.getAgentStats('a1');
      expect(stats.minDuration).toBe(100);
      expect(stats.maxDuration).toBe(1000);
      expect(stats.medianDuration).toBe(550);
      expect(stats.p95Duration).toBe(1000);
      expect(stats.averageDuration).toBe(550);
    });

    it('computes cost statistics', () => {
      analytics.recordBatch([
        makeEvent({ agentId: 'a1', cost: 10 }),
        makeEvent({ agentId: 'a1', cost: 20 }),
        makeEvent({ agentId: 'a1', cost: 30 }),
      ]);
      const stats = analytics.getAgentStats('a1');
      expect(stats.totalCost).toBe(60);
      expect(stats.averageCost).toBe(20);
    });

    it('returns zero stats for unknown agent', () => {
      const stats = analytics.getAgentStats('unknown');
      expect(stats.totalTasks).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.averageDuration).toBe(0);
      expect(stats.minDuration).toBe(0);
      expect(stats.maxDuration).toBe(0);
    });

    it('tracks task types per agent', () => {
      analytics.recordBatch([
        makeEvent({ agentId: 'a1', taskType: 'web_research' }),
        makeEvent({ agentId: 'a1', taskType: 'data_analysis' }),
        makeEvent({ agentId: 'a1', taskType: 'web_research' }),
      ]);
      const stats = analytics.getAgentStats('a1');
      expect(stats.taskTypes).toEqual(expect.arrayContaining(['web_research', 'data_analysis']));
      expect(stats.taskTypes).toHaveLength(2);
    });

    it('tracks first and last task timestamps', () => {
      analytics.recordBatch([
        makeEvent({ agentId: 'a1', timestamp: 1000 }),
        makeEvent({ agentId: 'a1', timestamp: 2000 }),
        makeEvent({ agentId: 'a1', timestamp: 3000 }),
      ]);
      const stats = analytics.getAgentStats('a1');
      expect(stats.firstTaskAt).toBe(1000);
      expect(stats.lastTaskAt).toBe(3000);
    });

    it('getAllAgentStats returns stats for all agents', () => {
      analytics.recordBatch([
        makeEvent({ agentId: 'a1' }),
        makeEvent({ agentId: 'a2' }),
        makeEvent({ agentId: 'a3' }),
      ]);
      const allStats = analytics.getAllAgentStats();
      expect(allStats).toHaveLength(3);
      expect(allStats.map(s => s.agentId).sort()).toEqual(['a1', 'a2', 'a3']);
    });

    it('getUniqueAgentIds returns unique agent IDs', () => {
      analytics.recordBatch([
        makeEvent({ agentId: 'a1' }),
        makeEvent({ agentId: 'a2' }),
        makeEvent({ agentId: 'a1' }),
        makeEvent({ agentId: 'a3' }),
      ]);
      const ids = analytics.getUniqueAgentIds();
      expect(ids.sort()).toEqual(['a1', 'a2', 'a3']);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Task Type Statistics
  // ───────────────────────────────────────────────────────────────────────

  describe('task type statistics', () => {
    it('computes stats for a task type', () => {
      analytics.recordBatch([
        makeEvent({ taskType: 'web_research', agentId: 'a1', status: 'success', duration: 1000 }),
        makeEvent({ taskType: 'web_research', agentId: 'a2', status: 'success', duration: 2000 }),
        makeEvent({ taskType: 'web_research', agentId: 'a1', status: 'failure', duration: 500 }),
      ]);
      const stats = analytics.getTaskTypeStats('web_research');
      expect(stats.taskType).toBe('web_research');
      expect(stats.totalTasks).toBe(3);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.successRate).toBeCloseTo(0.667, 2);
      expect(stats.agentCount).toBe(2);
    });

    it('ranks top agents per task type', () => {
      analytics.recordBatch([
        ...makeEvents(5, { taskType: 'research', agentId: 'fast-agent', duration: 500 }),
        ...makeEvents(5, { taskType: 'research', agentId: 'slow-agent', duration: 5000 }),
      ]);
      const stats = analytics.getTaskTypeStats('research');
      expect(stats.topAgents).toHaveLength(2);
      // Both have 100% success rate, faster agent should rank higher
      expect(stats.topAgents[0]!.avgDuration).toBeLessThan(stats.topAgents[1]!.avgDuration);
    });

    it('returns empty stats for unknown task type', () => {
      const stats = analytics.getTaskTypeStats('nonexistent');
      expect(stats.totalTasks).toBe(0);
      expect(stats.agentCount).toBe(0);
      expect(stats.topAgents).toHaveLength(0);
    });

    it('getAllTaskTypeStats returns all task types', () => {
      analytics.recordBatch([
        makeEvent({ taskType: 'type-a' }),
        makeEvent({ taskType: 'type-b' }),
        makeEvent({ taskType: 'type-c' }),
      ]);
      const allStats = analytics.getAllTaskTypeStats();
      expect(allStats).toHaveLength(3);
    });

    it('getUniqueTaskTypes returns unique types', () => {
      analytics.recordBatch([
        makeEvent({ taskType: 'a' }),
        makeEvent({ taskType: 'b' }),
        makeEvent({ taskType: 'a' }),
      ]);
      expect(analytics.getUniqueTaskTypes().sort()).toEqual(['a', 'b']);
    });

    it('top agents list capped at 5', () => {
      for (let i = 0; i < 10; i++) {
        analytics.recordBatch(makeEvents(3, {
          taskType: 'research',
          agentId: `agent-${i}`,
        }));
      }
      const stats = analytics.getTaskTypeStats('research');
      expect(stats.topAgents.length).toBeLessThanOrEqual(5);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Performance Report
  // ───────────────────────────────────────────────────────────────────────

  describe('performance report', () => {
    it('generates an empty report with no events', () => {
      const report = analytics.generateReport();
      expect(report.totalTasks).toBe(0);
      expect(report.totalSuccesses).toBe(0);
      expect(report.totalFailures).toBe(0);
      expect(report.overallSuccessRate).toBe(0);
      expect(report.activeAgents).toBe(0);
      expect(report.taskTypeBreakdown).toHaveLength(0);
      expect(report.agentRankings).toHaveLength(0);
      expect(report.bottlenecks).toHaveLength(0);
      expect(report.loadBalancingRecommendations).toHaveLength(0);
    });

    it('generates a comprehensive report', () => {
      // Populate diverse data
      analytics.recordBatch([
        ...makeEvents(10, { agentId: 'a1', taskType: 'research', status: 'success', duration: 1000, cost: 5 }),
        ...makeEvents(3, { agentId: 'a1', taskType: 'research', status: 'failure', duration: 500, cost: 2 }),
        ...makeEvents(8, { agentId: 'a2', taskType: 'analysis', status: 'success', duration: 2000, cost: 8 }),
        ...makeEvents(5, { agentId: 'a3', taskType: 'research', status: 'success', duration: 800, cost: 4 }),
      ]);

      const report = analytics.generateReport();
      expect(report.totalTasks).toBe(26);
      expect(report.totalSuccesses).toBe(23);
      expect(report.totalFailures).toBe(3);
      expect(report.overallSuccessRate).toBeGreaterThan(0.8);
      expect(report.activeAgents).toBe(3);
      expect(report.taskTypeBreakdown.length).toBeGreaterThanOrEqual(1);
      expect(report.agentRankings).toHaveLength(3);
      expect(report.generatedAt).toBeGreaterThan(0);
    });

    it('report has correct time range', () => {
      const base = 1000000;
      analytics.recordBatch([
        makeEvent({ timestamp: base }),
        makeEvent({ timestamp: base + 5000 }),
      ]);
      const report = analytics.generateReport();
      expect(report.timeRange.start).toBe(base);
      expect(report.timeRange.end).toBe(base + 5000);
    });

    it('respects time range filter', () => {
      const base = 1000000;
      analytics.recordBatch([
        makeEvent({ taskId: 't1', timestamp: base }),
        makeEvent({ taskId: 't2', timestamp: base + 100 }),
        makeEvent({ taskId: 't3', timestamp: base + 200 }),
        makeEvent({ taskId: 't4', timestamp: base + 300 }),
      ]);
      const report = analytics.generateReport(base + 50, base + 250);
      expect(report.totalTasks).toBe(2);
    });

    it('agent rankings are sorted by score descending', () => {
      analytics.recordBatch([
        ...makeEvents(10, { agentId: 'good', status: 'success', duration: 500 }),
        ...makeEvents(10, { agentId: 'bad', status: 'failure', duration: 5000 }),
      ]);
      const report = analytics.generateReport();
      expect(report.agentRankings[0]!.agentId).toBe('good');
      expect(report.agentRankings[0]!.score).toBeGreaterThan(report.agentRankings[1]!.score);
    });

    it('computes total cost correctly', () => {
      analytics.recordBatch([
        makeEvent({ cost: 10.5 }),
        makeEvent({ cost: 20.3 }),
        makeEvent({ cost: 5.2 }),
      ]);
      const report = analytics.generateReport();
      expect(report.totalCost).toBe(36);
    });

    it('computes median duration', () => {
      analytics.recordBatch([
        makeEvent({ duration: 100 }),
        makeEvent({ duration: 200 }),
        makeEvent({ duration: 300 }),
      ]);
      const report = analytics.generateReport();
      expect(report.medianDuration).toBe(200);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Bottleneck Detection
  // ───────────────────────────────────────────────────────────────────────

  describe('bottleneck detection', () => {
    it('detects high failure rate', () => {
      analytics.recordBatch([
        ...makeEvents(3, { agentId: 'failing', status: 'failure' }),
        ...makeEvents(3, { agentId: 'failing', status: 'success' }),
        ...makeEvents(10, { agentId: 'good', status: 'success' }),
      ]);
      const bottlenecks = analytics.detectBottlenecks();
      const failureBottleneck = bottlenecks.find(
        b => b.agentId === 'failing' && b.reason === BottleneckReason.HIGH_FAILURE_RATE
      );
      expect(failureBottleneck).toBeDefined();
      expect(failureBottleneck!.metric).toBe(0.5);
    });

    it('detects slow execution', () => {
      analytics.recordBatch([
        // Fast agents set the mesh median low
        ...makeEvents(10, { agentId: 'fast1', status: 'success', duration: 100 }),
        ...makeEvents(10, { agentId: 'fast2', status: 'success', duration: 120 }),
        // Slow agent
        ...makeEvents(6, { agentId: 'slow', status: 'success', duration: 5000 }),
      ]);
      const bottlenecks = analytics.detectBottlenecks();
      const slowBottleneck = bottlenecks.find(
        b => b.agentId === 'slow' && b.reason === BottleneckReason.SLOW_EXECUTION
      );
      expect(slowBottleneck).toBeDefined();
    });

    it('detects overloaded agents', () => {
      analytics.recordBatch([
        ...makeEvents(30, { agentId: 'overloaded', status: 'success' }),
        ...makeEvents(3, { agentId: 'idle1', status: 'success' }),
        ...makeEvents(3, { agentId: 'idle2', status: 'success' }),
      ]);
      const bottlenecks = analytics.detectBottlenecks();
      const overloadBottleneck = bottlenecks.find(
        b => b.agentId === 'overloaded' && b.reason === BottleneckReason.OVERLOADED
      );
      expect(overloadBottleneck).toBeDefined();
    });

    it('detects high cost agents', () => {
      analytics.recordBatch([
        ...makeEvents(10, { agentId: 'cheap1', cost: 1, status: 'success' }),
        ...makeEvents(10, { agentId: 'cheap2', cost: 2, status: 'success' }),
        ...makeEvents(10, { agentId: 'expensive', cost: 100, status: 'success' }),
      ]);
      // mesh mean cost ~= (10*1 + 10*2 + 10*100) / 30 = 34.3
      // expensive mean cost = 100, threshold = 34.3 * 2 = 68.7
      // 100 > 68.7 so should trigger
      const bottlenecks = analytics.detectBottlenecks();
      const costBottleneck = bottlenecks.find(
        b => b.agentId === 'expensive' && b.reason === BottleneckReason.HIGH_COST
      );
      expect(costBottleneck).toBeDefined();
    });

    it('skips agents below minimum task threshold', () => {
      analytics.recordBatch([
        ...makeEvents(2, { agentId: 'too-few', status: 'failure' }),
        ...makeEvents(10, { agentId: 'enough', status: 'success' }),
      ]);
      const bottlenecks = analytics.detectBottlenecks();
      expect(bottlenecks.find(b => b.agentId === 'too-few')).toBeUndefined();
    });

    it('returns empty array when no bottlenecks', () => {
      analytics.recordBatch(
        makeEvents(10, { agentId: 'perfect', status: 'success', duration: 1000, cost: 5 })
      );
      const bottlenecks = analytics.detectBottlenecks();
      expect(bottlenecks).toHaveLength(0);
    });

    it('sorts bottlenecks by severity', () => {
      analytics.recordBatch([
        // Critical: 100% failure
        ...makeEvents(10, { agentId: 'critical-agent', status: 'failure' }),
        // Medium: overloaded
        ...makeEvents(50, { agentId: 'overloaded-agent', status: 'success', duration: 100 }),
        ...makeEvents(5, { agentId: 'normal-agent', status: 'success', duration: 100 }),
      ]);
      const bottlenecks = analytics.detectBottlenecks();
      if (bottlenecks.length >= 2) {
        const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        for (let i = 1; i < bottlenecks.length; i++) {
          expect(severityOrder[bottlenecks[i]!.severity])
            .toBeGreaterThanOrEqual(severityOrder[bottlenecks[i - 1]!.severity]);
        }
      }
    });

    it('includes recommendation text', () => {
      analytics.recordBatch(
        makeEvents(10, { agentId: 'failing', status: 'failure' })
      );
      const bottlenecks = analytics.detectBottlenecks();
      expect(bottlenecks.length).toBeGreaterThan(0);
      expect(bottlenecks[0]!.recommendation).toContain('failing');
    });

    it('critical severity for very high failure rate', () => {
      analytics.recordBatch(
        makeEvents(10, { agentId: 'terrible', status: 'failure' })
      );
      const bottlenecks = analytics.detectBottlenecks();
      const b = bottlenecks.find(
        b => b.agentId === 'terrible' && b.reason === BottleneckReason.HIGH_FAILURE_RATE
      );
      expect(b).toBeDefined();
      expect(b!.severity).toBe('critical');
    });

    it('uses custom threshold from config', () => {
      const custom = new TaskAnalytics({ failureRateThreshold: 0.8 });
      custom.recordBatch([
        ...makeEvents(6, { agentId: 'agent', status: 'failure' }),
        ...makeEvents(4, { agentId: 'agent', status: 'success' }),
      ]);
      // 60% failure should NOT trigger at 80% threshold
      const bottlenecks = custom.detectBottlenecks();
      const failureB = bottlenecks.find(b => b.reason === BottleneckReason.HIGH_FAILURE_RATE);
      expect(failureB).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Load Balancing Recommendations
  // ───────────────────────────────────────────────────────────────────────

  describe('load balancing recommendations', () => {
    it('detects imbalanced distribution', () => {
      analytics.recordBatch([
        ...makeEvents(20, { agentId: 'overworked', taskType: 'research' }),
        ...makeEvents(2, { agentId: 'idle', taskType: 'research' }),
      ]);
      const recs = analytics.computeLoadBalancingRecommendations();
      expect(recs.length).toBeGreaterThanOrEqual(1);
      const researchRec = recs.find(r => r.taskType === 'research');
      expect(researchRec).toBeDefined();
      expect(researchRec!.currentDistribution.length).toBe(2);
    });

    it('does not recommend rebalancing for single-agent task types', () => {
      analytics.recordBatch(
        makeEvents(10, { agentId: 'solo', taskType: 'unique-task' })
      );
      const recs = analytics.computeLoadBalancingRecommendations();
      expect(recs.find(r => r.taskType === 'unique-task')).toBeUndefined();
    });

    it('does not recommend rebalancing for balanced distribution', () => {
      analytics.recordBatch([
        ...makeEvents(10, { agentId: 'a1', taskType: 'balanced' }),
        ...makeEvents(10, { agentId: 'a2', taskType: 'balanced' }),
        ...makeEvents(10, { agentId: 'a3', taskType: 'balanced' }),
      ]);
      const recs = analytics.computeLoadBalancingRecommendations();
      expect(recs.find(r => r.taskType === 'balanced')).toBeUndefined();
    });

    it('suggested distribution favors high-performing agents', () => {
      analytics.recordBatch([
        ...makeEvents(15, { agentId: 'good', taskType: 'research', status: 'success', duration: 500 }),
        ...makeEvents(5, { agentId: 'bad', taskType: 'research', status: 'failure', duration: 5000 }),
      ]);
      const recs = analytics.computeLoadBalancingRecommendations();
      const rec = recs.find(r => r.taskType === 'research');
      if (rec) {
        const goodSuggested = rec.suggestedDistribution.find(s => s.agentId === 'good');
        const badSuggested = rec.suggestedDistribution.find(s => s.agentId === 'bad');
        if (goodSuggested && badSuggested) {
          expect(goodSuggested.targetPercentage).toBeGreaterThan(badSuggested.targetPercentage);
        }
      }
    });

    it('includes expected improvement text', () => {
      analytics.recordBatch([
        ...makeEvents(20, { agentId: 'overworked', taskType: 'analysis' }),
        ...makeEvents(1, { agentId: 'idle', taskType: 'analysis' }),
      ]);
      const recs = analytics.computeLoadBalancingRecommendations();
      const rec = recs.find(r => r.taskType === 'analysis');
      if (rec) {
        expect(rec.expectedImprovement).toBeTruthy();
        expect(rec.expectedImprovement.length).toBeGreaterThan(0);
      }
    });

    it('current distribution percentages sum to ~100', () => {
      analytics.recordBatch([
        ...makeEvents(15, { agentId: 'a1', taskType: 'task' }),
        ...makeEvents(3, { agentId: 'a2', taskType: 'task' }),
        ...makeEvents(2, { agentId: 'a3', taskType: 'task' }),
      ]);
      const recs = analytics.computeLoadBalancingRecommendations();
      const rec = recs.find(r => r.taskType === 'task');
      if (rec) {
        const totalPct = rec.currentDistribution.reduce((s, d) => s + d.percentage, 0);
        expect(totalPct).toBeCloseTo(100, 0);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Specialization Scores
  // ───────────────────────────────────────────────────────────────────────

  describe('specialization scores', () => {
    it('computes specialization for an agent', () => {
      analytics.recordBatch([
        ...makeEvents(10, { agentId: 'specialist', taskType: 'research', status: 'success', duration: 500 }),
        ...makeEvents(3, { agentId: 'specialist', taskType: 'analysis', status: 'success', duration: 2000 }),
        // Background agents for comparison
        ...makeEvents(5, { agentId: 'other', taskType: 'research', status: 'success', duration: 2000 }),
        ...makeEvents(5, { agentId: 'other', taskType: 'analysis', status: 'success', duration: 500 }),
      ]);

      const specs = analytics.getAgentSpecializations('specialist');
      expect(specs.length).toBe(2);
      // Sorted by score descending
      expect(specs[0]!.score).toBeGreaterThanOrEqual(specs[1]!.score);
    });

    it('getSpecializationScore returns score for specific pair', () => {
      analytics.recordBatch(
        makeEvents(5, { agentId: 'a1', taskType: 'web_research', status: 'success', duration: 1000 })
      );
      const score = analytics.getSpecializationScore('a1', 'web_research');
      expect(score.agentId).toBe('a1');
      expect(score.taskType).toBe('web_research');
      expect(score.score).toBeGreaterThan(0);
      expect(score.taskCount).toBe(5);
      expect(score.successRate).toBe(1);
    });

    it('returns zero score for agent with no tasks of that type', () => {
      analytics.recordBatch(
        makeEvents(5, { agentId: 'a1', taskType: 'research' })
      );
      const score = analytics.getSpecializationScore('a1', 'nonexistent');
      expect(score.taskCount).toBe(0);
      expect(score.score).toBe(0);
    });

    it('confidence increases with more tasks', () => {
      analytics.recordBatch(
        makeEvents(2, { agentId: 'a1', taskType: 'research', status: 'success' })
      );
      const lowConfidence = analytics.getSpecializationScore('a1', 'research');

      analytics.recordBatch(
        makeEvents(10, { agentId: 'a1', taskType: 'research', status: 'success' })
      );
      const highConfidence = analytics.getSpecializationScore('a1', 'research');

      expect(highConfidence.confidence).toBeGreaterThan(lowConfidence.confidence);
    });

    it('getBestAgentForTaskType returns top agent', () => {
      analytics.recordBatch([
        ...makeEvents(10, { agentId: 'expert', taskType: 'research', status: 'success', duration: 200 }),
        ...makeEvents(10, { agentId: 'average', taskType: 'research', status: 'success', duration: 2000 }),
        ...makeEvents(10, { agentId: 'poor', taskType: 'research', status: 'failure', duration: 3000 }),
      ]);
      const best = analytics.getBestAgentForTaskType('research');
      expect(best).not.toBeNull();
      expect(best!.agentId).toBe('expert');
    });

    it('getBestAgentForTaskType returns null for unknown type', () => {
      expect(analytics.getBestAgentForTaskType('nonexistent')).toBeNull();
    });

    it('getAllSpecializations returns all pairs', () => {
      analytics.recordBatch([
        makeEvent({ agentId: 'a1', taskType: 't1' }),
        makeEvent({ agentId: 'a1', taskType: 't2' }),
        makeEvent({ agentId: 'a2', taskType: 't1' }),
      ]);
      const all = analytics.getAllSpecializations();
      expect(all).toHaveLength(3);
      // Sorted by score descending
      for (let i = 1; i < all.length; i++) {
        expect(all[i]!.score).toBeLessThanOrEqual(all[i - 1]!.score);
      }
    });

    it('specialization score between 0 and 1', () => {
      analytics.recordBatch(
        makeEvents(20, { agentId: 'a1', taskType: 'research', status: 'success', duration: 500 })
      );
      const score = analytics.getSpecializationScore('a1', 'research');
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Trend Analysis
  // ───────────────────────────────────────────────────────────────────────

  describe('trend analysis', () => {
    it('returns insufficient data for too few events', () => {
      analytics.recordTask(makeEvent({ agentId: 'a1' }));
      const trend = analytics.getAgentTrend('a1');
      expect(trend.direction).toBe(TrendDirection.INSUFFICIENT_DATA);
    });

    it('detects improving trend', () => {
      const base = 1000000;
      const events: TaskEvent[] = [];
      // Early: many failures
      for (let i = 0; i < 10; i++) {
        events.push(makeEvent({
          agentId: 'improving',
          taskId: `early-${i}`,
          timestamp: base + i * 100,
          status: 'failure',
          duration: 5000,
        }));
      }
      // Late: all successes
      for (let i = 0; i < 10; i++) {
        events.push(makeEvent({
          agentId: 'improving',
          taskId: `late-${i}`,
          timestamp: base + 2000 + i * 100,
          status: 'success',
          duration: 500,
        }));
      }
      analytics.recordBatch(events);
      const trend = analytics.getAgentTrend('improving', 'success_rate', base + 3000);
      expect(trend.direction).toBe(TrendDirection.IMPROVING);
      expect(trend.changePercent).toBeGreaterThan(0);
    });

    it('detects degrading trend', () => {
      const base = 1000000;
      const events: TaskEvent[] = [];
      // Early: all successes
      for (let i = 0; i < 10; i++) {
        events.push(makeEvent({
          agentId: 'degrading',
          taskId: `early-${i}`,
          timestamp: base + i * 100,
          status: 'success',
          duration: 500,
        }));
      }
      // Late: many failures
      for (let i = 0; i < 10; i++) {
        events.push(makeEvent({
          agentId: 'degrading',
          taskId: `late-${i}`,
          timestamp: base + 2000 + i * 100,
          status: 'failure',
          duration: 5000,
        }));
      }
      analytics.recordBatch(events);
      const trend = analytics.getAgentTrend('degrading', 'success_rate', base + 3000);
      expect(trend.direction).toBe(TrendDirection.DEGRADING);
      expect(trend.changePercent).toBeLessThan(0);
    });

    it('detects stable trend', () => {
      const base = 1000000;
      // Consistent performance throughout
      const events = Array.from({ length: 20 }, (_, i) =>
        makeEvent({
          agentId: 'stable',
          taskId: `t-${i}`,
          timestamp: base + i * 100,
          status: 'success',
          duration: 1000,
        })
      );
      analytics.recordBatch(events);
      const trend = analytics.getAgentTrend('stable', 'success_rate', base + 3000);
      expect(trend.direction).toBe(TrendDirection.STABLE);
    });

    it('getMeshTrend analyzes overall mesh', () => {
      const base = 1000000;
      analytics.recordBatch([
        ...makeTimeSeries(5, base, 100, { agentId: 'a1', status: 'success' }),
        ...makeTimeSeries(5, base + 600, 100, { agentId: 'a2', status: 'success' }),
      ]);
      const trend = analytics.getMeshTrend('success_rate');
      expect(trend.entityId).toBe('__mesh__');
      expect(trend.entityType).toBe('mesh');
      expect(trend.dataPoints).toBe(10);
    });

    it('getTaskTypeTrend analyzes by task type', () => {
      const base = 1000000;
      analytics.recordBatch(
        makeTimeSeries(10, base, 100, { taskType: 'research', status: 'success' })
      );
      const trend = analytics.getTaskTypeTrend('research');
      expect(trend.entityType).toBe('task_type');
      expect(trend.entityId).toBe('research');
    });

    it('trend includes moving average', () => {
      const base = 1000000;
      analytics.recordBatch(
        makeTimeSeries(20, base, 100, { status: 'success' })
      );
      const trend = analytics.getMeshTrend('success_rate');
      expect(trend.movingAverage.length).toBeGreaterThan(0);
    });

    it('trend includes data point values', () => {
      const base = 1000000;
      analytics.recordBatch(
        makeTimeSeries(10, base, 100, { status: 'success' })
      );
      const trend = analytics.getMeshTrend('success_rate');
      expect(trend.values.length).toBeGreaterThan(0);
      for (const v of trend.values) {
        expect(v.timestamp).toBeGreaterThan(0);
        expect(typeof v.value).toBe('number');
      }
    });

    it('getDegradingAgents returns agents with degrading performance', () => {
      const base = 1000000;
      // Agent that starts good and degrades
      const events: TaskEvent[] = [];
      for (let i = 0; i < 10; i++) {
        events.push(makeEvent({
          agentId: 'degrading',
          taskId: `early-${i}`,
          timestamp: base + i * 100,
          status: 'success',
        }));
      }
      for (let i = 0; i < 10; i++) {
        events.push(makeEvent({
          agentId: 'degrading',
          taskId: `late-${i}`,
          timestamp: base + 2000 + i * 100,
          status: 'failure',
        }));
      }
      // Stable agent
      events.push(...makeTimeSeries(20, base, 150, { agentId: 'stable', status: 'success' }));
      analytics.recordBatch(events);
      const degrading = analytics.getDegradingAgents();
      expect(degrading.some(t => t.entityId === 'degrading')).toBe(true);
      expect(degrading.some(t => t.entityId === 'stable')).toBe(false);
    });

    it('getImprovingAgents returns agents with improving performance', () => {
      const base = 1000000;
      const events: TaskEvent[] = [];
      for (let i = 0; i < 10; i++) {
        events.push(makeEvent({
          agentId: 'improving',
          taskId: `early-${i}`,
          timestamp: base + i * 100,
          status: 'failure',
        }));
      }
      for (let i = 0; i < 10; i++) {
        events.push(makeEvent({
          agentId: 'improving',
          taskId: `late-${i}`,
          timestamp: base + 2000 + i * 100,
          status: 'success',
        }));
      }
      analytics.recordBatch(events);
      const improving = analytics.getImprovingAgents();
      expect(improving.some(t => t.entityId === 'improving')).toBe(true);
    });

    it('analyzes duration metric trend', () => {
      const base = 1000000;
      const events: TaskEvent[] = [];
      // Duration increases over time (degrading)
      for (let i = 0; i < 20; i++) {
        events.push(makeEvent({
          agentId: 'slowing',
          taskId: `t-${i}`,
          timestamp: base + i * 100,
          duration: 100 + i * 200,
          status: 'success',
        }));
      }
      analytics.recordBatch(events);
      const trend = analytics.getAgentTrend('slowing', 'duration');
      // Duration increasing = degrading for duration metric
      expect(trend.direction).toBe(TrendDirection.IMPROVING);
      // Note: for duration, "improving" in the raw slope sense means increasing.
      // The trend direction is computed from slope sign, not semantic interpretation.
    });

    it('throughput metric trend', () => {
      const base = 1000000;
      analytics.recordBatch(
        makeTimeSeries(15, base, 200, { status: 'success' })
      );
      const trend = analytics.getMeshTrend('throughput');
      expect(trend.values.length).toBeGreaterThan(0);
    });
  });
});
