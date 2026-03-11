import { AgentRegistry } from '../core/agent-registry';
import { HederaClient } from '../core/hedera-client';
import { AgentProfile, MessageType } from '../core/types';

// Mock HederaClient
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

function createTestProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    description: 'A test agent',
    capabilities: [
      { name: 'web_research', description: 'Research', inputSchema: {}, outputSchema: {} },
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

describe('AgentRegistry', () => {
  let registry: AgentRegistry;
  let mockClient: jest.Mocked<HederaClient>;

  beforeEach(() => {
    mockClient = createMockHederaClient();
    registry = new AgentRegistry(mockClient);
  });

  describe('initialize', () => {
    it('should create a new registry topic when none provided', async () => {
      const topicId = await registry.initialize();
      expect(topicId).toBe('0.0.100');
      expect(mockClient.createTopic).toHaveBeenCalledWith('AgentMesh Registry v1');
    });

    it('should use existing registry topic when provided', async () => {
      const topicId = await registry.initialize('0.0.999');
      expect(topicId).toBe('0.0.999');
      expect(mockClient.createTopic).not.toHaveBeenCalled();
    });

    it('should subscribe to registry topic', async () => {
      await registry.initialize();
      expect(mockClient.subscribeTopic).toHaveBeenCalledWith(
        '0.0.100',
        expect.any(Function)
      );
    });
  });

  describe('registerAgent', () => {
    it('should register an agent and submit message', async () => {
      await registry.initialize();
      const profile = createTestProfile();

      const seqNum = await registry.registerAgent(profile);

      expect(seqNum).toBe(1);
      expect(mockClient.submitMessage).toHaveBeenCalled();
      expect(registry.getAgent('agent-1')).toEqual(profile);
    });

    it('should include profile in the registration message', async () => {
      await registry.initialize();
      const profile = createTestProfile();

      await registry.registerAgent(profile);

      const call = mockClient.submitMessage.mock.calls[0]!;
      const message = JSON.parse(call[1] as string);
      expect(message.type).toBe(MessageType.AGENT_REGISTER);
      expect(message.payload.profile.name).toBe('TestAgent');
    });

    it('should throw if registry not initialized', async () => {
      const profile = createTestProfile();
      await expect(registry.registerAgent(profile)).rejects.toThrow('Registry not initialized');
    });
  });

  describe('deregisterAgent', () => {
    it('should remove agent from registry', async () => {
      await registry.initialize();
      const profile = createTestProfile();
      await registry.registerAgent(profile);

      await registry.deregisterAgent('agent-1');

      expect(registry.getAgent('agent-1')).toBeUndefined();
    });

    it('should submit deregistration message', async () => {
      await registry.initialize();
      const profile = createTestProfile();
      await registry.registerAgent(profile);

      await registry.deregisterAgent('agent-1');

      const lastCall = mockClient.submitMessage.mock.calls[mockClient.submitMessage.mock.calls.length - 1]!;
      const message = JSON.parse(lastCall[1] as string);
      expect(message.type).toBe(MessageType.AGENT_DEREGISTER);
    });
  });

  describe('updateAgentStatus', () => {
    it('should update agent status locally', async () => {
      await registry.initialize();
      const profile = createTestProfile();
      await registry.registerAgent(profile);

      await registry.updateAgentStatus('agent-1', 'busy');

      expect(registry.getAgent('agent-1')?.status).toBe('busy');
    });

    it('should submit status update message', async () => {
      await registry.initialize();
      await registry.registerAgent(createTestProfile());

      await registry.updateAgentStatus('agent-1', 'inactive');

      const lastCall = mockClient.submitMessage.mock.calls[mockClient.submitMessage.mock.calls.length - 1]!;
      const message = JSON.parse(lastCall[1] as string);
      expect(message.type).toBe(MessageType.AGENT_STATUS_UPDATE);
      expect(message.payload.status).toBe('inactive');
    });
  });

  describe('discoverAgents', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('should return all agents when no filter', async () => {
      await registry.registerAgent(createTestProfile({ id: 'a1', name: 'Agent1' }));
      await registry.registerAgent(createTestProfile({ id: 'a2', name: 'Agent2' }));

      const result = registry.discoverAgents();
      expect(result.totalFound).toBe(2);
    });

    it('should filter by status', async () => {
      await registry.registerAgent(createTestProfile({ id: 'a1', status: 'active' }));
      await registry.registerAgent(createTestProfile({ id: 'a2', status: 'inactive' }));

      const result = registry.discoverAgents({ status: 'active' });
      expect(result.totalFound).toBe(1);
      expect(result.agents[0]!.id).toBe('a1');
    });

    it('should filter by capability name', async () => {
      await registry.registerAgent(createTestProfile({
        id: 'a1',
        capabilities: [{ name: 'web_research', description: 'Research', inputSchema: {}, outputSchema: {} }],
      }));
      await registry.registerAgent(createTestProfile({
        id: 'a2',
        capabilities: [{ name: 'data_analysis', description: 'Analysis', inputSchema: {}, outputSchema: {} }],
      }));

      const result = registry.discoverAgents({ capability: 'web_research' });
      expect(result.totalFound).toBe(1);
      expect(result.agents[0]!.id).toBe('a1');
    });

    it('should filter by capability description', async () => {
      await registry.registerAgent(createTestProfile({
        id: 'a1',
        capabilities: [{ name: 'cap1', description: 'sentiment analysis tool', inputSchema: {}, outputSchema: {} }],
      }));

      const result = registry.discoverAgents({ capability: 'sentiment' });
      expect(result.totalFound).toBe(1);
    });

    it('should limit results with maxResults', async () => {
      await registry.registerAgent(createTestProfile({ id: 'a1' }));
      await registry.registerAgent(createTestProfile({ id: 'a2' }));
      await registry.registerAgent(createTestProfile({ id: 'a3' }));

      const result = registry.discoverAgents({ maxResults: 2 });
      expect(result.agents).toHaveLength(2);
      expect(result.totalFound).toBe(2);
    });

    it('should combine filters', async () => {
      await registry.registerAgent(createTestProfile({
        id: 'a1', status: 'active',
        capabilities: [{ name: 'research', description: 'web research', inputSchema: {}, outputSchema: {} }],
      }));
      await registry.registerAgent(createTestProfile({
        id: 'a2', status: 'inactive',
        capabilities: [{ name: 'research', description: 'web research', inputSchema: {}, outputSchema: {} }],
      }));
      await registry.registerAgent(createTestProfile({
        id: 'a3', status: 'active',
        capabilities: [{ name: 'analysis', description: 'data analysis', inputSchema: {}, outputSchema: {} }],
      }));

      const result = registry.discoverAgents({ status: 'active', capability: 'research' });
      expect(result.totalFound).toBe(1);
      expect(result.agents[0]!.id).toBe('a1');
    });

    it('should return query time', async () => {
      const result = registry.discoverAgents();
      expect(result.queryTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getAllAgents', () => {
    it('should return empty array initially', () => {
      expect(registry.getAllAgents()).toEqual([]);
    });

    it('should return all registered agents', async () => {
      await registry.initialize();
      await registry.registerAgent(createTestProfile({ id: 'a1' }));
      await registry.registerAgent(createTestProfile({ id: 'a2' }));

      expect(registry.getAllAgents()).toHaveLength(2);
    });
  });

  describe('getAgentCount', () => {
    it('should return 0 initially', () => {
      expect(registry.getAgentCount()).toBe(0);
    });

    it('should return correct count', async () => {
      await registry.initialize();
      await registry.registerAgent(createTestProfile({ id: 'a1' }));
      expect(registry.getAgentCount()).toBe(1);
    });
  });

  describe('getRegistryTopicId', () => {
    it('should throw if not initialized', () => {
      expect(() => registry.getRegistryTopicId()).toThrow('Registry not initialized');
    });

    it('should return topic ID after initialization', async () => {
      await registry.initialize();
      expect(registry.getRegistryTopicId()).toBe('0.0.100');
    });
  });
});
