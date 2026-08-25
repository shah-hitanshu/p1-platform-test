/**
 * WebSocket publish and the pre-publish flush attribute to the connection's
 * resolved `dbUserId` (app.users.id), not the OAuth-subject-shaped `actorId` —
 * a subject in a uuid `created_by_id` column fails the cast. When no dbUserId
 * is present (agents, or an unresolved principal) attribution falls back to
 * actorId.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as Y from 'yjs';

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

const RAW_SUBJECT = 'google-oauth2|107221644627712432289';
const DB_USER_ID = '02588e62-6dd1-545c-88c4-9a127fafba3f';

interface MockStorage {
  get: Mock;
  put: Mock;
  delete: Mock;
  list: Mock;
  getAlarm: Mock;
  setAlarm: Mock;
}

function createMockState(sessionId = 'site-1:doc-1:branch-1'): {
  id: { toString: () => string; name: string };
  storage: MockStorage;
  blockConcurrencyWhile: Mock;
  acceptWebSocket: Mock;
  getWebSockets: Mock;
} {
  const data = new Map<string, unknown>();
  const storage: MockStorage = {
    get: vi.fn().mockImplementation((k: string) => Promise.resolve(data.get(k))),
    put: vi.fn().mockImplementation((k: string, v: unknown) => {
      data.set(k, v);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((k: string) => Promise.resolve(data.delete(k))),
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

function createEnv(): Record<string, unknown> {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
  };
}

function createWebSocket(attachment: Record<string, unknown>): WebSocket {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(true),
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    binaryType: 'arraybuffer' as BinaryType,
    _attachment: attachment,
    serializeAttachment(value: unknown): void {
      (this as { _attachment: unknown })._attachment = structuredClone(value);
    },
    deserializeAttachment(): unknown {
      return (this as { _attachment: unknown })._attachment;
    },
  } as unknown as WebSocket;
}

function bodyOf(mockFetch: Mock, needle: string): Record<string, unknown> {
  const call = mockFetch.mock.calls.find((c: unknown[]) => {
    const u = c[0];
    const s = typeof u === 'string' ? u : (u as Request).url;
    return s.includes(needle);
  });
  if (call === undefined) throw new Error(`no fetch to ${needle}`);
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

describe('WebSocket publish attribution', () => {
  let mockFetch: Mock;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const s = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (s.includes('/internal/crdt-state')) return Promise.resolve(new Response(null, { status: 404 }));
      if (s.includes('/internal/crdt-sync')) {
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      }
      if (s.includes('/internal/publish')) {
        return Promise.resolve(new Response(JSON.stringify({
          checkpoint: { id: 'cp-1' },
          publishedVersionId: 'v-1',
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  async function publishAs(attachment: Record<string, unknown>): Promise<void> {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const mockState = createMockState();
    const session = new DocumentSession(mockState, createEnv());
    await session.fetch(new Request('http://localhost/snapshot'));

    const sender = createWebSocket(attachment);
    mockState.getWebSockets.mockReturnValue([sender]);

    const doc = new Y.Doc();
    doc.getMap('root').set('title', 'Test');
    await session.webSocketMessage(sender, Y.encodeStateAsUpdate(doc).buffer);

    await session.webSocketMessage(sender, JSON.stringify({
      type: 'publish_request',
      requestId: 'req-1',
      timestamp: Date.now(),
    }));
  }

  it('sends the resolved dbUserId as createdById, never the raw subject', async () => {
    await publishAs({ actorId: RAW_SUBJECT, actorType: 'user', dbUserId: DB_USER_ID });

    const publishBody = bodyOf(mockFetch, '/internal/publish');
    expect(publishBody.createdById).toBe(DB_USER_ID);
    expect(publishBody.createdById).not.toBe(RAW_SUBJECT);
  });

  it('flushes the pre-publish sync attributed to dbUserId', async () => {
    await publishAs({ actorId: RAW_SUBJECT, actorType: 'user', dbUserId: DB_USER_ID });

    const syncBody = bodyOf(mockFetch, '/internal/crdt-sync');
    expect(syncBody.actorId).toBe(DB_USER_ID);
    expect(syncBody.actorId).not.toBe(RAW_SUBJECT);
  });

  it('falls back to actorId when no dbUserId is present (agent / unresolved)', async () => {
    const AGENT_ID = '33333333-3333-3333-3333-333333333333';
    await publishAs({ actorId: AGENT_ID, actorType: 'agent' });

    const publishBody = bodyOf(mockFetch, '/internal/publish');
    expect(publishBody.createdById).toBe(AGENT_ID);
  });
});
