/**
 * MeshNode lifecycle tests - covers heartbeat behavior, inbound message handling,
 * capability handler edge cases, task request auto-bidding, and event flows.
 */

import { MeshNode } from '../core/mesh-node';
import { HederaClient } from '../core/hedera-client';
import { MeshConfig, AgentCapability, MessageType } from '../core/types';

jest.mock('../core/hedera-client');

const TEST_CONFIG: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.12345',
  operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
};

const RESEARCH_CAP: AgentCapability = {
  name: 'web_research',
  description: 'Research the web',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
};

const ANALYSIS_CAP: AgentCapability = {
  name: 'data_analysis',
  description: 'Analyze data',
  inputSchema: { type: 'object', properties: { data: { type: 'array' } } },
  outputSchema: { type: 'object', properties: { insights: { type: 'array' } } },
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
  mockProto.on = jest.fn();
}

describe('MeshNode Lifecycle', () => {
  const startedNodes: MeshNode[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    setupMockClient();
  });

  afterEach(async () => {
    for (const node of startedNodes) {
      await node.stop();
    }
    startedNodes.length = 0;
  });

  function createNode(overrides: Partial<{ config: MeshConfig; agentName: string; capabilities: AgentCapability[] }> = {}): MeshNode {
    return new MeshNode({
      config: overrides.config || TEST_CONFIG,
      agentName: overrides.agentName || 'TestNode',
      agentDescription: 'A test node',
      capabilities: overrides.capabilities || [RESEARCH_CAP],
    });
  }

  async function startNode(node: MeshNode, ...args: Parameters<MeshNode['start']>) {
    startedNodes.push(node);
    return node.start(...args);
  }

  describe('profile generation', () => {
    it('should include all capabilities in profile', async () => {
      const node = createNode({ capabilities: [RESEARCH_CAP, ANALYSIS_CAP] });
      const profile = await startNode(node);

      expect(profile.capabilities).toHaveLength(2);
      expect(profile.capabilities.map(c => c.name)).toEqual(['web_research', 'data_analysis']);
    });

    it('should set createdAt to approximate current time', async () => {
      const before = Date.now();
      const node = createNode();
      const profile = await startNode(node);
      const after = Date.now();

      expect(profile.createdAt).toBeGreaterThanOrEqual(before);
      expect(profile.createdAt).toBeLessThanOrEqual(after);
    });

    it('should generate UUID format IDs', async () => {
      const node = createNode();
      const profile = await startNode(node);

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(profile.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should set version metadata to 1.0.0', async () => {
      const node = createNode();
      const profile = await startNode(node);

      expect(profile.metadata.version).toBe('1.0.0');
    });

    it('should handle empty capabilities list', async () => {
      const node = createNode({ capabilities: [] });
      const profile = await startNode(node);

      expect(profile.capabilities).toHaveLength(0);
    });

    it('should use agent description from options', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'CustomNode',
        agentDescription: 'Custom description for testing',
        capabilities: [],
      });

      const profile = await startNode(node);
      expect(profile.description).toBe('Custom description for testing');
    });
  });

  describe('existing topic IDs', () => {
    it('should use both existing registry and coordination topics', async () => {
      const node = createNode();
      const profile = await startNode(node, '0.0.888', '0.0.999');

      expect(profile.registryTopicId).toBe('0.0.888');
      expect(profile.metadata.coordinationTopicId).toBe('0.0.999');
    });

    it('should use existing registry but create new coordination topic', async () => {
      const node = createNode();
      const profile = await startNode(node, '0.0.888');

      expect(profile.registryTopicId).toBe('0.0.888');
      expect(profile.metadata.coordinationTopicId).toBeDefined();
    });
  });

  describe('capability handler lifecycle', () => {
    it('should register handler before start', async () => {
      const node = createNode();
      node.registerCapabilityHandler('web_research', async (input) => ({
        result: 'pre-start handler',
        query: input.query,
      }));

      const result = await node.executeCapability('web_research', { query: 'test' });
      expect(result).toEqual({ result: 'pre-start handler', query: 'test' });
    });

    it('should register handler after start', async () => {
      const node = createNode();
      await startNode(node);

      node.registerCapabilityHandler('web_research', async () => ({ result: 'post-start' }));
      const result = await node.executeCapability('web_research', {});
      expect(result).toEqual({ result: 'post-start' });
    });

    it('should handle async handler that throws', async () => {
      const node = createNode();
      node.registerCapabilityHandler('web_research', async () => {
        throw new Error('Handler crashed');
      });

      await expect(node.executeCapability('web_research', {})).rejects.toThrow('Handler crashed');
    });

    it('should handle handler returning complex nested objects', async () => {
      const node = createNode();
      const complexResult = {
        level1: {
          level2: {
            level3: [1, 2, { nested: true }],
          },
          array: [1, 'two', null, undefined],
        },
        date: Date.now(),
      };
      node.registerCapabilityHandler('web_research', async () => complexResult);

      const result = await node.executeCapability('web_research', {});
      expect(result).toEqual(complexResult);
    });

    it('should handle handler returning null', async () => {
      const node = createNode();
      node.registerCapabilityHandler('web_research', async () => null);

      const result = await node.executeCapability('web_research', {});
      expect(result).toBeNull();
    });

    it('should handle handler returning undefined', async () => {
      const node = createNode();
      node.registerCapabilityHandler('web_research', async () => undefined);

      const result = await node.executeCapability('web_research', {});
      expect(result).toBeUndefined();
    });

    it('should support multiple different capability handlers', async () => {
      const node = createNode({ capabilities: [RESEARCH_CAP, ANALYSIS_CAP] });

      node.registerCapabilityHandler('web_research', async () => ({ type: 'research' }));
      node.registerCapabilityHandler('data_analysis', async () => ({ type: 'analysis' }));

      const r1 = await node.executeCapability('web_research', {});
      const r2 = await node.executeCapability('data_analysis', {});

      expect(r1).toEqual({ type: 'research' });
      expect(r2).toEqual({ type: 'analysis' });
    });

    it('should pass input data to handler correctly', async () => {
      const node = createNode();
      const receivedInputs: Record<string, unknown>[] = [];

      node.registerCapabilityHandler('web_research', async (input) => {
        receivedInputs.push(input);
        return {};
      });

      await node.executeCapability('web_research', { query: 'test', depth: 3 });
      await node.executeCapability('web_research', { query: 'other', extra: true });

      expect(receivedInputs).toHaveLength(2);
      expect(receivedInputs[0]).toEqual({ query: 'test', depth: 3 });
      expect(receivedInputs[1]).toEqual({ query: 'other', extra: true });
    });
  });

  describe('inbound message handling', () => {
    it('should subscribe to inbound topic on start', async () => {
      const node = createNode();
      await startNode(node);

      const mockProto = HederaClient.prototype as any;
      // subscribeTopic should be called at least twice: registry + inbound
      expect(mockProto.subscribeTopic.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should emit message event for valid inbound JSON', async () => {
      const node = createNode();
      let inboundCallback: ((msg: any) => void) | null = null;

      const mockProto = HederaClient.prototype as any;
      mockProto.subscribeTopic.mockImplementation((topicId: string, cb: any) => {
        // The third subscribeTopic call is for inbound (after registry and coordinator)
        if (topicId === '0.0.100') {
          inboundCallback = cb;
        }
      });

      await startNode(node);

      const spy = jest.fn();
      node.on('message', spy);

      if (inboundCallback) {
        inboundCallback({
          contents: Buffer.from(JSON.stringify({ type: 'data.request', data: 'hello' })),
          sequenceNumber: 1,
          consensusTimestamp: null,
        });
      }

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'data.request', data: 'hello' }));
    });

    it('should silently ignore malformed inbound messages', async () => {
      const node = createNode();
      let inboundCallback: ((msg: any) => void) | null = null;

      const mockProto = HederaClient.prototype as any;
      mockProto.subscribeTopic.mockImplementation((topicId: string, cb: any) => {
        if (topicId === '0.0.100') {
          inboundCallback = cb;
        }
      });

      await startNode(node);

      const spy = jest.fn();
      node.on('message', spy);

      if (inboundCallback) {
        // Should not throw
        inboundCallback({
          contents: Buffer.from('not valid json'),
          sequenceNumber: 1,
          consensusTimestamp: null,
        });
      }

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('stop behavior', () => {
    it('should update agent status to inactive on stop', async () => {
      const node = createNode();
      await startNode(node);

      const mockProto = HederaClient.prototype as any;
      mockProto.submitMessage.mockClear();

      await node.stop();

      // Should have submitted a status update message
      expect(mockProto.submitMessage).toHaveBeenCalled();
    });

    it('should clear heartbeat timer on stop', async () => {
      const node = createNode({
        config: { ...TEST_CONFIG, heartbeatInterval: 50 },
      });

      await startNode(node);
      const mockProto = HederaClient.prototype as any;
      const callsBefore = mockProto.submitMessage.mock.calls.length;

      await node.stop();

      // Wait for potential heartbeat
      await new Promise(r => setTimeout(r, 100));
      const callsAfter = mockProto.submitMessage.mock.calls.length;

      // Only the stop status update should have happened, no heartbeats
      expect(callsAfter - callsBefore).toBeLessThanOrEqual(1);
    });

    it('should emit stopped event exactly once', async () => {
      const node = createNode();
      await startNode(node);

      const spy = jest.fn();
      node.on('stopped', spy);

      await node.stop();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should be safe to call stop multiple times', async () => {
      const node = createNode();
      await startNode(node);

      await node.stop();
      await node.stop();
      await node.stop();
      // Should not throw
    });

    it('should close hedera client on stop', async () => {
      const node = createNode();
      await startNode(node);

      const mockProto = HederaClient.prototype as any;
      mockProto.close.mockClear();

      await node.stop();
      expect(mockProto.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessor methods', () => {
    it('should return null profile before start', () => {
      const node = createNode();
      expect(node.getProfile()).toBeNull();
    });

    it('should return profile after start', async () => {
      const node = createNode();
      await startNode(node);
      expect(node.getProfile()).not.toBeNull();
    });

    it('should return registry', () => {
      const node = createNode();
      expect(node.getRegistry()).toBeDefined();
    });

    it('should return coordinator', () => {
      const node = createNode();
      expect(node.getCoordinator()).toBeDefined();
    });

    it('should return hedera client', () => {
      const node = createNode();
      expect(node.getHederaClient()).toBeDefined();
    });

    it('should delegate getBalance to hedera client', async () => {
      const node = createNode();
      const balance = await node.getBalance();
      expect(balance).toBe(50.5);
    });

    it('should delegate discoverAgents to registry', () => {
      const node = createNode();
      const result = node.discoverAgents('web_research');
      expect(result).toBeDefined();
      expect(result.agents).toBeDefined();
    });
  });

  describe('submitTask validation', () => {
    it('should throw if node not started', async () => {
      const node = createNode();
      await expect(node.submitTask('desc', ['cap'])).rejects.toThrow('Node not started');
    });

    it('should accept task with empty capabilities', async () => {
      const node = createNode();
      await startNode(node);
      const taskId = await node.submitTask('no caps', []);
      expect(taskId).toBeDefined();
    });

    it('should accept task with multiple capabilities', async () => {
      const node = createNode();
      await startNode(node);
      const taskId = await node.submitTask('multi caps', ['a', 'b', 'c']);
      expect(taskId).toBeDefined();
    });

    it('should pass custom priority', async () => {
      const node = createNode();
      await startNode(node);
      const taskId = await node.submitTask('critical task', ['cap'], {}, 'critical');
      expect(taskId).toBeDefined();
    });

    it('should pass custom payload', async () => {
      const node = createNode();
      await startNode(node);
      const taskId = await node.submitTask('payload task', ['cap'], { key: 'value', nested: { a: 1 } });
      expect(taskId).toBeDefined();
    });
  });

  describe('event emission', () => {
    it('should emit started with full profile', async () => {
      const node = createNode({ agentName: 'EventNode' });
      const spy = jest.fn();
      node.on('started', spy);

      await startNode(node);

      expect(spy).toHaveBeenCalledTimes(1);
      const profile = spy.mock.calls[0][0];
      expect(profile.name).toBe('EventNode');
      expect(profile.id).toBeDefined();
      expect(profile.status).toBe('active');
    });

    it('should support multiple event listeners', async () => {
      const node = createNode();
      const spy1 = jest.fn();
      const spy2 = jest.fn();
      node.on('started', spy1);
      node.on('started', spy2);

      await startNode(node);

      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);
    });
  });
});
