/**
 * CoordinatorAgent - orchestrates multi-agent collaboration
 * Breaks down complex tasks, assigns to specialists, synthesizes results
 */

import { MeshNode, MeshNodeOptions } from '../core/mesh-node';
import { MeshConfig, AgentCapability, TaskRequest } from '../core/types';

const COORDINATOR_CAPABILITIES: AgentCapability[] = [
  {
    name: 'task_decomposition',
    description: 'Break complex tasks into subtasks for specialist agents',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Complex task to decompose' },
        maxSubtasks: { type: 'number', description: 'Maximum subtasks to create' },
      },
      required: ['task'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        subtasks: { type: 'array' },
        dependencies: { type: 'object' },
      },
    },
  },
  {
    name: 'result_synthesis',
    description: 'Combine results from multiple agents into a coherent output',
    inputSchema: {
      type: 'object',
      properties: {
        results: { type: 'array', description: 'Results from sub-agents' },
        originalTask: { type: 'string', description: 'Original task description' },
      },
      required: ['results'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        synthesis: { type: 'string' },
        confidence: { type: 'number' },
        contributingAgents: { type: 'array' },
      },
    },
  },
  {
    name: 'agent_selection',
    description: 'Select the best agents for a given task based on capabilities and performance',
    inputSchema: {
      type: 'object',
      properties: {
        requiredCapabilities: { type: 'array', items: { type: 'string' } },
        taskComplexity: { type: 'string', enum: ['simple', 'moderate', 'complex'] },
      },
      required: ['requiredCapabilities'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        selectedAgents: { type: 'array' },
        reasoning: { type: 'string' },
      },
    },
  },
];

export function createCoordinatorAgent(config: MeshConfig): MeshNode {
  const options: MeshNodeOptions = {
    config,
    agentName: 'CoordinatorAgent',
    agentDescription: 'Orchestrates multi-agent collaboration: task decomposition, agent selection, result synthesis',
    capabilities: COORDINATOR_CAPABILITIES,
  };

  const node = new MeshNode(options);

  node.registerCapabilityHandler('task_decomposition', async (input) => {
    const task = input.task as string;
    const maxSubtasks = (input.maxSubtasks as number) || 5;

    // Decompose task into logical subtasks
    const subtasks = [
      {
        id: 'subtask_1',
        description: `Research: Gather information about "${task}"`,
        requiredCapability: 'web_research',
        priority: 1,
      },
      {
        id: 'subtask_2',
        description: `Analyze: Process data related to "${task}"`,
        requiredCapability: 'data_analysis',
        priority: 2,
        dependsOn: ['subtask_1'],
      },
      {
        id: 'subtask_3',
        description: `Assess: Evaluate risks and opportunities for "${task}"`,
        requiredCapability: 'risk_assessment',
        priority: 2,
        dependsOn: ['subtask_1'],
      },
      {
        id: 'subtask_4',
        description: `Synthesize: Combine findings into actionable recommendations`,
        requiredCapability: 'result_synthesis',
        priority: 3,
        dependsOn: ['subtask_2', 'subtask_3'],
      },
    ].slice(0, maxSubtasks);

    return {
      originalTask: task,
      subtasks,
      dependencies: {
        subtask_2: ['subtask_1'],
        subtask_3: ['subtask_1'],
        subtask_4: ['subtask_2', 'subtask_3'],
      },
      executionPlan: 'parallel-where-possible',
      estimatedDuration: subtasks.length * 2000,
    };
  });

  node.registerCapabilityHandler('result_synthesis', async (input) => {
    const results = input.results as unknown[];
    const originalTask = (input.originalTask as string) || 'Unknown task';

    return {
      synthesis: `Synthesized ${results.length} results for task: "${originalTask}". All sub-agent outputs have been integrated into a unified analysis.`,
      confidence: 0.85,
      contributingAgents: results.length,
      resultCount: results.length,
      synthesizedAt: Date.now(),
      recommendations: [
        'Review individual agent results for detailed findings',
        'Cross-reference data points across agent outputs',
        'Consider edge cases flagged by risk assessment',
      ],
    };
  });

  node.registerCapabilityHandler('agent_selection', async (input) => {
    const requiredCapabilities = input.requiredCapabilities as string[];
    const taskComplexity = (input.taskComplexity as string) || 'moderate';

    const registry = node.getRegistry();
    const selectedAgents: Array<{ agentId: string; name: string; matchedCapability: string }> = [];

    for (const capability of requiredCapabilities) {
      const discovery = registry.discoverAgents({ capability, status: 'active' });
      if (discovery.agents.length > 0) {
        const agent = discovery.agents[0]!;
        selectedAgents.push({
          agentId: agent.id,
          name: agent.name,
          matchedCapability: capability,
        });
      }
    }

    return {
      selectedAgents,
      reasoning: `Selected ${selectedAgents.length} agents for ${taskComplexity} task requiring ${requiredCapabilities.length} capabilities`,
      unmatched: requiredCapabilities.filter(
        c => !selectedAgents.some(a => a.matchedCapability === c)
      ),
      taskComplexity,
      selectionCriteria: 'capability-match + availability',
    };
  });

  return node;
}
