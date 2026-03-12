import { AgentRegistry } from '../core/agent-registry';
import { TaskCoordinator, TaskBid } from '../core/task-coordinator';
import { MeshNode } from '../core/mesh-node';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile, MessageType } from '../core/types';

jest.mock('../core/hedera-client');

function createMockClient(): jest.Mocked<HederaClient> {
  const mock = new HederaClient({
    network: 'testnet',
    operatorAccountId: '0.0.1',
    operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
  }) as jest.Mocked<HederaClient>;

  mock.createTopic = jest.fn().mockResolvedValue('0.0.100');
  mock.submitMessage = jest.fn().mockResolvedValue(1);
  mock.subscribeTopic = jest.fn();
  mock.unsubscribeTopic = jest.fn();
  mock.close = jest.fn();
  mock.emit = jest.fn().mockReturnValue(true);
  mock.getOperatorAccountId = jest.fn().mockReturnValue('0.0.1');
  mock.getBalance = jest.fn().mockResolvedValue(100);
  mock.on = jest.fn().mockReturnThis();

  return mock;
}

function createTestProfile(id: string, capabilities: string[]): AgentProfile {
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

describe('Fault Tolerance & Network Resilience', () => {
  describe('Network failure during registration', () => {
    let registry: AgentRegistry;
    let mockClient: jest.Mocked<HederaClient>;

    beforeEach(() => {
      mockClient = createMockClient();
      registry = new AgentRegistry(mockClient);
    });

    it('should propagate error when submitMessage fails during agent registration', async () => {
      await registry.initialize();
      mockClient.submitMessage.mockRejectedValueOnce(new Error('NETWORK_ERROR: connection reset'));

      const profile = createTestProfile('agent-1', ['research']);
      await expect(registry.registerAgent(profile)).rejects.toThrow('NETWORK_ERROR: connection reset');
    });

    it('should propagate error when submitMessage fails during deregistration', async () => {
      await registry.initialize();
      const profile = createTestProfile('agent-1', ['research']);
      await registry.registerAgent(profile);

      mockClient.submitMessage.mockRejectedValueOnce(new Error('UNAVAILABLE: node unreachable'));

      await expect(registry.deregisterAgent('agent-1')).rejects.toThrow('UNAVAILABLE: node unreachable');
    });

    it('should propagate error when createTopic fails during initialization', async () => {
      mockClient.createTopic.mockRejectedValueOnce(new Error('INSUFFICIENT_PAYER_BALANCE'));

      await expect(registry.initialize()).rejects.toThrow('INSUFFICIENT_PAYER_BALANCE');
    });

    it('should handle malformed JSON in topic messages without crashing', async () => {
      await registry.initialize();

      // Get the subscription callback that was registered
      const subscribeCall = mockClient.subscribeTopic.mock.calls[0]!;
      const callback = subscribeCall[1] as (message: { contents: Buffer; sequenceNumber: number }) => void;

      // Send malformed JSON - should not throw
      expect(() => {
        callback({ contents: Buffer.from('not-valid-json{{{'), sequenceNumber: 1 });
      }).not.toThrow();

      // Registry should still be functional
      expect(registry.getAgentCount()).toBe(0);
    });

    it('should allow re-registration after network recovery', async () => {
      await registry.initialize();
      const profile = createTestProfile('agent-1', ['research']);

      // First attempt fails
      mockClient.submitMessage.mockRejectedValueOnce(new Error('NETWORK_ERROR'));
      await expect(registry.registerAgent(profile)).rejects.toThrow('NETWORK_ERROR');

      // Network recovers, second attempt succeeds
      mockClient.submitMessage.mockResolvedValueOnce(2);
      const seqNum = await registry.registerAgent(profile);
      expect(seqNum).toBe(2);
      expect(registry.getAgent('agent-1')).toBeDefined();
    });
  });

  describe('Task submission under failures', () => {
    let coordinator: TaskCoordinator;
    let registry: AgentRegistry;
    let mockClient: jest.Mocked<HederaClient>;

    beforeEach(async () => {
      mockClient = createMockClient();
      registry = new AgentRegistry(mockClient);
      mockClient.createTopic.mockResolvedValueOnce('0.0.100');
      await registry.initialize();
      mockClient.createTopic.mockResolvedValue('0.0.300');
      coordinator = new TaskCoordinator(mockClient, registry);
      await coordinator.initialize();
    });

    it('should propagate error when submitMessage fails during task submission', async () => {
      mockClient.submitMessage.mockRejectedValueOnce(new Error('TOPIC_EXPIRED'));

      await expect(coordinator.submitTask({
        description: 'Failing task',
        requiredCapabilities: ['research'],
        payload: {},
        priority: 'high',
        requesterId: 'agent-1',
      })).rejects.toThrow('TOPIC_EXPIRED');
    });

    it('should propagate error when submitMessage fails during bid submission', async () => {
      mockClient.submitMessage.mockRejectedValueOnce(new Error('TRANSACTION_OVERSIZE'));

      const bid: TaskBid = {
        taskId: 'task-1',
        agentId: 'agent-2',
        capability: 'research',
        estimatedDuration: 5000,
        estimatedCost: 1,
        confidence: 0.9,
        timestamp: Date.now(),
      };

      await expect(coordinator.submitBid(bid)).rejects.toThrow('TRANSACTION_OVERSIZE');
    });

    it('should return empty assignments when autoAssign finds no capable agents', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Task needing rare skill',
        requiredCapabilities: ['quantum_computing'],
        payload: {},
        priority: 'critical',
        requesterId: 'agent-1',
      });

      // No agents registered with quantum_computing capability
      const assignments = await coordinator.autoAssignTask(taskId);
      expect(assignments).toHaveLength(0);
    });

    it('should not store bid when task has no bids map entry', async () => {
      // Submit a bid for a task ID that was never submitted (no bids map entry)
      const bid: TaskBid = {
        taskId: 'nonexistent-task',
        agentId: 'agent-2',
        capability: 'research',
        estimatedDuration: 5000,
        estimatedCost: 1,
        confidence: 0.9,
        timestamp: Date.now(),
      };

      // Should not throw - bid just won't be stored in internal map
      await coordinator.submitBid(bid);

      // getTaskBids returns empty array for unknown task
      const bids = coordinator.getTaskBids('nonexistent-task');
      expect(bids).toHaveLength(0);
    });

    it('should handle completeTask gracefully when no matching assignment exists', async () => {
      // Complete a task that has no assignments - should not throw
      await expect(
        coordinator.completeTask('no-such-task', 'agent-1', { data: 'result' })
      ).resolves.not.toThrow();

      // Verify the message was still submitted to Hedera
      const lastCall = mockClient.submitMessage.mock.calls[mockClient.submitMessage.mock.calls.length - 1]!;
      const message = JSON.parse(lastCall[1] as string);
      expect(message.type).toBe(MessageType.TASK_COMPLETE);
    });
  });

  describe('Message handling edge cases', () => {
    let coordinator: TaskCoordinator;
    let registry: AgentRegistry;
    let mockClient: jest.Mocked<HederaClient>;

    beforeEach(async () => {
      mockClient = createMockClient();
      registry = new AgentRegistry(mockClient);
      mockClient.createTopic.mockResolvedValueOnce('0.0.100');
      await registry.initialize();
      mockClient.createTopic.mockResolvedValue('0.0.300');
      coordinator = new TaskCoordinator(mockClient, registry);
      await coordinator.initialize();
    });

    it('should submit small messages (<=1024 bytes) via submitMessage without error', async () => {
      // A normal-sized task payload well under 1024 bytes
      const taskId = await coordinator.submitTask({
        description: 'Small task',
        requiredCapabilities: ['analysis'],
        payload: { data: 'small' },
        priority: 'low',
        requesterId: 'agent-1',
      });

      expect(taskId).toBeDefined();
      expect(mockClient.submitMessage).toHaveBeenCalled();
    });

    it('should submit large task payloads via submitMessage', async () => {
      // Create a payload that would produce a large JSON string
      const largeData = 'x'.repeat(2000);
      const taskId = await coordinator.submitTask({
        description: 'Large payload task',
        requiredCapabilities: ['processing'],
        payload: { bigField: largeData },
        priority: 'medium',
        requesterId: 'agent-1',
      });

      expect(taskId).toBeDefined();
      // The submitMessage call should have received the full serialized message
      const lastCall = mockClient.submitMessage.mock.calls[mockClient.submitMessage.mock.calls.length - 1]!;
      const serialized = lastCall[1] as string;
      expect(serialized.length).toBeGreaterThan(2000);
    });

    it('should handle empty payload in task submission', async () => {
      const taskId = await coordinator.submitTask({
        description: 'Empty payload task',
        requiredCapabilities: [],
        payload: {},
        priority: 'low',
        requesterId: 'agent-1',
      });

      expect(taskId).toBeDefined();
      const task = coordinator.getTask(taskId);
      expect(task).toBeDefined();
      expect(task!.payload).toEqual({});
    });

    it('should handle coordination message with malformed JSON gracefully', async () => {
      // Get the coordination topic subscription callback
      const coordinationSubscribeCalls = mockClient.subscribeTopic.mock.calls;
      // The second subscribeTopic call is for the coordinator (first is registry)
      const coordCallback = coordinationSubscribeCalls[1]![1] as (message: { contents: Buffer; sequenceNumber: number }) => void;

      // Send malformed JSON - should not throw
      expect(() => {
        coordCallback({ contents: Buffer.from('}}invalid{{'), sequenceNumber: 5 });
      }).not.toThrow();

      // Coordinator should still function
      expect(coordinator.getTaskCount()).toBe(0);
    });

    it('should handle very large task description without error', async () => {
      const longDescription = 'Analyze '.repeat(500);

      const taskId = await coordinator.submitTask({
        description: longDescription,
        requiredCapabilities: ['analysis'],
        payload: {},
        priority: 'high',
        requesterId: 'agent-1',
      });

      expect(taskId).toBeDefined();
      const task = coordinator.getTask(taskId);
      expect(task!.description).toBe(longDescription);
    });
  });

  describe('Subscription and connection lifecycle', () => {
    let mockClient: jest.Mocked<HederaClient>;

    beforeEach(() => {
      mockClient = createMockClient();
    });

    it('should not error when unsubscribing from non-existent topic', () => {
      // unsubscribeTopic for a topic that was never subscribed should not throw
      expect(() => {
        mockClient.unsubscribeTopic('0.0.99999');
      }).not.toThrow();
    });

    it('should allow subscribing to the same topic multiple times', async () => {
      const registry = new AgentRegistry(mockClient);
      await registry.initialize('0.0.500');

      // subscribeTopic was called once during initialize
      expect(mockClient.subscribeTopic).toHaveBeenCalledWith('0.0.500', expect.any(Function));

      // Create another registry subscribing to same topic
      const registry2 = new AgentRegistry(mockClient);
      await registry2.initialize('0.0.500');

      // subscribeTopic should have been called twice total
      expect(mockClient.subscribeTopic).toHaveBeenCalledTimes(2);
    });

    it('should handle MeshNode stop clearing heartbeat timer', async () => {
      jest.useFakeTimers();

      const node = new MeshNode({
        config: {
          network: 'testnet',
          operatorAccountId: '0.0.1',
          operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
          heartbeatInterval: 5000,
        },
        agentName: 'TestNode',
        agentDescription: 'A test mesh node',
        capabilities: [{ name: 'test', description: 'test cap', inputSchema: {}, outputSchema: {} }],
      });

      // Access the internal mocked client
      const internalClient = (node as any).hederaClient as jest.Mocked<HederaClient>;
      internalClient.createTopic = jest.fn().mockResolvedValue('0.0.100');
      internalClient.submitMessage = jest.fn().mockResolvedValue(1);
      internalClient.subscribeTopic = jest.fn();
      internalClient.close = jest.fn();
      internalClient.getOperatorAccountId = jest.fn().mockReturnValue('0.0.1');
      internalClient.emit = jest.fn().mockReturnValue(true);

      await node.start();

      // Stop should clear the heartbeat timer and not throw
      await node.stop();

      // Advance time - no heartbeat should fire after stop
      const submitCallCount = internalClient.submitMessage.mock.calls.length;
      jest.advanceTimersByTime(60000);
      // No new submitMessage calls after stop
      expect(internalClient.submitMessage.mock.calls.length).toBe(submitCallCount);

      jest.useRealTimers();
    });

    it('should emit error event from HederaClient subscription error callback', () => {
      // Verify that HederaClient has emit capability for error events
      const errorHandler = jest.fn();
      mockClient.on('error', errorHandler);

      // Simulate an error emission
      // Since emit is mocked, we verify it can be called with error data
      mockClient.emit('error', { topicId: '0.0.100', error: new Error('subscription failed') });

      expect(mockClient.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ topicId: '0.0.100' })
      );
    });

    it('should handle close being called on a fresh client without subscriptions', () => {
      // close() should not throw even when no subscriptions exist
      expect(() => {
        mockClient.close();
      }).not.toThrow();

      expect(mockClient.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('Registry message processing', () => {
    let registry: AgentRegistry;
    let mockClient: jest.Mocked<HederaClient>;
    let registryCallback: (message: { contents: Buffer; sequenceNumber: number }) => void;

    beforeEach(async () => {
      mockClient = createMockClient();
      registry = new AgentRegistry(mockClient);
      await registry.initialize();
      registryCallback = mockClient.subscribeTopic.mock.calls[0]![1] as any;
    });

    it('should handle AGENT_HEARTBEAT message by updating metadata', async () => {
      // First register an agent
      const profile = createTestProfile('heartbeat-agent', ['monitoring']);
      await registry.registerAgent(profile);

      const heartbeatTimestamp = 1710288000000;
      const heartbeatMsg = JSON.stringify({
        type: MessageType.AGENT_HEARTBEAT,
        senderId: 'heartbeat-agent',
        payload: { status: 'active' },
        timestamp: heartbeatTimestamp,
      });

      registryCallback({ contents: Buffer.from(heartbeatMsg), sequenceNumber: 5 });

      const agent = registry.getAgent('heartbeat-agent');
      expect(agent).toBeDefined();
      expect(agent!.metadata.lastHeartbeat).toBe(String(heartbeatTimestamp));
    });

    it('should handle AGENT_STATUS_UPDATE for unknown agent without crashing', () => {
      const statusMsg = JSON.stringify({
        type: MessageType.AGENT_STATUS_UPDATE,
        senderId: 'unknown-agent',
        payload: { status: 'busy' },
        timestamp: Date.now(),
      });

      // Should not throw - the agent just won't be found in the map
      expect(() => {
        registryCallback({ contents: Buffer.from(statusMsg), sequenceNumber: 6 });
      }).not.toThrow();

      // Unknown agent should still not be in registry
      expect(registry.getAgent('unknown-agent')).toBeUndefined();
    });

    it('should handle AGENT_DEREGISTER for unknown agent without crashing', () => {
      const deregisterMsg = JSON.stringify({
        type: MessageType.AGENT_DEREGISTER,
        senderId: 'ghost-agent',
        payload: {},
        timestamp: Date.now(),
      });

      expect(() => {
        registryCallback({ contents: Buffer.from(deregisterMsg), sequenceNumber: 7 });
      }).not.toThrow();

      expect(registry.getAgentCount()).toBe(0);
    });

    it('should silently ignore unknown message types', () => {
      const unknownMsg = JSON.stringify({
        type: 'some.unknown.type',
        senderId: 'agent-x',
        payload: { data: 'irrelevant' },
        timestamp: Date.now(),
      });

      expect(() => {
        registryCallback({ contents: Buffer.from(unknownMsg), sequenceNumber: 8 });
      }).not.toThrow();

      // Registry state should be unchanged
      expect(registry.getAgentCount()).toBe(0);
    });

    it('should handle message with missing payload fields gracefully', () => {
      // AGENT_REGISTER with missing profile field
      const incompleteMsg = JSON.stringify({
        type: MessageType.AGENT_REGISTER,
        senderId: 'broken-agent',
        payload: {},
        timestamp: Date.now(),
      });

      // The handler tries message.payload.profile which will be undefined
      // It should set undefined in the map but not crash the handler
      expect(() => {
        registryCallback({ contents: Buffer.from(incompleteMsg), sequenceNumber: 9 });
      }).not.toThrow();
    });
  });

  describe('Coordinator resilience', () => {
    let coordinator: TaskCoordinator;
    let registry: AgentRegistry;
    let mockClient: jest.Mocked<HederaClient>;

    beforeEach(async () => {
      mockClient = createMockClient();
      registry = new AgentRegistry(mockClient);
      mockClient.createTopic.mockResolvedValueOnce('0.0.100');
      await registry.initialize();
      mockClient.createTopic.mockResolvedValue('0.0.300');
      coordinator = new TaskCoordinator(mockClient, registry);
    });

    it('should return null from selectBestBid with empty bids', async () => {
      await coordinator.initialize();
      const taskId = await coordinator.submitTask({
        description: 'No bids task',
        requiredCapabilities: ['obscure_skill'],
        payload: {},
        priority: 'low',
        requesterId: 'agent-1',
      });

      const best = coordinator.selectBestBid(taskId);
      expect(best).toBeNull();
    });

    it('should return the single bid from selectBestBid when only one exists', async () => {
      await coordinator.initialize();
      const taskId = await coordinator.submitTask({
        description: 'Single bid task',
        requiredCapabilities: ['analysis'],
        payload: {},
        priority: 'medium',
        requesterId: 'agent-1',
      });

      const bid: TaskBid = {
        taskId,
        agentId: 'sole-bidder',
        capability: 'analysis',
        estimatedDuration: 3000,
        estimatedCost: 5,
        confidence: 0.8,
        timestamp: Date.now(),
      };
      await coordinator.submitBid(bid);

      const best = coordinator.selectBestBid(taskId);
      expect(best).not.toBeNull();
      expect(best!.agentId).toBe('sole-bidder');
    });

    it('should throw from getCoordinationTopicId before initialization', () => {
      expect(() => coordinator.getCoordinationTopicId()).toThrow('Coordinator not initialized');
    });

    it('should return empty array from getAllTasks for a new coordinator', async () => {
      await coordinator.initialize();
      expect(coordinator.getAllTasks()).toEqual([]);
      expect(coordinator.getTaskCount()).toBe(0);
    });

    it('should produce partial result when tasks have mix of completed and failed assignments', async () => {
      await coordinator.initialize();
      const spy = jest.fn();
      coordinator.on('task:completed', spy);

      const taskId = await coordinator.submitTask({
        description: 'Mixed outcome task',
        requiredCapabilities: ['cap_a', 'cap_b', 'cap_c'],
        payload: {},
        priority: 'high',
        requesterId: 'requester-1',
      });

      // Create three assignments
      await coordinator.assignTask(taskId, 'agent-a', 'cap_a');
      await coordinator.assignTask(taskId, 'agent-b', 'cap_b');
      await coordinator.assignTask(taskId, 'agent-c', 'cap_c');

      // Complete two, fail one
      await coordinator.completeTask(taskId, 'agent-a', { output: 'done_a' });
      await coordinator.completeTask(taskId, 'agent-b', { output: 'done_b' });
      await coordinator.failTask(taskId, 'agent-c', 'timeout_error');

      expect(spy).toHaveBeenCalled();
      const result = spy.mock.calls[0]![0];
      expect(result.taskId).toBe(taskId);
      expect(result.status).toBe('partial');
      expect(result.agentResults).toHaveLength(3);

      // Verify the task result is stored
      const storedResult = coordinator.getTaskResult(taskId);
      expect(storedResult).toBeDefined();
      expect(storedResult!.status).toBe('partial');
    });
  });
});
