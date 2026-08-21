/**
 * Tests for useP1Editor deleted-document behavior.
 *
 * When loadDocument fails with a 410 (the document at this path was
 * tombstoned, not merely absent), the hook must NOT invoke onDocumentNotFound
 * — which would otherwise auto-create a blank document at the path.
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

describe('useP1Editor deleted-document handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetContext();
    mockCssContext.loadDocument = mockLoadDocument;
  });

  it('does not call onDocumentNotFound for a 410 error', async () => {
    mockCssContext.documents = [makeDoc('doc-home', 'home')];
    const deletedError = Object.assign(new Error('Gone'), { status: 410 });

    mockLoadDocument
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(deletedError);

    const onDocumentNotFound = vi.fn().mockResolvedValue(true);

    const { result, rerender } = renderHook(
      ({ documentPath }: { documentPath: string }) =>
        useP1Editor({ documentPath, puckConfig: {}, onDocumentNotFound }),
      { initialProps: { documentPath: '/current' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    mockCssContext.branchId = 'branch-b';
    rerender({ documentPath: '/current' });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(onDocumentNotFound).not.toHaveBeenCalled();
  });
});
