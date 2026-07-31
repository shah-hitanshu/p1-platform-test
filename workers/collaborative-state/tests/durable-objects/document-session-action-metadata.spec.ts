/**
 * Action Metadata Forwarding Tests
 *
 * Tests that action metadata sent as WebSocket text messages is captured
 * by the DocumentSession and forwarded through the sync pipeline to
 * PostgreSQL (via queue or HTTP).
 *
 * Key behaviors:
 * - action_metadata text messages are captured on the syncManager
 * - Binary CRDT updates trigger scheduleSync with the pending metadata
 * - Queue-based sync includes actionType and actionMetadata in the message
 * - HTTP-based sync includes actionType and actionMetadata in the payload
 * - Metadata is cleared after successful sync
 * - Metadata is stored in the sync schedule (survives hibernation)
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

  const acceptedWebSockets: WebSocket[] = [];

  return {
    id: { toString: () => sessionId, name: sessionId },
    storage,
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    }),
    acceptWebSocket: vi.fn().mockImplementation((ws: WebSocket) => {
      acceptedWebSockets.push(ws);
    }),
    getWebSockets: vi.fn().mockImplementation(() => {
      return acceptedWebSockets.filter(ws => ws.readyState === WebSocket.OPEN);
    }),
  };
}

interface MockQueue {
  send: Mock;
}

interface MockEnv {
  API_URL: string;
  ENVIRONMENT: string;
  INTERNAL_API_URL: string;
  INTERNAL_SECRET: string;
  SYNC_QUEUE?: MockQueue;
}

function createMockEnv(overrides: Partial<MockEnv> = {}): MockEnv {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
    ...overrides,
  };
}

function createMockQueue(): MockQueue {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockWebSocket(actorId = 'user-1'): WebSocket {
  return {
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
    url: '',
    serializeAttachment: vi.fn(),
    deserializeAttachment: vi.fn().mockReturnValue({
      actorId,
      actorType: 'user',
      verified: false,
    }),
  } as unknown as WebSocket;
}

// =============================================================================
// Tests
// =============================================================================

describe('Action Metadata Forwarding', () => {
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;
  let mockQueue: MockQueue;

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    mockState = createMockState();
    mockQueue = createMockQueue();
    mockEnv = createMockEnv({ SYNC_QUEUE: mockQueue });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: { id: 'v-1' } }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  describe('capturing action_metadata text messages', () => {
    it('should capture action_metadata and include it in the queue sync payload', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      // Initialize
      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Step 1: Send action_metadata text message
      const actionMetadataMsg = JSON.stringify({
        type: 'action_metadata',
        actionType: 'insert',
        actionMetadata: { componentType: 'Hero', destinationZone: 'root:content' },
      });
      await session.webSocketMessage(sender, actionMetadataMsg);

      // Step 2: Send a binary CRDT update (triggers scheduleSync)
      const doc = new Y.Doc();
      doc.getMap('root').set('title', 'Hello World');
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      // Step 3: Advance timers past the sync idle timeout and trigger alarm
      await vi.advanceTimersByTimeAsync(6000);
      await session.alarm();

      // Step 4: Verify queue message includes puckActions (legacy format converted to array)
      expect(mockQueue.send).toHaveBeenCalledTimes(1);
      const sentMessage = mockQueue.send.mock.calls[0][0] as Record<string, unknown>;
      expect(sentMessage).toMatchObject({
        siteId: 'site-1',
        documentId: 'doc-1',
        branchId: 'branch-1',
        actorId: 'user-1',
        actorType: 'user',
        puckActions: [{ type: 'insert', componentType: 'Hero', destinationZone: 'root:content' }],
      });
    });

    it('should include action metadata in HTTP sync payload when queue is not available', async () => {
      const envNoQueue = createMockEnv({ SYNC_QUEUE: undefined });
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, envNoQueue);

      // Initialize
      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Send action_metadata then binary update
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        actionType: 'set',
        actionMetadata: { path: 'title' },
      }));

      const doc = new Y.Doc();
      doc.getMap('root').set('title', 'Updated');
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      // Advance past sync idle timeout and trigger alarm
      await vi.advanceTimersByTimeAsync(6000);
      await session.alarm();

      // Verify HTTP fetch was called with action metadata
      const fetchCalls = (globalThis.fetch as Mock).mock.calls;
      const syncCall = fetchCalls.find(
        (call) => String(call[0]).includes('/internal/crdt-sync'),
      );
      expect(syncCall).toBeDefined();

      const requestInit = (syncCall ?? [])[1] as RequestInit;
      const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
      // Legacy format is converted to puckActions array
      expect(body.puckActions).toEqual([{ type: 'set', path: 'title' }]);
    });

    it('should accumulate action_metadata when multiple are sent before sync', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Send first action_metadata
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        actionType: 'insert',
        actionMetadata: { componentType: 'Hero' },
      }));

      // Send second action_metadata (should accumulate with the first)
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        actionType: 'reorder',
        actionMetadata: { fromIndex: 0, toIndex: 2 },
      }));

      // Send binary update
      const doc = new Y.Doc();
      doc.getMap('root').set('order', 'changed');
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      await vi.advanceTimersByTimeAsync(6000);
      await session.alarm();

      expect(mockQueue.send).toHaveBeenCalledTimes(1);
      const sentMessage = mockQueue.send.mock.calls[0][0] as Record<string, unknown>;
      // Both actions accumulated
      expect(sentMessage.puckActions).toEqual([
        { type: 'insert', componentType: 'Hero' },
        { type: 'reorder', fromIndex: 0, toIndex: 2 },
      ]);
    });

    it('should not include action metadata fields when no action_metadata message was sent', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Only send binary update (no action_metadata)
      const doc = new Y.Doc();
      doc.getMap('root').set('title', 'No metadata');
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      await vi.advanceTimersByTimeAsync(6000);
      await session.alarm();

      expect(mockQueue.send).toHaveBeenCalledTimes(1);
      const sentMessage = mockQueue.send.mock.calls[0][0] as Record<string, unknown>;
      expect(sentMessage.puckActions).toBeUndefined();
    });

    it('should handle action_metadata without data field', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Send action_metadata without data field
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        actionType: 'delete',
      }));

      const doc = new Y.Doc();
      doc.getMap('root').set('deleted', true);
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      await vi.advanceTimersByTimeAsync(6000);
      await session.alarm();

      expect(mockQueue.send).toHaveBeenCalledTimes(1);
      const sentMessage = mockQueue.send.mock.calls[0][0] as Record<string, unknown>;
      // Legacy format converted to puckActions — undefined actionMetadata is spread as empty
      expect(sentMessage.puckActions).toEqual([{ type: 'delete' }]);
    });

    it('should not route action_metadata messages to presence handler', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Send action_metadata — should be silently captured, not cause errors
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        actionType: 'insert',
        actionMetadata: { componentType: 'Hero' },
      }));

      // No error response should have been sent back on the WebSocket
      const sendCalls = (sender.send as Mock).mock.calls;
      const errorMessages = sendCalls.filter((call) => {
        try {
          const parsed = JSON.parse(String(call[0])) as Record<string, unknown>;
          return parsed.type === 'presence_error';
        } catch {
          return false;
        }
      });
      expect(errorMessages).toHaveLength(0);
    });
  });

  describe('action metadata in sync schedule storage', () => {
    it('should persist action metadata in the sync schedule for hibernation recovery', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState, mockEnv);

      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Send action_metadata then binary update
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        actionType: 'insert',
        actionMetadata: { componentType: 'Card' },
      }));

      const doc = new Y.Doc();
      doc.getMap('root').set('card', 'added');
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      // Find the syncSchedule storage.put call
      const putCalls = mockState.storage.put.mock.calls;
      const syncScheduleCall = putCalls.find(
        (call) => call[0] === 'syncSchedule',
      );
      expect(syncScheduleCall).toBeDefined();

      const schedule = (syncScheduleCall ?? [])[1] as Record<string, unknown>;
      expect(schedule.puckActions).toEqual([{ type: 'insert', componentType: 'Card' }]);
    });
  });
});

describe('WebSocket message type guards', () => {
  it('isWsActionMetadata should validate action_metadata messages', async () => {
    const { isWsActionMetadata } = await import('../../src/types/websocket-messages');

    // Valid: actionType only
    expect(isWsActionMetadata({
      type: 'action_metadata',
      actionType: 'insert',
    })).toBe(true);

    // Valid with actionMetadata
    expect(isWsActionMetadata({
      type: 'action_metadata',
      actionType: 'set',
      actionMetadata: { path: 'title' },
    })).toBe(true);

    // Invalid: wrong type
    expect(isWsActionMetadata({
      type: 'presence_heartbeat',
      actionType: 'insert',
    })).toBe(false);

    // Invalid: missing actionType
    expect(isWsActionMetadata({
      type: 'action_metadata',
    })).toBe(false);

    // Invalid: null
    expect(isWsActionMetadata(null)).toBe(false);

    // Invalid: non-object
    expect(isWsActionMetadata('action_metadata')).toBe(false);
  });

  it('isWsClientMessage should include action_metadata type', async () => {
    const { isWsClientMessage } = await import('../../src/types/websocket-messages');

    expect(isWsClientMessage({
      type: 'action_metadata',
      actionType: 'insert',
    })).toBe(true);
  });
});
