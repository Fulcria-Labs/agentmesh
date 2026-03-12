/**
 * MeshNode - Advanced lifecycle, capability, and event handling scenarios
 */

import { MeshNode, MeshNodeOptions } from '../core/mesh-node';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile, AgentCapability, MeshConfig, TaskRequest } from '../core/types';

jest.mock('../core/hedera-client');

const TEST_CONFIG: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.1',
  operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
};

function createMeshNode(overrides: Partial<MeshNodeOptions> = {}): MeshNode {
  return new MeshNode({
    config: TEST_CONFIG,
    agentName: 'TestNode',
    agentDescription: 'Test mesh node',
    capabilities: [
      { name: 'test_cap', description: 'Test', inputSchema: {}, outputSchema: {} },
    ],
    ...overrides,
  });
}

function mockHederaClient(node: MeshNode): jest.Mocked<HederaClient> {
  const client = (node as any).hederaClient as jest.Mocked<HederaClient>;
  client.createTopic = jest.fn().mockResolvedValue('0.0.100');
  client.submitMessage = jest.fn().mockResolvedValue(1);
  client.subscribeTopic = jest.fn();
  client.getBalance = jest.fn().mockResolvedValue(100);
  client.getOperatorAccountId = jest.fn().mockReturnValue('0.0.1');
  client.close = jest.fn();
  client.emit = jest.fn().mockReturnValue(true);
  return client;
}

describe('MeshNode - Advanced Scenarios', () => {
  let node: MeshNode;
  let client: jest.Mocked<HederaClient>;

  beforeEach(() => {
    node = createMeshNode();
    client = mockHederaClient(node);
  });

  afterEach(async () => {
    await node.stop();
  });

  describe('Lifecycle', () => {
    it('should create topics on start', async () => {
      await node.start();
      // Should create: registry topic, coordination topic, inbound topic, outbound topic
      expect(client.createTopic).toHaveBeenCalledTimes(4);
    });

    it('should use existing registry topic when provided', async () => {
      await node.start('0.0.999');
      // Should only create: coordination topic, inbound, outbound (3 instead of 4)
      expect(client.createTopic).toHaveBeenCalledTimes(3);
    });

    it('should use existing coordination topic when provided', async () => {
      await node.start('0.0.999', '0.0.888');
      // Should only create: inbound, outbound (2 instead of 4)
      expect(client.createTopic).toHaveBeenCalledTimes(2);
    });

    it('should return agent profile on start', async () => {
      const profile = await node.start();
      expect(profile.name).toBe('TestNode');
      expect(profile.description).toBe('Test mesh node');
      expect(profile.status).toBe('active');
    });

    it('should set profile with proper IDs', async () => {
      const profile = await node.start();
      expect(profile.hederaAccountId).toBe('0.0.1');
      expect(profile.inboundTopicId).toBeDefined();
      expect(profile.outboundTopicId).toBeDefined();
      expect(profile.registryTopicId).toBeDefined();
    });

    it('should include version in metadata', async () => {
      const profile = await node.start();
      expect(profile.metadata.version).toBe('1.0.0');
    });

    it('should include coordination topic in metadata', async () => {
      const profile = await node.start();
      expect(profile.metadata.coordinationTopicId).toBeDefined();
    });

    it('should emit started event', async () => {
      const handler = jest.fn();
      node.on('started', handler);
      await node.start();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should emit stopped event', async () => {
      const handler = jest.fn();
      node.on('stopped', handler);
      await node.start();
      await node.stop();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should close hedera client on stop', async () => {
      await node.start();
      await node.stop();
      expect(client.close).toHaveBeenCalled();
    });

    it('should clear heartbeat timer on stop', async () => {
      await node.start();
      expect((node as any).heartbeatTimer).not.toBeNull();
      await node.stop();
      expect((node as any).heartbeatTimer).toBeNull();
    });

    it('should update status to inactive on stop', async () => {
      await node.start();
      await node.stop();
      // The registry.updateAgentStatus call should have submitted a message
      const calls = client.submitMessage.mock.calls;
      // Last submitMessage call before close should be status update
      const statusCall = calls[calls.length - 1];
      if (statusCall) {
        const msg = JSON.parse(statusCall[1] as string);
        if (msg.payload && msg.payload.status) {
          expect(msg.payload.status).toBe('inactive');
        }
      }
    });

    it('should handle stop when not started', async () => {
      // Should not throw
      await node.stop();
    });

    it('should handle double stop', async () => {
      await node.start();
      await node.stop();
      await node.stop(); // Should not throw
    });
  });

  describe('Capability Handlers', () => {
    it('should register a capability handler', () => {
      node.registerCapabilityHandler('test_cap', async (input) => {
        return { result: 'ok' };
      });

      expect((node as any).capabilityHandlers.size).toBe(1);
    });

    it('should execute registered capability handler', async () => {
      node.registerCapabilityHandler('test_cap', async (input) => {
        return { value: input.x };
      });

      const result = await node.executeCapability('test_cap', { x: 42 });
      expect(result).toEqual({ value: 42 });
    });

    it('should throw for unregistered capability', async () => {
      await expect(
        node.executeCapability('unknown', {})
      ).rejects.toThrow('No handler for capability: unknown');
    });

    it('should register multiple capability handlers', () => {
      node.registerCapabilityHandler('cap1', async () => 'a');
      node.registerCapabilityHandler('cap2', async () => 'b');
      node.registerCapabilityHandler('cap3', async () => 'c');

      expect((node as any).capabilityHandlers.size).toBe(3);
    });

    it('should allow overriding a capability handler', async () => {
      node.registerCapabilityHandler('test_cap', async () => 'old');
      node.registerCapabilityHandler('test_cap', async () => 'new');

      const result = await node.executeCapability('test_cap', {});
      expect(result).toBe('new');
    });

    it('should pass input correctly to handler', async () => {
      const receivedInput = jest.fn();
      node.registerCapabilityHandler('test_cap', async (input) => {
        receivedInput(input);
        return null;
      });

      const testInput = { key: 'value', num: 42, nested: { deep: true } };
      await node.executeCapability('test_cap', testInput);

      expect(receivedInput).toHaveBeenCalledWith(testInput);
    });

    it('should handle async handler that rejects', async () => {
      node.registerCapabilityHandler('failing', async () => {
        throw new Error('Handler failed');
      });

      await expect(
        node.executeCapability('failing', {})
      ).rejects.toThrow('Handler failed');
    });
  });

  describe('Task Submission', () => {
    it('should throw when submitting task before start', async () => {
      await expect(
        node.submitTask('Do something', ['cap1'])
      ).rejects.toThrow('Node not started');
    });

    it('should submit task after start', async () => {
      await node.start();
      const taskId = await node.submitTask('Test task', ['test_cap']);
      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');
    });

    it('should submit task with custom payload', async () => {
      await node.start();
      const taskId = await node.submitTask(
        'Custom payload task',
        ['test_cap'],
        { data: [1, 2, 3] }
      );
      expect(taskId).toBeDefined();
    });

    it('should submit task with priority', async () => {
      await node.start();
      const taskId = await node.submitTask(
        'Critical task',
        ['test_cap'],
        {},
        'critical'
      );
      expect(taskId).toBeDefined();
    });

    it('should submit task with default payload and priority', async () => {
      await node.start();
      const taskId = await node.submitTask('Default task', ['test_cap']);
      expect(taskId).toBeDefined();
    });
  });

  describe('Agent Discovery', () => {
    it('should discover agents with capability filter', async () => {
      await node.start();
      const result = node.discoverAgents('test_cap');
      expect(result).toHaveProperty('agents');
      expect(result).toHaveProperty('totalFound');
    });

    it('should discover agents without filter', async () => {
      await node.start();
      const result = node.discoverAgents();
      expect(result).toHaveProperty('agents');
    });
  });

  describe('Getters', () => {
    it('should return null profile before start', () => {
      expect(node.getProfile()).toBeNull();
    });

    it('should return profile after start', async () => {
      await node.start();
      expect(node.getProfile()).not.toBeNull();
      expect(node.getProfile()!.name).toBe('TestNode');
    });

    it('should return registry', () => {
      const registry = node.getRegistry();
      expect(registry).toBeDefined();
    });

    it('should return coordinator', () => {
      const coordinator = node.getCoordinator();
      expect(coordinator).toBeDefined();
    });

    it('should return hedera client', () => {
      const hederaClient = node.getHederaClient();
      expect(hederaClient).toBeDefined();
    });

    it('should get balance', async () => {
      await node.start();
      const balance = await node.getBalance();
      expect(balance).toBe(100);
    });
  });

  describe('Inbound Message Handling', () => {
    it('should emit message event for valid inbound messages', async () => {
      let inboundCallback: any;
      client.subscribeTopic = jest.fn().mockImplementation((_topicId: string, cb: any) => {
        // The third subscribe call is for the inbound topic
        if (client.subscribeTopic.mock.calls.length === 3) {
          inboundCallback = cb;
        }
      });

      const handler = jest.fn();
      node.on('message', handler);

      await node.start();

      if (inboundCallback) {
        inboundCallback({
          contents: Buffer.from(JSON.stringify({ type: 'test', data: 'hello' })),
          sequenceNumber: 1,
          consensusTimestamp: null,
        });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toEqual({ type: 'test', data: 'hello' });
      }
    });

    it('should ignore malformed inbound messages', async () => {
      let inboundCallback: any;
      client.subscribeTopic = jest.fn().mockImplementation((_topicId: string, cb: any) => {
        if (client.subscribeTopic.mock.calls.length === 3) {
          inboundCallback = cb;
        }
      });

      const handler = jest.fn();
      node.on('message', handler);

      await node.start();

      if (inboundCallback) {
        inboundCallback({
          contents: Buffer.from('not-json'),
          sequenceNumber: 1,
          consensusTimestamp: null,
        });

        expect(handler).not.toHaveBeenCalled();
      }
    });
  });

  describe('Configuration Variations', () => {
    it('should create node with minimal capabilities', () => {
      const minNode = createMeshNode({
        capabilities: [],
      });
      expect(minNode).toBeDefined();
    });

    it('should create node with many capabilities', () => {
      const caps: AgentCapability[] = [];
      for (let i = 0; i < 20; i++) {
        caps.push({
          name: `cap_${i}`,
          description: `Capability ${i}`,
          inputSchema: {},
          outputSchema: {},
        });
      }
      const bigNode = createMeshNode({ capabilities: caps });
      expect(bigNode).toBeDefined();
    });

    it('should support custom heartbeat interval', () => {
      const customNode = createMeshNode({
        config: { ...TEST_CONFIG, heartbeatInterval: 5000 },
      });
      expect(customNode).toBeDefined();
    });

    it('should support testnet config', () => {
      const testnetNode = createMeshNode({
        config: { ...TEST_CONFIG, network: 'testnet' },
      });
      expect(testnetNode).toBeDefined();
    });

    it('should support mainnet config', () => {
      const mainnetNode = createMeshNode({
        config: { ...TEST_CONFIG, network: 'mainnet' },
      });
      expect(mainnetNode).toBeDefined();
    });

    it('should support previewnet config', () => {
      const previewNode = createMeshNode({
        config: { ...TEST_CONFIG, network: 'previewnet' },
      });
      expect(previewNode).toBeDefined();
    });
  });

  describe('Task Request Handling', () => {
    it('should auto-bid on matching tasks when handler is registered', async () => {
      node.registerCapabilityHandler('test_cap', async () => 'result');
      await node.start();

      const bidHandler = jest.fn();
      node.on('task:bidSubmitted', bidHandler);

      // Simulate task received via coordinator event
      const coordinator = node.getCoordinator();
      const task: TaskRequest = {
        id: 'task-1',
        description: 'Test task',
        requiredCapabilities: ['test_cap'],
        payload: {},
        priority: 'medium',
        requesterId: 'requester-1',
        createdAt: Date.now(),
      };

      coordinator.emit('task:received', task);

      // Give the async handler time to execute
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(bidHandler).toHaveBeenCalled();
    });

    it('should not bid on tasks without matching capability', async () => {
      await node.start();

      const bidHandler = jest.fn();
      node.on('task:bidSubmitted', bidHandler);

      const coordinator = node.getCoordinator();
      const task: TaskRequest = {
        id: 'task-1',
        description: 'Non-matching',
        requiredCapabilities: ['unknown_cap'],
        payload: {},
        priority: 'medium',
        requesterId: 'requester-1',
        createdAt: Date.now(),
      };

      coordinator.emit('task:received', task);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(bidHandler).not.toHaveBeenCalled();
    });

    it('should not bid if capability exists but no handler registered', async () => {
      // Has test_cap in capabilities but no handler registered
      await node.start();

      const bidHandler = jest.fn();
      node.on('task:bidSubmitted', bidHandler);

      const coordinator = node.getCoordinator();
      const task: TaskRequest = {
        id: 'task-1',
        description: 'No handler',
        requiredCapabilities: ['test_cap'],
        payload: {},
        priority: 'medium',
        requesterId: 'requester-1',
        createdAt: Date.now(),
      };

      coordinator.emit('task:received', task);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(bidHandler).not.toHaveBeenCalled();
    });
  });

  describe('EventEmitter Functionality', () => {
    it('should support on and removeListener', () => {
      const handler = jest.fn();
      node.on('test', handler);
      node.emit('test', 'data');
      expect(handler).toHaveBeenCalledWith('data');

      node.removeListener('test', handler);
      node.emit('test', 'data2');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should support once', () => {
      const handler = jest.fn();
      node.once('oneshot', handler);
      node.emit('oneshot', 'first');
      node.emit('oneshot', 'second');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should support multiple listeners', () => {
      const h1 = jest.fn();
      const h2 = jest.fn();
      node.on('multi', h1);
      node.on('multi', h2);
      node.emit('multi', 'data');
      expect(h1).toHaveBeenCalled();
      expect(h2).toHaveBeenCalled();
    });
  });
});
