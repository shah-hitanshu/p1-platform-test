/**
 * useP1Editor pin permissions: the per-component resolvePermissions wrapper
 * reads `root.props._pinMap` from the live app state only when authoring a
 * template document. On a bound page the context resolver reads the live
 * template and is authoritative, so the page's own snapshot pinMap is ignored.
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

const ALL_ALLOWED = {
  edit: true,
  drag: true,
  delete: true,
  insert: true,
  duplicate: true,
};

type WrappedResolver = (
  data: { props?: { id?: string } },
  params: {
    permissions: Record<string, boolean>;
    appState: { data: { root: { props: Record<string, unknown> } } };
  },
) => Record<string, boolean>;

describe('useP1Editor pin permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadDocument.mockResolvedValue(undefined);
    mockCssContext.currentDocument = {
      id: 'doc-t',
      path: '_registry/templates/blog-post',
      siteId: 'site-test',
    };
    mockCssContext.resolvePermissions = () => ({ ...ALL_ALLOWED });
  });

  it('locks drag and delete for a snapshot-pinned component when authoring a template', async () => {
    const { result } = renderHook(() =>
      useP1Editor({
        documentPath: '_registry/templates/blog-post',
        puckConfig: { components: { HeadingBlock: {} } },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const config = result.current.puckProps.config as {
      components: Record<string, { resolvePermissions: WrappedResolver }>;
    };
    const resolve = config.components.HeadingBlock.resolvePermissions;
    const appState = {
      data: { root: { props: { _pinMap: { 'comp-1': true } } } },
    };

    const pinned = resolve({ props: { id: 'comp-1' } }, { permissions: ALL_ALLOWED, appState });
    expect(pinned.drag).toBe(false);
    expect(pinned.delete).toBe(false);
    expect(pinned.edit).toBe(true);

    const unpinned = resolve({ props: { id: 'comp-2' } }, { permissions: ALL_ALLOWED, appState });
    expect(unpinned.drag).toBe(true);
    expect(unpinned.delete).toBe(true);
  });

  it('ignores the document snapshot pinMap on a bound page', async () => {
    mockCssContext.currentDocument = {
      id: 'doc-p',
      path: 'blog/my-post',
      siteId: 'site-test',
    };

    const { result } = renderHook(() =>
      useP1Editor({
        documentPath: 'blog/my-post',
        puckConfig: { components: { HeadingBlock: {} } },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const config = result.current.puckProps.config as {
      components: Record<string, { resolvePermissions: WrappedResolver }>;
    };
    const resolve = config.components.HeadingBlock.resolvePermissions;
    const appState = {
      data: { root: { props: { _pinMap: { 'comp-1': true } } } },
    };

    const perms = resolve({ props: { id: 'comp-1' } }, { permissions: ALL_ALLOWED, appState });
    expect(perms.drag).toBe(true);
    expect(perms.delete).toBe(true);
  });

  it('forwards the component id to the context resolver so slot-id pinning applies', async () => {
    // Slot-id pinning resolves against the bound template inside the context
    // resolver, so the wrapper must hand it the component's own props.id.
    mockCssContext.resolvePermissions = ((item: { type: string; props?: { id?: string } }) =>
      item.props?.id === 'HeadingBlock-slot-1'
        ? { ...ALL_ALLOWED, drag: false, delete: false }
        : { ...ALL_ALLOWED }) as typeof mockCssContext.resolvePermissions;

    const { result } = renderHook(() =>
      useP1Editor({
        documentPath: 'blog/my-post',
        puckConfig: { components: { HeadingBlock: {} } },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const config = result.current.puckProps.config as {
      components: Record<string, { resolvePermissions: WrappedResolver }>;
    };
    const resolve = config.components.HeadingBlock.resolvePermissions;
    const appState = { data: { root: { props: {} } } };

    const pinnedSlot = resolve(
      { props: { id: 'HeadingBlock-slot-1' } },
      { permissions: ALL_ALLOWED, appState },
    );
    expect(pinnedSlot.drag).toBe(false);
    expect(pinnedSlot.delete).toBe(false);

    const localCopy = resolve(
      { props: { id: 'HeadingBlock-local-1' } },
      { permissions: ALL_ALLOWED, appState },
    );
    expect(localCopy.drag).toBe(true);
    expect(localCopy.delete).toBe(true);
  });
});
