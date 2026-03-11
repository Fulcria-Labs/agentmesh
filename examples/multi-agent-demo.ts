/**
 * Multi-Agent Demo - demonstrates AgentMesh on Hedera testnet
 *
 * This example starts three specialized agents on the Hedera testnet,
 * demonstrates discovery, task submission, bidding, and collaboration.
 *
 * Prerequisites:
 *   - A Hedera testnet account (get one at portal.hedera.com)
 *   - .env file with HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY
 */

import * as dotenv from 'dotenv';
import {
  MeshConfig,
  createResearchAgent,
  createAnalysisAgent,
  createCoordinatorAgent,
  MCPServer,
} from '../src';

dotenv.config();

async function main() {
  // Validate environment
  const accountId = process.env.HEDERA_ACCOUNT_ID;
  const privateKey = process.env.HEDERA_PRIVATE_KEY;

  if (!accountId || !privateKey) {
    console.error('Missing HEDERA_ACCOUNT_ID or HEDERA_PRIVATE_KEY in .env');
    console.error('Get a testnet account at https://portal.hedera.com');
    process.exit(1);
  }

  const config: MeshConfig = {
    network: 'testnet',
    operatorAccountId: accountId,
    operatorPrivateKey: privateKey,
    heartbeatInterval: 30000,
  };

  console.log('=== AgentMesh Multi-Agent Demo ===\n');
  console.log(`Network: ${config.network}`);
  console.log(`Operator: ${config.operatorAccountId}\n`);

  // Create specialized agents
  const researcher = createResearchAgent(config);
  const analyst = createAnalysisAgent(config);
  const coordinator = createCoordinatorAgent(config);

  try {
    // Start all agents — they join the same registry
    console.log('Starting agents...');
    const researcherProfile = await researcher.start();
    console.log(`  ResearchAgent started: ${researcherProfile.id}`);

    // Share registry and coordination topics
    const registryTopicId = researcherProfile.registryTopicId;
    const coordTopicId = researcherProfile.metadata.coordinationTopicId;

    const analystProfile = await analyst.start(registryTopicId, coordTopicId);
    console.log(`  AnalysisAgent started: ${analystProfile.id}`);

    const coordProfile = await coordinator.start(registryTopicId, coordTopicId);
    console.log(`  CoordinatorAgent started: ${coordProfile.id}`);

    console.log(`\nRegistry topic: ${registryTopicId}`);
    console.log(`Coordination topic: ${coordTopicId}\n`);

    // Demonstrate MCP integration
    const mcpServer = new MCPServer(coordinator);
    console.log('MCP Server tools:');
    for (const tool of mcpServer.listTools()) {
      console.log(`  - ${tool.name}: ${tool.description}`);
    }

    // Discover agents via MCP
    console.log('\n--- Discovery via MCP ---');
    const discoveryResult = await mcpServer.handleToolCall('discover_agents', {});
    console.log(discoveryResult.content[0]?.text);

    // Submit a task via MCP
    console.log('\n--- Task Submission via MCP ---');
    const taskResult = await mcpServer.handleToolCall('submit_task', {
      description: 'Analyze the security implications of autonomous AI agents in DeFi',
      capabilities: ['web_research', 'data_analysis', 'risk_assessment'],
      priority: 'high',
      payload: { domain: 'DeFi security', depth: 'comprehensive' },
    });
    console.log(taskResult.content[0]?.text);

    // Get mesh status
    console.log('\n--- Mesh Status ---');
    const statusResult = await mcpServer.handleToolCall('mesh_status', {});
    console.log(statusResult.content[0]?.text);

    // Execute capability directly
    console.log('\n--- Direct Capability Execution ---');
    const decompResult = await coordinator.executeCapability('task_decomposition', {
      task: 'Build a decentralized AI governance framework',
      maxSubtasks: 4,
    });
    console.log('Task decomposition:', JSON.stringify(decompResult, null, 2));

    const researchResult = await researcher.executeCapability('web_research', {
      query: 'Hedera Hashgraph AI agent frameworks',
      depth: 'deep',
    });
    console.log('\nResearch results:', JSON.stringify(researchResult, null, 2));

    // Wait a moment then check balance
    console.log('\n--- Account Balance ---');
    try {
      const balance = await coordinator.getBalance();
      console.log(`Balance: ${balance} HBAR`);
    } catch {
      console.log('Balance check skipped (network latency)');
    }

    console.log('\n=== Demo Complete ===');
    console.log('All agents successfully collaborated on the Hedera mesh network.');
    console.log(`View transactions: https://hashscan.io/testnet/topic/${registryTopicId}`);

    // Cleanup
    await researcher.stop();
    await analyst.stop();
    await coordinator.stop();
  } catch (error) {
    console.error('Demo error:', error);
    // Attempt cleanup
    try { await researcher.stop(); } catch {}
    try { await analyst.stop(); } catch {}
    try { await coordinator.stop(); } catch {}
    process.exit(1);
  }
}

main().catch(console.error);
