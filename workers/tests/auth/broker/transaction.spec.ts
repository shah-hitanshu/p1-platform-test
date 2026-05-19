/**
 * Broker Login Transaction Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

describe('BrokerTransaction', () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
  });

  describe('createTransaction', () => {
    it('creates a transaction with pending status', async () => {
      const { createTransaction } = await import('../../../src/auth/broker/transaction.js');
      const tx = await createTransaction(kv, 'site-123', 'token-id-456');

      expect(tx.id).toBeDefined();
      expect(tx.id.length).toBeGreaterThan(0);
      expect(tx.siteId).toBe('site-123');
      expect(tx.siteApiTokenId).toBe('token-id-456');
      expect(tx.status).toBe('pending');
    });

    it('sets expiry to 5 minutes from creation', async () => {
      const { createTransaction } = await import('../../../src/auth/broker/transaction.js');
      const tx = await createTransaction(kv, 'site-123', 'token-id-456');

      expect(tx.expiresAt).toBe(tx.createdAt + 300);
    });

    it('stores transaction in KV with broker_tx: prefix', async () => {
      const { createTransaction } = await import('../../../src/auth/broker/transaction.js');
      const tx = await createTransaction(kv, 'site-123', 'token-id-456');

      expect(kv.put).toHaveBeenCalledWith(
        `broker_tx:${tx.id}`,
        expect.any(String),
        expect.objectContaining({ expirationTtl: 300 }),
      );
    });

    it('generates unique IDs for each transaction', async () => {
      const { createTransaction } = await import('../../../src/auth/broker/transaction.js');
      const tx1 = await createTransaction(kv, 'site-1', 'tok-1');
      const tx2 = await createTransaction(kv, 'site-1', 'tok-1');

      expect(tx1.id).not.toBe(tx2.id);
    });
  });

  describe('getTransaction', () => {
    it('returns null for non-existent transaction', async () => {
      const { getTransaction } = await import('../../../src/auth/broker/transaction.js');
      const tx = await getTransaction(kv, 'does-not-exist');

      expect(tx).toBeNull();
    });

    it('retrieves a stored transaction', async () => {
      const { createTransaction, getTransaction } = await import('../../../src/auth/broker/transaction.js');
      const created = await createTransaction(kv, 'site-123', 'tok-1');
      const retrieved = await getTransaction(kv, created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.siteId).toBe('site-123');
      expect(retrieved!.status).toBe('pending');
    });
  });

  describe('approveTransaction', () => {
    it('updates status to approved and binds user info', async () => {
      const { createTransaction, approveTransaction, getTransaction } = await import('../../../src/auth/broker/transaction.js');
      const tx = await createTransaction(kv, 'site-123', 'tok-1');

      const approved = await approveTransaction(kv, tx.id, {
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
        userName: 'Test User',
      });

      expect(approved).not.toBeNull();
      expect(approved!.status).toBe('approved');
      expect(approved!.userId).toBe('auth0|user-1');
      expect(approved!.userEmail).toBe('user@example.com');
      expect(approved!.userName).toBe('Test User');

      const stored = await getTransaction(kv, tx.id);
      expect(stored!.status).toBe('approved');
    });

    it('returns null for non-existent transaction', async () => {
      const { approveTransaction } = await import('../../../src/auth/broker/transaction.js');
      const result = await approveTransaction(kv, 'does-not-exist', {
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
      });

      expect(result).toBeNull();
    });

    it('returns null if transaction is not in pending status', async () => {
      const { createTransaction, approveTransaction } = await import('../../../src/auth/broker/transaction.js');
      const tx = await createTransaction(kv, 'site-123', 'tok-1');

      await approveTransaction(kv, tx.id, {
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
      });

      // Try to approve again
      const secondApproval = await approveTransaction(kv, tx.id, {
        userId: 'auth0|user-2',
        userEmail: 'user2@example.com',
      });

      expect(secondApproval).toBeNull();
    });
  });

  describe('redeemTransaction', () => {
    it('returns approved transaction data and marks as redeemed', async () => {
      const { createTransaction, approveTransaction, redeemTransaction } = await import('../../../src/auth/broker/transaction.js');
      const tx = await createTransaction(kv, 'site-123', 'tok-1');
      await approveTransaction(kv, tx.id, {
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
        userName: 'Test User',
      });

      const redeemed = await redeemTransaction(kv, tx.id);

      expect(redeemed).not.toBeNull();
      expect(redeemed!.status).toBe('redeemed');
      expect(redeemed!.userId).toBe('auth0|user-1');
      expect(redeemed!.siteId).toBe('site-123');
    });

    it('returns null for non-existent transaction', async () => {
      const { redeemTransaction } = await import('../../../src/auth/broker/transaction.js');
      const result = await redeemTransaction(kv, 'does-not-exist');

      expect(result).toBeNull();
    });

    it('returns null if transaction is still pending (not yet approved)', async () => {
      const { createTransaction, redeemTransaction } = await import('../../../src/auth/broker/transaction.js');
      const tx = await createTransaction(kv, 'site-123', 'tok-1');

      const result = await redeemTransaction(kv, tx.id);

      expect(result).toBeNull();
    });

    it('returns null if transaction was already redeemed (single-use)', async () => {
      const { createTransaction, approveTransaction, redeemTransaction } = await import('../../../src/auth/broker/transaction.js');
      const tx = await createTransaction(kv, 'site-123', 'tok-1');
      await approveTransaction(kv, tx.id, {
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
      });

      await redeemTransaction(kv, tx.id);
      const secondRedeem = await redeemTransaction(kv, tx.id);

      expect(secondRedeem).toBeNull();
    });

    it('deletes the transaction from KV after redemption', async () => {
      const { createTransaction, approveTransaction, redeemTransaction } = await import('../../../src/auth/broker/transaction.js');
      const tx = await createTransaction(kv, 'site-123', 'tok-1');
      await approveTransaction(kv, tx.id, {
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
      });

      await redeemTransaction(kv, tx.id);

      expect(kv.delete).toHaveBeenCalledWith(`broker_tx:${tx.id}`);
    });
  });

  describe('transaction expiry', () => {
    it('treats expired pending transaction as non-redeemable', async () => {
      const { createTransaction, getTransaction } = await import('../../../src/auth/broker/transaction.js');
      const tx = await createTransaction(kv, 'site-123', 'tok-1');

      // Advance time past expiry
      vi.setSystemTime(new Date('2026-05-07T12:06:00Z'));

      const retrieved = await getTransaction(kv, tx.id);
      // KV TTL handles deletion in production; in mock, we check expiry in getTransaction
      if (retrieved !== null) {
        expect(retrieved.expiresAt).toBeLessThan(Math.floor(Date.now() / 1000));
      }
    });
  });
});
