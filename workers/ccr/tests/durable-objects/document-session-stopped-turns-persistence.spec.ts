/**
 * PCC-3993: a stop recorded before a DO is evicted must still be there when it
 * wakes up — that's the whole point of persisting it.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

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
  id: { toString: () => string; name: string };
  storage: MockDurableObjectStorage;
  blockConcurrencyWhile: Mock<(callback: () => Promise<void>) => Promise<void>>;
  acceptWebSocket: Mock;
  getWebSockets: Mock;
}

function createMockState(sessionId = 'aaaaaaaa-0000-4000-8000-000000000002:bbbbbbbb-0000-4000-8000-000000000002:cccccccc-0000-4000-8000-000000000002'): MockDurableObjectState {
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
    id: { toString: () => sessionId, name: sessionId },
    storage,
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    }),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn().mockReturnValue([]),
  };
}

interface MockEnv {
  API_URL: string;
  ENVIRONMENT: string;
}

function createMockEnv(): MockEnv {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
  };
}

describe('PCC-3993: stopped-turn persistence on DocumentSession', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** An agent write, which is what a restored bar has to refuse. */
  function applyAs(turnId: string): Request {
    return new Request('http://localhost/apply', {
      method: 'POST',
      headers: {
        'X-Agent-Turn-Id': turnId,
        'X-Actor-Type': 'agent',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: 'agent-123',
        operations: [{ type: 'set', path: 'title', value: 'Should not apply' }],
      }),
    });
  }

  /** A fresh construction over the same backing storage is the hibernation wake cycle. */
  async function wake(mockState: MockDurableObjectState): Promise<{ fetch: (req: Request) => Promise<Response> }> {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    return new DocumentSession(mockState, createMockEnv());
  }

  it('bars the restored turn and only that turn', async () => {
    const { serializeStoppedTurns } = await import('../../src/durable-objects/stopped-turns');
    const { STOPPED_TURNS_STORAGE_KEY } = await import('../../src/durable-objects/document-session-types');

    const mockState = createMockState();
    await mockState.storage.put(
      STOPPED_TURNS_STORAGE_KEY,
      serializeStoppedTurns(new Map([['turn-1', Date.now()]])),
    );

    const session = await wake(mockState);

    const barred = await session.fetch(applyAs('turn-1'));
    expect(barred.status).toBe(409);
    expect(await barred.json()).toMatchObject({ code: 'agent_turn_stopped' });

    // The half that a "was storage read?" assertion cannot see: restoring a bar for one
    // turn must not bar every turn.
    const other = await session.fetch(applyAs('turn-2'));
    expect(other.status).not.toBe(409);
  });
});
