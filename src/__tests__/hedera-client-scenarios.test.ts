/**
 * HederaClient - Comprehensive mock-based tests for all client operations
 */

import { HederaClient } from '../core/hedera-client';
import { MeshConfig } from '../core/types';

// Mock the entire @hashgraph/sdk
jest.mock('@hashgraph/sdk', () => {
  const mockClient = {
    setOperator: jest.fn(),
    setDefaultMaxTransactionFee: jest.fn(),
    setDefaultMaxQueryPayment: jest.fn(),
    close: jest.fn(),
  };

  return {
    Client: {
      forTestnet: jest.fn(() => mockClient),
      forMainnet: jest.fn(() => mockClient),
      forPreviewnet: jest.fn(() => mockClient),
    },
    AccountId: {
      fromString: jest.fn((s: string) => ({ toString: () => s })),
    },
    PrivateKey: {
      fromStringED25519: jest.fn((s: string) => ({
        publicKey: { toString: () => 'publicKey' },
        toStringRaw: () => s,
      })),
      generateED25519: jest.fn(() => ({
        publicKey: { toString: () => 'newPublicKey' },
        toStringRaw: () => 'newPrivateKey',
      })),
    },
    TopicCreateTransaction: jest.fn(() => ({
      setTopicMemo: jest.fn().mockReturnThis(),
      setSubmitKey: jest.fn().mockReturnThis(),
      setAdminKey: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        getReceipt: jest.fn().mockResolvedValue({
          topicId: { toString: () => '0.0.100' },
        }),
      }),
    })),
    TopicMessageSubmitTransaction: jest.fn(() => ({
      setTopicId: jest.fn().mockReturnThis(),
      setMessage: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        getReceipt: jest.fn().mockResolvedValue({
          topicSequenceNumber: BigInt(1),
        }),
      }),
    })),
    TopicMessageQuery: jest.fn(() => ({
      setTopicId: jest.fn().mockReturnThis(),
      setStartTime: jest.fn().mockReturnThis(),
      subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
    })),
    TopicId: {
      fromString: jest.fn((s: string) => ({ toString: () => s })),
    },
    Hbar: jest.fn((amount: number) => ({ toBigNumber: () => ({ toNumber: () => amount }) })),
    AccountCreateTransaction: jest.fn(() => ({
      setKey: jest.fn().mockReturnThis(),
      setInitialBalance: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        getReceipt: jest.fn().mockResolvedValue({
          accountId: { toString: () => '0.0.999' },
        }),
      }),
    })),
    AccountBalanceQuery: jest.fn(() => ({
      setAccountId: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        hbars: { toBigNumber: () => ({ toNumber: () => 100 }) },
      }),
    })),
    TransferTransaction: jest.fn(() => ({
      addHbarTransfer: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        getReceipt: jest.fn().mockResolvedValue({
          status: { toString: () => 'SUCCESS' },
        }),
      }),
    })),
    TopicInfoQuery: jest.fn(() => ({
      setTopicId: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        topicMemo: 'Test Memo',
        sequenceNumber: BigInt(42),
      }),
    })),
  };
});

const TEST_CONFIG: MeshConfig = {
  network: 'testnet',
  operatorAccountId: '0.0.1',
  operatorPrivateKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
};

describe('HederaClient - Comprehensive', () => {
  describe('Constructor', () => {
    it('should create client for testnet', () => {
      const client = new HederaClient({ ...TEST_CONFIG, network: 'testnet' });
      expect(client).toBeDefined();
    });

    it('should create client for mainnet', () => {
      const client = new HederaClient({ ...TEST_CONFIG, network: 'mainnet' });
      expect(client).toBeDefined();
    });

    it('should create client for previewnet', () => {
      const client = new HederaClient({ ...TEST_CONFIG, network: 'previewnet' });
      expect(client).toBeDefined();
    });
  });

  describe('getOperatorAccountId', () => {
    it('should return operator account ID', () => {
      const client = new HederaClient(TEST_CONFIG);
      expect(client.getOperatorAccountId()).toBe('0.0.1');
    });
  });

  describe('getClient', () => {
    it('should return the underlying Hedera SDK client', () => {
      const client = new HederaClient(TEST_CONFIG);
      expect(client.getClient()).toBeDefined();
    });
  });

  describe('createTopic', () => {
    it('should create a topic and return topic ID', async () => {
      const client = new HederaClient(TEST_CONFIG);
      const topicId = await client.createTopic('Test Topic');
      expect(topicId).toBe('0.0.100');
    });

    it('should create topic without memo', async () => {
      const client = new HederaClient(TEST_CONFIG);
      const topicId = await client.createTopic();
      expect(topicId).toBe('0.0.100');
    });

    it('should create topic with empty memo', async () => {
      const client = new HederaClient(TEST_CONFIG);
      const topicId = await client.createTopic('');
      expect(topicId).toBe('0.0.100');
    });
  });

  describe('submitMessage', () => {
    it('should submit string message', async () => {
      const client = new HederaClient(TEST_CONFIG);
      const seq = await client.submitMessage('0.0.100', 'Hello');
      expect(seq).toBe(1);
    });

    it('should submit Buffer message', async () => {
      const client = new HederaClient(TEST_CONFIG);
      const seq = await client.submitMessage('0.0.100', Buffer.from('Hello'));
      expect(seq).toBe(1);
    });

    it('should submit short message directly', async () => {
      const client = new HederaClient(TEST_CONFIG);
      const msg = 'Short message under 1024 bytes';
      const seq = await client.submitMessage('0.0.100', msg);
      expect(seq).toBe(1);
    });

    it('should handle empty message', async () => {
      const client = new HederaClient(TEST_CONFIG);
      const seq = await client.submitMessage('0.0.100', '');
      expect(seq).toBe(1);
    });
  });

  describe('subscribeTopic', () => {
    it('should subscribe to a topic', () => {
      const client = new HederaClient(TEST_CONFIG);
      const callback = jest.fn();
      client.subscribeTopic('0.0.100', callback);
      // Should not throw
    });

    it('should subscribe with start time', () => {
      const client = new HederaClient(TEST_CONFIG);
      const callback = jest.fn();
      client.subscribeTopic('0.0.100', callback, new Date());
      // Should not throw
    });
  });

  describe('unsubscribeTopic', () => {
    it('should unsubscribe from a topic', () => {
      const client = new HederaClient(TEST_CONFIG);
      const callback = jest.fn();
      client.subscribeTopic('0.0.100', callback);
      client.unsubscribeTopic('0.0.100');
      // Should not throw
    });

    it('should handle unsubscribing non-existent topic', () => {
      const client = new HederaClient(TEST_CONFIG);
      client.unsubscribeTopic('0.0.nonexistent');
      // Should not throw
    });
  });

  describe('getBalance', () => {
    it('should return account balance', async () => {
      const client = new HederaClient(TEST_CONFIG);
      const balance = await client.getBalance();
      expect(balance).toBe(100);
    });
  });

  describe('getTopicInfo', () => {
    it('should return topic info', async () => {
      const client = new HederaClient(TEST_CONFIG);
      const info = await client.getTopicInfo('0.0.100');
      expect(info.memo).toBe('Test Memo');
      expect(info.sequenceNumber).toBe(42);
    });
  });

  describe('transferHbar', () => {
    it('should transfer HBAR and return status', async () => {
      const client = new HederaClient(TEST_CONFIG);
      const status = await client.transferHbar('0.0.999', 10);
      expect(status).toBe('SUCCESS');
    });
  });

  describe('createAccount', () => {
    it('should create new account', async () => {
      const client = new HederaClient(TEST_CONFIG);
      const result = await client.createAccount();
      expect(result.accountId).toBe('0.0.999');
      expect(result.privateKey).toBeDefined();
    });

    it('should create account with custom initial balance', async () => {
      const client = new HederaClient(TEST_CONFIG);
      const result = await client.createAccount(50);
      expect(result.accountId).toBe('0.0.999');
    });
  });

  describe('close', () => {
    it('should close client and unsubscribe all', () => {
      const client = new HederaClient(TEST_CONFIG);
      const callback = jest.fn();
      client.subscribeTopic('0.0.100', callback);
      client.subscribeTopic('0.0.101', callback);
      client.close();
      // Should not throw
    });

    it('should handle close with no subscriptions', () => {
      const client = new HederaClient(TEST_CONFIG);
      client.close();
      // Should not throw
    });
  });

  describe('EventEmitter', () => {
    it('should support event emission', () => {
      const client = new HederaClient(TEST_CONFIG);
      const handler = jest.fn();
      client.on('test', handler);
      client.emit('test', 'data');
      expect(handler).toHaveBeenCalledWith('data');
    });

    it('should support error events', () => {
      const client = new HederaClient(TEST_CONFIG);
      const handler = jest.fn();
      client.on('error', handler);
      client.emit('error', { topicId: '0.0.1', error: new Error('test') });
      expect(handler).toHaveBeenCalled();
    });
  });
});
