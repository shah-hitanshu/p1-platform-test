/**
 * useP1Editor historical-version permissions: the top-level Puck `permissions`
 * prop is locked down while viewing a historical version (no drag/delete/etc.)
 * and MUST be explicitly re-enabled — not omitted — when returning to latest.
 *
 * Puck retains the last non-empty global permissions it was given, so omitting
 * the prop on exit leaves drag disabled until a full remount (page refresh).
 * See PCC-3421.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockLoadDocument = vi.fn<(...args: unknown[]) => Promise<void>>();

const mockCssContext = {
  branchId: 'branch-a',
  loadDocument: mockLoadDocument,
  documents: [] as { id: string; path: string }[],
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
  userRole: 'editor' as const,
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
  resolvePermissions: undefined as
    | undefined
    | ((item: { type: string }, appState: unknown) => Record<string, boolean>),
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

vi.mock('../../core/P1PuckContext.js', () => ({
  useP1Puck: () => mockCssContext,
}));

vi.mock('../../editor/useP1Plugin.js', () => ({
  useP1Plugin: () => ({}),
}));

vi.mock('../../editor/useP1Overrides.js', () => ({
  useP1Overrides: () => ({}),
}));

vi.mock('../../versioning/useVersions.js', () => ({
  useVersions: () => ({
    versions: [],
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

describe('useP1Editor historical-version permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadDocument.mockResolvedValue(undefined);
    mockCssContext.currentDocument = {
      id: 'doc-h',
      path: 'pages/home',
      siteId: 'site-test',
    };
    mockCssContext.isViewingHistoricalVersion = false;
  });

  it('locks down drag/delete/insert/duplicate while viewing a historical version', async () => {
    mockCssContext.isViewingHistoricalVersion = true;
    const { result } = renderHook(() =>
      useP1Editor({
        documentPath: 'pages/home',
        puckConfig: { components: { HeadingBlock: {} } },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // edit is intentionally omitted — ReadOnlyFieldsGuard's inert attribute
    // handles interaction blocking; Puck's edit permission is not used.
    const permissions = result.current.puckProps.permissions;
    expect(permissions).toEqual({
      delete: false,
      drag: false,
      duplicate: false,
      insert: false,
    });
  });

  it('explicitly re-enables permissions (not undefined) when not viewing a historical version', async () => {
    mockCssContext.isViewingHistoricalVersion = false;
    const { result } = renderHook(() =>
      useP1Editor({
        documentPath: 'pages/home',
        puckConfig: { components: { HeadingBlock: {} } },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Must be an explicit all-enabled object so exiting preview restores drag
    // immediately, rather than omitting the prop and leaving Puck's stale
    // locked-down global permissions in place (PCC-3421).
    const permissions = result.current.puckProps.permissions;
    expect(permissions).toBeDefined();
    expect(permissions).toEqual({
      delete: true,
      drag: true,
      duplicate: true,
      edit: true,
      insert: true,
    });
  });
});
