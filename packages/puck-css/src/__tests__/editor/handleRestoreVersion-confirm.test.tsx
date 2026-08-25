/**
 * handleRestoreVersion confirm-on-save-failure: when persistCurrentEdits rejects
 * (delivery ack failed in realtime mode), handleRestoreVersion must show a confirm
 * dialog before proceeding. If the user declines, the revert is aborted.
 *
 * Pattern: mock the CCR context, capture the onRestoreVersion callback from
 * useP1Plugin, call it directly, and assert on window.confirm and
 * ccr.client.versions.create calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { DocumentVersion } from '@pantheon-systems/css-client';

// =============================================================================
// Context mock — tests mutate persistCurrentEdits to simulate failures
// =============================================================================

const mockVersionsRestore = vi.fn().mockResolvedValue({ id: 'v-new', source: 'revert' });

const mockPersistCurrentEdits = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockLoadDocument = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockResumeAutoSave = vi.fn();

const mockCcrContext = {
  branchId: 'branch-a',
  loadDocument: mockLoadDocument,
  documents: [] as { id: string; path: string }[],
  documentsLoading: false,
  currentDocument: { id: 'doc-1', path: '/pages/home', siteId: 'site-test' } as {
    id: string;
    path: string;
    siteId: string;
  } | null,
  currentData: null,
  safeData: { content: [], root: { props: {} }, zones: {} },
  siteId: 'site-test',
  siteName: null,
  client: {
    versions: {
      restore: mockVersionsRestore,
    },
  } as unknown,
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
  userRole: 'admin' as const,
  saveStatus: 'idle' as const,
  lastSaved: null,
  saveError: null,
  saveNow: vi.fn().mockResolvedValue(undefined),
  persistCurrentEdits: mockPersistCurrentEdits,
  createCheckpoint: vi.fn(),
  getSaveStatus: vi.fn(),
  getLastSaved: vi.fn(),
  getSaveError: vi.fn(),
  getHasUnsavedChanges: vi.fn(),
  getSyncData: vi.fn(),
  getDataSyncKey: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  branches: [],
  currentBranch: null,
  refreshBranches: vi.fn(),
  refreshDocuments: vi.fn().mockResolvedValue(undefined),
  branchesLoading: false,
  autoSavePaused: false,
  pauseAutoSave: vi.fn(),
  resumeAutoSave: mockResumeAutoSave,
  latestVersionData: null,
  realtimeEnabled: true,
  realtimeConnected: true,
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
  resolvePermissions: undefined as unknown,
  templates: [],
  templatesLoading: false,
  templatesError: null,
  refreshTemplates: vi.fn(),
  currentTemplate: null,
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

// Capture the onRestoreVersion callback passed into useP1Plugin so tests can
// invoke handleRestoreVersion directly without going through the full UI.
let capturedOnRestoreVersion: ((v: DocumentVersion) => Promise<void>) | null = null;

vi.mock('../../core/P1PuckContext.js', () => ({
  useP1Puck: () => mockCcrContext,
}));

vi.mock('../../editor/useP1Plugin.js', () => ({
  useP1Plugin: (opts: { onRestoreVersion?: (v: DocumentVersion) => Promise<void> }) => {
    capturedOnRestoreVersion = opts.onRestoreVersion ?? null;
    return {};
  },
}));

vi.mock('../../editor/useP1Overrides.js', () => ({
  useP1Overrides: () => ({}),
}));

vi.mock('../../versioning/useVersions.js', () => ({
  useVersions: () => ({
    versions: [
      { id: 'v-latest', documentId: 'doc-1', snapshot: {}, createdAt: '2026-01-02T00:00:00Z' },
      { id: 'v-old', documentId: 'doc-1', snapshot: {}, createdAt: '2025-12-01T00:00:00Z' },
    ],
    loading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../editor/useComponentRegistry.js', () => ({
  useComponentRegistry: () => undefined,
}));

vi.mock('../../editor/utils/buildThumbnailOverride.js', () => ({
  buildThumbnailOverride: () => ({}),
}));

vi.mock('../../auth/index.js', () => ({
  useP1Auth: () => ({ user: null, logout: vi.fn() }),
}));

import { useP1Editor } from '../../editor/useP1Editor.js';

const OLD_VERSION: DocumentVersion = {
  id: 'v-old',
  documentId: 'doc-1',
  branchId: 'branch-a',
  snapshot: { content: [], root: { props: {} } } as unknown as DocumentVersion['snapshot'],
  createdAt: '2025-12-01T00:00:00Z',
} as DocumentVersion;

// =============================================================================
// Tests
// =============================================================================

describe('handleRestoreVersion confirm-on-save-failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnRestoreVersion = null;
    mockCcrContext.currentDocument = { id: 'doc-1', path: '/pages/home', siteId: 'site-test' };
    mockLoadDocument.mockResolvedValue(undefined);
    mockPersistCurrentEdits.mockResolvedValue(undefined);
    mockVersionsRestore.mockResolvedValue({ id: 'v-new', source: 'revert' });
  });

  async function setup() {
    const { result } = renderHook(() =>
      useP1Editor({
        documentPath: '/pages/home',
        puckConfig: { components: {} },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedOnRestoreVersion).not.toBeNull();
    // Clear call history from initial document load so only revert calls appear
    mockLoadDocument.mockClear();
    mockVersionsRestore.mockClear();
    return { result };
  }

  it('proceeds with revert without confirmation when persistCurrentEdits succeeds', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await setup();

    await act(async () => {
      expect(capturedOnRestoreVersion).not.toBeNull();
      await capturedOnRestoreVersion?.(OLD_VERSION);
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockVersionsRestore).toHaveBeenCalledTimes(1);
  });

  it('shows a confirm dialog when persistCurrentEdits rejects (delivery ack failed)', async () => {
    mockPersistCurrentEdits.mockRejectedValue(new Error('WS timeout'));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await setup();

    await act(async () => {
      expect(capturedOnRestoreVersion).not.toBeNull();
      await capturedOnRestoreVersion?.(OLD_VERSION);
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain('revert anyway');
  });

  it('aborts the revert when persistCurrentEdits fails and user declines the confirm', async () => {
    mockPersistCurrentEdits.mockRejectedValue(new Error('WS timeout'));
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    await setup();

    await act(async () => {
      expect(capturedOnRestoreVersion).not.toBeNull();
      await capturedOnRestoreVersion?.(OLD_VERSION);
    });

    // versions.restore must NOT be called — revert was aborted
    expect(mockVersionsRestore).not.toHaveBeenCalled();
    expect(mockLoadDocument).not.toHaveBeenCalled();
    // auto-save must be resumed even when the revert is aborted
    expect(mockResumeAutoSave).toHaveBeenCalledTimes(1);
  });

  it('proceeds with revert when persistCurrentEdits fails but user confirms anyway', async () => {
    mockPersistCurrentEdits.mockRejectedValue(new Error('WS timeout'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await setup();

    await act(async () => {
      expect(capturedOnRestoreVersion).not.toBeNull();
      await capturedOnRestoreVersion?.(OLD_VERSION);
    });

    // Revert proceeded despite save failure
    expect(mockVersionsRestore).toHaveBeenCalledTimes(1);
    expect(mockLoadDocument).toHaveBeenCalledTimes(1);
  });
});
