/**
 * Deep tests for specialized agent capability handlers.
 *
 * Covers: boundary inputs, empty inputs, large inputs, handler return value validation,
 * and edge cases in data processing logic.
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

describe('ResearchAgent - Deep Capability Tests', () => {
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

    it('should handle very long query string', async () => {
      const longQuery = 'a'.repeat(10000);
      const result = await agent.executeCapability('web_research', { query: longQuery }) as any;
      expect(result.findings).toHaveLength(3);
    });

    it('should handle special characters in query', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'test <script>alert("xss")</script> & foo=bar',
      }) as any;
      expect(result.findings).toBeDefined();
      expect(result.summary).toContain('<script>');
    });

    it('should handle shallow depth', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'test',
        depth: 'shallow',
      }) as any;
      expect(result.researchDepth).toBe('shallow');
    });

    it('should handle deep depth', async () => {
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

    it('should include sources', async () => {
      const result = await agent.executeCapability('web_research', { query: 'test' }) as any;
      expect(result.sources).toBeInstanceOf(Array);
      expect(result.sources.length).toBeGreaterThan(0);
    });
  });

  describe('summarize', () => {
    it('should handle single word text', async () => {
      const result = await agent.executeCapability('summarize', { text: 'hello' }) as any;
      expect(result.originalLength).toBe(1);
      expect(result.compressionRatio).toBeDefined();
    });

    it('should handle empty text', async () => {
      const result = await agent.executeCapability('summarize', { text: '' }) as any;
      expect(result.originalLength).toBe(1); // split on empty gives ['']
    });

    it('should handle text with only whitespace', async () => {
      const result = await agent.executeCapability('summarize', { text: '   ' }) as any;
      expect(result).toBeDefined();
    });

    it('should respect maxPoints parameter', async () => {
      const result = await agent.executeCapability('summarize', {
        text: 'This is a long text with many words to test the summarization capability',
        maxPoints: 1,
      }) as any;
      expect(result.keyPoints.length).toBeLessThanOrEqual(1);
    });

    it('should default maxPoints to 5', async () => {
      const result = await agent.executeCapability('summarize', {
        text: 'word '.repeat(100),
      }) as any;
      expect(result.keyPoints.length).toBeLessThanOrEqual(5);
    });

    it('should calculate compression ratio <= 1', async () => {
      const result = await agent.executeCapability('summarize', {
        text: 'word '.repeat(50),
      }) as any;
      expect(result.compressionRatio).toBeLessThanOrEqual(1);
      expect(result.compressionRatio).toBeGreaterThanOrEqual(0);
    });
  });

  describe('fact_check', () => {
    it('should return claim in result', async () => {
      const claim = 'Water boils at 100 degrees celsius at sea level';
      const result = await agent.executeCapability('fact_check', { claim }) as any;
      expect(result.claim).toBe(claim);
    });

    it('should handle empty claim', async () => {
      const result = await agent.executeCapability('fact_check', { claim: '' }) as any;
      expect(result.claim).toBe('');
      expect(result.verdict).toBeDefined();
    });

    it('should return confidence between 0 and 1', async () => {
      const result = await agent.executeCapability('fact_check', { claim: 'test' }) as any;
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should include evidence array', async () => {
      const result = await agent.executeCapability('fact_check', { claim: 'test' }) as any;
      expect(result.evidence).toBeInstanceOf(Array);
      expect(result.evidence.length).toBeGreaterThan(0);
    });

    it('should include checkedAt timestamp', async () => {
      const result = await agent.executeCapability('fact_check', { claim: 'test' }) as any;
      expect(result.checkedAt).toBeDefined();
      expect(typeof result.checkedAt).toBe('number');
    });
  });
});

describe('AnalysisAgent - Deep Capability Tests', () => {
  let agent: MeshNode;

  beforeEach(() => {
    agent = createAnalysisAgent(testConfig);
  });

  describe('data_analysis', () => {
    it('should handle empty data array', async () => {
      const result = await agent.executeCapability('data_analysis', { data: [] }) as any;
      expect(result.insights).toBeDefined();
      expect(result.statistics.count).toBe(0);
    });

    it('should handle single data point', async () => {
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

    it('should handle mixed numeric and non-numeric data', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [1, 'two', 3, null, 5],
      }) as any;
      // Only numeric values: 1, 3, 5
      expect(result.statistics.count).toBe(3);
      expect(result.statistics.mean).toBe(3);
    });

    it('should handle all analysis types', async () => {
      const types = ['trend', 'anomaly', 'correlation', 'summary'];
      for (const type of types) {
        const result = await agent.executeCapability('data_analysis', {
          data: [1, 2, 3],
          analysisType: type,
        }) as any;
        expect(result.analysisType).toBe(type);
      }
    });

    it('should handle floating point data', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [0.1, 0.2, 0.3],
      }) as any;
      expect(result.statistics.mean).toBeCloseTo(0.2, 5);
    });

    it('should include timestamp', async () => {
      const result = await agent.executeCapability('data_analysis', { data: [1] }) as any;
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('sentiment_analysis', () => {
    it('should handle empty text', async () => {
      const result = await agent.executeCapability('sentiment_analysis', { text: '' }) as any;
      expect(result.sentiment).toBeDefined();
    });

    it('should handle text with no sentiment words', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'the cat sat on the mat',
      }) as any;
      expect(result.sentiment).toBe('neutral');
    });

    it('should handle all-positive text', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'great amazing wonderful excellent fantastic',
      }) as any;
      expect(result.sentiment).toBe('positive');
      expect(result.score).toBe(1);
    });

    it('should handle all-negative text', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'terrible awful horrible hate worst',
      }) as any;
      expect(result.sentiment).toBe('negative');
      expect(result.score).toBe(-1);
    });

    it('should detect mixed sentiment', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'great but terrible experience',
      }) as any;
      expect(result.sentiment).toBe('mixed');
    });

    it('should be case insensitive', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'GREAT AMAZING WONDERFUL',
      }) as any;
      expect(result.sentiment).toBe('positive');
    });

    it('should return wordCount', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'one two three four five',
      }) as any;
      expect(result.wordCount).toBe(5);
    });

    it('should return emotions object', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'great product',
      }) as any;
      expect(result.emotions).toBeDefined();
      expect(result.emotions).toHaveProperty('joy');
      expect(result.emotions).toHaveProperty('anger');
      expect(result.emotions).toHaveProperty('neutral');
    });

    it('should include analyzedAt timestamp', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'test',
      }) as any;
      expect(result.analyzedAt).toBeDefined();
    });
  });

  describe('risk_assessment', () => {
    it('should handle empty factors', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'test',
      }) as any;
      expect(result.riskLevel).toBe('low');
      expect(result.riskScore).toBe(0);
      expect(result.analyzedFactors).toEqual([]);
    });

    it('should handle 1 factor (medium risk)', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'test',
        factors: ['factor1'],
      }) as any;
      expect(result.riskScore).toBe(0.2);
      expect(result.riskLevel).toBe('low');
    });

    it('should handle 2 factors (medium risk)', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'test',
        factors: ['f1', 'f2'],
      }) as any;
      expect(result.riskScore).toBe(0.4);
      expect(result.riskLevel).toBe('medium');
    });

    it('should handle 3 factors (high risk)', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'test',
        factors: ['f1', 'f2', 'f3'],
      }) as any;
      expect(result.riskScore).toBe(0.6);
      expect(result.riskLevel).toBe('high');
    });

    it('should handle 4 factors (high risk)', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'test',
        factors: ['f1', 'f2', 'f3', 'f4'],
      }) as any;
      expect(result.riskScore).toBe(0.8);
      expect(result.riskLevel).toBe('critical');
    });

    it('should cap risk score at 1.0', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'test',
        factors: Array.from({ length: 10 }, (_, i) => `f${i}`),
      }) as any;
      expect(result.riskScore).toBe(1);
      expect(result.riskLevel).toBe('critical');
    });

    it('should assign rotating impact and likelihood to factors', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'test',
        factors: ['f1', 'f2', 'f3'],
      }) as any;
      expect(result.analyzedFactors[0].impact).toBe('low');
      expect(result.analyzedFactors[1].impact).toBe('medium');
      expect(result.analyzedFactors[2].impact).toBe('high');
    });

    it('should include mitigations', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'test',
        factors: ['f1'],
      }) as any;
      expect(result.mitigations).toBeInstanceOf(Array);
      expect(result.mitigations.length).toBeGreaterThan(0);
    });

    it('should include assessedAt timestamp', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'test',
      }) as any;
      expect(result.assessedAt).toBeDefined();
    });

    it('should preserve scenario in result', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Deploy critical update',
        factors: [],
      }) as any;
      expect(result.scenario).toBe('Deploy critical update');
    });
  });
});

describe('CoordinatorAgent - Deep Capability Tests', () => {
  let agent: MeshNode;

  beforeEach(() => {
    agent = createCoordinatorAgent(testConfig);
  });

  describe('task_decomposition', () => {
    it('should default maxSubtasks to 5', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Complex task',
      }) as any;
      expect(result.subtasks.length).toBeLessThanOrEqual(5);
    });

    it('should respect maxSubtasks of 1', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Task',
        maxSubtasks: 1,
      }) as any;
      expect(result.subtasks).toHaveLength(1);
    });

    it('should create subtasks with increasing priority', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Task',
      }) as any;
      const priorities = result.subtasks.map((s: any) => s.priority);
      // First should be lowest priority
      expect(priorities[0]).toBeLessThanOrEqual(priorities[priorities.length - 1]);
    });

    it('should include dependency information', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Task',
      }) as any;
      expect(result.dependencies).toBeDefined();
      expect(typeof result.dependencies).toBe('object');
    });

    it('should estimate duration based on subtask count', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Task',
        maxSubtasks: 3,
      }) as any;
      expect(result.estimatedDuration).toBe(3 * 2000);
    });

    it('should set executionPlan to parallel-where-possible', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Task',
      }) as any;
      expect(result.executionPlan).toBe('parallel-where-possible');
    });

    it('should preserve original task description', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Analyze global market trends',
      }) as any;
      expect(result.originalTask).toBe('Analyze global market trends');
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
        results: [{ data: 'finding' }],
        originalTask: 'Single task',
      }) as any;
      expect(result.contributingAgents).toBe(1);
      expect(result.synthesis).toContain('Single task');
    });

    it('should handle many results', async () => {
      const results = Array.from({ length: 20 }, (_, i) => ({ agent: i, data: `data-${i}` }));
      const result = await agent.executeCapability('result_synthesis', {
        results,
        originalTask: 'Big task',
      }) as any;
      expect(result.contributingAgents).toBe(20);
      expect(result.resultCount).toBe(20);
    });

    it('should default originalTask to Unknown task', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [{ data: 1 }],
      }) as any;
      expect(result.synthesis).toContain('Unknown task');
    });

    it('should return confidence value', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [{ data: 1 }],
      }) as any;
      expect(result.confidence).toBe(0.85);
    });

    it('should include recommendations', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [{ data: 1 }],
      }) as any;
      expect(result.recommendations).toBeInstanceOf(Array);
      expect(result.recommendations.length).toBe(3);
    });

    it('should include synthesizedAt timestamp', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [],
      }) as any;
      expect(result.synthesizedAt).toBeDefined();
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

    it('should default taskComplexity to moderate', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['a'],
      }) as any;
      expect(result.taskComplexity).toBe('moderate');
    });

    it('should accept all complexity levels', async () => {
      for (const complexity of ['simple', 'moderate', 'complex']) {
        const result = await agent.executeCapability('agent_selection', {
          requiredCapabilities: ['a'],
          taskComplexity: complexity,
        }) as any;
        expect(result.taskComplexity).toBe(complexity);
      }
    });

    it('should include selection criteria', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['a'],
      }) as any;
      expect(result.selectionCriteria).toBe('capability-match + availability');
    });

    it('should track unmatched capabilities', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['nonexistent1', 'nonexistent2'],
      }) as any;
      expect(result.unmatched).toContain('nonexistent1');
      expect(result.unmatched).toContain('nonexistent2');
    });

    it('should include reasoning with capability count', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['a', 'b', 'c'],
        taskComplexity: 'complex',
      }) as any;
      expect(result.reasoning).toContain('3 capabilities');
      expect(result.reasoning).toContain('complex');
    });
  });
});
