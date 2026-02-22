/**
 * Tests for stale WebSocket close event guard in useRealtime.
 *
 * Validates that when documentPath changes (user navigates between documents),
 * the old WebSocket's asynchronous close event does not corrupt the new
 * client's connection state (connected, connectedDocumentPath, presenceViaWebSocket).
 *
 * Root cause: When useRealtime destroys an old client and creates a new one,
 * both clients' onConnect/onDisconnect callbacks reference the same React refs
 * and state setters. If the old client's close event fires AFTER the new client
 * connects, it incorrectly sets connected=false and connectedDocumentPath=null,
 * permanently breaking sync in one direction and corrupting presence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// =============================================================================
// MockWebSocket with controllable close event timing
// =============================================================================

type EventListenerFn = (event: Event) => void;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  url: string;
  binaryType: string = 'arraybuffer';

  private listeners: Map<string, Set<EventListenerFn>> = new Map();

  constructor(url: string) {
    this.url = url;
    // Auto-open after a microtask (simulates async WebSocket handshake)
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

  addEventListener(type: string, listener: EventListenerFn): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerFn): void {
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

  // IMPORTANT: close() does NOT immediately fire the close event.
  // The close event is dispatched via setTimeout to simulate the real
  // WebSocket behavior where close is asynchronous.
  close = vi.fn(() => {
    // Queue the close event on the next event loop tick
    setTimeout(() => this.simulateClose(), 0);
  });
}

let mockWebSocketInstances: MockWebSocket[] = [];
const originalWebSocket = globalThis.WebSocket;

// =============================================================================
// Tests
// =============================================================================

describe('useRealtime: stale close event guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mockWebSocketInstances = [];
    globalThis.WebSocket = vi.fn((url: string) => {
      const ws = new MockWebSocket(url);
      mockWebSocketInstances.push(ws);
      return ws;
    }) as unknown as typeof WebSocket;
    Object.assign(globalThis.WebSocket, {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
  });

  it('should remain connected after documentPath change when old close event fires late', async () => {
    const { useRealtime } = await import('../src/hooks/useRealtime.js');

    // Render with document A
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
      { initialProps: { documentPath: 'pages/docA' as string | null } },
    );

    // Advance timers to let document A's WebSocket open
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(result.current.connected).toBe(true);
    expect(result.current.connectedDocumentPath).toBe('pages/docA');

    // Change to document B — this destroys the old client and creates a new one.
    // The old WebSocket's close event is queued asynchronously (via setTimeout(0)
    // in our MockWebSocket.close).
    rerender({ documentPath: 'pages/docB' });

    // At this point:
    // - Old client's disconnect() was called (queues close event)
    // - New client was created but WebSocket hasn't opened yet
    // The old close event AND new open event are both pending in the timer queue.

    // Advance timers to fire both:
    // 1. Old close event (from old ws.close())
    // 2. New open event (from new MockWebSocket constructor's setTimeout)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    // The new WebSocket should have been created
    expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(2);

    // CRITICAL: After both events fire, connected should be true and
    // connectedDocumentPath should be the NEW document, not null.
    // Without the stale close guard, the old onDisconnect would have
    // set these to false/null after the new onConnect set them correctly.
    expect(result.current.connected).toBe(true);
    expect(result.current.connectedDocumentPath).toBe('pages/docB');
    expect(result.current.presenceViaWebSocket).toBe(true);
  });

  it('should correctly disconnect when setting documentPath to null', async () => {
    const { useRealtime } = await import('../src/hooks/useRealtime.js');

    // Render with document A
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
      { initialProps: { documentPath: 'pages/docA' as string | null } },
    );

    // Wait for connection
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.connected).toBe(true);

    // Set documentPath to null (no document loaded)
    rerender({ documentPath: null });

    // Advance timers to process close events
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    // Should be disconnected (not connected to any document)
    expect(result.current.connected).toBe(false);
    expect(result.current.connectedDocumentPath).toBeNull();
  });

  it('should handle rapid A → B → C navigation without state corruption', async () => {
    const { useRealtime } = await import('../src/hooks/useRealtime.js');

    // Render with document A
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
      { initialProps: { documentPath: 'pages/docA' as string | null } },
    );

    // Let A connect
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.connected).toBe(true);
    expect(result.current.connectedDocumentPath).toBe('pages/docA');

    // Rapid navigation: A → B → C without waiting for connections
    rerender({ documentPath: 'pages/docB' });
    rerender({ documentPath: 'pages/docC' });

    // Advance all timers to let all close/open events fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Only the FINAL document (C) should be the active connection
    expect(result.current.connected).toBe(true);
    expect(result.current.connectedDocumentPath).toBe('pages/docC');
  });
});
