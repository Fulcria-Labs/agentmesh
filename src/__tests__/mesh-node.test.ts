/**
 * Tests for MeshNode - the main entry point that combines all components
 */

import { MeshNode } from '../core/mesh-node';
import { HederaClient } from '../core/hedera-client';
import { MeshConfig, AgentCapability } from '../core/types';

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
}

describe('MeshNode', () => {
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

  async function startNode(node: MeshNode, ...args: Parameters<MeshNode['start']>): Promise<ReturnType<MeshNode['start']>> {
    startedNodes.push(node);
    return node.start(...args);
  }

  describe('constructor', () => {
    it('should create a MeshNode with config and capabilities', () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: TEST_CAPABILITIES,
      });

      expect(node).toBeDefined();
      expect(node).toBeInstanceOf(MeshNode);
    });

    it('should have null profile before starting', () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      expect(node.getProfile()).toBeNull();
    });

    it('should expose registry and coordinator before start', () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      expect(node.getRegistry()).toBeDefined();
      expect(node.getCoordinator()).toBeDefined();
      expect(node.getHederaClient()).toBeDefined();
    });
  });

  describe('start', () => {
    it('should return an AgentProfile', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: TEST_CAPABILITIES,
      });

      const profile = await startNode(node);

      expect(profile).toBeDefined();
      expect(profile.name).toBe('TestNode');
      expect(profile.description).toBe('A test node');
      expect(profile.status).toBe('active');
      expect(profile.capabilities).toEqual(TEST_CAPABILITIES);
    });

    it('should set the profile accessible via getProfile()', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: TEST_CAPABILITIES,
      });

      await startNode(node);
      const profile = node.getProfile();

      expect(profile).not.toBeNull();
      expect(profile!.name).toBe('TestNode');
    });

    it('should generate a unique agent ID', async () => {
      const node1 = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'Node1',
        agentDescription: 'Node 1',
        capabilities: [],
      });
      const node2 = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'Node2',
        agentDescription: 'Node 2',
        capabilities: [],
      });

      const profile1 = await startNode(node1);
      const profile2 = await startNode(node2);

      expect(profile1.id).not.toBe(profile2.id);
    });

    it('should use existing registry topic if provided', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      await startNode(node, '0.0.999');

      const profile = node.getProfile();
      expect(profile!.registryTopicId).toBe('0.0.999');
    });

    it('should include metadata with coordination topic and version', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      const profile = await startNode(node);

      expect(profile.metadata.coordinationTopicId).toBeDefined();
      expect(profile.metadata.version).toBe('1.0.0');
    });

    it('should emit started event', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      const spy = jest.fn();
      node.on('started', spy);

      await startNode(node);

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'TestNode' }));
    });

    it('should set hedera account ID from client', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      const profile = await startNode(node);
      expect(profile.hederaAccountId).toBe('0.0.12345');
    });
  });

  describe('registerCapabilityHandler', () => {
    it('should register and execute a capability handler', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      node.registerCapabilityHandler('test_cap', async (input) => {
        return { processed: true, query: input.query };
      });

      const result = await node.executeCapability('test_cap', { query: 'hello' });
      expect(result).toEqual({ processed: true, query: 'hello' });
    });

    it('should throw for unregistered capability', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      await expect(
        node.executeCapability('nonexistent', {})
      ).rejects.toThrow('No handler for capability: nonexistent');
    });

    it('should overwrite handler when registered twice', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      node.registerCapabilityHandler('cap', async () => ({ v: 1 }));
      node.registerCapabilityHandler('cap', async () => ({ v: 2 }));

      const result = await node.executeCapability('cap', {});
      expect(result).toEqual({ v: 2 });
    });
  });

  describe('submitTask', () => {
    it('should throw if node not started', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      await expect(
        node.submitTask('Test task', ['research'])
      ).rejects.toThrow('Node not started');
    });

    it('should submit task after start', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      await startNode(node);
      const taskId = await node.submitTask('Test task', ['research'], { data: 'x' }, 'high');

      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');
    });

    it('should use default priority and empty payload', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      await startNode(node);
      const taskId = await node.submitTask('Test task', ['research']);

      expect(taskId).toBeDefined();
    });
  });

  describe('discoverAgents', () => {
    it('should delegate to registry with active status filter', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      const result = node.discoverAgents('web_research');
      expect(result).toBeDefined();
      expect(result.agents).toBeDefined();
    });

    it('should work without capability filter', () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      const result = node.discoverAgents();
      expect(result).toBeDefined();
    });
  });

  describe('stop', () => {
    it('should emit stopped event', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      await node.start();

      const spy = jest.fn();
      node.on('stopped', spy);

      await node.stop();
      expect(spy).toHaveBeenCalled();
    });

    it('should close hedera client', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      await node.start();
      await node.stop();

      expect(node.getHederaClient().close).toHaveBeenCalled();
    });

    it('should be safe to call stop before start', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      // Should not throw
      await node.stop();
    });

    it('should clear heartbeat timer', async () => {
      const node = new MeshNode({
        config: { ...TEST_CONFIG, heartbeatInterval: 100 },
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      await node.start();
      await node.stop();

      // After stop, no more heartbeats should be sent
      const callCountAtStop = (node.getHederaClient().submitMessage as jest.Mock).mock.calls.length;

      // Wait a bit to confirm no more calls happen
      await new Promise(resolve => setTimeout(resolve, 200));
      const callCountAfterWait = (node.getHederaClient().submitMessage as jest.Mock).mock.calls.length;

      expect(callCountAfterWait).toBe(callCountAtStop);
    });
  });

  describe('getBalance', () => {
    it('should return balance from hedera client', async () => {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: 'TestNode',
        agentDescription: 'A test node',
        capabilities: [],
      });

      const balance = await node.getBalance();
      expect(balance).toBe(50.5);
    });
  });
});
