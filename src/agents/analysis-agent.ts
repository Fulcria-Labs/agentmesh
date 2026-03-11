/**
 * AnalysisAgent - specializes in data analysis and pattern recognition
 */

import { MeshNode, MeshNodeOptions } from '../core/mesh-node';
import { MeshConfig, AgentCapability } from '../core/types';

const ANALYSIS_CAPABILITIES: AgentCapability[] = [
  {
    name: 'data_analysis',
    description: 'Analyze datasets and extract insights, trends, and anomalies',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Data points to analyze' },
        analysisType: { type: 'string', enum: ['trend', 'anomaly', 'correlation', 'summary'] },
      },
      required: ['data'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        insights: { type: 'array', items: { type: 'string' } },
        statistics: { type: 'object' },
        visualizationHints: { type: 'object' },
      },
    },
  },
  {
    name: 'sentiment_analysis',
    description: 'Analyze sentiment and emotional tone of text',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to analyze' },
      },
      required: ['text'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral', 'mixed'] },
        score: { type: 'number' },
        emotions: { type: 'object' },
      },
    },
  },
  {
    name: 'risk_assessment',
    description: 'Evaluate risks and provide mitigation recommendations',
    inputSchema: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'Scenario to assess' },
        factors: { type: 'array', items: { type: 'string' } },
      },
      required: ['scenario'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        factors: { type: 'array' },
        mitigations: { type: 'array', items: { type: 'string' } },
      },
    },
  },
];

export function createAnalysisAgent(config: MeshConfig): MeshNode {
  const options: MeshNodeOptions = {
    config,
    agentName: 'AnalysisAgent',
    agentDescription: 'Specializes in data analysis, sentiment analysis, and risk assessment',
    capabilities: ANALYSIS_CAPABILITIES,
  };

  const node = new MeshNode(options);

  node.registerCapabilityHandler('data_analysis', async (input) => {
    const data = input.data as unknown[];
    const analysisType = (input.analysisType as string) || 'summary';

    const numericData = data.filter(d => typeof d === 'number') as number[];
    const stats = numericData.length > 0 ? {
      count: numericData.length,
      mean: numericData.reduce((a, b) => a + b, 0) / numericData.length,
      min: Math.min(...numericData),
      max: Math.max(...numericData),
      range: Math.max(...numericData) - Math.min(...numericData),
    } : { count: data.length, type: 'non-numeric' };

    return {
      analysisType,
      insights: [
        `Dataset contains ${data.length} data points`,
        `Analysis type: ${analysisType}`,
        numericData.length > 0 ? `Mean value: ${(stats as any).mean.toFixed(2)}` : 'Non-numeric data detected',
      ],
      statistics: stats,
      timestamp: Date.now(),
    };
  });

  node.registerCapabilityHandler('sentiment_analysis', async (input) => {
    const text = input.text as string;
    const words = text.toLowerCase().split(/\s+/);

    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'happy', 'love', 'best', 'fantastic'];
    const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'worst', 'poor', 'ugly', 'failure'];

    const posCount = words.filter(w => positiveWords.includes(w)).length;
    const negCount = words.filter(w => negativeWords.includes(w)).length;
    const total = posCount + negCount || 1;

    const score = (posCount - negCount) / total;
    let sentiment: string;
    if (score > 0.3) sentiment = 'positive';
    else if (score < -0.3) sentiment = 'negative';
    else if (posCount > 0 && negCount > 0) sentiment = 'mixed';
    else sentiment = 'neutral';

    return {
      sentiment,
      score: Math.round(score * 100) / 100,
      emotions: {
        joy: posCount / total,
        anger: negCount / total,
        neutral: 1 - (posCount + negCount) / words.length,
      },
      wordCount: words.length,
      analyzedAt: Date.now(),
    };
  });

  node.registerCapabilityHandler('risk_assessment', async (input) => {
    const scenario = input.scenario as string;
    const factors = (input.factors as string[]) || [];

    const riskScore = Math.min(factors.length * 0.2, 1);
    let riskLevel: string;
    if (riskScore < 0.25) riskLevel = 'low';
    else if (riskScore < 0.5) riskLevel = 'medium';
    else if (riskScore < 0.75) riskLevel = 'high';
    else riskLevel = 'critical';

    return {
      scenario,
      riskLevel,
      riskScore: Math.round(riskScore * 100) / 100,
      analyzedFactors: factors.map((f, i) => ({
        factor: f,
        impact: ['low', 'medium', 'high'][i % 3],
        likelihood: ['unlikely', 'possible', 'likely'][i % 3],
      })),
      mitigations: [
        'Implement monitoring and alerting',
        'Establish contingency procedures',
        'Diversify risk exposure',
      ],
      assessedAt: Date.now(),
    };
  });

  return node;
}
