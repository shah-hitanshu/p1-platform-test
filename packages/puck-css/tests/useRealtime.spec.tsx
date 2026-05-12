/**
 * Phase 3.2: useRealtime Hook Tests (TDD)
 *
 * Tests for the React hook that integrates RealtimeClient with Puck.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

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

  constructor(url: string) {
    this.url = url;
    setTimeout(() => this.simulateOpen(), 0);
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    const event = new Event('open');
    this.dispatchEvent(event);
  }

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
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

  send = vi.fn();
  close = vi.fn(() => {
    this.simulateClose();
  });
}

let mockWebSocketInstances: MockWebSocket[] = [];
const originalWebSocket = global.WebSocket;

// Mock P1Client
const mockP1Client = {
  sites: { list: vi.fn(), get: vi.fn() },
  branches: { list: vi.fn(), get: vi.fn() },
  documents: { getByPath: vi.fn() },
  versions: { getLatest: vi.fn() },
  withPrincipal: vi.fn().mockReturnThis(),
};

describe('Phase 3.2: useRealtime Hook', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockWebSocketInstances = [];
    global.WebSocket = vi.fn().mockImplementation(function (url: string) {
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

  describe('initialization', () => {
    it('should return connected state and applyLocalChange function', async () => {
      const { useRealtime } = await import('../src/editor/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-123',
          branchId: 'branch-456',
          documentPath: 'pages/home',
          actorId: 'user-789',
          actorType: 'user',
          enabled: true,
        }),
      );

      expect(result.current).toHaveProperty('connected');
      expect(result.current).toHaveProperty('applyLocalChange');
      expect(result.current).toHaveProperty('error');
      expect(typeof result.current.applyLocalChange).toBe('function');
    });

    it('should not connect when enabled is false', async () => {
      const { useRealtime } = await import('../src/editor/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-123',
          branchId: 'branch-456',
          documentPath: 'pages/home',
          actorId: 'user-789',
          actorType: 'user',
          enabled: false,
        }),
      );

      expect(result.current.connected).toBe(false);
      expect(mockWebSocketInstances).toHaveLength(0);
    });

    it('should not connect when documentPath is null', async () => {
      const { useRealtime } = await import('../src/editor/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-123',
          branchId: 'branch-456',
          documentPath: null,
          actorId: 'user-789',
          actorType: 'user',
          enabled: true,
        }),
      );

      expect(result.current.connected).toBe(false);
      expect(mockWebSocketInstances).toHaveLength(0);
    });
  });

  describe('connection lifecycle', () => {
    it('should connect when enabled and documentPath is provided', async () => {
      const { useRealtime } = await import('../src/editor/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-123',
          branchId: 'branch-456',
          documentPath: 'pages/home',
          actorId: 'user-789',
          actorType: 'user',
          enabled: true,
        }),
      );

      // Wait for connection
      await waitFor(() => {
        expect(mockWebSocketInstances).toHaveLength(1);
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
      });
    });

    it('should disconnect when unmounted', async () => {
      const { useRealtime } = await import('../src/editor/useRealtime.js');

      const { result, unmount } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-123',
          branchId: 'branch-456',
          documentPath: 'pages/home',
          actorId: 'user-789',
          actorType: 'user',
          enabled: true,
        }),
      );

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
      });

      unmount();

      expect(mockWebSocketInstances[0].close).toHaveBeenCalled();
    });

    it('should reconnect when documentPath changes', async () => {
      const { useRealtime } = await import('../src/editor/useRealtime.js');

      const { result, rerender } = renderHook(
        ({ documentPath }) =>
          useRealtime({
            baseUrl: 'ws://localhost:8787',
            siteId: 'site-123',
            branchId: 'branch-456',
            documentPath,
            actorId: 'user-789',
            actorType: 'user',
            enabled: true,
          }),
        { initialProps: { documentPath: 'pages/home' } },
      );

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
      });

      // Change document path
      rerender({ documentPath: 'pages/about' });

      await waitFor(() => {
        // Should have disconnected and reconnected
        expect(mockWebSocketInstances).toHaveLength(2);
      });
    });
  });

  describe('onRemoteUpdate callback', () => {
    it('should call onRemoteUpdate when remote changes arrive', async () => {
      const { useRealtime } = await import('../src/editor/useRealtime.js');
      const Y = await import('yjs');

      const onRemoteUpdate = vi.fn();

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-123',
          branchId: 'branch-456',
          documentPath: 'pages/home',
          actorId: 'user-789',
          actorType: 'user',
          enabled: true,
          onRemoteUpdate,
        }),
      );

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
      });

      // Simulate receiving a valid Yjs update
      const testDoc = new Y.Doc();
      const root = testDoc.getMap('root');
      const content = new Y.Array();
      content.push([{ type: 'Header', props: { id: 'h1', title: 'Test' } }]);
      root.set('content', content);
      const validUpdate = Y.encodeStateAsUpdate(testDoc);

      const messageEvent = new MessageEvent('message', { data: validUpdate.buffer });
      mockWebSocketInstances[0].dispatchEvent(messageEvent);

      await waitFor(() => {
        expect(onRemoteUpdate).toHaveBeenCalled();
      });
    });
  });

  describe('getSnapshot', () => {
    it('should return current Yjs document state when connected', async () => {
      const { useRealtime } = await import('../src/editor/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-123',
          branchId: 'branch-456',
          documentPath: 'pages/home',
          actorId: 'user-789',
          actorType: 'user',
          enabled: true,
        }),
      );

      // Wait for connection
      await waitFor(() => {
        expect(result.current.connected).toBe(true);
      });

      // Apply a local change to set up some data
      act(() => {
        result.current.applyLocalChange({
          content: [{ type: 'Header', props: { id: 'h1', title: 'Test Title' } }],
          root: { props: { title: 'Test Page' } },
        });
      });

      // Get the snapshot - should return the current Yjs document state
      const snapshot = result.current.getSnapshot();

      expect(snapshot).not.toBeNull();
      expect(snapshot).toHaveProperty('content');
      expect(snapshot).toHaveProperty('root');
    });

    it('should return null when not connected (no documentPath)', async () => {
      const { useRealtime } = await import('../src/editor/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-123',
          branchId: 'branch-456',
          documentPath: null, // No document path means no connection
          actorId: 'user-789',
          actorType: 'user',
          enabled: true,
        }),
      );

      // Should not be connected
      expect(result.current.connected).toBe(false);

      // getSnapshot should return null when not connected
      const snapshot = result.current.getSnapshot();
      expect(snapshot).toBeNull();
    });

    it('should return null when disabled', async () => {
      const { useRealtime } = await import('../src/editor/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-123',
          branchId: 'branch-456',
          documentPath: 'pages/home',
          actorId: 'user-789',
          actorType: 'user',
          enabled: false, // Disabled
        }),
      );

      // Should not be connected when disabled
      expect(result.current.connected).toBe(false);

      // getSnapshot should return null when not connected
      const snapshot = result.current.getSnapshot();
      expect(snapshot).toBeNull();
    });

    it('should return data with valid PuckData structure', async () => {
      const { useRealtime } = await import('../src/editor/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-123',
          branchId: 'branch-456',
          documentPath: 'pages/home',
          actorId: 'user-789',
          actorType: 'user',
          enabled: true,
        }),
      );

      // Wait for connection
      await waitFor(() => {
        expect(result.current.connected).toBe(true);
      });

      // Apply valid PuckData
      const puckData = {
        content: [
          { type: 'Header', props: { id: 'h1', title: 'Hello World' } },
          { type: 'Text', props: { id: 't1', content: 'Some text' } },
        ],
        root: { props: { title: 'My Page', backgroundColor: '#fff' } },
      };

      act(() => {
        result.current.applyLocalChange(puckData);
      });

      const snapshot = result.current.getSnapshot();

      // Verify the snapshot contains the expected data structure
      expect(snapshot).not.toBeNull();
      expect(snapshot!.content).toBeDefined();
      expect(snapshot!.root).toBeDefined();
    });
  });
});
