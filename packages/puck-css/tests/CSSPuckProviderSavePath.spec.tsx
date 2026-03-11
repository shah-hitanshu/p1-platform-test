/**
 * CSSPuckProvider Save Path Tests (TDD)
 *
 * Tests for unified save path behavior: when realtime is connected,
 * the REST API save should be skipped to avoid creating duplicate
 * versions without CRDT state. The DO handles persistence via WebSocket sync.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useCSSPuck } from '../src/CSSPuckContext.js';
import type { CSSClient, Branch, PuckData } from '@pantheon/css-client';

// =============================================================================
// Mock useRealtime hook
// =============================================================================

const mockApplyLocalChange = vi.fn();
const mockGetSnapshot = vi.fn().mockReturnValue(null);
const mockSendFocusRegions = vi.fn().mockReturnValue(false);
const mockSendHeartbeat = vi.fn();

let mockRealtimeConnected = false;

vi.mock('../src/hooks/useRealtime.js', () => ({
  useRealtime: () => ({
    connected: mockRealtimeConnected,
    applyLocalChange: mockApplyLocalChange,
    getSnapshot: mockGetSnapshot,
    error: null,
    sendFocusRegions: mockSendFocusRegions,
    sendHeartbeat: mockSendHeartbeat,
    presenceViaWebSocket: false,
    connectedDocumentPath: mockRealtimeConnected ? 'pages/home' : null,
  }),
}));

// =============================================================================
// Import CSSPuckProvider AFTER the mock
// =============================================================================

const { CSSPuckProvider } = await import('../src/CSSPuckProvider.js');

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

function createMockClient(): CSSClient {
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
  } as unknown as CSSClient;
}

// =============================================================================
// Provider Wrapper Factory
// =============================================================================

interface WrapperProps {
  children: React.ReactNode;
}

function createProviderWrapper(
  client: CSSClient,
  options: {
    siteId?: string;
    branchId?: string;
    userId?: string;
    enableRealtime?: boolean;
    wsBaseUrl?: string;
    autoSaveDelay?: number;
  } = {}
) {
  const {
    siteId = 'site-1',
    branchId = 'branch-1',
    userId = 'user-789',
    enableRealtime = false,
    wsBaseUrl,
    autoSaveDelay = 3000,
  } = options;

  return function Wrapper({ children }: WrapperProps) {
    return React.createElement(
      CSSPuckProvider,
      {
        client,
        siteId,
        branchId,
        userId,
        enableRealtime,
        wsBaseUrl,
        autoSaveDelay,
      },
      children
    );
  };
}

// =============================================================================
// Test Suite
// =============================================================================

describe('CSSPuckProvider Save Path - Realtime vs REST', () => {
  let client: CSSClient;

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
  } = {}) {
    const wrapper = createProviderWrapper(client, options);
    const { result } = renderHook(() => useCSSPuck(), { wrapper });

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

    // applyLocalChange should have been called (to send via WebSocket)
    expect(mockApplyLocalChange).toHaveBeenCalledWith(mockPuckData);

    // Status should be saved
    expect(result.current.saveStatus).toBe('saved');
  });
});
