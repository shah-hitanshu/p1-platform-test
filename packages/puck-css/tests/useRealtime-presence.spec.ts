/**
 * useRealtime WebSocket Presence Tests
 *
 * Tests for WebSocket-based presence features in the useRealtime hook.
 * These features enable real-time presence updates via the existing WebSocket connection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ActorPresence, ActorState } from '@pantheon/css-client';
import * as Y from 'yjs';

// =============================================================================
// Mock RealtimeClient
// =============================================================================

interface MockRealtimeClientConfig {
  baseUrl: string;
  apiKey?: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onPresenceUpdate?: (actors: ActorPresence[]) => void;
  onFocusRegionBroadcast?: (actorId: string, focusRegions: string[]) => void;
}

interface MockConnectionParams {
  siteId: string;
  branchId: string;
  documentPath: string;
  actorId: string;
  actorType: 'user' | 'agent';
  sessionId?: string;
}

class MockRealtimeClient {
  private config: MockRealtimeClientConfig;
  private ydoc: Y.Doc;
  private _connected = false;
  private _presenceViaWebSocket = false;
  sendFocusRegionsCalled: string[][] = [];
  sendHeartbeatCalled: (ActorState | undefined)[] = [];

  constructor(config: MockRealtimeClientConfig) {
    this.config = config;
    this.ydoc = new Y.Doc();
  }

  connect(_params: MockConnectionParams): void {
    // Simulate async connection
    setTimeout(() => {
      this._connected = true;
      this._presenceViaWebSocket = true;
      this.config.onConnect?.();
    }, 0);
  }

  disconnect(): void {
    this._connected = false;
    this._presenceViaWebSocket = false;
    this.config.onDisconnect?.();
  }

  isConnected(): boolean {
    return this._connected;
  }

  get presenceViaWebSocket(): boolean {
    return this._presenceViaWebSocket;
  }

  getYDoc(): Y.Doc {
    return this.ydoc;
  }

  getSnapshot(): Record<string, unknown> {
    const root = this.ydoc.getMap('root');
    return root.toJSON() as Record<string, unknown>;
  }

  sendFocusRegions(focusRegions: string[]): boolean {
    this.sendFocusRegionsCalled.push(focusRegions);
    return this._presenceViaWebSocket;
  }

  sendHeartbeat(state?: ActorState): void {
    this.sendHeartbeatCalled.push(state);
  }

  // Test helpers - simulate server messages
  simulatePresenceUpdate(actors: ActorPresence[]): void {
    this.config.onPresenceUpdate?.(actors);
  }

  simulateFocusRegionBroadcast(actorId: string, focusRegions: string[]): void {
    this.config.onFocusRegionBroadcast?.(actorId, focusRegions);
  }
}

// Store instances for test access
let mockClientInstances: MockRealtimeClient[] = [];

// Mock @pantheon/css-client module
vi.mock('@pantheon/css-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pantheon/css-client')>();
  return {
    ...actual,
    RealtimeClient: vi.fn((config: MockRealtimeClientConfig) => {
      const client = new MockRealtimeClient(config);
      mockClientInstances.push(client);
      return client;
    }),
  };
});

// Helper to get the latest mock client instance
const getLatestClient = (): MockRealtimeClient | undefined => {
  return mockClientInstances[mockClientInstances.length - 1];
};

describe('useRealtime WebSocket Presence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstances = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('UseRealtimeParams presence callbacks', () => {
    it('should accept onPresenceUpdate callback in params', async () => {
      const { useRealtime } = await import('../src/hooks/useRealtime.js');

      const onPresenceUpdate = vi.fn();
      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'pages/home',
          actorId: 'user-1',
          actorType: 'user',
          onPresenceUpdate,
        }),
      );

      expect(result.current).toBeDefined();
    });

    it('should accept onFocusRegionBroadcast callback in params', async () => {
      const { useRealtime } = await import('../src/hooks/useRealtime.js');

      const onFocusRegionBroadcast = vi.fn();
      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'pages/home',
          actorId: 'user-1',
          actorType: 'user',
          onFocusRegionBroadcast,
        }),
      );

      expect(result.current).toBeDefined();
    });
  });

  describe('onPresenceUpdate callback', () => {
    it('should call onPresenceUpdate when server sends presence_update', async () => {
      const { useRealtime } = await import('../src/hooks/useRealtime.js');

      const onPresenceUpdate = vi.fn();
      renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'pages/home',
          actorId: 'user-1',
          actorType: 'user',
          onPresenceUpdate,
        }),
      );

      const client = getLatestClient();

      // Wait for connection
      await waitFor(() => {
        expect(client?.isConnected()).toBe(true);
      });

      const actors: ActorPresence[] = [
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
      ];

      await act(async () => {
        client?.simulatePresenceUpdate(actors);
      });

      expect(onPresenceUpdate).toHaveBeenCalledWith(actors);
    });
  });

  describe('onFocusRegionBroadcast callback', () => {
    it('should call onFocusRegionBroadcast when server sends focus_region_broadcast', async () => {
      const { useRealtime } = await import('../src/hooks/useRealtime.js');

      const onFocusRegionBroadcast = vi.fn();
      renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'pages/home',
          actorId: 'user-1',
          actorType: 'user',
          onFocusRegionBroadcast,
        }),
      );

      const client = getLatestClient();

      // Wait for connection
      await waitFor(() => {
        expect(client?.isConnected()).toBe(true);
      });

      await act(async () => {
        client?.simulateFocusRegionBroadcast('user-2', ['$.hero', '$.content']);
      });

      expect(onFocusRegionBroadcast).toHaveBeenCalledWith('user-2', ['$.hero', '$.content']);
    });
  });

  describe('sendFocusRegions method', () => {
    it('should return sendFocusRegions function', async () => {
      const { useRealtime } = await import('../src/hooks/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'pages/home',
          actorId: 'user-1',
          actorType: 'user',
        }),
      );

      expect(typeof result.current.sendFocusRegions).toBe('function');
    });

    it('should send focus regions via WebSocket when connected', async () => {
      const { useRealtime } = await import('../src/hooks/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'pages/home',
          actorId: 'user-1',
          actorType: 'user',
        }),
      );

      const client = getLatestClient();

      // Wait for connection
      await waitFor(() => {
        expect(client?.isConnected()).toBe(true);
      });

      let success = false;
      act(() => {
        success = result.current.sendFocusRegions(['$.hero']);
      });

      expect(success).toBe(true);
      expect(client?.sendFocusRegionsCalled).toContainEqual(['$.hero']);
    });

    it('should return false when not connected', async () => {
      const { useRealtime } = await import('../src/hooks/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'pages/home',
          actorId: 'user-1',
          actorType: 'user',
          enabled: false, // Not enabled, so not connected
        }),
      );

      let success = true;
      act(() => {
        success = result.current.sendFocusRegions(['$.hero']);
      });

      expect(success).toBe(false);
    });
  });

  describe('sendHeartbeat method', () => {
    it('should return sendHeartbeat function', async () => {
      const { useRealtime } = await import('../src/hooks/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'pages/home',
          actorId: 'user-1',
          actorType: 'user',
        }),
      );

      expect(typeof result.current.sendHeartbeat).toBe('function');
    });

    it('should send heartbeat via WebSocket when connected', async () => {
      const { useRealtime } = await import('../src/hooks/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'pages/home',
          actorId: 'user-1',
          actorType: 'user',
        }),
      );

      const client = getLatestClient();

      // Wait for connection
      await waitFor(() => {
        expect(client?.isConnected()).toBe(true);
      });

      act(() => {
        result.current.sendHeartbeat('editing');
      });

      expect(client?.sendHeartbeatCalled).toContain('editing');
    });
  });

  describe('presenceViaWebSocket property', () => {
    it('should return presenceViaWebSocket boolean', async () => {
      const { useRealtime } = await import('../src/hooks/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'pages/home',
          actorId: 'user-1',
          actorType: 'user',
        }),
      );

      expect(typeof result.current.presenceViaWebSocket).toBe('boolean');
    });

    it('should be false when not connected', async () => {
      const { useRealtime } = await import('../src/hooks/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'pages/home',
          actorId: 'user-1',
          actorType: 'user',
          enabled: false,
        }),
      );

      expect(result.current.presenceViaWebSocket).toBe(false);
    });

    it('should be true when connected', async () => {
      const { useRealtime } = await import('../src/hooks/useRealtime.js');

      const { result } = renderHook(() =>
        useRealtime({
          baseUrl: 'ws://localhost:8787',
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'pages/home',
          actorId: 'user-1',
          actorType: 'user',
        }),
      );

      const client = getLatestClient();

      // Wait for connection
      await waitFor(() => {
        expect(client?.isConnected()).toBe(true);
      });

      await waitFor(() => {
        expect(result.current.presenceViaWebSocket).toBe(true);
      });
    });
  });
});
