/**
 * Regression test: returnToLatest must load the TRUE latest version (PCC-3421).
 *
 * Bug: `returnToLatest` restored the in-memory `latestVersionData` cache, which
 * is captured only once at document open and never refreshed as autosave
 * creates new versions during the session. After viewing a historical version
 * and returning to current, the editor reverted to the pre-session snapshot and
 * the next autosave wrote that stale content as a brand-new version — silently
 * discarding the work saved during the session.
 *
 * A page refresh masked this because it re-ran loadDocument (re-fetching the
 * true latest). Enabling instant drag on return (the primary PCC-3421 fix)
 * removed the forced refresh and exposed the data loss.
 *
 * Fix: when no live Yjs snapshot is available, returnToLatest re-fetches the
 * latest version from the server instead of trusting the stale cache.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { useContext } from 'react';
import type { PuckData, DocumentVersion } from '@pantheon-systems/css-client';

const mockRealtimeState = {
  connected: false,
  connectedDocumentPath: null as string | null,
  applyLocalChange: vi.fn(),
  getSnapshot: vi.fn().mockReturnValue(null),
  error: null,
  sendFocusRegions: vi.fn().mockReturnValue(false),
  sendHeartbeat: vi.fn(),
  presenceViaWebSocket: false,
  waitForDelivery: vi.fn().mockResolvedValue(undefined),
  requestPublish: vi.fn().mockResolvedValue({ success: true }),
};

vi.mock('../../editor/useRealtime', () => ({
  useRealtime: () => ({ ...mockRealtimeState }),
}));

vi.mock('../../editor/useDocuments', () => ({
  useDocuments: () => ({
    documents: [],
    loading: false,
    refreshDocuments: vi.fn().mockResolvedValue([]),
    createDocument: vi.fn(),
    deleteDocument: vi.fn(),
  }),
}));

const mockClientMethods = {
  documents: {
    getByPath: vi.fn(),
    publish: vi.fn(),
  },
  versions: {
    getLatest: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
  },
  branches: {
    list: vi.fn().mockResolvedValue([]),
  },
  checkpoints: {
    create: vi.fn(),
  },
  presence: {
    getBranchPresence: vi.fn().mockResolvedValue({ actors: [] }),
  },
  agentEdit: {
    canEdit: vi.fn(),
    startEdit: vi.fn(),
    completeEdit: vi.fn(),
    abortEdit: vi.fn(),
    stopAgent: vi.fn(),
  },
  withPrincipal: vi.fn(),
};
mockClientMethods.withPrincipal.mockReturnValue(mockClientMethods);

vi.mock('@pantheon-systems/css-client', () => ({
  P1Client: vi.fn().mockImplementation(function () { return { ...mockClientMethods }; }),
}));

const mockNotifications = vi.hoisted(() => ({
  addNotification: vi.fn(),
  addError: vi.fn(),
  addInfo: vi.fn(),
  addSuccess: vi.fn(),
  notifications: [] as unknown[],
  dismissNotification: vi.fn(),
}));

vi.mock('../../core/NotificationContext', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNotifications: () => mockNotifications,
}));

import { P1PuckContext } from '../../core/P1PuckContext';
import { P1PuckProvider } from '../../editor/P1PuckProvider';

let capturedCtx: ReturnType<typeof useContext<typeof P1PuckContext>> = null;

function ContextCapture() {
  capturedCtx = useContext(P1PuckContext);
  return null;
}

const TEST_PATH = '/pages/home';
const TEST_DOC = { id: 'doc-1', path: TEST_PATH, siteId: 'test-site', branchId: 'branch-1' };

// Distinct snapshots: v1 = state at document open, v2 = latest after in-session
// autosave, old = the historical version being previewed.
const DATA_V1: PuckData = {
  content: [{ type: 'Heading', props: { id: 'h1' } }],
  root: { props: {} },
  zones: {},
};
const DATA_V2: PuckData = {
  content: [
    { type: 'Heading', props: { id: 'h1' } },
    { type: 'Paragraph', props: { id: 'p1' } },
  ],
  root: { props: {} },
  zones: {},
};
const DATA_OLD: PuckData = {
  content: [{ type: 'Heading', props: { id: 'old' } }],
  root: { props: {} },
  zones: {},
};

async function renderProvider(enableRealtime = false) {
  const { P1Client } = await import('@pantheon-systems/css-client');
  const client = new P1Client({ baseUrl: 'http://localhost:8787', apiKey: 'test' });
  render(
    <P1PuckProvider
      client={client}
      siteId="test-site"
      branchId="branch-1"
      userId="user-1"
      enableRealtime={enableRealtime}
      wsBaseUrl="ws://localhost:8787"
    >
      <ContextCapture />
    </P1PuckProvider>
  );
}

describe('returnToLatest stale-data regression (PCC-3421)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCtx = null;
    mockRealtimeState.connected = false;
    mockRealtimeState.connectedDocumentPath = null;
    mockRealtimeState.getSnapshot = vi.fn().mockReturnValue(null);
    mockClientMethods.withPrincipal.mockReturnValue(mockClientMethods);
  });

  it('re-fetches the true latest version on return instead of the stale cache', async () => {
    await renderProvider();
    expect(capturedCtx).not.toBeNull();
    const ctx = capturedCtx as unknown as {
      loadDocument: (p: string) => Promise<void>;
      loadVersion: (v: DocumentVersion) => Promise<void>;
      returnToLatest: () => Promise<void>;
      currentData: PuckData | null;
    };

    // 1. Open the document — latest is v1. This seeds latestVersionData = v1.
    mockClientMethods.documents.getByPath.mockResolvedValueOnce(TEST_DOC);
    mockClientMethods.versions.getLatest.mockResolvedValueOnce({
      id: 'v1', documentId: 'doc-1', branchId: 'branch-1',
      snapshot: DATA_V1, createdAt: '2026-01-01T00:00:00Z',
    });
    await act(async () => { await ctx.loadDocument(TEST_PATH); });

    // 2. Server latest advances to v2 (autosave created a newer version during
    //    the session). The cache still holds v1.
    mockClientMethods.versions.getLatest.mockResolvedValue({
      id: 'v2', documentId: 'doc-1', branchId: 'branch-1',
      snapshot: DATA_V2, createdAt: '2026-01-01T00:05:00Z',
    });

    // 3. View a historical version (enter preview).
    await act(async () => {
      await ctx.loadVersion({
        id: 'v-old', documentId: 'doc-1', branchId: 'branch-1',
        snapshot: DATA_OLD, createdAt: '2025-12-01T00:00:00Z',
      } as unknown as DocumentVersion);
    });

    const getLatestCallsBeforeReturn = mockClientMethods.versions.getLatest.mock.calls.length;

    // 4. Return to current.
    await act(async () => { await ctx.returnToLatest(); });

    // The editor must show the TRUE latest (v2), not the stale cached v1.
    const finalCtx = capturedCtx as unknown as { currentData: PuckData | null };
    expect(finalCtx.currentData).toEqual(DATA_V2);

    // And returning must have re-fetched from the server.
    expect(mockClientMethods.versions.getLatest.mock.calls.length)
      .toBeGreaterThan(getLatestCallsBeforeReturn);
  });

  it('does not drop the first real edit after returning (realtime path)', async () => {
    // Realtime enabled and connected, but no live Yjs snapshot — forces the
    // server re-fetch branch and the pendingRemoteUpdatesRef guard. Regression
    // guard for PCC-3421: returnToLatest arms BOTH suppressNextSaveRef and the
    // remote counter for a single echo; without the 100ms reset the counter
    // stays >0 and silently eats the user's next real edit.
    mockRealtimeState.connected = true;
    mockRealtimeState.connectedDocumentPath = TEST_PATH;
    mockRealtimeState.getSnapshot = vi.fn().mockReturnValue(null);
    const applyLocalChange = vi.fn();
    mockRealtimeState.applyLocalChange = applyLocalChange;

    await renderProvider(true);
    const ctx = capturedCtx as unknown as {
      loadDocument: (p: string) => Promise<void>;
      loadVersion: (v: DocumentVersion) => Promise<void>;
      returnToLatest: () => Promise<void>;
      saveData: (d: PuckData) => void;
    };

    // Open document — latest is v1. (loadDocument also arms the counter + a
    // 100ms reset in realtime, so wait it out before proceeding.)
    mockClientMethods.documents.getByPath.mockResolvedValueOnce(TEST_DOC);
    mockClientMethods.versions.getLatest.mockResolvedValueOnce({
      id: 'v1', documentId: 'doc-1', branchId: 'branch-1',
      snapshot: DATA_V1, createdAt: '2026-01-01T00:00:00Z',
    });
    await act(async () => { await ctx.loadDocument(TEST_PATH); });
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });

    // Server latest is v2.
    mockClientMethods.versions.getLatest.mockResolvedValue({
      id: 'v2', documentId: 'doc-1', branchId: 'branch-1',
      snapshot: DATA_V2, createdAt: '2026-01-01T00:05:00Z',
    });

    // View a historical version, then return to current.
    await act(async () => {
      await ctx.loadVersion({
        id: 'v-old', documentId: 'doc-1', branchId: 'branch-1',
        snapshot: DATA_OLD, createdAt: '2025-12-01T00:00:00Z',
      } as unknown as DocumentVersion);
    });
    await act(async () => { await ctx.returnToLatest(); });

    // Echo onChange fires with the restored data — consumed by suppressNextSaveRef.
    act(() => { ctx.saveData(DATA_V2); });
    expect(applyLocalChange).not.toHaveBeenCalled();

    // Wait past the 100ms counter reset, then make a genuine edit.
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    const realEdit: PuckData = {
      content: [
        { type: 'Heading', props: { id: 'h1' } },
        { type: 'Paragraph', props: { id: 'p1' } },
        { type: 'Quote', props: { id: 'q1' } },
      ],
      root: { props: {} },
      zones: {},
    };
    act(() => { ctx.saveData(realEdit); });

    // The real edit must reach the realtime layer, not be swallowed by a stuck
    // remote counter.
    expect(applyLocalChange).toHaveBeenCalledTimes(1);
    expect(applyLocalChange).toHaveBeenCalledWith(realEdit);
  });

  it('aborts and notifies (does not degrade to the stale cache) when the latest fetch fails', async () => {
    await renderProvider();
    const ctx = capturedCtx as unknown as {
      loadDocument: (p: string) => Promise<void>;
      loadVersion: (v: DocumentVersion) => Promise<void>;
      returnToLatest: () => Promise<void>;
      currentData: PuckData | null;
      isViewingHistoricalVersion: boolean;
    };

    // Open the document (seeds the fallback cache with v1).
    mockClientMethods.documents.getByPath.mockResolvedValueOnce(TEST_DOC);
    mockClientMethods.versions.getLatest.mockResolvedValueOnce({
      id: 'v1', documentId: 'doc-1', branchId: 'branch-1',
      snapshot: DATA_V1, createdAt: '2026-01-01T00:00:00Z',
    });
    await act(async () => { await ctx.loadDocument(TEST_PATH); });

    // View a historical version.
    await act(async () => {
      await ctx.loadVersion({
        id: 'v-old', documentId: 'doc-1', branchId: 'branch-1',
        snapshot: DATA_OLD, createdAt: '2025-12-01T00:00:00Z',
      } as unknown as DocumentVersion);
    });
    expect((capturedCtx as unknown as { currentData: PuckData | null }).currentData).toEqual(DATA_OLD);

    // The on-return fetch fails.
    mockClientMethods.versions.getLatest.mockRejectedValue(new Error('network down'));
    await act(async () => { await ctx.returnToLatest(); });

    // Must NOT silently swap in the stale cache and resume editing: stay on the
    // previewed version and surface an error (PCC-3421).
    expect(mockNotifications.addError).toHaveBeenCalledTimes(1);
    const finalCtx = capturedCtx as unknown as {
      currentData: PuckData | null;
      isViewingHistoricalVersion: boolean;
    };
    expect(finalCtx.currentData).toEqual(DATA_OLD);
    expect(finalCtx.currentData).not.toEqual(DATA_V1);
    expect(finalCtx.isViewingHistoricalVersion).toBe(true);
  });
});
