/**
 * Tests for barrel exports from src/index.ts
 * Verifies all public API exports are accessible and properly typed.
 */

// Mock the standards SDK to avoid file-type dependency issue
jest.mock('@hashgraphonline/standards-sdk', () => ({
  HCS10Client: jest.fn().mockImplementation(() => ({})),
  AgentBuilder: jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setBio: jest.fn().mockReturnThis(),
    setType: jest.fn().mockReturnThis(),
    setCapabilities: jest.fn().mockReturnThis(),
    setNetwork: jest.fn().mockReturnThis(),
    setInboundTopicType: jest.fn().mockReturnThis(),
    setModel: jest.fn().mockReturnThis(),
    setCreator: jest.fn().mockReturnThis(),
    setProfilePicture: jest.fn().mockReturnThis(),
    addProperty: jest.fn().mockReturnThis(),
  })),
  AIAgentCapability: {
    TEXT_GENERATION: 0, IMAGE_GENERATION: 1, CODE_GENERATION: 4,
    LANGUAGE_TRANSLATION: 5, SUMMARIZATION_EXTRACTION: 6, KNOWLEDGE_RETRIEVAL: 7,
    DATA_INTEGRATION: 8, MARKET_INTELLIGENCE: 9, TRANSACTION_ANALYTICS: 10,
    SMART_CONTRACT_AUDIT: 11, SECURITY_MONITORING: 13, COMPLIANCE_ANALYSIS: 14,
    FRAUD_DETECTION: 15, MULTI_AGENT_COORDINATION: 16, API_INTEGRATION: 17,
    WORKFLOW_AUTOMATION: 18,
  },
  AIAgentType: { MANUAL: 0, AUTONOMOUS: 1 },
  InboundTopicType: { PUBLIC: 'public', CONTROLLED: 'controlled', FEE_BASED: 'fee_based' },
}));

// Mock Hedera SDK to avoid network dependency
jest.mock('@hashgraph/sdk', () => ({
  Client: {
    forTestnet: jest.fn(() => ({ setOperator: jest.fn(), setDefaultMaxTransactionFee: jest.fn(), setDefaultMaxQueryPayment: jest.fn(), close: jest.fn() })),
    forMainnet: jest.fn(() => ({ setOperator: jest.fn(), setDefaultMaxTransactionFee: jest.fn(), setDefaultMaxQueryPayment: jest.fn(), close: jest.fn() })),
    forPreviewnet: jest.fn(() => ({ setOperator: jest.fn(), setDefaultMaxTransactionFee: jest.fn(), setDefaultMaxQueryPayment: jest.fn(), close: jest.fn() })),
  },
  AccountId: { fromString: jest.fn((id: string) => ({ toString: () => id })) },
  PrivateKey: { fromStringED25519: jest.fn(() => ({ publicKey: { toString: () => 'mock-key' }, toStringRaw: jest.fn() })), generateED25519: jest.fn() },
  TopicCreateTransaction: jest.fn(), TopicMessageSubmitTransaction: jest.fn(),
  TopicMessageQuery: jest.fn(), TopicId: { fromString: jest.fn() },
  Hbar: jest.fn(), AccountCreateTransaction: jest.fn(),
  AccountBalanceQuery: jest.fn(), TransferTransaction: jest.fn(), TopicInfoQuery: jest.fn(),
}));

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
    it('should export at least 10 symbols', () => {
      const keys = Object.keys(AgentMesh);
      expect(keys.length).toBeGreaterThanOrEqual(10);
    });
  });
});
