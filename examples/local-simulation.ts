/**
 * Local Simulation - demonstrates AgentMesh without a Hedera account
 *
 * This example creates a simulated mesh network with three specialized agents
 * that collaborate on a research task. No Hedera credentials needed.
 */

import {
  AgentRegistry,
  TaskCoordinator,
  AgentProfile,
  AgentCapability,
  MessageType,
} from '../src';

// Simulate HederaClient for local testing
class MockHederaClient {
  private topicCounter = 0;
  private listeners: Map<string, ((msg: { contents: Buffer; sequenceNumber: number }) => void)[]> = new Map();

  async createTopic(memo?: string): Promise<string> {
    this.topicCounter++;
    return `0.0.${1000 + this.topicCounter}`;
  }

  async submitMessage(topicId: string, message: string | Buffer): Promise<number> {
    const msgStr = typeof message === 'string' ? message : message.toString();
    const listeners = this.listeners.get(topicId) || [];
    for (const cb of listeners) {
      cb({ contents: Buffer.from(msgStr), sequenceNumber: this.topicCounter++ });
    }
    return this.topicCounter;
  }

  subscribeTopic(topicId: string, callback: (msg: { contents: Buffer; sequenceNumber: number }) => void): void {
    const existing = this.listeners.get(topicId) || [];
    existing.push(callback);
    this.listeners.set(topicId, existing);
  }

  getOperatorAccountId(): string { return '0.0.1234'; }
  emit() {}
  close() {}
}

async function main() {
  console.log('=== AgentMesh Local Simulation ===\n');

  const mockClient = new MockHederaClient() as any;

  // Initialize registry and coordinator
  const registry = new AgentRegistry(mockClient);
  const registryTopicId = await registry.initialize();
  console.log(`Registry initialized on topic: ${registryTopicId}`);

  const coordinator = new TaskCoordinator(mockClient, registry);
  const coordTopicId = await coordinator.initialize();
  console.log(`Coordinator initialized on topic: ${coordTopicId}\n`);

  // Register agents
  const agents: AgentProfile[] = [
    {
      id: 'agent-researcher',
      name: 'ResearchAgent',
      description: 'Information gathering and synthesis',
      capabilities: [
        { name: 'web_research', description: 'Research topics', inputSchema: {}, outputSchema: {} },
        { name: 'summarize', description: 'Summarize text', inputSchema: {}, outputSchema: {} },
      ],
      hederaAccountId: '0.0.2001',
      inboundTopicId: '0.0.3001',
      outboundTopicId: '0.0.3002',
      registryTopicId,
      status: 'active',
      createdAt: Date.now(),
      metadata: {},
    },
    {
      id: 'agent-analyst',
      name: 'AnalysisAgent',
      description: 'Data analysis and risk assessment',
      capabilities: [
        { name: 'data_analysis', description: 'Analyze data', inputSchema: {}, outputSchema: {} },
        { name: 'risk_assessment', description: 'Assess risks', inputSchema: {}, outputSchema: {} },
      ],
      hederaAccountId: '0.0.2002',
      inboundTopicId: '0.0.3003',
      outboundTopicId: '0.0.3004',
      registryTopicId,
      status: 'active',
      createdAt: Date.now(),
      metadata: {},
    },
    {
      id: 'agent-coordinator',
      name: 'CoordinatorAgent',
      description: 'Multi-agent orchestration',
      capabilities: [
        { name: 'task_decomposition', description: 'Break tasks into subtasks', inputSchema: {}, outputSchema: {} },
        { name: 'result_synthesis', description: 'Combine results', inputSchema: {}, outputSchema: {} },
      ],
      hederaAccountId: '0.0.2003',
      inboundTopicId: '0.0.3005',
      outboundTopicId: '0.0.3006',
      registryTopicId,
      status: 'active',
      createdAt: Date.now(),
      metadata: {},
    },
  ];

  for (const agent of agents) {
    await registry.registerAgent(agent);
    console.log(`Registered: ${agent.name} (${agent.capabilities.map(c => c.name).join(', ')})`);
  }

  console.log(`\nTotal agents in mesh: ${registry.getAgentCount()}\n`);

  // Discover agents by capability
  console.log('--- Agent Discovery ---');
  const researchers = registry.discoverAgents({ capability: 'research' });
  console.log(`Agents with "research" capability: ${researchers.totalFound}`);
  for (const a of researchers.agents) {
    console.log(`  - ${a.name}: ${a.description}`);
  }

  const analysts = registry.discoverAgents({ capability: 'analysis' });
  console.log(`Agents with "analysis" capability: ${analysts.totalFound}`);
  for (const a of analysts.agents) {
    console.log(`  - ${a.name}: ${a.description}`);
  }

  // Submit a task
  console.log('\n--- Task Submission ---');
  const taskId = await coordinator.submitTask({
    description: 'Analyze the impact of decentralized AI agents on DeFi protocols',
    requiredCapabilities: ['web_research', 'data_analysis', 'risk_assessment'],
    payload: { depth: 'deep', focus: 'DeFi' },
    priority: 'high',
    requesterId: 'agent-coordinator',
  });
  console.log(`Task submitted: ${taskId}`);

  // Simulate bidding
  console.log('\n--- Bidding Phase ---');
  await coordinator.submitBid({
    taskId,
    agentId: 'agent-researcher',
    capability: 'web_research',
    estimatedDuration: 3000,
    estimatedCost: 0.5,
    confidence: 0.95,
    timestamp: Date.now(),
  });
  console.log('ResearchAgent bid on web_research (confidence: 0.95)');

  await coordinator.submitBid({
    taskId,
    agentId: 'agent-analyst',
    capability: 'data_analysis',
    estimatedDuration: 5000,
    estimatedCost: 0.8,
    confidence: 0.90,
    timestamp: Date.now(),
  });
  console.log('AnalysisAgent bid on data_analysis (confidence: 0.90)');

  await coordinator.submitBid({
    taskId,
    agentId: 'agent-analyst',
    capability: 'risk_assessment',
    estimatedDuration: 4000,
    estimatedCost: 0.6,
    confidence: 0.88,
    timestamp: Date.now(),
  });
  console.log('AnalysisAgent bid on risk_assessment (confidence: 0.88)');

  // Select best bids and assign
  console.log('\n--- Task Assignment ---');
  const bestBid = coordinator.selectBestBid(taskId);
  if (bestBid) {
    console.log(`Best bid: ${bestBid.agentId} for ${bestBid.capability} (confidence: ${bestBid.confidence})`);
  }

  // Auto-assign based on capabilities
  const assignments = await coordinator.autoAssignTask(taskId);
  for (const a of assignments) {
    console.log(`Assigned: ${a.agentId} → ${a.capability} (status: ${a.status})`);
  }

  // Simulate task completion
  console.log('\n--- Task Execution ---');
  for (const a of assignments) {
    console.log(`${a.agentId} executing ${a.capability}...`);
    await coordinator.completeTask(taskId, a.agentId, {
      findings: `Results from ${a.capability} analysis`,
      confidence: 0.9,
      timestamp: Date.now(),
    });
    console.log(`${a.agentId} completed ${a.capability}`);
  }

  // Check final result
  const result = coordinator.getTaskResult(taskId);
  if (result) {
    console.log('\n--- Final Result ---');
    console.log(`Status: ${result.status}`);
    console.log(`Agents involved: ${result.agentResults.length}`);
    console.log(`Total cost: ${result.totalCost} HBAR`);
    console.log(`Duration: ${result.duration}ms`);
    console.log('Outputs:', JSON.stringify(result.outputs, null, 2));
  }

  console.log('\n=== Simulation Complete ===');
}

main().catch(console.error);
