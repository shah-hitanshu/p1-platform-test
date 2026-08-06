/**
 * DocumentSession: /reload Endpoint Tests (TDD - Red State)
 *
 * Tests for the /reload endpoint that re-initializes the DO's Y.Doc
 * from PostgreSQL and broadcasts the diff to connected WebSocket clients.
 *
 * Used when content is published externally (e.g., cherry-pick publish
 * from a branch to main) and the DO needs to reflect the new state.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { readJson } from '../helpers/http';
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
// Mock Types
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

function createMockState(sessionId = 'aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001'): MockDurableObjectState {
  const storageData = new Map<string, unknown>();

  const storage: MockDurableObjectStorage = {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.get(key))),
    put: vi.fn().mockImplementation((key: string, value: unknown) => {
      storageData.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockResolvedValue(true),
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
  INTERNAL_API_URL: string;
  INTERNAL_SECRET: string;
}

function createMockEnv(): MockEnv {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('DocumentSession /reload endpoint', () => {
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;
  let mockFetch: Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    mockState = createMockState();
    mockEnv = createMockEnv();

    // Mock global fetch for internal API calls (Hyperdrive/HTTP init)
    mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ found: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should accept POST requests to /reload', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState, mockEnv);

    // Mock fetch for both the initial CRDT load and the reload
    // Each call needs a fresh Response (Response bodies are consumed on read)
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ found: true, snapshot: { title: 'Test' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const request = new Request('http://localhost/reload', {
      method: 'POST',
    });
    const response = await session.fetch(request);

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toHaveProperty('success', true);
  });

  it('should reject non-POST requests to /reload', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState, mockEnv);

    const request = new Request('http://localhost/reload', {
      method: 'GET',
    });
    const response = await session.fetch(request);

    expect(response.status).toBe(405);
  });

  it('should reload state from PostgreSQL and update Y.Doc', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState, mockEnv);

    // First, initialize with some content via /apply
    const applyRequest = new Request('http://localhost/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{ type: 'set', path: 'title', value: 'Old Title' }],
        actorId: 'user-1',
      }),
    });
    await session.fetch(applyRequest);

    // Verify initial state
    const snapshotBefore = await session.fetch(new Request('http://localhost/snapshot'));
    const dataBefore = await snapshotBefore.json();
    expect(dataBefore.snapshot.title).toBe('Old Title');

    // Mock fetch to return new content from PostgreSQL
    const newSnapshot = { title: 'New Published Title', content: 'Published content' };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({
        found: true,
        snapshot: newSnapshot,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    // Call /reload
    const reloadRequest = new Request('http://localhost/reload', {
      method: 'POST',
    });
    const reloadResponse = await session.fetch(reloadRequest);
    expect(reloadResponse.status).toBe(200);

    // Verify Y.Doc has the new content
    const snapshotAfter = await session.fetch(new Request('http://localhost/snapshot'));
    const dataAfter = await snapshotAfter.json();
    expect(dataAfter.snapshot.title).toBe('New Published Title');
    expect(dataAfter.snapshot.content).toBe('Published content');
  });

  it('should broadcast diff to connected WebSocket clients', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');

    // Create mock WebSocket
    const mockWs = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn().mockReturnValue(true),
      url: '',
      protocol: '',
      extensions: '',
      bufferedAmount: 0,
      binaryType: 'arraybuffer' as BinaryType,
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
    } as unknown as WebSocket;

    // Return the mock WebSocket from getWebSockets
    mockState.getWebSockets.mockReturnValue([mockWs]);

    const session = new DocumentSession(mockState, mockEnv);

    // Initialize with content
    const applyRequest = new Request('http://localhost/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{ type: 'set', path: 'title', value: 'Old Title' }],
        actorId: 'user-1',
      }),
    });
    await session.fetch(applyRequest);

    // Mock fetch to return updated content
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({
        found: true,
        snapshot: { title: 'Updated Title' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    // Call /reload
    const reloadRequest = new Request('http://localhost/reload', {
      method: 'POST',
    });
    await session.fetch(reloadRequest);

    // WebSocket should have received the diff as a binary Yjs update

    expect(mockWs.send).toHaveBeenCalled();
    const sentData = (mockWs.send as Mock).mock.calls[0][0];
    // Should be a Uint8Array (Yjs update)
    expect(sentData).toBeInstanceOf(Uint8Array);
  });

  it('should return reloaded snapshot in response', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState, mockEnv);

    // First call: initial CRDT load (empty doc)
    // Second call: reload with new content
    const newSnapshot = { title: 'Reloaded Content' };
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ found: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          found: true,
          snapshot: newSnapshot,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const reloadRequest = new Request('http://localhost/reload', {
      method: 'POST',
    });
    const response = await session.fetch(reloadRequest);
    const body = await readJson(response);

    expect(body.success).toBe(true);
    expect(body.snapshot).toEqual(newSnapshot);
  });

  it('should persist the reloaded state to DO storage', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState, mockEnv);

    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({
        found: true,
        snapshot: { title: 'Persisted Content' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const reloadRequest = new Request('http://localhost/reload', {
      method: 'POST',
    });
    await session.fetch(reloadRequest);

    // Should have persisted the new Y.Doc state to DO storage
    const putCalls = mockState.storage.put.mock.calls;
    const ydocPut = putCalls.find(
      (call: unknown[]) => call[0] === 'ydoc',
    );
    expect(ydocPut).toBeDefined();
  });
});
