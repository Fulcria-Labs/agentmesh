/**
 * Types - Comprehensive interface and enum validation tests
 */

import {
  MessageType,
  AgentProfile,
  AgentCapability,
  TaskRequest,
  TaskAssignment,
  TaskResult,
  CoordinationMessage,
  MeshConfig,
  AgentDiscoveryResult,
  ConnectionInfo,
} from '../core/types';

describe('Types - Comprehensive', () => {
  describe('MessageType Enum Values', () => {
    it('should have at least 17 message types', () => {
      const values = Object.values(MessageType).filter(v => typeof v === 'string');
      expect(values.length).toBeGreaterThanOrEqual(17);
    });

    it('should use dot notation for all values', () => {
      Object.values(MessageType).forEach(value => {
        if (typeof value === 'string') {
          expect(value).toMatch(/^[a-z]+\.[a-z_]+$/);
        }
      });
    });

    it('should have unique values', () => {
      const values = Object.values(MessageType).filter(v => typeof v === 'string');
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });

    it('should group agent messages under agent prefix', () => {
      expect(MessageType.AGENT_REGISTER).toMatch(/^agent\./);
      expect(MessageType.AGENT_DEREGISTER).toMatch(/^agent\./);
      expect(MessageType.AGENT_HEARTBEAT).toMatch(/^agent\./);
      expect(MessageType.AGENT_STATUS_UPDATE).toMatch(/^agent\./);
    });

    it('should group task messages under task prefix', () => {
      expect(MessageType.TASK_REQUEST).toMatch(/^task\./);
      expect(MessageType.TASK_BID).toMatch(/^task\./);
      expect(MessageType.TASK_ASSIGN).toMatch(/^task\./);
      expect(MessageType.TASK_ACCEPT).toMatch(/^task\./);
      expect(MessageType.TASK_REJECT).toMatch(/^task\./);
      expect(MessageType.TASK_PROGRESS).toMatch(/^task\./);
      expect(MessageType.TASK_COMPLETE).toMatch(/^task\./);
      expect(MessageType.TASK_FAIL).toMatch(/^task\./);
    });

    it('should group capability messages under capability prefix', () => {
      expect(MessageType.CAPABILITY_QUERY).toMatch(/^capability\./);
      expect(MessageType.CAPABILITY_RESPONSE).toMatch(/^capability\./);
    });

    it('should group data messages under data prefix', () => {
      expect(MessageType.DATA_REQUEST).toMatch(/^data\./);
      expect(MessageType.DATA_RESPONSE).toMatch(/^data\./);
    });

    it('should group connection messages under connection prefix', () => {
      expect(MessageType.CONNECTION_REQUEST).toMatch(/^connection\./);
      expect(MessageType.CONNECTION_ACCEPT).toMatch(/^connection\./);
      expect(MessageType.CONNECTION_REJECT).toMatch(/^connection\./);
    });
  });

  describe('AgentProfile Interface', () => {
    it('should create profile with all required fields', () => {
      const profile: AgentProfile = {
        id: 'test-id',
        name: 'TestAgent',
        description: 'A test agent',
        capabilities: [],
        hederaAccountId: '0.0.12345',
        inboundTopicId: '0.0.100',
        outboundTopicId: '0.0.101',
        registryTopicId: '0.0.102',
        status: 'active',
        createdAt: Date.now(),
        metadata: {},
      };
      expect(profile).toBeDefined();
    });

    it('should support active status', () => {
      const p: AgentProfile = {
        id: '1', name: 'A', description: '', capabilities: [],
        hederaAccountId: '0.0.1', inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3', registryTopicId: '0.0.4',
        status: 'active', createdAt: 0, metadata: {},
      };
      expect(p.status).toBe('active');
    });

    it('should support inactive status', () => {
      const p: AgentProfile = {
        id: '1', name: 'A', description: '', capabilities: [],
        hederaAccountId: '0.0.1', inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3', registryTopicId: '0.0.4',
        status: 'inactive', createdAt: 0, metadata: {},
      };
      expect(p.status).toBe('inactive');
    });

    it('should support busy status', () => {
      const p: AgentProfile = {
        id: '1', name: 'A', description: '', capabilities: [],
        hederaAccountId: '0.0.1', inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3', registryTopicId: '0.0.4',
        status: 'busy', createdAt: 0, metadata: {},
      };
      expect(p.status).toBe('busy');
    });

    it('should support capabilities array', () => {
      const cap: AgentCapability = {
        name: 'research',
        description: 'Web research',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'string' },
      };
      const p: AgentProfile = {
        id: '1', name: 'A', description: '', capabilities: [cap],
        hederaAccountId: '0.0.1', inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3', registryTopicId: '0.0.4',
        status: 'active', createdAt: 0, metadata: {},
      };
      expect(p.capabilities).toHaveLength(1);
      expect(p.capabilities[0].name).toBe('research');
    });

    it('should support string metadata values', () => {
      const p: AgentProfile = {
        id: '1', name: 'A', description: '', capabilities: [],
        hederaAccountId: '0.0.1', inboundTopicId: '0.0.2',
        outboundTopicId: '0.0.3', registryTopicId: '0.0.4',
        status: 'active', createdAt: 0,
        metadata: { key1: 'val1', key2: 'val2' },
      };
      expect(p.metadata.key1).toBe('val1');
    });
  });

  describe('TaskRequest Interface', () => {
    it('should create with required fields', () => {
      const task: TaskRequest = {
        id: 'task-1',
        description: 'Do something',
        requiredCapabilities: ['cap1'],
        payload: {},
        priority: 'medium',
        requesterId: 'req-1',
        createdAt: Date.now(),
      };
      expect(task.id).toBe('task-1');
    });

    it('should support all priority levels', () => {
      const priorities: TaskRequest['priority'][] = ['low', 'medium', 'high', 'critical'];
      priorities.forEach(priority => {
        const task: TaskRequest = {
          id: '1', description: '', requiredCapabilities: [],
          payload: {}, priority, requesterId: '', createdAt: 0,
        };
        expect(task.priority).toBe(priority);
      });
    });

    it('should support optional deadline', () => {
      const task: TaskRequest = {
        id: '1', description: '', requiredCapabilities: [],
        payload: {}, priority: 'medium', requesterId: '', createdAt: 0,
        deadline: Date.now() + 60000,
      };
      expect(task.deadline).toBeDefined();
    });

    it('should support optional maxBudgetHbar', () => {
      const task: TaskRequest = {
        id: '1', description: '', requiredCapabilities: [],
        payload: {}, priority: 'medium', requesterId: '', createdAt: 0,
        maxBudgetHbar: 100,
      };
      expect(task.maxBudgetHbar).toBe(100);
    });

    it('should support complex payload', () => {
      const task: TaskRequest = {
        id: '1', description: '', requiredCapabilities: [],
        payload: {
          nested: { deep: { value: 42 } },
          array: [1, 2, 3],
          bool: true,
        },
        priority: 'medium', requesterId: '', createdAt: 0,
      };
      expect((task.payload as any).nested.deep.value).toBe(42);
    });

    it('should support multiple required capabilities', () => {
      const task: TaskRequest = {
        id: '1', description: '', requiredCapabilities: ['cap1', 'cap2', 'cap3'],
        payload: {}, priority: 'high', requesterId: '', createdAt: 0,
      };
      expect(task.requiredCapabilities).toHaveLength(3);
    });
  });

  describe('TaskAssignment Interface', () => {
    it('should create with required fields', () => {
      const assignment: TaskAssignment = {
        taskId: 'task-1',
        agentId: 'agent-1',
        capability: 'research',
        status: 'assigned',
      };
      expect(assignment.status).toBe('assigned');
    });

    it('should support all status values', () => {
      const statuses: TaskAssignment['status'][] = [
        'assigned', 'accepted', 'in_progress', 'completed', 'failed',
      ];
      statuses.forEach(status => {
        const a: TaskAssignment = {
          taskId: '1', agentId: '1', capability: 'x', status,
        };
        expect(a.status).toBe(status);
      });
    });

    it('should support optional result', () => {
      const a: TaskAssignment = {
        taskId: '1', agentId: '1', capability: 'x', status: 'completed',
        result: { data: 'output' },
      };
      expect(a.result).toEqual({ data: 'output' });
    });

    it('should support optional timestamps', () => {
      const a: TaskAssignment = {
        taskId: '1', agentId: '1', capability: 'x', status: 'completed',
        startedAt: 1000, completedAt: 2000,
      };
      expect(a.completedAt! - a.startedAt!).toBe(1000);
    });

    it('should support optional cost', () => {
      const a: TaskAssignment = {
        taskId: '1', agentId: '1', capability: 'x', status: 'completed',
        cost: 15.5,
      };
      expect(a.cost).toBe(15.5);
    });
  });

  describe('TaskResult Interface', () => {
    it('should create with all required fields', () => {
      const result: TaskResult = {
        taskId: 'task-1',
        status: 'success',
        outputs: {},
        agentResults: [],
        totalCost: 0,
        duration: 1000,
      };
      expect(result.status).toBe('success');
    });

    it('should support all status values', () => {
      const statuses: TaskResult['status'][] = ['success', 'partial', 'failed'];
      statuses.forEach(status => {
        const r: TaskResult = {
          taskId: '1', status, outputs: {}, agentResults: [],
          totalCost: 0, duration: 0,
        };
        expect(r.status).toBe(status);
      });
    });

    it('should support outputs map', () => {
      const r: TaskResult = {
        taskId: '1', status: 'success',
        outputs: { cap1: 'result1', cap2: 'result2' },
        agentResults: [], totalCost: 0, duration: 0,
      };
      expect(Object.keys(r.outputs)).toHaveLength(2);
    });
  });

  describe('CoordinationMessage Interface', () => {
    it('should create with required fields', () => {
      const msg: CoordinationMessage = {
        type: MessageType.TASK_REQUEST,
        senderId: 'sender-1',
        payload: {},
        timestamp: Date.now(),
      };
      expect(msg.type).toBe(MessageType.TASK_REQUEST);
    });

    it('should support optional recipientId', () => {
      const msg: CoordinationMessage = {
        type: MessageType.DATA_REQUEST,
        senderId: 's1',
        recipientId: 'r1',
        payload: {},
        timestamp: Date.now(),
      };
      expect(msg.recipientId).toBe('r1');
    });

    it('should support optional taskId', () => {
      const msg: CoordinationMessage = {
        type: MessageType.TASK_ASSIGN,
        senderId: 's1',
        taskId: 'task-1',
        payload: {},
        timestamp: Date.now(),
      };
      expect(msg.taskId).toBe('task-1');
    });

    it('should support optional sequenceNumber', () => {
      const msg: CoordinationMessage = {
        type: MessageType.TASK_REQUEST,
        senderId: 's1',
        payload: {},
        timestamp: Date.now(),
        sequenceNumber: 42,
      };
      expect(msg.sequenceNumber).toBe(42);
    });

    it('should support optional topicId', () => {
      const msg: CoordinationMessage = {
        type: MessageType.TASK_REQUEST,
        senderId: 's1',
        payload: {},
        timestamp: Date.now(),
        topicId: '0.0.100',
      };
      expect(msg.topicId).toBe('0.0.100');
    });
  });

  describe('MeshConfig Interface', () => {
    it('should create with required fields', () => {
      const config: MeshConfig = {
        network: 'testnet',
        operatorAccountId: '0.0.1',
        operatorPrivateKey: 'key123',
      };
      expect(config.network).toBe('testnet');
    });

    it('should support all network values', () => {
      const networks: MeshConfig['network'][] = ['mainnet', 'testnet', 'previewnet'];
      networks.forEach(network => {
        const c: MeshConfig = {
          network,
          operatorAccountId: '0.0.1',
          operatorPrivateKey: 'key',
        };
        expect(c.network).toBe(network);
      });
    });

    it('should support optional registryTopicId', () => {
      const c: MeshConfig = {
        network: 'testnet',
        operatorAccountId: '0.0.1',
        operatorPrivateKey: 'key',
        registryTopicId: '0.0.100',
      };
      expect(c.registryTopicId).toBe('0.0.100');
    });

    it('should support optional maxAgents', () => {
      const c: MeshConfig = {
        network: 'testnet',
        operatorAccountId: '0.0.1',
        operatorPrivateKey: 'key',
        maxAgents: 50,
      };
      expect(c.maxAgents).toBe(50);
    });

    it('should support optional heartbeatInterval', () => {
      const c: MeshConfig = {
        network: 'testnet',
        operatorAccountId: '0.0.1',
        operatorPrivateKey: 'key',
        heartbeatInterval: 30000,
      };
      expect(c.heartbeatInterval).toBe(30000);
    });

    it('should support optional taskTimeout', () => {
      const c: MeshConfig = {
        network: 'testnet',
        operatorAccountId: '0.0.1',
        operatorPrivateKey: 'key',
        taskTimeout: 120000,
      };
      expect(c.taskTimeout).toBe(120000);
    });
  });

  describe('AgentDiscoveryResult Interface', () => {
    it('should contain agents array', () => {
      const result: AgentDiscoveryResult = {
        agents: [],
        totalFound: 0,
        queryTime: 5,
      };
      expect(result.agents).toEqual([]);
    });

    it('should contain totalFound count', () => {
      const result: AgentDiscoveryResult = {
        agents: [],
        totalFound: 10,
        queryTime: 5,
      };
      expect(result.totalFound).toBe(10);
    });

    it('should contain queryTime', () => {
      const result: AgentDiscoveryResult = {
        agents: [],
        totalFound: 0,
        queryTime: 42,
      };
      expect(result.queryTime).toBe(42);
    });
  });

  describe('ConnectionInfo Interface', () => {
    it('should contain all required fields', () => {
      const conn: ConnectionInfo = {
        connectionTopicId: '0.0.500',
        peerId: 'peer-1',
        peerName: 'Peer Agent',
        establishedAt: Date.now(),
        lastActivity: Date.now(),
      };
      expect(conn.connectionTopicId).toBe('0.0.500');
      expect(conn.peerId).toBe('peer-1');
      expect(conn.peerName).toBe('Peer Agent');
    });

    it('should track activity time', () => {
      const established = Date.now();
      const conn: ConnectionInfo = {
        connectionTopicId: '0.0.500',
        peerId: 'p1',
        peerName: 'P1',
        establishedAt: established,
        lastActivity: established + 1000,
      };
      expect(conn.lastActivity - conn.establishedAt).toBe(1000);
    });
  });

  describe('AgentCapability Interface', () => {
    it('should have name field', () => {
      const cap: AgentCapability = {
        name: 'test',
        description: 'A test capability',
        inputSchema: {},
        outputSchema: {},
      };
      expect(cap.name).toBe('test');
    });

    it('should support complex schemas', () => {
      const cap: AgentCapability = {
        name: 'complex',
        description: 'Complex capability',
        inputSchema: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { type: 'number' } },
            config: { type: 'object' },
          },
          required: ['data'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            result: { type: 'string' },
            score: { type: 'number' },
          },
        },
      };
      expect(cap.inputSchema).toHaveProperty('properties');
    });
  });
});
