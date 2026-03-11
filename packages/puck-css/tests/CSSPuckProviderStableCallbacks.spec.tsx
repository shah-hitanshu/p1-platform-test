/**
 * CSSPuckProvider Stable Callbacks Tests (TDD - Red Phase)
 *
 * Tests that callback references from useCSSPuck() remain referentially stable
 * across re-renders when internal state changes (e.g., save status transitions).
 *
 * Consumers should not need to wrap these callbacks in refs/useCallback manually.
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
// Test Suite
// =============================================================================

describe('CSSPuckProvider Stable Callbacks', () => {
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
   * Helper to render the hook and load a document.
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

    return result;
  }

  // =========================================================================
  // saveData should be referentially stable
  // =========================================================================

  it('saveData should maintain the same reference across re-renders', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const saveDataRef1 = result.current.saveData;

    // Trigger a state change by calling saveData (changes saveStatus)
    act(() => {
      result.current.saveData(mockPuckData);
    });

    // Advance past debounce to trigger save status transition
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const saveDataRef2 = result.current.saveData;

    expect(saveDataRef1).toBe(saveDataRef2);
  });

  // =========================================================================
  // saveNow should be referentially stable
  // =========================================================================

  it('saveNow should maintain the same reference across re-renders', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const saveNowRef1 = result.current.saveNow;

    // Trigger a state change
    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const saveNowRef2 = result.current.saveNow;

    expect(saveNowRef1).toBe(saveNowRef2);
  });

  // =========================================================================
  // createCheckpoint should be referentially stable
  // =========================================================================

  it('createCheckpoint should maintain the same reference across re-renders', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const createCheckpointRef1 = result.current.createCheckpoint;

    // Trigger a state change
    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const createCheckpointRef2 = result.current.createCheckpoint;

    expect(createCheckpointRef1).toBe(createCheckpointRef2);
  });

  // =========================================================================
  // pauseAutoSave should be referentially stable
  // =========================================================================

  it('pauseAutoSave should maintain the same reference across re-renders', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const pauseRef1 = result.current.pauseAutoSave;

    // Trigger a state change
    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const pauseRef2 = result.current.pauseAutoSave;

    expect(pauseRef1).toBe(pauseRef2);
  });

  // =========================================================================
  // resumeAutoSave should be referentially stable
  // =========================================================================

  it('resumeAutoSave should maintain the same reference across re-renders', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const resumeRef1 = result.current.resumeAutoSave;

    // Trigger a state change
    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const resumeRef2 = result.current.resumeAutoSave;

    expect(resumeRef1).toBe(resumeRef2);
  });

  // =========================================================================
  // switchBranch should be referentially stable
  // =========================================================================

  it('switchBranch should maintain the same reference across re-renders', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const switchBranchRef1 = result.current.switchBranch;

    // Trigger a state change
    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const switchBranchRef2 = result.current.switchBranch;

    expect(switchBranchRef1).toBe(switchBranchRef2);
  });

  // =========================================================================
  // loadDocument should be referentially stable
  // =========================================================================

  it('loadDocument should maintain the same reference across re-renders', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const loadDocumentRef1 = result.current.loadDocument;

    // Trigger a state change
    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const loadDocumentRef2 = result.current.loadDocument;

    expect(loadDocumentRef1).toBe(loadDocumentRef2);
  });

  // =========================================================================
  // loadVersion should be referentially stable
  // =========================================================================

  it('loadVersion should maintain the same reference across re-renders', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const loadVersionRef1 = result.current.loadVersion;

    // Trigger a state change
    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const loadVersionRef2 = result.current.loadVersion;

    expect(loadVersionRef1).toBe(loadVersionRef2);
  });

  // =========================================================================
  // returnToLatest should be referentially stable
  // =========================================================================

  it('returnToLatest should maintain the same reference across re-renders', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    const returnToLatestRef1 = result.current.returnToLatest;

    // Trigger a state change
    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const returnToLatestRef2 = result.current.returnToLatest;

    expect(returnToLatestRef1).toBe(returnToLatestRef2);
  });

  // =========================================================================
  // Stable callbacks should still work correctly when called
  // =========================================================================

  it('stable saveData should still work correctly after re-renders', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    // Capture the stable reference
    const stableSaveData = result.current.saveData;

    // Trigger a state change to cause re-render
    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Call the original captured reference - it should still work
    const updatedData: PuckData = {
      content: [{ type: 'Text', props: { id: 'text-2', text: 'Updated' } }],
      root: { props: {} },
    };

    act(() => {
      stableSaveData(updatedData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Save should have been triggered successfully
    expect(result.current.saveStatus).toBe('saved');
  });

  it('stable saveNow should still work correctly after re-renders', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    // Capture the stable reference
    const stableSaveNow = result.current.saveNow;

    // Set pending data and cause re-render
    act(() => {
      result.current.saveData(mockPuckData);
    });

    // Call the original captured reference
    await act(async () => {
      await stableSaveNow();
    });

    expect(result.current.saveStatus).toBe('saved');
  });

  it('stable createCheckpoint should still work correctly after re-renders', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    // Capture the stable reference
    const stableCreateCheckpoint = result.current.createCheckpoint;

    // Trigger a state change to cause re-render
    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Call the original captured reference
    const checkpoint = await act(async () => {
      return await stableCreateCheckpoint('Test checkpoint');
    });

    expect(checkpoint).toBeDefined();
    expect(client.checkpoints.create).toHaveBeenCalled();
  });

  // =========================================================================
  // All callbacks should be stable simultaneously
  // =========================================================================

  it('all callbacks should be stable across the same state transition', async () => {
    const result = await renderAndLoadDocument({ autoSaveDelay: 1000 });

    // Capture all references
    const refs1 = {
      saveData: result.current.saveData,
      saveNow: result.current.saveNow,
      createCheckpoint: result.current.createCheckpoint,
      pauseAutoSave: result.current.pauseAutoSave,
      resumeAutoSave: result.current.resumeAutoSave,
      switchBranch: result.current.switchBranch,
      loadDocument: result.current.loadDocument,
      loadVersion: result.current.loadVersion,
      returnToLatest: result.current.returnToLatest,
    };

    // Trigger a state change
    act(() => {
      result.current.saveData(mockPuckData);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Verify all references are the same
    expect(result.current.saveData).toBe(refs1.saveData);
    expect(result.current.saveNow).toBe(refs1.saveNow);
    expect(result.current.createCheckpoint).toBe(refs1.createCheckpoint);
    expect(result.current.pauseAutoSave).toBe(refs1.pauseAutoSave);
    expect(result.current.resumeAutoSave).toBe(refs1.resumeAutoSave);
    expect(result.current.switchBranch).toBe(refs1.switchBranch);
    expect(result.current.loadDocument).toBe(refs1.loadDocument);
    expect(result.current.loadVersion).toBe(refs1.loadVersion);
    expect(result.current.returnToLatest).toBe(refs1.returnToLatest);
  });
});
