/**
 * AgentMesh - Decentralized AI Agent Coordination on Hedera
 *
 * A framework for building networks of AI agents that discover each other,
 * communicate, and collaborate on tasks using Hedera's consensus service.
 * All coordination is on-chain, tamper-proof, and auditable.
 */

// Core
export { HederaClient } from './core/hedera-client';
export { AgentRegistry } from './core/agent-registry';
export { TaskCoordinator, TaskBid } from './core/task-coordinator';
export { ReputationManager, ReputationScore, ReputationRecord } from './core/reputation';
export { MeshNode, MeshNodeOptions } from './core/mesh-node';

// Types
export {
  AgentProfile,
  AgentCapability,
  TaskRequest,
  TaskAssignment,
  TaskResult,
  CoordinationMessage,
  MessageType,
  MeshConfig,
  AgentDiscoveryResult,
  ConnectionInfo,
} from './core/types';

// MCP
export { MCPServer, MCPTool, MCPToolResult } from './mcp/mcp-server';

// Specialized Agents
export { createResearchAgent } from './agents/research-agent';
export { createAnalysisAgent } from './agents/analysis-agent';
export { createCoordinatorAgent } from './agents/coordinator-agent';

// HOL Standards Integration (HCS-10/HCS-11)
export { HCS10Bridge, HCS10BridgeConfig, StandardsAgentInfo } from './hol/hcs10-bridge';
export { StandardsRegistry, RegistrySearchOptions, RegistryAgent } from './hol/standards-registry';

// Analytics
export {
  TaskAnalytics,
  TaskEvent,
  AgentStats,
  TaskTypeStats,
  PerformanceReport,
  BottleneckReport,
  BottleneckReason,
  LoadBalancingRecommendation,
  SpecializationScore,
  TrendDirection,
  TrendAnalysis,
  TaskAnalyticsConfig,
} from './core/task-analytics';

// Dashboard
export { Dashboard, DashboardOptions } from './dashboard/server';
