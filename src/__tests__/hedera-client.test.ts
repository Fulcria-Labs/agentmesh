/**
 * HederaClient Unit Tests
 *
 * Comprehensive tests for the Hedera client wrapper that handles
 * account creation, topic management, message submission, subscriptions,
 * balance queries, hbar transfers, and network configuration.
 *
 * All Hedera SDK classes are mocked to prevent real network calls.
 */

import { HederaClient } from '../core/hedera-client';
import { MeshConfig } from '../core/types';

// ---- Mock all Hedera SDK classes ----

const mockExecute = jest.fn();
const mockGetReceipt = jest.fn();
const mockSubscribe = jest.fn();

jest.mock('@hashgraph/sdk', () => {
  const setAccountId = jest.fn().mockReturnThis();
  const setTopicId = jest.fn().mockReturnThis();
  const setMessage = jest.fn().mockReturnThis();
  const setTopicMemo = jest.fn().mockReturnThis();
  const setSubmitKey = jest.fn().mockReturnThis();
  const setAdminKey = jest.fn().mockReturnThis();
  const setStartTime = jest.fn().mockReturnThis();
  const setKey = jest.fn().mockReturnThis();
  const setInitialBalance = jest.fn().mockReturnThis();
  const addHbarTransfer = jest.fn().mockReturnThis();
  const setDefaultMaxTransactionFee = jest.fn();
  const setDefaultMaxQueryPayment = jest.fn();
  const setOperator = jest.fn();
  const clientClose = jest.fn();

  const mockPublicKey = { toString: () => 'mock-public-key' };

  return {
    Client: {
      forTestnet: jest.fn(() => ({
        setOperator,
        setDefaultMaxTransactionFee,
        setDefaultMaxQueryPayment,
        close: clientClose,
      })),
      forMainnet: jest.fn(() => ({
        setOperator,
        setDefaultMaxTransactionFee,
        setDefaultMaxQueryPayment,
        close: clientClose,
      })),
      forPreviewnet: jest.fn(() => ({
        setOperator,
        setDefaultMaxTransactionFee,
        setDefaultMaxQueryPayment,
        close: clientClose,
      })),
    },
    AccountId: {
      fromString: jest.fn((id: string) => ({ toString: () => id })),
    },
    PrivateKey: {
      fromStringED25519: jest.fn(() => ({
        publicKey: mockPublicKey,
        toStringRaw: jest.fn(() => 'raw-private-key'),
      })),
      generateED25519: jest.fn(() => ({
        publicKey: mockPublicKey,
        toStringRaw: jest.fn(() => 'generated-raw-key'),
      })),
    },
    TopicCreateTransaction: jest.fn(() => ({
      setTopicMemo,
      setSubmitKey,
      setAdminKey,
      execute: mockExecute,
    })),
    TopicMessageSubmitTransaction: jest.fn(() => ({
      setTopicId,
      setMessage,
      execute: mockExecute,
    })),
    TopicMessageQuery: jest.fn(() => ({
      setTopicId,
      setStartTime,
      subscribe: mockSubscribe,
    })),
    TopicId: {
      fromString: jest.fn((id: string) => ({ toString: () => id })),
    },
    Hbar: jest.fn((amount: number) => ({ _amount: amount })),
    AccountCreateTransaction: jest.fn(() => ({
      setKey,
      setInitialBalance,
      execute: mockExecute,
    })),
    AccountBalanceQuery: jest.fn(() => ({
      setAccountId,
      execute: jest.fn().mockResolvedValue({
        hbars: { toBigNumber: () => ({ toNumber: () => 42.5 }) },
      }),
    })),
    TransferTransaction: jest.fn(() => ({
      addHbarTransfer,
      execute: mockExecute,
    })),
    TopicInfoQuery: jest.fn(() => ({
      setTopicId,
      execute: jest.fn().mockResolvedValue({
        topicMemo: 'test memo',
        sequenceNumber: { toString: () => '10' },
      }),
    })),
  };
});

// Re-import after mock
const SDK = require('@hashgraph/sdk');

// ---- Helpers ----

const BASE_KEY = '302e020100300506032b657004220420' + 'a'.repeat(64);

function makeConfig(overrides: Partial<MeshConfig> = {}): MeshConfig {
  return {
    network: 'testnet',
    operatorAccountId: '0.0.12345',
    operatorPrivateKey: BASE_KEY,
    ...overrides,
  };
}

function resetMocks() {
  jest.clearAllMocks();
  mockExecute.mockReset();
  mockGetReceipt.mockReset();
  mockSubscribe.mockReset();

  // Default happy-path receipts
  mockGetReceipt.mockResolvedValue({
    topicId: { toString: () => '0.0.500' },
    topicSequenceNumber: { toString: () => '1' },
    accountId: { toString: () => '0.0.600' },
    status: { toString: () => 'SUCCESS' },
  });

  mockExecute.mockResolvedValue({ getReceipt: mockGetReceipt });

  mockSubscribe.mockReturnValue({ unsubscribe: jest.fn() });
}

// ---- Tests ----

describe('HederaClient', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ==================== Constructor & Network ====================

  describe('constructor', () => {
    it('should create client for testnet', () => {
      const client = new HederaClient(makeConfig({ network: 'testnet' }));
      expect(client).toBeDefined();
      expect(SDK.Client.forTestnet).toHaveBeenCalled();
    });

    it('should create client for mainnet', () => {
      new HederaClient(makeConfig({ network: 'mainnet' }));
      expect(SDK.Client.forMainnet).toHaveBeenCalled();
    });

    it('should create client for previewnet', () => {
      new HederaClient(makeConfig({ network: 'previewnet' }));
      expect(SDK.Client.forPreviewnet).toHaveBeenCalled();
    });

    it('should set operator on the underlying client', () => {
      const client = new HederaClient(makeConfig());
      const inner = client.getClient();
      expect(inner.setOperator).toHaveBeenCalled();
    });

    it('should set default max transaction fee', () => {
      const client = new HederaClient(makeConfig());
      const inner = client.getClient();
      expect(inner.setDefaultMaxTransactionFee).toHaveBeenCalled();
    });

    it('should set default max query payment', () => {
      const client = new HederaClient(makeConfig());
      const inner = client.getClient();
      expect(inner.setDefaultMaxQueryPayment).toHaveBeenCalled();
    });

    it('should parse operator account ID from config', () => {
      const client = new HederaClient(makeConfig({ operatorAccountId: '0.0.99999' }));
      expect(client.getOperatorAccountId()).toBe('0.0.99999');
    });

    it('should be an EventEmitter', () => {
      const client = new HederaClient(makeConfig());
      expect(typeof client.on).toBe('function');
      expect(typeof client.emit).toBe('function');
    });
  });

  describe('getClient', () => {
    it('should return the underlying Hedera SDK client', () => {
      const client = new HederaClient(makeConfig());
      const inner = client.getClient();
      expect(inner).toBeDefined();
      expect(typeof inner.setOperator).toBe('function');
    });
  });

  describe('getOperatorAccountId', () => {
    it('should return the operator account as a string', () => {
      const client = new HederaClient(makeConfig({ operatorAccountId: '0.0.54321' }));
      expect(client.getOperatorAccountId()).toBe('0.0.54321');
    });
  });

  // ==================== getBalance ====================

  describe('getBalance', () => {
    it('should return numeric hbar balance', async () => {
      const client = new HederaClient(makeConfig());
      const balance = await client.getBalance();
      expect(balance).toBe(42.5);
    });

    it('should query the correct account', async () => {
      const client = new HederaClient(makeConfig({ operatorAccountId: '0.0.11111' }));
      await client.getBalance();
      expect(SDK.AccountBalanceQuery).toHaveBeenCalled();
    });
  });

  // ==================== createTopic ====================

  describe('createTopic', () => {
    it('should create a topic and return its ID', async () => {
      const client = new HederaClient(makeConfig());
      const topicId = await client.createTopic();
      expect(topicId).toBe('0.0.500');
    });

    it('should set topic memo when provided', async () => {
      const client = new HederaClient(makeConfig());
      await client.createTopic('My Memo');
      const txInstance = SDK.TopicCreateTransaction.mock.results[0].value;
      expect(txInstance.setTopicMemo).toHaveBeenCalledWith('My Memo');
    });

    it('should not set memo when not provided', async () => {
      const client = new HederaClient(makeConfig());
      await client.createTopic();
      const txInstance = SDK.TopicCreateTransaction.mock.results[0].value;
      expect(txInstance.setTopicMemo).not.toHaveBeenCalled();
    });

    it('should set submit key when provided', async () => {
      const client = new HederaClient(makeConfig());
      const fakeKey = SDK.PrivateKey.fromStringED25519('dummy');
      await client.createTopic('memo', fakeKey);
      const txInstance = SDK.TopicCreateTransaction.mock.results[0].value;
      expect(txInstance.setSubmitKey).toHaveBeenCalled();
    });

    it('should always set admin key', async () => {
      const client = new HederaClient(makeConfig());
      await client.createTopic();
      const txInstance = SDK.TopicCreateTransaction.mock.results[0].value;
      expect(txInstance.setAdminKey).toHaveBeenCalled();
    });

    it('should throw when receipt has no topic ID', async () => {
      mockGetReceipt.mockResolvedValue({ topicId: null });
      const client = new HederaClient(makeConfig());
      await expect(client.createTopic()).rejects.toThrow('Failed to create topic');
    });

    it('should propagate network errors on execute', async () => {
      mockExecute.mockRejectedValue(new Error('NETWORK_ERROR'));
      const client = new HederaClient(makeConfig());
      await expect(client.createTopic()).rejects.toThrow('NETWORK_ERROR');
    });

    it('should propagate errors on getReceipt', async () => {
      mockGetReceipt.mockRejectedValue(new Error('RECEIPT_ERROR'));
      const client = new HederaClient(makeConfig());
      await expect(client.createTopic()).rejects.toThrow('RECEIPT_ERROR');
    });
  });

  // ==================== submitMessage ====================

  describe('submitMessage', () => {
    it('should submit a string message and return sequence number', async () => {
      mockGetReceipt.mockResolvedValue({ topicSequenceNumber: 7 });
      const client = new HederaClient(makeConfig());
      const seq = await client.submitMessage('0.0.100', 'hello');
      expect(seq).toBe(7);
    });

    it('should submit a Buffer message', async () => {
      mockGetReceipt.mockResolvedValue({ topicSequenceNumber: 3 });
      const client = new HederaClient(makeConfig());
      const seq = await client.submitMessage('0.0.100', Buffer.from('binary'));
      expect(seq).toBe(3);
    });

    it('should set the correct topic ID', async () => {
      mockGetReceipt.mockResolvedValue({ topicSequenceNumber: 1 });
      const client = new HederaClient(makeConfig());
      await client.submitMessage('0.0.200', 'msg');
      expect(SDK.TopicId.fromString).toHaveBeenCalledWith('0.0.200');
    });

    it('should propagate network errors', async () => {
      mockExecute.mockRejectedValue(new Error('SUBMIT_FAILED'));
      const client = new HederaClient(makeConfig());
      await expect(client.submitMessage('0.0.100', 'test')).rejects.toThrow('SUBMIT_FAILED');
    });

    it('should delegate to submitChunkedMessage for large messages', async () => {
      // Message > 1024 bytes
      const largeMsg = Buffer.alloc(2000, 'x');
      mockGetReceipt.mockResolvedValue({ topicSequenceNumber: 99 });
      const client = new HederaClient(makeConfig());
      const seq = await client.submitMessage('0.0.100', largeMsg);
      expect(seq).toBe(99);
      // Should have been called multiple times (2 chunks)
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it('should not chunk messages exactly at 1024 bytes', async () => {
      const exactMsg = Buffer.alloc(1024, 'x');
      mockGetReceipt.mockResolvedValue({ topicSequenceNumber: 5 });
      const client = new HederaClient(makeConfig());
      await client.submitMessage('0.0.100', exactMsg);
      // Exactly 1024 is not > 1024, so no chunking
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('should chunk a message just over 1024 bytes into 2 chunks', async () => {
      const msg = Buffer.alloc(1025, 'y');
      mockGetReceipt.mockResolvedValue({ topicSequenceNumber: 10 });
      const client = new HederaClient(makeConfig());
      await client.submitMessage('0.0.100', msg);
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it('should chunk a 3072-byte message into 3 chunks', async () => {
      const msg = Buffer.alloc(3072, 'z');
      mockGetReceipt.mockResolvedValue({ topicSequenceNumber: 20 });
      const client = new HederaClient(makeConfig());
      await client.submitMessage('0.0.100', msg);
      expect(mockExecute).toHaveBeenCalledTimes(3);
    });

    it('should return the sequence number of the last chunk', async () => {
      let callCount = 0;
      mockGetReceipt.mockImplementation(() => {
        callCount++;
        return Promise.resolve({ topicSequenceNumber: callCount * 10 });
      });
      const client = new HederaClient(makeConfig());
      const seq = await client.submitMessage('0.0.100', Buffer.alloc(2048, 'a'));
      expect(seq).toBe(20); // Second call returns 20
    });

    it('should propagate error on chunked message failure', async () => {
      // First chunk succeeds, second fails
      mockExecute
        .mockResolvedValueOnce({ getReceipt: jest.fn().mockResolvedValue({ topicSequenceNumber: 1 }) })
        .mockRejectedValueOnce(new Error('CHUNK_FAIL'));
      const client = new HederaClient(makeConfig());
      await expect(
        client.submitMessage('0.0.100', Buffer.alloc(2048, 'b'))
      ).rejects.toThrow('CHUNK_FAIL');
    });

    it('should handle empty string message', async () => {
      mockGetReceipt.mockResolvedValue({ topicSequenceNumber: 1 });
      const client = new HederaClient(makeConfig());
      const seq = await client.submitMessage('0.0.100', '');
      expect(seq).toBe(1);
    });
  });

  // ==================== subscribeTopic ====================

  describe('subscribeTopic', () => {
    it('should subscribe to a topic and call callback on message', () => {
      const client = new HederaClient(makeConfig());
      const callback = jest.fn();

      client.subscribeTopic('0.0.300', callback);

      expect(SDK.TopicMessageQuery).toHaveBeenCalled();
      expect(mockSubscribe).toHaveBeenCalled();
    });

    it('should pass startTime when provided', () => {
      const client = new HederaClient(makeConfig());
      const startTime = new Date('2026-01-01');

      client.subscribeTopic('0.0.300', jest.fn(), startTime);

      const queryInstance = SDK.TopicMessageQuery.mock.results[0].value;
      expect(queryInstance.setStartTime).toHaveBeenCalledWith(startTime);
    });

    it('should not set startTime when not provided', () => {
      const client = new HederaClient(makeConfig());

      client.subscribeTopic('0.0.300', jest.fn());

      const queryInstance = SDK.TopicMessageQuery.mock.results[0].value;
      expect(queryInstance.setStartTime).not.toHaveBeenCalled();
    });

    it('should emit error event when subscription encounters an error', () => {
      // Make subscribe capture error handler and invoke it
      mockSubscribe.mockImplementation((client: any, errorHandler: (err: Error) => void, msgHandler: any) => {
        errorHandler(new Error('SUB_ERROR'));
        return { unsubscribe: jest.fn() };
      });

      const hClient = new HederaClient(makeConfig());
      const errorSpy = jest.fn();
      hClient.on('error', errorSpy);

      hClient.subscribeTopic('0.0.300', jest.fn());

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: '0.0.300', error: expect.any(Error) })
      );
    });

    it('should invoke callback with formatted message on new message', () => {
      const messageContent = Buffer.from('test message');
      mockSubscribe.mockImplementation((client: any, errorHandler: any, msgHandler: (msg: any) => void) => {
        msgHandler({
          contents: messageContent,
          sequenceNumber: { toString: () => '5' },
          consensusTimestamp: 'some-timestamp',
        });
        return { unsubscribe: jest.fn() };
      });

      const hClient = new HederaClient(makeConfig());
      const callback = jest.fn();

      hClient.subscribeTopic('0.0.300', callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: expect.any(Buffer),
          sequenceNumber: 5,
          consensusTimestamp: 'some-timestamp',
        })
      );
    });

    it('should store subscription for later unsubscription', () => {
      const client = new HederaClient(makeConfig());
      client.subscribeTopic('0.0.300', jest.fn());
      // Verifiable by calling unsubscribeTopic without error
      client.unsubscribeTopic('0.0.300');
    });

    it('should handle subscribing to multiple topics', () => {
      const client = new HederaClient(makeConfig());
      client.subscribeTopic('0.0.100', jest.fn());
      client.subscribeTopic('0.0.200', jest.fn());
      // Both should be unsubscribable
      client.unsubscribeTopic('0.0.100');
      client.unsubscribeTopic('0.0.200');
    });

    it('should overwrite previous subscription for same topic', () => {
      const unsub1 = jest.fn();
      const unsub2 = jest.fn();
      mockSubscribe
        .mockReturnValueOnce({ unsubscribe: unsub1 })
        .mockReturnValueOnce({ unsubscribe: unsub2 });

      const client = new HederaClient(makeConfig());
      client.subscribeTopic('0.0.300', jest.fn());
      client.subscribeTopic('0.0.300', jest.fn());

      // Unsubscribing should call the latest one
      client.unsubscribeTopic('0.0.300');
      expect(unsub2).toHaveBeenCalled();
    });
  });

  // ==================== unsubscribeTopic ====================

  describe('unsubscribeTopic', () => {
    it('should call unsubscribe on the stored handle', () => {
      const unsubFn = jest.fn();
      mockSubscribe.mockReturnValue({ unsubscribe: unsubFn });

      const client = new HederaClient(makeConfig());
      client.subscribeTopic('0.0.300', jest.fn());
      client.unsubscribeTopic('0.0.300');

      expect(unsubFn).toHaveBeenCalled();
    });

    it('should remove the subscription from internal map', () => {
      const unsubFn = jest.fn();
      mockSubscribe.mockReturnValue({ unsubscribe: unsubFn });

      const client = new HederaClient(makeConfig());
      client.subscribeTopic('0.0.300', jest.fn());
      client.unsubscribeTopic('0.0.300');

      // Second unsubscribe should be a no-op
      unsubFn.mockClear();
      client.unsubscribeTopic('0.0.300');
      expect(unsubFn).not.toHaveBeenCalled();
    });

    it('should not throw for non-existent topic', () => {
      const client = new HederaClient(makeConfig());
      expect(() => client.unsubscribeTopic('0.0.999')).not.toThrow();
    });

    it('should not affect other subscriptions', () => {
      const unsub1 = jest.fn();
      const unsub2 = jest.fn();
      mockSubscribe
        .mockReturnValueOnce({ unsubscribe: unsub1 })
        .mockReturnValueOnce({ unsubscribe: unsub2 });

      const client = new HederaClient(makeConfig());
      client.subscribeTopic('0.0.100', jest.fn());
      client.subscribeTopic('0.0.200', jest.fn());

      client.unsubscribeTopic('0.0.100');
      expect(unsub1).toHaveBeenCalled();
      expect(unsub2).not.toHaveBeenCalled();
    });
  });

  // ==================== getTopicInfo ====================

  describe('getTopicInfo', () => {
    it('should return topic memo and sequence number', async () => {
      const client = new HederaClient(makeConfig());
      const info = await client.getTopicInfo('0.0.400');
      expect(info.memo).toBe('test memo');
      expect(typeof info.sequenceNumber).toBe('number');
    });

    it('should query the correct topic ID', async () => {
      const client = new HederaClient(makeConfig());
      await client.getTopicInfo('0.0.777');
      expect(SDK.TopicId.fromString).toHaveBeenCalledWith('0.0.777');
    });
  });

  // ==================== transferHbar ====================

  describe('transferHbar', () => {
    it('should execute transfer and return status', async () => {
      mockGetReceipt.mockResolvedValue({ status: { toString: () => 'SUCCESS' } });
      const client = new HederaClient(makeConfig());
      const status = await client.transferHbar('0.0.99999', 10);
      expect(status).toBe('SUCCESS');
    });

    it('should create negative transfer for sender and positive for receiver', async () => {
      mockGetReceipt.mockResolvedValue({ status: { toString: () => 'SUCCESS' } });
      const client = new HederaClient(makeConfig());
      await client.transferHbar('0.0.55555', 5);
      const txInstance = SDK.TransferTransaction.mock.results[0].value;
      expect(txInstance.addHbarTransfer).toHaveBeenCalledTimes(2);
    });

    it('should propagate network errors on transfer', async () => {
      mockExecute.mockRejectedValue(new Error('TRANSFER_ERROR'));
      const client = new HederaClient(makeConfig());
      await expect(client.transferHbar('0.0.100', 1)).rejects.toThrow('TRANSFER_ERROR');
    });

    it('should transfer zero hbar without error', async () => {
      mockGetReceipt.mockResolvedValue({ status: { toString: () => 'SUCCESS' } });
      const client = new HederaClient(makeConfig());
      const status = await client.transferHbar('0.0.100', 0);
      expect(status).toBe('SUCCESS');
    });
  });

  // ==================== createAccount ====================

  describe('createAccount', () => {
    it('should create an account and return ID and private key', async () => {
      const client = new HederaClient(makeConfig());
      const result = await client.createAccount();
      expect(result.accountId).toBe('0.0.600');
      expect(result.privateKey).toBe('generated-raw-key');
    });

    it('should use default initial balance of 10', async () => {
      const client = new HederaClient(makeConfig());
      await client.createAccount();
      expect(SDK.Hbar).toHaveBeenCalledWith(10);
    });

    it('should use custom initial balance when provided', async () => {
      const client = new HederaClient(makeConfig());
      await client.createAccount(25);
      expect(SDK.Hbar).toHaveBeenCalledWith(25);
    });

    it('should throw when receipt has no account ID', async () => {
      mockGetReceipt.mockResolvedValue({ accountId: null });
      const client = new HederaClient(makeConfig());
      await expect(client.createAccount()).rejects.toThrow('Failed to create account');
    });

    it('should propagate network errors on account creation', async () => {
      mockExecute.mockRejectedValue(new Error('CREATE_ACCOUNT_FAIL'));
      const client = new HederaClient(makeConfig());
      await expect(client.createAccount()).rejects.toThrow('CREATE_ACCOUNT_FAIL');
    });

    it('should generate a new ED25519 key for each account', async () => {
      const client = new HederaClient(makeConfig());
      await client.createAccount();
      expect(SDK.PrivateKey.generateED25519).toHaveBeenCalled();
    });
  });

  // ==================== close ====================

  describe('close', () => {
    it('should close the underlying client', () => {
      const client = new HederaClient(makeConfig());
      client.close();
      const inner = client.getClient();
      expect(inner.close).toHaveBeenCalled();
    });

    it('should unsubscribe all active subscriptions', () => {
      const unsub1 = jest.fn();
      const unsub2 = jest.fn();
      mockSubscribe
        .mockReturnValueOnce({ unsubscribe: unsub1 })
        .mockReturnValueOnce({ unsubscribe: unsub2 });

      const client = new HederaClient(makeConfig());
      client.subscribeTopic('0.0.100', jest.fn());
      client.subscribeTopic('0.0.200', jest.fn());

      client.close();

      expect(unsub1).toHaveBeenCalled();
      expect(unsub2).toHaveBeenCalled();
    });

    it('should be safe to call close with no subscriptions', () => {
      const client = new HederaClient(makeConfig());
      expect(() => client.close()).not.toThrow();
    });

    it('should be safe to call close multiple times', () => {
      const client = new HederaClient(makeConfig());
      client.close();
      expect(() => client.close()).not.toThrow();
    });
  });

  // ==================== Network switching ====================

  describe('network switching', () => {
    it('should use forTestnet for testnet config', () => {
      new HederaClient(makeConfig({ network: 'testnet' }));
      expect(SDK.Client.forTestnet).toHaveBeenCalled();
      expect(SDK.Client.forMainnet).not.toHaveBeenCalled();
      expect(SDK.Client.forPreviewnet).not.toHaveBeenCalled();
    });

    it('should use forMainnet for mainnet config', () => {
      jest.clearAllMocks();
      new HederaClient(makeConfig({ network: 'mainnet' }));
      expect(SDK.Client.forMainnet).toHaveBeenCalled();
      expect(SDK.Client.forTestnet).not.toHaveBeenCalled();
    });

    it('should use forPreviewnet for previewnet config', () => {
      jest.clearAllMocks();
      new HederaClient(makeConfig({ network: 'previewnet' }));
      expect(SDK.Client.forPreviewnet).toHaveBeenCalled();
      expect(SDK.Client.forTestnet).not.toHaveBeenCalled();
    });
  });

  // ==================== Error handling patterns ====================

  describe('error handling', () => {
    it('should handle getReceipt timeout on createTopic', async () => {
      mockGetReceipt.mockRejectedValue(new Error('RECEIVE_TIMEOUT'));
      const client = new HederaClient(makeConfig());
      await expect(client.createTopic()).rejects.toThrow('RECEIVE_TIMEOUT');
    });

    it('should handle getReceipt timeout on submitMessage', async () => {
      mockGetReceipt.mockRejectedValue(new Error('RECEIVE_TIMEOUT'));
      const client = new HederaClient(makeConfig());
      await expect(client.submitMessage('0.0.100', 'test')).rejects.toThrow('RECEIVE_TIMEOUT');
    });

    it('should handle getReceipt timeout on transferHbar', async () => {
      mockGetReceipt.mockRejectedValue(new Error('RECEIVE_TIMEOUT'));
      const client = new HederaClient(makeConfig());
      await expect(client.transferHbar('0.0.100', 1)).rejects.toThrow('RECEIVE_TIMEOUT');
    });

    it('should handle getReceipt timeout on createAccount', async () => {
      mockGetReceipt.mockRejectedValue(new Error('RECEIVE_TIMEOUT'));
      const client = new HederaClient(makeConfig());
      await expect(client.createAccount()).rejects.toThrow('RECEIVE_TIMEOUT');
    });

    it('should handle execute rejection on createTopic', async () => {
      mockExecute.mockRejectedValue(new Error('CONNECTION_REFUSED'));
      const client = new HederaClient(makeConfig());
      await expect(client.createTopic('test')).rejects.toThrow('CONNECTION_REFUSED');
    });

    it('should handle execute rejection on submitMessage', async () => {
      mockExecute.mockRejectedValue(new Error('CONNECTION_REFUSED'));
      const client = new HederaClient(makeConfig());
      await expect(client.submitMessage('0.0.100', 'msg')).rejects.toThrow('CONNECTION_REFUSED');
    });
  });
});
