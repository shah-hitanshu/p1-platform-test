/**
 * BrokerTransaction guards against values its types say are impossible.
 *
 * Both cases below are trust boundaries where the static type is optimistic:
 * Auth0 ID token claims are cast wholesale with only `sub` and `email` checked,
 * and Durable Object storage is deserialized through a generic that asserts a
 * shape rather than verifying one. Type-aware lint reads the optimistic types
 * and calls the runtime checks redundant, so these tests exist to fail if the
 * checks are removed again.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

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

const { BrokerTransaction } = await import('../../src/durable-objects/broker-transaction');

interface MockState {
  id: { toString: () => string; name: string };
  storage: {
    get: Mock<(key: string) => Promise<unknown>>;
    put: Mock<(key: string, value: unknown) => Promise<void>>;
    delete: Mock<(key: string) => Promise<boolean>>;
    getAlarm: Mock<() => Promise<number | null>>;
    setAlarm: Mock<(scheduledTime: number) => Promise<void>>;
    deleteAlarm: Mock<() => Promise<void>>;
  };
}

function createMockState(seed?: Map<string, unknown>): MockState {
  const data = seed ?? new Map<string, unknown>();
  return {
    id: { toString: () => 'tx-1', name: 'tx-1' },
    storage: {
      get: vi.fn((key: string) => Promise.resolve(data.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        data.set(key, value);
        return Promise.resolve();
      }),
      delete: vi.fn((key: string) => Promise.resolve(data.delete(key))),
      getAlarm: vi.fn(() => Promise.resolve(null)),
      setAlarm: vi.fn(() => Promise.resolve()),
      deleteAlarm: vi.fn(() => Promise.resolve()),
    },
  };
}

function createDO(state: MockState): InstanceType<typeof BrokerTransaction> {
  return new BrokerTransaction(
    state as unknown as DurableObjectState,
    {},
  );
}

describe('BrokerTransaction with untrusted input', () => {
  let state: MockState;

  beforeEach(() => {
    state = createMockState();
  });

  it('approves when an Auth0 claim arrives as null rather than absent', async () => {
    const tx = createDO(state);
    await tx.create('tx-1', 'site-1', 'token-1');

    // `userName?: string` per the type; null in practice, since a null `name`
    // claim survives both the unchecked cast and JSON.stringify across the DO
    // boundary. Reading `.length` off it throws and 500s /auth/callback.
    const approved = await tx.approve({
      userId: 'auth0|abc',
      userEmail: 'someone@example.com',
      userName: null as unknown as string,
    });

    expect(approved).not.toBeNull();
    expect(approved?.status).toBe('approved');
  });

  it('still enforces the length limit on a present field', async () => {
    const tx = createDO(state);
    await tx.create('tx-1', 'site-1', 'token-1');

    await expect(
      tx.approve({
        userId: 'auth0|abc',
        userEmail: 'someone@example.com',
        userName: 'x'.repeat(257),
      }),
    ).rejects.toThrow(/userName exceeds maximum length/);
  });

  it('ignores a stored value that is not an object', async () => {
    const seeded = createMockState(new Map<string, unknown>([['transaction', 'not-a-transaction']]));
    const tx = createDO(seeded);

    // The generic on `storage.get` would hand this straight through as a
    // LoginTransaction, so the failure would surface somewhere else entirely.
    await expect(tx.get()).resolves.toBeNull();
  });

  it('restores a well-formed stored transaction', async () => {
    const stored = {
      id: 'tx-1',
      siteId: 'site-1',
      siteApiTokenId: 'token-1',
      status: 'pending',
      createdAt: 1,
      expiresAt: 2 ** 31,
    };
    const seeded = createMockState(new Map<string, unknown>([['transaction', stored]]));

    await expect(createDO(seeded).get()).resolves.toMatchObject({ id: 'tx-1', status: 'pending' });
  });
});
