/**
 * useP1Editor onChange guard: read-only roles must not persist changes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockCcrContext = {
  featurePuckPlugins: [],
  branchId: 'branch-a',
  loadDocument: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
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
  permissions: null as { canEditDocuments: boolean } | null,
  resolvePermissions: undefined as
    | undefined
    | ((item: { type: string }, appState: unknown) => Record<string, boolean>),
  get presence() {
    return { actors: [], humans: [], agents: [], hasActiveHumans: false, hasActiveAgents: false };
  },
  _realtimeDataCaptureRef: null,
  _onRealtimeDataCapture: null,
};

vi.mock('../../core/P1PuckContext.js', () => ({ useP1Puck: () => mockCcrContext }));
vi.mock('../../editor/useP1Plugin.js', () => ({ useP1Plugin: () => ({}) }));
vi.mock('../../editor/useP1Overrides.js', () => ({ useP1Overrides: () => ({}) }));
vi.mock('../../versioning/useVersions.js', () => ({
  useVersions: () => ({ versions: [], loading: false, refresh: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('../../editor/useComponentRegistry.js', () => ({ useComponentRegistry: () => undefined }));
vi.mock('../../editor/utils/buildThumbnailOverride.js', () => ({ buildThumbnailOverride: () => ({}) }));
vi.mock('../../auth/index.js', () => ({ useP1Auth: () => ({ user: null, logout: vi.fn() }) }));

import { useP1Editor } from '../../editor/useP1Editor.js';

describe('useP1Editor onChange — read-only save guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCcrContext.isViewingHistoricalVersion = false;
    mockCcrContext.permissions = null;
    mockCcrContext.currentDocument = { id: 'doc-1', path: 'pages/home', siteId: 'site-test' };
  });

  it('does not save when the role cannot edit documents', () => {
    mockCcrContext.permissions = { canEditDocuments: false };
    const { result } = renderHook(() => useP1Editor({ documentPath: '/home', puckConfig: {} }));

    act(() => result.current.puckProps.onChange({ content: [], root: {} }));

    expect(mockCcrContext.saveData).not.toHaveBeenCalled();
  });

  it('saves normally for a role that can edit documents', () => {
    mockCcrContext.permissions = { canEditDocuments: true };
    const { result } = renderHook(() => useP1Editor({ documentPath: '/home', puckConfig: {} }));

    act(() => result.current.puckProps.onChange({ content: [], root: {} }));

    expect(mockCcrContext.saveData).toHaveBeenCalled();
  });
});
