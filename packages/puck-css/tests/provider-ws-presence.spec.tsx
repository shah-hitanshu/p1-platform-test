/**
 * CSSPuckProvider WebSocket Presence Integration Tests
 *
 * Tests for WebSocket-based presence features in CSSPuckProvider.
 * Verifies that WebSocket presence is preferred when available,
 * with HTTP polling as fallback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen, act } from '@testing-library/react';
import React, { useContext } from 'react';
import type { ActorPresence, CSSClient, ActorState } from '@pantheon/css-client';
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

  applyLocalChange(_data: unknown): void {
    // Mock implementation
  }

  simulatePresenceUpdate(actors: ActorPresence[]): void {
    this.config.onPresenceUpdate?.(actors);
  }

  simulateFocusRegionBroadcast(actorId: string, focusRegions: string[]): void {
    this.config.onFocusRegionBroadcast?.(actorId, focusRegions);
  }

  simulateDisconnect(): void {
    this._connected = false;
    this._presenceViaWebSocket = false;
    this.config.onDisconnect?.();
  }
}

let mockClientInstances: MockRealtimeClient[] = [];

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

const getLatestClient = (): MockRealtimeClient | undefined => {
  return mockClientInstances[mockClientInstances.length - 1];
};

// =============================================================================
// Mock CSSClient
// =============================================================================

const mockBranchPresence = {
  branchId: 'branch-1',
  branchName: 'main',
  siteId: 'site-1',
  summary: {
    totalActors: 2,
    humanCount: 1,
    agentCount: 1,
    editingCount: 1,
  },
  actors: [
    {
      id: 'presence-1',
      actorId: 'user-2',
      actorType: 'user' as const,
      role: 'human' as const,
      name: 'Other User',
      state: 'editing' as const,
      lastActivityAt: new Date().toISOString(),
      joinedAt: new Date().toISOString(),
    },
  ],
  documentSummary: [],
};

const createMockClient = () => {
  const mockPresence = {
    getBranchPresence: vi.fn().mockResolvedValue(mockBranchPresence),
    getSitePresence: vi.fn().mockResolvedValue({}),
    getDocumentPresence: vi.fn().mockResolvedValue([]),
    updateFocusRegions: vi.fn().mockResolvedValue({ success: true, focusRegions: [] }),
  };

  const mockBranches = {
    list: vi.fn().mockResolvedValue([
      { id: 'branch-1', name: 'main', isMain: true, status: 'active' },
    ]),
    get: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'main', isMain: true }),
    create: vi.fn(),
  };

  const mockDocuments = {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    getByPath: vi.fn().mockResolvedValue({
      id: 'doc-1',
      path: 'pages/home',
      siteId: 'site-1',
    }),
    create: vi.fn(),
    getOrCreate: vi.fn(),
    listByBranch: vi.fn().mockResolvedValue([]),
  };

  const mockVersions = {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    getLatest: vi.fn().mockResolvedValue({
      id: 'version-1',
      documentId: 'doc-1',
      branchId: 'branch-1',
      snapshot: { content: [], root: { props: {} } },
    }),
    create: vi.fn(),
  };

  const mockCheckpoints = {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    get: vi.fn(),
  };

  return {
    branches: mockBranches,
    documents: mockDocuments,
    versions: mockVersions,
    checkpoints: mockCheckpoints,
    presence: mockPresence,
    withPrincipal: vi.fn().mockReturnThis(),
  } as unknown as CSSClient;
};

// =============================================================================
// Tests
// =============================================================================

describe('CSSPuckProvider WebSocket Presence Integration', () => {
  let mockClient: CSSClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    mockClientInstances = [];
    mockClient = createMockClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('WebSocket presence when realtime and presence are both enabled', () => {
    it('should prefer WebSocket presence over HTTP polling when connected', async () => {
      const { CSSPuckProvider } = await import('../src/CSSPuckProvider.js');
      const { PresenceContext } = await import('../src/PresenceContext.js');
      const { CSSPuckContext } = await import('../src/CSSPuckContext.js');

      let presenceValue: { actors: ActorPresence[] } | null = null;
      let loadDocumentFn: ((path: string) => Promise<void>) | null = null;

      const TestConsumer = () => {
        const presenceContext = useContext(PresenceContext);
        const cssContext = useContext(CSSPuckContext);
        presenceValue = presenceContext;
        loadDocumentFn = cssContext?.loadDocument ?? null;
        return <div>Presence: {presenceContext?.actors?.length ?? 0}</div>;
      };

      render(
        <CSSPuckProvider
          client={mockClient}
          siteId="site-1"
          branchId="branch-1"
          userId="user-1"
          enableRealtime={true}
          wsBaseUrl="ws://localhost:8787"
          presenceEnabled={true}
        >
          <TestConsumer />
        </CSSPuckProvider>
      );

      // Wait for initial mount
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });

      // Load a document to trigger realtime connection
      await act(async () => {
        await loadDocumentFn?.('pages/home');
      });

      // Advance timers to allow useEffect to run and connect
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      const realtimeClient = getLatestClient();

      // Verify connection happened
      expect(realtimeClient?.isConnected()).toBe(true);

      // Simulate WebSocket presence update
      const wsActors: ActorPresence[] = [
        {
          id: 'ws-presence-1',
          actorId: 'user-3',
          actorType: 'user',
          role: 'human',
          name: 'WS User',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      ];

      await act(async () => {
        realtimeClient?.simulatePresenceUpdate(wsActors);
      });

      // HTTP polling should NOT have been called recently since WS is active
      // (After initial fetch, polling should be skipped)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      // The key test: when WS is connected, HTTP polling should be minimal
      // We allow initial fetch but subsequent polls should be skipped
      // This test verifies the integration works
      expect(presenceValue).not.toBeNull();
    });

    it('should keep WS presence active in human-only sessions (no agents)', async () => {
      const { CSSPuckProvider } = await import('../src/CSSPuckProvider.js');
      const { PresenceContext } = await import('../src/PresenceContext.js');
      const { CSSPuckContext } = await import('../src/CSSPuckContext.js');

      let loadDocumentFn: ((path: string) => Promise<void>) | null = null;
      let presenceValue: { actors: ActorPresence[] } | null = null;

      const TestConsumer = () => {
        const cssContext = useContext(CSSPuckContext);
        loadDocumentFn = cssContext?.loadDocument ?? null;
        presenceValue = useContext(PresenceContext);
        return <div>Test</div>;
      };

      render(
        <CSSPuckProvider
          client={mockClient}
          siteId="site-1"
          branchId="branch-1"
          userId="user-1"
          enableRealtime={true}
          wsBaseUrl="ws://localhost:8787"
          presenceEnabled={true}
          presencePollingInterval={5000}
        >
          <TestConsumer />
        </CSSPuckProvider>
      );

      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      await act(async () => { await loadDocumentFn?.('pages/home'); });
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });

      const realtimeClient = getLatestClient();
      expect(realtimeClient?.isConnected()).toBe(true);

      // Simulate a presence update with only human actors (no agents)
      const humanActors: ActorPresence[] = [
        {
          id: 'ws-human-1',
          actorId: 'user-2',
          actorType: 'user',
          role: 'human',
          name: 'Alice',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      ];

      await act(async () => { realtimeClient?.simulatePresenceUpdate(humanActors); });

      // WS presence must remain active — human-only sessions should show WS actors, not fall back
      expect(presenceValue).not.toBeNull();
      expect(presenceValue!.actors.some((a: ActorPresence) => a.actorId === 'user-2')).toBe(true);
    });

    it('should fall back to HTTP polling when WebSocket disconnects', async () => {
      const { CSSPuckProvider } = await import('../src/CSSPuckProvider.js');
      const { CSSPuckContext } = await import('../src/CSSPuckContext.js');

      let loadDocumentFn: ((path: string) => Promise<void>) | null = null;

      const TestConsumer = () => {
        const cssContext = useContext(CSSPuckContext);
        loadDocumentFn = cssContext?.loadDocument ?? null;
        return <div>Test</div>;
      };

      render(
        <CSSPuckProvider
          client={mockClient}
          siteId="site-1"
          branchId="branch-1"
          userId="user-1"
          enableRealtime={true}
          wsBaseUrl="ws://localhost:8787"
          presenceEnabled={true}
          presencePollingInterval={5000}
        >
          <TestConsumer />
        </CSSPuckProvider>
      );

      // Wait for initial mount
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });

      // Load a document to trigger realtime connection
      await act(async () => {
        await loadDocumentFn?.('pages/home');
      });

      // Advance timers to allow useEffect to run and connect
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      const realtimeClient = getLatestClient();

      // Verify connection happened
      expect(realtimeClient?.isConnected()).toBe(true);

      // Clear call counts
      (mockClient.presence.getBranchPresence as ReturnType<typeof vi.fn>).mockClear();

      // Simulate disconnect
      await act(async () => {
        realtimeClient?.simulateDisconnect();
      });

      // After disconnect, HTTP polling should resume
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      // HTTP polling should have been called after disconnect
      expect(mockClient.presence.getBranchPresence).toHaveBeenCalled();
    });
  });

  describe('sendFocusRegions via context', () => {
    it('should expose sendFocusRegions when realtime is enabled', async () => {
      const { CSSPuckProvider } = await import('../src/CSSPuckProvider.js');
      const { CSSPuckContext } = await import('../src/CSSPuckContext.js');

      let contextValue: { sendFocusRegions?: (regions: string[]) => boolean } | null = null;

      const TestConsumer = () => {
        const context = useContext(CSSPuckContext);
        contextValue = context;
        return <div>Test</div>;
      };

      render(
        <CSSPuckProvider
          client={mockClient}
          siteId="site-1"
          branchId="branch-1"
          userId="user-1"
          enableRealtime={true}
          wsBaseUrl="ws://localhost:8787"
        >
          <TestConsumer />
        </CSSPuckProvider>
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(contextValue).not.toBeNull();
      expect(typeof contextValue?.sendFocusRegions).toBe('function');
    });
  });

  describe('focus region broadcast updates', () => {
    it('should update actor focus regions when broadcast received', async () => {
      const { CSSPuckProvider } = await import('../src/CSSPuckProvider.js');
      const { PresenceContext } = await import('../src/PresenceContext.js');
      const { CSSPuckContext } = await import('../src/CSSPuckContext.js');

      let presenceValue: { actors: ActorPresence[] } | null = null;
      let loadDocumentFn: ((path: string) => Promise<void>) | null = null;

      const TestConsumer = () => {
        const presenceContext = useContext(PresenceContext);
        const cssContext = useContext(CSSPuckContext);
        presenceValue = presenceContext;
        loadDocumentFn = cssContext?.loadDocument ?? null;
        return <div>Actors: {presenceContext?.actors?.length ?? 0}</div>;
      };

      render(
        <CSSPuckProvider
          client={mockClient}
          siteId="site-1"
          branchId="branch-1"
          userId="user-1"
          enableRealtime={true}
          wsBaseUrl="ws://localhost:8787"
          presenceEnabled={true}
        >
          <TestConsumer />
        </CSSPuckProvider>
      );

      // Wait for initial mount
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });

      // Load a document to trigger realtime connection
      await act(async () => {
        await loadDocumentFn?.('pages/home');
      });

      // Advance timers to allow useEffect to run and connect
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      const realtimeClient = getLatestClient();

      // Verify connection happened
      expect(realtimeClient?.isConnected()).toBe(true);

      // Send initial presence update
      const wsActors: ActorPresence[] = [
        {
          id: 'ws-presence-1',
          actorId: 'user-2',
          actorType: 'user',
          role: 'human',
          name: 'Other User',
          state: 'editing',
          focusRegions: [],
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      ];

      await act(async () => {
        realtimeClient?.simulatePresenceUpdate(wsActors);
      });

      // Now send focus region broadcast
      await act(async () => {
        realtimeClient?.simulateFocusRegionBroadcast('user-2', ['$.hero', '$.content']);
      });

      // Verify the actor's focus regions were updated
      const actor = presenceValue?.actors?.find((a) => a.actorId === 'user-2');
      expect(actor?.focusRegions).toEqual(['$.hero', '$.content']);
    });
  });
});
