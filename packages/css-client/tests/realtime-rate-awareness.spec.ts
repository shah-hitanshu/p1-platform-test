/**
 * Client-Side Message Rate Awareness Tests (TDD)
 *
 * Tests for the outbound message rate limiter that prevents exceeding
 * the server's 50 messages/second rate limit. Normal editing sends
 * updates immediately; rapid bursts (>40/sec) trigger client-side
 * coalescing via Y.mergeUpdates(). The server's RATE_LIMITED error
 * is handled gracefully without disconnecting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

// Mock ReconnectingWebSocket
class MockReconnectingWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockReconnectingWebSocket.CONNECTING;
  binaryType: string = 'arraybuffer';
  retryCount: number = 0;

  url: string;
  private urlProvider: string | (() => string | Promise<string>);
  private listeners: Map<string, Set<EventListener>> = new Map();

  constructor(
    url: string | (() => string | Promise<string>),
    _protocols: string[] = [],
    _options: Record<string, unknown> = {},
  ) {
    this.urlProvider = url;
    if (typeof url === 'string') {
      this.url = url;
    } else {
      const result = url();
      this.url = typeof result === 'string' ? result : '';
    }
    setTimeout(() => this.simulateOpen(), 0);
  }

  simulateOpen(): void {
    this.readyState = MockReconnectingWebSocket.OPEN;
    const event = new Event('open');
    this.dispatchEvent(event);
  }

  simulateMessage(data: ArrayBuffer | string): void {
    const event = new MessageEvent('message', { data });
    this.dispatchEvent(event);
  }

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => listener(event));
    }
    return true;
  }

  reconnect = vi.fn();
  send = vi.fn();
  close = vi.fn();
}

let mockWSInstances: MockReconnectingWebSocket[] = [];

vi.mock('partysocket', () => ({
  WebSocket: vi.fn(
    (
      url: string | (() => string | Promise<string>),
      protocols: string[] = [],
      options: Record<string, unknown> = {},
    ) => {
      const ws = new MockReconnectingWebSocket(url, protocols, options);
      mockWSInstances.push(ws);
      return ws;
    },
  ),
}));

// Helper: create and connect a RealtimeClient
async function createConnectedClient() {
  const { RealtimeClient } = await import('../src/realtime.js');

  const onRateLimited = vi.fn();
  const client = new RealtimeClient({
    baseUrl: 'ws://localhost:8787',
    onRateLimited,
  });

  client.connect({
    siteId: 'site-123',
    branchId: 'branch-456',
    documentPath: 'pages/home',
    actorId: 'user-789',
    actorType: 'user',
  });

  await vi.advanceTimersByTimeAsync(10);
  expect(client.isConnected()).toBe(true);

  return { client, onRateLimited };
}

// Helper: create a small valid Yjs update
function createYjsUpdate(key: string, value: string): Uint8Array {
  const doc = new Y.Doc();
  const root = doc.getMap('root');
  root.set(key, value);
  return Y.encodeStateAsUpdate(doc);
}

describe('Client-side message rate awareness', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mockWSInstances = [];

    const partysocket = await import('partysocket');
    vi.mocked(partysocket.WebSocket).mockImplementation(
      (
        url: string | (() => string | Promise<string>),
        protocols: string[] = [],
        options: Record<string, unknown> = {},
      ) => {
        const ws = new MockReconnectingWebSocket(url, protocols, options);
        mockWSInstances.push(ws);
        return ws as unknown as ReturnType<typeof partysocket.WebSocket>;
      },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('normal editing (under rate limit)', () => {
    it('should send updates immediately when under the rate limit', async () => {
      const { client } = await createConnectedClient();

      // Send a few updates (well under 40/sec threshold)
      for (let i = 0; i < 5; i++) {
        client.applyLocalUpdate(createYjsUpdate(`key${i}`, `val${i}`));
      }

      // All 5 should have been sent immediately
      expect(mockWSInstances[0].send).toHaveBeenCalledTimes(5);

      client.disconnect();
    });

    it('should not add unnecessary latency for normal editing patterns', async () => {
      const { client } = await createConnectedClient();

      // Simulate normal editing: ~10 updates/sec spread over 1 second
      for (let i = 0; i < 10; i++) {
        client.applyLocalUpdate(createYjsUpdate(`key${i}`, `val${i}`));
        await vi.advanceTimersByTimeAsync(100); // 100ms between edits
      }

      // All 10 should have been sent immediately (no buffering)
      expect(mockWSInstances[0].send).toHaveBeenCalledTimes(10);

      client.disconnect();
    });
  });

  describe('rapid updates (approaching rate limit)', () => {
    it('should buffer updates when exceeding the rate threshold', async () => {
      const { client } = await createConnectedClient();

      // Send 45 updates rapidly (exceeds 40/sec threshold)
      for (let i = 0; i < 45; i++) {
        client.applyLocalUpdate(createYjsUpdate(`key${i}`, `val${i}`));
      }

      // First 40 should be sent immediately, rest should be buffered
      const sendCount = mockWSInstances[0].send.mock.calls.length;
      expect(sendCount).toBeLessThan(45);
      expect(sendCount).toBeGreaterThanOrEqual(40);

      client.disconnect();
    });

    it('should flush buffered updates after the rate window resets', async () => {
      const { client } = await createConnectedClient();

      // Send 45 updates rapidly
      for (let i = 0; i < 45; i++) {
        client.applyLocalUpdate(createYjsUpdate(`key${i}`, `val${i}`));
      }

      const sendCountBefore = mockWSInstances[0].send.mock.calls.length;

      // Advance past the 1-second rate window
      await vi.advanceTimersByTimeAsync(1100);

      // Buffered updates should now be flushed
      const sendCountAfter = mockWSInstances[0].send.mock.calls.length;
      expect(sendCountAfter).toBeGreaterThan(sendCountBefore);

      client.disconnect();
    });

    it('should coalesce buffered updates using Y.mergeUpdates', async () => {
      const { client } = await createConnectedClient();

      // Send 50 updates rapidly (exceeds threshold, some will be buffered)
      for (let i = 0; i < 50; i++) {
        client.applyLocalUpdate(createYjsUpdate(`key${i}`, `val${i}`));
      }

      // Advance past the rate window to trigger flush
      await vi.advanceTimersByTimeAsync(1100);

      // Total sends should be fewer than 50 because buffered updates are merged
      const totalSends = mockWSInstances[0].send.mock.calls.length;
      expect(totalSends).toBeLessThan(50);

      client.disconnect();
    });
  });

  describe('rate limit recovery', () => {
    it('should resume immediate sending after rate window resets', async () => {
      const { client } = await createConnectedClient();

      // Burst 45 updates
      for (let i = 0; i < 45; i++) {
        client.applyLocalUpdate(createYjsUpdate(`burst${i}`, `val${i}`));
      }

      // Wait for window to reset
      await vi.advanceTimersByTimeAsync(1100);
      mockWSInstances[0].send.mockClear();

      // New updates should be sent immediately again
      for (let i = 0; i < 5; i++) {
        client.applyLocalUpdate(createYjsUpdate(`after${i}`, `val${i}`));
      }

      expect(mockWSInstances[0].send).toHaveBeenCalledTimes(5);

      client.disconnect();
    });
  });

  describe('RATE_LIMITED server error handling', () => {
    it('should handle RATE_LIMITED presence error without disconnecting', async () => {
      const { client } = await createConnectedClient();

      // Simulate server sending a RATE_LIMITED error
      const rateLimitedMessage = JSON.stringify({
        type: 'presence_error',
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded: 50 messages/second',
      });
      mockWSInstances[0].simulateMessage(rateLimitedMessage);

      // Client should remain connected
      expect(client.isConnected()).toBe(true);

      client.disconnect();
    });

    it('should invoke onRateLimited callback when server sends RATE_LIMITED', async () => {
      const { client, onRateLimited } = await createConnectedClient();

      // Simulate server sending a RATE_LIMITED error
      const rateLimitedMessage = JSON.stringify({
        type: 'presence_error',
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded: 50 messages/second',
      });
      mockWSInstances[0].simulateMessage(rateLimitedMessage);

      expect(onRateLimited).toHaveBeenCalled();

      client.disconnect();
    });
  });
});
