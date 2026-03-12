/**
 * Comprehensive tests for specialized agents:
 * ResearchAgent, AnalysisAgent, CoordinatorAgent
 */

import { createResearchAgent } from '../agents/research-agent';
import { createAnalysisAgent } from '../agents/analysis-agent';
import { createCoordinatorAgent } from '../agents/coordinator-agent';
import { MeshNode } from '../core/mesh-node';
import { HederaClient } from '../core/hedera-client';
import { MeshConfig } from '../core/types';

jest.mock('../core/hedera-client');

const TEST_CONFIG: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.1',
  operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
};

function mockNode(node: MeshNode): void {
  const client = (node as any).hederaClient as jest.Mocked<HederaClient>;
  client.createTopic = jest.fn().mockResolvedValue('0.0.100');
  client.submitMessage = jest.fn().mockResolvedValue(1);
  client.subscribeTopic = jest.fn();
  client.getOperatorAccountId = jest.fn().mockReturnValue('0.0.1');
  client.close = jest.fn();
  client.emit = jest.fn().mockReturnValue(true);
}

describe('ResearchAgent', () => {
  let agent: MeshNode;

  beforeEach(() => {
    agent = createResearchAgent(TEST_CONFIG);
    mockNode(agent);
  });

  afterEach(async () => {
    await agent.stop();
  });

  describe('Creation', () => {
    it('should create with correct name', () => {
      expect((agent as any).options.agentName).toBe('ResearchAgent');
    });

    it('should have research-related capabilities', () => {
      const caps = (agent as any).options.capabilities;
      const names = caps.map((c: any) => c.name);
      expect(names).toContain('web_research');
      expect(names).toContain('summarize');
      expect(names).toContain('fact_check');
    });

    it('should have 3 capabilities', () => {
      expect((agent as any).options.capabilities).toHaveLength(3);
    });
  });

  describe('web_research capability', () => {
    it('should return findings for a query', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'AI trends 2025',
      }) as any;

      expect(result.findings).toBeDefined();
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.summary).toContain('AI trends 2025');
    });

    it('should use default depth of medium', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'test',
      }) as any;

      expect(result.researchDepth).toBe('medium');
    });

    it('should use custom depth', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'test',
        depth: 'deep',
      }) as any;

      expect(result.researchDepth).toBe('deep');
    });

    it('should include sources', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'test',
      }) as any;

      expect(result.sources).toBeDefined();
      expect(result.sources.length).toBeGreaterThan(0);
    });

    it('should include timestamp', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'test',
      }) as any;

      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('number');
    });

    it('should include query in findings', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'blockchain scalability',
      }) as any;

      const allFindings = result.findings.join(' ');
      expect(allFindings).toContain('blockchain scalability');
    });

    it('should handle shallow depth', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'test',
        depth: 'shallow',
      }) as any;

      expect(result.researchDepth).toBe('shallow');
    });
  });

  describe('summarize capability', () => {
    it('should summarize text', async () => {
      const text = 'This is a long text that needs to be summarized into key points for better understanding and consumption by the reader';
      const result = await agent.executeCapability('summarize', {
        text,
      }) as any;

      expect(result.summary).toBeDefined();
      expect(result.keyPoints).toBeDefined();
    });

    it('should include original length', async () => {
      const text = 'word1 word2 word3 word4 word5';
      const result = await agent.executeCapability('summarize', {
        text,
      }) as any;

      expect(result.originalLength).toBe(5);
    });

    it('should include compression ratio', async () => {
      const text = 'one two three four five six seven eight nine ten';
      const result = await agent.executeCapability('summarize', {
        text,
      }) as any;

      expect(result.compressionRatio).toBeGreaterThan(0);
      expect(result.compressionRatio).toBeLessThanOrEqual(1);
    });

    it('should respect maxPoints', async () => {
      const text = 'This is a reasonably long text with many words to summarize into points';
      const result = await agent.executeCapability('summarize', {
        text,
        maxPoints: 2,
      }) as any;

      expect(result.keyPoints.length).toBeLessThanOrEqual(2);
    });

    it('should use default maxPoints of 5', async () => {
      const text = 'This is a text that has enough words to generate some summary points';
      const result = await agent.executeCapability('summarize', {
        text,
      }) as any;

      expect(result.keyPoints.length).toBeLessThanOrEqual(5);
    });

    it('should handle single word text', async () => {
      const result = await agent.executeCapability('summarize', {
        text: 'hello',
      }) as any;

      expect(result.originalLength).toBe(1);
    });

    it('should handle empty text', async () => {
      const result = await agent.executeCapability('summarize', {
        text: '',
      }) as any;

      expect(result).toBeDefined();
    });
  });

  describe('fact_check capability', () => {
    it('should check a claim', async () => {
      const result = await agent.executeCapability('fact_check', {
        claim: 'Water boils at 100 degrees Celsius',
      }) as any;

      expect(result.claim).toBe('Water boils at 100 degrees Celsius');
      expect(result.verdict).toBeDefined();
      expect(result.evidence).toBeDefined();
      expect(result.confidence).toBeDefined();
    });

    it('should return verdict as partially_true', async () => {
      const result = await agent.executeCapability('fact_check', {
        claim: 'Any claim',
      }) as any;

      expect(result.verdict).toBe('partially_true');
    });

    it('should include evidence points', async () => {
      const result = await agent.executeCapability('fact_check', {
        claim: 'test claim',
      }) as any;

      expect(result.evidence.length).toBeGreaterThan(0);
    });

    it('should include confidence score', async () => {
      const result = await agent.executeCapability('fact_check', {
        claim: 'test claim',
      }) as any;

      expect(result.confidence).toBe(0.75);
    });

    it('should include checkedAt timestamp', async () => {
      const result = await agent.executeCapability('fact_check', {
        claim: 'test',
      }) as any;

      expect(result.checkedAt).toBeDefined();
      expect(typeof result.checkedAt).toBe('number');
    });
  });
});

describe('AnalysisAgent', () => {
  let agent: MeshNode;

  beforeEach(() => {
    agent = createAnalysisAgent(TEST_CONFIG);
    mockNode(agent);
  });

  afterEach(async () => {
    await agent.stop();
  });

  describe('Creation', () => {
    it('should create with correct name', () => {
      expect((agent as any).options.agentName).toBe('AnalysisAgent');
    });

    it('should have analysis capabilities', () => {
      const caps = (agent as any).options.capabilities;
      const names = caps.map((c: any) => c.name);
      expect(names).toContain('data_analysis');
      expect(names).toContain('sentiment_analysis');
      expect(names).toContain('risk_assessment');
    });

    it('should have 3 capabilities', () => {
      expect((agent as any).options.capabilities).toHaveLength(3);
    });
  });

  describe('data_analysis capability', () => {
    it('should analyze numeric data', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [1, 2, 3, 4, 5],
      }) as any;

      expect(result.statistics.count).toBe(5);
      expect(result.statistics.mean).toBe(3);
      expect(result.statistics.min).toBe(1);
      expect(result.statistics.max).toBe(5);
    });

    it('should calculate range', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [10, 50],
      }) as any;

      expect(result.statistics.range).toBe(40);
    });

    it('should handle non-numeric data', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: ['a', 'b', 'c'],
      }) as any;

      expect(result.statistics.type).toBe('non-numeric');
      expect(result.statistics.count).toBe(3);
    });

    it('should handle mixed data types', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [1, 'text', 3, null, 5],
      }) as any;

      expect(result.statistics.count).toBe(3); // only numbers
    });

    it('should use default analysis type of summary', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [1, 2, 3],
      }) as any;

      expect(result.analysisType).toBe('summary');
    });

    it('should use custom analysis type', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [1, 2, 3],
        analysisType: 'trend',
      }) as any;

      expect(result.analysisType).toBe('trend');
    });

    it('should include insights', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [1, 2, 3],
      }) as any;

      expect(result.insights).toBeDefined();
      expect(result.insights.length).toBeGreaterThan(0);
    });

    it('should include timestamp', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [1],
      }) as any;

      expect(result.timestamp).toBeDefined();
    });

    it('should handle empty data array', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [],
      }) as any;

      expect(result.statistics.type).toBe('non-numeric');
    });

    it('should handle single data point', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [42],
      }) as any;

      expect(result.statistics.count).toBe(1);
      expect(result.statistics.mean).toBe(42);
    });
  });

  describe('sentiment_analysis capability', () => {
    it('should detect positive sentiment', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'This is a great and amazing product',
      }) as any;

      expect(result.sentiment).toBe('positive');
      expect(result.score).toBeGreaterThan(0);
    });

    it('should detect negative sentiment', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'This is terrible and horrible',
      }) as any;

      expect(result.sentiment).toBe('negative');
      expect(result.score).toBeLessThan(0);
    });

    it('should detect neutral sentiment', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'The temperature is 72 degrees today',
      }) as any;

      expect(result.sentiment).toBe('neutral');
    });

    it('should detect mixed sentiment', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'The good product has terrible customer service',
      }) as any;

      expect(result.sentiment).toBe('mixed');
    });

    it('should include word count', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'one two three four five',
      }) as any;

      expect(result.wordCount).toBe(5);
    });

    it('should include emotions breakdown', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'great product',
      }) as any;

      expect(result.emotions).toBeDefined();
      expect(result.emotions).toHaveProperty('joy');
      expect(result.emotions).toHaveProperty('anger');
    });

    it('should include analyzedAt timestamp', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'test',
      }) as any;

      expect(result.analyzedAt).toBeDefined();
    });

    it('should handle text with no sentiment words', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'the quick brown fox jumps over the lazy dog',
      }) as any;

      expect(result.sentiment).toBe('neutral');
    });

    it('should be case insensitive', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'GREAT AMAZING WONDERFUL',
      }) as any;

      expect(result.sentiment).toBe('positive');
    });
  });

  describe('risk_assessment capability', () => {
    it('should assess low risk with no factors', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Simple operation',
        factors: [],
      }) as any;

      expect(result.riskLevel).toBe('low');
      expect(result.riskScore).toBe(0);
    });

    it('should assess higher risk with more factors', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Complex operation',
        factors: ['factor1', 'factor2', 'factor3', 'factor4'],
      }) as any;

      expect(['medium', 'high', 'critical']).toContain(result.riskLevel);
      expect(result.riskScore).toBeGreaterThan(0);
    });

    it('should cap risk score at 1.0', async () => {
      const factors = Array.from({ length: 20 }, (_, i) => `factor-${i}`);
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Very risky',
        factors,
      }) as any;

      expect(result.riskScore).toBeLessThanOrEqual(1);
    });

    it('should include mitigations', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Test scenario',
      }) as any;

      expect(result.mitigations).toBeDefined();
      expect(result.mitigations.length).toBeGreaterThan(0);
    });

    it('should include scenario in result', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'My specific scenario',
      }) as any;

      expect(result.scenario).toBe('My specific scenario');
    });

    it('should analyze each factor with impact and likelihood', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Test',
        factors: ['f1', 'f2', 'f3'],
      }) as any;

      expect(result.analyzedFactors).toHaveLength(3);
      result.analyzedFactors.forEach((f: any) => {
        expect(f).toHaveProperty('factor');
        expect(f).toHaveProperty('impact');
        expect(f).toHaveProperty('likelihood');
      });
    });

    it('should include assessedAt timestamp', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'test',
      }) as any;

      expect(result.assessedAt).toBeDefined();
    });

    it('should handle default empty factors', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'No factors given',
      }) as any;

      expect(result.riskLevel).toBe('low');
    });

    it('should classify medium risk correctly', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Medium risk',
        factors: ['f1', 'f2'],
      }) as any;

      expect(result.riskLevel).toBe('medium');
    });

    it('should classify high risk correctly', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'High risk',
        factors: ['f1', 'f2', 'f3'],
      }) as any;

      expect(result.riskLevel).toBe('high');
    });

    it('should classify critical risk correctly', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Critical risk',
        factors: ['f1', 'f2', 'f3', 'f4'],
      }) as any;

      expect(result.riskLevel).toBe('critical');
    });
  });
});

describe('CoordinatorAgent', () => {
  let agent: MeshNode;

  beforeEach(() => {
    agent = createCoordinatorAgent(TEST_CONFIG);
    mockNode(agent);
  });

  afterEach(async () => {
    await agent.stop();
  });

  describe('Creation', () => {
    it('should create with correct name', () => {
      expect((agent as any).options.agentName).toBe('CoordinatorAgent');
    });

    it('should have coordinator capabilities', () => {
      const caps = (agent as any).options.capabilities;
      const names = caps.map((c: any) => c.name);
      expect(names).toContain('task_decomposition');
      expect(names).toContain('result_synthesis');
      expect(names).toContain('agent_selection');
    });

    it('should have 3 capabilities', () => {
      expect((agent as any).options.capabilities).toHaveLength(3);
    });
  });

  describe('task_decomposition capability', () => {
    it('should decompose a task into subtasks', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Analyze market trends',
      }) as any;

      expect(result.subtasks).toBeDefined();
      expect(result.subtasks.length).toBeGreaterThan(0);
    });

    it('should include original task', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Build a dashboard',
      }) as any;

      expect(result.originalTask).toBe('Build a dashboard');
    });

    it('should include dependencies', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Complex task',
      }) as any;

      expect(result.dependencies).toBeDefined();
    });

    it('should include execution plan', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Plan task',
      }) as any;

      expect(result.executionPlan).toBe('parallel-where-possible');
    });

    it('should respect maxSubtasks', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Limit subtasks',
        maxSubtasks: 2,
      }) as any;

      expect(result.subtasks.length).toBeLessThanOrEqual(2);
    });

    it('should default maxSubtasks to 5', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Default limit',
      }) as any;

      expect(result.subtasks.length).toBeLessThanOrEqual(5);
    });

    it('should include estimated duration', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Duration test',
      }) as any;

      expect(result.estimatedDuration).toBeDefined();
      expect(result.estimatedDuration).toBeGreaterThan(0);
    });

    it('should assign required capabilities to subtasks', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Capability assignment',
      }) as any;

      result.subtasks.forEach((st: any) => {
        expect(st.requiredCapability).toBeDefined();
      });
    });

    it('should assign priorities to subtasks', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Priority test',
      }) as any;

      result.subtasks.forEach((st: any) => {
        expect(st.priority).toBeDefined();
        expect(typeof st.priority).toBe('number');
      });
    });
  });

  describe('result_synthesis capability', () => {
    it('should synthesize multiple results', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [{ data: 'result1' }, { data: 'result2' }],
        originalTask: 'Market analysis',
      }) as any;

      expect(result.synthesis).toContain('Market analysis');
      expect(result.confidence).toBeDefined();
    });

    it('should report contributing agents count', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: ['r1', 'r2', 'r3'],
      }) as any;

      expect(result.contributingAgents).toBe(3);
    });

    it('should include confidence score', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: ['r1'],
      }) as any;

      expect(result.confidence).toBe(0.85);
    });

    it('should include recommendations', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: ['r1'],
      }) as any;

      expect(result.recommendations).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('should include synthesizedAt timestamp', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [],
      }) as any;

      expect(result.synthesizedAt).toBeDefined();
    });

    it('should handle empty results array', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [],
      }) as any;

      expect(result.contributingAgents).toBe(0);
    });

    it('should use "Unknown task" for missing originalTask', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: ['r1'],
      }) as any;

      expect(result.synthesis).toContain('Unknown task');
    });
  });

  describe('agent_selection capability', () => {
    it('should return selected agents list', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['web_research', 'data_analysis'],
      }) as any;

      expect(result.selectedAgents).toBeDefined();
      expect(Array.isArray(result.selectedAgents)).toBe(true);
    });

    it('should include reasoning', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['cap1'],
      }) as any;

      expect(result.reasoning).toBeDefined();
    });

    it('should report unmatched capabilities', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['nonexistent_cap'],
      }) as any;

      expect(result.unmatched).toContain('nonexistent_cap');
    });

    it('should use default task complexity of moderate', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['cap1'],
      }) as any;

      expect(result.taskComplexity).toBe('moderate');
    });

    it('should accept custom task complexity', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['cap1'],
        taskComplexity: 'complex',
      }) as any;

      expect(result.taskComplexity).toBe('complex');
    });

    it('should include selection criteria', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['cap1'],
      }) as any;

      expect(result.selectionCriteria).toBe('capability-match + availability');
    });

    it('should handle empty required capabilities', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: [],
      }) as any;

      expect(result.selectedAgents).toEqual([]);
    });
  });
});
