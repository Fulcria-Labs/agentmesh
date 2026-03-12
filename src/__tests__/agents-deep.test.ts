/**
 * Specialized Agents - Deep coverage tests
 *
 * Covers: edge cases in research, analysis, and coordinator agent handlers,
 * boundary conditions for data sizes, unusual inputs, and handler interactions.
 */

import { createResearchAgent } from '../agents/research-agent';
import { createAnalysisAgent } from '../agents/analysis-agent';
import { createCoordinatorAgent } from '../agents/coordinator-agent';
import { MeshNode } from '../core/mesh-node';
import { MeshConfig } from '../core/types';

jest.mock('../core/hedera-client');

const testConfig: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.12345',
  operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
};

describe('ResearchAgent - Deep Edge Cases', () => {
  let agent: MeshNode;

  beforeEach(() => {
    agent = createResearchAgent(testConfig);
  });

  describe('web_research', () => {
    it('should handle empty query string', async () => {
      const result = await agent.executeCapability('web_research', { query: '' }) as any;
      expect(result.findings).toBeDefined();
      expect(result.summary).toContain('""');
    });

    it('should handle very long query', async () => {
      const longQuery = 'a'.repeat(10000);
      const result = await agent.executeCapability('web_research', { query: longQuery }) as any;
      expect(result.findings).toHaveLength(3);
      expect(result.summary).toContain(longQuery);
    });

    it('should handle query with special characters', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'AI <script>alert("xss")</script> & "quotes" \'single\'',
      }) as any;
      expect(result.findings).toHaveLength(3);
    });

    it('should handle query with unicode', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'research about \u00e9\u00e8\u00ea \u4e16\u754c \ud83c\udf0d',
      }) as any;
      expect(result.findings).toHaveLength(3);
    });

    it('should use shallow depth', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'test',
        depth: 'shallow',
      }) as any;
      expect(result.researchDepth).toBe('shallow');
    });

    it('should use deep depth', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'test',
        depth: 'deep',
      }) as any;
      expect(result.researchDepth).toBe('deep');
    });

    it('should include timestamp in result', async () => {
      const before = Date.now();
      const result = await agent.executeCapability('web_research', { query: 'test' }) as any;
      const after = Date.now();
      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });

    it('should include sources in result', async () => {
      const result = await agent.executeCapability('web_research', { query: 'test' }) as any;
      expect(result.sources).toBeInstanceOf(Array);
      expect(result.sources.length).toBeGreaterThan(0);
    });
  });

  describe('summarize', () => {
    it('should handle single word text', async () => {
      const result = await agent.executeCapability('summarize', { text: 'hello' }) as any;
      expect(result.originalLength).toBe(1);
    });

    it('should handle very long text', async () => {
      const longText = Array(1000).fill('word').join(' ');
      const result = await agent.executeCapability('summarize', { text: longText }) as any;
      expect(result.originalLength).toBe(1000);
      expect(result.compressionRatio).toBeLessThan(1);
    });

    it('should default maxPoints to 5', async () => {
      const result = await agent.executeCapability('summarize', {
        text: 'This is a text to summarize with many words',
      }) as any;
      expect(result.keyPoints.length).toBeLessThanOrEqual(5);
    });

    it('should respect maxPoints of 1', async () => {
      const result = await agent.executeCapability('summarize', {
        text: 'This is a text',
        maxPoints: 1,
      }) as any;
      expect(result.keyPoints.length).toBeLessThanOrEqual(1);
    });

    it('should handle text with only spaces', async () => {
      const result = await agent.executeCapability('summarize', { text: '   ' }) as any;
      // Split on whitespace produces empty strings for space-only input
      expect(result).toBeDefined();
    });

    it('should compute compression ratio correctly', async () => {
      const result = await agent.executeCapability('summarize', {
        text: 'one two three four five six seven eight nine ten eleven twelve',
      }) as any;
      expect(result.compressionRatio).toBeLessThanOrEqual(1);
      expect(result.compressionRatio).toBeGreaterThanOrEqual(0);
    });

    it('should append ellipsis to summary', async () => {
      const result = await agent.executeCapability('summarize', {
        text: 'one two three four five six',
      }) as any;
      expect(result.summary).toMatch(/\.\.\.$/);
    });
  });

  describe('fact_check', () => {
    it('should handle empty claim', async () => {
      const result = await agent.executeCapability('fact_check', { claim: '' }) as any;
      expect(result.claim).toBe('');
      expect(result.verdict).toBeDefined();
    });

    it('should always return partially_true verdict (simulated)', async () => {
      const result = await agent.executeCapability('fact_check', {
        claim: 'Water is wet',
      }) as any;
      expect(result.verdict).toBe('partially_true');
    });

    it('should include confidence score', async () => {
      const result = await agent.executeCapability('fact_check', {
        claim: 'Test claim',
      }) as any;
      expect(result.confidence).toBe(0.75);
    });

    it('should include evidence array', async () => {
      const result = await agent.executeCapability('fact_check', {
        claim: 'Test',
      }) as any;
      expect(result.evidence).toBeInstanceOf(Array);
      expect(result.evidence.length).toBeGreaterThan(0);
    });

    it('should include checkedAt timestamp', async () => {
      const before = Date.now();
      const result = await agent.executeCapability('fact_check', { claim: 'Test' }) as any;
      expect(result.checkedAt).toBeGreaterThanOrEqual(before);
    });
  });
});

describe('AnalysisAgent - Deep Edge Cases', () => {
  let agent: MeshNode;

  beforeEach(() => {
    agent = createAnalysisAgent(testConfig);
  });

  describe('data_analysis', () => {
    it('should handle empty array', async () => {
      const result = await agent.executeCapability('data_analysis', { data: [] }) as any;
      expect(result.statistics.count).toBe(0);
      expect(result.statistics.type).toBe('non-numeric');
    });

    it('should handle single element', async () => {
      const result = await agent.executeCapability('data_analysis', { data: [42] }) as any;
      expect(result.statistics.count).toBe(1);
      expect(result.statistics.mean).toBe(42);
      expect(result.statistics.min).toBe(42);
      expect(result.statistics.max).toBe(42);
      expect(result.statistics.range).toBe(0);
    });

    it('should handle negative numbers', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [-10, -5, 0, 5, 10],
      }) as any;
      expect(result.statistics.min).toBe(-10);
      expect(result.statistics.max).toBe(10);
      expect(result.statistics.mean).toBe(0);
      expect(result.statistics.range).toBe(20);
    });

    it('should handle floating point numbers', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [1.5, 2.5, 3.5],
      }) as any;
      expect(result.statistics.mean).toBe(2.5);
    });

    it('should handle mixed numeric and non-numeric data', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [1, 'text', 2, null, 3],
      }) as any;
      expect(result.statistics.count).toBe(3); // Only numeric
      expect(result.statistics.mean).toBe(2);
    });

    it('should handle all analysis types', async () => {
      for (const type of ['trend', 'anomaly', 'correlation', 'summary']) {
        const result = await agent.executeCapability('data_analysis', {
          data: [1, 2, 3],
          analysisType: type,
        }) as any;
        expect(result.analysisType).toBe(type);
      }
    });

    it('should provide insights about dataset', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [10, 20, 30],
        analysisType: 'trend',
      }) as any;
      expect(result.insights).toBeInstanceOf(Array);
      expect(result.insights.length).toBeGreaterThan(0);
      expect(result.insights[0]).toContain('3 data points');
    });

    it('should handle very large numbers', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1],
      }) as any;
      expect(result.statistics.count).toBe(2);
      expect(isFinite(result.statistics.mean)).toBe(true);
    });

    it('should handle all zeros', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [0, 0, 0, 0],
      }) as any;
      expect(result.statistics.mean).toBe(0);
      expect(result.statistics.range).toBe(0);
    });
  });

  describe('sentiment_analysis', () => {
    it('should handle empty text', async () => {
      const result = await agent.executeCapability('sentiment_analysis', { text: '' }) as any;
      expect(result.sentiment).toBeDefined();
    });

    it('should handle text with only positive words', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'good great excellent amazing wonderful',
      }) as any;
      expect(result.sentiment).toBe('positive');
      expect(result.score).toBe(1);
    });

    it('should handle text with only negative words', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'bad terrible awful horrible hate',
      }) as any;
      expect(result.sentiment).toBe('negative');
      expect(result.score).toBe(-1);
    });

    it('should handle equal positive and negative words', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'good bad',
      }) as any;
      expect(result.sentiment).toBe('mixed');
      expect(result.score).toBe(0);
    });

    it('should count word occurrences in wordCount', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'one two three four five',
      }) as any;
      expect(result.wordCount).toBe(5);
    });

    it('should be case insensitive', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'GOOD GREAT EXCELLENT',
      }) as any;
      expect(result.sentiment).toBe('positive');
    });

    it('should include emotions object', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'This is a good product',
      }) as any;
      expect(result.emotions).toBeDefined();
      expect(typeof result.emotions.joy).toBe('number');
      expect(typeof result.emotions.anger).toBe('number');
      expect(typeof result.emotions.neutral).toBe('number');
    });

    it('should include analyzedAt timestamp', async () => {
      const before = Date.now();
      const result = await agent.executeCapability('sentiment_analysis', { text: 'test' }) as any;
      expect(result.analyzedAt).toBeGreaterThanOrEqual(before);
    });

    it('should handle repeated positive words', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'love love love love love',
      }) as any;
      expect(result.sentiment).toBe('positive');
      expect(result.score).toBe(1);
    });

    it('should produce score between -1 and 1', async () => {
      for (const text of [
        'good bad terrible amazing',
        'neutral text here',
        'love hate mixed feelings',
        'wonderful terrible bad good great awful',
      ]) {
        const result = await agent.executeCapability('sentiment_analysis', { text }) as any;
        expect(result.score).toBeGreaterThanOrEqual(-1);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('risk_assessment', () => {
    it('should handle empty scenario', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: '',
      }) as any;
      expect(result.scenario).toBe('');
      expect(result.riskLevel).toBe('low');
    });

    it('should handle no factors', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Test',
      }) as any;
      expect(result.riskLevel).toBe('low');
      expect(result.riskScore).toBe(0);
      expect(result.analyzedFactors).toEqual([]);
    });

    it('should handle exactly 1 factor', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Test',
        factors: ['factor1'],
      }) as any;
      expect(result.riskLevel).toBe('low');
      expect(result.riskScore).toBe(0.2);
    });

    it('should handle exactly 2 factors (medium threshold)', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Test',
        factors: ['f1', 'f2'],
      }) as any;
      expect(result.riskLevel).toBe('medium');
      expect(result.riskScore).toBe(0.4);
    });

    it('should handle exactly 3 factors (high threshold)', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Test',
        factors: ['f1', 'f2', 'f3'],
      }) as any;
      expect(result.riskLevel).toBe('high');
      expect(result.riskScore).toBe(0.6);
    });

    it('should handle exactly 4 factors (critical threshold)', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Test',
        factors: ['f1', 'f2', 'f3', 'f4'],
      }) as any;
      expect(result.riskLevel).toBe('critical');
      expect(result.riskScore).toBe(0.8);
    });

    it('should cap risk score at 1.0 for 5+ factors', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Test',
        factors: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'],
      }) as any;
      expect(result.riskScore).toBe(1);
      expect(result.riskLevel).toBe('critical');
    });

    it('should cycle impact and likelihood for factors', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Test',
        factors: ['a', 'b', 'c', 'd', 'e', 'f'],
      }) as any;

      const impacts = result.analyzedFactors.map((f: any) => f.impact);
      expect(impacts).toEqual(['low', 'medium', 'high', 'low', 'medium', 'high']);

      const likelihoods = result.analyzedFactors.map((f: any) => f.likelihood);
      expect(likelihoods).toEqual(['unlikely', 'possible', 'likely', 'unlikely', 'possible', 'likely']);
    });

    it('should always include 3 mitigations', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Test',
        factors: ['f1'],
      }) as any;
      expect(result.mitigations).toHaveLength(3);
    });

    it('should include assessedAt timestamp', async () => {
      const before = Date.now();
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Test',
      }) as any;
      expect(result.assessedAt).toBeGreaterThanOrEqual(before);
    });
  });
});

describe('CoordinatorAgent - Deep Edge Cases', () => {
  let agent: MeshNode;

  beforeEach(() => {
    agent = createCoordinatorAgent(testConfig);
  });

  describe('task_decomposition', () => {
    it('should default maxSubtasks to 5', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Complex task',
      }) as any;
      // Default produces 4 subtasks (the template has 4)
      expect(result.subtasks.length).toBeLessThanOrEqual(5);
      expect(result.subtasks.length).toBe(4);
    });

    it('should limit to maxSubtasks=1', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Task',
        maxSubtasks: 1,
      }) as any;
      expect(result.subtasks).toHaveLength(1);
    });

    it('should limit to maxSubtasks=3', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Task',
        maxSubtasks: 3,
      }) as any;
      expect(result.subtasks).toHaveLength(3);
    });

    it('should include dependency information', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Full decomposition',
      }) as any;
      expect(result.dependencies).toBeDefined();
      expect(result.dependencies.subtask_2).toEqual(['subtask_1']);
    });

    it('should set execution plan to parallel-where-possible', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Any task',
      }) as any;
      expect(result.executionPlan).toBe('parallel-where-possible');
    });

    it('should estimate duration based on subtask count', async () => {
      const r1 = await agent.executeCapability('task_decomposition', {
        task: 'Task', maxSubtasks: 1,
      }) as any;
      const r4 = await agent.executeCapability('task_decomposition', {
        task: 'Task', maxSubtasks: 4,
      }) as any;

      expect(r4.estimatedDuration).toBeGreaterThan(r1.estimatedDuration);
    });

    it('should assign required capabilities to subtasks', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Task',
      }) as any;

      const capabilities = result.subtasks.map((s: any) => s.requiredCapability);
      expect(capabilities).toContain('web_research');
      expect(capabilities).toContain('data_analysis');
    });

    it('should set priority order for subtasks', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Ordered task',
      }) as any;

      // First subtask has priority 1, later ones have higher priorities
      expect(result.subtasks[0].priority).toBe(1);
    });
  });

  describe('result_synthesis', () => {
    it('should handle empty results array', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [],
      }) as any;
      expect(result.contributingAgents).toBe(0);
      expect(result.resultCount).toBe(0);
    });

    it('should handle single result', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [{ data: 'single' }],
      }) as any;
      expect(result.contributingAgents).toBe(1);
    });

    it('should handle many results', async () => {
      const results = Array(20).fill(null).map((_, i) => ({ data: `result_${i}` }));
      const result = await agent.executeCapability('result_synthesis', { results }) as any;
      expect(result.contributingAgents).toBe(20);
    });

    it('should use default originalTask when not provided', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [{ data: 'test' }],
      }) as any;
      expect(result.synthesis).toContain('Unknown task');
    });

    it('should include recommendations', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [{ data: 'test' }],
      }) as any;
      expect(result.recommendations).toBeInstanceOf(Array);
      expect(result.recommendations.length).toBe(3);
    });

    it('should include confidence score', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [{ data: 'test' }],
      }) as any;
      expect(result.confidence).toBe(0.85);
    });

    it('should include synthesizedAt timestamp', async () => {
      const before = Date.now();
      const result = await agent.executeCapability('result_synthesis', {
        results: [],
      }) as any;
      expect(result.synthesizedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('agent_selection', () => {
    it('should handle empty required capabilities', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: [],
      }) as any;
      expect(result.selectedAgents).toEqual([]);
      expect(result.unmatched).toEqual([]);
    });

    it('should default task complexity to moderate', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['cap1'],
      }) as any;
      expect(result.taskComplexity).toBe('moderate');
    });

    it('should report all as unmatched when no agents in registry', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['cap1', 'cap2', 'cap3'],
      }) as any;
      expect(result.unmatched).toEqual(['cap1', 'cap2', 'cap3']);
      expect(result.selectedAgents).toEqual([]);
    });

    it('should support all complexity levels', async () => {
      for (const complexity of ['simple', 'moderate', 'complex']) {
        const result = await agent.executeCapability('agent_selection', {
          requiredCapabilities: ['cap1'],
          taskComplexity: complexity,
        }) as any;
        expect(result.taskComplexity).toBe(complexity);
        expect(result.reasoning).toContain(complexity);
      }
    });

    it('should include selection criteria', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['cap1'],
      }) as any;
      expect(result.selectionCriteria).toBe('capability-match + availability');
    });
  });
});

describe('Agent Factory Functions', () => {
  it('should create distinct MeshNode instances', () => {
    const research = createResearchAgent(testConfig);
    const analysis = createAnalysisAgent(testConfig);
    const coordinator = createCoordinatorAgent(testConfig);

    expect(research).not.toBe(analysis);
    expect(analysis).not.toBe(coordinator);
    expect(research).not.toBe(coordinator);
  });

  it('should all be MeshNode instances', () => {
    expect(createResearchAgent(testConfig)).toBeInstanceOf(MeshNode);
    expect(createAnalysisAgent(testConfig)).toBeInstanceOf(MeshNode);
    expect(createCoordinatorAgent(testConfig)).toBeInstanceOf(MeshNode);
  });

  it('should not share capability handlers between instances', async () => {
    const research1 = createResearchAgent(testConfig);
    const research2 = createResearchAgent(testConfig);

    // Override handler on first instance
    research1.registerCapabilityHandler('web_research', async () => 'overridden');

    const r1 = await research1.executeCapability('web_research', { query: 'test' });
    const r2 = await research2.executeCapability('web_research', { query: 'test' }) as any;

    expect(r1).toBe('overridden');
    expect(r2.findings).toBeDefined(); // Original handler
  });
});
