# Hedera Hello Future Apex - StackUp Submission (Copy-Paste Ready)

**StackUp Portal:** Submit via Eric's StackUp account
**GitHub Repo:** https://github.com/Fulcria-Labs/agentmesh

---

## Project Name
AgentMesh

## Track
AI & Agents ($40K prize pool)

## Tagline
Decentralized AI agent coordination on Hedera — discover, bid, collaborate, audit.

## Project Description (short)
A decentralized framework enabling AI agents to discover each other, bid on tasks, and collaborate — all coordinated through Hedera Consensus Service with full on-chain auditability.

## Project Description (detailed)
AgentMesh solves the problem of AI agent coordination in a trustless environment. Today's AI agents operate in silos — they can't discover each other, negotiate task allocation, or prove their interactions happened.

AgentMesh uses Hedera Consensus Service (HCS) to provide a decentralized coordination layer where:

- **Agents register** their capabilities on-chain via HCS topics
- **Tasks are broadcast** to the mesh — any agent can bid based on confidence and cost
- **The best bid wins** — transparent, auditable allocation
- **Every interaction** is recorded on Hedera's hashgraph for full transparency

Three specialized agent types demonstrate the framework:
- **ResearchAgent** — web research, summarization, fact-checking
- **AnalysisAgent** — data analysis, sentiment analysis, risk assessment
- **CoordinatorAgent** — task decomposition, result synthesis, agent selection

Built with full HCS-10/HCS-11 compliance via the Hashgraph Online Standards SDK, enabling interoperability with the entire HOL ecosystem.

## How Hedera is Used

### HCS (Hedera Consensus Service) — Core Coordination Layer
- Agent registry topic for decentralized agent discovery
- Task coordination topic for bid-based task allocation
- Agent-to-agent messaging topics for direct communication
- All 19 message types (registration, heartbeat, bids, results, etc.) published to HCS

### HCS-10/HCS-11 Standards Integration ($8K HOL Bounty Target)
- **HCS10Bridge**: Maps AgentMesh capabilities to HCS-11 `AIAgentCapability` enum, creates standards-compliant agent profiles with proper inbound/outbound topics
- **StandardsRegistry**: Queries the HOL Guarded Registry to discover other HCS-10 agents and converts them to AgentMesh profiles for cross-ecosystem collaboration
- **Connection Management**: Uses HCS-10 connection protocol for establishing agent-to-agent communication channels
- **19 capability mappings**: Full bidirectional mapping between AgentMesh and HCS-11 capabilities

### On-Chain Audit Trail
Every agent interaction — registration, task broadcast, bid submission, task completion — is recorded on Hedera's hashgraph, providing immutable proof of agent behavior.

## Tech Stack
- TypeScript / Node.js
- Hedera SDK (@hashgraph/sdk)
- HCS-10/HCS-11 Standards (@hashgraphonline/standards-sdk)
- Model Context Protocol (MCP) — 6 tools for external integration
- Web Dashboard — real-time monitoring UI

## Testing
2,425 tests across 60 test suites with 99%+ code coverage

## How to Run
```bash
git clone https://github.com/Fulcria-Labs/agentmesh.git
cd agentmesh
npm install
npm test                                           # Run 2,144 tests
npx ts-node examples/local-simulation.ts           # Local demo (no Hedera account needed)
npx ts-node -e "import { Dashboard } from './src'; new Dashboard().start()"  # Web dashboard
```

## Demo Video
- MP4: included in repository (agentmesh-demo.mp4)
- GIF: included in repository (agentmesh-demo.gif)
- Asciinema recording: included (agentmesh-demo.cast)

## Links
- **GitHub:** https://github.com/Fulcria-Labs/agentmesh
- **Hedera Hashscan:** https://hashscan.io/testnet

---
*Last updated: 2026-03-15*
