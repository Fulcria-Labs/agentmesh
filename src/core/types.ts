/**
 * AgentMesh Core Types
 * Decentralized AI agent coordination on Hedera
 */

export interface AgentCapability {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  capabilities: AgentCapability[];
  hederaAccountId: string;
  inboundTopicId: string;
  outboundTopicId: string;
  registryTopicId: string;
  status: 'active' | 'inactive' | 'busy';
  createdAt: number;
  metadata: Record<string, string>;
}

export interface TaskRequest {
  id: string;
  description: string;
  requiredCapabilities: string[];
  payload: Record<string, unknown>;
  priority: 'low' | 'medium' | 'high' | 'critical';
  deadline?: number;
  maxBudgetHbar?: number;
  requesterId: string;
  createdAt: number;
}

export interface TaskAssignment {
  taskId: string;
  agentId: string;
  capability: string;
  status: 'assigned' | 'accepted' | 'in_progress' | 'completed' | 'failed';
  result?: unknown;
  startedAt?: number;
  completedAt?: number;
  cost?: number;
}

export interface CoordinationMessage {
  type: MessageType;
  senderId: string;
  recipientId?: string;
  taskId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
  sequenceNumber?: number;
  topicId?: string;
}

export enum MessageType {
  // Agent lifecycle
  AGENT_REGISTER = 'agent.register',
  AGENT_DEREGISTER = 'agent.deregister',
  AGENT_HEARTBEAT = 'agent.heartbeat',
  AGENT_STATUS_UPDATE = 'agent.status_update',

  // Task coordination
  TASK_REQUEST = 'task.request',
  TASK_BID = 'task.bid',
  TASK_ASSIGN = 'task.assign',
  TASK_ACCEPT = 'task.accept',
  TASK_REJECT = 'task.reject',
  TASK_PROGRESS = 'task.progress',
  TASK_COMPLETE = 'task.complete',
  TASK_FAIL = 'task.fail',

  // Agent-to-agent
  CAPABILITY_QUERY = 'capability.query',
  CAPABILITY_RESPONSE = 'capability.response',
  DATA_REQUEST = 'data.request',
  DATA_RESPONSE = 'data.response',

  // Connection management
  CONNECTION_REQUEST = 'connection.request',
  CONNECTION_ACCEPT = 'connection.accept',
  CONNECTION_REJECT = 'connection.reject',
}

export interface AgentDiscoveryResult {
  agents: AgentProfile[];
  totalFound: number;
  queryTime: number;
}

export interface TaskResult {
  taskId: string;
  status: 'success' | 'partial' | 'failed';
  outputs: Record<string, unknown>;
  agentResults: TaskAssignment[];
  totalCost: number;
  duration: number;
}

export interface MeshConfig {
  network: 'mainnet' | 'testnet' | 'previewnet';
  operatorAccountId: string;
  operatorPrivateKey: string;
  registryTopicId?: string;
  maxAgents?: number;
  heartbeatInterval?: number;
  taskTimeout?: number;
}

export interface ConnectionInfo {
  connectionTopicId: string;
  peerId: string;
  peerName: string;
  establishedAt: number;
  lastActivity: number;
}
