/**
 * PCC-3458 (review should-fix 1): DO-side session-identity guard.
 *
 * WHY (Rule 9): route-level branch-ref resolution is the fix; this guard is
 * defense-in-depth that turns any future regression (a caller keying a DO
 * with a non-UUID ref) into a loud 400 instead of a silent orphan DO that
 * initializes empty, accepts client state, and can never persist (the
 * PCC-3464 incident's failure mode A). It deliberately also serves
 * PCC-3459's "refuse to initialize on a bad ref" ask. It must be
 * unreachable for traffic that went through route-level resolution.
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

interface MockDurableObjectStorage {
  get: Mock<(key: string) => Promise<unknown>>;
  put: Mock<(key: string, value: unknown) => Promise<void>>;
  delete: Mock<(key: string) => Promise<boolean>>;
  list: Mock<() => Promise<Map<string, unknown>>>;
  getAlarm: Mock<() => Promise<number | null>>;
  setAlarm: Mock<(scheduledTime: number) => Promise<void>>;
}

interface MockDurableObjectState {
  id: { toString: () => string; name: string | undefined };
  storage: MockDurableObjectStorage;
  blockConcurrencyWhile: Mock<(callback: () => Promise<void>) => Promise<void>>;
  acceptWebSocket: Mock;
  getWebSockets: Mock;
}

const UUID_SESSION =
  'aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001';
const NAME_KEYED_SESSION =
  'aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:main';

function createMockState(sessionId: string | undefined): MockDurableObjectState {
  const storageData = new Map<string, unknown>();
  const storage: MockDurableObjectStorage = {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.get(key))),
    put: vi.fn().mockImplementation((key: string, value: unknown) => {
      storageData.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.delete(key))),
    list: vi.fn().mockResolvedValue(new Map()),
    getAlarm: vi.fn().mockResolvedValue(null),
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };
  return {
    id: { toString: () => sessionId ?? 'unnamed', name: sessionId },
    storage,
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    }),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn().mockReturnValue([]),
  };
}

function createMockEnv(): { API_URL: string; ENVIRONMENT: string } {
  return { API_URL: 'http://localhost:8787', ENVIRONMENT: 'test' };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('PCC-3458: DO refuses non-UUID session identities before any initialization', () => {
  it('returns 400 mentioning PCC-3458 for a name-keyed session and never touches storage', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const mockState = createMockState(NAME_KEYED_SESSION);
    const session = new DocumentSession(mockState, createMockEnv());

    const response = await session.fetch(new Request('http://localhost/snapshot'));

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain('PCC-3458');
    // No CRDT/metadata initialization, no storage writes — the orphan holds nothing.
    expect(mockState.storage.put).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID X-Session-Id on the header fallback path without adopting or persisting it', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    // Miniflare case: state.id.name is undefined, identity comes from header.
    const mockState = createMockState(undefined);
    const session = new DocumentSession(mockState, createMockEnv());

    const response = await session.fetch(
      new Request('http://localhost/snapshot', {
        headers: { 'X-Session-Id': NAME_KEYED_SESSION },
      }),
    );

    expect(response.status).toBe(400);
    expect(mockState.storage.put).not.toHaveBeenCalled();
  });

  it('serves a canonical UUID-keyed session normally (guard is unreachable for resolved traffic)', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const mockState = createMockState(UUID_SESSION);
    const session = new DocumentSession(mockState, createMockEnv());

    const response = await session.fetch(new Request('http://localhost/presences'));

    expect(response.status).toBe(200);
  });
});
