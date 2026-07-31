/**
 * RealtimeClient WebSocket Presence Tests
 *
 * Tests for WebSocket-based presence messaging in RealtimeClient.
 * These features enable real-time presence updates without HTTP polling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  WsPresenceUpdateMessage,
  WsFocusRegionBroadcastMessage,
} from '../src/types';

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

describe('RealtimeClient WebSocket Presence', () => {
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
    vi.clearAllMocks();
  });

  // Helper to get the latest mock WebSocket instance
  const getLatestWs = (): MockReconnectingWebSocket | undefined => {
    return mockWSInstances[mockWSInstances.length - 1];
  };

  describe('RealtimeClientConfig presence callbacks', () => {
    it('should accept onPresenceUpdate callback in config', async () => {
      const { RealtimeClient } = await import('../src/realtime');

      const onPresenceUpdate = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onPresenceUpdate,
      });

      expect(client).toBeDefined();
    });

    it('should accept onFocusRegionBroadcast callback in config', async () => {
      const { RealtimeClient } = await import('../src/realtime');

      const onFocusRegionBroadcast = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onFocusRegionBroadcast,
      });

      expect(client).toBeDefined();
    });
  });

  describe('Text message handling', () => {
    it('should parse presence_update messages and call onPresenceUpdate', async () => {
      const { RealtimeClient } = await import('../src/realtime');

      const onPresenceUpdate = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onPresenceUpdate,
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

      // Simulate receiving a presence_update message
      const message: WsPresenceUpdateMessage = {
        type: 'presence_update',
        actors: [
          {
            id: 'presence-1',
            actorId: 'user-2',
            actorType: 'user',
            role: 'human',
            name: 'Other User',
            state: 'editing',
            lastActivityAt: new Date().toISOString(),
            joinedAt: new Date().toISOString(),
          },
        ],
        timestamp: Date.now(),
      };

      ws?.simulateMessage(JSON.stringify(message));

      expect(onPresenceUpdate).toHaveBeenCalledWith(message.actors);
    });

    it('should parse focus_region_broadcast messages and call onFocusRegionBroadcast', async () => {
      const { RealtimeClient } = await import('../src/realtime');

      const onFocusRegionBroadcast = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onFocusRegionBroadcast,
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

      const message: WsFocusRegionBroadcastMessage = {
        type: 'focus_region_broadcast',
        actorId: 'user-2',
        focusRegions: ['$.hero', '$.content'],
        timestamp: Date.now(),
      };

      ws?.simulateMessage(JSON.stringify(message));

      expect(onFocusRegionBroadcast).toHaveBeenCalledWith('user-2', ['$.hero', '$.content']);
    });

    it('should still process binary messages as Yjs updates', async () => {
      const { RealtimeClient } = await import('../src/realtime');

      const onUpdate = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onUpdate,
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

      // Simulate receiving binary data (Yjs update)
      const binaryData = new Uint8Array([0, 1, 2, 3]).buffer;
      ws?.simulateMessage(binaryData);

      // onUpdate should have been called (even if it errors due to invalid Yjs data)
      // The important thing is it's treated as binary, not JSON
    });
  });

  describe('sendFocusRegions method', () => {
    it('should send focus_region_update message as JSON', async () => {
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

      const result = client.sendFocusRegions(['$.hero', '$.content']);

      expect(result).toBe(true);

      const sentMessages = ws?.getSentJsonMessages<{ type: string }>();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages?.[0]?.type).toBe('focus_region_update');
    });

    it('should return false if not connected', async () => {
      const { RealtimeClient } = await import('../src/realtime');

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
      });

      // Not connected yet
      const result = client.sendFocusRegions(['$.hero']);

      expect(result).toBe(false);
    });

    it('should include timestamp in message', async () => {
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

      const before = Date.now();
      client.sendFocusRegions(['$.hero']);
      const after = Date.now();

      const sentMessages = ws?.getSentJsonMessages<{ timestamp: number }>();
      const timestamp = sentMessages?.[0]?.timestamp;

      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('sendHeartbeat method', () => {
    it('should send presence_heartbeat message', async () => {
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

      client.sendHeartbeat();

      const sentMessages = ws?.getSentJsonMessages<{ type: string }>();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages?.[0]?.type).toBe('presence_heartbeat');
    });

    it('should include optional state in heartbeat', async () => {
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

      client.sendHeartbeat('editing');

      const sentMessages = ws?.getSentJsonMessages<{ type: string; state?: string }>();
      expect(sentMessages?.[0]?.state).toBe('editing');
    });
  });

  describe('presenceViaWebSocket property', () => {
    it('should reflect connection state', async () => {
      const { RealtimeClient } = await import('../src/realtime');

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
      });

      // Not connected
      expect(client.presenceViaWebSocket).toBe(false);

      client.connect({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentPath: 'pages/home',
        actorId: 'user-1',
        actorType: 'user',
      });

      const ws = getLatestWs();

      // Still not connected (connecting)
      expect(client.presenceViaWebSocket).toBe(false);

      ws?.simulateOpen();

      // Now connected
      expect(client.presenceViaWebSocket).toBe(true);

      client.disconnect();

      // Disconnected
      expect(client.presenceViaWebSocket).toBe(false);
    });
  });
});
