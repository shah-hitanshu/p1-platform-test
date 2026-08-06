/**
 * Broker Login Transaction Durable Object Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cloudflare:workers DurableObject base class
vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import { BrokerTransaction } from '../../../src/durable-objects/broker-transaction.js';
import { readJson } from '../../helpers/http';

function createMockDurableObjectState(id: string): DurableObjectState {
  const storage = new Map<string, unknown>();
  let alarmTime: number | null = null;

  return {
    id: { toString: () => id, equals: () => false, name: id },
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => { storage.set(key, value); }),
      delete: vi.fn(async (key: string) => { storage.delete(key); return true; }),
      deleteAll: vi.fn(async () => { storage.clear(); return 0; }),
      list: vi.fn(),
      getAlarm: vi.fn(async () => alarmTime),
      setAlarm: vi.fn(async (time: number) => { alarmTime = time; }),
      deleteAlarm: vi.fn(async () => { alarmTime = null; }),
      transaction: vi.fn(),
      sync: vi.fn(),
    } as unknown as DurableObjectStorage,
    blockConcurrencyWhile: vi.fn(async (callback: () => Promise<void>) => callback()),
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState;
}

describe('BrokerTransaction Durable Object', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
  });

  describe('create', () => {
    it('creates a transaction with pending status', async () => {
      const state = createMockDurableObjectState('tx-123');
      const doInstance = new BrokerTransaction(state, {});

      const request = new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-123', siteId: 'site-123', siteApiTokenId: 'token-id-456' }),
      });

      const response = await doInstance.fetch(request);
      const tx = await readJson(response);

      expect(tx.id).toBe('tx-123');
      expect(tx.siteId).toBe('site-123');
      expect(tx.siteApiTokenId).toBe('token-id-456');
      expect(tx.status).toBe('pending');
    });

    it('sets expiry to 5 minutes from creation', async () => {
      const state = createMockDurableObjectState('tx-456');
      const doInstance = new BrokerTransaction(state, {});

      const request = new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-123', siteId: 'site-123', siteApiTokenId: 'token-id-456' }),
      });

      const response = await doInstance.fetch(request);
      const tx: { expiresAt: number; createdAt: number } = await readJson(response);

      expect(tx.expiresAt).toBe(tx.createdAt + 300);
    });

    it('sets alarm for auto-cleanup after 5 minutes', async () => {
      const state = createMockDurableObjectState('tx-789');
      const doInstance = new BrokerTransaction(state, {});

      const request = new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-123', siteId: 'site-123', siteApiTokenId: 'token-id-456' }),
      });

      await doInstance.fetch(request);

      expect(state.storage.setAlarm).toHaveBeenCalledWith(Date.now() + 300_000);
    });

    it('stores redirectUrl when provided', async () => {
      const state = createMockDurableObjectState('tx-redirect');
      const doInstance = new BrokerTransaction(state, {});

      const request = new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txId: 'tx-redirect',
          siteId: 'site-123',
          siteApiTokenId: 'token-id-456',
          options: { redirectUrl: 'https://myapp.example.com/p1/editor' },
        }),
      });

      const response = await doInstance.fetch(request);
      const tx = await readJson(response);

      expect(tx.redirectUrl).toBe('https://myapp.example.com/p1/editor');
    });

    it('leaves redirectUrl undefined when not provided', async () => {
      const state = createMockDurableObjectState('tx-no-redirect');
      const doInstance = new BrokerTransaction(state, {});

      const request = new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-123', siteId: 'site-123', siteApiTokenId: 'token-id-456' }),
      });

      const response = await doInstance.fetch(request);
      const tx = await readJson(response);

      expect(tx.redirectUrl).toBeUndefined();
    });
  });

  describe('get', () => {
    it('returns null for non-existent transaction', async () => {
      const state = createMockDurableObjectState('tx-empty');
      const doInstance = new BrokerTransaction(state, {});

      const request = new Request('http://do/get');
      const response = await doInstance.fetch(request);
      const tx = await readJson(response);

      expect(tx).toBeNull();
    });

    it('retrieves a created transaction', async () => {
      const state = createMockDurableObjectState('tx-retrieve');
      const doInstance = new BrokerTransaction(state, {});

      await doInstance.fetch(new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-retrieve', siteId: 'site-123', siteApiTokenId: 'tok-1' }),
      }));

      const getRequest = new Request('http://do/get');
      const response = await doInstance.fetch(getRequest);
      const tx = await readJson(response);

      expect(tx).not.toBeNull();
      expect(tx.id).toBe('tx-retrieve');
      expect(tx.siteId).toBe('site-123');
      expect(tx.status).toBe('pending');
    });
  });

  describe('approve', () => {
    it('updates status to approved and binds user info', async () => {
      const state = createMockDurableObjectState('tx-approve');
      const doInstance = new BrokerTransaction(state, {});

      await doInstance.fetch(new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-retrieve', siteId: 'site-123', siteApiTokenId: 'tok-1' }),
      }));

      const approveRequest = new Request('http://do/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'auth0|user-1',
          userEmail: 'user@example.com',
          userName: 'Test User',
        }),
      });

      const response = await doInstance.fetch(approveRequest);
      const approved = await readJson(response);

      expect(approved).not.toBeNull();
      expect(approved.status).toBe('approved');
      expect(approved.userId).toBe('auth0|user-1');
      expect(approved.userEmail).toBe('user@example.com');
      expect(approved.userName).toBe('Test User');
    });

    it('returns null for non-existent transaction', async () => {
      const state = createMockDurableObjectState('tx-no-approve');
      const doInstance = new BrokerTransaction(state, {});

      const approveRequest = new Request('http://do/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'auth0|user-1',
          userEmail: 'user@example.com',
        }),
      });

      const response = await doInstance.fetch(approveRequest);
      const result = await readJson(response);

      expect(result).toBeNull();
    });

    it('returns null if transaction is not in pending status', async () => {
      const state = createMockDurableObjectState('tx-double-approve');
      const doInstance = new BrokerTransaction(state, {});

      await doInstance.fetch(new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-retrieve', siteId: 'site-123', siteApiTokenId: 'tok-1' }),
      }));

      await doInstance.fetch(new Request('http://do/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'auth0|user-1',
          userEmail: 'user@example.com',
        }),
      }));

      const secondApprove = new Request('http://do/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'auth0|user-2',
          userEmail: 'user2@example.com',
        }),
      });

      const response = await doInstance.fetch(secondApprove);
      const result = await readJson(response);

      expect(result).toBeNull();
    });

    it('returns null if transaction has expired', async () => {
      const state = createMockDurableObjectState('tx-expired');
      const doInstance = new BrokerTransaction(state, {});

      await doInstance.fetch(new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-retrieve', siteId: 'site-123', siteApiTokenId: 'tok-1' }),
      }));

      vi.setSystemTime(new Date('2026-05-07T12:06:00Z'));

      const approveRequest = new Request('http://do/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'auth0|user-1',
          userEmail: 'user@example.com',
        }),
      });

      const response = await doInstance.fetch(approveRequest);
      const result = await readJson(response);

      expect(result).toBeNull();
    });
  });

  describe('redeem', () => {
    it('returns approved transaction data and marks as redeemed', async () => {
      const state = createMockDurableObjectState('tx-redeem');
      const doInstance = new BrokerTransaction(state, {});

      await doInstance.fetch(new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-retrieve', siteId: 'site-123', siteApiTokenId: 'tok-1' }),
      }));

      await doInstance.fetch(new Request('http://do/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'auth0|user-1',
          userEmail: 'user@example.com',
          userName: 'Test User',
        }),
      }));

      const redeemRequest = new Request('http://do/redeem', { method: 'POST' });
      const response = await doInstance.fetch(redeemRequest);
      const redeemed = await readJson(response);

      expect(redeemed).not.toBeNull();
      expect(redeemed.status).toBe('redeemed');
      expect(redeemed.userId).toBe('auth0|user-1');
      expect(redeemed.siteId).toBe('site-123');
    });

    it('returns null for non-existent transaction', async () => {
      const state = createMockDurableObjectState('tx-no-redeem');
      const doInstance = new BrokerTransaction(state, {});

      const redeemRequest = new Request('http://do/redeem', { method: 'POST' });
      const response = await doInstance.fetch(redeemRequest);
      const result = await readJson(response);

      expect(result).toBeNull();
    });

    it('returns null if transaction is still pending (not yet approved)', async () => {
      const state = createMockDurableObjectState('tx-pending-redeem');
      const doInstance = new BrokerTransaction(state, {});

      await doInstance.fetch(new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-retrieve', siteId: 'site-123', siteApiTokenId: 'tok-1' }),
      }));

      const redeemRequest = new Request('http://do/redeem', { method: 'POST' });
      const response = await doInstance.fetch(redeemRequest);
      const result = await readJson(response);

      expect(result).toBeNull();
    });

    it('is idempotent - allows redeeming an already-redeemed transaction', async () => {
      const state = createMockDurableObjectState('tx-idempotent');
      const doInstance = new BrokerTransaction(state, {});

      await doInstance.fetch(new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-retrieve', siteId: 'site-123', siteApiTokenId: 'tok-1' }),
      }));

      await doInstance.fetch(new Request('http://do/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'auth0|user-1',
          userEmail: 'user@example.com',
        }),
      }));

      const redeemRequest = new Request('http://do/redeem', { method: 'POST' });
      const firstResponse = await doInstance.fetch(redeemRequest);
      const firstRedeemed = await firstResponse.json();

      const secondResponse = await doInstance.fetch(new Request('http://do/redeem', { method: 'POST' }));
      const secondRedeemed = await secondResponse.json();

      expect(firstRedeemed).not.toBeNull();
      expect(secondRedeemed).not.toBeNull();
      expect(secondRedeemed.status).toBe('redeemed');
    });

    it('sets alarm for cleanup 60 seconds after redemption', async () => {
      const state = createMockDurableObjectState('tx-cleanup');
      const doInstance = new BrokerTransaction(state, {});

      await doInstance.fetch(new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-retrieve', siteId: 'site-123', siteApiTokenId: 'tok-1' }),
      }));

      await doInstance.fetch(new Request('http://do/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'auth0|user-1',
          userEmail: 'user@example.com',
        }),
      }));

      vi.mocked(state.storage.setAlarm).mockClear();

      const redeemRequest = new Request('http://do/redeem', { method: 'POST' });
      await doInstance.fetch(redeemRequest);

      expect(state.storage.setAlarm).toHaveBeenCalledWith(Date.now() + 60_000);
    });
  });

  describe('alarm', () => {
    it('clears transaction on alarm', async () => {
      const state = createMockDurableObjectState('tx-alarm');
      const doInstance = new BrokerTransaction(state, {});

      await doInstance.fetch(new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-retrieve', siteId: 'site-123', siteApiTokenId: 'tok-1' }),
      }));

      await doInstance.alarm();

      const getRequest = new Request('http://do/get');
      const response = await doInstance.fetch(getRequest);
      const tx = await readJson(response);

      expect(tx).toBeNull();
    });
  });

  describe('input validation', () => {
    it('rejects oversized txId in create', async () => {
      const state = createMockDurableObjectState('tx-validate');
      const doInstance = new BrokerTransaction(state, {});

      const request = new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txId: 'x'.repeat(65), // Exceeds MAX_TX_ID_LENGTH (64)
          siteId: 'site-123',
          siteApiTokenId: 'tok-1',
        }),
      });

      const response = await doInstance.fetch(request);
      expect(response.status).toBe(500);
      const error = await readJson(response);
      expect(error.error).toBe('txId exceeds maximum length of 64');
    });

    it('rejects oversized siteId in create', async () => {
      const state = createMockDurableObjectState('tx-validate-site');
      const doInstance = new BrokerTransaction(state, {});

      const request = new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txId: 'tx-ok',
          siteId: 'x'.repeat(129), // Exceeds MAX_SITE_ID_LENGTH (128)
          siteApiTokenId: 'tok-1',
        }),
      });

      const response = await doInstance.fetch(request);
      expect(response.status).toBe(500);
      const error = await readJson(response);
      expect(error.error).toBe('siteId exceeds maximum length of 128');
    });

    it('rejects oversized email in approve', async () => {
      const state = createMockDurableObjectState('tx-validate-email');
      const doInstance = new BrokerTransaction(state, {});

      await doInstance.fetch(new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: 'tx-email', siteId: 'site-123', siteApiTokenId: 'tok-1' }),
      }));

      const approveRequest = new Request('http://do/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-1',
          userEmail: 'x'.repeat(321) + '@example.com', // Exceeds MAX_EMAIL_LENGTH (320)
        }),
      });

      const response = await doInstance.fetch(approveRequest);
      expect(response.status).toBe(500);
      const error = await readJson(response);
      expect(error.error).toBe('userEmail exceeds maximum length of 320');
    });

    it('rejects oversized redirectUrl in create', async () => {
      const state = createMockDurableObjectState('tx-validate-url');
      const doInstance = new BrokerTransaction(state, {});

      const request = new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txId: 'tx-url',
          siteId: 'site-123',
          siteApiTokenId: 'tok-1',
          options: {
            redirectUrl: 'https://example.com/' + 'x'.repeat(2049), // Exceeds MAX_URL_LENGTH (2048)
          },
        }),
      });

      const response = await doInstance.fetch(request);
      expect(response.status).toBe(500);
      const error = await readJson(response);
      expect(error.error).toBe('redirectUrl exceeds maximum length of 2048');
    });

    it('accepts valid inputs within limits', async () => {
      const state = createMockDurableObjectState('tx-validate-ok');
      const doInstance = new BrokerTransaction(state, {});

      const request = new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txId: 'a'.repeat(64), // At MAX_TX_ID_LENGTH limit
          siteId: 'b'.repeat(128), // At MAX_SITE_ID_LENGTH limit
          siteApiTokenId: 'c'.repeat(64), // At MAX_TX_ID_LENGTH limit
          options: {
            redirectUrl: 'https://example.com/path', // Well under limit
          },
        }),
      });

      const response = await doInstance.fetch(request);
      expect(response.status).toBe(200);
      const tx = await readJson(response);
      expect(tx.id).toBe('a'.repeat(64));
    });
  });
});
