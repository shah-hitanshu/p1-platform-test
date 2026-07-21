/**
 * RealtimeClient Token Refresh Tests (TDD - red phase)
 *
 * Tests for silent token refresh on WebSocket reconnection:
 * - tokenRefresher config field is accepted
 * - On non-intentional close, tokenRefresher is called
 * - After refresh, urlProvider returns URL with new token
 * - Intentional disconnect does NOT trigger tokenRefresher
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket as MockWSCtor } from 'partysocket';

// ---------------------------------------------------------------------------
// Mock partysocket (same pattern as realtime.spec.ts)
// ---------------------------------------------------------------------------
interface MockWSOptions {
  maxRetries?: number;
  minReconnectionDelay?: number;
  maxReconnectionDelay?: number;
  reconnectionDelayGrowFactor?: number;
}

class MockReconnectingWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockReconnectingWebSocket.CONNECTING;
  binaryType: string = 'arraybuffer';
  retryCount: number = 0;

  // url is the urlProvider function from RealtimeClient.connect()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  url: any;
  protocols: string[];
  options: MockWSOptions;

  private listeners: Map<string, Set<EventListener>> = new Map();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(url: any, protocols: string[] = [], options: MockWSOptions = {}) {
    this.url = url;
    this.protocols = protocols;
    this.options = options;
    setTimeout(() => this.simulateOpen(), 0);
  }

  simulateOpen(): void {
    this.readyState = MockReconnectingWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockReconnectingWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
  }

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    this.listeners.get(event.type)?.forEach((l) => l(event));
    return true;
  }

  send = vi.fn();
  reconnect = vi.fn();
  close = vi.fn(() => {
    this.simulateClose();
  });
}

let mockWSInstances: MockReconnectingWebSocket[] = [];

vi.mock('partysocket', () => ({
  WebSocket: vi.fn().mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function (url: any, protocols: string[] = [], options: MockWSOptions = {}) {
      const ws = new MockReconnectingWebSocket(url, protocols, options);
      mockWSInstances.push(ws);
      return ws;
    },
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'ws://localhost:8787';
const INITIAL_API_KEY = 'initial-api-key-abc';

const CONNECTION_PARAMS = {
  siteId: 'site-1',
  branchId: 'branch-1',
  documentPath: 'pages/home',
  actorId: 'user-123',
  actorType: 'user' as const,
};

/** Call the urlProvider stored on the mock WS instance and return the resolved URL string. */
function resolveUrl(instance: MockReconnectingWebSocket): string {
  const provider = instance.url;
  return typeof provider === 'function' ? (provider() as string) : (provider as string);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RealtimeClient tokenRefresher', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mockWSInstances = [];

    const partysocket = await import('partysocket');
    vi.mocked(partysocket.WebSocket).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function (url: any, protocols: string[] = [], options: MockWSOptions = {}) {
        const ws = new MockReconnectingWebSocket(url, protocols, options);
        mockWSInstances.push(ws);
        return ws as unknown as ReturnType<typeof MockWSCtor>;
      },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('accepts tokenRefresher in RealtimeClientConfig without error', async () => {
    const { RealtimeClient } = await import('../src/realtime.js');
    const tokenRefresher = vi.fn().mockResolvedValue('fresh-token');

    expect(() => {
      new RealtimeClient({
        baseUrl: BASE_URL,
        apiKey: INITIAL_API_KEY,
        tokenRefresher,
      });
    }).not.toThrow();
  });

  it('uses apiKey in WebSocket URL on initial connect', async () => {
    const { RealtimeClient } = await import('../src/realtime.js');
    const tokenRefresher = vi.fn().mockResolvedValue('fresh-token');

    const client = new RealtimeClient({
      baseUrl: BASE_URL,
      apiKey: INITIAL_API_KEY,
      tokenRefresher,
    });

    client.connect(CONNECTION_PARAMS);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockWSInstances).toHaveLength(1);
    const initialUrl = resolveUrl(mockWSInstances[0]!);
    expect(initialUrl).toContain(`apiKey=${INITIAL_API_KEY}`);

    client.disconnect();
  });

  it('calls tokenRefresher when connection closes unexpectedly', async () => {
    const { RealtimeClient } = await import('../src/realtime.js');
    const tokenRefresher = vi.fn().mockResolvedValue('fresh-token-after-disconnect');

    const client = new RealtimeClient({
      baseUrl: BASE_URL,
      apiKey: INITIAL_API_KEY,
      tokenRefresher,
    });

    client.connect(CONNECTION_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10)); // let open fire

    // Simulate an unexpected connection close (non-intentional)
    const ws = mockWSInstances[0]!;
    ws.simulateClose(1006, 'Connection lost');

    // Give the async refresh a tick to run
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(tokenRefresher).toHaveBeenCalledTimes(1);

    client.disconnect();
  });

  it('does NOT call tokenRefresher on intentional disconnect', async () => {
    const { RealtimeClient } = await import('../src/realtime.js');
    const tokenRefresher = vi.fn().mockResolvedValue('should-not-be-called');

    const client = new RealtimeClient({
      baseUrl: BASE_URL,
      apiKey: INITIAL_API_KEY,
      tokenRefresher,
    });

    client.connect(CONNECTION_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Intentional disconnect
    client.disconnect();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(tokenRefresher).not.toHaveBeenCalled();
  });

  it('uses refreshed token in urlProvider after unexpected close', async () => {
    const FRESH_TOKEN = 'refreshed-token-xyz-999';
    const { RealtimeClient } = await import('../src/realtime.js');
    const tokenRefresher = vi.fn().mockResolvedValue(FRESH_TOKEN);

    const client = new RealtimeClient({
      baseUrl: BASE_URL,
      apiKey: INITIAL_API_KEY,
      tokenRefresher,
    });

    client.connect(CONNECTION_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const ws = mockWSInstances[0]!;

    // Confirm initial URL uses initial API key
    const initialUrl = resolveUrl(ws);
    expect(initialUrl).toContain(`apiKey=${INITIAL_API_KEY}`);
    expect(initialUrl).not.toContain(FRESH_TOKEN);

    // Simulate unexpected close — triggers fire-and-forget token refresh
    ws.simulateClose(1006, 'Connection lost');

    // Wait for async refresh to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Now the urlProvider should return the new token
    const refreshedUrl = resolveUrl(ws);
    expect(refreshedUrl).toContain(`apiKey=${FRESH_TOKEN}`);

    client.disconnect();
  });

  it('does not update token when tokenRefresher is not provided', async () => {
    const { RealtimeClient } = await import('../src/realtime.js');

    const client = new RealtimeClient({
      baseUrl: BASE_URL,
      apiKey: INITIAL_API_KEY,
      // no tokenRefresher
    });

    client.connect(CONNECTION_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const ws = mockWSInstances[0]!;
    ws.simulateClose(1006, 'Connection lost');
    await new Promise((resolve) => setTimeout(resolve, 20));

    // URL should still use initial key
    const url = resolveUrl(ws);
    expect(url).toContain(`apiKey=${INITIAL_API_KEY}`);

    client.disconnect();
  });
});
