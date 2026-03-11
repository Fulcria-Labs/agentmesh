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

describe('Types', () => {
  describe('MessageType enum', () => {
    it('should have all agent lifecycle message types', () => {
      expect(MessageType.AGENT_REGISTER).toBe('agent.register');
      expect(MessageType.AGENT_DEREGISTER).toBe('agent.deregister');
      expect(MessageType.AGENT_HEARTBEAT).toBe('agent.heartbeat');
      expect(MessageType.AGENT_STATUS_UPDATE).toBe('agent.status_update');
    });

    it('should have all task coordination message types', () => {
      expect(MessageType.TASK_REQUEST).toBe('task.request');
      expect(MessageType.TASK_BID).toBe('task.bid');
      expect(MessageType.TASK_ASSIGN).toBe('task.assign');
      expect(MessageType.TASK_ACCEPT).toBe('task.accept');
      expect(MessageType.TASK_REJECT).toBe('task.reject');
      expect(MessageType.TASK_PROGRESS).toBe('task.progress');
      expect(MessageType.TASK_COMPLETE).toBe('task.complete');
      expect(MessageType.TASK_FAIL).toBe('task.fail');
    });

    it('should have agent-to-agent message types', () => {
      expect(MessageType.CAPABILITY_QUERY).toBe('capability.query');
      expect(MessageType.CAPABILITY_RESPONSE).toBe('capability.response');
      expect(MessageType.DATA_REQUEST).toBe('data.request');
      expect(MessageType.DATA_RESPONSE).toBe('data.response');
    });

    it('should have connection management types', () => {
      expect(MessageType.CONNECTION_REQUEST).toBe('connection.request');
      expect(MessageType.CONNECTION_ACCEPT).toBe('connection.accept');
      expect(MessageType.CONNECTION_REJECT).toBe('connection.reject');
    });
  });

  describe('AgentProfile interface', () => {
    it('should create a valid agent profile', () => {
      const profile: AgentProfile = {
        id: 'agent-1',
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

      expect(profile.id).toBe('agent-1');
      expect(profile.status).toBe('active');
      expect(profile.capabilities).toHaveLength(0);
    });

    it('should support all status values', () => {
      const statuses: AgentProfile['status'][] = ['active', 'inactive', 'busy'];
      statuses.forEach(status => {
        const profile: AgentProfile = {
          id: 'test', name: 'test', description: 'test',
          capabilities: [], hederaAccountId: '0.0.1',
          inboundTopicId: '0.0.2', outboundTopicId: '0.0.3',
          registryTopicId: '0.0.4', status, createdAt: 0, metadata: {},
        };
        expect(profile.status).toBe(status);
      });
    });
  });

  describe('AgentCapability interface', () => {
    it('should create a valid capability', () => {
      const cap: AgentCapability = {
        name: 'web_research',
        description: 'Research topics on the web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
      };

      expect(cap.name).toBe('web_research');
      expect(cap.inputSchema).toBeDefined();
      expect(cap.outputSchema).toBeDefined();
    });
  });

  describe('TaskRequest interface', () => {
    it('should create a valid task request', () => {
      const task: TaskRequest = {
        id: 'task-1',
        description: 'Research AI trends',
        requiredCapabilities: ['web_research', 'summarize'],
        payload: { topic: 'AI' },
        priority: 'high',
        requesterId: 'agent-1',
        createdAt: Date.now(),
      };

      expect(task.requiredCapabilities).toHaveLength(2);
      expect(task.priority).toBe('high');
    });

    it('should support all priority values', () => {
      const priorities: TaskRequest['priority'][] = ['low', 'medium', 'high', 'critical'];
      priorities.forEach(priority => {
        const task: TaskRequest = {
          id: 'test', description: 'test', requiredCapabilities: [],
          payload: {}, priority, requesterId: 'test', createdAt: 0,
        };
        expect(task.priority).toBe(priority);
      });
    });

    it('should support optional fields', () => {
      const task: TaskRequest = {
        id: 'task-2',
        description: 'Test',
        requiredCapabilities: [],
        payload: {},
        priority: 'low',
        deadline: Date.now() + 60000,
        maxBudgetHbar: 10,
        requesterId: 'agent-1',
        createdAt: Date.now(),
      };

      expect(task.deadline).toBeDefined();
      expect(task.maxBudgetHbar).toBe(10);
    });
  });

  describe('TaskAssignment interface', () => {
    it('should create a valid assignment', () => {
      const assignment: TaskAssignment = {
        taskId: 'task-1',
        agentId: 'agent-1',
        capability: 'web_research',
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
          taskId: 't', agentId: 'a', capability: 'c', status,
        };
        expect(a.status).toBe(status);
      });
    });
  });

  describe('CoordinationMessage interface', () => {
    it('should create a valid message', () => {
      const msg: CoordinationMessage = {
        type: MessageType.TASK_REQUEST,
        senderId: 'agent-1',
        payload: { data: 'test' },
        timestamp: Date.now(),
      };

      expect(msg.type).toBe(MessageType.TASK_REQUEST);
      expect(msg.senderId).toBe('agent-1');
    });

    it('should serialize to JSON correctly', () => {
      const msg: CoordinationMessage = {
        type: MessageType.AGENT_REGISTER,
        senderId: 'agent-1',
        recipientId: 'agent-2',
        taskId: 'task-1',
        payload: { name: 'Test' },
        timestamp: 1234567890,
        sequenceNumber: 42,
        topicId: '0.0.100',
      };

      const json = JSON.stringify(msg);
      const parsed = JSON.parse(json);

      expect(parsed.type).toBe('agent.register');
      expect(parsed.senderId).toBe('agent-1');
      expect(parsed.sequenceNumber).toBe(42);
    });
  });

  describe('MeshConfig interface', () => {
    it('should create a valid config', () => {
      const config: MeshConfig = {
        network: 'testnet',
        operatorAccountId: '0.0.12345',
        operatorPrivateKey: 'abc123',
      };

      expect(config.network).toBe('testnet');
    });

    it('should support optional fields', () => {
      const config: MeshConfig = {
        network: 'mainnet',
        operatorAccountId: '0.0.1',
        operatorPrivateKey: 'key',
        registryTopicId: '0.0.100',
        maxAgents: 50,
        heartbeatInterval: 30000,
        taskTimeout: 60000,
      };

      expect(config.maxAgents).toBe(50);
      expect(config.heartbeatInterval).toBe(30000);
    });
  });

  describe('TaskResult interface', () => {
    it('should create a valid result', () => {
      const result: TaskResult = {
        taskId: 'task-1',
        status: 'success',
        outputs: { research: { data: 'findings' } },
        agentResults: [],
        totalCost: 0,
        duration: 5000,
      };

      expect(result.status).toBe('success');
      expect(result.duration).toBe(5000);
    });

    it('should support partial results', () => {
      const result: TaskResult = {
        taskId: 'task-2',
        status: 'partial',
        outputs: {},
        agentResults: [
          { taskId: 'task-2', agentId: 'a1', capability: 'c1', status: 'completed', result: 'ok' },
          { taskId: 'task-2', agentId: 'a2', capability: 'c2', status: 'failed', result: { error: 'timeout' } },
        ],
        totalCost: 5,
        duration: 10000,
      };

      expect(result.agentResults).toHaveLength(2);
    });
  });

  describe('ConnectionInfo interface', () => {
    it('should create valid connection info', () => {
      const conn: ConnectionInfo = {
        connectionTopicId: '0.0.200',
        peerId: 'agent-2',
        peerName: 'PeerAgent',
        establishedAt: Date.now(),
        lastActivity: Date.now(),
      };

      expect(conn.peerId).toBe('agent-2');
    });
  });

  describe('AgentDiscoveryResult interface', () => {
    it('should create valid discovery result', () => {
      const result: AgentDiscoveryResult = {
        agents: [],
        totalFound: 0,
        queryTime: 5,
      };

      expect(result.totalFound).toBe(0);
      expect(result.queryTime).toBe(5);
    });
  });
});
