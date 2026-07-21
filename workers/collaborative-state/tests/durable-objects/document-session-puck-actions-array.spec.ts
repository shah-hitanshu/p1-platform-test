/**
 * Structural Action Capture — puckActions Array Tests
 *
 * Tests the migration from single action_metadata messages to batched
 * puckActions arrays, per PROPOSAL-010 Section 5.
 *
 * Key behaviors:
 * - WsActionMetadataMessage now carries a puckActions[] array
 * - The DO captures puckActions and passes them through the sync pipeline
 * - classifyChange() is called with puckActions for proper action_type classification
 * - Multiple structural actions are batched into a single version
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
// Mock Infrastructure (shared pattern from document-session-action-metadata.spec.ts)
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

describe('Structural Action Capture — puckActions Array', () => {
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

  describe('WsActionMetadataMessage with puckActions array', () => {
    it('should capture puckActions array from action_metadata message', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Send action_metadata with puckActions array (new format)
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        puckActions: [
          { type: 'reorder', sourceIndex: 2, destinationIndex: 0, sourceZone: 'content', destinationZone: 'content' },
          { type: 'insert', componentType: 'TextBlock', destinationIndex: 1, destinationZone: 'content' },
        ],
      }));

      // Send binary CRDT update to trigger sync
      const doc = new Y.Doc();
      doc.getMap('root').set('modified', true);
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      await vi.advanceTimersByTimeAsync(6000);
      await session.alarm();

      // Queue message should include puckActions
      expect(mockQueue.send).toHaveBeenCalledTimes(1);
      const sentMessage = mockQueue.send.mock.calls[0][0] as Record<string, unknown>;
      expect(sentMessage.puckActions).toEqual([
        { type: 'reorder', sourceIndex: 2, destinationIndex: 0, sourceZone: 'content', destinationZone: 'content' },
        { type: 'insert', componentType: 'TextBlock', destinationIndex: 1, destinationZone: 'content' },
      ]);
    });

    it('should handle single-action puckActions array', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        puckActions: [
          { type: 'remove', componentId: 'comp-3' },
        ],
      }));

      const doc = new Y.Doc();
      doc.getMap('root').set('removed', true);
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      await vi.advanceTimersByTimeAsync(6000);
      await session.alarm();

      expect(mockQueue.send).toHaveBeenCalledTimes(1);
      const sentMessage = mockQueue.send.mock.calls[0][0] as Record<string, unknown>;
      expect(sentMessage.puckActions).toEqual([
        { type: 'remove', componentId: 'comp-3' },
      ]);
    });

    it('should accumulate puckActions when multiple action_metadata messages arrive before sync', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      await session.fetch(new Request('http://localhost/snapshot'));

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // First action_metadata
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        puckActions: [{ type: 'insert', componentType: 'Hero' }],
      }));

      // Second action_metadata (accumulates with the first)
      await session.webSocketMessage(sender, JSON.stringify({
        type: 'action_metadata',
        puckActions: [
          { type: 'insert', componentType: 'Hero' },
          { type: 'reorder', sourceIndex: 0, destinationIndex: 1, sourceZone: 'content', destinationZone: 'content' },
        ],
      }));

      const doc = new Y.Doc();
      doc.getMap('root').set('final', true);
      const update = Y.encodeStateAsUpdate(doc);
      await session.webSocketMessage(sender, update.buffer as ArrayBuffer);

      await vi.advanceTimersByTimeAsync(6000);
      await session.alarm();

      expect(mockQueue.send).toHaveBeenCalledTimes(1);
      const sentMessage = mockQueue.send.mock.calls[0][0] as Record<string, unknown>;
      // All 3 actions accumulated: 1 from first message + 2 from second
      expect(sentMessage.puckActions).toHaveLength(3);
    });
  });

  describe('type guard validation', () => {
    it('isWsActionMetadata should accept puckActions array format', async () => {
      const { isWsActionMetadata } = await import('../../src/types/websocket-messages');

      expect(isWsActionMetadata({
        type: 'action_metadata',
        puckActions: [{ type: 'reorder', sourceIndex: 0, destinationIndex: 1 }],
      })).toBe(true);
    });

    it('isWsActionMetadata should accept empty puckActions array', async () => {
      const { isWsActionMetadata } = await import('../../src/types/websocket-messages');

      expect(isWsActionMetadata({
        type: 'action_metadata',
        puckActions: [],
      })).toBe(true);
    });

    it('isWsActionMetadata should reject message without puckActions or actionType', async () => {
      const { isWsActionMetadata } = await import('../../src/types/websocket-messages');

      expect(isWsActionMetadata({
        type: 'action_metadata',
      })).toBe(false);
    });
  });
});
