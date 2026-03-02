/**
 * RealtimeClient Session Authorization Tests (TDD)
 *
 * Tests for agent session authorization via sessionId parameter.
 * The sessionId is obtained from startEdit() and passed to the WebSocket connection
 * to enable server-side enforcement of the Agent Politeness Protocol.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ReconnectingWebSocket options
interface MockWSOptions {
  maxRetries?: number;
  minReconnectionDelay?: number;
  maxReconnectionDelay?: number;
  reconnectionDelayGrowFactor?: number;
}

// Mock ReconnectingWebSocket
class MockReconnectingWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockReconnectingWebSocket.CONNECTING;
  binaryType: string = 'arraybuffer';
  retryCount: number = 0;

  // Store constructor args for verification
  url: string;
  protocols: string[];
  options: MockWSOptions;

  private listeners: Map<string, Set<EventListener>> = new Map();

  constructor(url: string, protocols: string[] = [], options: MockWSOptions = {}) {
    this.url = url;
    this.protocols = protocols;
    this.options = options;
    // Simulate async connection
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

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockReconnectingWebSocket.CLOSED;
    const event = new CloseEvent('close', { code, reason });
    this.dispatchEvent(event);
  }

  simulateError(): void {
    const event = new Event('error');
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

  send = vi.fn();
  close = vi.fn(() => {
    this.simulateClose();
  });
}

// Store instances for test access
let mockWSInstances: MockReconnectingWebSocket[] = [];

// Mock partysocket module
vi.mock('partysocket', () => ({
  WebSocket: vi.fn((url: string, protocols: string[] = [], options: MockWSOptions = {}) => {
    const ws = new MockReconnectingWebSocket(url, protocols, options);
    mockWSInstances.push(ws);
    return ws;
  }),
}));

describe('RealtimeClient Session Authorization', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mockWSInstances = [];
    // Re-mock to ensure fresh instances
    const partysocket = await import('partysocket');
    vi.mocked(partysocket.WebSocket).mockImplementation(
      (url: string, protocols: string[] = [], options: MockWSOptions = {}) => {
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

  describe('ConnectionParams sessionId', () => {
    it('should accept sessionId in connection params', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
      });

      // Should not throw when providing sessionId
      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'agent-789',
        actorType: 'agent',
        sessionId: 'session-abc',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(client.isConnected()).toBe(true);

      client.disconnect();
    });

    it('should include sessionId as query param for agent connections', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');
      const { WebSocket } = await import('partysocket');

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'agent-789',
        actorType: 'agent',
        sessionId: 'session-abc',
      });

      // Resolve the URL provider and verify sessionId in query params
      const urlProvider = vi.mocked(WebSocket).mock.calls[0][0] as () => string;
      const resolvedUrl = urlProvider();
      expect(resolvedUrl).toContain('sessionId=session-abc');

      client.disconnect();
    });

    it('should not include sessionId query param when not provided', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');
      const { WebSocket } = await import('partysocket');

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'agent-789',
        actorType: 'agent',
      });

      const urlProvider = vi.mocked(WebSocket).mock.calls[0][0] as () => string;
      const resolvedUrl = urlProvider();
      expect(resolvedUrl).not.toContain('sessionId=');

      client.disconnect();
    });

    it('should include sessionId for agent type but not require for user type', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');
      const { WebSocket } = await import('partysocket');

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
      });

      // User type without sessionId should work
      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'user-789',
        actorType: 'user',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(client.isConnected()).toBe(true);

      const urlProvider = vi.mocked(WebSocket).mock.calls[0][0] as () => string;
      const resolvedUrl = urlProvider();
      expect(resolvedUrl).not.toContain('sessionId=');

      client.disconnect();
    });
  });

  describe('onAuthorizationError callback', () => {
    it('should accept onAuthorizationError callback in config', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const onAuthorizationError = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onAuthorizationError,
      });

      expect(client).toBeDefined();
    });

    it('should call onAuthorizationError when WebSocket closes with code 4403', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const onAuthorizationError = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onAuthorizationError,
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'agent-789',
        actorType: 'agent',
        sessionId: 'invalid-session',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate server closing connection due to authorization failure
      mockWSInstances[0].simulateClose(4403, 'Session not authorized');

      expect(onAuthorizationError).toHaveBeenCalled();
      expect(onAuthorizationError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Session not authorized'),
        }),
      );

      client.disconnect();
    });

    it('should not call onAuthorizationError for normal close codes', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const onAuthorizationError = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onAuthorizationError,
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'agent-789',
        actorType: 'agent',
        sessionId: 'valid-session',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate normal close
      mockWSInstances[0].simulateClose(1000, 'Normal closure');

      expect(onAuthorizationError).not.toHaveBeenCalled();
    });

    it('should disconnect and not attempt reconnection on authorization failure', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const onReconnecting = vi.fn();
      const onDisconnect = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onReconnecting,
        onDisconnect,
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'agent-789',
        actorType: 'agent',
        sessionId: 'invalid-session',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate authorization failure close
      mockWSInstances[0].simulateClose(4403, 'Session not authorized');

      // Should call onDisconnect, not onReconnecting
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(onDisconnect).toHaveBeenCalled();
      expect(onReconnecting).not.toHaveBeenCalled();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('authorization close codes', () => {
    it('should treat 4403 as authorization failure', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const onAuthorizationError = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onAuthorizationError,
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'agent-789',
        actorType: 'agent',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      mockWSInstances[0].simulateClose(4403, 'Forbidden');

      expect(onAuthorizationError).toHaveBeenCalled();
    });

    it('should treat 4401 as authentication failure', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const onAuthorizationError = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onAuthorizationError,
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'agent-789',
        actorType: 'agent',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      mockWSInstances[0].simulateClose(4401, 'Unauthorized');

      expect(onAuthorizationError).toHaveBeenCalled();
    });
  });
});
