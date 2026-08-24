/**
 * Tests for the reload state useP1Editor reports to its caller.
 *
 * A reload empties the context data before the next document arrives. The hook
 * keeps the last props that rendered so the caller can leave the outgoing page
 * on screen, and says *why* it is reloading — a workstream switch and a page
 * switch look the same to the caller otherwise, and they need different copy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

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

/** A loadDocument whose promise the test resolves by hand. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeDoc(id: string, path: string) {
  return { id, path, siteId: 'site-test', archived: false, createdAt: '', updatedAt: '' };
}

function renderEditor(documentPath: string) {
  return renderHook(
    ({ path }: { path: string }) => useP1Editor({ documentPath: path, puckConfig: {} }),
    { initialProps: { path: documentPath } },
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('useP1Editor reload state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCssContext.branchId = 'branch-a';
    mockCssContext.documents = [makeDoc('doc-home', 'home')];
    mockCssContext.documentsLoading = false;
    mockCssContext.currentDocument = null;
    mockCssContext.safeData = { content: [], root: { props: {} }, zones: {} };
    mockCssContext.loadDocument = mockLoadDocument;
  });

  it('reports the first load as loading, with nothing worth rendering yet', async () => {
    const first = deferred();
    mockLoadDocument.mockReturnValueOnce(first.promise);

    const { result } = renderEditor('/home');

    expect(result.current.loading).toBe(true);
    expect(result.current.hasContent).toBe(false);
    expect(result.current.reloading).toBeNull();

    await act(async () => { first.resolve(); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasContent).toBe(true);
    expect(result.current.reloading).toBeNull();
  });

  it('calls a page switch a document reload, not a workstream one', async () => {
    mockLoadDocument.mockResolvedValueOnce(undefined);
    const { result, rerender } = renderEditor('/home');
    await waitFor(() => expect(result.current.loading).toBe(false));

    const second = deferred();
    mockLoadDocument.mockReturnValueOnce(second.promise);
    rerender({ path: '/about' });

    await waitFor(() => expect(result.current.reloading).toBe('document'));
    // Content is still on screen, so this is not the first-load wait.
    expect(result.current.loading).toBe(false);

    await act(async () => { second.resolve(); });
    await waitFor(() => expect(result.current.reloading).toBeNull());
  });

  it('calls a branch switch a workstream reload', async () => {
    mockLoadDocument.mockResolvedValueOnce(undefined);
    const { result, rerender } = renderEditor('/home');
    await waitFor(() => expect(result.current.loading).toBe(false));

    const second = deferred();
    mockLoadDocument.mockReturnValueOnce(second.promise);
    mockCssContext.branchId = 'branch-b';
    rerender({ path: '/home' });

    await waitFor(() => expect(result.current.reloading).toBe('branch'));
    expect(result.current.loading).toBe(false);

    await act(async () => { second.resolve(); });
    await waitFor(() => expect(result.current.reloading).toBeNull());
  });

  it('keeps calling it a workstream switch when the path changes a render later', async () => {
    // switchBranch commits the branch synchronously and the navigation that
    // goes with it lands in a later render, so the load effect runs twice for
    // one switch. Both runs have to report the same reason.
    mockLoadDocument.mockResolvedValueOnce(undefined);
    const { result, rerender } = renderEditor('/home');
    await waitFor(() => expect(result.current.loading).toBe(false));

    const pending = deferred();
    mockLoadDocument.mockReturnValue(pending.promise);

    mockCssContext.branchId = 'branch-b';
    rerender({ path: '/home' });
    await waitFor(() => expect(result.current.reloading).toBe('branch'));

    await act(async () => { rerender({ path: '/about' }); });
    expect(result.current.reloading).toBe('branch');

    await act(async () => { pending.resolve(); });
    await waitFor(() => expect(result.current.reloading).toBeNull());
  });

  it('goes back to calling it a page switch once the new branch has loaded', async () => {
    mockLoadDocument.mockResolvedValueOnce(undefined);
    const { result, rerender } = renderEditor('/home');
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockLoadDocument.mockResolvedValueOnce(undefined);
    mockCssContext.branchId = 'branch-b';
    rerender({ path: '/home' });
    await waitFor(() => expect(result.current.reloading).toBeNull());

    const pending = deferred();
    mockLoadDocument.mockReturnValueOnce(pending.promise);
    rerender({ path: '/about' });

    await waitFor(() => expect(result.current.reloading).toBe('document'));
    await act(async () => { pending.resolve(); });
  });

  it('keeps the last rendered props while the next document loads', async () => {
    mockLoadDocument.mockResolvedValueOnce(undefined);
    const { result, rerender } = renderEditor('/home');
    await waitFor(() => expect(result.current.loading).toBe(false));
    const loaded = result.current.puckProps;

    // The context empties its data mid-switch — the hook must not pass that on.
    const second = deferred();
    mockLoadDocument.mockReturnValueOnce(second.promise);
    mockCssContext.safeData = { content: [], root: { props: {} }, zones: {} };
    mockCssContext.branchId = 'branch-b';
    rerender({ path: '/home' });

    await waitFor(() => expect(result.current.reloading).toBe('branch'));
    expect(result.current.puckProps).toBe(loaded);

    const arrived = { content: [{ type: 'Text' }], root: { props: {} }, zones: {} };
    mockCssContext.safeData = arrived;
    await act(async () => { second.resolve(); });

    await waitFor(() => expect(result.current.puckProps.data).toBe(arrived));
  });

  it('keeps content on screen when a later load fails', async () => {
    mockLoadDocument.mockResolvedValueOnce(undefined);
    const { result, rerender } = renderEditor('/home');
    await waitFor(() => expect(result.current.loading).toBe(false));
    const loaded = result.current.puckProps;

    // No documents on the new branch — the hook surfaces an error, but the
    // caller still has the previous page to fall back on.
    mockCssContext.documents = [];
    mockLoadDocument.mockRejectedValueOnce(new Error('not found'));
    mockCssContext.branchId = 'branch-b';
    rerender({ path: '/home' });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.hasContent).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.puckProps).toBe(loaded);
  });
});
