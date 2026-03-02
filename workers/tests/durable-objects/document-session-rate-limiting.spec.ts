/**
 * Phase 4.1: WebSocket Message Rate Limiting Tests
 *
 * Tests for rate limiting WebSocket messages in DocumentSession Durable Object.
 * Prevents abuse by limiting the number of messages per second per actor.
 *
 * Key behaviors:
 * - Normal editing (< 50 msgs/sec) passes through unchanged
 * - Rapid messages (> 50 msgs/sec) are dropped with presence_error (code: RATE_LIMITED)
 * - Multiple actors are tracked independently
 * - Rate tracking is cleaned up on disconnect
 * - Persistent abuse (3 consecutive rate limit windows) closes the connection
 * - Rate limit counter resets after a clean window
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

function createYjsUpdate(key: string, value: string): Uint8Array {
  const doc = new Y.Doc();
  const root = doc.getMap('root');
  root.set(key, value);
  return Y.encodeStateAsUpdate(doc);
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

describe('Phase 4.1: WebSocket Message Rate Limiting', () => {
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    mockState = createMockState();
    mockEnv = createMockEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rate limiting constants', () => {
    it('should export MAX_MESSAGES_PER_SECOND = 50', async () => {
      const { MAX_MESSAGES_PER_SECOND } = await import('../../src/constants/security-limits');
      expect(MAX_MESSAGES_PER_SECOND).toBe(50);
    });

    it('should export RATE_LIMIT_WINDOW_MS = 1000', async () => {
      const { RATE_LIMIT_WINDOW_MS } = await import('../../src/constants/security-limits');
      expect(RATE_LIMIT_WINDOW_MS).toBe(1000);
    });

    it('should export RATE_LIMIT_CLOSE_THRESHOLD = 3', async () => {
      const { RATE_LIMIT_CLOSE_THRESHOLD } = await import('../../src/constants/security-limits');
      expect(RATE_LIMIT_CLOSE_THRESHOLD).toBe(3);
    });
  });

  describe('normal editing passes through', () => {
    it('should allow messages below the rate limit (< 50 msgs/sec)', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize the session
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const sender = createMockWebSocket('user-1');
      const receiver = createMockWebSocket('user-2');
      mockState.getWebSockets.mockReturnValue([sender, receiver]);

      // Send 10 messages (well below the 50/sec limit)
      for (let i = 0; i < 10; i++) {
        const update = createYjsUpdate(`key-${String(i)}`, `value-${String(i)}`);
        await session.webSocketMessage(sender, update.buffer as ArrayBuffer);
      }

      // Wait for broadcast debounce
      await vi.advanceTimersByTimeAsync(100);

      // The sender should NOT have received any rate limit error messages
      const senderCalls = (sender.send as Mock).mock.calls;
      const errorMessages = senderCalls.filter((call: unknown[]) => {
        try {
          const parsed = JSON.parse(call[0] as string) as Record<string, unknown>;
          return parsed.type === 'presence_error' && parsed.code === 'RATE_LIMITED';
        } catch {
          return false;
        }
      });
      expect(errorMessages).toHaveLength(0);

      // The sender should NOT have been closed
      expect(sender.close).not.toHaveBeenCalled();
    });
  });

  describe('rapid messages are rate limited', () => {
    it('should drop messages exceeding 50 msgs/sec with presence_error', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const sender = createMockWebSocket('user-1');
      const receiver = createMockWebSocket('user-2');
      mockState.getWebSockets.mockReturnValue([sender, receiver]);

      // Send 55 messages rapidly (exceeding the 50/sec limit)
      for (let i = 0; i < 55; i++) {
        const update = createYjsUpdate(`key-${String(i)}`, `value-${String(i)}`);
        await session.webSocketMessage(sender, update.buffer as ArrayBuffer);
      }

      // The sender should have received at least one rate limit error
      const senderCalls = (sender.send as Mock).mock.calls;
      const errorMessages = senderCalls.filter((call: unknown[]) => {
        try {
          const parsed = JSON.parse(call[0] as string) as Record<string, unknown>;
          return parsed.type === 'presence_error' && parsed.code === 'RATE_LIMITED';
        } catch {
          return false;
        }
      });
      expect(errorMessages.length).toBeGreaterThan(0);

      // Verify the error message format
      const errorMsg = JSON.parse(errorMessages[0][0] as string) as Record<string, unknown>;
      expect(errorMsg.type).toBe('presence_error');
      expect(errorMsg.code).toBe('RATE_LIMITED');
      expect(errorMsg.message).toBeDefined();
    });
  });

  describe('multiple actors tracked independently', () => {
    it('should track rate limits independently per actor', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const sender1 = createMockWebSocket('user-1');
      const sender2 = createMockWebSocket('user-2');
      mockState.getWebSockets.mockReturnValue([sender1, sender2]);

      // Send 55 messages from user-1 (exceeding limit)
      for (let i = 0; i < 55; i++) {
        const update = createYjsUpdate(`key1-${String(i)}`, `value-${String(i)}`);
        await session.webSocketMessage(sender1, update.buffer as ArrayBuffer);
      }

      // Send 10 messages from user-2 (well below limit)
      for (let i = 0; i < 10; i++) {
        const update = createYjsUpdate(`key2-${String(i)}`, `value-${String(i)}`);
        await session.webSocketMessage(sender2, update.buffer as ArrayBuffer);
      }

      // user-1 should have rate limit errors
      const sender1Calls = (sender1.send as Mock).mock.calls;
      const sender1Errors = sender1Calls.filter((call: unknown[]) => {
        try {
          const parsed = JSON.parse(call[0] as string) as Record<string, unknown>;
          return parsed.type === 'presence_error' && parsed.code === 'RATE_LIMITED';
        } catch {
          return false;
        }
      });
      expect(sender1Errors.length).toBeGreaterThan(0);

      // user-2 should NOT have rate limit errors
      const sender2Calls = (sender2.send as Mock).mock.calls;
      const sender2Errors = sender2Calls.filter((call: unknown[]) => {
        try {
          const parsed = JSON.parse(call[0] as string) as Record<string, unknown>;
          return parsed.type === 'presence_error' && parsed.code === 'RATE_LIMITED';
        } catch {
          return false;
        }
      });
      expect(sender2Errors).toHaveLength(0);
    });
  });

  describe('rate tracking cleaned up on disconnect', () => {
    it('should clean up rate tracking data when a WebSocket disconnects', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const sender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([sender]);

      // Send some messages to establish rate tracking
      for (let i = 0; i < 10; i++) {
        const update = createYjsUpdate(`key-${String(i)}`, `value-${String(i)}`);
        await session.webSocketMessage(sender, update.buffer as ArrayBuffer);
      }

      // Disconnect the sender
      sender.readyState = WebSocket.CLOSED;
      mockState.getWebSockets.mockReturnValue([]);
      await session.webSocketClose(sender, 1000, 'Normal closure', true);

      // Wait for any pending operations
      await vi.advanceTimersByTimeAsync(100);

      // Reconnect with same actor ID — should start fresh with no rate history
      const newSender = createMockWebSocket('user-1');
      mockState.getWebSockets.mockReturnValue([newSender]);

      // Send messages up to the limit — all should pass since tracking was cleaned
      for (let i = 0; i < 49; i++) {
        const update = createYjsUpdate(`new-key-${String(i)}`, `value-${String(i)}`);
        await session.webSocketMessage(newSender, update.buffer as ArrayBuffer);
      }

      // Should NOT have any rate limit errors
      const newSenderCalls = (newSender.send as Mock).mock.calls;
      const errorMessages = newSenderCalls.filter((call: unknown[]) => {
        try {
          const parsed = JSON.parse(call[0] as string) as Record<string, unknown>;
          return parsed.type === 'presence_error' && parsed.code === 'RATE_LIMITED';
        } catch {
          return false;
        }
      });
      expect(errorMessages).toHaveLength(0);
    });
  });

  describe('persistent abuse closes connection', () => {
    it('should close connection after 3 consecutive rate limit windows', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const sender = createMockWebSocket('user-1');
      const receiver = createMockWebSocket('user-2');
      mockState.getWebSockets.mockReturnValue([sender, receiver]);

      // Window 1: Exceed rate limit
      for (let i = 0; i < 55; i++) {
        const update = createYjsUpdate(`w1-${String(i)}`, `v-${String(i)}`);
        await session.webSocketMessage(sender, update.buffer as ArrayBuffer);
      }

      // Move to next window
      await vi.advanceTimersByTimeAsync(1100);

      // Window 2: Exceed rate limit again
      for (let i = 0; i < 55; i++) {
        const update = createYjsUpdate(`w2-${String(i)}`, `v-${String(i)}`);
        await session.webSocketMessage(sender, update.buffer as ArrayBuffer);
      }

      // Move to next window
      await vi.advanceTimersByTimeAsync(1100);

      // Window 3: Exceed rate limit — should trigger connection close
      for (let i = 0; i < 55; i++) {
        const update = createYjsUpdate(`w3-${String(i)}`, `v-${String(i)}`);
        await session.webSocketMessage(sender, update.buffer as ArrayBuffer);
      }

      // The connection should have been closed with code 1008
      expect(sender.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');

      // Should have sent a rate limit error before closing
      const senderCalls = (sender.send as Mock).mock.calls;
      const closeErrorMessages = senderCalls.filter((call: unknown[]) => {
        try {
          const parsed = JSON.parse(call[0] as string) as Record<string, unknown>;
          return (
            parsed.type === 'presence_error' &&
            parsed.code === 'RATE_LIMITED' &&
            (parsed.message as string).includes('closed')
          );
        } catch {
          return false;
        }
      });
      expect(closeErrorMessages.length).toBeGreaterThan(0);
    });
  });

  describe('rate limit counter resets after clean window', () => {
    it('should reset consecutive rate limit counter after a window without violations', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Initialize
      const snapshotReq = new Request('http://localhost/snapshot');
      await session.fetch(snapshotReq);

      const sender = createMockWebSocket('user-1');
      const receiver = createMockWebSocket('user-2');
      mockState.getWebSockets.mockReturnValue([sender, receiver]);

      // Window 1: Exceed rate limit (consecutiveRateLimits = 1)
      for (let i = 0; i < 55; i++) {
        const update = createYjsUpdate(`w1-${String(i)}`, `v-${String(i)}`);
        await session.webSocketMessage(sender, update.buffer as ArrayBuffer);
      }

      // Move to next window
      await vi.advanceTimersByTimeAsync(1100);

      // Window 2: Exceed rate limit again (consecutiveRateLimits = 2)
      for (let i = 0; i < 55; i++) {
        const update = createYjsUpdate(`w2-${String(i)}`, `v-${String(i)}`);
        await session.webSocketMessage(sender, update.buffer as ArrayBuffer);
      }

      // Move to next window
      await vi.advanceTimersByTimeAsync(1100);

      // Window 3: Send BELOW the limit (clean window — resets counter)
      for (let i = 0; i < 10; i++) {
        const update = createYjsUpdate(`w3-${String(i)}`, `v-${String(i)}`);
        await session.webSocketMessage(sender, update.buffer as ArrayBuffer);
      }

      // Move to next window
      await vi.advanceTimersByTimeAsync(1100);

      // Window 4: Exceed rate limit (consecutiveRateLimits should be 1, not 3)
      for (let i = 0; i < 55; i++) {
        const update = createYjsUpdate(`w4-${String(i)}`, `v-${String(i)}`);
        await session.webSocketMessage(sender, update.buffer as ArrayBuffer);
      }

      // Move to next window
      await vi.advanceTimersByTimeAsync(1100);

      // Window 5: Exceed rate limit (consecutiveRateLimits should be 2, not 4)
      for (let i = 0; i < 55; i++) {
        const update = createYjsUpdate(`w5-${String(i)}`, `v-${String(i)}`);
        await session.webSocketMessage(sender, update.buffer as ArrayBuffer);
      }

      // Connection should NOT be closed yet (only 2 consecutive, not 3)
      // The close() calls should only be for rate limiting, not the final close
      const closeCalls = (sender.close as Mock).mock.calls;
      expect(closeCalls).toHaveLength(0);
    });
  });
});
