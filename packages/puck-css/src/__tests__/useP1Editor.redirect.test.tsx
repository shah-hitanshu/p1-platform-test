/**
 * Tests for useP1Editor document-not-found behavior.
 *
 * When loadDocument fails after a branch switch (the requested document
 * doesn't exist on the new branch), the hook:
 *   1. Sets loading=false and leaves currentDocument=null (empty state shown in preview)
 *   2. Sets error only when there are no documents at all on the branch
 *   3. Never sets redirectPath (always null — field is deprecated)
 *   4. Skips unload when onDocumentNotFound returns true (retry succeeds)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ============================================================================
// Mutable context — tests mutate this object to simulate branch switches
// ============================================================================

const mockLoadDocument = vi.fn<(...args: unknown[]) => Promise<void>>();

const mockCssContext = {
  branchId: 'branch-a',
  loadDocument: mockLoadDocument,
  documents: [] as Array<{
    id: string;
    path: string;
    siteId: string;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
  }>,
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
  useP1Puck: () => mockCssContext,
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

function makeDoc(id: string, path: string) {
  return {
    id,
    path,
    siteId: 'site-test',
    archived: false,
    createdAt: '',
    updatedAt: '',
  };
}

function resetContext() {
  mockCssContext.branchId = 'branch-a';
  mockCssContext.documents = [];
  mockCssContext.documentsLoading = false;
  mockCssContext.currentDocument = null;
}

// ============================================================================
// Tests
// ============================================================================

describe('useP1Editor auto-redirect on document not found', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetContext();
    mockCssContext.loadDocument = mockLoadDocument;
  });

  it('unloads silently (loading=false, no error) when doc is missing but other docs exist on branch', async () => {
    mockCssContext.documents = [
      makeDoc('doc-home', 'home'),
      makeDoc('doc-about', 'about'),
    ];

    // Initial load resolves; branch-switch load rejects
    mockLoadDocument
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('not found'));

    const { result, rerender } = renderHook(
      ({ documentPath }: { documentPath: string }) =>
        useP1Editor({ documentPath, puckConfig: {} }),
      { initialProps: { documentPath: '/current' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Branch switch — doc missing, but other docs exist
    mockCssContext.branchId = 'branch-b';
    rerender({ documentPath: '/current' });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Empty state shown in preview — no error, no redirect
    expect(result.current.error).toBeNull();
    expect(result.current.redirectPath).toBeNull();
    // Does NOT call loadDocument with a fallback path
    expect(mockLoadDocument).not.toHaveBeenCalledWith('home');
  });

  it('redirectPath is always null regardless of load outcome', async () => {
    mockCssContext.documents = [makeDoc('doc-home', 'home')];

    mockLoadDocument
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('not found'));

    const { result, rerender } = renderHook(
      ({ documentPath }: { documentPath: string }) =>
        useP1Editor({ documentPath, puckConfig: {} }),
      { initialProps: { documentPath: '/current' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.redirectPath).toBeNull();

    mockCssContext.branchId = 'branch-b';
    rerender({ documentPath: '/current' });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.redirectPath).toBeNull();
  });

  it('sets error state when no documents exist on the new branch', async () => {
    mockCssContext.documents = [];
    mockCssContext.documentsLoading = false;

    // Initial load resolves
    mockLoadDocument.mockResolvedValueOnce(undefined);

    const { result, rerender } = renderHook(
      ({ documentPath }: { documentPath: string }) =>
        useP1Editor({ documentPath, puckConfig: {} }),
      { initialProps: { documentPath: '/current' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Branch switch — load rejects and there are no documents at all
    mockCssContext.branchId = 'branch-b';
    mockLoadDocument.mockRejectedValueOnce(new Error('not found'));

    rerender({ documentPath: '/current' });

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.loading).toBe(false);
    expect(result.current.redirectPath).toBeNull();
  });

  it('onDocumentNotFound returning true takes priority over auto-redirect', async () => {
    mockCssContext.documents = [makeDoc('doc-home', 'home')];

    // Initial load resolves; branch-switch rejects; retry (after callback) resolves
    mockLoadDocument
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(undefined);

    const onDocumentNotFound = vi.fn().mockResolvedValue(true);

    const { result, rerender } = renderHook(
      ({ documentPath }: { documentPath: string }) =>
        useP1Editor({ documentPath, puckConfig: {}, onDocumentNotFound }),
      { initialProps: { documentPath: '/current' } },
    );

    // Wait for initial load
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Branch switch
    mockCssContext.branchId = 'branch-b';
    rerender({ documentPath: '/current' });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(onDocumentNotFound).toHaveBeenCalled();
    expect(result.current.redirectPath).toBeNull();

    // loadDocument should NOT have been called with 'home' (only called with '/current')
    const homeCall = mockLoadDocument.mock.calls.find(([path]) => path === 'home');
    expect(homeCall).toBeUndefined();
  });

  it('unloads silently when doc not found regardless of other docs on branch', async () => {
    mockCssContext.documents = [makeDoc('doc-home', 'home')];

    mockLoadDocument
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('not found'));

    const { result, rerender } = renderHook(() =>
      useP1Editor({ documentPath: '/current', puckConfig: {} }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    mockCssContext.branchId = 'branch-b';
    rerender();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.redirectPath).toBeNull();
  });

  it('redirectPath remains null after documentPath prop changes following a failed load', async () => {
    mockCssContext.documents = [makeDoc('doc-home', 'home')];

    mockLoadDocument
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(undefined);

    let docPath = '/current';

    const { result, rerender } = renderHook(() =>
      useP1Editor({ documentPath: docPath, puckConfig: {} }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.redirectPath).toBeNull();

    // Branch switch triggers unload
    mockCssContext.branchId = 'branch-b';
    rerender();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.redirectPath).toBeNull();

    // Caller navigates to a new page
    docPath = 'home';
    rerender();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.redirectPath).toBeNull();
  });
});
