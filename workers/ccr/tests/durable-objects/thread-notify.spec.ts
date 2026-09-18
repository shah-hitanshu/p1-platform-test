/**
 * A comment on a document reaches every editor with that document open through
 * the session's sockets, without the session having to load the content first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';

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

const SESSION_ID = [
  'aaaaaaaa-0000-4000-8000-000000000001',
  'bbbbbbbb-0000-4000-8000-000000000001',
  'cccccccc-0000-4000-8000-000000000001',
].join(':');

const WS_OPEN = 1;
const WS_CLOSED = 3;

function fakeSocket(readyState: number) {
  return { readyState, send: vi.fn() };
}

function createMockState(sockets: ReturnType<typeof fakeSocket>[]) {
  const storageData = new Map<string, unknown>();
  return {
    id: { toString: (): string => SESSION_ID, name: SESSION_ID },
    storage: {
      get: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.get(key))),
      put: vi.fn().mockImplementation((key: string, value: unknown) => {
        storageData.set(key, value);
        return Promise.resolve();
      }),
      delete: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.delete(key))),
      list: vi.fn().mockResolvedValue(new Map()),
      getAlarm: vi.fn().mockResolvedValue(null),
      setAlarm: vi.fn().mockResolvedValue(undefined),
    },
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => { await cb(); }),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn().mockReturnValue(sockets),
  };
}

const ENV = {
  API_URL: 'http://localhost:8787',
  ENVIRONMENT: 'test',
  INTERNAL_API_URL: 'https://internal.example.com',
  INTERNAL_SECRET: 'secret',
};

const message = {
  type: 'thread_event',
  event: {
    type: 'comment_posted',
    siteId: 'aaaaaaaa-0000-4000-8000-000000000001',
    thread: { id: 'thread-1', documentId: 'bbbbbbbb-0000-4000-8000-000000000001' },
    comment: { id: 'comment-1', threadId: 'thread-1' },
  },
  timestamp: 1234,
};

function notify(body: unknown, method = 'POST'): Request {
  return new Request('http://localhost/notify', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': SESSION_ID },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

describe('POST /notify on a document session', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('content must not be loaded for this'));
  });

  it('forwards the message to every open socket and skips closed ones', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const open1 = fakeSocket(WS_OPEN);
    const closed = fakeSocket(WS_CLOSED);
    const open2 = fakeSocket(WS_OPEN);
    const session = new DocumentSession(createMockState([open1, closed, open2]), ENV);

    const response = await session.fetch(notify(message));

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ delivered: 2 });
    expect(open1.send).toHaveBeenCalledWith(JSON.stringify(message));
    expect(open2.send).toHaveBeenCalledWith(JSON.stringify(message));
    expect(closed.send).not.toHaveBeenCalled();
  });

  it('does not load the document content to relay a comment', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(createMockState([fakeSocket(WS_OPEN)]), ENV);

    const response = await session.fetch(notify(message));

    expect(response.status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects anything but a thread event, and anything but POST', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const socket = fakeSocket(WS_OPEN);
    const session = new DocumentSession(createMockState([socket]), ENV);

    expect((await session.fetch(notify('not json'))).status).toBe(400);
    expect((await session.fetch(notify({ type: 'presence_update', actors: [] }))).status).toBe(400);
    expect((await session.fetch(notify({ type: 'thread_event', event: { type: 'bogus' } }))).status).toBe(400);
    expect((await session.fetch(notify(undefined, 'GET'))).status).toBe(405);
    expect(socket.send).not.toHaveBeenCalled();
  });
});
