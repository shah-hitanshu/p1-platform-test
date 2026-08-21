/**
 * Tests for useP1Editor's handling of a branch that never resolves and of a
 * refused document list.
 *
 * Without a branch the hook can never start a document load, so the failure has
 * to surface as an error rather than an endless loading state. A refused
 * document list must not be reported as "no documents on this branch".
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
  branchResolutionError: null as Error | null,
  documentsError: null as Error | null,
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

vi.mock('../../core/P1PuckContext', () => ({
  useP1Puck: () => mockCssContext,
}));

vi.mock('../../editor/useP1Plugin', () => ({
  useP1Plugin: () => ({}),
}));

vi.mock('../../editor/useP1Overrides', () => ({
  useP1Overrides: () => ({}),
}));

vi.mock('../../versioning/useVersions', () => ({
  useVersions: () => ({
    versions: [],
    loading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../editor/useComponentRegistry', () => ({
  useComponentRegistry: () => undefined,
}));

vi.mock('../../editor/utils/buildThumbnailOverride', () => ({
  buildThumbnailOverride: () => ({}),
}));

vi.mock('../../auth/index', () => ({
  useP1Auth: () => ({ user: null, logout: vi.fn() }),
}));

// Import after mocks
import { useP1Editor } from '../../editor/useP1Editor';

// ============================================================================
// Helpers
// ============================================================================

function resetContext() {
  mockCssContext.branchId = 'branch-a';
  mockCssContext.documents = [];
  mockCssContext.documentsLoading = false;
  mockCssContext.currentDocument = null;
  mockCssContext.branchResolutionError = null;
  mockCssContext.documentsError = null;
}

// ============================================================================
// Tests
// ============================================================================

describe('useP1Editor branch resolution failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetContext();
    mockCssContext.loadDocument = mockLoadDocument;
  });

  it('surfaces the failure instead of loading forever', async () => {
    mockCssContext.branchId = '';
    mockCssContext.branchResolutionError = new Error(
      'GET /api/sites/site-test/branches failed (403): Insufficient scope for this operation',
    );

    const { result } = renderHook(() =>
      useP1Editor({ documentPath: '/current', puckConfig: {} }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toContain('/api/sites/site-test/branches');
    expect(result.current.error?.message).toContain('403');
    expect(mockLoadDocument).not.toHaveBeenCalled();
  });

  it('stops reporting the failure as soon as the context clears it', async () => {
    mockCssContext.branchId = '';
    mockCssContext.branchResolutionError = new Error('GET /api/sites/site-test/branches failed (403): nope');

    const { result, rerender } = renderHook(() =>
      useP1Editor({ documentPath: '/current', puckConfig: {} }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());

    // A retry is in flight: the failure is gone but no branch has resolved yet,
    // so the stale error must not survive.
    mockCssContext.branchResolutionError = null;
    rerender();

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('clears the error once a branch resolves', async () => {
    mockCssContext.branchId = '';
    mockCssContext.branchResolutionError = new Error('GET /api/sites/site-test/branches failed (403): nope');
    mockLoadDocument.mockResolvedValue(undefined);

    const { result, rerender } = renderHook(() =>
      useP1Editor({ documentPath: '/current', puckConfig: {} }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());

    mockCssContext.branchId = 'branch-a';
    mockCssContext.branchResolutionError = null;
    rerender();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
  });
});

describe('useP1Editor refused document list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetContext();
    mockCssContext.loadDocument = mockLoadDocument;
  });

  it('reports the refused request rather than "no documents"', async () => {
    mockCssContext.documentsError = new Error(
      'GET /api/sites/site-test/branches/branch-a/documents failed (403): Insufficient scope for this operation',
    );
    mockLoadDocument.mockRejectedValue(new Error('not found'));

    const { result } = renderHook(() =>
      useP1Editor({ documentPath: '/current', puckConfig: {} }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toContain('403');
    expect(result.current.error?.message).not.toContain('No documents found');
  });

  it('still reports an empty branch as empty', async () => {
    mockLoadDocument.mockRejectedValue(new Error('not found'));

    const { result } = renderHook(() =>
      useP1Editor({ documentPath: '/current', puckConfig: {} }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('No documents found on this branch');
  });
});
