/**
 * Tests for hol/index.ts barrel exports
 * Ensures the HOL integration re-exports are properly accessible.
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

// Mock Hedera SDK
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

import * as HolExports from '../hol/index';

describe('HOL Index Barrel Exports', () => {
  it('should export HCS10Bridge class', () => {
    expect(HolExports.HCS10Bridge).toBeDefined();
    expect(typeof HolExports.HCS10Bridge).toBe('function');
  });

  it('should export StandardsRegistry class', () => {
    expect(HolExports.StandardsRegistry).toBeDefined();
    expect(typeof HolExports.StandardsRegistry).toBe('function');
  });

  it('should allow instantiation of HCS10Bridge', () => {
    const bridge = new HolExports.HCS10Bridge({
      meshConfig: {
        network: 'testnet',
        operatorAccountId: '0.0.12345',
        operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
      },
    });
    expect(bridge).toBeDefined();
  });

  it('should allow instantiation of StandardsRegistry', () => {
    const registry = new HolExports.StandardsRegistry({
      network: 'testnet',
      operatorAccountId: '0.0.12345',
      operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
    });
    expect(registry).toBeDefined();
  });

  it('should export at least 2 named exports', () => {
    const keys = Object.keys(HolExports);
    expect(keys.length).toBeGreaterThanOrEqual(2);
  });

  it('should re-export the same HCS10Bridge as direct import', async () => {
    const { HCS10Bridge: DirectBridge } = await import('../hol/hcs10-bridge');
    expect(HolExports.HCS10Bridge).toBe(DirectBridge);
  });

  it('should re-export the same StandardsRegistry as direct import', async () => {
    const { StandardsRegistry: DirectRegistry } = await import('../hol/standards-registry');
    expect(HolExports.StandardsRegistry).toBe(DirectRegistry);
  });
});
