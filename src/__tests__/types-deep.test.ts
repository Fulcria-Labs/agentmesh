/**
 * Types - Deep coverage tests
 *
 * Covers: type construction edge cases, serialization/deserialization,
 * enum completeness, field combinations, and boundary values.
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

describe('MessageType - Completeness', () => {
  it('should have at least 17 message types', () => {
    const messageTypes = Object.values(MessageType);
    expect(messageTypes.length).toBeGreaterThanOrEqual(17);
  });

  it('should have unique values', () => {
    const values = Object.values(MessageType);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  it('should follow dot notation format', () => {
    const values = Object.values(MessageType);
    for (const value of values) {
      expect(value).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it('should group by prefix', () => {
    const values = Object.values(MessageType) as string[];
    const agentTypes = values.filter(v => typeof v === 'string' && v.startsWith('agent.'));
    const taskTypes = values.filter(v => typeof v === 'string' && v.startsWith('task.'));
    const capabilityTypes = values.filter(v => typeof v === 'string' && v.startsWith('capability.'));
    const dataTypes = values.filter(v => typeof v === 'string' && v.startsWith('data.'));
    const connectionTypes = values.filter(v => typeof v === 'string' && v.startsWith('connection.'));

    expect(agentTypes.length).toBeGreaterThanOrEqual(4);
    expect(taskTypes.length).toBeGreaterThanOrEqual(8);
    expect(capabilityTypes.length).toBeGreaterThanOrEqual(2);
    expect(dataTypes.length).toBeGreaterThanOrEqual(2);
    expect(connectionTypes.length).toBeGreaterThanOrEqual(3);
  });

  it('should be usable as string keys', () => {
    const msg: Record<string, boolean> = {};
    msg[MessageType.AGENT_REGISTER] = true;
    msg[MessageType.TASK_REQUEST] = true;
    expect(msg['agent.register']).toBe(true);
    expect(msg['task.request']).toBe(true);
  });
});

describe('AgentProfile - Construction', () => {
  it('should support all fields', () => {
    const profile: AgentProfile = {
      id: 'unique-id',
      name: 'MyAgent',
      description: 'An agent that does things',
      capabilities: [
        { name: 'cap1', description: 'Capability 1', inputSchema: { type: 'object' }, outputSchema: { type: 'object' } },
        { name: 'cap2', description: 'Capability 2', inputSchema: {}, outputSchema: {} },
      ],
      hederaAccountId: '0.0.12345',
      inboundTopicId: '0.0.100',
      outboundTopicId: '0.0.101',
      registryTopicId: '0.0.102',
      status: 'active',
      createdAt: Date.now(),
      metadata: { key1: 'value1', key2: 'value2' },
    };

    expect(profile.capabilities).toHaveLength(2);
    expect(Object.keys(profile.metadata)).toHaveLength(2);
  });

  it('should support empty capabilities array', () => {
    const profile: AgentProfile = {
      id: 'test', name: 'test', description: 'test',
      capabilities: [],
      hederaAccountId: '0.0.1', inboundTopicId: '0.0.2',
      outboundTopicId: '0.0.3', registryTopicId: '0.0.4',
      status: 'active', createdAt: 0, metadata: {},
    };
    expect(profile.capabilities).toEqual([]);
  });

  it('should support empty metadata', () => {
    const profile: AgentProfile = {
      id: 'test', name: 'test', description: 'test',
      capabilities: [],
      hederaAccountId: '0.0.1', inboundTopicId: '0.0.2',
      outboundTopicId: '0.0.3', registryTopicId: '0.0.4',
      status: 'active', createdAt: 0, metadata: {},
    };
    expect(profile.metadata).toEqual({});
  });

  it('should survive JSON roundtrip', () => {
    const original: AgentProfile = {
      id: 'rt-test', name: 'Roundtrip', description: 'Test',
      capabilities: [{ name: 'cap', description: 'desc', inputSchema: { x: 1 }, outputSchema: { y: 2 } }],
      hederaAccountId: '0.0.999', inboundTopicId: '0.0.100',
      outboundTopicId: '0.0.101', registryTopicId: '0.0.102',
      status: 'busy', createdAt: 1234567890, metadata: { key: 'value' },
    };

    const roundtripped = JSON.parse(JSON.stringify(original)) as AgentProfile;
    expect(roundtripped).toEqual(original);
  });
});

describe('AgentCapability - Schemas', () => {
  it('should support complex input schemas', () => {
    const cap: AgentCapability = {
      name: 'complex_cap',
      description: 'Complex capability',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Input text' },
          options: {
            type: 'object',
            properties: {
              depth: { type: 'number' },
              format: { type: 'string', enum: ['json', 'text'] },
            },
          },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['text'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          result: { type: 'string' },
          metadata: { type: 'object' },
        },
      },
    };

    expect(cap.inputSchema.properties).toBeDefined();
    expect((cap.inputSchema as any).required).toContain('text');
  });

  it('should support empty schemas', () => {
    const cap: AgentCapability = {
      name: 'minimal',
      description: 'Minimal capability',
      inputSchema: {},
      outputSchema: {},
    };
    expect(cap.inputSchema).toEqual({});
  });
});

describe('TaskRequest - Edge Cases', () => {
  it('should support empty required capabilities', () => {
    const task: TaskRequest = {
      id: 'task-empty', description: 'No caps needed',
      requiredCapabilities: [], payload: {},
      priority: 'low', requesterId: 'agent-1', createdAt: Date.now(),
    };
    expect(task.requiredCapabilities).toEqual([]);
  });

  it('should support many required capabilities', () => {
    const caps = Array(20).fill(null).map((_, i) => `cap_${i}`);
    const task: TaskRequest = {
      id: 'task-many', description: 'Many caps',
      requiredCapabilities: caps, payload: {},
      priority: 'critical', requesterId: 'agent-1', createdAt: Date.now(),
    };
    expect(task.requiredCapabilities).toHaveLength(20);
  });

  it('should support complex payload', () => {
    const task: TaskRequest = {
      id: 'task-complex', description: 'Complex payload',
      requiredCapabilities: ['a'],
      payload: {
        nested: { deep: { deeper: { value: 42 } } },
        array: [1, 'two', { three: true }],
        nullValue: null,
        boolValue: false,
        numValue: 3.14,
      },
      priority: 'medium', requesterId: 'agent-1', createdAt: Date.now(),
    };
    expect((task.payload as any).nested.deep.deeper.value).toBe(42);
  });

  it('should support deadline and maxBudgetHbar', () => {
    const task: TaskRequest = {
      id: 'task-opts', description: 'Optional fields',
      requiredCapabilities: [], payload: {},
      priority: 'high', requesterId: 'agent-1', createdAt: Date.now(),
      deadline: Date.now() + 3600000,
      maxBudgetHbar: 100,
    };
    expect(task.deadline).toBeDefined();
    expect(task.maxBudgetHbar).toBe(100);
  });

  it('should survive JSON roundtrip', () => {
    const original: TaskRequest = {
      id: 'rt', description: 'Roundtrip', requiredCapabilities: ['a', 'b'],
      payload: { key: 'value' }, priority: 'high', requesterId: 'r1',
      createdAt: 1000000, deadline: 2000000, maxBudgetHbar: 50,
    };
    const rt = JSON.parse(JSON.stringify(original)) as TaskRequest;
    expect(rt).toEqual(original);
  });
});

describe('TaskAssignment - Status Transitions', () => {
  it('should support all status values', () => {
    const statuses: TaskAssignment['status'][] = ['assigned', 'accepted', 'in_progress', 'completed', 'failed'];
    for (const status of statuses) {
      const assignment: TaskAssignment = {
        taskId: 't', agentId: 'a', capability: 'c', status,
      };
      expect(assignment.status).toBe(status);
    }
  });

  it('should support optional fields', () => {
    const assignment: TaskAssignment = {
      taskId: 't1', agentId: 'a1', capability: 'research',
      status: 'completed',
      result: { findings: ['data'] },
      startedAt: 1000,
      completedAt: 2000,
      cost: 5.5,
    };
    expect(assignment.result).toBeDefined();
    expect(assignment.cost).toBe(5.5);
    expect((assignment.completedAt ?? 0) - (assignment.startedAt ?? 0)).toBe(1000);
  });

  it('should support undefined optional fields', () => {
    const assignment: TaskAssignment = {
      taskId: 't', agentId: 'a', capability: 'c', status: 'assigned',
    };
    expect(assignment.result).toBeUndefined();
    expect(assignment.startedAt).toBeUndefined();
    expect(assignment.completedAt).toBeUndefined();
    expect(assignment.cost).toBeUndefined();
  });
});

describe('TaskResult - Status Values', () => {
  it('should support success status', () => {
    const result: TaskResult = {
      taskId: 't1', status: 'success', outputs: { a: 'done' },
      agentResults: [], totalCost: 0, duration: 1000,
    };
    expect(result.status).toBe('success');
  });

  it('should support partial status', () => {
    const result: TaskResult = {
      taskId: 't2', status: 'partial', outputs: {},
      agentResults: [
        { taskId: 't2', agentId: 'a1', capability: 'c1', status: 'completed' },
        { taskId: 't2', agentId: 'a2', capability: 'c2', status: 'failed' },
      ],
      totalCost: 10, duration: 5000,
    };
    expect(result.agentResults).toHaveLength(2);
  });

  it('should support failed status', () => {
    const result: TaskResult = {
      taskId: 't3', status: 'failed', outputs: {},
      agentResults: [
        { taskId: 't3', agentId: 'a1', capability: 'c1', status: 'failed' },
      ],
      totalCost: 0, duration: 100,
    };
    expect(result.status).toBe('failed');
  });

  it('should support zero cost and duration', () => {
    const result: TaskResult = {
      taskId: 't', status: 'success', outputs: {},
      agentResults: [], totalCost: 0, duration: 0,
    };
    expect(result.totalCost).toBe(0);
    expect(result.duration).toBe(0);
  });

  it('should support complex outputs', () => {
    const result: TaskResult = {
      taskId: 't', status: 'success',
      outputs: {
        research: { findings: ['f1', 'f2'], sources: ['s1'] },
        analysis: { insights: ['i1'], stats: { mean: 42 } },
      },
      agentResults: [], totalCost: 15.5, duration: 10000,
    };
    expect(Object.keys(result.outputs)).toHaveLength(2);
  });
});

describe('CoordinationMessage - Construction', () => {
  it('should support minimal message', () => {
    const msg: CoordinationMessage = {
      type: MessageType.AGENT_HEARTBEAT,
      senderId: 'agent-1',
      payload: {},
      timestamp: Date.now(),
    };
    expect(msg.recipientId).toBeUndefined();
    expect(msg.taskId).toBeUndefined();
  });

  it('should support fully populated message', () => {
    const msg: CoordinationMessage = {
      type: MessageType.TASK_ASSIGN,
      senderId: 'coordinator',
      recipientId: 'agent-1',
      taskId: 'task-1',
      payload: { assignment: { agentId: 'agent-1' } },
      timestamp: Date.now(),
      sequenceNumber: 42,
      topicId: '0.0.100',
    };
    expect(msg.sequenceNumber).toBe(42);
    expect(msg.topicId).toBe('0.0.100');
  });

  it('should support all message types', () => {
    for (const type of Object.values(MessageType)) {
      const msg: CoordinationMessage = {
        type,
        senderId: 'test',
        payload: {},
        timestamp: Date.now(),
      };
      expect(msg.type).toBe(type);
    }
  });

  it('should serialize complex payload', () => {
    const msg: CoordinationMessage = {
      type: MessageType.TASK_REQUEST,
      senderId: 'agent-1',
      payload: {
        task: {
          id: 'task-1',
          description: 'Complex task',
          requiredCapabilities: ['a', 'b'],
          nested: { deep: true },
        },
      },
      timestamp: Date.now(),
    };

    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json) as CoordinationMessage;
    expect(parsed.payload.task).toBeDefined();
    expect((parsed.payload.task as any).nested.deep).toBe(true);
  });
});

describe('MeshConfig - Network Options', () => {
  it('should support testnet', () => {
    const config: MeshConfig = {
      network: 'testnet',
      operatorAccountId: '0.0.1',
      operatorPrivateKey: 'key',
    };
    expect(config.network).toBe('testnet');
  });

  it('should support mainnet', () => {
    const config: MeshConfig = {
      network: 'mainnet',
      operatorAccountId: '0.0.1',
      operatorPrivateKey: 'key',
    };
    expect(config.network).toBe('mainnet');
  });

  it('should support previewnet', () => {
    const config: MeshConfig = {
      network: 'previewnet',
      operatorAccountId: '0.0.1',
      operatorPrivateKey: 'key',
    };
    expect(config.network).toBe('previewnet');
  });

  it('should support all optional config fields', () => {
    const config: MeshConfig = {
      network: 'testnet',
      operatorAccountId: '0.0.1',
      operatorPrivateKey: 'key',
      registryTopicId: '0.0.100',
      maxAgents: 1000,
      heartbeatInterval: 5000,
      taskTimeout: 120000,
    };
    expect(config.maxAgents).toBe(1000);
    expect(config.heartbeatInterval).toBe(5000);
    expect(config.taskTimeout).toBe(120000);
  });
});

describe('ConnectionInfo - Construction', () => {
  it('should support all fields', () => {
    const now = Date.now();
    const conn: ConnectionInfo = {
      connectionTopicId: '0.0.500',
      peerId: 'peer-1',
      peerName: 'PeerAgent',
      establishedAt: now - 10000,
      lastActivity: now,
    };
    expect(conn.lastActivity - conn.establishedAt).toBe(10000);
  });

  it('should survive JSON roundtrip', () => {
    const original: ConnectionInfo = {
      connectionTopicId: '0.0.123',
      peerId: 'peer',
      peerName: 'Peer',
      establishedAt: 1000,
      lastActivity: 2000,
    };
    const rt = JSON.parse(JSON.stringify(original)) as ConnectionInfo;
    expect(rt).toEqual(original);
  });
});

describe('AgentDiscoveryResult - Construction', () => {
  it('should support results with agents', () => {
    const result: AgentDiscoveryResult = {
      agents: [
        {
          id: 'a1', name: 'Agent1', description: 'Desc',
          capabilities: [], hederaAccountId: '0.0.1',
          inboundTopicId: '0.0.2', outboundTopicId: '0.0.3',
          registryTopicId: '0.0.4', status: 'active',
          createdAt: Date.now(), metadata: {},
        },
      ],
      totalFound: 1,
      queryTime: 2,
    };
    expect(result.agents).toHaveLength(1);
    expect(result.totalFound).toBe(1);
  });

  it('should support empty results', () => {
    const result: AgentDiscoveryResult = {
      agents: [],
      totalFound: 0,
      queryTime: 0,
    };
    expect(result.agents).toEqual([]);
  });
});
