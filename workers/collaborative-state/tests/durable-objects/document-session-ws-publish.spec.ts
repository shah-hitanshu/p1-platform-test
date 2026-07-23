/**
 * DocumentSession WebSocket Publish Handler Tests
 *
 * Tests for the publish_request WebSocket message handler in DocumentSession.
 * When a client sends publish_request via WebSocket, the DO:
 * 1. Flushes CRDT state to PostgreSQL (TCP ordering guarantees latest state)
 * 2. Calls POST /internal/publish to create the checkpoint
 * 3. Sends publish_result back to the client via WebSocket
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as Y from 'yjs';

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

// =============================================================================
// Mock Infrastructure
// =============================================================================

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

function createMockState(sessionId = 'site-1:doc-1:branch-1'): MockDurableObjectState {
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

interface PublishEnv {
  API_URL: string;
  ENVIRONMENT: string;
  INTERNAL_API_URL: string;
  INTERNAL_SECRET: string;
  SYNC_QUEUE?: { send: Mock };
}

function createPublishEnv(overrides: Partial<PublishEnv> = {}): PublishEnv {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
    ...overrides,
  };
}

function createMockWebSocket(actorId = 'user-1'): WebSocket {
  const ws = {
    readyState: WebSocket.OPEN,
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
    bufferedAmount: 0,
    extensions: '',
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    protocol: '',
    url: 'ws://localhost/connect',
    _attachment: { actorId, actorType: 'user' },
    serializeAttachment(value: unknown): void {
      (this as { _attachment: unknown })._attachment = structuredClone(value);
    },
    deserializeAttachment(): unknown {
      return (this as { _attachment: unknown })._attachment;
    },
  } as unknown as WebSocket;
  return ws;
}

function getSentJsonMessages<T>(ws: WebSocket): T[] {
  const sendMock = ws.send as Mock;
  return sendMock.mock.calls
    .map((call: unknown[]) => call[0])
    .filter((data: unknown): data is string => typeof data === 'string')
    .map((data: string) => JSON.parse(data) as T);
}

// =============================================================================
// Tests
// =============================================================================

describe('DocumentSession WebSocket publish handler', () => {
  let mockFetch: Mock;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    originalFetch = globalThis.fetch;

    mockFetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

      if (urlStr.includes('/internal/crdt-state')) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      if (urlStr.includes('/internal/crdt-sync')) {
        return Promise.resolve(new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (urlStr.includes('/internal/publish')) {
        return Promise.resolve(new Response(JSON.stringify({
          checkpoint: {
            id: 'cp-1',
            branchId: 'main-branch',
            name: 'Publish: document',
            checkpointType: 'publish',
            status: 'completed',
            createdById: 'user-1',
            createdByType: 'user',
            createdAt: new Date().toISOString(),
            documentCount: 1,
          },
          publishedVersionId: 'version-xyz',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  // Helper: create a DO, initialize it, and set up a WebSocket
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function createSessionWithWebSocket(
    sessionId = 'site-1:doc-1:branch-1',
    envOverrides: Partial<PublishEnv> = {},
  ) {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const mockState = createMockState(sessionId);
    const env = createPublishEnv(envOverrides);
    const session = new DocumentSession(mockState as unknown, env);

    // Initialize the DO via /snapshot
    await session.fetch(new Request('http://localhost/snapshot'));

    // Create mock WebSocket and register it
    const sender = createMockWebSocket('user-1');
    mockState.getWebSockets.mockReturnValue([sender]);

    return { session, sender, mockState, env };
  }

  it('should handle publish_request and return publish_result on success', async () => {
    const { session, sender } = await createSessionWithWebSocket();

    // Apply an edit so there's state to flush
    const doc = new Y.Doc();
    doc.getMap('root').set('title', 'Test');
    const update = Y.encodeStateAsUpdate(doc);
    await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

    // Clear any messages sent during edit
    (sender.send as Mock).mockClear();

    // Send publish_request
    await session.webSocketMessage(sender, JSON.stringify({
      type: 'publish_request',
      requestId: 'req-123',
      timestamp: Date.now(),
    }));

    const responses = getSentJsonMessages<{
      type: string;
      requestId: string;
      success: boolean;
      publishedVersionId?: string;
      checkpoint?: { id: string };
      error?: string;
    }>(sender);

    const publishResult = responses.find(m => m.type === 'publish_result');
    expect(publishResult).toBeDefined();
    expect(publishResult?.requestId).toBe('req-123');
    expect(publishResult?.success).toBe(true);
    expect(publishResult?.publishedVersionId).toBe('version-xyz');
    expect(publishResult?.checkpoint).toBeDefined();
    expect(publishResult?.checkpoint?.id).toBe('cp-1');
  });

  it('should call /internal/publish with correct session parameters', async () => {
    const { session, sender } = await createSessionWithWebSocket('mySite:myDoc:myBranch');

    // Apply an edit
    const doc = new Y.Doc();
    doc.getMap('root').set('key', 'val');
    await session.webSocketMessage(sender, Y.encodeStateAsUpdate(doc).buffer as ArrayBuffer);

    (sender.send as Mock).mockClear();

    // Send publish_request
    await session.webSocketMessage(sender, JSON.stringify({
      type: 'publish_request',
      requestId: 'req-params',
      timestamp: Date.now(),
    }));

    // Find the /internal/publish fetch call
    const publishCalls = mockFetch.mock.calls.filter((call: unknown[]) => {
      const url = call[0] as string | Request;
      const urlStr = typeof url === 'string' ? url : url.url;
      return urlStr.includes('/internal/publish');
    });

    expect(publishCalls.length).toBeGreaterThanOrEqual(1);

    // The fetch call is (url: string, options: RequestInit)
    const publishOptions = publishCalls[0][1] as RequestInit;
    const body = JSON.parse(publishOptions.body as string) as Record<string, unknown>;
    expect(body.siteId).toBe('mySite');
    expect(body.documentId).toBe('myDoc');
    expect(body.branchId).toBe('myBranch');
    expect(body.createdById).toBe('user-1');
    expect(body.createdByType).toBe('user');
  });

  it('should return publish_result with error when publish API fails', async () => {
    // Make publish return error
    mockFetch.mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes('/internal/crdt-state')) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      if (urlStr.includes('/internal/crdt-sync')) {
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      }
      if (urlStr.includes('/internal/publish')) {
        return Promise.resolve(new Response(
          JSON.stringify({ error: 'Document not found' }),
          { status: 500 },
        ));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const { session, sender } = await createSessionWithWebSocket();

    const doc = new Y.Doc();
    doc.getMap('root').set('title', 'Test');
    await session.webSocketMessage(sender, Y.encodeStateAsUpdate(doc).buffer as ArrayBuffer);

    (sender.send as Mock).mockClear();

    await session.webSocketMessage(sender, JSON.stringify({
      type: 'publish_request',
      requestId: 'req-pub-fail',
      timestamp: Date.now(),
    }));

    const responses = getSentJsonMessages<{
      type: string;
      requestId: string;
      success: boolean;
      error?: string;
    }>(sender);

    const publishResult = responses.find(m => m.type === 'publish_result');
    expect(publishResult).toBeDefined();
    expect(publishResult?.requestId).toBe('req-pub-fail');
    expect(publishResult?.success).toBe(false);
    expect(publishResult?.error).toBeDefined();
  });

  it('should return error when session info is unknown', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const mockState = createMockState('');
    mockState.id.name = '';
    const env = createPublishEnv();
    const session = new DocumentSession(mockState as unknown, env);

    await session.fetch(new Request('http://localhost/snapshot'));

    const sender = createMockWebSocket('user-1');
    mockState.getWebSockets.mockReturnValue([sender]);

    await session.webSocketMessage(sender, JSON.stringify({
      type: 'publish_request',
      requestId: 'req-no-session',
      timestamp: Date.now(),
    }));

    const responses = getSentJsonMessages<{
      type: string;
      requestId: string;
      success: boolean;
      error?: string;
    }>(sender);

    const publishResult = responses.find(m => m.type === 'publish_result');
    expect(publishResult).toBeDefined();
    expect(publishResult?.success).toBe(false);
    expect(publishResult?.error).toBeDefined();
  });

  it('should flush CRDT state before calling publish', async () => {
    const callOrder: string[] = [];

    mockFetch.mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes('/internal/crdt-state')) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      if (urlStr.includes('/internal/crdt-sync')) {
        callOrder.push('crdt-sync');
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      }
      if (urlStr.includes('/internal/publish')) {
        callOrder.push('publish');
        return Promise.resolve(new Response(JSON.stringify({
          checkpoint: { id: 'cp-1' },
          publishedVersionId: 'v-1',
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const { session, sender } = await createSessionWithWebSocket();

    const doc = new Y.Doc();
    doc.getMap('root').set('title', 'Test');
    await session.webSocketMessage(sender, Y.encodeStateAsUpdate(doc).buffer as ArrayBuffer);

    (sender.send as Mock).mockClear();

    await session.webSocketMessage(sender, JSON.stringify({
      type: 'publish_request',
      requestId: 'req-order',
      timestamp: Date.now(),
    }));

    // Verify flush (crdt-sync) happens before publish
    expect(callOrder).toEqual(['crdt-sync', 'publish']);
  });

  it('should include X-Internal-Secret header in publish request', async () => {
    const { session, sender } = await createSessionWithWebSocket('site-1:doc-1:branch-1', {
      INTERNAL_SECRET: 'my-secret-123',
    });

    const doc = new Y.Doc();
    doc.getMap('root').set('title', 'Test');
    await session.webSocketMessage(sender, Y.encodeStateAsUpdate(doc).buffer as ArrayBuffer);

    await session.webSocketMessage(sender, JSON.stringify({
      type: 'publish_request',
      requestId: 'req-auth',
      timestamp: Date.now(),
    }));

    const publishCalls = mockFetch.mock.calls.filter((call: unknown[]) => {
      const url = call[0] as string | Request;
      const urlStr = typeof url === 'string' ? url : url.url;
      return urlStr.includes('/internal/publish');
    });

    expect(publishCalls.length).toBeGreaterThanOrEqual(1);
    const publishOptions = publishCalls[0][1] as RequestInit;
    const headers = publishOptions.headers as Record<string, string>;
    expect(headers['X-Internal-Secret']).toBe('my-secret-123');
  });
});
