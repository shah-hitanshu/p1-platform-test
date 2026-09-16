/**
 * Tests for the route invalidation useP1Editor performs after a publish.
 *
 * The editor publishes to the backend directly, so the app serving the public
 * pages never sees that request. Without this call it keeps serving the render
 * it cached before the publish — including the "no such page" render cached at
 * a path whose page has only just been created.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ============================================================================
// Mutable context — tests mutate this object to simulate branch switches
// ============================================================================

const mockLoadDocument = vi.fn<(...args: unknown[]) => Promise<void>>();

const mockCcrContext = {
  featurePuckPlugins: [],
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
  roleName: 'EDITOR' as const,
  permissions: { canView: true, canEdit: true, canCreateBranch: true, canEditDocuments: true, canCreateCheckpoint: true, canProposeMerge: true, canMerge: true, canMergeToMain: false, canManageGrants: false, canManageTemplates: false },
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
  refreshDocuments: vi.fn().mockResolvedValue(undefined),
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
  useP1Puck: () => mockCcrContext,
}));

// handlePublish is handed to the plugin as onPublish; capturing the options is
// how a test reaches it.
let pluginOptions: { onPublish?: () => Promise<void> } = {};
vi.mock('../editor/useP1Plugin', () => ({
  useP1Plugin: (opts: { onPublish?: () => Promise<void> }) => {
    pluginOptions = opts;
    return {};
  },
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

const getToken = vi.fn().mockResolvedValue('tok-123');
vi.mock('../auth/index', () => ({
  useP1Auth: () => ({ user: null, logout: vi.fn(), getToken }),
}));


// Import after mocks
import { useP1Editor } from '../editor/useP1Editor';

// ============================================================================
// Tests
// ============================================================================

const fetchMock = vi.fn();

async function mountAndPublish(documentPath: string) {
  const onPublishSuccess = vi.fn();
  const { result } = renderHook(() =>
    useP1Editor({
      documentPath,
      puckConfig: {},
      overrideOptions: { onPublishSuccess },
    }),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await pluginOptions.onPublish?.();
  });
  return { onPublishSuccess };
}

describe('useP1Editor publish revalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pluginOptions = {};
    mockCcrContext.branchId = 'branch-a';
    mockCcrContext.currentDocument = { id: 'doc-1', path: '/about', siteId: 'site-test' };
    mockCcrContext.loadDocument = mockLoadDocument;
    mockLoadDocument.mockResolvedValue(undefined);
    mockCcrContext.publishDocument = vi.fn().mockResolvedValue({ id: 'cp-1' });
    getToken.mockResolvedValue('tok-123');
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invalidates the published route after a successful publish', async () => {
    await mountAndPublish('/about');

    const call = fetchMock.mock.calls.find(([url]) => url === '/p1/api/revalidate');
    expect(call).toBeDefined();
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({ path: '/about' });
  });

  it('invalidates the path the editor has open, not the last one published', async () => {
    await mountAndPublish('/team/history');

    const call = fetchMock.mock.calls.find(([url]) => url === '/p1/api/revalidate');
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      path: '/team/history',
    });
  });

  it('does not invalidate when the publish itself failed', async () => {
    mockCcrContext.publishDocument = vi.fn().mockRejectedValue(new Error('publish failed'));

    const { result } = renderHook(() =>
      useP1Editor({ documentPath: '/about', puckConfig: {} }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await expect(pluginOptions.onPublish?.()).rejects.toThrow('publish failed');
    });

    expect(fetchMock.mock.calls.some(([url]) => url === '/p1/api/revalidate')).toBe(false);
  });

  // The publish has already committed by this point, so a failed invalidation
  // leaves a stale route — it does not turn a successful publish into a failed one.
  it('still reports the publish as successful when invalidation fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    const { onPublishSuccess } = await mountAndPublish('/about');

    expect(onPublishSuccess).toHaveBeenCalledTimes(1);
  });

  // The reviewer's case on #249: try/catch covers a rejection, not a promise that
  // never settles. An unbounded await here would mean a publish that committed is
  // never reported as done, so the user gets no confirmation and may publish again.
  it('still reports the publish as successful when invalidation hangs', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const onPublishSuccess = vi.fn();

    const { result } = renderHook(() =>
      useP1Editor({
        documentPath: '/about',
        puckConfig: {},
        overrideOptions: { onPublishSuccess },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.useFakeTimers();
    try {
      let published: Promise<void> | undefined;
      await act(async () => {
        published = pluginOptions.onPublish?.();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
        await published;
      });
    } finally {
      vi.useRealTimers();
    }

    expect(onPublishSuccess).toHaveBeenCalledTimes(1);
  });
});
