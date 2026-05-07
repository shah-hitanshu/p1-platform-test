/**
 * CSSPuckProvider Getter Functions Tests (TDD)
 *
 * Tests for save-status getters, data sync getters, getHasUnsavedChanges,
 * and safeData exposed from context.
 *
 * Covers Items 2, 3, 4 of the stable consumer API plan.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useCSSPuck } from '../src/core/CSSPuckContext.js';
import type { CSSClient, Branch, PuckData } from '@pantheon-systems/css-client';

// =============================================================================
// Mock useRealtime hook
// =============================================================================

const mockApplyLocalChange = vi.fn();
const mockGetSnapshot = vi.fn().mockReturnValue(null);
const mockSendFocusRegions = vi.fn().mockReturnValue(false);
const mockSendHeartbeat = vi.fn();

let mockRealtimeConnected = false;

vi.mock('../src/editor/useRealtime.js', () => ({
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

const { CSSPuckProvider } = await import('../src/editor/CSSPuckProvider.js');

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
        createdAt: '2026-01-01T00:00:00Z',
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
// Test Suite: Item 2 - Save Status Getters
// =============================================================================

describe('CSSPuckProvider Save Status Getters (Item 2)', () => {
  let client: CSSClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
    mockRealtimeConnected = false;
    mockApplyLocalChange.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function renderAndLoadDocument(options: {
    enableRealtime?: boolean;
    wsBaseUrl?: string;
    autoSaveDelay?: number;
  } = {}) {
    const wrapper = createProviderWrapper(client, options);
    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    await act(async () => {
      await result.current.loadDocument('/pages/home');
    });

    // Consume the suppressNextSaveRef flag set by loadDocument.
    // In production, PuckDataSynchronizer's onChange echo does this automatically.
    act(() => {
      result.current.saveData(mockVersionSnapshot);
    });

    return result;
  }

  // =========================================================================
  // getSaveStatus
  // =========================================================================

  it('getSaveStatus should return the current save status', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    expect(result.current.getSaveStatus()).toBe('idle');

    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.getSaveStatus()).toBe('saved');
  });

  it('getSaveStatus should be referentially stable', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const ref1 = result.current.getSaveStatus;

    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.getSaveStatus).toBe(ref1);
  });

  // =========================================================================
  // getLastSaved
  // =========================================================================

  it('getLastSaved should return null initially, then Date after save', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    expect(result.current.getLastSaved()).toBeNull();

    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const lastSaved = result.current.getLastSaved();
    expect(lastSaved).toBeInstanceOf(Date);
  });

  it('getLastSaved should be referentially stable', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const ref1 = result.current.getLastSaved;

    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.getLastSaved).toBe(ref1);
  });

  // =========================================================================
  // getSaveError
  // =========================================================================

  it('getSaveError should return null when no error', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    expect(result.current.getSaveError()).toBeNull();
  });

  it('getSaveError should be referentially stable', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const ref1 = result.current.getSaveError;

    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.getSaveError).toBe(ref1);
  });

  // =========================================================================
  // getHasUnsavedChanges
  // =========================================================================

  it('getHasUnsavedChanges should return false initially', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    expect(result.current.getHasUnsavedChanges()).toBe(false);
  });

  it('getHasUnsavedChanges should return true after saveData, false after save completes', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    act(() => {
      result.current.saveData(mockPuckData);
    });

    // Before debounce fires, there are unsaved changes
    expect(result.current.getHasUnsavedChanges()).toBe(true);

    // After save completes
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.getHasUnsavedChanges()).toBe(false);
  });

  it('getHasUnsavedChanges should be referentially stable', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const ref1 = result.current.getHasUnsavedChanges;

    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.getHasUnsavedChanges).toBe(ref1);
  });
});

// =============================================================================
// Test Suite: Item 3 - Data Sync Getters
// =============================================================================

describe('CSSPuckProvider Data Sync Getters (Item 3)', () => {
  let client: CSSClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
    mockRealtimeConnected = false;
    mockApplyLocalChange.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function renderAndLoadDocument(options: {
    enableRealtime?: boolean;
    wsBaseUrl?: string;
    autoSaveDelay?: number;
  } = {}) {
    const wrapper = createProviderWrapper(client, options);
    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    await act(async () => {
      await result.current.loadDocument('/pages/home');
    });

    // Consume the suppressNextSaveRef flag set by loadDocument.
    // In production, PuckDataSynchronizer's onChange echo does this automatically.
    act(() => {
      result.current.saveData(mockVersionSnapshot);
    });

    return result;
  }

  // =========================================================================
  // getSyncData
  // =========================================================================

  it('getSyncData should return current data when available', async () => {
    const result = await renderAndLoadDocument();

    const syncData = result.current.getSyncData();
    expect(syncData).toBeDefined();
  });

  it('getSyncData should return undefined when no data loaded', () => {
    const wrapper = createProviderWrapper(createMockClient());
    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    expect(result.current.getSyncData()).toBeUndefined();
  });

  it('getSyncData should be referentially stable', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const ref1 = result.current.getSyncData;

    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.getSyncData).toBe(ref1);
  });

  // =========================================================================
  // getDataSyncKey
  // =========================================================================

  it('getDataSyncKey should return a key after document is loaded', async () => {
    const result = await renderAndLoadDocument();

    const key = result.current.getDataSyncKey();
    expect(key).toBeDefined();
    expect(typeof key).toBe('string');
  });

  it('getDataSyncKey should return undefined when no document loaded', () => {
    const wrapper = createProviderWrapper(createMockClient());
    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    expect(result.current.getDataSyncKey()).toBeUndefined();
  });

  it('getDataSyncKey should be referentially stable', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const ref1 = result.current.getDataSyncKey;

    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.getDataSyncKey).toBe(ref1);
  });
});

// =============================================================================
// Test Suite: Item 4 - safeData
// =============================================================================

describe('CSSPuckProvider safeData (Item 4)', () => {
  let client: CSSClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
    mockRealtimeConnected = false;
    mockApplyLocalChange.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('safeData should return empty PuckData when no document loaded', () => {
    const wrapper = createProviderWrapper(client);
    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    expect(result.current.safeData).toBeDefined();
    expect(result.current.safeData.content).toEqual([]);
    expect(result.current.safeData.root).toEqual({ props: {} });
  });

  it('safeData should return current data when document is loaded', async () => {
    const wrapper = createProviderWrapper(client);
    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    await act(async () => {
      await result.current.loadDocument('/pages/home');
    });

    expect(result.current.safeData).toBeDefined();
    // safeData should match the loaded data (mockVersionSnapshot)
    expect(result.current.safeData.content).toBeDefined();
    expect(result.current.safeData.root).toBeDefined();
  });

  it('safeData should never be null even when currentData is null', async () => {
    const wrapper = createProviderWrapper(client);
    const { result } = renderHook(() => useCSSPuck(), { wrapper });

    // currentData is null initially
    expect(result.current.currentData).toBeNull();
    // But safeData should never be null
    expect(result.current.safeData).not.toBeNull();
    expect(result.current.safeData).toBeDefined();
  });
});
