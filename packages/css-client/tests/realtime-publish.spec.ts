/**
 * RealtimeClient WebSocket Publish Tests
 *
 * Tests for the requestPublish() method on RealtimeClient.
 * This feature sends a publish_request via WebSocket and waits for a
 * publish_result response from the server (DO handles flush + publish).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ReconnectingWebSocket options
interface MockWSOptions {
  maxRetries?: number;
  minReconnectionDelay?: number;
  maxReconnectionDelay?: number;
  reconnectionDelayGrowFactor?: number;
}

// Mock ReconnectingWebSocket (matching the pattern in realtime-delivery-ack.spec.ts)
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

  reconnect(): void {
    // no-op for tests
  }

  getSentTextMessages(): string[] {
    return this.sentMessages.filter((m): m is string => typeof m === 'string');
  }

  getSentJsonMessages<T>(): T[] {
    return this.getSentTextMessages().map((m) => JSON.parse(m) as T);
  }
}

// Store instances for test access
let mockWSInstances: MockReconnectingWebSocket[] = [];

// Mock partysocket module
vi.mock('partysocket', () => ({
  WebSocket: vi.fn().mockImplementation(function (url: string, protocols: string[] = [], options: MockWSOptions = {}) {
    const ws = new MockReconnectingWebSocket(url, protocols, options);
    mockWSInstances.push(ws);
    return ws;
  }),
}));

describe('RealtimeClient WebSocket Publish', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mockWSInstances = [];
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

  const getLatestWs = (): MockReconnectingWebSocket | undefined => {
    return mockWSInstances[mockWSInstances.length - 1];
  };

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

  it('should send publish_request message via WebSocket', async () => {
    const { client, ws } = await createConnectedClient();

    const promise = client.requestPublish();

    const sentMessages = ws.getSentJsonMessages<{
      type: string;
      requestId: string;
      timestamp: number;
    }>();

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].type).toBe('publish_request');
    expect(sentMessages[0].requestId).toBeDefined();
    expect(typeof sentMessages[0].requestId).toBe('string');
    expect(sentMessages[0].requestId.length).toBeGreaterThan(0);
    expect(sentMessages[0].timestamp).toBeDefined();
    expect(typeof sentMessages[0].timestamp).toBe('number');

    // Clean up: send success response
    ws.simulateMessage(
      JSON.stringify({
        type: 'publish_result',
        requestId: sentMessages[0].requestId,
        success: true,
        publishedVersionId: 'v-1',
        checkpoint: { id: 'cp-1' },
        timestamp: Date.now(),
      }),
    );
    await promise;
  });

  it('should resolve with publish result on success', async () => {
    const { client, ws } = await createConnectedClient();

    const promise = client.requestPublish();

    const sentMessages = ws.getSentJsonMessages<{
      type: string;
      requestId: string;
    }>();
    const requestId = sentMessages[0].requestId;

    ws.simulateMessage(
      JSON.stringify({
        type: 'publish_result',
        requestId,
        success: true,
        publishedVersionId: 'version-xyz',
        checkpoint: {
          id: 'cp-1',
          branchId: 'branch-1',
          name: 'Publish: document',
          checkpointType: 'publish',
          status: 'completed',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-03-11T00:00:00Z',
        },
        timestamp: Date.now(),
      }),
    );

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.publishedVersionId).toBe('version-xyz');
    expect(result.checkpoint).toBeDefined();
    expect(result.checkpoint!.id).toBe('cp-1');
  });

  it('should resolve with error result when publish fails on server', async () => {
    const { client, ws } = await createConnectedClient();

    const promise = client.requestPublish();

    const sentMessages = ws.getSentJsonMessages<{
      type: string;
      requestId: string;
    }>();
    const requestId = sentMessages[0].requestId;

    ws.simulateMessage(
      JSON.stringify({
        type: 'publish_result',
        requestId,
        success: false,
        error: 'Document not found',
        timestamp: Date.now(),
      }),
    );

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toBe('Document not found');
    expect(result.publishedVersionId).toBeUndefined();
    expect(result.checkpoint).toBeUndefined();
  });

  it('should reject when not connected', async () => {
    const { RealtimeClient } = await import('../src/realtime');

    const client = new RealtimeClient({
      baseUrl: 'ws://localhost:8787',
    });

    await expect(client.requestPublish()).rejects.toThrow('Not connected');
  });

  it('should reject on timeout when server does not respond', async () => {
    vi.useFakeTimers();

    const { client } = await createConnectedClient();

    const promise = client.requestPublish();

    const resultPromise = expect(promise).rejects.toThrow('Publish request timed out');

    // Advance past the publish timeout (30s)
    await vi.advanceTimersByTimeAsync(30001);

    await resultPromise;
  });

  it('should handle multiple concurrent publish requests independently', async () => {
    const { client, ws } = await createConnectedClient();

    const promise1 = client.requestPublish();
    const promise2 = client.requestPublish();

    const sentMessages = ws.getSentJsonMessages<{
      type: string;
      requestId: string;
    }>();

    expect(sentMessages).toHaveLength(2);

    const requestId1 = sentMessages[0].requestId;
    const requestId2 = sentMessages[1].requestId;

    expect(requestId1).not.toBe(requestId2);

    // Respond to the second one first
    ws.simulateMessage(
      JSON.stringify({
        type: 'publish_result',
        requestId: requestId2,
        success: true,
        publishedVersionId: 'v-2',
        checkpoint: { id: 'cp-2' },
        timestamp: Date.now(),
      }),
    );

    const result2 = await promise2;
    expect(result2.publishedVersionId).toBe('v-2');

    // Now respond to the first
    ws.simulateMessage(
      JSON.stringify({
        type: 'publish_result',
        requestId: requestId1,
        success: true,
        publishedVersionId: 'v-1',
        checkpoint: { id: 'cp-1' },
        timestamp: Date.now(),
      }),
    );

    const result1 = await promise1;
    expect(result1.publishedVersionId).toBe('v-1');
  });

  it('should ignore publish_result with non-matching requestId', async () => {
    vi.useFakeTimers();

    const { client, ws } = await createConnectedClient();

    const promise = client.requestPublish();

    // Send a publish_result with a wrong requestId
    ws.simulateMessage(
      JSON.stringify({
        type: 'publish_result',
        requestId: 'wrong-request-id',
        success: true,
        publishedVersionId: 'v-1',
        timestamp: Date.now(),
      }),
    );

    let resolved = false;
    promise.then(() => {
      resolved = true;
    }).catch(() => {
      // Expected timeout rejection
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    const resultPromise = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(30001);
    await resultPromise;
  });

  it('should clean up pending request on timeout', async () => {
    vi.useFakeTimers();

    const { client, ws } = await createConnectedClient();

    const promise = client.requestPublish();

    const sentMessages = ws.getSentJsonMessages<{
      type: string;
      requestId: string;
    }>();
    const requestId = sentMessages[0].requestId;

    const resultPromise = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(30001);
    await resultPromise;

    // After timeout, sending a late result should not cause errors
    ws.simulateMessage(
      JSON.stringify({
        type: 'publish_result',
        requestId,
        success: true,
        publishedVersionId: 'v-1',
        timestamp: Date.now(),
      }),
    );
  });

  it('should reject pending publish promises on disconnect', async () => {
    const { client } = await createConnectedClient();

    const promise = client.requestPublish();

    client.disconnect();

    await expect(promise).rejects.toThrow('Disconnected');
  });
});
