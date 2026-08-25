/**
 * useP1Editor additionalOverrides layering: the drawer built by
 * resolveLiveThumbnailDrawer is default-ON for every consumer, so
 * additionalOverrides is the only escape hatch to swap it out.
 * This file verifies the last-wins merge order:
 *   p1Overrides → liveThumbnailDrawer → thumbnailOverride → additionalOverrides
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { defaultDrawer, customDrawer } = vi.hoisted(() => ({
  defaultDrawer: vi.fn(() => null),
  customDrawer: vi.fn(() => null),
}));

const mockLoadDocument = vi.fn<(...args: unknown[]) => Promise<void>>();

const mockCcrContext = {
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
  useP1Puck: () => mockCcrContext,
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

// Control the default drawer so we can assert against a known reference.
vi.mock('../../editor/thumbnails/resolveLiveThumbnailDrawer.js', () => ({
  resolveLiveThumbnailDrawer: () => ({ drawer: defaultDrawer }),
}));

import { useP1Editor } from '../../editor/useP1Editor.js';

describe('useP1Editor additionalOverrides layering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadDocument.mockResolvedValue(undefined);
    mockCcrContext.currentDocument = {
      id: 'doc-1',
      path: 'pages/home',
      siteId: 'site-test',
    };
  });

  it('uses the default live thumbnail drawer when additionalOverrides has no drawer', async () => {
    const { result } = renderHook(() =>
      useP1Editor({
        documentPath: 'pages/home',
        puckConfig: { components: {} },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.puckProps.overrides.drawer).toBe(defaultDrawer);
  });

  it('additionalOverrides.drawer wins over the default live thumbnail drawer', async () => {
    const { result } = renderHook(() =>
      useP1Editor({
        documentPath: 'pages/home',
        puckConfig: { components: {} },
        additionalOverrides: { drawer: customDrawer },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.puckProps.overrides.drawer).toBe(customDrawer);
  });
});
