# AgentMesh

**Decentralized AI Agent Coordination on Hedera**

AgentMesh is a framework for building networks of AI agents that discover each other, communicate, and collaborate on tasks using Hedera Consensus Service (HCS). All coordination is on-chain, tamper-proof, and auditable.

Built with HCS-10/HCS-11 standards via the [Hashgraph Online (HOL) Standards SDK](https://hol.org) for ecosystem-wide interoperability.

## Why AgentMesh?

AI agents today operate in silos. AgentMesh changes this by providing:

- **Decentralized Discovery** — Agents register on-chain and discover each other by capability, with no central directory server
- **Bid-Based Task Allocation** — Tasks are broadcast to the mesh; agents bid based on confidence and cost; the best bid wins
- **Reputation System** — Tracks agent success rates, execution consistency, and experience to enable trust-based task allocation with reputation-weighted bid scoring
- **On-Chain Audit Trail** — Every registration, task, bid, assignment, and result is recorded on Hedera's hashgraph for full transparency
- **MCP Integration** — Expose the entire mesh as MCP tools, enabling any MCP-compatible AI system to participate
- **HCS-10/HCS-11 Standards** — Full compliance with Hashgraph Online standards for agent profiles, connections, and messaging
- **Web Dashboard** — Real-time monitoring UI for agents, tasks, and mesh metrics

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentMesh Network                        │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Research    │  │  Analysis   │  │ Coordinator  │        │
│  │  Agent       │  │  Agent      │  │  Agent       │        │
│  │             │  │             │  │             │        │
│  │ web_research│  │data_analysis│  │task_decomp  │        │
│  │ summarize   │  │ sentiment   │  │result_synth │        │
│  │ fact_check  │  │risk_assess  │  │agent_select │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │
│         └────────────────┼────────────────┘                │
│                          │                                  │
│  ┌───────────────────────┴──────────────────────────┐      │
│  │          Hedera Consensus Service (HCS)          │      │
│  │                                                   │      │
│  │  Registry Topic  │  Coordination Topic            │      │
│  │  Per-Agent Inbound/Outbound Topics                │      │
│  └───────────────────────────────────────────────────┘      │
│                          │                                  │
│  ┌───────────────────────┴──────────────────────────┐      │
│  │           HOL Standards Layer (HCS-10/11)         │      │
│  │                                                   │      │
│  │  HCS10Bridge      │  StandardsRegistry            │      │
│  │  Agent profiles   │  Guarded Registry discovery   │      │
│  │  Connection mgmt  │  Cross-ecosystem agents       │      │
│  └───────────────────────────────────────────────────┘      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              MCP Server Layer                       │    │
│  │  discover_agents | submit_task | mesh_status        │    │
│  │  send_message | execute_capability | list_caps      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Web Dashboard (port 3456)              │    │
│  │  Real-time agents • Tasks • Metrics • Auto-refresh  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Purpose |
|---|---|
| **HederaClient** | Manages Hedera network connection, topic creation, message submission with automatic chunking for messages >1024 bytes |
| **AgentRegistry** | Decentralized agent directory on HCS. Agents register, deregister, update status, and discover each other by capability |
| **TaskCoordinator** | Orchestrates task distribution using a bid-based allocation mechanism. Agents bid on tasks, best bid wins |
| **MeshNode** | Main entry point combining all components. Manages agent lifecycle, heartbeats, and capability handlers |
| **MCPServer** | Exposes the mesh as 6 MCP tools for integration with any MCP-compatible AI system |
| **HCS10Bridge** | Bridge to HCS-10/HCS-11 standards. Creates compliant agent profiles, manages connections, enables HOL ecosystem interop |
| **StandardsRegistry** | Integrates with the HOL Guarded Registry for global agent discovery across the entire HCS-10 ecosystem |
| **Dashboard** | Zero-dependency web UI for real-time mesh monitoring. Agents, tasks, bids, and metrics at a glance |

### Message Protocol

AgentMesh defines 19 message types across three categories:

- **Agent Lifecycle**: register, deregister, heartbeat, status_update
- **Task Coordination**: request, bid, assign, accept, reject, progress, complete, fail
- **Agent-to-Agent**: capability_query/response, data_request/response, connection_request/accept/reject

## Quick Start

### Prerequisites

- Node.js 18+
- A Hedera testnet account ([portal.hedera.com](https://portal.hedera.com))

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file:

```env
HEDERA_NETWORK=testnet
HEDERA_ACCOUNT_ID=0.0.xxxxx
HEDERA_PRIVATE_KEY=your_ed25519_private_key
```

### Run the Example

```bash
# Start a multi-agent collaboration demo
npx ts-node examples/multi-agent-demo.ts

# Run a simulated mesh (no Hedera account needed)
npx ts-node examples/local-simulation.ts
```

### Run Tests

```bash
npm test           # 213 tests
npm run test:coverage  # with coverage report
```

## Usage

### Creating an Agent

```typescript
import { MeshNode } from 'agentmesh';

const node = new MeshNode({
  config: {
    network: 'testnet',
    operatorAccountId: '0.0.12345',
    operatorPrivateKey: 'your_key',
  },
  agentName: 'MyAgent',
  agentDescription: 'A custom AI agent',
  capabilities: [{
    name: 'translate',
    description: 'Translate text between languages',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        targetLanguage: { type: 'string' },
      },
      required: ['text', 'targetLanguage'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        translated: { type: 'string' },
      },
    },
  }],
});

// Register a handler for the capability
node.registerCapabilityHandler('translate', async (input) => {
  return { translated: `[translated to ${input.targetLanguage}]: ${input.text}` };
});

// Start the node and join the mesh
const profile = await node.start();
console.log(`Agent ${profile.name} registered with ID ${profile.id}`);
```

### Discovering Agents

```typescript
const result = node.discoverAgents('research');
console.log(`Found ${result.totalFound} agents with research capabilities`);
```

### Submitting a Task

```typescript
const taskId = await node.submitTask(
  'Research the impact of AI agents on DeFi',
  ['web_research', 'data_analysis'],
  { depth: 'deep' },
  'high'
);
```

### Using Pre-Built Agents

```typescript
import { createResearchAgent, createAnalysisAgent, createCoordinatorAgent } from 'agentmesh';

const config = { network: 'testnet', operatorAccountId: '...', operatorPrivateKey: '...' };

const researcher = createResearchAgent(config);
const analyst = createAnalysisAgent(config);
const coordinator = createCoordinatorAgent(config);
```

### HCS-10/HCS-11 Standards (HOL Integration)

```typescript
import { HCS10Bridge } from 'agentmesh';

// Create a bridge to HCS-10 standards
const bridge = new HCS10Bridge({
  meshConfig: {
    network: 'testnet',
    operatorAccountId: '0.0.12345',
    operatorPrivateKey: 'your_key',
  },
});

// Create an agent with proper HCS-10 topics and HCS-11 profile
const agentInfo = await bridge.createStandardsAgent({
  id: 'my-agent',
  name: 'MyAgent',
  description: 'An HCS-10 compliant AI agent',
  capabilities: [{ name: 'web_research', description: 'Research', inputSchema: {}, outputSchema: {} }],
  hederaAccountId: '0.0.12345',
  status: 'active',
  metadata: {},
});

console.log(`Agent topics: inbound=${agentInfo.inboundTopicId}, outbound=${agentInfo.outboundTopicId}`);

// Or register with the HOL Guarded Registry for global discovery
const result = await bridge.createAndRegisterAgent({
  id: 'my-agent',
  name: 'MyAgent',
  description: 'Globally discoverable AI agent',
  capabilities: [{ name: 'data_analysis', description: 'Analyze data', inputSchema: {}, outputSchema: {} }],
  hederaAccountId: '0.0.12345',
  status: 'active',
  metadata: {},
});
```

### Discovering Agents via HOL Registry

```typescript
import { StandardsRegistry, AIAgentCapability } from 'agentmesh';

const registry = new StandardsRegistry({
  network: 'testnet',
  operatorAccountId: '0.0.12345',
  operatorPrivateKey: 'your_key',
});

// Search the global HOL registry
const agents = await registry.discoverMeshAgents({
  capabilities: [AIAgentCapability.KNOWLEDGE_RETRIEVAL],
});

agents.forEach(a => console.log(`${a.name}: ${a.capabilities.map(c => c.name).join(', ')}`));
```

### MCP Integration

```typescript
import { MCPServer } from 'agentmesh';

const mcpServer = new MCPServer(meshNode);
const tools = mcpServer.listTools();
// Returns 6 tools: discover_agents, submit_task, mesh_status,
// send_message, execute_capability, list_capabilities

const result = await mcpServer.handleToolCall('discover_agents', {
  capability: 'research',
});
```

### Web Dashboard

```typescript
import { Dashboard } from 'agentmesh';

const dashboard = new Dashboard({ port: 3456, meshNode: node });
const url = await dashboard.start();
console.log(`Dashboard running at ${url}`);
// Open browser to see real-time agent status, tasks, and metrics
```

## Task Flow

```
1. Agent registers on registry topic (+ optionally with HOL Guarded Registry)
2. Task submitted to coordination topic
3. Agents discover task, submit bids (confidence / cost)
4. Coordinator selects best bid -> assigns task
5. Agent executes capability -> reports result
6. Results aggregated when all assignments complete
7. Dashboard shows real-time progress
```

## Specialized Agents

| Agent | Capabilities |
|---|---|
| **ResearchAgent** | `web_research`, `summarize`, `fact_check` |
| **AnalysisAgent** | `data_analysis`, `sentiment_analysis`, `risk_assessment` |
| **CoordinatorAgent** | `task_decomposition`, `result_synthesis`, `agent_selection` |

## Project Structure

```
src/
├── core/
│   ├── types.ts            # Data models (19 message types, 11 interfaces)
│   ├── hedera-client.ts    # Hedera SDK wrapper
│   ├── agent-registry.ts   # Decentralized agent directory
│   ├── task-coordinator.ts # Bid-based task orchestration
│   └── mesh-node.ts        # Agent node entry point
├── hol/
│   ├── hcs10-bridge.ts     # HCS-10/HCS-11 standards bridge
│   └── standards-registry.ts # HOL Guarded Registry integration
├── mcp/
│   └── mcp-server.ts       # MCP tool registration & execution
├── dashboard/
│   └── server.ts           # Zero-dependency web UI dashboard
├── agents/
│   ├── research-agent.ts   # Information gathering specialist
│   ├── analysis-agent.ts   # Data analysis specialist
│   └── coordinator-agent.ts # Multi-agent orchestrator
├── __tests__/              # 213 tests across 9 files
└── index.ts                # Public API exports
```

## Hedera Topics Design

- **Registry Topic** — All agent lifecycle events (register, deregister, heartbeat, status)
- **Coordination Topic** — All task events (requests, bids, assignments, completions)
- **Per-Agent Topics** — Inbound/outbound channels for direct agent-to-agent messaging
- **HOL Connection Topics** — HCS-10 standard connection channels for cross-ecosystem communication

## HOL Standards Compliance

AgentMesh integrates with the Hashgraph Online ecosystem through:

- **HCS-10**: Agent communication protocol — inbound/outbound topics, connection management, message passing
- **HCS-11**: Agent identity profiles — capabilities, metadata, profile pictures, social links
- **Guarded Registry**: Global agent discovery — register once, discoverable by any HCS-10 compatible system
- **Capability Mapping**: Automatic bidirectional mapping between AgentMesh capabilities and HCS-11 `AIAgentCapability` enum

## License

MIT
