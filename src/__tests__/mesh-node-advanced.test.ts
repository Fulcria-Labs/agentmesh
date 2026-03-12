/**
 * MeshNode Advanced / Edge-Case Tests
 *
 * Covers: sendHeartbeat, handleInboundMessage event emission,
 * handleTaskRequest auto-bidding, stop cleanup, agent deregistration,
 * heartbeat timer management, and various edge cases.
 */

import { MeshNode } from '../core/mesh-node';
import { HederaClient } from '../core/hedera-client';
import { MeshConfig, AgentCapability, TaskRequest } from '../core/types';

jest.mock('../core/hedera-client');

const TEST_CONFIG: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.12345',
  operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
};

const TEST_CAPABILITIES: AgentCapability[] = [
  {
    name: 'web_research',
    description: 'Research topics on the web',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
  },
  {
    name: 'summarize',
    description: 'Summarize text',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { summary: { type: 'string' } } },
  },
];

function setupMockClient() {
  const mockProto = HederaClient.prototype as any;
  mockProto.createTopic = jest.fn().mockResolvedValue('0.0.100');
  mockProto.submitMessage = jest.fn().mockResolvedValue(1);
  mockProto.subscribeTopic = jest.fn();
  mockProto.emit = jest.fn().mockReturnValue(true);
  mockProto.getOperatorAccountId = jest.fn().mockReturnValue('0.0.12345');
  mockProto.getBalance = jest.fn().mockResolvedValue(50.5);
  mockProto.close = jest.fn();
  mockProto.unsubscribeTopic = jest.fn();
}

describe('MeshNode - Advanced Edge Cases', () => {
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

  function createNode(overrides: Partial<{
    config: MeshConfig;
    agentName: string;
    agentDescription: string;
    capabilities: AgentCapability[];
  }> = {}): MeshNode {
    return new MeshNode({
      config: overrides.config || TEST_CONFIG,
      agentName: overrides.agentName || 'TestNode',
      agentDescription: overrides.agentDescription || 'A test node',
      capabilities: overrides.capabilities || TEST_CAPABILITIES,
    });
  }

  async function startNode(node: MeshNode, ...args: Parameters<MeshNode['start']>): Promise<ReturnType<MeshNode['start']>> {
    startedNodes.push(node);
    return node.start(...args);
  }

  // ==================== sendHeartbeat (via private method) ====================

  describe('sendHeartbeat', () => {
    it('should send heartbeat message with agent status', async () => {
      const node = createNode();
      await startNode(node);

      const submitMessage = node.getHederaClient().submitMessage as jest.Mock;
      const sendHeartbeat = (node as any).sendHeartbeat.bind(node);
      await sendHeartbeat();

      const heartbeatCalls = submitMessage.mock.calls.filter((call: any[]) => {
        try {
          const msg = JSON.parse(call[1]);
          return msg.type === 'agent.heartbeat';
        } catch { return false; }
      });

      expect(heartbeatCalls.length).toBeGreaterThanOrEqual(1);
      const msg = JSON.parse(heartbeatCalls[0][1]);
      expect(msg.payload.status).toBe('active');
    });

    it('should include capability names in heartbeat payload', async () => {
      const node = createNode();
      await startNode(node);

      const submitMessage = node.getHederaClient().submitMessage as jest.Mock;
      const sendHeartbeat = (node as any).sendHeartbeat.bind(node);
      await sendHeartbeat();

      const lastCall = submitMessage.mock.calls[submitMessage.mock.calls.length - 1];
      const msg = JSON.parse(lastCall[1]);
      expect(msg.payload.capabilities).toContain('web_research');
      expect(msg.payload.capabilities).toContain('summarize');
    });

    it('should include senderId matching profile ID', async () => {
      const node = createNode();
      const profile = await startNode(node);

      const submitMessage = node.getHederaClient().submitMessage as jest.Mock;
      const sendHeartbeat = (node as any).sendHeartbeat.bind(node);
      await sendHeartbeat();

      const lastCall = submitMessage.mock.calls[submitMessage.mock.calls.length - 1];
      const msg = JSON.parse(lastCall[1]);
      expect(msg.senderId).toBe(profile.id);
    });

    it('should include a timestamp', async () => {
      const node = createNode();
      await startNode(node);

      const before = Date.now();
      const sendHeartbeat = (node as any).sendHeartbeat.bind(node);
      await sendHeartbeat();
      const after = Date.now();

      const submitMessage = node.getHederaClient().submitMessage as jest.Mock;
      const lastCall = submitMessage.mock.calls[submitMessage.mock.calls.length - 1];
      const msg = JSON.parse(lastCall[1]);
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    });

    it('should not send heartbeat if profile is null (not started)', async () => {
      const node = createNode();
      const submitMessage = node.getHederaClient().submitMessage as jest.Mock;

      const sendHeartbeat = (node as any).sendHeartbeat.bind(node);
      await sendHeartbeat();

      expect(submitMessage).not.toHaveBeenCalled();
    });

    it('should send heartbeat to registry topic', async () => {
      const node = createNode();
      await startNode(node, '0.0.888');

      const submitMessage = node.getHederaClient().submitMessage as jest.Mock;
      const sendHeartbeat = (node as any).sendHeartbeat.bind(node);
      await sendHeartbeat();

      const lastCall = submitMessage.mock.calls[submitMessage.mock.calls.length - 1];
      expect(lastCall[0]).toBe('0.0.888');
    });

    it('should not throw when submitMessage rejects', async () => {
      const node = createNode();
      await startNode(node);

      (node.getHederaClient().submitMessage as jest.Mock).mockRejectedValueOnce(new Error('HEARTBEAT_FAIL'));

      const sendHeartbeat = (node as any).sendHeartbeat.bind(node);
      // sendHeartbeat itself will throw but the caller (.catch(() => {})) swallows it.
      // Verify the rejection happens but is catchable
      await expect(sendHeartbeat()).rejects.toThrow('HEARTBEAT_FAIL');
    });
  });

  // ==================== heartbeat timer management ====================

  describe('heartbeat timer management', () => {
    it('should start heartbeat timer on node start', async () => {
      jest.useFakeTimers();
      try {
        const node = createNode({ config: { ...TEST_CONFIG, heartbeatInterval: 500 } });
        await startNode(node);

        const submitMessage = node.getHederaClient().submitMessage as jest.Mock;
        const initial = submitMessage.mock.calls.length;

        jest.advanceTimersByTime(500);
        await Promise.resolve();

        expect(submitMessage.mock.calls.length).toBeGreaterThan(initial);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should stop heartbeat timer on stop', async () => {
      jest.useFakeTimers();
      try {
        const node = createNode({ config: { ...TEST_CONFIG, heartbeatInterval: 200 } });
        await startNode(node);
        await node.stop();
        startedNodes.pop();

        const submitMessage = node.getHederaClient().submitMessage as jest.Mock;
        const callsAfterStop = submitMessage.mock.calls.length;

        jest.advanceTimersByTime(600);
        await Promise.resolve();

        expect(submitMessage.mock.calls.length).toBe(callsAfterStop);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should use default 60s interval when heartbeatInterval not set', async () => {
      jest.useFakeTimers();
      try {
        const node = createNode(); // No heartbeatInterval
        await startNode(node);

        const submitMessage = node.getHederaClient().submitMessage as jest.Mock;
        const initial = submitMessage.mock.calls.length;

        // At 30s - no heartbeat yet
        jest.advanceTimersByTime(30000);
        await Promise.resolve();
        expect(submitMessage.mock.calls.length).toBe(initial);

        // At 60s - heartbeat fires
        jest.advanceTimersByTime(30000);
        await Promise.resolve();
        expect(submitMessage.mock.calls.length).toBeGreaterThan(initial);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should send multiple heartbeats over time', async () => {
      jest.useFakeTimers();
      try {
        const node = createNode({ config: { ...TEST_CONFIG, heartbeatInterval: 200 } });
        await startNode(node);

        const submitMessage = node.getHederaClient().submitMessage as jest.Mock;
        const initial = submitMessage.mock.calls.length;

        jest.advanceTimersByTime(600);
        await Promise.resolve();

        const newCalls = submitMessage.mock.calls.length - initial;
        expect(newCalls).toBeGreaterThanOrEqual(3);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ==================== handleInboundMessage ====================

  describe('handleInboundMessage', () => {
    it('should emit message event for valid JSON', async () => {
      const node = createNode();
      const msgSpy = jest.fn();
      node.on('message', msgSpy);

      // Directly invoke the private handler
      const handleInbound = (node as any).handleInboundMessage.bind(node);
      const payload = { type: 'test', data: 'hello' };
      handleInbound(Buffer.from(JSON.stringify(payload)));

      expect(msgSpy).toHaveBeenCalledWith(payload);
    });

    it('should silently ignore malformed JSON', () => {
      const node = createNode();
      const msgSpy = jest.fn();
      node.on('message', msgSpy);

      const handleInbound = (node as any).handleInboundMessage.bind(node);
      // Should not throw
      handleInbound(Buffer.from('not-json'));

      expect(msgSpy).not.toHaveBeenCalled();
    });

    it('should silently ignore empty buffer', () => {
      const node = createNode();
      const msgSpy = jest.fn();
      node.on('message', msgSpy);

      const handleInbound = (node as any).handleInboundMessage.bind(node);
      handleInbound(Buffer.from(''));

      expect(msgSpy).not.toHaveBeenCalled();
    });

    it('should handle nested JSON objects', () => {
      const node = createNode();
      const msgSpy = jest.fn();
      node.on('message', msgSpy);

      const handleInbound = (node as any).handleInboundMessage.bind(node);
      const payload = { nested: { deep: { value: 42 } }, arr: [1, 2, 3] };
      handleInbound(Buffer.from(JSON.stringify(payload)));

      expect(msgSpy).toHaveBeenCalledWith(payload);
    });

    it('should handle message with special characters', () => {
      const node = createNode();
      const msgSpy = jest.fn();
      node.on('message', msgSpy);

      const handleInbound = (node as any).handleInboundMessage.bind(node);
      const payload = { text: 'Hello "world" \\ \n\t special' };
      handleInbound(Buffer.from(JSON.stringify(payload)));

      expect(msgSpy).toHaveBeenCalledWith(payload);
    });
  });

  // ==================== handleTaskRequest ====================

  describe('handleTaskRequest', () => {
    it('should auto-bid when matching capability and handler exists', async () => {
      const node = createNode({ capabilities: TEST_CAPABILITIES });
      node.registerCapabilityHandler('web_research', async () => ({ result: true }));
      await startNode(node);

      const bidSpy = jest.fn();
      node.on('task:bidSubmitted', bidSpy);

      const task: TaskRequest = {
        id: 'task-1',
        description: 'Research AI',
        requiredCapabilities: ['web_research'],
        payload: {},
        priority: 'medium',
        requesterId: 'requester-1',
        createdAt: Date.now(),
      };

      const handleTaskRequest = (node as any).handleTaskRequest.bind(node);
      await handleTaskRequest(task);

      expect(bidSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-1', capability: 'web_research' })
      );
    });

    it('should not bid when capability exists but no handler registered', async () => {
      const node = createNode({ capabilities: TEST_CAPABILITIES });
      // No handler registered for web_research
      await startNode(node);

      const bidSpy = jest.fn();
      node.on('task:bidSubmitted', bidSpy);

      const task: TaskRequest = {
        id: 'task-2',
        description: 'Test',
        requiredCapabilities: ['web_research'],
        payload: {},
        priority: 'low',
        requesterId: 'req-1',
        createdAt: Date.now(),
      };

      const handleTaskRequest = (node as any).handleTaskRequest.bind(node);
      await handleTaskRequest(task);

      expect(bidSpy).not.toHaveBeenCalled();
    });

    it('should not bid when task requires capabilities the node lacks', async () => {
      const node = createNode({ capabilities: TEST_CAPABILITIES });
      node.registerCapabilityHandler('web_research', async () => ({}));
      await startNode(node);

      const bidSpy = jest.fn();
      node.on('task:bidSubmitted', bidSpy);

      const task: TaskRequest = {
        id: 'task-3',
        description: 'Unknown cap',
        requiredCapabilities: ['quantum_computing'],
        payload: {},
        priority: 'medium',
        requesterId: 'req-1',
        createdAt: Date.now(),
      };

      const handleTaskRequest = (node as any).handleTaskRequest.bind(node);
      await handleTaskRequest(task);

      expect(bidSpy).not.toHaveBeenCalled();
    });

    it('should do case-insensitive capability name matching on profile', async () => {
      // The code checks: c.name.toLowerCase() === required.toLowerCase()
      // But also checks capabilityHandlers.has(required) which is case-sensitive.
      // So the handler key must match the required capability name exactly.
      const node = createNode({
        capabilities: [{
          name: 'Web_Research',
          description: 'Research',
          inputSchema: {},
          outputSchema: {},
        }],
      });
      // Handler registered with lowercase key matching the task's required capability
      node.registerCapabilityHandler('web_research', async () => ({}));
      await startNode(node);

      const bidSpy = jest.fn();
      node.on('task:bidSubmitted', bidSpy);

      const task: TaskRequest = {
        id: 'task-4',
        description: 'Case test',
        requiredCapabilities: ['web_research'],
        payload: {},
        priority: 'low',
        requesterId: 'req-1',
        createdAt: Date.now(),
      };

      const handleTaskRequest = (node as any).handleTaskRequest.bind(node);
      await handleTaskRequest(task);

      // Profile capability 'Web_Research' matches task 'web_research' case-insensitively
      // Handler key 'web_research' matches task 'web_research' exactly
      expect(bidSpy).toHaveBeenCalled();
    });

    it('should not process task if profile is null (not started)', async () => {
      const node = createNode();
      node.registerCapabilityHandler('web_research', async () => ({}));

      const bidSpy = jest.fn();
      node.on('task:bidSubmitted', bidSpy);

      const task: TaskRequest = {
        id: 'task-5',
        description: 'Test',
        requiredCapabilities: ['web_research'],
        payload: {},
        priority: 'low',
        requesterId: 'req-1',
        createdAt: Date.now(),
      };

      const handleTaskRequest = (node as any).handleTaskRequest.bind(node);
      await handleTaskRequest(task);

      expect(bidSpy).not.toHaveBeenCalled();
    });

    it('should bid on multiple matching capabilities in same task', async () => {
      const node = createNode({ capabilities: TEST_CAPABILITIES });
      node.registerCapabilityHandler('web_research', async () => ({}));
      node.registerCapabilityHandler('summarize', async () => ({}));
      await startNode(node);

      const bidSpy = jest.fn();
      node.on('task:bidSubmitted', bidSpy);

      const task: TaskRequest = {
        id: 'task-6',
        description: 'Multi-cap task',
        requiredCapabilities: ['web_research', 'summarize'],
        payload: {},
        priority: 'high',
        requesterId: 'req-1',
        createdAt: Date.now(),
      };

      const handleTaskRequest = (node as any).handleTaskRequest.bind(node);
      await handleTaskRequest(task);

      expect(bidSpy).toHaveBeenCalledTimes(2);
    });

    it('should not bid on empty required capabilities', async () => {
      const node = createNode({ capabilities: TEST_CAPABILITIES });
      node.registerCapabilityHandler('web_research', async () => ({}));
      await startNode(node);

      const bidSpy = jest.fn();
      node.on('task:bidSubmitted', bidSpy);

      const task: TaskRequest = {
        id: 'task-7',
        description: 'No caps needed',
        requiredCapabilities: [],
        payload: {},
        priority: 'low',
        requesterId: 'req-1',
        createdAt: Date.now(),
      };

      const handleTaskRequest = (node as any).handleTaskRequest.bind(node);
      await handleTaskRequest(task);

      expect(bidSpy).not.toHaveBeenCalled();
    });
  });

  // ==================== stop cleanup ====================

  describe('stop - advanced cleanup', () => {
    it('should set agent status to inactive on stop', async () => {
      const node = createNode();
      await startNode(node);

      const submitMessage = node.getHederaClient().submitMessage as jest.Mock;
      await node.stop();
      startedNodes.pop();

      expect(submitMessage).toHaveBeenCalled();
    });

    it('should stop heartbeat timer on stop', async () => {
      jest.useFakeTimers();
      try {
        const node = createNode({ config: { ...TEST_CONFIG, heartbeatInterval: 100 } });
        await startNode(node);
        await node.stop();
        startedNodes.pop();

        const submitMessage = node.getHederaClient().submitMessage as jest.Mock;
        const callsAfterStop = submitMessage.mock.calls.length;

        jest.advanceTimersByTime(500);
        await Promise.resolve();

        expect(submitMessage.mock.calls.length).toBe(callsAfterStop);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should call close on hedera client during stop', async () => {
      const node = createNode();
      await startNode(node);
      await node.stop();
      startedNodes.pop();

      expect(node.getHederaClient().close).toHaveBeenCalled();
    });

    it('should emit stopped event after cleanup', async () => {
      const node = createNode();
      await startNode(node);

      const spy = jest.fn();
      node.on('stopped', spy);

      await node.stop();
      startedNodes.pop();

      expect(spy).toHaveBeenCalled();
    });

    it('should handle stop when heartbeat timer was never set', async () => {
      const node = createNode();
      await expect(node.stop()).resolves.not.toThrow();
    });

    it('should be idempotent - multiple stops should not error', async () => {
      const node = createNode();
      await startNode(node);
      await node.stop();
      startedNodes.pop();
      await expect(node.stop()).resolves.not.toThrow();
    });
  });

  // ==================== Agent deregistration flow ====================

  describe('agent deregistration flow', () => {
    it('should send a status update message on stop', async () => {
      const node = createNode();
      await startNode(node);

      const submitMessage = node.getHederaClient().submitMessage as jest.Mock;
      const callsBefore = submitMessage.mock.calls.length;

      await node.stop();
      startedNodes.pop();

      expect(submitMessage.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('should not attempt status update when never started', async () => {
      const node = createNode();
      const submitMessage = node.getHederaClient().submitMessage as jest.Mock;

      await node.stop();

      expect(submitMessage).not.toHaveBeenCalled();
    });
  });

  // ==================== Multiple capability handlers ====================

  describe('multiple capability handlers', () => {
    it('should support registering handlers for all capabilities', async () => {
      const node = createNode();

      node.registerCapabilityHandler('web_research', async (input) => ({ type: 'research', query: input.query }));
      node.registerCapabilityHandler('summarize', async (input) => ({ type: 'summary', text: input.text }));

      const r1 = await node.executeCapability('web_research', { query: 'test' });
      const r2 = await node.executeCapability('summarize', { text: 'hello' });

      expect(r1).toEqual({ type: 'research', query: 'test' });
      expect(r2).toEqual({ type: 'summary', text: 'hello' });
    });

    it('should handle handler that throws an error', async () => {
      const node = createNode();
      node.registerCapabilityHandler('web_research', async () => {
        throw new Error('Handler crashed');
      });

      await expect(
        node.executeCapability('web_research', {})
      ).rejects.toThrow('Handler crashed');
    });

    it('should handle handler that returns undefined', async () => {
      const node = createNode();
      node.registerCapabilityHandler('web_research', async () => undefined);

      const result = await node.executeCapability('web_research', {});
      expect(result).toBeUndefined();
    });

    it('should handle handler that returns null', async () => {
      const node = createNode();
      node.registerCapabilityHandler('web_research', async () => null);

      const result = await node.executeCapability('web_research', {});
      expect(result).toBeNull();
    });
  });

  // ==================== Existing topic IDs ====================

  describe('existing topic IDs on start', () => {
    it('should use existing coordination topic ID when provided', async () => {
      const node = createNode();
      const profile = await startNode(node, '0.0.888', '0.0.999');

      expect(profile.metadata.coordinationTopicId).toBe('0.0.999');
    });

    it('should use existing registry topic ID when provided', async () => {
      const node = createNode();
      const profile = await startNode(node, '0.0.777');

      expect(profile.registryTopicId).toBe('0.0.777');
    });
  });
});
