/**
 * Tests for barrel exports from src/index.ts
 * Verifies all public API exports are accessible and properly typed.
 */

import * as AgentMesh from '../index';

describe('Index Exports', () => {
  describe('Core exports', () => {
    it('should export HederaClient', () => {
      expect(AgentMesh.HederaClient).toBeDefined();
      expect(typeof AgentMesh.HederaClient).toBe('function');
    });

    it('should export AgentRegistry', () => {
      expect(AgentMesh.AgentRegistry).toBeDefined();
      expect(typeof AgentMesh.AgentRegistry).toBe('function');
    });

    it('should export TaskCoordinator', () => {
      expect(AgentMesh.TaskCoordinator).toBeDefined();
      expect(typeof AgentMesh.TaskCoordinator).toBe('function');
    });

    it('should export ReputationManager', () => {
      expect(AgentMesh.ReputationManager).toBeDefined();
      expect(typeof AgentMesh.ReputationManager).toBe('function');
    });

    it('should export MeshNode', () => {
      expect(AgentMesh.MeshNode).toBeDefined();
      expect(typeof AgentMesh.MeshNode).toBe('function');
    });
  });

  describe('Type exports', () => {
    it('should export MessageType enum', () => {
      expect(AgentMesh.MessageType).toBeDefined();
      expect(AgentMesh.MessageType.AGENT_REGISTER).toBe('agent.register');
      expect(AgentMesh.MessageType.TASK_REQUEST).toBe('task.request');
    });

    it('should export all MessageType values', () => {
      const expected = [
        'AGENT_REGISTER', 'AGENT_DEREGISTER', 'AGENT_HEARTBEAT', 'AGENT_STATUS_UPDATE',
        'TASK_REQUEST', 'TASK_BID', 'TASK_ASSIGN', 'TASK_ACCEPT', 'TASK_REJECT',
        'TASK_PROGRESS', 'TASK_COMPLETE', 'TASK_FAIL',
        'CAPABILITY_QUERY', 'CAPABILITY_RESPONSE', 'DATA_REQUEST', 'DATA_RESPONSE',
        'CONNECTION_REQUEST', 'CONNECTION_ACCEPT', 'CONNECTION_REJECT',
      ];
      for (const key of expected) {
        expect((AgentMesh.MessageType as any)[key]).toBeDefined();
      }
    });
  });

  describe('MCP exports', () => {
    it('should export MCPServer', () => {
      expect(AgentMesh.MCPServer).toBeDefined();
      expect(typeof AgentMesh.MCPServer).toBe('function');
    });
  });

  describe('Agent factory exports', () => {
    it('should export createResearchAgent', () => {
      expect(AgentMesh.createResearchAgent).toBeDefined();
      expect(typeof AgentMesh.createResearchAgent).toBe('function');
    });

    it('should export createAnalysisAgent', () => {
      expect(AgentMesh.createAnalysisAgent).toBeDefined();
      expect(typeof AgentMesh.createAnalysisAgent).toBe('function');
    });

    it('should export createCoordinatorAgent', () => {
      expect(AgentMesh.createCoordinatorAgent).toBeDefined();
      expect(typeof AgentMesh.createCoordinatorAgent).toBe('function');
    });
  });

  describe('HOL integration exports', () => {
    it('should export HCS10Bridge', () => {
      expect(AgentMesh.HCS10Bridge).toBeDefined();
      expect(typeof AgentMesh.HCS10Bridge).toBe('function');
    });

    it('should export StandardsRegistry', () => {
      expect(AgentMesh.StandardsRegistry).toBeDefined();
      expect(typeof AgentMesh.StandardsRegistry).toBe('function');
    });
  });

  describe('Dashboard exports', () => {
    it('should export Dashboard', () => {
      expect(AgentMesh.Dashboard).toBeDefined();
      expect(typeof AgentMesh.Dashboard).toBe('function');
    });
  });

  describe('Export count', () => {
    it('should export at least 15 symbols', () => {
      const keys = Object.keys(AgentMesh);
      expect(keys.length).toBeGreaterThanOrEqual(15);
    });
  });
});
