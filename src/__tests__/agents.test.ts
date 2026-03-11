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

describe('Specialized Agents', () => {
  describe('ResearchAgent', () => {
    let agent: MeshNode;

    beforeEach(() => {
      agent = createResearchAgent(testConfig);
    });

    it('should create a MeshNode instance', () => {
      expect(agent).toBeInstanceOf(MeshNode);
    });

    it('should have web_research capability handler', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'AI trends 2026',
        depth: 'deep',
      });

      expect(result).toBeDefined();
      const r = result as any;
      expect(r.findings).toHaveLength(3);
      expect(r.summary).toContain('AI trends 2026');
      expect(r.researchDepth).toBe('deep');
    });

    it('should default depth to medium', async () => {
      const result = await agent.executeCapability('web_research', {
        query: 'test query',
      }) as any;

      expect(result.researchDepth).toBe('medium');
    });

    it('should have summarize capability handler', async () => {
      const result = await agent.executeCapability('summarize', {
        text: 'This is a long text that needs to be summarized into key points for the reader',
        maxPoints: 3,
      }) as any;

      expect(result.summary).toBeDefined();
      expect(result.keyPoints).toBeDefined();
      expect(result.keyPoints.length).toBeLessThanOrEqual(3);
      expect(result.originalLength).toBeGreaterThan(0);
      expect(result.compressionRatio).toBeLessThanOrEqual(1);
    });

    it('should have fact_check capability handler', async () => {
      const result = await agent.executeCapability('fact_check', {
        claim: 'The sky is blue',
      }) as any;

      expect(result.claim).toBe('The sky is blue');
      expect(result.verdict).toBeDefined();
      expect(result.evidence).toBeInstanceOf(Array);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should throw for unknown capability', async () => {
      await expect(
        agent.executeCapability('unknown_cap', {})
      ).rejects.toThrow('No handler for capability');
    });
  });

  describe('AnalysisAgent', () => {
    let agent: MeshNode;

    beforeEach(() => {
      agent = createAnalysisAgent(testConfig);
    });

    it('should create a MeshNode instance', () => {
      expect(agent).toBeInstanceOf(MeshNode);
    });

    it('should have data_analysis capability with numeric data', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [10, 20, 30, 40, 50],
        analysisType: 'trend',
      }) as any;

      expect(result.analysisType).toBe('trend');
      expect(result.statistics.count).toBe(5);
      expect(result.statistics.mean).toBe(30);
      expect(result.statistics.min).toBe(10);
      expect(result.statistics.max).toBe(50);
      expect(result.statistics.range).toBe(40);
    });

    it('should handle non-numeric data', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: ['a', 'b', 'c'],
      }) as any;

      expect(result.statistics.type).toBe('non-numeric');
      expect(result.statistics.count).toBe(3);
    });

    it('should default analysis type to summary', async () => {
      const result = await agent.executeCapability('data_analysis', {
        data: [1, 2, 3],
      }) as any;

      expect(result.analysisType).toBe('summary');
    });

    it('should have sentiment_analysis capability', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'This is a great and amazing product',
      }) as any;

      expect(result.sentiment).toBe('positive');
      expect(result.score).toBeGreaterThan(0);
      expect(result.emotions).toBeDefined();
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
        text: 'The weather today is cloudy',
      }) as any;

      expect(result.sentiment).toBe('neutral');
    });

    it('should detect mixed sentiment', async () => {
      const result = await agent.executeCapability('sentiment_analysis', {
        text: 'great product but terrible service',
      }) as any;

      expect(result.sentiment).toBe('mixed');
    });

    it('should have risk_assessment capability', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Deploy new feature to production',
        factors: ['untested code', 'no rollback plan', 'peak traffic'],
      }) as any;

      expect(result.riskLevel).toBeDefined();
      expect(result.analyzedFactors).toHaveLength(3);
      expect(result.mitigations).toBeInstanceOf(Array);
      expect(result.riskScore).toBeGreaterThan(0);
    });

    it('should assess low risk with few factors', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Simple change',
        factors: [],
      }) as any;

      expect(result.riskLevel).toBe('low');
      expect(result.riskScore).toBe(0);
    });

    it('should assess high risk with many factors', async () => {
      const result = await agent.executeCapability('risk_assessment', {
        scenario: 'Major migration',
        factors: ['f1', 'f2', 'f3', 'f4', 'f5'],
      }) as any;

      expect(result.riskLevel).toBe('critical');
      expect(result.riskScore).toBe(1);
    });
  });

  describe('CoordinatorAgent', () => {
    let agent: MeshNode;

    beforeEach(() => {
      agent = createCoordinatorAgent(testConfig);
    });

    it('should create a MeshNode instance', () => {
      expect(agent).toBeInstanceOf(MeshNode);
    });

    it('should have task_decomposition capability', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Analyze market trends for AI startups',
      }) as any;

      expect(result.originalTask).toBe('Analyze market trends for AI startups');
      expect(result.subtasks).toBeInstanceOf(Array);
      expect(result.subtasks.length).toBeGreaterThan(0);
      expect(result.dependencies).toBeDefined();
      expect(result.executionPlan).toBe('parallel-where-possible');
    });

    it('should respect maxSubtasks', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Test task',
        maxSubtasks: 2,
      }) as any;

      expect(result.subtasks).toHaveLength(2);
    });

    it('should create subtasks with required capabilities', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Complex task',
      }) as any;

      for (const subtask of result.subtasks) {
        expect(subtask.requiredCapability).toBeDefined();
        expect(subtask.id).toBeDefined();
        expect(subtask.description).toBeDefined();
      }
    });

    it('should have result_synthesis capability', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [
          { agent: 'research', data: 'findings' },
          { agent: 'analysis', data: 'insights' },
        ],
        originalTask: 'Market analysis',
      }) as any;

      expect(result.synthesis).toContain('Market analysis');
      expect(result.contributingAgents).toBe(2);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.recommendations).toBeInstanceOf(Array);
    });

    it('should have agent_selection capability', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['research', 'analysis'],
        taskComplexity: 'complex',
      }) as any;

      expect(result.selectedAgents).toBeDefined();
      expect(result.reasoning).toContain('complex');
      expect(result.taskComplexity).toBe('complex');
    });

    it('should report unmatched capabilities', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['nonexistent_capability'],
      }) as any;

      expect(result.unmatched).toContain('nonexistent_capability');
    });
  });
});
