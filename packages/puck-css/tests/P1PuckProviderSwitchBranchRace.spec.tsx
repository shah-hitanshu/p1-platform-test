/**
 * Regression test for PCC-3428.
 *
 * Bug: the Workstream switcher reset to Live/main when navigating between
 * documents in the P1 editor.
 *
 * Root cause: `switchBranch` (P1PuckProvider.tsx) only called
 * `persistBranchId`/`setBranchId` *after* awaiting a save-flush of the
 * outgoing document's pending edits. The switcher UI (WorkstreamSwitcher.tsx)
 * invokes `switchBranch` inside `startTransition` without awaiting it, so its
 * busy state clears (and the UI looks "done") as soon as the *synchronous*
 * portion of `switchBranch` returns — before that save-flush, and therefore
 * before sessionStorage was actually updated. If the user navigated to a
 * different document in that window, the editor route (no layout.tsx shields
 * it) remounts P1PuckProvider, whose `branchId` initializer re-reads
 * sessionStorage — landing back on the *previous* (Live/main) branch because
 * the persisted write hadn't happened yet.
 *
 * Fix: persist the new branch selection synchronously, before the save-flush
 * ever starts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import type { P1Client, Branch, PuckData } from '@pantheon-systems/css-client';

vi.mock('../src/editor/useRealtime.js', () => ({
  useRealtime: () => ({
    connected: false,
    applyLocalChange: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue(null),
    error: null,
    sendFocusRegions: vi.fn().mockReturnValue(false),
    sendHeartbeat: vi.fn(),
    presenceViaWebSocket: false,
    connectedDocumentPath: null,
  }),
}));

vi.mock('../src/auth/index.js', () => ({
  useP1Auth: () => ({
    isAuthenticated: false,
    isLoading: false,
    user: null,
    token: null,
    error: null,
    authMode: 'mock' as const,
    isSessionExpired: false,
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    getToken: vi.fn().mockResolvedValue(null),
  }),
}));

const { P1PuckProvider } = await import('../src/editor/P1PuckProvider.js');
const { useP1Puck } = await import('../src/core/P1PuckContext.js');

const mainBranch: Branch = {
  id: 'branch-main',
  siteId: 'site-1',
  name: 'main',
  isMain: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const featureBranch: Branch = {
  id: 'branch-feature',
  siteId: 'site-1',
  name: 'my-workstream',
  isMain: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const docA = {
  id: 'doc-a', siteId: 'site-1', path: 'pages/a', title: 'A',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

const snapshot: PuckData = { content: [], root: { props: {} } };

function createMockClient(saveDelayMs: number): P1Client {
  return {
    branches: {
      list: vi.fn().mockResolvedValue([mainBranch, featureBranch]),
      get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    documents: {
      list: vi.fn().mockResolvedValue([docA]),
      get: vi.fn(),
      getByPath: vi.fn().mockResolvedValue(docA),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    versions: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getLatest: vi.fn().mockResolvedValue({
        id: 'v1', versionNumber: 1, snapshot, createdAt: '2026-01-01T00:00:00Z',
      }),
      // Simulate a slow save of the outgoing document's pending edits —
      // this is the async gap the race hides in.
      create: vi.fn().mockImplementation(
        () => new Promise((resolve) =>
          setTimeout(() => resolve({ id: 'v2', versionNumber: 2 }), saveDelayMs)
        )
      ),
    },
    checkpoints: { list: vi.fn().mockResolvedValue([]), get: vi.fn(), create: vi.fn() },
    presence: { getSitePresence: vi.fn(), getBranchPresence: vi.fn(), getAgentPresence: vi.fn() },
    agentRegistry: {
      list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), updateStatus: vi.fn(), delete: vi.fn(),
    },
    agentEdit: { canEdit: vi.fn(), startEdit: vi.fn(), completeEdit: vi.fn(), abortEdit: vi.fn() },
    withPrincipal: vi.fn().mockReturnThis(),
  } as unknown as P1Client;
}

function renderProvider(client: P1Client) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      P1PuckProvider,
      { client, siteId: 'site-1', userId: 'user-1' },
      children
    );
  }
  return renderHook(() => useP1Puck(), { wrapper: Wrapper });
}

describe('PCC-3428: switching workstream with unsaved edits persists immediately', () => {
  const STORAGE_KEY = 'ccr-branch-site-1';

  beforeEach(() => {
    vi.useFakeTimers();
    try { sessionStorage.clear(); } catch { /* noop */ }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('persists the new branch to sessionStorage before the outgoing save-flush resolves', async () => {
    const client = createMockClient(5000); // slow save
    const { result } = renderProvider(client);

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(result.current.currentBranch?.isMain).toBe(true);

    // Load a document — performSave() is a no-op without a currentDocument,
    // so this is required for the save-flush below to actually go through
    // the (slow) versions.create call rather than short-circuiting.
    await act(async () => {
      await result.current.loadDocument('pages/a');
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.currentDocument?.path).toBe('pages/a');

    // Simulate unsaved edits on the current (main) document/branch.
    act(() => { result.current.saveData({ content: [{ type: 'X', props: {} }], root: { props: {} } }); });
    expect(result.current.getHasUnsavedChanges()).toBe(true);

    // Kick off the branch switch. Its save-flush of the pending edit will not
    // resolve for 5s — mirroring how WorkstreamSwitcher fires this without
    // awaiting it (fire-and-forget from the UI's perspective).
    let switchPromise: Promise<void> | undefined;
    act(() => { switchPromise = result.current.switchBranch('branch-feature'); });

    // Advance only a little — well before the save-flush would resolve.
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    // The user's workstream selection must already be committed and
    // persisted at this point, exactly as if they'd immediately navigated to
    // a different document (which would remount this provider and re-read
    // sessionStorage).
    expect(result.current.branchId).toBe('branch-feature');
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('branch-feature');

    // Let the flush finish so the test doesn't leave a dangling timer/act warning.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await switchPromise;
  });
});
