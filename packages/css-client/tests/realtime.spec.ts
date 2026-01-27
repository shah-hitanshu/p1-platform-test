/**
 * Phase 2.1: RealtimeClient Tests (TDD)
 *
 * Tests for the WebSocket-based real-time collaboration client.
 * Uses Yjs for CRDT-based conflict-free editing.
 * Uses ReconnectingWebSocket from partysocket for automatic reconnection.
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
  private onopen: ((event: Event) => void) | null = null;
  private onclose: ((event: CloseEvent) => void) | null = null;
  private onerror: ((event: Event) => void) | null = null;
  private onmessage: ((event: MessageEvent) => void) | null = null;

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

  /**
   * Simulate PartySocket attempting to reconnect by incrementing retryCount.
   * The RealtimeClient polls retryCount to detect reconnection attempts.
   */
  simulateReconnectAttempt(): void {
    this.retryCount++;
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
    // Also call the on* handlers
    switch (event.type) {
      case 'open':
        this.onopen?.(event);
        break;
      case 'close':
        this.onclose?.(event as CloseEvent);
        break;
      case 'error':
        this.onerror?.(event);
        break;
      case 'message':
        this.onmessage?.(event as MessageEvent);
        break;
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

// Mock partysocket module - export WebSocket (ReconnectingWebSocket)
vi.mock('partysocket', () => ({
  WebSocket: vi.fn((url: string, protocols: string[] = [], options: MockWSOptions = {}) => {
    const ws = new MockReconnectingWebSocket(url, protocols, options);
    mockWSInstances.push(ws);
    return ws;
  }),
}));

describe('Phase 2.1: RealtimeClient', () => {
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

  describe('constructor', () => {
    it('should create a RealtimeClient with config', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
      });

      expect(client).toBeDefined();
      expect(client.isConnected()).toBe(false);
    });

    it('should accept callback handlers in config', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const onUpdate = vi.fn();
      const onConnect = vi.fn();
      const onDisconnect = vi.fn();
      const onError = vi.fn();
      const onReconnecting = vi.fn();

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onUpdate,
        onConnect,
        onDisconnect,
        onError,
        onReconnecting,
      });

      expect(client).toBeDefined();
    });

    it('should accept reconnection configuration', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        reconnection: {
          maxRetries: 5,
          minReconnectionDelay: 500,
          maxReconnectionDelay: 10000,
          reconnectionDelayGrowFactor: 2,
        },
      });

      expect(client).toBeDefined();
    });
  });

  describe('connect', () => {
    it('should establish WebSocket connection with correct URL', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');
      const { WebSocket } = await import('partysocket');

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

      // Check that WebSocket was created with correct URL
      expect(WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('ws://localhost:8787'),
        expect.any(Array),
        expect.any(Object),
      );
      // Verify URL contains the expected route
      expect(WebSocket).toHaveBeenCalledWith(
        expect.stringContaining(
          '/api/sites/site-123/branches/branch-456/documents/pages%2Fhome/connect',
        ),
        expect.any(Array),
        expect.any(Object),
      );

      client.disconnect();
    });

    it('should call onConnect callback when connection opens', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const onConnect = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onConnect,
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'user-789',
        actorType: 'user',
      });

      // Wait for mock WebSocket to "open"
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onConnect).toHaveBeenCalled();
      expect(client.isConnected()).toBe(true);

      client.disconnect();
    });

    it('should include actor info in URL as query params', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');
      const { WebSocket } = await import('partysocket');

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

      // WebSocket connections can't send headers, so actor info goes in URL
      expect(WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('actorId=user-789'),
        expect.any(Array),
        expect.any(Object),
      );
      expect(WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('actorType=user'),
        expect.any(Array),
        expect.any(Object),
      );

      client.disconnect();
    });

    it('should pass reconnection config to WebSocket', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');
      const { WebSocket } = await import('partysocket');

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        reconnection: {
          maxRetries: 5,
          minReconnectionDelay: 500,
          maxReconnectionDelay: 10000,
          reconnectionDelayGrowFactor: 2,
        },
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'user-789',
        actorType: 'user',
      });

      expect(WebSocket).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          maxRetries: 5,
          minReconnectionDelay: 500,
          maxReconnectionDelay: 10000,
          reconnectionDelayGrowFactor: 2,
        }),
      );

      client.disconnect();
    });
  });

  describe('disconnect', () => {
    it('should close PartySocket connection', async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(client.isConnected()).toBe(true);

      client.disconnect();

      expect(mockWSInstances[0].close).toHaveBeenCalled();
    });

    it('should call onDisconnect callback on intentional disconnect', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const onDisconnect = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onDisconnect,
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'user-789',
        actorType: 'user',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      client.disconnect();

      // Wait for close event
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onDisconnect).toHaveBeenCalled();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('message handling', () => {
    it('should handle binary Yjs update messages', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');
      const Y = await import('yjs');

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

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Create a valid Yjs update
      const testDoc = new Y.Doc();
      const root = testDoc.getMap('root');
      root.set('title', 'Test Document');
      const validUpdate = Y.encodeStateAsUpdate(testDoc);

      // Simulate receiving the valid Yjs update
      mockWSInstances[0].simulateMessage(validUpdate.buffer);

      // onUpdate should be called with the snapshot
      expect(onUpdate).toHaveBeenCalled();
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Test Document' }),
      );

      client.disconnect();
    });
  });

  describe('local updates', () => {
    it('should send local updates via PartySocket', async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Apply a local update
      const update = new Uint8Array([0, 1, 2, 3]);
      client.applyLocalUpdate(update);

      expect(mockWSInstances[0].send).toHaveBeenCalledWith(update);

      client.disconnect();
    });
  });

  describe('getSnapshot', () => {
    it('should return current document snapshot', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
      });

      const snapshot = client.getSnapshot();

      expect(snapshot).toBeDefined();
      expect(typeof snapshot).toBe('object');
    });
  });

  describe('getYDoc', () => {
    it('should return the Y.Doc instance', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
      });

      const ydoc = client.getYDoc();

      expect(ydoc).toBeDefined();
      expect(typeof ydoc.getMap).toBe('function');
    });
  });

  describe('error handling', () => {
    it('should call onError callback on PartySocket error', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const onError = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onError,
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'user-789',
        actorType: 'user',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate error
      mockWSInstances[0].simulateError();

      expect(onError).toHaveBeenCalled();

      client.disconnect();
    });
  });

  describe('reconnection', () => {
    it('should track connection state correctly', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
      });

      expect(client.isConnected()).toBe(false);

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'user-789',
        actorType: 'user',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(client.isConnected()).toBe(true);

      client.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(client.isConnected()).toBe(false);
    });

    it('should call onReconnecting callback when retryCount increases', async () => {
      vi.useFakeTimers();
      const { RealtimeClient } = await import('../src/realtime.js');

      const onReconnecting = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onReconnecting,
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'user-789',
        actorType: 'user',
      });

      // Simulate initial connection
      await vi.advanceTimersByTimeAsync(10);

      // Simulate first reconnection attempt (retryCount goes from 0 to 1)
      mockWSInstances[0].simulateReconnectAttempt();

      // Wait for the polling interval to detect the change
      await vi.advanceTimersByTimeAsync(150);

      expect(onReconnecting).toHaveBeenCalledWith(1);

      // Simulate another reconnection attempt
      mockWSInstances[0].simulateReconnectAttempt();
      await vi.advanceTimersByTimeAsync(150);

      expect(onReconnecting).toHaveBeenCalledWith(2);

      client.disconnect();
    });

    it('should reset retry tracking on successful reconnection', async () => {
      vi.useFakeTimers();
      const { RealtimeClient } = await import('../src/realtime.js');

      const onReconnecting = vi.fn();
      const onConnect = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onReconnecting,
        onConnect,
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'user-789',
        actorType: 'user',
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(onConnect).toHaveBeenCalledTimes(1);

      // Simulate connection loss and reconnection attempts
      mockWSInstances[0].simulateReconnectAttempt();
      await vi.advanceTimersByTimeAsync(150);
      expect(onReconnecting).toHaveBeenCalledWith(1);

      mockWSInstances[0].simulateReconnectAttempt();
      await vi.advanceTimersByTimeAsync(150);
      expect(onReconnecting).toHaveBeenCalledWith(2);

      // Simulate successful reconnection (this resets the internal lastReportedRetryCount)
      mockWSInstances[0].retryCount = 0; // PartySocket resets this on success
      mockWSInstances[0].simulateOpen();
      expect(onConnect).toHaveBeenCalledTimes(2);

      // Simulate another connection loss - counter should start from 1 again
      mockWSInstances[0].simulateReconnectAttempt();
      await vi.advanceTimersByTimeAsync(150);
      expect(onReconnecting).toHaveBeenCalledWith(1);

      client.disconnect();
    });

    it('should not call onDisconnect during automatic reconnection', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');

      const onDisconnect = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onDisconnect,
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'user-789',
        actorType: 'user',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate connection close (but not intentional disconnect)
      // PartySocket will handle reconnection
      mockWSInstances[0].readyState = MockReconnectingWebSocket.CLOSED;
      const event = new CloseEvent('close', { code: 1006, reason: 'Connection lost' });
      mockWSInstances[0].dispatchEvent(event);

      // onDisconnect should NOT be called because PartySocket will reconnect
      expect(onDisconnect).not.toHaveBeenCalled();

      client.disconnect();
    });

    it('should use default reconnection config when not provided', async () => {
      const { RealtimeClient } = await import('../src/realtime.js');
      const { WebSocket } = await import('partysocket');

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

      // Check default values are passed
      expect(WebSocket).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          maxRetries: Infinity,
          minReconnectionDelay: 1000,
          maxReconnectionDelay: 30000,
          reconnectionDelayGrowFactor: 1.5,
        }),
      );

      client.disconnect();
    });

    it('should only call onReconnecting after initial connection is established', async () => {
      vi.useFakeTimers();
      const { RealtimeClient } = await import('../src/realtime.js');

      const onReconnecting = vi.fn();
      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onReconnecting,
      });

      client.connect({
        siteId: 'site-123',
        branchId: 'branch-456',
        documentPath: 'pages/home',
        actorId: 'user-789',
        actorType: 'user',
      });

      // Immediately after connect (before the setTimeout(0) fires for auto-open),
      // simulate retry count increasing. This mimics what happens when initial
      // connection fails before ever establishing.
      mockWSInstances[0].simulateReconnectAttempt();

      // Run the first polling cycle but NOT the setTimeout(0) that opens the connection
      // by advancing less than 100ms
      await vi.advanceTimersByTimeAsync(50);

      // Should NOT call onReconnecting because we haven't connected yet
      // (the polling interval is 100ms, so no poll has happened yet)
      expect(onReconnecting).not.toHaveBeenCalled();

      // Now let the connection open (setTimeout 0) and poll cycle complete
      await vi.advanceTimersByTimeAsync(100);

      // After connection, since retryCount is 1 and we've connected,
      // the next poll should detect this
      // But since the connection just opened, hasConnectedOnce is now true
      // and lastReportedRetryCount is 0, so it will report retryCount 1
      expect(onReconnecting).toHaveBeenCalledWith(1);

      client.disconnect();
    });
  });
});
