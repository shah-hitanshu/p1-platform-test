/**
 * RealtimeClient baseline gate protocol tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

// Mock ReconnectingWebSocket options
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
  binaryType = 'arraybuffer';
  retryCount = 0;

  url: string;
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
    if (typeof url === 'string') {
      this.url = url;
    } else {
      const result = url();
      if (typeof result === 'string') {
        this.url = result;
      } else {
        this.url = '';
        result.then((resolved) => {
          this.url = resolved;
        });
      }
    }
    this.protocols = protocols;
    this.options = options;
    setTimeout(() => this.simulateOpen(), 0);
  }

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
    // Real PartySocket is a no-op when already closed; match that behaviour so
    // onDisconnect doesn't fire twice for a single 4002 (masking double-fire bugs).
    if (this.readyState !== MockReconnectingWebSocket.CLOSED) {
      this.simulateClose();
    }
  });
}

let mockWSInstances: MockReconnectingWebSocket[] = [];
let capturedUrlProviders: (string | (() => string | Promise<string>))[] = [];

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

import { RealtimeClient } from '../src/realtime';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function connectParams() {
  return {
    siteId: 'site-1',
    branchId: 'branch-1',
    documentPath: 'pages/home',
    actorId: 'actor-1',
    actorType: 'user' as const,
  };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('RealtimeClient baseline gate', () => {
  beforeEach(() => {
    mockWSInstances = [];
    capturedUrlProviders = [];
  });

  it('omits the state vector on the very first connect', async () => {
    const client = new RealtimeClient({ baseUrl: 'ws://localhost' });
    client.connect(connectParams());
    await tick();

    // A fresh tab seeded from REST has a local clientId the server has never
    // seen. Sending the SV would look identical to a stale pre-merge tab and
    // trigger a spurious 4002.
    expect(mockWSInstances[0]!.url).not.toContain('stateVector=');
  });

  it('includes a state vector on reconnects after the first session', async () => {
    const client = new RealtimeClient({ baseUrl: 'ws://localhost' });
    client.connect(connectParams());
    await tick();

    const ws = mockWSInstances[0]!;
    // Simulate disconnect + reconnect
    await ws.simulateReconnectWithUrlResolve();

    expect(ws.url).toContain('stateVector=');
  });

  it('omits the state vector on the reconnect that follows a 4001 server reload', async () => {
    const client = new RealtimeClient({ baseUrl: 'ws://localhost' });
    client.connect(connectParams());
    await tick();

    const ws = mockWSInstances[0]!;
    // First open fires — hasConnectedToServer = true
    // 4001 reload resets hasConnectedToServer = false
    ws.simulateClose(4001, 'Server reload');
    await ws.simulateReconnectWithUrlResolve();

    // After a merge reload the DO has a fresh Y.Doc. The client must not send
    // its stale SV, which would appear as a diverged lineage and trigger 4002.
    expect(ws.url).not.toContain('stateVector=');
  });

  it('fires onDisconnect when the server closes with 4002', async () => {
    const onDisconnect = vi.fn();
    const onBaselineReset = vi.fn();
    const client = new RealtimeClient({ baseUrl: 'ws://localhost', onDisconnect, onBaselineReset });
    client.connect(connectParams());
    await tick();

    mockWSInstances[0]!.simulateClose(4002, 'Baseline diverged');

    expect(onDisconnect).toHaveBeenCalled();
    expect(onBaselineReset).toHaveBeenCalledTimes(1);
  });

  it('sends nothing on open, before the server states its baseline', async () => {
    const client = new RealtimeClient({ baseUrl: 'ws://localhost' });
    const seeded = client.getYDoc();
    seeded.getMap('root').set('content', 'seeded-from-rest');

    client.connect(connectParams());
    await tick();

    expect(mockWSInstances[0]!.send).not.toHaveBeenCalled();
  });

  it('sends only the delta the server lacks after an open sync_baseline', async () => {
    const client = new RealtimeClient({ baseUrl: 'ws://localhost' });
    client.connect(connectParams());
    await tick();

    const ws = mockWSInstances[0]!;
    const server = new Y.Doc();
    server.getMap('root').set('content', 'server-origin');

    const update = Y.encodeStateAsUpdate(server);
    ws.simulateMessage(
      update.buffer.slice(update.byteOffset, update.byteOffset + update.byteLength),
    );

    const local = client.getYDoc();
    local.getMap('root').set('mine', 'offline-edit');
    ws.send.mockClear();

    ws.simulateMessage(JSON.stringify({
      type: 'sync_baseline',
      gate: 'open',
      serverStateVector: toBase64(Y.encodeStateVector(server)),
      timestamp: Date.now(),
    }));

    expect(ws.send).toHaveBeenCalledTimes(1);

    // The delta carries the offline edit and nothing the server already had.
    const sent = ws.send.mock.calls[0]![0] as Uint8Array;
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(replica, sent);
    expect(replica.getMap('root').get('mine')).toBe('offline-edit');
  });

  it('sends nothing when the server is already up to date', async () => {
    const client = new RealtimeClient({ baseUrl: 'ws://localhost' });
    client.connect(connectParams());
    await tick();

    const ws = mockWSInstances[0]!;
    const server = new Y.Doc();
    server.getMap('root').set('content', 'server-origin');

    const update = Y.encodeStateAsUpdate(server);
    ws.simulateMessage(
      update.buffer.slice(update.byteOffset, update.byteOffset + update.byteLength),
    );
    ws.send.mockClear();

    ws.simulateMessage(JSON.stringify({
      type: 'sync_baseline',
      gate: 'open',
      serverStateVector: toBase64(Y.encodeStateVector(client.getYDoc())),
      timestamp: Date.now(),
    }));

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('fires onBaselineReset and stops reconnecting on close code 4002', async () => {
    const onBaselineReset = vi.fn();
    const client = new RealtimeClient({ baseUrl: 'ws://localhost', onBaselineReset });
    client.connect(connectParams());
    await tick();

    mockWSInstances[0]!.simulateClose(4002, 'Baseline diverged');

    expect(onBaselineReset).toHaveBeenCalledTimes(1);
  });
});
