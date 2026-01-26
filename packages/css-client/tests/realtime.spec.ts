/**
 * Phase 2.1: RealtimeClient Tests (TDD)
 *
 * Tests for the WebSocket-based real-time collaboration client.
 * Uses Yjs for CRDT-based conflict-free editing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  url: string;
  binaryType: string = 'arraybuffer';

  private listeners: Map<string, Set<EventListener>> = new Map();
  private onopen: ((event: Event) => void) | null = null;
  private onclose: ((event: CloseEvent) => void) | null = null;
  private onerror: ((event: Event) => void) | null = null;
  private onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
    setTimeout(() => this.simulateOpen(), 0);
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    const event = new Event('open');
    this.dispatchEvent(event);
  }

  simulateMessage(data: ArrayBuffer | string): void {
    const event = new MessageEvent('message', { data });
    this.dispatchEvent(event);
  }

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
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
let mockWebSocketInstances: MockWebSocket[] = [];

// Replace global WebSocket with mock
const originalWebSocket = global.WebSocket;

describe('Phase 2.1: RealtimeClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockWebSocketInstances = [];
    // Mock WebSocket globally
    global.WebSocket = vi.fn((url: string) => {
      const ws = new MockWebSocket(url);
      mockWebSocketInstances.push(ws);
      return ws;
    }) as unknown as typeof WebSocket;
    Object.assign(global.WebSocket, {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
    });
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
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

      const client = new RealtimeClient({
        baseUrl: 'ws://localhost:8787',
        onUpdate,
        onConnect,
        onDisconnect,
        onError,
      });

      expect(client).toBeDefined();
    });
  });

  describe('connect', () => {
    it('should establish WebSocket connection with correct URL', async () => {
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

      // Check that WebSocket was created with correct URL
      expect(global.WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('ws://localhost:8787'),
      );
      expect(global.WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('/api/sites/site-123/branches/branch-456/documents/pages%2Fhome/connect'),
      );
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
    });

    it('should include actor headers in URL as query params', async () => {
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

      // WebSocket connections can't send headers, so actor info goes in URL
      expect(global.WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('actorId=user-789'),
      );
      expect(global.WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('actorType=user'),
      );
    });
  });

  describe('disconnect', () => {
    it('should close WebSocket connection', async () => {
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

      expect(mockWebSocketInstances[0].close).toHaveBeenCalled();
    });

    it('should call onDisconnect callback', async () => {
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

      // Simulate receiving a Yjs update (binary data)
      const mockUpdate = new Uint8Array([0, 1, 2, 3]).buffer;
      mockWebSocketInstances[0].simulateMessage(mockUpdate);

      // onUpdate should be called with the snapshot
      expect(onUpdate).toHaveBeenCalled();
    });
  });

  describe('local updates', () => {
    it('should send local updates via WebSocket', async () => {
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

      expect(mockWebSocketInstances[0].send).toHaveBeenCalledWith(update);
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
    it('should call onError callback on WebSocket error', async () => {
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
      mockWebSocketInstances[0].simulateError();

      expect(onError).toHaveBeenCalled();
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
  });
});
