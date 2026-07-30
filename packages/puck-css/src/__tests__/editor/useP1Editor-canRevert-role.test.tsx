/**
 * useP1Editor canRevert role-based access control.
 *
 * canRevert must be true for 'admin' and 'editor', and false for
 * 'junior-editor'. The value is forwarded to useP1Plugin which wires
 * it to HistoricalVersionBanner — the sole revert entry-point after
 * the inline sidebar button was removed.
 *
 * Pattern: mock useP1Plugin to capture the canRevert option, vary
 * userRole on the CSS context, and assert per role.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// CSS context mock — tests vary userRole
// ---------------------------------------------------------------------------

const mockCssContext = {
  branchId: 'branch-a',
  loadDocument: vi.fn().mockResolvedValue(undefined),
  documents: [] as { id: string; path: string }[],
  documentsLoading: false,
  currentDocument: { id: 'doc-1', path: '/pages/home', siteId: 'site-test' } as {
    id: string; path: string; siteId: string;
  } | null,
  currentData: null,
  safeData: { content: [], root: { props: {} }, zones: {} },
  siteId: 'site-test',
  siteName: null,
  client: {
    versions: { restore: vi.fn().mockResolvedValue({ id: 'v-new' }) },
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
  userRole: 'admin' as 'admin' | 'editor' | 'junior-editor',
  saveStatus: 'idle' as const,
  lastSaved: null,
  saveError: null,
  saveNow: vi.fn().mockResolvedValue(undefined),
  persistCurrentEdits: vi.fn().mockResolvedValue(undefined),
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
  resolvePermissions: undefined as unknown,
  templates: [],
  templatesLoading: false,
  templatesError: null,
  refreshTemplates: vi.fn(),
  currentTemplate: null,
  get presence() {
    return { actors: [], humans: [], agents: [], hasActiveHumans: false, hasActiveAgents: false };
  },
  _realtimeDataCaptureRef: null,
  _onRealtimeDataCapture: null,
};

// Capture the canRevert value forwarded to useP1Plugin each render.
let capturedCanRevert: boolean | undefined = undefined;

vi.mock('../../core/P1PuckContext.js', () => ({
  useP1Puck: () => mockCssContext,
}));

vi.mock('../../editor/useP1Plugin.js', () => ({
  useP1Plugin: (opts: { canRevert?: boolean }) => {
    capturedCanRevert = opts.canRevert;
    return {};
  },
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderEditorWithRole(role: 'admin' | 'editor' | 'junior-editor') {
  mockCssContext.userRole = role;
  capturedCanRevert = undefined;

  const { result } = renderHook(() =>
    useP1Editor({
      documentPath: '/pages/home',
      puckConfig: { components: {} },
    }),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  return capturedCanRevert;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useP1Editor — canRevert role-based access control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCanRevert = undefined;
    mockCssContext.currentDocument = { id: 'doc-1', path: '/pages/home', siteId: 'site-test' };
  });

  it('sets canRevert=true for admin role', async () => {
    const canRevert = await renderEditorWithRole('admin');
    expect(canRevert).toBe(true);
  });

  it('sets canRevert=true for editor role', async () => {
    const canRevert = await renderEditorWithRole('editor');
    expect(canRevert).toBe(true);
  });

  it('sets canRevert=false for junior-editor role', async () => {
    const canRevert = await renderEditorWithRole('junior-editor');
    expect(canRevert).toBe(false);
  });
});
