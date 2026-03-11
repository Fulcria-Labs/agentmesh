/**
 * ResearchAgent - specializes in information gathering and synthesis
 * Demonstrates agent specialization in the AgentMesh network
 */

import { MeshNode, MeshNodeOptions } from '../core/mesh-node';
import { MeshConfig, AgentCapability } from '../core/types';

const RESEARCH_CAPABILITIES: AgentCapability[] = [
  {
    name: 'web_research',
    description: 'Research topics across the web and synthesize findings',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Research query' },
        depth: { type: 'string', enum: ['shallow', 'medium', 'deep'] },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        findings: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
        sources: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'summarize',
    description: 'Summarize long text or documents into key points',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to summarize' },
        maxPoints: { type: 'number', description: 'Maximum summary points' },
      },
      required: ['text'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        keyPoints: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'fact_check',
    description: 'Verify claims and provide evidence-based assessment',
    inputSchema: {
      type: 'object',
      properties: {
        claim: { type: 'string', description: 'Claim to verify' },
      },
      required: ['claim'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['true', 'false', 'partially_true', 'unverifiable'] },
        evidence: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number' },
      },
    },
  },
];

export function createResearchAgent(config: MeshConfig): MeshNode {
  const options: MeshNodeOptions = {
    config,
    agentName: 'ResearchAgent',
    agentDescription: 'Specializes in information gathering, synthesis, and fact-checking',
    capabilities: RESEARCH_CAPABILITIES,
  };

  const node = new MeshNode(options);

  // Register capability handlers
  node.registerCapabilityHandler('web_research', async (input) => {
    const query = input.query as string;
    const depth = (input.depth as string) || 'medium';

    // Simulated research (in production, would call search APIs)
    return {
      findings: [
        `Finding 1: Analysis of "${query}" reveals key trends`,
        `Finding 2: Multiple sources confirm relevant data points`,
        `Finding 3: Expert consensus aligns with observed patterns`,
      ],
      summary: `Research on "${query}" (depth: ${depth}) completed. Key findings synthesized from multiple sources.`,
      sources: ['source1.example.com', 'source2.example.com'],
      researchDepth: depth,
      timestamp: Date.now(),
    };
  });

  node.registerCapabilityHandler('summarize', async (input) => {
    const text = input.text as string;
    const maxPoints = (input.maxPoints as number) || 5;
    const words = text.split(/\s+/);
    const summaryLength = Math.min(words.length, Math.floor(words.length / 3));

    return {
      summary: words.slice(0, summaryLength).join(' ') + '...',
      keyPoints: [
        'Key point extracted from text',
        `Document contains ${words.length} words`,
        `Summarized to ${maxPoints} points`,
      ].slice(0, maxPoints),
      originalLength: words.length,
      compressionRatio: summaryLength / words.length,
    };
  });

  node.registerCapabilityHandler('fact_check', async (input) => {
    const claim = input.claim as string;

    return {
      claim,
      verdict: 'partially_true',
      evidence: [
        'Evidence point 1: Supporting data found',
        'Evidence point 2: Some aspects require nuance',
      ],
      confidence: 0.75,
      checkedAt: Date.now(),
    };
  });

  return node;
}
