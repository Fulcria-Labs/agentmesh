# AgentMesh — Hedera Hello Future Apex Hackathon Submission

## Track: AI & Agents ($40K prize pool)

### Project Summary

AgentMesh is a decentralized AI agent coordination framework built on Hedera Consensus Service (HCS). It enables AI agents to discover each other, communicate, and collaborate on tasks with all coordination recorded on-chain for full transparency and auditability.

### Key Features

- **Decentralized Agent Registry** — Agents register and discover each other via HCS topics
- **Bid-Based Task Allocation** — Tasks broadcast to mesh, agents bid by confidence/cost, best bid wins
- **3 Specialized Agents** — Research, Analysis, and Coordinator agents with 9 capabilities total
- **MCP Integration** — 6 MCP tools for integration with any MCP-compatible AI system
- **HCS-10/HCS-11 Standards** — Full integration with HOL Standards SDK for ecosystem interoperability
- **HOL Guarded Registry** — Global agent discovery across the entire HCS-10 ecosystem
- **Web Dashboard** — Real-time monitoring UI with auto-refresh (agents, tasks, metrics)
- **On-Chain Audit Trail** — Every agent interaction is recorded on Hedera's hashgraph
- **19 Message Types** — Full protocol for agent lifecycle, task coordination, and agent-to-agent communication

### Technical Stack

- TypeScript / Node.js
- Hedera SDK (@hashgraph/sdk)
- HCS-10/HCS-11 Standards (@hashgraphonline/standards-sdk)
- Model Context Protocol (MCP)
- 1982 tests across 54 test suites with 99%+ code coverage

### HOL Integration (Bounty Target: $8K)

AgentMesh deeply integrates with the Hashgraph Online Standards SDK:

- **HCS10Bridge**: Maps AgentMesh capabilities to HCS-11 `AIAgentCapability` enum, creates standards-compliant agent profiles with proper inbound/outbound topics
- **StandardsRegistry**: Searches the HOL Guarded Registry and converts discovered agents to AgentMesh profiles for seamless cross-ecosystem collaboration
- **Connection Management**: Uses HCS-10 connection protocol for establishing and managing agent-to-agent communication channels
- **Bidirectional Capability Mapping**: 19 AgentMesh capabilities automatically mapped to/from HCS-11 standard capabilities

### Submission Checklist

- [x] Core framework (HederaClient, AgentRegistry, TaskCoordinator, MeshNode)
- [x] 3 specialized agents (Research, Analysis, Coordinator)
- [x] MCP server with 6 tools
- [x] HCS-10 Bridge with standards-compliant agent creation
- [x] HOL Guarded Registry integration (StandardsRegistry)
- [x] HCS-11 capability mapping (19 capabilities)
- [x] Web Dashboard with real-time monitoring
- [x] 1975 tests across 53 test suites with 99%+ code coverage
- [x] README.md with architecture docs
- [x] Example scripts (local simulation + testnet demo)
- [x] Docker setup (Dockerfile + docker-compose.yml)
- [ ] Eric registers on StackUp
- [ ] Hedera testnet account for live demo
- [ ] Demo video

### Demo

```bash
# Local simulation (no Hedera account needed)
npx ts-node examples/local-simulation.ts

# Live testnet demo (requires .env with Hedera credentials)
npx ts-node examples/multi-agent-demo.ts

# Web dashboard
npx ts-node -e "import { Dashboard } from './src'; new Dashboard().start().then(u => console.log(u))"
```

### Links

- Repository: https://github.com/Fulcria-Labs/agentmesh
- Hedera Hashscan: https://hashscan.io/testnet
