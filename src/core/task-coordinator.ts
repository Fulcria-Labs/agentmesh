/**
 * TaskCoordinator - orchestrates task distribution and execution across agents
 * Implements a bid-based task allocation mechanism
 */

import { v4 as uuidv4 } from 'uuid';
import { HederaClient } from './hedera-client';
import { AgentRegistry } from './agent-registry';
import {
  TaskRequest,
  TaskAssignment,
  TaskResult,
  CoordinationMessage,
  MessageType,
  AgentProfile,
} from './types';
import { EventEmitter } from 'events';

export interface TaskBid {
  taskId: string;
  agentId: string;
  capability: string;
  estimatedDuration: number;
  estimatedCost: number;
  confidence: number;
  timestamp: number;
}

export class TaskCoordinator extends EventEmitter {
  private hederaClient: HederaClient;
  private registry: AgentRegistry;
  private coordinationTopicId: string | null = null;
  private tasks: Map<string, TaskRequest> = new Map();
  private assignments: Map<string, TaskAssignment[]> = new Map();
  private bids: Map<string, TaskBid[]> = new Map();
  private results: Map<string, TaskResult> = new Map();

  constructor(hederaClient: HederaClient, registry: AgentRegistry) {
    super();
    this.hederaClient = hederaClient;
    this.registry = registry;
  }

  async initialize(existingTopicId?: string): Promise<string> {
    if (existingTopicId) {
      this.coordinationTopicId = existingTopicId;
    } else {
      this.coordinationTopicId = await this.hederaClient.createTopic('AgentMesh Coordination v1');
    }

    this.hederaClient.subscribeTopic(this.coordinationTopicId, (message) => {
      this.handleCoordinationMessage(message.contents, message.sequenceNumber);
    });

    return this.coordinationTopicId;
  }

  getCoordinationTopicId(): string {
    if (!this.coordinationTopicId) {
      throw new Error('Coordinator not initialized');
    }
    return this.coordinationTopicId;
  }

  async submitTask(request: Omit<TaskRequest, 'id' | 'createdAt'>): Promise<string> {
    if (!this.coordinationTopicId) {
      throw new Error('Coordinator not initialized');
    }

    const task: TaskRequest = {
      ...request,
      id: uuidv4(),
      createdAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    this.bids.set(task.id, []);

    const message: CoordinationMessage = {
      type: MessageType.TASK_REQUEST,
      senderId: task.requesterId,
      taskId: task.id,
      payload: { task },
      timestamp: Date.now(),
    };

    await this.hederaClient.submitMessage(
      this.coordinationTopicId,
      JSON.stringify(message)
    );

    this.emit('task:submitted', task);
    return task.id;
  }

  async submitBid(bid: TaskBid): Promise<void> {
    if (!this.coordinationTopicId) {
      throw new Error('Coordinator not initialized');
    }

    const taskBids = this.bids.get(bid.taskId);
    if (taskBids) {
      taskBids.push(bid);
    }

    const message: CoordinationMessage = {
      type: MessageType.TASK_BID,
      senderId: bid.agentId,
      taskId: bid.taskId,
      payload: { bid },
      timestamp: Date.now(),
    };

    await this.hederaClient.submitMessage(
      this.coordinationTopicId,
      JSON.stringify(message)
    );

    this.emit('task:bid', bid);
  }

  async assignTask(taskId: string, agentId: string, capability: string): Promise<TaskAssignment> {
    if (!this.coordinationTopicId) {
      throw new Error('Coordinator not initialized');
    }

    const assignment: TaskAssignment = {
      taskId,
      agentId,
      capability,
      status: 'assigned',
      startedAt: Date.now(),
    };

    const existing = this.assignments.get(taskId) || [];
    existing.push(assignment);
    this.assignments.set(taskId, existing);

    const message: CoordinationMessage = {
      type: MessageType.TASK_ASSIGN,
      senderId: 'coordinator',
      recipientId: agentId,
      taskId,
      payload: { assignment },
      timestamp: Date.now(),
    };

    await this.hederaClient.submitMessage(
      this.coordinationTopicId,
      JSON.stringify(message)
    );

    this.emit('task:assigned', assignment);
    return assignment;
  }

  async completeTask(taskId: string, agentId: string, result: unknown): Promise<void> {
    if (!this.coordinationTopicId) {
      throw new Error('Coordinator not initialized');
    }

    const taskAssignments = this.assignments.get(taskId);
    if (taskAssignments) {
      const assignment = taskAssignments.find(a => a.agentId === agentId);
      if (assignment) {
        assignment.status = 'completed';
        assignment.result = result;
        assignment.completedAt = Date.now();
      }
    }

    const message: CoordinationMessage = {
      type: MessageType.TASK_COMPLETE,
      senderId: agentId,
      taskId,
      payload: { result },
      timestamp: Date.now(),
    };

    await this.hederaClient.submitMessage(
      this.coordinationTopicId,
      JSON.stringify(message)
    );

    // Check if all assignments for this task are complete
    this.checkTaskCompletion(taskId);
  }

  async failTask(taskId: string, agentId: string, error: string): Promise<void> {
    if (!this.coordinationTopicId) {
      throw new Error('Coordinator not initialized');
    }

    const taskAssignments = this.assignments.get(taskId);
    if (taskAssignments) {
      const assignment = taskAssignments.find(a => a.agentId === agentId);
      if (assignment) {
        assignment.status = 'failed';
        assignment.result = { error };
        assignment.completedAt = Date.now();
      }
    }

    const message: CoordinationMessage = {
      type: MessageType.TASK_FAIL,
      senderId: agentId,
      taskId,
      payload: { error },
      timestamp: Date.now(),
    };

    await this.hederaClient.submitMessage(
      this.coordinationTopicId,
      JSON.stringify(message)
    );

    this.emit('task:failed', { taskId, agentId, error });

    // Check if all assignments are now done (completed or failed)
    this.checkTaskCompletion(taskId);
  }

  selectBestBid(taskId: string): TaskBid | null {
    const taskBids = this.bids.get(taskId);
    if (!taskBids || taskBids.length === 0) return null;

    // Score bids: higher confidence and lower cost are better
    return taskBids.reduce((best, current) => {
      const bestScore = best.confidence / (best.estimatedCost + 1);
      const currentScore = current.confidence / (current.estimatedCost + 1);
      return currentScore > bestScore ? current : best;
    });
  }

  async autoAssignTask(taskId: string): Promise<TaskAssignment[]> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const assignments: TaskAssignment[] = [];

    for (const capabilityName of task.requiredCapabilities) {
      const discovery = this.registry.discoverAgents({
        capability: capabilityName,
        status: 'active',
      });

      if (discovery.agents.length > 0) {
        const agent = discovery.agents[0]!;
        const assignment = await this.assignTask(taskId, agent.id, capabilityName);
        assignments.push(assignment);
      }
    }

    return assignments;
  }

  getTask(taskId: string): TaskRequest | undefined {
    return this.tasks.get(taskId);
  }

  getTaskAssignments(taskId: string): TaskAssignment[] {
    return this.assignments.get(taskId) || [];
  }

  getTaskBids(taskId: string): TaskBid[] {
    return this.bids.get(taskId) || [];
  }

  getTaskResult(taskId: string): TaskResult | undefined {
    return this.results.get(taskId);
  }

  getAllTasks(): TaskRequest[] {
    return Array.from(this.tasks.values());
  }

  getTaskCount(): number {
    return this.tasks.size;
  }

  private checkTaskCompletion(taskId: string): void {
    const task = this.tasks.get(taskId);
    const taskAssignments = this.assignments.get(taskId);
    if (!task || !taskAssignments) return;

    const allDone = taskAssignments.every(
      a => a.status === 'completed' || a.status === 'failed'
    );

    if (allDone) {
      const hasFailure = taskAssignments.some(a => a.status === 'failed');
      const result: TaskResult = {
        taskId,
        status: hasFailure ? 'partial' : 'success',
        outputs: {},
        agentResults: taskAssignments,
        totalCost: taskAssignments.reduce((sum, a) => sum + (a.cost || 0), 0),
        duration: Date.now() - task.createdAt,
      };

      // Aggregate outputs
      for (const assignment of taskAssignments) {
        if (assignment.result) {
          result.outputs[assignment.capability] = assignment.result;
        }
      }

      this.results.set(taskId, result);
      this.emit('task:completed', result);
    }
  }

  private handleCoordinationMessage(contents: Buffer, sequenceNumber: number): void {
    try {
      const message: CoordinationMessage = JSON.parse(contents.toString());

      switch (message.type) {
        case MessageType.TASK_REQUEST: {
          const task = message.payload.task as TaskRequest;
          this.tasks.set(task.id, task);
          this.emit('task:received', task);
          break;
        }
        case MessageType.TASK_BID: {
          const bid = message.payload.bid as TaskBid;
          const bids = this.bids.get(bid.taskId) || [];
          bids.push(bid);
          this.bids.set(bid.taskId, bids);
          this.emit('task:bidReceived', bid);
          break;
        }
        case MessageType.TASK_COMPLETE: {
          if (message.taskId) {
            this.checkTaskCompletion(message.taskId);
          }
          break;
        }
      }
    } catch (error) {
      // Ignore malformed messages
    }
  }
}
