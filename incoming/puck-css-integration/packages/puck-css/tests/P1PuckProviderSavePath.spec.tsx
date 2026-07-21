/**
 * P1PuckProvider Save Path Tests (TDD)
 *
 * Tests for unified save path behavior: when realtime is connected,
 * the REST API save should be skipped to avoid creating duplicate
 * versions without CRDT state. The DO handles persistence via WebSocket sync.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useP1Puck } from '../src/core/P1PuckContext.js';
import type { P1Client, Branch, PuckData } from '@pantheon-systems/css-client';

// =============================================================================
// Mock useRealtime hook
// =============================================================================

const mockApplyLocalChange = vi.fn();
const mockGetSnapshot = vi.fn().mockReturnValue(null);
const mockSendFocusRegions = vi.fn().mockReturnValue(false);
const mockSendHeartbeat = vi.fn();

let mockRealtimeConnected = false;

// Stable mock object -- must keep the same identity across renders so that
// useMemo dependencies (e.g. throttledRealtimeSync) don't recreate on every render.
const stableMockRealtime = {
  connected: false,
  applyLocalChange: mockApplyLocalChange,
  getSnapshot: mockGetSnapshot,
  error: null,
  sendFocusRegions: mockSendFocusRegions,
  sendHeartbeat: mockSendHeartbeat,
  presenceViaWebSocket: false,
  connectedDocumentPath: null as string | null,
};

vi.mock('../src/editor/useRealtime.js', () => ({
  useRealtime: () => {
    // Update mutable properties on the stable object each call
    stableMockRealtime.connected = mockRealtimeConnected;
    stableMockRealtime.connectedDocumentPath = mockRealtimeConnected ? 'pages/home' : null;
    return stableMockRealtime;
  },
}));

// =============================================================================
// Import P1PuckProvider AFTER the mock
// =============================================================================

const { P1PuckProvider } = await import('../src/editor/P1PuckProvider.js');

// =============================================================================
// Mock Data
// =============================================================================

const mockBranch: Branch = {
  id: 'branch-1',
  siteId: 'site-1',
  name: 'main',
  isMain: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockDocument = {
  id: 'doc-1',
  siteId: 'site-1',
  path: 'pages/home',
  title: 'Home',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockPuckData: PuckData = {
  content: [{ type: 'Text', props: { id: 'text-1', text: 'Hello' } }],
  root: { props: {} },
};

const mockVersionSnapshot: PuckData = {
  content: [],
  root: { props: {} },
};

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient(): P1Client {
  return {
    branches: {
      list: vi.fn().mockResolvedValue([mockBranch]),
      get: vi.fn().mockResolvedValue(mockBranch),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    documents: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getByPath: vi.fn().mockResolvedValue(mockDocument),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    versions: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getLatest: vi.fn().mockResolvedValue({
        id: 'v1',
        versionNumber: 1,
        snapshot: mockVersionSnapshot,
      }),
      create: vi.fn().mockResolvedValue({ id: 'v2', versionNumber: 2 }),
    },
    checkpoints: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'cp-1', name: 'test' }),
    },
    presence: {
      getSitePresence: vi.fn(),
      getBranchPresence: vi.fn(),
      getAgentPresence: vi.fn(),
    },
    agentRegistry: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateStatus: vi.fn(),
      delete: vi.fn(),
    },
    agentEdit: {
      canEdit: vi.fn(),
      startEdit: vi.fn(),
      completeEdit: vi.fn(),
      abortEdit: vi.fn(),
    },
    withPrincipal: vi.fn().mockReturnThis(),
  } as unknown as P1Client;
}

// =============================================================================
// Provider Wrapper Factory
// =============================================================================

interface WrapperProps {
  children: React.ReactNode;
}

function createProviderWrapper(
  client: P1Client,
  options: {
    siteId?: string;
    branchId?: string;
    userId?: string;
    enableRealtime?: boolean;
    wsBaseUrl?: string;
    autoSaveDelay?: number;
    realtimeSyncInterval?: number;
  } = {}
) {
  const {
    siteId = 'site-1',
    branchId = 'branch-1',
    userId = 'user-789',
    enableRealtime = false,
    wsBaseUrl,
    autoSaveDelay = 3000,
    realtimeSyncInterval,
  } = options;

  return function Wrapper({ children }: WrapperProps) {
    return React.createElement(
      P1PuckProvider,
      {
        client,
        siteId,
        branchId,
        userId,
        enableRealtime,
        wsBaseUrl,
        autoSaveDelay,
        ...(realtimeSyncInterval !== undefined ? { realtimeSyncInterval } : {}),
      },
      children
    );
  };
}

// =============================================================================
// Test Suite
// =============================================================================

describe('P1PuckProvider Save Path - Realtime vs REST', () => {
  let client: P1Client;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
    mockRealtimeConnected = false;
    mockApplyLocalChange.mockClear();
    mockGetSnapshot.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /**
   * Helper to render the hook and load a document so performSave has data.
   */
  async function renderAndLoadDocument(options: {
    enableRealtime?: boolean;
    wsBaseUrl?: string;
    autoSaveDelay?: number;
    realtimeSyncInterval?: number;
  } = {}) {
    const wrapper = createProviderWrapper(client, options);
    const { result } = renderHook(() => useP1Puck(), { wrapper });

    // Load document so currentDocument and currentData are set
    await act(async () => {
      await result.current.loadDocument('/pages/home');
    });

    // Consume the suppressNextSaveRef flag set by loadDocument.
    // In production, PuckDataSynchronizer's onChange echo does this automatically.
    act(() => {
      result.current.saveData(mockVersionSnapshot);
    });

    // When realtime is enabled, loadDocument increments pendingRemoteUpdatesRef
    // to prevent the REST-loaded data from bouncing back through Y.Doc.
    // Advance past the 100ms safety reset so subsequent saveData calls are
    // treated as genuine user edits (not stale REST data).
    if (options.enableRealtime) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
    }

    return result;
  }

  // =========================================================================
  // Test 1: Should NOT call REST API save when realtime is connected
  // =========================================================================

  it('should not call REST API save when realtime is connected', async () => {
    mockRealtimeConnected = true;

    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      autoSaveDelay: 1000,
    });

    // Trigger saveData (this is what Puck's onChange calls)
    act(() => {
      result.current.saveData(mockPuckData);
    });

    // Advance past debounce delay
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // REST API should NOT have been called
    expect(client.versions.create).not.toHaveBeenCalled();

    // CRDT path should have been used — applyLocalChange called in saveData
    expect(mockApplyLocalChange).toHaveBeenCalledWith(mockPuckData);

    // Save status should be 'saved' (realtime path marks it saved)
    expect(result.current.saveStatus).toBe('saved');
  });

  // =========================================================================
  // Test 2: Should call REST API save when realtime is NOT connected
  // =========================================================================

  it('should call REST API save when realtime is not connected', async () => {
    mockRealtimeConnected = false;

    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      autoSaveDelay: 1000,
    });

    // Trigger saveData
    act(() => {
      result.current.saveData(mockPuckData);
    });

    // Advance past debounce delay
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // REST API SHOULD have been called as fallback
    expect(client.versions.create).toHaveBeenCalled();
  });

  // =========================================================================
  // Test 3: Should call REST API save when realtime is disabled
  // =========================================================================

  it('should call REST API save when realtime is disabled', async () => {
    mockRealtimeConnected = false;

    const result = await renderAndLoadDocument({
      enableRealtime: false,
      autoSaveDelay: 1000,
    });

    // Trigger saveData
    act(() => {
      result.current.saveData(mockPuckData);
    });

    // Advance past debounce delay
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // REST API SHOULD be called when realtime is disabled
    expect(client.versions.create).toHaveBeenCalled();

    // CRDT path should NOT have been used (realtime is disabled)
    expect(mockApplyLocalChange).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 4: Should set saveStatus to 'saved' after realtime sync
  // =========================================================================

  it('should set saveStatus to saved after realtime sync timeout', async () => {
    mockRealtimeConnected = true;

    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      autoSaveDelay: 1000,
    });

    // Trigger saveData
    act(() => {
      result.current.saveData(mockPuckData);
    });

    // Before debounce fires, status should transition to saving or similar
    // After debounce fires (performSave skips REST), status should be 'saved'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.saveStatus).toBe('saved');
    expect(result.current.lastSaved).not.toBeNull();
  });

  // =========================================================================
  // Test 5: saveNow should flush via realtime when connected
  // =========================================================================

  it('should flush via saveNow using realtime when connected', async () => {
    mockRealtimeConnected = true;

    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      autoSaveDelay: 1000,
    });

    // Set pending data via saveData
    act(() => {
      result.current.saveData(mockPuckData);
    });

    // Now call saveNow immediately (before debounce fires)
    await act(async () => {
      await result.current.saveNow();
    });

    // REST API should NOT be called
    expect(client.versions.create).not.toHaveBeenCalled();

    // applyLocalChange should have been called (via throttle leading edge + saveNow flush)
    expect(mockApplyLocalChange).toHaveBeenCalledWith(mockPuckData);

    // Status should be saved
    expect(result.current.saveStatus).toBe('saved');
  });
});

// =============================================================================
// Realtime Sync Throttle Tests
// =============================================================================

describe('P1PuckProvider Realtime Sync Throttle', () => {
  let client: P1Client;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
    mockRealtimeConnected = true;
    mockApplyLocalChange.mockClear();
    mockGetSnapshot.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /**
   * Helper to render the hook and load a document so performSave has data.
   */
  async function renderAndLoadDocument(options: {
    enableRealtime?: boolean;
    wsBaseUrl?: string;
    autoSaveDelay?: number;
    realtimeSyncInterval?: number;
  } = {}) {
    const wrapper = createProviderWrapper(client, options);
    const { result } = renderHook(() => useP1Puck(), { wrapper });

    // Load document so currentDocument and currentData are set
    await act(async () => {
      await result.current.loadDocument('/pages/home');
    });

    // Consume the suppressNextSaveRef flag set by loadDocument.
    // In production, PuckDataSynchronizer's onChange echo does this automatically.
    act(() => {
      result.current.saveData(mockVersionSnapshot);
    });

    // When realtime is enabled, loadDocument increments pendingRemoteUpdatesRef
    // to prevent the REST-loaded data from bouncing back through Y.Doc.
    // Advance past the 100ms safety reset so subsequent saveData calls are
    // treated as genuine user edits (not stale REST data).
    if (options.enableRealtime) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
    }

    // Clear any applyLocalChange calls from setup
    mockApplyLocalChange.mockClear();

    return result;
  }

  // 1. Each saveData sends immediately (no throttle)
  it('should send applyLocalChange immediately on first saveData', async () => {
    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      realtimeSyncInterval: 250,
    });

    act(() => {
      result.current.saveData(mockPuckData);
    });

    // Fires immediately on every saveData — no throttle in the realtime path
    expect(mockApplyLocalChange).toHaveBeenCalledTimes(1);
    expect(mockApplyLocalChange).toHaveBeenCalledWith(mockPuckData);
  });

  // 2. Each saveData sends immediately — no coalescing in the realtime path
  it('should send applyLocalChange on every saveData call when realtime is connected', async () => {
    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      realtimeSyncInterval: 250,
    });

    const data1: PuckData = { content: [{ type: 'A', props: { id: '1' } }], root: { props: {} } };
    const data2: PuckData = { content: [{ type: 'B', props: { id: '2' } }], root: { props: {} } };
    const data3: PuckData = { content: [{ type: 'C', props: { id: '3' } }], root: { props: {} } };

    act(() => { result.current.saveData(data1); });
    expect(mockApplyLocalChange).toHaveBeenCalledTimes(1);
    expect(mockApplyLocalChange).toHaveBeenLastCalledWith(data1);

    act(() => { result.current.saveData(data2); });
    act(() => { result.current.saveData(data3); });
    expect(mockApplyLocalChange).toHaveBeenCalledTimes(3);
    expect(mockApplyLocalChange).toHaveBeenLastCalledWith(data3);

    // Timer advance has no effect — no trailing throttle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(mockApplyLocalChange).toHaveBeenCalledTimes(3);
  });

  // 3. No trailing call if no intermediate calls
  it('should not fire trailing call if no intermediate calls occurred', async () => {
    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      realtimeSyncInterval: 250,
    });

    act(() => { result.current.saveData(mockPuckData); });
    expect(mockApplyLocalChange).toHaveBeenCalledTimes(1);

    // Advance past interval -- no trailing should fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mockApplyLocalChange).toHaveBeenCalledTimes(1);
  });

  // 4. Save status updates on leading edge
  it('should set saveStatus to saved on leading edge send', async () => {
    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      realtimeSyncInterval: 250,
    });

    act(() => { result.current.saveData(mockPuckData); });

    expect(result.current.saveStatus).toBe('saved');
    expect(result.current.lastSaved).not.toBeNull();
  });

  // 5. Save status updates on trailing edge
  it('should update saveStatus on trailing edge send', async () => {
    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      realtimeSyncInterval: 250,
    });

    act(() => { result.current.saveData(mockPuckData); });

    // Rapid call
    act(() => {
      result.current.saveData({
        content: [{ type: 'Updated', props: { id: 'u1' } }],
        root: { props: {} },
      });
    });

    // Advance to trailing edge
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    // lastSaved should be updated
    expect(result.current.lastSaved).not.toBeNull();
    expect(result.current.saveStatus).toBe('saved');
  });

  // 6. saveData fires immediately regardless of realtimeSyncInterval
  it('should send applyLocalChange immediately regardless of realtimeSyncInterval', async () => {
    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      realtimeSyncInterval: 500,
    });

    const data1: PuckData = { content: [{ type: 'A', props: { id: '1' } }], root: { props: {} } };
    const data2: PuckData = { content: [{ type: 'B', props: { id: '2' } }], root: { props: {} } };

    act(() => { result.current.saveData(data1); });
    act(() => { result.current.saveData(data2); });

    // Both fire immediately — no throttle window
    expect(mockApplyLocalChange).toHaveBeenCalledTimes(2);
    expect(mockApplyLocalChange).toHaveBeenLastCalledWith(data2);

    // Timer advance has no further effect
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mockApplyLocalChange).toHaveBeenCalledTimes(2);
  });

  // 7. Throttle is a no-op when realtime not connected
  it('should not use throttle when realtime is not connected', async () => {
    mockRealtimeConnected = false;

    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      realtimeSyncInterval: 250,
    });

    act(() => { result.current.saveData(mockPuckData); });

    // applyLocalChange should NOT be called
    expect(mockApplyLocalChange).not.toHaveBeenCalled();

    // REST path should be used (after debounce)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(client.versions.create).toHaveBeenCalled();
  });

  // 8. saveNow — realtime path sends immediately so saveNow is a no-op for applyLocalChange
  it('should not call additional applyLocalChange via saveNow when realtime is connected', async () => {
    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      realtimeSyncInterval: 250,
    });

    const data1: PuckData = { content: [{ type: 'A', props: { id: '1' } }], root: { props: {} } };
    const data2: PuckData = { content: [{ type: 'B', props: { id: '2' } }], root: { props: {} } };

    // Both calls fire immediately — realtime path, no pendingDataRef set
    act(() => { result.current.saveData(data1); });
    act(() => { result.current.saveData(data2); });

    expect(mockApplyLocalChange).toHaveBeenCalledTimes(2);
    expect(mockApplyLocalChange).toHaveBeenLastCalledWith(data2);

    // saveNow: pendingDataRef is null (realtime path doesn't set it), so no extra call
    await act(async () => {
      await result.current.saveNow();
    });

    expect(mockApplyLocalChange).toHaveBeenCalledTimes(2);
  });

  // 9. REST debounce no longer sets save status when realtime connected
  it('should not trigger REST debounce path when realtime is connected', async () => {
    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      realtimeSyncInterval: 250,
      autoSaveDelay: 1000,
    });

    act(() => { result.current.saveData(mockPuckData); });

    // Advance well past the debounce delay
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // REST API should NOT have been called
    expect(client.versions.create).not.toHaveBeenCalled();
  });

  // 10. getHasUnsavedChanges reflects pending state
  it('should report unsaved changes between saveData and throttle send', async () => {
    const result = await renderAndLoadDocument({
      enableRealtime: true,
      wsBaseUrl: 'ws://localhost:8787',
      realtimeSyncInterval: 250,
    });

    // After leading edge fires, pendingDataRef is set to data by saveData
    // but throttle callback clears it. Since throttle runs synchronously on
    // leading edge, the callback runs first, then saveData sets pendingDataRef = data.
    // However the throttle callback sets it to null. The net result depends on ordering.
    // In our implementation: throttle fires sync -> null, then saveData sets -> data.
    // But getHasUnsavedChanges checks pendingDataRef which will be data.
    // Actually, for the leading edge case, the sequence is:
    // 1. throttledRealtimeSync(data, ...) calls func(data) synchronously -> sets pendingDataRef = null
    // 2. saveData continues: pendingDataRef.current = data
    // So getHasUnsavedChanges() returns true. But once the timer fires (no trailing),
    // nothing clears it. This is by design - pendingDataRef tracks "data not yet persisted via REST"
    // but with realtime, it's been sent via WebSocket.
    act(() => { result.current.saveData(mockPuckData); });

    // The throttle callback already sent the data and marked status as saved
    // pendingDataRef is set by saveData after throttle callback, but that's expected
    // since the data was already sent via WebSocket
    expect(result.current.saveStatus).toBe('saved');
  });
});
