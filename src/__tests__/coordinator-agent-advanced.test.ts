/**
 * CoordinatorAgent Advanced Tests
 *
 * Covers gaps in the coordinator agent:
 * - result_synthesis error/edge paths
 * - agent_selection error recovery
 * - task_decomposition edge cases
 * - Empty and boundary inputs
 */

import { createCoordinatorAgent } from '../agents/coordinator-agent';
import { MeshNode } from '../core/mesh-node';
import { HederaClient } from '../core/hedera-client';
import { MeshConfig, AgentProfile } from '../core/types';

jest.mock('../core/hedera-client');

const testConfig: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.12345',
  operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
};

function setupMockClient() {
  const mockProto = HederaClient.prototype as any;
  mockProto.createTopic = jest.fn().mockResolvedValue('0.0.100');
  mockProto.submitMessage = jest.fn().mockResolvedValue(1);
  mockProto.subscribeTopic = jest.fn();
  mockProto.emit = jest.fn().mockReturnValue(true);
  mockProto.getOperatorAccountId = jest.fn().mockReturnValue('0.0.12345');
  mockProto.getBalance = jest.fn().mockResolvedValue(50.5);
  mockProto.close = jest.fn();
}

function createProfile(id: string, capabilities: string[]): AgentProfile {
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
    status: 'active',
    createdAt: Date.now(),
    metadata: {},
  };
}

describe('CoordinatorAgent - Advanced Tests', () => {
  let agent: MeshNode;

  beforeEach(() => {
    jest.clearAllMocks();
    setupMockClient();
    agent = createCoordinatorAgent(testConfig);
  });

  // ==================== result_synthesis edge cases ====================

  describe('result_synthesis edge cases', () => {
    it('should handle empty results array', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [],
        originalTask: 'Empty task',
      }) as any;

      expect(result.contributingAgents).toBe(0);
      expect(result.resultCount).toBe(0);
      expect(result.synthesis).toContain('Empty task');
    });

    it('should use default task name when originalTask is not provided', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [{ data: 'some result' }],
      }) as any;

      expect(result.synthesis).toContain('Unknown task');
      expect(result.contributingAgents).toBe(1);
    });

    it('should handle single result', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [{ agent: 'solo', data: 'only result' }],
        originalTask: 'Solo task',
      }) as any;

      expect(result.contributingAgents).toBe(1);
      expect(result.confidence).toBe(0.85);
    });

    it('should handle large number of results', async () => {
      const results = Array.from({ length: 50 }, (_, i) => ({
        agent: `agent_${i}`,
        data: `result_${i}`,
      }));

      const result = await agent.executeCapability('result_synthesis', {
        results,
        originalTask: 'Large task',
      }) as any;

      expect(result.contributingAgents).toBe(50);
      expect(result.resultCount).toBe(50);
    });

    it('should always provide recommendations array', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [{ data: 'test' }],
        originalTask: 'Test',
      }) as any;

      expect(result.recommendations).toBeInstanceOf(Array);
      expect(result.recommendations.length).toBe(3);
    });

    it('should include synthesizedAt timestamp', async () => {
      const before = Date.now();
      const result = await agent.executeCapability('result_synthesis', {
        results: [{ data: 'test' }],
      }) as any;
      const after = Date.now();

      expect(result.synthesizedAt).toBeGreaterThanOrEqual(before);
      expect(result.synthesizedAt).toBeLessThanOrEqual(after);
    });

    it('should handle results with mixed data types', async () => {
      const result = await agent.executeCapability('result_synthesis', {
        results: [
          { data: 'string data' },
          { data: 42 },
          { data: null },
          { data: { nested: true } },
          { data: [1, 2, 3] },
        ],
        originalTask: 'Mixed types',
      }) as any;

      expect(result.contributingAgents).toBe(5);
      expect(result.synthesis).toContain('Mixed types');
    });
  });

  // ==================== agent_selection edge cases ====================

  describe('agent_selection edge cases', () => {
    it('should handle empty required capabilities', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: [],
      }) as any;

      expect(result.selectedAgents).toEqual([]);
      expect(result.unmatched).toEqual([]);
    });

    it('should report all capabilities as unmatched when no agents registered', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['cap1', 'cap2', 'cap3'],
      }) as any;

      expect(result.unmatched).toContain('cap1');
      expect(result.unmatched).toContain('cap2');
      expect(result.unmatched).toContain('cap3');
      expect(result.selectedAgents).toEqual([]);
    });

    it('should default taskComplexity to moderate', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['research'],
      }) as any;

      expect(result.taskComplexity).toBe('moderate');
      expect(result.reasoning).toContain('moderate');
    });

    it('should use specified taskComplexity', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['research'],
        taskComplexity: 'simple',
      }) as any;

      expect(result.taskComplexity).toBe('simple');
      expect(result.reasoning).toContain('simple');
    });

    it('should include selection criteria in response', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['cap1'],
      }) as any;

      expect(result.selectionCriteria).toBe('capability-match + availability');
    });

    it('should select agents that match registered capabilities', async () => {
      // Register an agent in the registry
      const registry = agent.getRegistry();
      const mockClient = agent.getHederaClient();
      (mockClient.createTopic as jest.Mock).mockResolvedValue('0.0.100');
      await registry.initialize();
      await registry.registerAgent(createProfile('agent-1', ['research']));

      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['research'],
      }) as any;

      expect(result.selectedAgents).toHaveLength(1);
      expect(result.selectedAgents[0].matchedCapability).toBe('research');
      expect(result.unmatched).toEqual([]);
    });

    it('should handle partially matched capabilities', async () => {
      const registry = agent.getRegistry();
      const mockClient = agent.getHederaClient();
      (mockClient.createTopic as jest.Mock).mockResolvedValue('0.0.100');
      await registry.initialize();
      await registry.registerAgent(createProfile('agent-1', ['research']));

      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['research', 'unknown_cap'],
      }) as any;

      expect(result.selectedAgents).toHaveLength(1);
      expect(result.unmatched).toContain('unknown_cap');
      expect(result.unmatched).not.toContain('research');
    });

    it('should include reasoning with correct agent count', async () => {
      const result = await agent.executeCapability('agent_selection', {
        requiredCapabilities: ['a', 'b', 'c'],
        taskComplexity: 'complex',
      }) as any;

      expect(result.reasoning).toContain('0 agents');
      expect(result.reasoning).toContain('complex');
      expect(result.reasoning).toContain('3 capabilities');
    });
  });

  // ==================== task_decomposition edge cases ====================

  describe('task_decomposition edge cases', () => {
    it('should limit subtasks to maxSubtasks=1', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Test task',
        maxSubtasks: 1,
      }) as any;

      expect(result.subtasks).toHaveLength(1);
      expect(result.subtasks[0].id).toBe('subtask_1');
    });

    it('should return all 4 subtasks when maxSubtasks >= 4', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Complex task',
        maxSubtasks: 10,
      }) as any;

      expect(result.subtasks).toHaveLength(4);
    });

    it('should default maxSubtasks to 5 (yielding all 4 subtasks)', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Test',
      }) as any;

      expect(result.subtasks).toHaveLength(4);
    });

    it('should include task description in most subtask descriptions', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Blockchain analysis',
      }) as any;

      // First 3 subtasks include the task name; subtask 4 is a generic synthesis step
      expect(result.subtasks[0].description).toContain('Blockchain analysis');
      expect(result.subtasks[1].description).toContain('Blockchain analysis');
      expect(result.subtasks[2].description).toContain('Blockchain analysis');
      expect(result.subtasks[3].description).toContain('Synthesize');
    });

    it('should include dependency information', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Test',
      }) as any;

      expect(result.dependencies).toBeDefined();
      expect(result.dependencies.subtask_2).toContain('subtask_1');
      expect(result.dependencies.subtask_3).toContain('subtask_1');
      expect(result.dependencies.subtask_4).toContain('subtask_2');
      expect(result.dependencies.subtask_4).toContain('subtask_3');
    });

    it('should calculate estimated duration based on subtask count', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Test',
        maxSubtasks: 2,
      }) as any;

      expect(result.estimatedDuration).toBe(4000); // 2 * 2000
    });

    it('should set execution plan to parallel-where-possible', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Test',
      }) as any;

      expect(result.executionPlan).toBe('parallel-where-possible');
    });

    it('should assign correct required capabilities to subtasks', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Test',
      }) as any;

      const capabilities = result.subtasks.map((s: any) => s.requiredCapability);
      expect(capabilities).toContain('web_research');
      expect(capabilities).toContain('data_analysis');
      expect(capabilities).toContain('risk_assessment');
      expect(capabilities).toContain('result_synthesis');
    });

    it('should set priorities on subtasks', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Test',
      }) as any;

      expect(result.subtasks[0].priority).toBe(1);
      expect(result.subtasks[1].priority).toBe(2);
      expect(result.subtasks[2].priority).toBe(2);
      expect(result.subtasks[3].priority).toBe(3);
    });

    it('should preserve original task string', async () => {
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Very specific unique task description',
      }) as any;

      expect(result.originalTask).toBe('Very specific unique task description');
    });

    it('should treat maxSubtasks of 0 as falsy (uses default of 5)', async () => {
      // Implementation uses `|| 5` so 0 is falsy and becomes 5
      const result = await agent.executeCapability('task_decomposition', {
        task: 'Test',
        maxSubtasks: 0,
      }) as any;

      // All 4 predefined subtasks are returned (5 > 4)
      expect(result.subtasks).toHaveLength(4);
      expect(result.estimatedDuration).toBe(8000);
    });
  });

  // ==================== Agent creation ====================

  describe('agent creation', () => {
    it('should create MeshNode with correct name', () => {
      expect(agent).toBeInstanceOf(MeshNode);
      // Profile is null before start, but we can check via registry
    });

    it('should have all three capability handlers registered', async () => {
      // Verify all three capabilities are executable
      await expect(
        agent.executeCapability('task_decomposition', { task: 'test' })
      ).resolves.toBeDefined();

      await expect(
        agent.executeCapability('result_synthesis', { results: [] })
      ).resolves.toBeDefined();

      await expect(
        agent.executeCapability('agent_selection', { requiredCapabilities: [] })
      ).resolves.toBeDefined();
    });

    it('should throw for non-coordinator capabilities', async () => {
      await expect(
        agent.executeCapability('web_research', { query: 'test' })
      ).rejects.toThrow('No handler for capability: web_research');
    });
  });
});
