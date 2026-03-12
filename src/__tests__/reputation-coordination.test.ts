/**
 * Advanced reputation scoring and multi-agent coordination tests
 *
 * Covers: precise score formula verification, reliability edge cases,
 * bid scoring mechanics, multi-agent tracking, registry discovery,
 * and reputation event emissions.
 */

jest.mock('../core/hedera-client');

import { HederaClient } from '../core/hedera-client';
import { AgentRegistry } from '../core/agent-registry';
import { ReputationManager } from '../core/reputation';
import { AgentProfile } from '../core/types';

function createMockClient(): jest.Mocked<HederaClient> {
  const mock = new HederaClient({
    network: 'testnet',
    operatorAccountId: '0.0.1',
    operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
  }) as jest.Mocked<HederaClient>;
  mock.createTopic = jest.fn().mockResolvedValue('0.0.300');
  mock.submitMessage = jest.fn().mockResolvedValue(1);
  mock.subscribeTopic = jest.fn();
  mock.emit = jest.fn().mockReturnValue(true);
  return mock;
}

function createTestProfile(id: string, capabilities: string[]): AgentProfile {
  return {
    id,
    name: `Agent_${id}`,
    description: `Test agent ${id}`,
    capabilities: capabilities.map(c => ({
      name: c,
      description: `${c} capability`,
      inputSchema: {},
      outputSchema: {},
    })),
    hederaAccountId: '0.0.12345',
    inboundTopicId: '0.0.200',
    outboundTopicId: '0.0.201',
    registryTopicId: '0.0.100',
    status: 'active' as const,
    createdAt: Date.now(),
    metadata: {},
  };
}

// ─── Section 1: Reputation Score Calculation Precision ───────────────────────

describe('Reputation Score Calculation Precision', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('single success: overallScore = 0.66', () => {
    // successRate = 1/1 = 1.0
    // reliability = 0.5 (single data point, < 2 times)
    // experienceBonus = min(1/20, 1) = 0.05
    // overall = 1.0*0.5 + 0.5*0.3 + 0.05*0.2 = 0.5 + 0.15 + 0.01 = 0.66
    reputation.recordSuccess('agent-1', 1000, 5);
    const score = reputation.getScore('agent-1');
    expect(score.overallScore).toBe(0.66);
    expect(score.successRate).toBe(1);
    expect(score.reliability).toBe(0.5);
    expect(score.taskCount).toBe(1);
  });

  it('10 successes with identical times: overallScore = 0.9', () => {
    // successRate = 10/10 = 1.0
    // reliability = 1.0 (all times identical, stdDev = 0, cv = 0)
    // experienceBonus = min(10/20, 1) = 0.5
    // overall = 1.0*0.5 + 1.0*0.3 + 0.5*0.2 = 0.5 + 0.3 + 0.1 = 0.9
    for (let i = 0; i < 10; i++) {
      reputation.recordSuccess('agent-1', 500, 3);
    }
    const score = reputation.getScore('agent-1');
    expect(score.overallScore).toBe(0.9);
    expect(score.successRate).toBe(1);
    expect(score.reliability).toBe(1);
    expect(score.avgExecutionTime).toBe(500);
    expect(score.avgCost).toBe(3);
  });

  it('20 successes with identical times: overallScore = 1.0', () => {
    // successRate = 1.0
    // reliability = 1.0
    // experienceBonus = min(20/20, 1) = 1.0
    // overall = 0.5 + 0.3 + 0.2 = 1.0
    for (let i = 0; i < 20; i++) {
      reputation.recordSuccess('agent-1', 1000, 10);
    }
    const score = reputation.getScore('agent-1');
    expect(score.overallScore).toBe(1);
    expect(score.successRate).toBe(1);
    expect(score.reliability).toBe(1);
  });

  it('8 successes + 2 failures with identical times: overallScore = 0.8', () => {
    // successRate = 8/10 = 0.8
    // reliability = 1.0 (all 8 execution times identical)
    // experienceBonus = min(10/20, 1) = 0.5
    // overall = 0.8*0.5 + 1.0*0.3 + 0.5*0.2 = 0.4 + 0.3 + 0.1 = 0.8
    for (let i = 0; i < 8; i++) {
      reputation.recordSuccess('agent-1', 1000, 5);
    }
    reputation.recordFailure('agent-1');
    reputation.recordFailure('agent-1');
    const score = reputation.getScore('agent-1');
    expect(score.overallScore).toBe(0.8);
    expect(score.successRate).toBe(0.8);
    expect(score.reliability).toBe(1);
  });

  it('all 5 failures: overallScore = 0.2', () => {
    // successRate = 0/5 = 0
    // reliability = 0.5 (no execution times recorded, < 2)
    // experienceBonus = min(5/20, 1) = 0.25
    // overall = 0*0.5 + 0.5*0.3 + 0.25*0.2 = 0 + 0.15 + 0.05 = 0.2
    for (let i = 0; i < 5; i++) {
      reputation.recordFailure('agent-1');
    }
    const score = reputation.getScore('agent-1');
    expect(score.overallScore).toBe(0.2);
    expect(score.successRate).toBe(0);
    expect(score.avgExecutionTime).toBe(0);
    expect(score.avgCost).toBe(0);
  });

  it('zero-cost tasks: avgCost should be 0', () => {
    reputation.recordSuccess('agent-1', 500, 0);
    reputation.recordSuccess('agent-1', 600, 0);
    reputation.recordSuccess('agent-1', 700, 0);
    const score = reputation.getScore('agent-1');
    expect(score.avgCost).toBe(0);
    expect(score.taskCount).toBe(3);
  });
});

// ─── Section 2: Reliability Calculation ─────────────────────────────────────

describe('Reliability Calculation', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('all identical execution times produce reliability = 1.0', () => {
    // stdDev = 0, cv = 0, reliability = 1 - 0 = 1.0
    for (let i = 0; i < 5; i++) {
      reputation.recordSuccess('agent-1', 2000, 5);
    }
    const score = reputation.getScore('agent-1');
    expect(score.reliability).toBe(1);
  });

  it('highly variable times produce low reliability', () => {
    // times = [100, 10000]
    // mean = 5050
    // variance = ((100-5050)^2 + (10000-5050)^2) / 2 = 24502500
    // stdDev = 4950
    // cv = 4950/5050 ≈ 0.9802
    // reliability = 1 - 0.9802 ≈ 0.0198 → rounded to 0.02
    reputation.recordSuccess('agent-1', 100, 5);
    reputation.recordSuccess('agent-1', 10000, 5);
    const score = reputation.getScore('agent-1');
    expect(score.reliability).toBeLessThan(0.1);
    expect(score.reliability).toBeGreaterThanOrEqual(0);
  });

  it('single data point produces reliability = 0.5 (neutral)', () => {
    reputation.recordSuccess('agent-1', 3000, 10);
    const score = reputation.getScore('agent-1');
    expect(score.reliability).toBe(0.5);
  });

  it('two identical times produce reliability = 1.0', () => {
    reputation.recordSuccess('agent-1', 750, 5);
    reputation.recordSuccess('agent-1', 750, 5);
    const score = reputation.getScore('agent-1');
    expect(score.reliability).toBe(1);
  });

  it('gradually increasing times produce moderate reliability', () => {
    // times = [100, 200, 300, 400, 500]
    // mean = 300
    // variance = (40000+10000+0+10000+40000)/5 = 20000
    // stdDev = sqrt(20000) ≈ 141.42
    // cv = 141.42/300 ≈ 0.4714
    // reliability = 1 - 0.4714 ≈ 0.5286 → rounded to 0.529
    reputation.recordSuccess('agent-1', 100, 5);
    reputation.recordSuccess('agent-1', 200, 5);
    reputation.recordSuccess('agent-1', 300, 5);
    reputation.recordSuccess('agent-1', 400, 5);
    reputation.recordSuccess('agent-1', 500, 5);
    const score = reputation.getScore('agent-1');
    expect(score.reliability).toBe(0.529);
  });
});

// ─── Section 3: Bid Scoring with Reputation ─────────────────────────────────

describe('Bid Scoring with Reputation', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('new agent (no history): multiplier = 1.0', () => {
    // No history → overallScore = 0.5
    // multiplier = 0.5 + 0.5 = 1.0
    // baseScore = 0.8 / (10 + 1) = 0.0727...
    // adjusted = 0.0727... * 1.0 = 0.0727...
    const score = reputation.getReputationAdjustedBidScore('new-agent', 0.8, 10);
    const expectedBase = 0.8 / 11;
    const expectedAdjusted = expectedBase * 1.0;
    expect(score).toBeCloseTo(expectedAdjusted, 6);
  });

  it('perfect agent: multiplier approaches 1.5', () => {
    // 20 identical successes → overallScore = 1.0
    // multiplier = 0.5 + 1.0 = 1.5
    for (let i = 0; i < 20; i++) {
      reputation.recordSuccess('perfect', 1000, 5);
    }
    const score = reputation.getReputationAdjustedBidScore('perfect', 0.8, 10);
    const expectedBase = 0.8 / 11;
    const expectedAdjusted = expectedBase * 1.5;
    expect(score).toBeCloseTo(expectedAdjusted, 6);
  });

  it('terrible agent: multiplier approaches 0.5', () => {
    // 20 failures → successRate=0, reliability=0.5, expBonus=1.0
    // overall = 0*0.5 + 0.5*0.3 + 1.0*0.2 = 0.35
    // multiplier = 0.5 + 0.35 = 0.85
    for (let i = 0; i < 20; i++) {
      reputation.recordFailure('terrible');
    }
    const score = reputation.getReputationAdjustedBidScore('terrible', 0.8, 10);
    const expectedBase = 0.8 / 11;
    const overallScore = reputation.getScore('terrible').overallScore;
    const expectedAdjusted = expectedBase * (0.5 + overallScore);
    expect(score).toBeCloseTo(expectedAdjusted, 6);
    // The multiplier should be < 1.0
    expect(score).toBeLessThan(expectedBase * 1.0);
  });

  it('zero cost bid: base = confidence / 1', () => {
    // baseScore = 0.9 / (0 + 1) = 0.9
    // new agent multiplier = 1.0
    const score = reputation.getReputationAdjustedBidScore('agent-1', 0.9, 0);
    expect(score).toBeCloseTo(0.9, 6);
  });

  it('high cost reduces base score significantly', () => {
    // Same confidence, different costs
    const lowCost = reputation.getReputationAdjustedBidScore('agent-1', 0.9, 1);
    const highCost = reputation.getReputationAdjustedBidScore('agent-1', 0.9, 1000);
    // lowCost base = 0.9/2 = 0.45, highCost base = 0.9/1001 ≈ 0.0009
    expect(lowCost).toBeGreaterThan(highCost * 100);
  });
});

// ─── Section 4: Multi-Agent Reputation Tracking ─────────────────────────────

describe('Multi-Agent Reputation Tracking', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('tracks 100 agents simultaneously', () => {
    for (let i = 0; i < 100; i++) {
      reputation.recordSuccess(`agent-${i}`, 1000 + i, 5);
    }
    expect(reputation.getTrackedAgentCount()).toBe(100);
    // Verify first and last agents have correct data
    const first = reputation.getScore('agent-0');
    expect(first.taskCount).toBe(1);
    expect(first.avgExecutionTime).toBe(1000);
    const last = reputation.getScore('agent-99');
    expect(last.taskCount).toBe(1);
    expect(last.avgExecutionTime).toBe(1099);
  });

  it('getAllScores returns sorted by overallScore descending', () => {
    // Create agents with different success rates
    // agent-a: 10 successes = highest score
    for (let i = 0; i < 10; i++) {
      reputation.recordSuccess('agent-a', 1000, 5);
    }
    // agent-b: 5 successes + 5 failures = medium score
    for (let i = 0; i < 5; i++) {
      reputation.recordSuccess('agent-b', 1000, 5);
    }
    for (let i = 0; i < 5; i++) {
      reputation.recordFailure('agent-b');
    }
    // agent-c: 10 failures = lowest score
    for (let i = 0; i < 10; i++) {
      reputation.recordFailure('agent-c');
    }

    const scores = reputation.getAllScores();
    expect(scores).toHaveLength(3);
    expect(scores[0].agentId).toBe('agent-a');
    expect(scores[2].agentId).toBe('agent-c');
    // Verify descending order
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1].overallScore).toBeGreaterThanOrEqual(scores[i].overallScore);
    }
  });

  it('reset one agent does not affect others', () => {
    reputation.recordSuccess('agent-1', 1000, 5);
    reputation.recordSuccess('agent-2', 2000, 10);
    reputation.recordSuccess('agent-3', 3000, 15);

    const agent2ScoreBefore = reputation.getScore('agent-2').overallScore;
    const agent3ScoreBefore = reputation.getScore('agent-3').overallScore;

    reputation.reset('agent-1');

    expect(reputation.getTrackedAgentCount()).toBe(2);
    expect(reputation.getRecord('agent-1')).toBeUndefined();
    expect(reputation.getScore('agent-2').overallScore).toBe(agent2ScoreBefore);
    expect(reputation.getScore('agent-3').overallScore).toBe(agent3ScoreBefore);
  });

  it('getTrackedAgentCount accurately reflects adds and resets', () => {
    expect(reputation.getTrackedAgentCount()).toBe(0);

    reputation.recordSuccess('a', 100, 1);
    expect(reputation.getTrackedAgentCount()).toBe(1);

    reputation.recordFailure('b');
    expect(reputation.getTrackedAgentCount()).toBe(2);

    reputation.recordSuccess('c', 200, 2);
    expect(reputation.getTrackedAgentCount()).toBe(3);

    reputation.reset('b');
    expect(reputation.getTrackedAgentCount()).toBe(2);

    reputation.reset('a');
    expect(reputation.getTrackedAgentCount()).toBe(1);

    reputation.reset('c');
    expect(reputation.getTrackedAgentCount()).toBe(0);
  });
});

// ─── Section 5: Registry Discovery with Capabilities ────────────────────────

describe('Registry Discovery with Capabilities', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    registry = new AgentRegistry(mockClient);
    await registry.initialize();

    // Register agents with various capabilities
    await registry.registerAgent(createTestProfile('nlp-1', ['NaturalLanguageProcessing', 'TextSummarization']));
    await registry.registerAgent(createTestProfile('vision-1', ['ImageRecognition', 'ObjectDetection']));
    await registry.registerAgent(createTestProfile('data-1', ['DataAnalysis', 'NaturalLanguageProcessing']));
    await registry.registerAgent(createTestProfile('nlp-2', ['NaturalLanguageProcessing', 'Translation']));

    // Set one agent to inactive
    const inactiveProfile = createTestProfile('inactive-1', ['NaturalLanguageProcessing']);
    inactiveProfile.status = 'inactive';
    await registry.registerAgent(inactiveProfile);
  });

  it('discovers by exact capability name (case insensitive)', () => {
    const result = registry.discoverAgents({ capability: 'naturallanguageprocessing' });
    // Should match nlp-1, data-1, nlp-2, and inactive-1 (all have NaturalLanguageProcessing)
    expect(result.totalFound).toBe(4);
    const ids = result.agents.map(a => a.id);
    expect(ids).toContain('nlp-1');
    expect(ids).toContain('data-1');
    expect(ids).toContain('nlp-2');
    expect(ids).toContain('inactive-1');
  });

  it('discovers by partial capability name', () => {
    const result = registry.discoverAgents({ capability: 'Language' });
    // Matches capabilities containing "language" (case insensitive):
    // NaturalLanguageProcessing (nlp-1, data-1, nlp-2, inactive-1)
    expect(result.totalFound).toBe(4);
  });

  it('discovers by capability description match', () => {
    // The description is "{capName} capability", so searching for "ImageRecognition"
    // matches name or description containing that string
    const result = registry.discoverAgents({ capability: 'ImageRecognition' });
    expect(result.totalFound).toBe(1);
    expect(result.agents[0].id).toBe('vision-1');
  });

  it('discovers with status filter', () => {
    const activeResult = registry.discoverAgents({ capability: 'NaturalLanguageProcessing', status: 'active' });
    // Only active NLP agents: nlp-1, data-1, nlp-2 (inactive-1 is filtered out)
    expect(activeResult.totalFound).toBe(3);
    const ids = activeResult.agents.map(a => a.id);
    expect(ids).not.toContain('inactive-1');
  });

  it('discovers with maxResults limit', () => {
    const result = registry.discoverAgents({ capability: 'NaturalLanguageProcessing', maxResults: 2 });
    expect(result.totalFound).toBe(2);
    expect(result.agents).toHaveLength(2);
  });
});

// ─── Section 6: Reputation Events ───────────────────────────────────────────

describe('Reputation Events', () => {
  let reputation: ReputationManager;

  beforeEach(() => {
    reputation = new ReputationManager();
  });

  it('emits reputation:updated event on success', () => {
    const events: any[] = [];
    reputation.on('reputation:updated', (score) => events.push(score));

    reputation.recordSuccess('agent-1', 1000, 5);

    expect(events).toHaveLength(1);
    expect(events[0].agentId).toBe('agent-1');
    expect(events[0].taskCount).toBe(1);
  });

  it('emits reputation:updated event on failure', () => {
    const events: any[] = [];
    reputation.on('reputation:updated', (score) => events.push(score));

    reputation.recordFailure('agent-1');

    expect(events).toHaveLength(1);
    expect(events[0].agentId).toBe('agent-1');
    expect(events[0].taskCount).toBe(1);
    expect(events[0].successRate).toBe(0);
  });

  it('event payload contains correct ReputationScore structure', () => {
    const events: any[] = [];
    reputation.on('reputation:updated', (score) => events.push(score));

    reputation.recordSuccess('agent-1', 1500, 8);

    const payload = events[0];
    expect(payload).toHaveProperty('agentId', 'agent-1');
    expect(payload).toHaveProperty('overallScore');
    expect(payload).toHaveProperty('successRate');
    expect(payload).toHaveProperty('avgExecutionTime');
    expect(payload).toHaveProperty('avgCost');
    expect(payload).toHaveProperty('reliability');
    expect(payload).toHaveProperty('taskCount');
    // Verify actual computed values
    expect(payload.successRate).toBe(1);
    expect(payload.avgExecutionTime).toBe(1500);
    expect(payload.avgCost).toBe(8);
    expect(payload.reliability).toBe(0.5); // single data point
    expect(payload.overallScore).toBe(0.66); // formula verified in section 1
  });

  it('multiple rapid updates all emit events', () => {
    const events: any[] = [];
    reputation.on('reputation:updated', (score) => events.push(score));

    reputation.recordSuccess('agent-1', 100, 1);
    reputation.recordSuccess('agent-1', 200, 2);
    reputation.recordFailure('agent-1');
    reputation.recordSuccess('agent-1', 300, 3);
    reputation.recordFailure('agent-1');

    expect(events).toHaveLength(5);
    // Verify each event has incrementing task count
    expect(events[0].taskCount).toBe(1);
    expect(events[1].taskCount).toBe(2);
    expect(events[2].taskCount).toBe(3);
    expect(events[3].taskCount).toBe(4);
    expect(events[4].taskCount).toBe(5);
  });

  it('event after reset shows neutral score', () => {
    // Build up some history
    reputation.recordSuccess('agent-1', 1000, 5);
    reputation.recordSuccess('agent-1', 1000, 5);

    // Reset the agent
    reputation.reset('agent-1');

    // Now record a failure and listen for the event
    const events: any[] = [];
    reputation.on('reputation:updated', (score) => events.push(score));

    reputation.recordFailure('agent-1');

    expect(events).toHaveLength(1);
    const payload = events[0];
    // After reset + 1 failure: totalTasks=1, completedTasks=0
    // successRate = 0, reliability = 0.5, expBonus = 1/20 = 0.05
    // overall = 0*0.5 + 0.5*0.3 + 0.05*0.2 = 0.16
    expect(payload.taskCount).toBe(1);
    expect(payload.successRate).toBe(0);
    expect(payload.overallScore).toBe(0.16);
  });
});
