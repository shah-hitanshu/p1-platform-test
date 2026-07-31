/**
 * Tests for sessionStorage-based branch persistence in P1PuckProvider.
 *
 * Validates:
 * - Provider reads persisted branch from sessionStorage on mount
 * - switchBranch writes the new branch ID to sessionStorage
 * - On remount, provider restores branch from sessionStorage
 * - Persisted branch is ignored if it doesn't exist in the fetched branch list
 * - initialBranchId prop takes priority over sessionStorage
 * - Rapid re-selection during an in-flight save-flush does not save the same
 *   outgoing edit twice to two different branches (PCC-3428 follow-up)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_SITE_ID = 'site-persistence-test';
const STORAGE_KEY = `css-branch-${TEST_SITE_ID}`;

const mainBranch = {
  id: 'branch-main',
  name: 'main',
  isMain: true,
  siteId: TEST_SITE_ID,
  createdAt: '2026-01-01T00:00:00Z',
};

const featureBranch = {
  id: 'branch-feature',
  name: 'feature',
  isMain: false,
  siteId: TEST_SITE_ID,
  createdAt: '2026-01-02T00:00:00Z',
};

const testBranches = [mainBranch, featureBranch];

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock useRealtime to avoid WebSocket setup
vi.mock('../editor/useRealtime', () => ({
  useRealtime: () => ({
    connected: false,
    provider: null,
    awareness: null,
    doc: null,
    connectionError: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

// Mock useDocuments to avoid document fetching
vi.mock('../editor/useDocuments', () => ({
  useDocuments: () => ({
    documents: [],
    loading: false,
  }),
}));

// Mock debounce as a no-op timer: none of these tests rely on the real
// delayed auto-save firing on its own, so the debounced function only acts
// when explicitly flushed. This keeps saveData()'s effect limited to setting
// pendingDataRef, letting tests control exactly when a flush (switchBranch,
// saveNow, etc.) is triggered instead of racing an immediately-invoked save.
vi.mock('../core/utils/debounce', () => ({
  debounce: (fn: (...args: unknown[]) => unknown) => {
    const debounced = (() => {
      /* no-op: tests trigger flushes explicitly */
    }) as ((...args: unknown[]) => unknown) & {
      cancel: () => void;
      flush: () => void;
      pause: () => void;
      resume: () => void;
      isPaused: () => boolean;
    };
    debounced.cancel = vi.fn();
    debounced.flush = vi.fn(() => {
      fn();
    });
    debounced.pause = vi.fn();
    debounced.resume = vi.fn();
    debounced.isPaused = vi.fn(() => false);
    return debounced;
  },
}));

// Mock retry utility
vi.mock('../core/utils/retry', () => ({
  withRetry: (fn: () => unknown) => fn(),
}));

function createMockClient(branchList = testBranches) {
  const principalClient = {
    branches: {
      list: vi.fn().mockResolvedValue(branchList),
      create: vi.fn(),
      delete: vi.fn(),
    },
    documents: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getByPath: vi.fn(),
      getOrCreate: vi.fn(),
      update: vi.fn(),
    },
    checkpoints: {
      create: vi.fn(),
    },
    versions: {
      list: vi.fn().mockResolvedValue([]),
      getLatest: vi.fn(),
      create: vi.fn(),
    },
  };

  return {
    withPrincipal: vi.fn().mockReturnValue(principalClient),
    _principalClient: principalClient,
  };
}

// ---------------------------------------------------------------------------
// Imports (must come after mocks)
// ---------------------------------------------------------------------------

import { P1PuckProvider } from '../editor/P1PuckProvider.js';
import { useP1Puck } from '../core/P1PuckContext.js';

// ---------------------------------------------------------------------------
// Helper: consumer component that exposes context values
// ---------------------------------------------------------------------------

function BranchConsumer() {
  const { branchId, currentBranch, switchBranch } = useP1Puck();
  return (
    <div>
      <span data-testid="branch-id">{branchId}</span>
      <span data-testid="branch-name">{currentBranch?.name ?? 'none'}</span>
      <button
        data-testid="switch-to-feature"
        onClick={() => void switchBranch(featureBranch.id)}
      >
        Switch to feature
      </button>
      <button
        data-testid="switch-to-main"
        onClick={() => void switchBranch(mainBranch.id)}
      >
        Switch to main
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: consumer component exercising loadDocument/saveData/switchBranch
// for the rapid re-selection regression test below.
// ---------------------------------------------------------------------------

function RaceConsumer() {
  const { switchBranch, loadDocument, saveData } = useP1Puck();
  return (
    <div>
      <button data-testid="load-doc" onClick={() => void loadDocument('home')}>
        Load
      </button>
      <button
        data-testid="edit"
        onClick={() =>
          saveData({
            content: [{ type: 'Text', props: { id: 'edit-1' } }],
            root: { props: {} },
          } as never)
        }
      >
        Edit
      </button>
      <button data-testid="switch-feature" onClick={() => void switchBranch(featureBranch.id)}>
        Switch feature
      </button>
      <button data-testid="switch-other" onClick={() => void switchBranch('branch-other')}>
        Switch other
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Branch persistence via sessionStorage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('initializes with persisted branch from sessionStorage when no initialBranchId prop', async () => {
    // Pre-populate sessionStorage with feature branch
    sessionStorage.setItem(STORAGE_KEY, featureBranch.id);

    const client = createMockClient();

    render(
      <P1PuckProvider
        client={client as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <BranchConsumer />
      </P1PuckProvider>
    );

    // Wait for branches to load and context to settle. `branchId` is already
    // correct on the very first render (it's derived synchronously from
    // sessionStorage in useState's initializer), but `currentBranch` is only
    // populated once the async branch list finishes loading. Asserting both
    // inside the same waitFor avoids racing that async completion.
    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(featureBranch.id);
      expect(screen.getByTestId('branch-name').textContent).toBe('feature');
    });

    // sessionStorage should still hold the persisted value
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(featureBranch.id);
  });

  it('persists new branch ID to sessionStorage when switchBranch is called', async () => {
    const client = createMockClient();

    render(
      <P1PuckProvider
        client={client as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <BranchConsumer />
      </P1PuckProvider>
    );

    // Wait for initial branch load (defaults to main)
    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(mainBranch.id);
    });

    // Switch to feature branch
    await act(async () => {
      screen.getByTestId('switch-to-feature').click();
    });

    expect(screen.getByTestId('branch-id').textContent).toBe(featureBranch.id);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(featureBranch.id);
  });

  it('restores branch from sessionStorage on remount', async () => {
    const client = createMockClient();

    // First mount - switch to feature branch to persist it
    const { unmount } = render(
      <P1PuckProvider
        client={client as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <BranchConsumer />
      </P1PuckProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(mainBranch.id);
    });

    // Switch to feature to persist it
    await act(async () => {
      screen.getByTestId('switch-to-feature').click();
    });

    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(featureBranch.id);

    // Unmount
    unmount();

    // Create a fresh client for the remount
    const client2 = createMockClient();

    // Remount - should restore feature branch from sessionStorage
    render(
      <P1PuckProvider
        client={client2 as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <BranchConsumer />
      </P1PuckProvider>
    );

    // Same race as the initial-mount test above: `branchId` is already
    // correct as soon as this remount's initial state reads sessionStorage,
    // while `currentBranch` only settles once the async branch list reload
    // finishes. Assert both together so we wait for that to actually happen.
    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(featureBranch.id);
      expect(screen.getByTestId('branch-name').textContent).toBe('feature');
    });
  });

  it('falls back to main when persisted branch does not exist in the branch list', async () => {
    // Ensure sessionStorage is empty so branchId state starts as ''
    sessionStorage.removeItem(STORAGE_KEY);

    const client = createMockClient();

    // On first render branchId is '' because sessionStorage is empty.
    // refreshBranches enters the fallback path: it reads the persisted ID
    // (empty), then defaults to main.
    render(
      <P1PuckProvider
        client={client as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <BranchConsumer />
      </P1PuckProvider>
    );

    // Should resolve to main since there is no persisted branch
    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(mainBranch.id);
    });

    expect(screen.getByTestId('branch-name').textContent).toBe('main');

    // Now persist a nonexistent branch and remount to verify fallback
    sessionStorage.setItem(STORAGE_KEY, 'branch-nonexistent');

    cleanup();

    const client2 = createMockClient();

    render(
      <P1PuckProvider
        client={client2 as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <BranchConsumer />
      </P1PuckProvider>
    );

    // The initial state reads 'branch-nonexistent' from sessionStorage.
    // refreshBranches detects the branch is not in the list and falls back to main.
    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(mainBranch.id);
    });

    expect(screen.getByTestId('branch-name').textContent).toBe('main');
  });

  it('initialBranchId prop takes priority over sessionStorage', async () => {
    // Pre-populate sessionStorage with feature branch
    sessionStorage.setItem(STORAGE_KEY, featureBranch.id);

    const client = createMockClient();

    render(
      <P1PuckProvider
        client={client as never}
        siteId={TEST_SITE_ID}
        branchId={mainBranch.id}
        userId="user-1"
      >
        <BranchConsumer />
      </P1PuckProvider>
    );

    // Should use the explicit branchId prop, not the persisted value.
    // `branchId` is already correct on the first render (it comes straight
    // from the prop), but `currentBranch` only settles once the async branch
    // list finishes loading. Assert both together so we wait for that.
    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(mainBranch.id);
      expect(screen.getByTestId('branch-name').textContent).toBe('main');
    });
  });

  it('serializes rapid re-selection so an in-flight save-flush is not duplicated onto an intermediate branch (PCC-3428 follow-up)', async () => {
    const otherBranch = {
      id: 'branch-other',
      name: 'other',
      isMain: false,
      siteId: TEST_SITE_ID,
      createdAt: '2026-01-03T00:00:00Z',
    };
    const client = createMockClient([mainBranch, featureBranch, otherBranch]);
    const principal = client._principalClient;

    principal.documents.getByPath = vi.fn().mockResolvedValue({
      id: 'doc-1',
      path: 'home',
      siteId: TEST_SITE_ID,
      title: 'Home',
    });
    principal.versions.getLatest = vi.fn().mockResolvedValue({
      id: 'v1',
      snapshot: { content: [], root: { props: {} } },
    });

    // Records every versions.create call's target branch. The first call is
    // gated behind a manually-resolved promise so the test can hold a save
    // "in flight" while additional switchBranch calls fire, reproducing the
    // rapid re-selection race. Later calls resolve immediately.
    const versionsCreateCalls: { branchId: string }[] = [];
    let resolveFirstCreate: ((value: { id: string }) => void) | null = null;
    principal.versions.create = vi.fn((_siteId: string, params: { branchId: string }) => {
      versionsCreateCalls.push({ branchId: params.branchId });
      if (versionsCreateCalls.length === 1) {
        return new Promise((resolve) => {
          resolveFirstCreate = resolve;
        });
      }
      return Promise.resolve({ id: `version-${versionsCreateCalls.length}` });
    });

    render(
      <P1PuckProvider client={client as never} siteId={TEST_SITE_ID} userId="user-1">
        <RaceConsumer />
      </P1PuckProvider>
    );

    // Wait for the initial branch load (defaults to main) before loading a document.
    await waitFor(() => {
      expect(principal.branches.list).toHaveBeenCalled();
    });

    await act(async () => {
      screen.getByTestId('load-doc').click();
    });
    await waitFor(() => {
      expect(principal.versions.getLatest).toHaveBeenCalled();
    });

    // Make a local edit — this only sets the pending-save ref; the mocked
    // debounce is a no-op so nothing auto-flushes yet.
    act(() => {
      screen.getByTestId('edit').click();
    });

    // Click 1: switch to the feature branch. This starts the outgoing
    // save-flush (versions.create #1, targeting branch-main) and suspends
    // on it, mirroring switchBranch's real, un-awaited call site
    // (startTransition(() => onSwitch(branch.id))).
    act(() => {
      screen.getByTestId('switch-feature').click();
    });

    // Click 2: rapid re-selection to another branch while click 1's flush is
    // still in flight (its versions.create call has not resolved).
    act(() => {
      screen.getByTestId('switch-other').click();
    });

    // Only the first flush should have started a save so far. Without the
    // serialization fix, click 2 immediately grabs its own performSave
    // closure (already pointed at the intermediate feature branch) and
    // issues a second versions.create call here — this assertion is what
    // fails against the unfixed switchBranch.
    expect(versionsCreateCalls).toHaveLength(1);
    expect(versionsCreateCalls[0]).toEqual({ branchId: mainBranch.id });

    // Resolve the in-flight save and let both switchBranch calls settle.
    await act(async () => {
      resolveFirstCreate?.({ id: 'version-1' });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The serialized second switch sees pendingDataRef already cleared by
    // the first flush, so it never issues a redundant save. Exactly one
    // versions.create call should have landed, on the originating branch.
    expect(versionsCreateCalls).toEqual([{ branchId: mainBranch.id }]);
  });
});
