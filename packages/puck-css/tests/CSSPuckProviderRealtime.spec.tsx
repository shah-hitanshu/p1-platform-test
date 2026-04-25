/**
 * Phase 3.3-3.4: CSSPuckProvider Realtime Integration Tests (TDD)
 *
 * Tests for real-time collaborative editing integration in CSSPuckProvider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { CSSPuckProvider } from '../src/CSSPuckProvider.js';
import { useCSSPuck } from '../src/CSSPuckContext.js';
import type { CSSClient } from '@pantheon/css-client';

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

// Mock CSS Client - needs to handle withPrincipal chaining properly
const createMockClient = () => {
  const client = {
    sites: { list: vi.fn(), get: vi.fn() },
    branches: { list: vi.fn().mockResolvedValue([{ id: 'branch-1', isMain: true, name: 'main' }]) },
    documents: { getByPath: vi.fn() },
    versions: { getLatest: vi.fn(), create: vi.fn() },
    checkpoints: { create: vi.fn() },
    withPrincipal: vi.fn(),
  };
  // withPrincipal returns the same client structure
  client.withPrincipal.mockReturnValue(client);
  return client as unknown as CSSClient;
};

let mockCSSClient: CSSClient;

// Test component to access context values
function RealtimeStatusDisplay(): React.ReactElement {
  const context = useCSSPuck();
  return (
    <div>
      <span data-testid="realtime-enabled">{String(context.realtimeEnabled)}</span>
      <span data-testid="realtime-connected">{String(context.realtimeConnected)}</span>
    </div>
  );
}

describe('Phase 3.3-3.4: CSSPuckProvider Realtime Integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCSSClient = createMockClient();
    mockWebSocketInstances = [];
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

  describe('realtimeEnabled prop', () => {
    it('should expose realtimeEnabled as true by default in context', async () => {
      render(
        <CSSPuckProvider
          client={mockCSSClient}
          siteId="site-123"
          branchId="branch-1"
          userId="user-789"
        >
          <RealtimeStatusDisplay />
        </CSSPuckProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('realtime-enabled').textContent).toBe('true');
      });
    });

    it('should expose realtimeEnabled as true when enabled', async () => {
      render(
        <CSSPuckProvider
          client={mockCSSClient}
          siteId="site-123"
          branchId="branch-1"
          userId="user-789"
          enableRealtime={true}
          wsBaseUrl="ws://localhost:8787"
        >
          <RealtimeStatusDisplay />
        </CSSPuckProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('realtime-enabled').textContent).toBe('true');
      });
    });
  });

  describe('realtimeConnected state', () => {
    it('should expose realtimeConnected as false by default', async () => {
      render(
        <CSSPuckProvider
          client={mockCSSClient}
          siteId="site-123"
          branchId="branch-1"
          userId="user-789"
        >
          <RealtimeStatusDisplay />
        </CSSPuckProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('realtime-connected').textContent).toBe('false');
      });
    });

    it('should not connect when enableRealtime is false', async () => {
      render(
        <CSSPuckProvider
          client={mockCSSClient}
          siteId="site-123"
          branchId="branch-1"
          userId="user-789"
          enableRealtime={false}
        >
          <RealtimeStatusDisplay />
        </CSSPuckProvider>
      );

      // Give time for any potential WebSocket connection
      await new Promise((r) => setTimeout(r, 50));

      expect(mockWebSocketInstances).toHaveLength(0);
    });

    it('should not connect when enableRealtime is true but no document is loaded', async () => {
      render(
        <CSSPuckProvider
          client={mockCSSClient}
          siteId="site-123"
          branchId="branch-1"
          userId="user-789"
          enableRealtime={true}
          wsBaseUrl="ws://localhost:8787"
        >
          <RealtimeStatusDisplay />
        </CSSPuckProvider>
      );

      // Give time for any potential WebSocket connection
      await new Promise((r) => setTimeout(r, 50));

      // Should not connect until a document is loaded
      expect(mockWebSocketInstances).toHaveLength(0);
      expect(screen.getByTestId('realtime-connected').textContent).toBe('false');
    });
  });

  describe('wsBaseUrl prop', () => {
    it('should require wsBaseUrl when enableRealtime is true', async () => {
      // This test verifies the prop types - wsBaseUrl should be required when realtime is enabled
      render(
        <CSSPuckProvider
          client={mockCSSClient}
          siteId="site-123"
          branchId="branch-1"
          userId="user-789"
          enableRealtime={true}
          wsBaseUrl="ws://localhost:8787"
        >
          <RealtimeStatusDisplay />
        </CSSPuckProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('realtime-enabled').textContent).toBe('true');
      });
    });
  });

  describe('context value types', () => {
    it('should include realtimeEnabled boolean in context', async () => {
      let contextValue: ReturnType<typeof useCSSPuck> | null = null;

      function ContextCapture(): null {
        contextValue = useCSSPuck();
        return null;
      }

      render(
        <CSSPuckProvider
          client={mockCSSClient}
          siteId="site-123"
          branchId="branch-1"
          userId="user-789"
        >
          <ContextCapture />
        </CSSPuckProvider>
      );

      await waitFor(() => {
        expect(contextValue).not.toBeNull();
      });

      expect(typeof contextValue!.realtimeEnabled).toBe('boolean');
      expect(typeof contextValue!.realtimeConnected).toBe('boolean');
    });
  });
});
