/**
 * RealtimeClient WebSocket Delivery Acknowledgment Tests
 *
 * Tests for the waitForDelivery() method on RealtimeClient.
 * This feature sends a delivery_ack_request and waits for a matching
 * delivery_ack response from the server, with timeout support.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ReconnectingWebSocket options
interface MockWSOptions {
  maxRetries?: number;
  minReconnectionDelay?: number;
  maxReconnectionDelay?: number;
  reconnectionDelayGrowFactor?: number;
}

// Mock ReconnectingWebSocket (matching the pattern in realtime.spec.ts)
class MockReconnectingWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockReconnectingWebSocket.CONNECTING;
  binaryType: string = 'arraybuffer';
  retryCount: number = 0;

  url: string;
  protocols: string[];
  options: MockWSOptions;

  private listeners: Map<string, Set<EventListener>> = new Map();
  sentMessages: (string | ArrayBuffer | Uint8Array)[] = [];

  constructor(url: string, protocols: string[] = [], options: MockWSOptions = {}) {
    this.url = url;
    this.protocols = protocols;
    this.options = options;
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

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockReconnectingWebSocket.CLOSED;
    const event = new CloseEvent('close', { code, reason });
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

  send(data: string | ArrayBuffer | Uint8Array): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.simulateClose();
  }

  // Get sent text messages (JSON)
  getSentTextMessages(): string[] {
    return this.sentMessages.filter((m): m is string => typeof m === 'string');
  }

  // Get parsed JSON messages
  getSentJsonMessages<T>(): T[] {
    return this.getSentTextMessages().map((m) => JSON.parse(m) as T);
  }
}

// Store instances for test access
let mockWSInstances: MockReconnectingWebSocket[] = [];

// Mock partysocket module - export WebSocket (ReconnectingWebSocket)
vi.mock('partysocket', () => ({
  WebSocket: vi.fn().mockImplementation(function (url: string, protocols: string[] = [], options: MockWSOptions = {}) {
    const ws = new MockReconnectingWebSocket(url, protocols, options);
    mockWSInstances.push(ws);
    return ws;
  }),
}));

describe('RealtimeClient Delivery Acknowledgment', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mockWSInstances = [];
    // Re-mock to ensure fresh instances
    const partysocket = await import('partysocket');
    vi.mocked(partysocket.WebSocket).mockImplementation(
      function (url: string, protocols: string[] = [], options: MockWSOptions = {}) {
        const ws = new MockReconnectingWebSocket(url, protocols, options);
        mockWSInstances.push(ws);
        return ws as unknown as ReturnType<typeof partysocket.WebSocket>;
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // Helper to get the latest mock WebSocket instance
  const getLatestWs = (): MockReconnectingWebSocket | undefined => {
    return mockWSInstances[mockWSInstances.length - 1];
  };

  // Helper to create a connected client
  const createConnectedClient = async () => {
    const { RealtimeClient } = await import('../src/realtime');

    const client = new RealtimeClient({
      baseUrl: 'ws://localhost:8787',
    });

    client.connect({
      siteId: 'site-1',
      branchId: 'branch-1',
      documentPath: 'pages/home',
      actorId: 'user-1',
      actorType: 'user',
    });

    const ws = getLatestWs();
    ws?.simulateOpen();

    return { client, ws: ws! };
  };

  it('should send delivery_ack_request message via WebSocket', async () => {
    const { client, ws } = await createConnectedClient();

    // Start waitForDelivery (don't await - we just want to check the sent message)
    const promise = client.waitForDelivery();

    const sentMessages = ws.getSentJsonMessages<{
      type: string;
      requestId: string;
      timestamp: number;
    }>();

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].type).toBe('delivery_ack_request');
    expect(sentMessages[0].requestId).toBeDefined();
    expect(typeof sentMessages[0].requestId).toBe('string');
    expect(sentMessages[0].requestId.length).toBeGreaterThan(0);
    expect(sentMessages[0].timestamp).toBeDefined();
    expect(typeof sentMessages[0].timestamp).toBe('number');

    // Clean up: respond so the promise resolves
    ws.simulateMessage(
      JSON.stringify({
        type: 'delivery_ack',
        requestId: sentMessages[0].requestId,
        timestamp: Date.now(),
      }),
    );
    await promise;
  });

  it('should resolve when delivery_ack response is received', async () => {
    const { client, ws } = await createConnectedClient();

    const promise = client.waitForDelivery();

    // Extract the requestId from the sent message
    const sentMessages = ws.getSentJsonMessages<{
      type: string;
      requestId: string;
      timestamp: number;
    }>();
    const requestId = sentMessages[0].requestId;

    // Simulate server responding with matching requestId
    ws.simulateMessage(
      JSON.stringify({
        type: 'delivery_ack',
        requestId,
        timestamp: Date.now(),
      }),
    );

    // Promise should resolve without throwing
    await expect(promise).resolves.toBeUndefined();
  });

  it('should reject when not connected', async () => {
    const { RealtimeClient } = await import('../src/realtime');

    const client = new RealtimeClient({
      baseUrl: 'ws://localhost:8787',
    });

    // Not connected - should reject immediately
    await expect(client.waitForDelivery()).rejects.toThrow();
  });

  it('should reject on timeout when server does not respond', async () => {
    vi.useFakeTimers();

    const { client } = await createConnectedClient();

    const promise = client.waitForDelivery();

    // Attach rejection handler before advancing timers to avoid unhandled rejection
    const resultPromise = expect(promise).rejects.toThrow('Delivery acknowledgment timed out');

    // Advance time past the default timeout (5000ms)
    await vi.advanceTimersByTimeAsync(5001);

    await resultPromise;
  });

  it('should handle multiple concurrent waitForDelivery calls independently', async () => {
    const { client, ws } = await createConnectedClient();

    // Start two concurrent delivery ack requests
    const promise1 = client.waitForDelivery();
    const promise2 = client.waitForDelivery();

    const sentMessages = ws.getSentJsonMessages<{
      type: string;
      requestId: string;
      timestamp: number;
    }>();

    expect(sentMessages).toHaveLength(2);

    const requestId1 = sentMessages[0].requestId;
    const requestId2 = sentMessages[1].requestId;

    // They should have different requestIds
    expect(requestId1).not.toBe(requestId2);

    // Respond to the second one first (reverse order)
    ws.simulateMessage(
      JSON.stringify({
        type: 'delivery_ack',
        requestId: requestId2,
        timestamp: Date.now(),
      }),
    );

    // Second promise should resolve
    await expect(promise2).resolves.toBeUndefined();

    // First promise should still be pending (not yet resolved)
    // Now respond to the first one
    ws.simulateMessage(
      JSON.stringify({
        type: 'delivery_ack',
        requestId: requestId1,
        timestamp: Date.now(),
      }),
    );

    // First promise should now resolve
    await expect(promise1).resolves.toBeUndefined();
  });

  it('should ignore delivery_ack with non-matching requestId', async () => {
    vi.useFakeTimers();

    const { client, ws } = await createConnectedClient();

    const promise = client.waitForDelivery();

    // Send a delivery_ack with a wrong requestId
    ws.simulateMessage(
      JSON.stringify({
        type: 'delivery_ack',
        requestId: 'wrong-request-id',
        timestamp: Date.now(),
      }),
    );

    // The promise should NOT have resolved yet - verify by racing with a short timer
    let resolved = false;
    promise.then(() => {
      resolved = true;
    }).catch(() => {
      // Expected timeout rejection — handled below
    });

    // Give microtasks a chance to run
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    // Attach rejection handler before advancing timers to avoid unhandled rejection
    const resultPromise = expect(promise).rejects.toThrow();

    // Now advance past timeout to clean up
    await vi.advanceTimersByTimeAsync(5001);
    await resultPromise;
  });

  it('should clean up pending request on timeout', async () => {
    vi.useFakeTimers();

    const { client, ws } = await createConnectedClient();

    const promise = client.waitForDelivery();

    const sentMessages = ws.getSentJsonMessages<{
      type: string;
      requestId: string;
      timestamp: number;
    }>();
    const requestId = sentMessages[0].requestId;

    // Attach rejection handler before advancing timers
    const resultPromise = expect(promise).rejects.toThrow();

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(5001);

    // The promise should have rejected
    await resultPromise;

    // After timeout, sending a late ack should not cause errors
    // (the pending request should have been cleaned up)
    ws.simulateMessage(
      JSON.stringify({
        type: 'delivery_ack',
        requestId,
        timestamp: Date.now(),
      }),
    );

    // No error should have been thrown - if internal state wasn't cleaned up,
    // this could cause issues. The test passes if no unhandled errors occur.
  });

  it('should reject pending delivery ack promises on disconnect', async () => {
    const { client, ws } = await createConnectedClient();

    const promise = client.waitForDelivery();

    // Disconnect while waiting
    client.disconnect();

    // The pending promise should reject
    await expect(promise).rejects.toThrow();
  });
});
