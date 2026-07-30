/**
 * handleRestoreVersion loadDocument failure: when versions.restore() succeeds
 * but loadDocument() rejects, a warning notification must be shown so the user
 * knows the editor content may be stale. The version list is still refreshed,
 * but revertCount is NOT incremented (Puck should not remount with stale state).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { DocumentVersion } from '@pantheon-systems/css-client';

// =============================================================================
// Context mock
// =============================================================================

const mockVersionsRestore = vi.fn().mockResolvedValue({ id: 'v-new', source: 'revert' });
const mockLoadDocument = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockAddNotification = vi.fn();
const mockResumeAutoSave = vi.fn();
const mockRefreshVersions = vi.fn().mockResolvedValue(undefined);

const mockCssContext = {
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
  persistCurrentEdits: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
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
    addNotification: mockAddNotification,
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

let capturedOnRestoreVersion: ((v: DocumentVersion) => Promise<void>) | null = null;

vi.mock('../../core/P1PuckContext.js', () => ({
  useP1Puck: () => mockCssContext,
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
    refresh: mockRefreshVersions,
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

describe('handleRestoreVersion loadDocument failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnRestoreVersion = null;
    mockCssContext.currentDocument = { id: 'doc-1', path: '/pages/home', siteId: 'site-test' };
    mockVersionsRestore.mockResolvedValue({ id: 'v-new', source: 'revert' });
    mockLoadDocument.mockResolvedValue(undefined);
    mockRefreshVersions.mockResolvedValue(undefined);
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
    mockLoadDocument.mockClear();
    mockVersionsRestore.mockClear();
    mockAddNotification.mockClear();
    mockRefreshVersions.mockClear();
    return { result };
  }

  it('shows a warning notification when loadDocument fails after a successful restore', async () => {
    mockLoadDocument.mockRejectedValue(new Error('network error'));
    await setup();

    const fn = capturedOnRestoreVersion;
    if (!fn) throw new Error('onRestoreVersion not captured');
    await act(async () => { await fn(OLD_VERSION); });

    expect(mockVersionsRestore).toHaveBeenCalledTimes(1);
    expect(mockAddNotification).toHaveBeenCalledTimes(1);
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning' }),
    );
  });

  it('still refreshes the version list but does not increment revertCount when loadDocument fails', async () => {
    mockLoadDocument.mockRejectedValue(new Error('network error'));
    const { result } = await setup();

    const revertCountBefore = result.current.puckKey;

    const fn = capturedOnRestoreVersion;
    if (!fn) throw new Error('onRestoreVersion not captured');
    await act(async () => { await fn(OLD_VERSION); });

    expect(mockRefreshVersions).toHaveBeenCalledTimes(1);
    // puckKey should not change — Puck must not remount with stale document state
    expect(result.current.puckKey).toBe(revertCountBefore);
  });

  it('does not show a notification when loadDocument succeeds', async () => {
    mockLoadDocument.mockResolvedValue(undefined);
    await setup();

    const fn = capturedOnRestoreVersion;
    if (!fn) throw new Error('onRestoreVersion not captured');
    await act(async () => { await fn(OLD_VERSION); });

    expect(mockAddNotification).not.toHaveBeenCalled();
  });
});
