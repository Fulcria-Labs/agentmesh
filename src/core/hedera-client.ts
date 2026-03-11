/**
 * Hedera Client - manages connection to Hedera network
 * Handles account creation, topic management, and message submission
 */

import {
  Client,
  AccountId,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicMessageQuery,
  TopicId,
  Hbar,
  AccountCreateTransaction,
  AccountBalanceQuery,
  TransferTransaction,
  TopicInfoQuery,
} from '@hashgraph/sdk';
import { MeshConfig } from './types';
import { EventEmitter } from 'events';

export class HederaClient extends EventEmitter {
  private client: Client;
  private operatorAccountId: AccountId;
  private operatorPrivateKey: PrivateKey;
  private subscriptions: Map<string, { unsubscribe: () => void }> = new Map();
  private config: MeshConfig;

  constructor(config: MeshConfig) {
    super();
    this.config = config;
    this.operatorAccountId = AccountId.fromString(config.operatorAccountId);
    this.operatorPrivateKey = PrivateKey.fromStringED25519(config.operatorPrivateKey);

    if (config.network === 'testnet') {
      this.client = Client.forTestnet();
    } else if (config.network === 'mainnet') {
      this.client = Client.forMainnet();
    } else {
      this.client = Client.forPreviewnet();
    }

    this.client.setOperator(this.operatorAccountId, this.operatorPrivateKey);
    this.client.setDefaultMaxTransactionFee(new Hbar(2));
    this.client.setDefaultMaxQueryPayment(new Hbar(1));
  }

  getClient(): Client {
    return this.client;
  }

  getOperatorAccountId(): string {
    return this.operatorAccountId.toString();
  }

  async getBalance(): Promise<number> {
    const balance = await new AccountBalanceQuery()
      .setAccountId(this.operatorAccountId)
      .execute(this.client);
    return balance.hbars.toBigNumber().toNumber();
  }

  async createTopic(memo?: string, submitKey?: PrivateKey): Promise<string> {
    const transaction = new TopicCreateTransaction();

    if (memo) {
      transaction.setTopicMemo(memo);
    }

    if (submitKey) {
      transaction.setSubmitKey(submitKey.publicKey);
    }

    transaction.setAdminKey(this.operatorPrivateKey.publicKey);

    const txResponse = await transaction.execute(this.client);
    const receipt = await txResponse.getReceipt(this.client);

    if (!receipt.topicId) {
      throw new Error('Failed to create topic: no topic ID in receipt');
    }

    return receipt.topicId.toString();
  }

  async submitMessage(topicId: string, message: string | Buffer): Promise<number> {
    const msgBytes = typeof message === 'string' ? Buffer.from(message) : message;

    // Handle messages larger than 1024 bytes by chunking
    if (msgBytes.length > 1024) {
      return this.submitChunkedMessage(topicId, msgBytes);
    }

    const txResponse = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(msgBytes)
      .execute(this.client);

    const receipt = await txResponse.getReceipt(this.client);
    return Number(receipt.topicSequenceNumber);
  }

  private async submitChunkedMessage(topicId: string, message: Buffer): Promise<number> {
    const chunkSize = 1024;
    const totalChunks = Math.ceil(message.length / chunkSize);
    let lastSequence = 0;

    for (let i = 0; i < totalChunks; i++) {
      const chunk = message.subarray(i * chunkSize, (i + 1) * chunkSize);
      const envelope = JSON.stringify({
        _chunked: true,
        _chunkIndex: i,
        _totalChunks: totalChunks,
        _data: chunk.toString('base64'),
      });

      const txResponse = await new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(Buffer.from(envelope))
        .execute(this.client);

      const receipt = await txResponse.getReceipt(this.client);
      lastSequence = Number(receipt.topicSequenceNumber);
    }

    return lastSequence;
  }

  subscribeTopic(
    topicId: string,
    callback: (message: { contents: Buffer; sequenceNumber: number; consensusTimestamp: unknown }) => void,
    startTime?: Date
  ): void {
    const query = new TopicMessageQuery()
      .setTopicId(TopicId.fromString(topicId));

    if (startTime) {
      query.setStartTime(startTime);
    }

    const handle = query.subscribe(this.client, (error) => {
      if (error) {
        this.emit('error', { topicId, error });
      }
    }, (message) => {
      callback({
        contents: Buffer.from(message.contents),
        sequenceNumber: Number(message.sequenceNumber),
        consensusTimestamp: message.consensusTimestamp,
      });
    });

    this.subscriptions.set(topicId, { unsubscribe: () => handle.unsubscribe() });
  }

  unsubscribeTopic(topicId: string): void {
    const sub = this.subscriptions.get(topicId);
    if (sub) {
      sub.unsubscribe();
      this.subscriptions.delete(topicId);
    }
  }

  async getTopicInfo(topicId: string): Promise<{ memo: string; sequenceNumber: number }> {
    const info = await new TopicInfoQuery()
      .setTopicId(TopicId.fromString(topicId))
      .execute(this.client);

    return {
      memo: info.topicMemo,
      sequenceNumber: Number(info.sequenceNumber),
    };
  }

  async transferHbar(toAccountId: string, amount: number): Promise<string> {
    const txResponse = await new TransferTransaction()
      .addHbarTransfer(this.operatorAccountId, new Hbar(-amount))
      .addHbarTransfer(AccountId.fromString(toAccountId), new Hbar(amount))
      .execute(this.client);

    const receipt = await txResponse.getReceipt(this.client);
    return receipt.status.toString();
  }

  async createAccount(initialBalance: number = 10): Promise<{ accountId: string; privateKey: string }> {
    const newKey = PrivateKey.generateED25519();

    const txResponse = await new AccountCreateTransaction()
      .setKey(newKey.publicKey)
      .setInitialBalance(new Hbar(initialBalance))
      .execute(this.client);

    const receipt = await txResponse.getReceipt(this.client);

    if (!receipt.accountId) {
      throw new Error('Failed to create account');
    }

    return {
      accountId: receipt.accountId.toString(),
      privateKey: newKey.toStringRaw(),
    };
  }

  close(): void {
    for (const [topicId] of this.subscriptions) {
      this.unsubscribeTopic(topicId);
    }
    this.client.close();
  }
}
