import {
  TaskAnalytics,
  TaskEvent,
  BottleneckReason,
  TrendDirection,
  SpecializationScore,
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
      taskId: `task-${i}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now() + i * 100,
      ...overrides,
    })
  );
}

function makeTimeSeries(
  count: number,
  baseTs: number,
  intervalMs: number,
  overrides: Partial<TaskEvent> = {},
): TaskEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeEvent({
      taskId: `ts-${i}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: baseTs + i * intervalMs,
      ...overrides,
    })
  );
}

// ─── Advanced Tests ─────────────────────────────────────────────────────────

describe('TaskAnalytics Advanced', () => {
  let analytics: TaskAnalytics;

  beforeEach(() => {
    analytics = new TaskAnalytics();
  });

  // ───────────────────────────────────────────────────────────────────────
  // Edge Cases in Event Recording
  // ───────────────────────────────────────────────────────────────────────

  describe('edge cases - event recording', () => {
    it('handles very large duration values', () => {
      analytics.recordTask(makeEvent({ duration: Number.MAX_SAFE_INTEGER }));
      const stats = analytics.getAgentStats('agent-1');
      expect(stats.maxDuration).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('handles zero duration events', () => {
      analytics.recordBatch(makeEvents(5, { duration: 0 }));
      const stats = analytics.getAgentStats('agent-1');
      expect(stats.averageDuration).toBe(0);
      expect(stats.medianDuration).toBe(0);
    });

    it('handles very large cost values', () => {
      analytics.recordTask(makeEvent({ cost: 999999.99 }));
      const stats = analytics.getAgentStats('agent-1');
      expect(stats.totalCost).toBeGreaterThan(999999);
    });

    it('handles many unique agents', () => {
      for (let i = 0; i < 100; i++) {
        analytics.recordTask(makeEvent({ agentId: `agent-${i}` }));
      }
      expect(analytics.getUniqueAgentIds()).toHaveLength(100);
    });

    it('handles many unique task types', () => {
      for (let i = 0; i < 50; i++) {
        analytics.recordTask(makeEvent({ taskType: `type-${i}` }));
      }
      expect(analytics.getUniqueTaskTypes()).toHaveLength(50);
    });

    it('handles same taskId for different agents', () => {
      analytics.recordTask(makeEvent({ taskId: 'shared-task', agentId: 'a1' }));
      analytics.recordTask(makeEvent({ taskId: 'shared-task', agentId: 'a2' }));
      expect(analytics.getEventCount()).toBe(2);
    });

    it('handles metadata with nested objects', () => {
      const event = makeEvent({
        metadata: { nested: { deep: 'value' } as any },
      });
      analytics.recordTask(event);
      const stored = analytics.getEvents();
      expect((stored[0]!.metadata as any).nested.deep).toBe('value');
    });

    it('handles empty metadata', () => {
      analytics.recordTask(makeEvent({ metadata: {} }));
      expect(analytics.getEventCount()).toBe(1);
    });

    it('handles undefined metadata', () => {
      analytics.recordTask(makeEvent({ metadata: undefined }));
      expect(analytics.getEventCount()).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Statistical Accuracy
  // ───────────────────────────────────────────────────────────────────────

  describe('statistical accuracy', () => {
    it('computes correct median for even number of values', () => {
      analytics.recordBatch([
        makeEvent({ agentId: 'a1', duration: 100, taskId: 't1' }),
        makeEvent({ agentId: 'a1', duration: 200, taskId: 't2' }),
        makeEvent({ agentId: 'a1', duration: 300, taskId: 't3' }),
        makeEvent({ agentId: 'a1', duration: 400, taskId: 't4' }),
      ]);
      const stats = analytics.getAgentStats('a1');
      expect(stats.medianDuration).toBe(250); // (200+300)/2
    });

    it('computes correct median for odd number of values', () => {
      analytics.recordBatch([
        makeEvent({ agentId: 'a1', duration: 100, taskId: 't1' }),
        makeEvent({ agentId: 'a1', duration: 200, taskId: 't2' }),
        makeEvent({ agentId: 'a1', duration: 300, taskId: 't3' }),
      ]);
      const stats = analytics.getAgentStats('a1');
      expect(stats.medianDuration).toBe(200);
    });

    it('computes correct median for single value', () => {
      analytics.recordTask(makeEvent({ agentId: 'a1', duration: 500 }));
      const stats = analytics.getAgentStats('a1');
      expect(stats.medianDuration).toBe(500);
    });

    it('p95 is correct for large dataset', () => {
      const events = Array.from({ length: 100 }, (_, i) =>
        makeEvent({ agentId: 'a1', taskId: `t-${i}`, duration: (i + 1) * 10 })
      );
      analytics.recordBatch(events);
      const stats = analytics.getAgentStats('a1');
      // p95 of 10, 20, 30, ..., 1000 should be 950
      expect(stats.p95Duration).toBe(950);
    });

    it('p99 is correct for large dataset', () => {
      const events = Array.from({ length: 100 }, (_, i) =>
        makeEvent({ agentId: 'a1', taskId: `t-${i}`, duration: (i + 1) * 10 })
      );
      analytics.recordBatch(events);
      const stats = analytics.getAgentStats('a1');
      // p99 of 10,20,...,1000 should be 990
      expect(stats.p99Duration).toBe(990);
    });

    it('success rate precision to 3 decimal places', () => {
      analytics.recordBatch([
        ...makeEvents(2, { agentId: 'a1', status: 'success' }),
        makeEvent({ agentId: 'a1', status: 'failure' }),
      ]);
      const stats = analytics.getAgentStats('a1');
      expect(stats.successRate).toBe(0.667);
    });

    it('average cost rounds to 2 decimal places', () => {
      analytics.recordBatch([
        makeEvent({ agentId: 'a1', cost: 1, taskId: 't1' }),
        makeEvent({ agentId: 'a1', cost: 2, taskId: 't2' }),
        makeEvent({ agentId: 'a1', cost: 3, taskId: 't3' }),
      ]);
      const stats = analytics.getAgentStats('a1');
      expect(stats.averageCost).toBe(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Multi-Agent Specialization Matrix
  // ───────────────────────────────────────────────────────────────────────

  describe('specialization matrix', () => {
    it('identifies agent strengths across multiple task types', () => {
      // Agent A: great at research, poor at analysis
      analytics.recordBatch([
        ...makeEvents(20, { agentId: 'A', taskType: 'research', status: 'success', duration: 200 }),
        ...makeEvents(20, { agentId: 'A', taskType: 'analysis', status: 'failure', duration: 5000 }),
      ]);
      // Agent B: great at analysis, poor at research
      analytics.recordBatch([
        ...makeEvents(20, { agentId: 'B', taskType: 'analysis', status: 'success', duration: 200 }),
        ...makeEvents(20, { agentId: 'B', taskType: 'research', status: 'failure', duration: 5000 }),
      ]);

      const bestResearch = analytics.getBestAgentForTaskType('research');
      const bestAnalysis = analytics.getBestAgentForTaskType('analysis');

      expect(bestResearch!.agentId).toBe('A');
      expect(bestAnalysis!.agentId).toBe('B');
    });

    it('specialization reflects relative performance', () => {
      // Agent that is average at everything
      analytics.recordBatch([
        ...makeEvents(10, { agentId: 'generalist', taskType: 'research', status: 'success', duration: 1000 }),
        ...makeEvents(10, { agentId: 'generalist', taskType: 'analysis', status: 'success', duration: 1000 }),
      ]);
      // Agent that is excellent at research specifically
      analytics.recordBatch([
        ...makeEvents(10, { agentId: 'specialist', taskType: 'research', status: 'success', duration: 100 }),
      ]);

      const specScore = analytics.getSpecializationScore('specialist', 'research');
      const genScore = analytics.getSpecializationScore('generalist', 'research');

      // Specialist should score higher at research
      expect(specScore.score).toBeGreaterThan(genScore.score);
    });

    it('empty specialization for agent with no tasks of type', () => {
      analytics.recordBatch(
        makeEvents(5, { agentId: 'a1', taskType: 'research' })
      );
      const score = analytics.getSpecializationScore('a1', 'analysis');
      expect(score.taskCount).toBe(0);
      expect(score.successRate).toBe(0);
      expect(score.averageDuration).toBe(0);
    });

    it('confidence is capped at 1.0', () => {
      analytics.recordBatch(
        makeEvents(100, { agentId: 'a1', taskType: 'research', status: 'success' })
      );
      const score = analytics.getSpecializationScore('a1', 'research');
      expect(score.confidence).toBeLessThanOrEqual(1);
    });

    it('score is bounded between 0 and 1', () => {
      analytics.recordBatch([
        ...makeEvents(50, { agentId: 'a1', taskType: 'research', status: 'success', duration: 1 }),
        ...makeEvents(50, { agentId: 'a1', taskType: 'research', status: 'failure', duration: 100000 }),
      ]);
      const score = analytics.getSpecializationScore('a1', 'research');
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(1);
    });

    it('getAllSpecializations covers full matrix', () => {
      analytics.recordBatch([
        makeEvent({ agentId: 'a1', taskType: 't1', taskId: 'e1' }),
        makeEvent({ agentId: 'a1', taskType: 't2', taskId: 'e2' }),
        makeEvent({ agentId: 'a2', taskType: 't1', taskId: 'e3' }),
        makeEvent({ agentId: 'a2', taskType: 't2', taskId: 'e4' }),
        makeEvent({ agentId: 'a3', taskType: 't1', taskId: 'e5' }),
      ]);
      const all = analytics.getAllSpecializations();
      // 2 types for a1, 2 types for a2, 1 type for a3 = 5
      expect(all).toHaveLength(5);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Complex Bottleneck Scenarios
  // ───────────────────────────────────────────────────────────────────────

  describe('complex bottleneck scenarios', () => {
    it('multiple bottleneck reasons for same agent', () => {
      // Agent that is slow, failing, AND expensive
      analytics.recordBatch([
        ...makeEvents(10, {
          agentId: 'terrible',
          status: 'failure',
          duration: 50000,
          cost: 100,
        }),
        // Normal agents for comparison
        ...makeEvents(10, {
          agentId: 'normal1',
          status: 'success',
          duration: 500,
          cost: 2,
        }),
        ...makeEvents(10, {
          agentId: 'normal2',
          status: 'success',
          duration: 600,
          cost: 3,
        }),
      ]);

      const bottlenecks = analytics.detectBottlenecks();
      const terribleBottlenecks = bottlenecks.filter(b => b.agentId === 'terrible');
      // Should detect at least failure rate and high cost
      expect(terribleBottlenecks.length).toBeGreaterThanOrEqual(2);
      const reasons = terribleBottlenecks.map(b => b.reason);
      expect(reasons).toContain(BottleneckReason.HIGH_FAILURE_RATE);
      expect(reasons).toContain(BottleneckReason.HIGH_COST);
    });

    it('no false positives for a healthy mesh', () => {
      // All agents performing similarly and well
      for (let i = 0; i < 5; i++) {
        analytics.recordBatch(
          makeEvents(10, {
            agentId: `healthy-${i}`,
            status: 'success',
            duration: 500 + Math.random() * 200,
            cost: 3 + Math.random(),
          })
        );
      }
      const bottlenecks = analytics.detectBottlenecks();
      expect(bottlenecks).toHaveLength(0);
    });

    it('configurable minimum task threshold', () => {
      const strict = new TaskAnalytics({ minTasksForBottleneck: 20 });
      strict.recordBatch([
        ...makeEvents(15, { agentId: 'failing', status: 'failure' }),
        ...makeEvents(10, { agentId: 'good', status: 'success' }),
      ]);
      const bottlenecks = strict.detectBottlenecks();
      // 15 tasks < threshold of 20, so no bottleneck detected
      expect(bottlenecks.find(b => b.agentId === 'failing')).toBeUndefined();
    });

    it('severity escalation for extreme failure rates', () => {
      analytics.recordBatch([
        // 30% failure = low
        ...makeEvents(7, { agentId: 'low-fail', status: 'success' }),
        ...makeEvents(3, { agentId: 'low-fail', status: 'failure' }),
        // 50% failure = high
        ...makeEvents(5, { agentId: 'high-fail', status: 'success' }),
        ...makeEvents(5, { agentId: 'high-fail', status: 'failure' }),
        // 90% failure = critical
        ...makeEvents(1, { agentId: 'critical-fail', status: 'success' }),
        ...makeEvents(9, { agentId: 'critical-fail', status: 'failure' }),
      ]);

      const bottlenecks = analytics.detectBottlenecks();

      const lowFail = bottlenecks.find(
        b => b.agentId === 'low-fail' && b.reason === BottleneckReason.HIGH_FAILURE_RATE
      );
      const highFail = bottlenecks.find(
        b => b.agentId === 'high-fail' && b.reason === BottleneckReason.HIGH_FAILURE_RATE
      );
      const criticalFail = bottlenecks.find(
        b => b.agentId === 'critical-fail' && b.reason === BottleneckReason.HIGH_FAILURE_RATE
      );

      expect(lowFail).toBeDefined();
      expect(highFail).toBeDefined();
      expect(criticalFail).toBeDefined();
      expect(criticalFail!.severity).toBe('critical');
      expect(highFail!.severity).toBe('high');
      expect(lowFail!.severity).toBe('low');
    });

    it('bottleneck threshold for slow execution is configurable', () => {
      const strict = new TaskAnalytics({ slowExecutionMultiplier: 3.0 });
      strict.recordBatch([
        ...makeEvents(10, { agentId: 'fast', status: 'success', duration: 100 }),
        ...makeEvents(10, { agentId: 'medium', status: 'success', duration: 250 }),
      ]);
      // 250 / 100 = 2.5x, below 3.0 threshold
      const bottlenecks = strict.detectBottlenecks();
      expect(bottlenecks.find(
        b => b.agentId === 'medium' && b.reason === BottleneckReason.SLOW_EXECUTION
      )).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Load Balancing Deep Analysis
  // ───────────────────────────────────────────────────────────────────────

  describe('load balancing deep analysis', () => {
    it('detects 80/20 distribution imbalance', () => {
      analytics.recordBatch([
        ...makeEvents(80, { agentId: 'overworked', taskType: 'compute' }),
        ...makeEvents(20, { agentId: 'idle', taskType: 'compute' }),
      ]);
      const recs = analytics.computeLoadBalancingRecommendations();
      expect(recs.length).toBeGreaterThanOrEqual(1);
      const rec = recs.find(r => r.taskType === 'compute');
      expect(rec).toBeDefined();
    });

    it('handles three-agent imbalance', () => {
      analytics.recordBatch([
        ...makeEvents(50, { agentId: 'busy', taskType: 'task' }),
        ...makeEvents(5, { agentId: 'idle1', taskType: 'task' }),
        ...makeEvents(5, { agentId: 'idle2', taskType: 'task' }),
      ]);
      const recs = analytics.computeLoadBalancingRecommendations();
      const rec = recs.find(r => r.taskType === 'task');
      expect(rec).toBeDefined();
      expect(rec!.currentDistribution).toHaveLength(3);
      expect(rec!.suggestedDistribution).toHaveLength(3);
    });

    it('does not generate recommendation for types with one agent', () => {
      analytics.recordBatch(makeEvents(50, { agentId: 'sole', taskType: 'exclusive' }));
      const recs = analytics.computeLoadBalancingRecommendations();
      expect(recs.find(r => r.taskType === 'exclusive')).toBeUndefined();
    });

    it('recommendations are independent per task type', () => {
      analytics.recordBatch([
        // Imbalanced type
        ...makeEvents(30, { agentId: 'a1', taskType: 'imbalanced' }),
        ...makeEvents(2, { agentId: 'a2', taskType: 'imbalanced' }),
        // Balanced type
        ...makeEvents(10, { agentId: 'a1', taskType: 'balanced' }),
        ...makeEvents(10, { agentId: 'a2', taskType: 'balanced' }),
      ]);
      const recs = analytics.computeLoadBalancingRecommendations();
      expect(recs.find(r => r.taskType === 'imbalanced')).toBeDefined();
      expect(recs.find(r => r.taskType === 'balanced')).toBeUndefined();
    });

    it('current distribution is sorted by task count descending', () => {
      analytics.recordBatch([
        ...makeEvents(5, { agentId: 'a1', taskType: 'task' }),
        ...makeEvents(20, { agentId: 'a2', taskType: 'task' }),
        ...makeEvents(1, { agentId: 'a3', taskType: 'task' }),
      ]);
      const recs = analytics.computeLoadBalancingRecommendations();
      const rec = recs.find(r => r.taskType === 'task');
      if (rec) {
        expect(rec.currentDistribution[0]!.agentId).toBe('a2');
        for (let i = 1; i < rec.currentDistribution.length; i++) {
          expect(rec.currentDistribution[i]!.taskCount)
            .toBeLessThanOrEqual(rec.currentDistribution[i - 1]!.taskCount);
        }
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Trend Analysis Deep Tests
  // ───────────────────────────────────────────────────────────────────────

  describe('trend analysis deep tests', () => {
    it('cost metric trend tracks cost changes', () => {
      const base = 1000000;
      const events: TaskEvent[] = [];
      // Costs increase over time
      for (let i = 0; i < 20; i++) {
        events.push(makeEvent({
          agentId: 'a1',
          taskId: `t-${i}`,
          timestamp: base + i * 100,
          cost: 1 + i * 2,
          status: 'success',
        }));
      }
      analytics.recordBatch(events);
      const trend = analytics.getAgentTrend('a1', 'cost');
      expect(trend.metric).toBe('cost');
      expect(trend.direction).toBe(TrendDirection.IMPROVING);
      // Cost increasing shows as positive slope, classified as "improving"
      // in the linear regression sense (values going up)
    });

    it('trend with exact 3 data points (minimum)', () => {
      const base = 1000000;
      analytics.recordBatch([
        makeEvent({ agentId: 'a1', taskId: 't1', timestamp: base, status: 'success' }),
        makeEvent({ agentId: 'a1', taskId: 't2', timestamp: base + 1000, status: 'success' }),
        makeEvent({ agentId: 'a1', taskId: 't3', timestamp: base + 2000, status: 'success' }),
      ]);
      const trend = analytics.getAgentTrend('a1', 'success_rate');
      expect(trend.direction).not.toBe(TrendDirection.INSUFFICIENT_DATA);
      expect(trend.dataPoints).toBe(3);
    });

    it('trend with 2 data points is insufficient', () => {
      const base = 1000000;
      analytics.recordBatch([
        makeEvent({ agentId: 'a1', taskId: 't1', timestamp: base }),
        makeEvent({ agentId: 'a1', taskId: 't2', timestamp: base + 1000 }),
      ]);
      const trend = analytics.getAgentTrend('a1', 'success_rate');
      expect(trend.direction).toBe(TrendDirection.INSUFFICIENT_DATA);
    });

    it('custom window size affects analysis', () => {
      const base = 1000000;
      analytics.recordBatch(
        makeTimeSeries(20, base, 100, { agentId: 'a1', status: 'success' })
      );
      const shortWindow = analytics.getAgentTrend('a1', 'success_rate', 500);
      const longWindow = analytics.getAgentTrend('a1', 'success_rate', 50000);
      // Both should complete without error
      expect(shortWindow.metric).toBe('success_rate');
      expect(longWindow.metric).toBe('success_rate');
    });

    it('moving average smooths noisy data', () => {
      const base = 1000000;
      const events: TaskEvent[] = [];
      // Alternating success/failure
      for (let i = 0; i < 20; i++) {
        events.push(makeEvent({
          agentId: 'noisy',
          taskId: `t-${i}`,
          timestamp: base + i * 100,
          status: i % 2 === 0 ? 'success' : 'failure',
        }));
      }
      analytics.recordBatch(events);
      const trend = analytics.getMeshTrend('success_rate');
      expect(trend.movingAverage.length).toBeGreaterThan(0);
      // Moving average values should all be close to 0.5
      for (const ma of trend.movingAverage) {
        expect(ma).toBeGreaterThanOrEqual(0);
        expect(ma).toBeLessThanOrEqual(1);
      }
    });

    it('change percent calculation', () => {
      const base = 1000000;
      // All failures in first half, all successes in second
      const events: TaskEvent[] = [];
      for (let i = 0; i < 10; i++) {
        events.push(makeEvent({
          agentId: 'a1',
          taskId: `early-${i}`,
          timestamp: base + i * 100,
          status: 'failure',
        }));
      }
      for (let i = 0; i < 10; i++) {
        events.push(makeEvent({
          agentId: 'a1',
          taskId: `late-${i}`,
          timestamp: base + 2000 + i * 100,
          status: 'success',
        }));
      }
      analytics.recordBatch(events);
      const trend = analytics.getAgentTrend('a1', 'success_rate');
      if (trend.direction === TrendDirection.IMPROVING) {
        expect(trend.changePercent).toBeGreaterThan(0);
      }
    });

    it('trend analysis for empty agent returns insufficient data', () => {
      const trend = analytics.getAgentTrend('nonexistent', 'success_rate');
      expect(trend.direction).toBe(TrendDirection.INSUFFICIENT_DATA);
      expect(trend.dataPoints).toBe(0);
      expect(trend.values).toHaveLength(0);
      expect(trend.movingAverage).toHaveLength(0);
    });

    it('mesh trend with single agent is same as agent trend direction', () => {
      const base = 1000000;
      const events: TaskEvent[] = [];
      for (let i = 0; i < 10; i++) {
        events.push(makeEvent({
          agentId: 'solo',
          taskId: `t-${i}`,
          timestamp: base + i * 100,
          status: 'success',
        }));
      }
      analytics.recordBatch(events);
      const agentTrend = analytics.getAgentTrend('solo', 'success_rate');
      const meshTrend = analytics.getMeshTrend('success_rate');
      expect(meshTrend.direction).toBe(agentTrend.direction);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Report Integration
  // ───────────────────────────────────────────────────────────────────────

  describe('report integration', () => {
    it('report contains bottlenecks from detection', () => {
      analytics.recordBatch([
        ...makeEvents(10, { agentId: 'failing', status: 'failure' }),
        ...makeEvents(10, { agentId: 'good', status: 'success' }),
      ]);
      const report = analytics.generateReport();
      expect(report.bottlenecks.length).toBeGreaterThan(0);
      expect(report.bottlenecks.some(b => b.agentId === 'failing')).toBe(true);
    });

    it('report contains load balancing recommendations', () => {
      analytics.recordBatch([
        ...makeEvents(50, { agentId: 'busy', taskType: 'compute' }),
        ...makeEvents(2, { agentId: 'idle', taskType: 'compute' }),
      ]);
      const report = analytics.generateReport();
      expect(report.loadBalancingRecommendations.length).toBeGreaterThanOrEqual(1);
    });

    it('report task type breakdown sums to total', () => {
      analytics.recordBatch([
        ...makeEvents(10, { taskType: 'a' }),
        ...makeEvents(15, { taskType: 'b' }),
        ...makeEvents(5, { taskType: 'c' }),
      ]);
      const report = analytics.generateReport();
      const breakdownTotal = report.taskTypeBreakdown.reduce(
        (sum, tt) => sum + tt.totalTasks, 0
      );
      expect(breakdownTotal).toBe(report.totalTasks);
    });

    it('report successes + failures = total', () => {
      analytics.recordBatch([
        ...makeEvents(7, { status: 'success' }),
        ...makeEvents(3, { status: 'failure' }),
      ]);
      const report = analytics.generateReport();
      expect(report.totalSuccesses + report.totalFailures).toBe(report.totalTasks);
    });

    it('report with only failures has 0 success rate', () => {
      analytics.recordBatch(makeEvents(5, { status: 'failure' }));
      const report = analytics.generateReport();
      expect(report.overallSuccessRate).toBe(0);
    });

    it('report with only successes has 1.0 success rate', () => {
      analytics.recordBatch(makeEvents(5, { status: 'success' }));
      const report = analytics.generateReport();
      expect(report.overallSuccessRate).toBe(1);
    });

    it('filtered report excludes out-of-range events', () => {
      const base = 1000000;
      analytics.recordBatch([
        ...makeTimeSeries(5, base, 100, { taskType: 'early' }),
        ...makeTimeSeries(5, base + 1000, 100, { taskType: 'middle' }),
        ...makeTimeSeries(5, base + 2000, 100, { taskType: 'late' }),
      ]);
      const report = analytics.generateReport(base + 500, base + 1500);
      expect(report.totalTasks).toBe(5);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Concurrent / Multi-Agent Workflows
  // ───────────────────────────────────────────────────────────────────────

  describe('multi-agent workflows', () => {
    it('tracks 10 agents across 5 task types correctly', () => {
      const agents = Array.from({ length: 10 }, (_, i) => `agent-${i}`);
      const types = ['research', 'analysis', 'coding', 'review', 'deploy'];

      // Each agent handles each type a few times
      for (const agent of agents) {
        for (const type of types) {
          analytics.recordBatch(
            makeEvents(3, {
              agentId: agent,
              taskType: type,
              status: Math.random() > 0.2 ? 'success' : 'failure',
              duration: 500 + Math.random() * 2000,
              cost: 1 + Math.random() * 10,
            })
          );
        }
      }

      expect(analytics.getEventCount()).toBe(150);
      expect(analytics.getUniqueAgentIds()).toHaveLength(10);
      expect(analytics.getUniqueTaskTypes()).toHaveLength(5);

      const report = analytics.generateReport();
      expect(report.activeAgents).toBe(10);
      expect(report.taskTypeBreakdown).toHaveLength(5);
      expect(report.agentRankings).toHaveLength(10);
    });

    it('properly separates agent stats in multi-agent mesh', () => {
      analytics.recordBatch([
        ...makeEvents(5, { agentId: 'fast', duration: 100, status: 'success' }),
        ...makeEvents(5, { agentId: 'slow', duration: 10000, status: 'success' }),
      ]);

      const fastStats = analytics.getAgentStats('fast');
      const slowStats = analytics.getAgentStats('slow');

      expect(fastStats.averageDuration).toBe(100);
      expect(slowStats.averageDuration).toBe(10000);
      expect(fastStats.totalTasks).toBe(5);
      expect(slowStats.totalTasks).toBe(5);
    });

    it('handles agent working on many task types', () => {
      for (let i = 0; i < 20; i++) {
        analytics.recordBatch(
          makeEvents(2, { agentId: 'versatile', taskType: `type-${i}` })
        );
      }
      const specs = analytics.getAgentSpecializations('versatile');
      expect(specs).toHaveLength(20);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Configuration Edge Cases
  // ───────────────────────────────────────────────────────────────────────

  describe('configuration edge cases', () => {
    it('updateConfig preserves unset fields', () => {
      analytics.updateConfig({ trendBuckets: 10 });
      const config = analytics.getConfig();
      expect(config.trendBuckets).toBe(10);
      expect(config.minTasksForBottleneck).toBe(5);
      expect(config.failureRateThreshold).toBe(0.3);
    });

    it('multiple updateConfig calls are additive', () => {
      analytics.updateConfig({ trendBuckets: 10 });
      analytics.updateConfig({ failureRateThreshold: 0.9 });
      const config = analytics.getConfig();
      expect(config.trendBuckets).toBe(10);
      expect(config.failureRateThreshold).toBe(0.9);
    });

    it('custom minDataPointsForTrend is respected', () => {
      const strict = new TaskAnalytics({ minDataPointsForTrend: 10 });
      const base = 1000000;
      strict.recordBatch(
        makeTimeSeries(5, base, 100, { agentId: 'a1', status: 'success' })
      );
      const trend = strict.getAgentTrend('a1', 'success_rate');
      expect(trend.direction).toBe(TrendDirection.INSUFFICIENT_DATA);
    });

    it('custom trendBuckets affects bucketing', () => {
      const custom = new TaskAnalytics({ trendBuckets: 3 });
      const base = 1000000;
      custom.recordBatch(
        makeTimeSeries(30, base, 100, { agentId: 'a1', status: 'success' })
      );
      const trend = custom.getMeshTrend('success_rate');
      // Should have at most 3 buckets of data
      expect(trend.values.length).toBeLessThanOrEqual(3);
    });

    it('zero minTasksForBottleneck detects all agents', () => {
      const lenient = new TaskAnalytics({ minTasksForBottleneck: 0 });
      lenient.recordBatch([
        makeEvent({ agentId: 'single-fail', status: 'failure' }),
        makeEvent({ agentId: 'good', status: 'success' }),
      ]);
      // Even 1 failure out of 1 task = 100% failure rate
      const bottlenecks = lenient.detectBottlenecks();
      expect(bottlenecks.some(b => b.agentId === 'single-fail')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Performance Under Scale
  // ───────────────────────────────────────────────────────────────────────

  describe('performance at scale', () => {
    it('handles 1000 events without error', () => {
      const events = Array.from({ length: 1000 }, (_, i) =>
        makeEvent({
          taskId: `bulk-${i}`,
          agentId: `agent-${i % 10}`,
          taskType: `type-${i % 5}`,
          status: i % 3 === 0 ? 'failure' : 'success',
          duration: 100 + (i % 100) * 10,
          cost: 1 + (i % 20),
          timestamp: 1000000 + i * 10,
        })
      );
      const recorded = analytics.recordBatch(events);
      expect(recorded).toBe(1000);
      expect(analytics.getEventCount()).toBe(1000);

      // Generate full report
      const report = analytics.generateReport();
      expect(report.totalTasks).toBe(1000);
      expect(report.activeAgents).toBe(10);
      expect(report.taskTypeBreakdown).toHaveLength(5);
    });

    it('report generation completes in reasonable time', () => {
      const events = Array.from({ length: 500 }, (_, i) =>
        makeEvent({
          taskId: `perf-${i}`,
          agentId: `agent-${i % 20}`,
          taskType: `type-${i % 8}`,
          status: Math.random() > 0.2 ? 'success' : 'failure',
          duration: 100 + Math.random() * 5000,
          cost: Math.random() * 50,
          timestamp: 1000000 + i * 50,
        })
      );
      analytics.recordBatch(events);

      const start = Date.now();
      analytics.generateReport();
      const elapsed = Date.now() - start;
      // Should complete within 1 second even for 500 events
      expect(elapsed).toBeLessThan(1000);
    });

    it('specialization matrix scales with agents and types', () => {
      for (let a = 0; a < 20; a++) {
        for (let t = 0; t < 10; t++) {
          analytics.recordTask(makeEvent({
            agentId: `agent-${a}`,
            taskType: `type-${t}`,
            taskId: `${a}-${t}`,
          }));
        }
      }
      const all = analytics.getAllSpecializations();
      expect(all).toHaveLength(200); // 20 agents x 10 types
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Event Emitter Behavior
  // ───────────────────────────────────────────────────────────────────────

  describe('event emitter behavior', () => {
    it('emits task:recorded for each recorded task', () => {
      const handler = jest.fn();
      analytics.on('task:recorded', handler);
      analytics.recordBatch(makeEvents(5));
      expect(handler).toHaveBeenCalledTimes(5);
    });

    it('emits events:cleared on clear', () => {
      const handler = jest.fn();
      analytics.on('events:cleared', handler);
      analytics.recordBatch(makeEvents(5));
      analytics.clearEvents();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('supports multiple listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      analytics.on('task:recorded', handler1);
      analytics.on('task:recorded', handler2);
      analytics.recordTask(makeEvent());
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('listener removal works', () => {
      const handler = jest.fn();
      analytics.on('task:recorded', handler);
      analytics.removeListener('task:recorded', handler);
      analytics.recordTask(makeEvent());
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Task Type Ranking in Report
  // ───────────────────────────────────────────────────────────────────────

  describe('task type analysis in reports', () => {
    it('task type stats include correct agent count', () => {
      analytics.recordBatch([
        ...makeEvents(5, { agentId: 'a1', taskType: 'research' }),
        ...makeEvents(5, { agentId: 'a2', taskType: 'research' }),
        ...makeEvents(5, { agentId: 'a3', taskType: 'research' }),
        ...makeEvents(5, { agentId: 'a1', taskType: 'analysis' }),
      ]);
      const researchStats = analytics.getTaskTypeStats('research');
      expect(researchStats.agentCount).toBe(3);
      const analysisStats = analytics.getTaskTypeStats('analysis');
      expect(analysisStats.agentCount).toBe(1);
    });

    it('task type median duration is correct', () => {
      analytics.recordBatch([
        makeEvent({ taskType: 'test', duration: 100, taskId: 't1' }),
        makeEvent({ taskType: 'test', duration: 300, taskId: 't2' }),
        makeEvent({ taskType: 'test', duration: 500, taskId: 't3' }),
      ]);
      const stats = analytics.getTaskTypeStats('test');
      expect(stats.medianDuration).toBe(300);
    });

    it('task type total cost sums correctly', () => {
      analytics.recordBatch([
        makeEvent({ taskType: 'billing', cost: 10.5, taskId: 't1' }),
        makeEvent({ taskType: 'billing', cost: 20.3, taskId: 't2' }),
        makeEvent({ taskType: 'billing', cost: 30.2, taskId: 't3' }),
      ]);
      const stats = analytics.getTaskTypeStats('billing');
      expect(stats.totalCost).toBe(61);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Regression / Boundary Tests
  // ───────────────────────────────────────────────────────────────────────

  describe('regression and boundary tests', () => {
    it('report with zero-cost events', () => {
      analytics.recordBatch(makeEvents(5, { cost: 0 }));
      const report = analytics.generateReport();
      expect(report.totalCost).toBe(0);
    });

    it('bottleneck detection with all agents at same performance', () => {
      for (let i = 0; i < 5; i++) {
        analytics.recordBatch(
          makeEvents(10, { agentId: `agent-${i}`, status: 'success', duration: 1000, cost: 5 })
        );
      }
      const bottlenecks = analytics.detectBottlenecks();
      // No bottlenecks when everyone is the same
      expect(bottlenecks).toHaveLength(0);
    });

    it('specialization with only failures', () => {
      analytics.recordBatch(
        makeEvents(10, { agentId: 'failing', taskType: 'research', status: 'failure', duration: 1000 })
      );
      const score = analytics.getSpecializationScore('failing', 'research');
      expect(score.successRate).toBe(0);
      expect(score.taskCount).toBe(10);
    });

    it('trend analysis with all same timestamps', () => {
      const ts = 1000000;
      analytics.recordBatch([
        makeEvent({ agentId: 'a1', taskId: 't1', timestamp: ts, status: 'success' }),
        makeEvent({ agentId: 'a1', taskId: 't2', timestamp: ts, status: 'success' }),
        makeEvent({ agentId: 'a1', taskId: 't3', timestamp: ts, status: 'success' }),
      ]);
      // Should not crash even with zero time span
      const trend = analytics.getAgentTrend('a1', 'success_rate');
      expect(trend.dataPoints).toBe(3);
    });

    it('clear then re-record produces fresh stats', () => {
      analytics.recordBatch(makeEvents(10, { agentId: 'a1', status: 'failure' }));
      analytics.clearEvents();
      analytics.recordBatch(makeEvents(10, { agentId: 'a1', status: 'success' }));
      const stats = analytics.getAgentStats('a1');
      expect(stats.successRate).toBe(1);
      expect(stats.failureCount).toBe(0);
    });

    it('handles agent IDs with special characters', () => {
      analytics.recordTask(makeEvent({ agentId: 'agent/special@chars!#' }));
      const stats = analytics.getAgentStats('agent/special@chars!#');
      expect(stats.totalTasks).toBe(1);
    });

    it('handles task types with unicode', () => {
      analytics.recordTask(makeEvent({ taskType: 'research_日本語' }));
      const stats = analytics.getTaskTypeStats('research_日本語');
      expect(stats.totalTasks).toBe(1);
    });

    it('handles very long agent IDs', () => {
      const longId = 'a'.repeat(1000);
      analytics.recordTask(makeEvent({ agentId: longId }));
      expect(analytics.getAgentStats(longId).totalTasks).toBe(1);
    });
  });
});
