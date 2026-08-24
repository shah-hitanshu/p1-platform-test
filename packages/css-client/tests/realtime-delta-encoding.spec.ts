/**
 * Delta Encoding on WebSocket Reconnect Tests (TDD)
 *
 * Tests for sending Yjs state vector as a query parameter on reconnect
 * so the server responds with only the delta instead of full CRDT history.
 *
 * - Initial connect: no stateVector parameter (client has no prior state)
 * - Reconnect: stateVector parameter with base64-encoded Y.encodeStateVector()
 * - Document state is correct after reconnect with delta
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

// Mock ReconnectingWebSocket options
interface MockWSOptions {
  maxRetries?: number;
  minReconnectionDelay?: number;
  maxReconnectionDelay?: number;
  reconnectionDelayGrowFactor?: number;
}

// Mock ReconnectingWebSocket that supports URL function (matching PartySocket behavior)
class MockReconnectingWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockReconnectingWebSocket.CONNECTING;
  binaryType = 'arraybuffer';
  retryCount = 0;

  // Store resolved URL for assertions
  url: string;
  // Store the raw URL provider (string or function)
  private urlProvider: string | (() => string | Promise<string>);
  protocols: string[];
  options: MockWSOptions;

  private listeners = new Map<string, Set<EventListener>>();

  constructor(
    url: string | (() => string | Promise<string>),
    protocols: string[] = [],
    options: MockWSOptions = {},
  ) {
    this.urlProvider = url;
    // Resolve URL for initial connection
    if (typeof url === 'string') {
      this.url = url;
    } else {
      // Call the function to resolve the URL
      const result = url();
      if (typeof result === 'string') {
        this.url = result;
      } else {
        this.url = ''; // Will be resolved async
        result.then((resolved) => {
          this.url = resolved;
        });
      }
    }
    this.protocols = protocols;
    this.options = options;
    // Simulate async connection
    setTimeout(() => this.simulateOpen(), 0);
  }

  /**
   * Simulate a reconnection by re-resolving the URL provider and firing open.
   * This mimics what PartySocket does on reconnect.
   */
  async simulateReconnectWithUrlResolve(): Promise<void> {
    if (typeof this.urlProvider === 'function') {
      const result = this.urlProvider();
      this.url = typeof result === 'string' ? result : await result;
    }
    this.readyState = MockReconnectingWebSocket.OPEN;
    const event = new Event('open');
    this.dispatchEvent(event);
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

  reconnect = vi.fn();

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

  send = vi.fn();
  close = vi.fn(() => {
    this.simulateClose();
  });
}

// Store instances for test access
let mockWSInstances: MockReconnectingWebSocket[] = [];

// Capture the URL provider passed to the constructor
let capturedUrlProviders: (string | (() => string | Promise<string>))[] = [];

// Mock partysocket module
vi.mock('partysocket', () => ({
  WebSocket: vi.fn().mockImplementation(
    function (
      url: string | (() => string | Promise<string>),
      protocols: string[] = [],
      options: MockWSOptions = {},
    ) {
      capturedUrlProviders.push(url);
      const ws = new MockReconnectingWebSocket(url, protocols, options);
      mockWSInstances.push(ws);
      return ws;
    },
  ),
}));

describe('Delta encoding on WebSocket reconnect', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mockWSInstances = [];
    capturedUrlProviders = [];
    // Re-mock to ensure fresh instances
    const partysocket = await import('partysocket');
    vi.mocked(partysocket.WebSocket).mockImplementation(
      function (
        url: string | (() => string | Promise<string>),
        protocols: string[] = [],
        options: MockWSOptions = {},
      ) {
        capturedUrlProviders.push(url);
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

  it('should omit stateVector on the initial connect', async () => {
    const { RealtimeClient } = await import('../src/realtime.js');

    const client = new RealtimeClient({
      baseUrl: 'ws://localhost:8787',
    });

    client.connect({
      siteId: 'site-123',
      branchId: 'branch-456',
      documentPath: 'pages/home',
      actorId: 'user-789',
      actorType: 'user',
    });

    // Resolve URL from the provider
    const urlProvider = capturedUrlProviders[0];
    let resolvedUrl: string;
    if (typeof urlProvider === 'function') {
      const result = urlProvider();
      resolvedUrl = typeof result === 'string' ? result : await result;
    } else {
      resolvedUrl = urlProvider;
    }

    // A fresh tab seeded from REST must not send its SV: the local clientId is
    // unknown to the server and would look like a diverged stale tab.
    expect(resolvedUrl).not.toContain('stateVector');

    client.disconnect();
  });

  it('should include stateVector on reconnect', async () => {
    const { RealtimeClient } = await import('../src/realtime.js');

    const client = new RealtimeClient({
      baseUrl: 'ws://localhost:8787',
    });

    client.connect({
      siteId: 'site-123',
      branchId: 'branch-456',
      documentPath: 'pages/home',
      actorId: 'user-789',
      actorType: 'user',
    });

    // Initial connection
    await vi.advanceTimersByTimeAsync(10);
    expect(client.isConnected()).toBe(true);

    // The URL provider should be a function (for dynamic URL on reconnect)
    const urlProvider = capturedUrlProviders[0];
    expect(typeof urlProvider).toBe('function');

    // Simulate reconnection: call the URL provider again
    // After hasConnectedOnce is true, it should include stateVector
    const reconnectUrl =
      typeof urlProvider === 'function'
        ? await Promise.resolve(urlProvider())
        : urlProvider;

    expect(reconnectUrl).toContain('stateVector=');

    client.disconnect();
  });

  it('should encode state vector as base64', async () => {
    const { RealtimeClient } = await import('../src/realtime.js');

    const client = new RealtimeClient({
      baseUrl: 'ws://localhost:8787',
    });

    client.connect({
      siteId: 'site-123',
      branchId: 'branch-456',
      documentPath: 'pages/home',
      actorId: 'user-789',
      actorType: 'user',
    });

    // Initial connection
    await vi.advanceTimersByTimeAsync(10);

    // Apply some data to the Y.Doc so the state vector is non-trivial
    const ydoc = client.getYDoc();
    const root = ydoc.getMap('root');
    root.set('title', 'Test');

    // Get the URL provider and call it (simulating reconnect)
    const urlProvider = capturedUrlProviders[0];
    const reconnectUrl =
      typeof urlProvider === 'function'
        ? await Promise.resolve(urlProvider())
        : urlProvider;

    // Extract the stateVector parameter
    const url = new URL(reconnectUrl);
    const stateVectorParam = url.searchParams.get('stateVector');
    expect(stateVectorParam).not.toBeNull();

    // Decode the base64 state vector and verify it's valid
    const decoded = Uint8Array.from(atob(stateVectorParam!), (c) => c.charCodeAt(0));

    // The decoded value should be a valid Yjs state vector
    // Verify by using it to create a delta update (should not throw)
    const expectedSv = Y.encodeStateVector(ydoc);
    expect(decoded).toEqual(expectedSv);

    client.disconnect();
  });

  it('should produce correct document state after reconnect with delta', async () => {
    const { RealtimeClient } = await import('../src/realtime.js');

    const onUpdate = vi.fn();
    const client = new RealtimeClient({
      baseUrl: 'ws://localhost:8787',
      onUpdate,
    });

    client.connect({
      siteId: 'site-123',
      branchId: 'branch-456',
      documentPath: 'pages/home',
      actorId: 'user-789',
      actorType: 'user',
    });

    // Initial connection
    await vi.advanceTimersByTimeAsync(10);

    // Simulate receiving initial document state from server
    const serverDoc = new Y.Doc();
    const serverRoot = serverDoc.getMap('root');
    serverRoot.set('title', 'Original Title');
    serverRoot.set('body', 'Original Body');
    const fullState = Y.encodeStateAsUpdate(serverDoc);
    mockWSInstances[0].simulateMessage(fullState.buffer);

    // Verify client has the data
    const snapshot1 = client.getSnapshot();
    expect(snapshot1).toEqual(
      expect.objectContaining({ title: 'Original Title', body: 'Original Body' }),
    );

    // Server makes additional changes while client is "disconnected"
    serverRoot.set('title', 'Updated Title');
    serverRoot.set('footer', 'New Footer');

    // Create a delta update (what the server would send with state vector)
    const clientSv = Y.encodeStateVector(client.getYDoc());
    const deltaUpdate = Y.encodeStateAsUpdate(serverDoc, clientSv);

    // Simulate reconnection: client receives only the delta
    mockWSInstances[0].simulateMessage(deltaUpdate.buffer);

    // Client should have the complete merged state
    const snapshot2 = client.getSnapshot();
    expect(snapshot2).toEqual(
      expect.objectContaining({
        title: 'Updated Title',
        body: 'Original Body',
        footer: 'New Footer',
      }),
    );

    client.disconnect();
  });

  it('sends local-only delta after receiving sync_baseline on reconnect', async () => {
    const { RealtimeClient } = await import('../src/realtime.js');

    const client = new RealtimeClient({
      baseUrl: 'ws://localhost:8787',
    });

    client.connect({
      siteId: 'site-123',
      branchId: 'branch-456',
      documentPath: 'pages/home',
      actorId: 'user-789',
      actorType: 'user',
    });

    await vi.advanceTimersByTimeAsync(10);

    // Make a local edit
    const ydoc = client.getYDoc();
    const root = ydoc.getMap('root');
    root.set('localEdit', 'offline change');

    mockWSInstances[0].send.mockClear();

    // Server sends sync_baseline with an empty state vector (knows nothing)
    const emptySv = Y.encodeStateVector(new Y.Doc());
    const svBase64 = btoa(String.fromCharCode(...emptySv));
    mockWSInstances[0].simulateMessage(JSON.stringify({
      type: 'sync_baseline',
      gate: 'open',
      serverStateVector: svBase64,
      timestamp: Date.now(),
    }));

    // Client should have sent the delta containing the local edit
    expect(mockWSInstances[0].send.mock.calls.length).toBeGreaterThan(0);

    const sentData = mockWSInstances[0].send.mock.calls[0]![0] as Uint8Array;
    const verifyDoc = new Y.Doc();
    Y.applyUpdate(verifyDoc, sentData);
    expect(verifyDoc.getMap('root').get('localEdit')).toBe('offline change');

    client.disconnect();
  });
});
