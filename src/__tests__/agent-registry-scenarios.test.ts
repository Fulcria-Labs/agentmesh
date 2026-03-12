/**
 * AgentRegistry - Advanced scenarios: message handling, discovery edge cases, concurrency
 */

import { AgentRegistry } from '../core/agent-registry';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile, MessageType, CoordinationMessage } from '../core/types';

jest.mock('../core/hedera-client');

function createMockHederaClient(): jest.Mocked<HederaClient> {
  const mock = new HederaClient({
    network: 'testnet',
    operatorAccountId: '0.0.1',
    operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
  }) as jest.Mocked<HederaClient>;
  mock.createTopic = jest.fn().mockResolvedValue('0.0.100');
  mock.submitMessage = jest.fn().mockResolvedValue(1);
  mock.subscribeTopic = jest.fn();
  mock.emit = jest.fn().mockReturnValue(true);
  return mock;
}

function createProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'agent-default',
    name: 'DefaultAgent',
    description: 'Default test agent',
    capabilities: [
      { name: 'cap1', description: 'Capability 1', inputSchema: {}, outputSchema: {} },
    ],
    hederaAccountId: '0.0.12345',
    inboundTopicId: '0.0.200',
    outboundTopicId: '0.0.201',
    registryTopicId: '0.0.100',
    status: 'active',
    createdAt: Date.now(),
    metadata: {},
    ...overrides,
  };
}

describe('AgentRegistry - Advanced Scenarios', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(async () => {
    mockClient = createMockHederaClient();
    registry = new AgentRegistry(mockClient);
  });

  describe('Registry Message Handling', () => {
    let subscriptionCallback: any;

    beforeEach(async () => {
      mockClient.subscribeTopic = jest.fn().mockImplementation((_topicId, cb) => {
        subscriptionCallback = cb;
      });
      await registry.initialize('0.0.100');
    });

    it('should process AGENT_REGISTER messages from topic', () => {
      const profile = createProfile({ id: 'remote-agent', name: 'RemoteAgent' });
      const msg: CoordinationMessage = {
        type: MessageType.AGENT_REGISTER,
        senderId: 'remote-agent',
        payload: { profile },
        timestamp: Date.now(),
      };

      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      expect(registry.getAgent('remote-agent')).toBeDefined();
      expect(registry.getAgent('remote-agent')!.name).toBe('RemoteAgent');
    });

    it('should emit agent:registered on registration message', () => {
      const profile = createProfile({ id: 'remote-1' });
      const msg: CoordinationMessage = {
        type: MessageType.AGENT_REGISTER,
        senderId: 'remote-1',
        payload: { profile },
        timestamp: Date.now(),
      };

      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      expect(mockClient.emit).toHaveBeenCalledWith('agent:registered', profile);
    });

    it('should process AGENT_DEREGISTER messages', () => {
      // First register
      const profile = createProfile({ id: 'leaving-agent' });
      const regMsg: CoordinationMessage = {
        type: MessageType.AGENT_REGISTER,
        senderId: 'leaving-agent',
        payload: { profile },
        timestamp: Date.now(),
      };
      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(regMsg)),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });
      expect(registry.getAgent('leaving-agent')).toBeDefined();

      // Then deregister
      const deregMsg: CoordinationMessage = {
        type: MessageType.AGENT_DEREGISTER,
        senderId: 'leaving-agent',
        payload: {},
        timestamp: Date.now(),
      };
      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(deregMsg)),
        sequenceNumber: 2,
        consensusTimestamp: null,
      });

      expect(registry.getAgent('leaving-agent')).toBeUndefined();
    });

    it('should emit agent:deregistered on deregistration message', () => {
      const deregMsg: CoordinationMessage = {
        type: MessageType.AGENT_DEREGISTER,
        senderId: 'agent-x',
        payload: {},
        timestamp: Date.now(),
      };
      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(deregMsg)),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      expect(mockClient.emit).toHaveBeenCalledWith('agent:deregistered', 'agent-x');
    });

    it('should process AGENT_STATUS_UPDATE messages', () => {
      // Register first
      const profile = createProfile({ id: 'status-agent', status: 'active' });
      const regMsg: CoordinationMessage = {
        type: MessageType.AGENT_REGISTER,
        senderId: 'status-agent',
        payload: { profile },
        timestamp: Date.now(),
      };
      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(regMsg)),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      // Update status
      const statusMsg: CoordinationMessage = {
        type: MessageType.AGENT_STATUS_UPDATE,
        senderId: 'status-agent',
        payload: { status: 'busy' },
        timestamp: Date.now(),
      };
      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(statusMsg)),
        sequenceNumber: 2,
        consensusTimestamp: null,
      });

      expect(registry.getAgent('status-agent')!.status).toBe('busy');
    });

    it('should emit agent:statusChanged on status update', () => {
      const profile = createProfile({ id: 'change-agent', status: 'active' });
      const regMsg: CoordinationMessage = {
        type: MessageType.AGENT_REGISTER,
        senderId: 'change-agent',
        payload: { profile },
        timestamp: Date.now(),
      };
      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(regMsg)),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      const statusMsg: CoordinationMessage = {
        type: MessageType.AGENT_STATUS_UPDATE,
        senderId: 'change-agent',
        payload: { status: 'inactive' },
        timestamp: Date.now(),
      };
      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(statusMsg)),
        sequenceNumber: 2,
        consensusTimestamp: null,
      });

      expect(mockClient.emit).toHaveBeenCalledWith('agent:statusChanged', {
        agentId: 'change-agent',
        status: 'inactive',
      });
    });

    it('should ignore status update for unknown agent', () => {
      const statusMsg: CoordinationMessage = {
        type: MessageType.AGENT_STATUS_UPDATE,
        senderId: 'unknown-agent',
        payload: { status: 'busy' },
        timestamp: Date.now(),
      };

      // Should not throw
      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(statusMsg)),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      expect(registry.getAgent('unknown-agent')).toBeUndefined();
    });

    it('should process AGENT_HEARTBEAT messages', () => {
      const profile = createProfile({ id: 'heartbeat-agent', metadata: {} });
      const regMsg: CoordinationMessage = {
        type: MessageType.AGENT_REGISTER,
        senderId: 'heartbeat-agent',
        payload: { profile },
        timestamp: Date.now(),
      };
      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(regMsg)),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      const timestamp = Date.now();
      const heartbeatMsg: CoordinationMessage = {
        type: MessageType.AGENT_HEARTBEAT,
        senderId: 'heartbeat-agent',
        payload: {},
        timestamp,
      };
      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(heartbeatMsg)),
        sequenceNumber: 2,
        consensusTimestamp: null,
      });

      const agent = registry.getAgent('heartbeat-agent');
      expect(agent!.metadata.lastHeartbeat).toBe(String(timestamp));
    });

    it('should ignore heartbeat for unknown agent', () => {
      const heartbeatMsg: CoordinationMessage = {
        type: MessageType.AGENT_HEARTBEAT,
        senderId: 'ghost-agent',
        payload: {},
        timestamp: Date.now(),
      };

      // Should not throw
      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(heartbeatMsg)),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });
    });

    it('should handle malformed JSON messages gracefully', () => {
      subscriptionCallback({
        contents: Buffer.from('not json at all'),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      expect(registry.getAgentCount()).toBe(0);
    });

    it('should handle empty buffer messages', () => {
      subscriptionCallback({
        contents: Buffer.from(''),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      expect(registry.getAgentCount()).toBe(0);
    });

    it('should handle JSON with unknown message type', () => {
      const msg = {
        type: 'unknown.type',
        senderId: 'a1',
        payload: {},
        timestamp: Date.now(),
      };

      subscriptionCallback({
        contents: Buffer.from(JSON.stringify(msg)),
        sequenceNumber: 1,
        consensusTimestamp: null,
      });

      expect(registry.getAgentCount()).toBe(0);
    });
  });

  describe('Discovery Edge Cases', () => {
    beforeEach(async () => {
      await registry.initialize('0.0.100');
    });

    it('should handle case-insensitive capability search', async () => {
      await registry.registerAgent(createProfile({
        id: 'a1',
        capabilities: [{ name: 'Web_Research', description: 'Research', inputSchema: {}, outputSchema: {} }],
      }));

      const result = registry.discoverAgents({ capability: 'web_research' });
      expect(result.totalFound).toBe(1);
    });

    it('should handle uppercase capability search', async () => {
      await registry.registerAgent(createProfile({
        id: 'a1',
        capabilities: [{ name: 'research', description: 'Web research tool', inputSchema: {}, outputSchema: {} }],
      }));

      const result = registry.discoverAgents({ capability: 'RESEARCH' });
      expect(result.totalFound).toBe(1);
    });

    it('should search in capability description too', async () => {
      await registry.registerAgent(createProfile({
        id: 'a1',
        capabilities: [{ name: 'tool_x', description: 'Advanced sentiment analysis', inputSchema: {}, outputSchema: {} }],
      }));

      const result = registry.discoverAgents({ capability: 'sentiment' });
      expect(result.totalFound).toBe(1);
    });

    it('should return empty when no agents match status', async () => {
      await registry.registerAgent(createProfile({ id: 'a1', status: 'active' }));
      await registry.registerAgent(createProfile({ id: 'a2', status: 'active' }));

      const result = registry.discoverAgents({ status: 'busy' });
      expect(result.totalFound).toBe(0);
    });

    it('should handle maxResults of 0', async () => {
      await registry.registerAgent(createProfile({ id: 'a1' }));
      const result = registry.discoverAgents({ maxResults: 0 });
      // maxResults 0 is falsy, so filter won't be applied
      expect(result.totalFound).toBe(1);
    });

    it('should handle maxResults larger than available agents', async () => {
      await registry.registerAgent(createProfile({ id: 'a1' }));
      const result = registry.discoverAgents({ maxResults: 100 });
      expect(result.totalFound).toBe(1);
    });

    it('should handle agents with no capabilities', async () => {
      await registry.registerAgent(createProfile({ id: 'a1', capabilities: [] }));
      const result = registry.discoverAgents({ capability: 'anything' });
      expect(result.totalFound).toBe(0);
    });

    it('should handle agents with multiple capabilities', async () => {
      await registry.registerAgent(createProfile({
        id: 'a1',
        capabilities: [
          { name: 'research', description: 'Research', inputSchema: {}, outputSchema: {} },
          { name: 'analysis', description: 'Analysis', inputSchema: {}, outputSchema: {} },
          { name: 'summary', description: 'Summary', inputSchema: {}, outputSchema: {} },
        ],
      }));

      expect(registry.discoverAgents({ capability: 'research' }).totalFound).toBe(1);
      expect(registry.discoverAgents({ capability: 'analysis' }).totalFound).toBe(1);
      expect(registry.discoverAgents({ capability: 'summary' }).totalFound).toBe(1);
    });

    it('should return query time >= 0', async () => {
      const result = registry.discoverAgents();
      expect(result.queryTime).toBeGreaterThanOrEqual(0);
    });

    it('should discover among many agents efficiently', async () => {
      for (let i = 0; i < 50; i++) {
        await registry.registerAgent(createProfile({
          id: `agent-${i}`,
          capabilities: [
            { name: `capability-${i % 5}`, description: `Cap ${i}`, inputSchema: {}, outputSchema: {} },
          ],
        }));
      }

      const result = registry.discoverAgents({ capability: 'capability-3' });
      expect(result.totalFound).toBe(10); // 50/5 = 10 agents with capability-3
    });

    it('should filter by both status and capability', async () => {
      await registry.registerAgent(createProfile({
        id: 'a1',
        status: 'active',
        capabilities: [{ name: 'research', description: 'R', inputSchema: {}, outputSchema: {} }],
      }));
      await registry.registerAgent(createProfile({
        id: 'a2',
        status: 'busy',
        capabilities: [{ name: 'research', description: 'R', inputSchema: {}, outputSchema: {} }],
      }));
      await registry.registerAgent(createProfile({
        id: 'a3',
        status: 'active',
        capabilities: [{ name: 'analysis', description: 'A', inputSchema: {}, outputSchema: {} }],
      }));

      const result = registry.discoverAgents({ status: 'active', capability: 'research' });
      expect(result.totalFound).toBe(1);
      expect(result.agents[0].id).toBe('a1');
    });
  });

  describe('Registration Patterns', () => {
    beforeEach(async () => {
      await registry.initialize('0.0.100');
    });

    it('should handle re-registering same agent ID', async () => {
      const profile1 = createProfile({ id: 'a1', name: 'Version1' });
      const profile2 = createProfile({ id: 'a1', name: 'Version2' });

      await registry.registerAgent(profile1);
      await registry.registerAgent(profile2);

      expect(registry.getAgentCount()).toBe(1);
      expect(registry.getAgent('a1')!.name).toBe('Version2');
    });

    it('should handle deregistering non-existent agent', async () => {
      // Should not throw
      await registry.deregisterAgent('nonexistent');
      expect(registry.getAgentCount()).toBe(0);
    });

    it('should handle updating status of non-existent agent', async () => {
      // Should not throw, just submits message
      await registry.updateAgentStatus('nonexistent', 'busy');
    });

    it('should support sequential register/deregister cycles', async () => {
      for (let i = 0; i < 10; i++) {
        const profile = createProfile({ id: `cycle-agent-${i}` });
        await registry.registerAgent(profile);
      }
      expect(registry.getAgentCount()).toBe(10);

      for (let i = 0; i < 10; i++) {
        await registry.deregisterAgent(`cycle-agent-${i}`);
      }
      expect(registry.getAgentCount()).toBe(0);
    });

    it('should handle rapid registration of many agents', async () => {
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(registry.registerAgent(createProfile({ id: `rapid-${i}` })));
      }
      await Promise.all(promises);
      expect(registry.getAgentCount()).toBe(50);
    });
  });

  describe('Agent Data Integrity', () => {
    beforeEach(async () => {
      await registry.initialize('0.0.100');
    });

    it('should preserve all profile fields', async () => {
      const profile = createProfile({
        id: 'full-profile',
        name: 'FullAgent',
        description: 'A full test agent with all fields',
        capabilities: [
          { name: 'cap1', description: 'Capability 1', inputSchema: { type: 'object' }, outputSchema: { type: 'string' } },
          { name: 'cap2', description: 'Capability 2', inputSchema: { type: 'array' }, outputSchema: { type: 'number' } },
        ],
        hederaAccountId: '0.0.99999',
        inboundTopicId: '0.0.300',
        outboundTopicId: '0.0.301',
        registryTopicId: '0.0.100',
        status: 'busy',
        metadata: { key1: 'val1', key2: 'val2' },
      });

      await registry.registerAgent(profile);
      const retrieved = registry.getAgent('full-profile');

      expect(retrieved!.name).toBe('FullAgent');
      expect(retrieved!.description).toBe('A full test agent with all fields');
      expect(retrieved!.capabilities).toHaveLength(2);
      expect(retrieved!.hederaAccountId).toBe('0.0.99999');
      expect(retrieved!.status).toBe('busy');
      expect(retrieved!.metadata.key1).toBe('val1');
    });

    it('should generate proper message format for registration', async () => {
      const profile = createProfile({ id: 'msg-test' });
      await registry.registerAgent(profile);

      const call = mockClient.submitMessage.mock.calls[0];
      const msg = JSON.parse(call[1] as string);

      expect(msg.type).toBe(MessageType.AGENT_REGISTER);
      expect(msg.senderId).toBe('msg-test');
      expect(msg.payload.profile).toBeDefined();
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it('should generate proper message format for deregistration', async () => {
      await registry.registerAgent(createProfile({ id: 'dereg-test' }));
      await registry.deregisterAgent('dereg-test');

      const lastCall = mockClient.submitMessage.mock.calls[mockClient.submitMessage.mock.calls.length - 1];
      const msg = JSON.parse(lastCall[1] as string);

      expect(msg.type).toBe(MessageType.AGENT_DEREGISTER);
      expect(msg.senderId).toBe('dereg-test');
      expect(msg.payload).toEqual({});
    });

    it('should generate proper message format for status update', async () => {
      await registry.registerAgent(createProfile({ id: 'status-test' }));
      await registry.updateAgentStatus('status-test', 'inactive');

      const lastCall = mockClient.submitMessage.mock.calls[mockClient.submitMessage.mock.calls.length - 1];
      const msg = JSON.parse(lastCall[1] as string);

      expect(msg.type).toBe(MessageType.AGENT_STATUS_UPDATE);
      expect(msg.senderId).toBe('status-test');
      expect(msg.payload.status).toBe('inactive');
    });
  });

  describe('Error Conditions', () => {
    it('should throw on registerAgent before initialize', async () => {
      await expect(registry.registerAgent(createProfile())).rejects.toThrow('Registry not initialized');
    });

    it('should throw on deregisterAgent before initialize', async () => {
      await expect(registry.deregisterAgent('a1')).rejects.toThrow('Registry not initialized');
    });

    it('should throw on updateAgentStatus before initialize', async () => {
      await expect(registry.updateAgentStatus('a1', 'active')).rejects.toThrow('Registry not initialized');
    });

    it('should throw on getRegistryTopicId before initialize', () => {
      expect(() => registry.getRegistryTopicId()).toThrow('Registry not initialized');
    });

    it('should not throw on discoverAgents before initialize', () => {
      const result = registry.discoverAgents();
      expect(result.totalFound).toBe(0);
    });

    it('should not throw on getAllAgents before initialize', () => {
      expect(registry.getAllAgents()).toEqual([]);
    });

    it('should not throw on getAgentCount before initialize', () => {
      expect(registry.getAgentCount()).toBe(0);
    });

    it('should not throw on getAgent before initialize', () => {
      expect(registry.getAgent('a1')).toBeUndefined();
    });
  });
});
