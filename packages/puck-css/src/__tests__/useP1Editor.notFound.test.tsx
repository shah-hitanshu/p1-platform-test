/**
 * Tests for useP1Editor page-not-found behavior.
 *
 * A path with no document behind it is reported as `notFound` rather than as a
 * load error, so the editor can offer to create the page. `retry` re-opens the
 * same path once it exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { DocumentPathNotFoundError } from '../data/utils.js';

// ============================================================================
// Mutable context — tests mutate this object to simulate branch switches
// ============================================================================

const mockLoadDocument = vi.fn<(...args: unknown[]) => Promise<void>>();

const mockCcrContext = {
  featurePuckPlugins: [],
  branchId: 'branch-a',
  loadDocument: mockLoadDocument,
  documents: [] as {
    id: string;
    path: string;
    siteId: string;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
  }[],
  documentsLoading: false,
  currentDocument: null as null | { id: string; path: string; siteId: string },
  currentData: null,
  safeData: { content: [], root: { props: {} }, zones: {} },
  siteId: 'site-test',
  siteName: null,
  client: {} as unknown,
  sendFocusRegions: vi.fn().mockReturnValue(false),
  isViewingHistoricalVersion: false,
  saveData: vi.fn(),
  publishDocument: vi.fn().mockResolvedValue({}),
  switchBranch: vi.fn(),
  createBranch: vi.fn(),
  returnToLatest: vi.fn(),
  loadVersion: vi.fn(),
  viewingVersion: null,
  roleName: 'EDITOR' as const,
  permissions: { canView: true, canEdit: true, canCreateBranch: true, canEditDocuments: true, canCreateCheckpoint: true, canProposeMerge: true, canMerge: true, canMergeToMain: false, canManageGrants: false, canManageTemplates: false },
  userId: 'user-1',
  saveStatus: 'idle' as const,
  lastSaved: null,
  saveError: null,
  saveNow: vi.fn(),
  createCheckpoint: vi.fn(),
  getSaveStatus: vi.fn(),
  getLastSaved: vi.fn(),
  getSaveError: vi.fn(),
  getHasUnsavedChanges: vi.fn(),
  getSyncData: vi.fn(),
  getDataSyncKey: vi.fn(),
  refreshDocuments: vi.fn().mockResolvedValue(undefined),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  branches: [],
  currentBranch: null,
  refreshBranches: vi.fn(),
  branchesLoading: false,
  autoSavePaused: false,
  pauseAutoSave: vi.fn(),
  resumeAutoSave: vi.fn(),
  latestVersionData: null,
  realtimeEnabled: false,
  realtimeConnected: false,
  remoteSyncKey: null,
  handleAction: vi.fn(),
  hasActiveHumans: false,
  humanPresenceCount: 0,
  hasActiveAgents: false,
  agentEdit: null,
  triggerAgent: vi.fn(),
  stopAgent: vi.fn(),
  registerAgentCancel: vi.fn(() => vi.fn()),
  conflicts: [],
  dismissConflict: vi.fn(),
  notifications: {
    addNotification: vi.fn(),
    notifications: [],
    dismissNotification: vi.fn(),
  },
  get presence() {
    return {
      actors: [],
      humans: [],
      agents: [],
      hasActiveHumans: false,
      hasActiveAgents: false,
    };
  },
  _realtimeDataCaptureRef: null,
  _onRealtimeDataCapture: null,
};

// ============================================================================
// Mocks — declared before any imports from the module under test
// ============================================================================

vi.mock('../core/P1PuckContext', () => ({
  useP1Puck: () => mockCcrContext,
}));

vi.mock('../editor/useP1Plugin', () => ({
  useP1Plugin: () => ({}),
}));

vi.mock('../editor/useP1Overrides', () => ({
  useP1Overrides: () => ({}),
}));

vi.mock('../versioning/useVersions', () => ({
  useVersions: () => ({
    versions: [],
    loading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../editor/useComponentRegistry', () => ({
  useComponentRegistry: () => undefined,
}));

vi.mock('../editor/utils/buildThumbnailOverride', () => ({
  buildThumbnailOverride: () => ({}),
}));

vi.mock('../auth/index', () => ({
  useP1Auth: () => ({ user: null, logout: vi.fn() }),
}));

// Import after mocks
import { useP1Editor } from '../editor/useP1Editor';

// ============================================================================
// Helpers
// ============================================================================

function resetContext() {
  mockCcrContext.branchId = 'branch-a';
  mockCcrContext.documents = [];
  mockCcrContext.documentsLoading = false;
  mockCcrContext.currentDocument = null;
}

// ============================================================================
// Tests
// ============================================================================

describe('useP1Editor page-not-found handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetContext();
    mockCcrContext.loadDocument = mockLoadDocument;
  });

  it('reports a 404 as notFound rather than an error', async () => {
    mockLoadDocument.mockRejectedValue(new DocumentPathNotFoundError('/missing'));

    const { result } = renderHook(() =>
      useP1Editor({ documentPath: '/missing', puckConfig: {} }),
    );

    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('leaves a load failure without a status as an error', async () => {
    mockLoadDocument.mockRejectedValue(new Error('Network down'));

    const { result } = renderHook(() =>
      useP1Editor({ documentPath: '/missing', puckConfig: {} }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it('does not report notFound when the consumer handles the 404 itself', async () => {
    mockLoadDocument
      .mockRejectedValueOnce(new DocumentPathNotFoundError('/missing'))
      .mockResolvedValueOnce(undefined);

    const onDocumentNotFound = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useP1Editor({ documentPath: '/missing', puckConfig: {}, onDocumentNotFound }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(false);
  });

  it('retry re-opens the same path and clears notFound once the page exists', async () => {
    mockLoadDocument
      .mockRejectedValueOnce(new DocumentPathNotFoundError('/missing'))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() =>
      useP1Editor({ documentPath: '/missing', puckConfig: {} }),
    );

    await waitFor(() => expect(result.current.notFound).toBe(true));

    await act(async () => {
      result.current.retry();
    });

    expect(result.current.notFound).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(mockLoadDocument).toHaveBeenCalledTimes(2);
  });

  // A 404 raised after the path resolved (a missing version, say) says nothing about
  // whether the page exists, so it must not offer to create one that already does.
  it('does not report notFound for a bare 404 raised deeper in the load', async () => {
    mockLoadDocument.mockRejectedValue(
      Object.assign(new Error('Version not found'), { status: 404 }),
    );

    const { result } = renderHook(() =>
      useP1Editor({ documentPath: '/exists', puckConfig: {} }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(false);
  });

  // The 404 branch must not leave the previously loaded path marked as settled, or
  // navigating back to it early-returns and strands the panel over an empty canvas.
  it('clears notFound when the user navigates away from the missing path', async () => {
    mockLoadDocument.mockImplementation(async (path: unknown) => {
      if (path === '/missing') throw new DocumentPathNotFoundError('/missing');
    });

    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useP1Editor({ documentPath: path, puckConfig: {} }),
      { initialProps: { path: '/' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(false);

    rerender({ path: '/missing' });
    await waitFor(() => expect(result.current.notFound).toBe(true));

    rerender({ path: '/' });
    await waitFor(() => expect(result.current.notFound).toBe(false));
    expect(mockLoadDocument).toHaveBeenLastCalledWith('/');
  });

});
