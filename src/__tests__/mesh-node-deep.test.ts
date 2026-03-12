/**
 * MeshNode - Deep coverage tests
 *
 * Covers: inbound message handling, heartbeat behavior, task request handling,
 * capability handler edge cases, event emission patterns, and component access.
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

const TEST_CAPS: AgentCapability[] = [
  { name: 'research', description: 'Research', inputSchema: {}, outputSchema: {} },
  { name: 'analysis', description: 'Analysis', inputSchema: {}, outputSchema: {} },
];

function setupMock() {
  const proto = HederaClient.prototype as any;
  proto.createTopic = jest.fn().mockResolvedValue('0.0.100');
  proto.submitMessage = jest.fn().mockResolvedValue(1);
  proto.subscribeTopic = jest.fn();
  proto.emit = jest.fn().mockReturnValue(true);
  proto.getOperatorAccountId = jest.fn().mockReturnValue('0.0.12345');
  proto.getBalance = jest.fn().mockResolvedValue(50);
  proto.close = jest.fn();
  proto.unsubscribeTopic = jest.fn();
}

describe('MeshNode - Inbound Message Handling', () => {
  let node: MeshNode;
  let inboundCallback: (msg: { contents: Buffer; sequenceNumber: number }) => void;

  beforeEach(async () => {
    jest.clearAllMocks();
    setupMock();

    let callCount = 0;
    (HederaClient.prototype.subscribeTopic as jest.Mock).mockImplementation(
      (topicId: string, callback: any) => {
        callCount++;
        // The inbound topic subscription is the third subscribeTopic call
        // (1st = registry, 2nd = coordination, 3rd = inbound)
        if (callCount === 3) {
          inboundCallback = callback;
        }
      }
    );

    node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'InboundTest',
      agentDescription: 'Test inbound messages',
      capabilities: TEST_CAPS,
    });

    await node.start();
  });

  afterEach(async () => {
    await node.stop();
  });

  it('should emit message event for valid JSON inbound messages', (done) => {
    node.on('message', (msg) => {
      expect(msg.type).toBe('data.request');
      expect(msg.payload.data).toBe('hello');
      done();
    });

    const message = JSON.stringify({
      type: 'data.request',
      senderId: 'remote-agent',
      payload: { data: 'hello' },
      timestamp: Date.now(),
    });

    inboundCallback({
      contents: Buffer.from(message),
      sequenceNumber: 1,
    });
  });

  it('should silently ignore malformed JSON', () => {
    const spy = jest.fn();
    node.on('message', spy);

    inboundCallback({
      contents: Buffer.from('not valid json'),
      sequenceNumber: 1,
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('should handle empty buffer', () => {
    const spy = jest.fn();
    node.on('message', spy);

    inboundCallback({
      contents: Buffer.from(''),
      sequenceNumber: 1,
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('should handle binary data that is not UTF-8 JSON', () => {
    const spy = jest.fn();
    node.on('message', spy);

    inboundCallback({
      contents: Buffer.from([0x00, 0xff, 0x80, 0xfe]),
      sequenceNumber: 1,
    });

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('MeshNode - Capability Handlers', () => {
  let node: MeshNode;

  beforeEach(() => {
    jest.clearAllMocks();
    setupMock();
    node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'CapTest',
      agentDescription: 'Test capabilities',
      capabilities: TEST_CAPS,
    });
  });

  afterEach(async () => {
    await node.stop();
  });

  it('should register and call an async handler', async () => {
    node.registerCapabilityHandler('research', async (input) => {
      return { results: [`Found info about ${input.query}`] };
    });

    const result = await node.executeCapability('research', { query: 'AI' });
    expect(result).toEqual({ results: ['Found info about AI'] });
  });

  it('should throw clear error for missing handler', async () => {
    await expect(node.executeCapability('nonexistent', {}))
      .rejects.toThrow('No handler for capability: nonexistent');
  });

  it('should propagate handler errors', async () => {
    node.registerCapabilityHandler('failing', async () => {
      throw new Error('Handler crashed');
    });

    await expect(node.executeCapability('failing', {}))
      .rejects.toThrow('Handler crashed');
  });

  it('should support handlers returning different types', async () => {
    node.registerCapabilityHandler('string_result', async () => 'just a string');
    node.registerCapabilityHandler('number_result', async () => 42);
    node.registerCapabilityHandler('array_result', async () => [1, 2, 3]);
    node.registerCapabilityHandler('null_result', async () => null);

    expect(await node.executeCapability('string_result', {})).toBe('just a string');
    expect(await node.executeCapability('number_result', {})).toBe(42);
    expect(await node.executeCapability('array_result', {})).toEqual([1, 2, 3]);
    expect(await node.executeCapability('null_result', {})).toBeNull();
  });

  it('should pass input correctly to handler', async () => {
    const inputSpy = jest.fn().mockResolvedValue('ok');
    node.registerCapabilityHandler('spy_cap', inputSpy);

    await node.executeCapability('spy_cap', { key1: 'value1', key2: 42 });

    expect(inputSpy).toHaveBeenCalledWith({ key1: 'value1', key2: 42 });
  });

  it('should allow re-registering same capability', async () => {
    node.registerCapabilityHandler('cap', async () => 'v1');
    expect(await node.executeCapability('cap', {})).toBe('v1');

    node.registerCapabilityHandler('cap', async () => 'v2');
    expect(await node.executeCapability('cap', {})).toBe('v2');
  });

  it('should support multiple concurrent capability executions', async () => {
    node.registerCapabilityHandler('slow', async (input) => {
      return { id: input.id };
    });

    const results = await Promise.all([
      node.executeCapability('slow', { id: 1 }),
      node.executeCapability('slow', { id: 2 }),
      node.executeCapability('slow', { id: 3 }),
    ]);

    expect(results).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });
});

describe('MeshNode - Profile and Configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMock();
  });

  it('should have null profile before start', () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'NotStarted',
      agentDescription: 'Not started',
      capabilities: [],
    });
    expect(node.getProfile()).toBeNull();
  });

  it('should populate profile after start', async () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'Started',
      agentDescription: 'Started node',
      capabilities: TEST_CAPS,
    });

    const profile = await node.start();
    expect(profile.name).toBe('Started');
    expect(profile.description).toBe('Started node');
    expect(profile.status).toBe('active');
    expect(profile.capabilities).toEqual(TEST_CAPS);
    expect(profile.id).toBeTruthy();
    expect(profile.hederaAccountId).toBe('0.0.12345');
    expect(profile.metadata.version).toBe('1.0.0');
    expect(profile.metadata.coordinationTopicId).toBeDefined();

    await node.stop();
  });

  it('should use existing registry and coordination topics if provided', async () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'ExistingTopics',
      agentDescription: 'Existing',
      capabilities: [],
    });

    const profile = await node.start('0.0.888', '0.0.999');
    expect(profile.registryTopicId).toBe('0.0.888');
    expect(profile.metadata.coordinationTopicId).toBe('0.0.999');

    await node.stop();
  });

  it('should include createdAt timestamp', async () => {
    const before = Date.now();
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'TimestampTest',
      agentDescription: 'Timestamp test',
      capabilities: [],
    });

    const profile = await node.start();
    const after = Date.now();

    expect(profile.createdAt).toBeGreaterThanOrEqual(before);
    expect(profile.createdAt).toBeLessThanOrEqual(after);

    await node.stop();
  });

  it('should generate unique UUIDs for each start', async () => {
    const ids: string[] = [];

    for (let i = 0; i < 5; i++) {
      const node = new MeshNode({
        config: TEST_CONFIG,
        agentName: `Node${i}`,
        agentDescription: `Node ${i}`,
        capabilities: [],
      });
      const profile = await node.start();
      ids.push(profile.id);
      await node.stop();
    }

    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(5);
  });
});

describe('MeshNode - Stop and Cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMock();
  });

  it('should set agent status to inactive on stop', async () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'StopTest',
      agentDescription: 'Stop test',
      capabilities: [],
    });

    await node.start();
    await node.stop();

    // Should have submitted an update status message
    const calls = (HederaClient.prototype.submitMessage as jest.Mock).mock.calls;
    const lastMsg = JSON.parse(calls[calls.length - 1][1]);
    expect(lastMsg.type).toBe(MessageType.AGENT_STATUS_UPDATE);
    expect(lastMsg.payload.status).toBe('inactive');
  });

  it('should close hedera client on stop', async () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'CloseTest',
      agentDescription: 'Close test',
      capabilities: [],
    });

    await node.start();
    await node.stop();

    expect(HederaClient.prototype.close).toHaveBeenCalled();
  });

  it('should emit stopped event', async () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'EventTest',
      agentDescription: 'Event test',
      capabilities: [],
    });

    await node.start();
    const spy = jest.fn();
    node.on('stopped', spy);
    await node.stop();

    expect(spy).toHaveBeenCalled();
  });

  it('should be safe to stop an unstarted node', async () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'NeverStarted',
      agentDescription: 'Never started',
      capabilities: [],
    });

    // Should not throw
    await node.stop();
  });

  it('should stop heartbeat timer', async () => {
    const node = new MeshNode({
      config: { ...TEST_CONFIG, heartbeatInterval: 50 },
      agentName: 'HeartbeatStop',
      agentDescription: 'Heartbeat stop test',
      capabilities: [],
    });

    await node.start();
    const countAtStart = (HederaClient.prototype.submitMessage as jest.Mock).mock.calls.length;

    await node.stop();

    // Wait to ensure no more heartbeats
    await new Promise(r => setTimeout(r, 150));
    const countAfter = (HederaClient.prototype.submitMessage as jest.Mock).mock.calls.length;

    // The stop itself sends one more message (status update to inactive)
    // After that, no more heartbeats should happen
    expect(countAfter - countAtStart).toBeLessThanOrEqual(1);
  });
});

describe('MeshNode - submitTask', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMock();
  });

  it('should throw if node not started', async () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'NoStart',
      agentDescription: 'No start',
      capabilities: [],
    });

    await expect(node.submitTask('task', ['cap'])).rejects.toThrow('Node not started');
  });

  it('should submit with all priority levels', async () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'PriorityTest',
      agentDescription: 'Priority test',
      capabilities: [],
    });

    await node.start();

    for (const priority of ['low', 'medium', 'high', 'critical'] as const) {
      const taskId = await node.submitTask(`Task ${priority}`, ['cap'], {}, priority);
      expect(taskId).toBeTruthy();
    }

    await node.stop();
  });

  it('should submit with complex payload', async () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'PayloadTest',
      agentDescription: 'Payload test',
      capabilities: [],
    });

    await node.start();
    const taskId = await node.submitTask('Complex task', ['research'], {
      nested: { deep: { value: 42 } },
      array: [1, 2, 3],
      nullValue: null,
    });
    expect(taskId).toBeTruthy();

    await node.stop();
  });
});

describe('MeshNode - Component Access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMock();
  });

  it('should expose registry before start', () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'Access',
      agentDescription: 'Access test',
      capabilities: [],
    });

    expect(node.getRegistry()).toBeDefined();
  });

  it('should expose coordinator before start', () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'Access',
      agentDescription: 'Access test',
      capabilities: [],
    });

    expect(node.getCoordinator()).toBeDefined();
  });

  it('should expose hedera client', () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'Access',
      agentDescription: 'Access test',
      capabilities: [],
    });

    expect(node.getHederaClient()).toBeDefined();
  });

  it('should delegate getBalance to hedera client', async () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'Balance',
      agentDescription: 'Balance test',
      capabilities: [],
    });

    const balance = await node.getBalance();
    expect(balance).toBe(50);
  });

  it('should delegate discoverAgents to registry', () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'Discover',
      agentDescription: 'Discover test',
      capabilities: [],
    });

    const result = node.discoverAgents();
    expect(result).toBeDefined();
    expect(result.agents).toBeDefined();
  });

  it('should pass capability filter to discoverAgents', () => {
    const node = new MeshNode({
      config: TEST_CONFIG,
      agentName: 'DiscoverFilter',
      agentDescription: 'Filter test',
      capabilities: [],
    });

    const result = node.discoverAgents('web_research');
    expect(result).toBeDefined();
  });
});
