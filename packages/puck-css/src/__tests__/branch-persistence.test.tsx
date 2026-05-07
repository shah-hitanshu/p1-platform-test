/**
 * Tests for sessionStorage-based branch persistence in CSSPuckProvider.
 *
 * Validates:
 * - Provider reads persisted branch from sessionStorage on mount
 * - switchBranch writes the new branch ID to sessionStorage
 * - On remount, provider restores branch from sessionStorage
 * - Persisted branch is ignored if it doesn't exist in the fetched branch list
 * - initialBranchId prop takes priority over sessionStorage
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

// Mock debounce to pass through
vi.mock('../core/utils/debounce', () => ({
  debounce: (fn: (...args: unknown[]) => unknown) => {
    const debounced = fn as ((...args: unknown[]) => unknown) & {
      cancel: () => void;
      flush: () => void;
    };
    debounced.cancel = vi.fn();
    debounced.flush = vi.fn();
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
      getOrCreate: vi.fn(),
      update: vi.fn(),
    },
    checkpoints: {
      create: vi.fn(),
    },
    versions: {
      list: vi.fn().mockResolvedValue([]),
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

import { CSSPuckProvider } from '../editor/CSSPuckProvider.js';
import { useCSSPuck } from '../core/CSSPuckContext.js';

// ---------------------------------------------------------------------------
// Helper: consumer component that exposes context values
// ---------------------------------------------------------------------------

function BranchConsumer() {
  const { branchId, currentBranch, switchBranch } = useCSSPuck();
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
// Tests
// ---------------------------------------------------------------------------

describe('Branch persistence via sessionStorage', () => {
  let getItemSpy: ReturnType<typeof vi.spyOn>;
  let setItemSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();
    getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
  });

  afterEach(() => {
    cleanup();
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('initializes with persisted branch from sessionStorage when no initialBranchId prop', async () => {
    // Pre-populate sessionStorage with feature branch
    sessionStorage.setItem(STORAGE_KEY, featureBranch.id);
    // Clear spy call counts after setup
    getItemSpy.mockClear();
    setItemSpy.mockClear();

    const client = createMockClient();

    render(
      <CSSPuckProvider
        client={client as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <BranchConsumer />
      </CSSPuckProvider>
    );

    // Wait for branches to load and context to settle
    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(featureBranch.id);
    });

    expect(screen.getByTestId('branch-name').textContent).toBe('feature');

    // sessionStorage should have been read during initialization
    expect(getItemSpy).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('persists new branch ID to sessionStorage when switchBranch is called', async () => {
    const client = createMockClient();

    render(
      <CSSPuckProvider
        client={client as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <BranchConsumer />
      </CSSPuckProvider>
    );

    // Wait for initial branch load (defaults to main)
    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(mainBranch.id);
    });

    // Clear spies after initial setup
    setItemSpy.mockClear();

    // Switch to feature branch
    await act(async () => {
      screen.getByTestId('switch-to-feature').click();
    });

    expect(screen.getByTestId('branch-id').textContent).toBe(featureBranch.id);
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEY, featureBranch.id);
  });

  it('restores branch from sessionStorage on remount', async () => {
    const client = createMockClient();

    // First mount - switch to feature branch to persist it
    const { unmount } = render(
      <CSSPuckProvider
        client={client as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <BranchConsumer />
      </CSSPuckProvider>
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
      <CSSPuckProvider
        client={client2 as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <BranchConsumer />
      </CSSPuckProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(featureBranch.id);
    });

    expect(screen.getByTestId('branch-name').textContent).toBe('feature');
  });

  it('falls back to main when persisted branch does not exist in the branch list', async () => {
    // Ensure sessionStorage is empty so branchId state starts as ''
    sessionStorage.removeItem(STORAGE_KEY);

    const client = createMockClient();

    // On first render branchId is '' because sessionStorage is empty.
    // refreshBranches enters the fallback path: it reads the persisted ID
    // (empty), then defaults to main.
    render(
      <CSSPuckProvider
        client={client as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <BranchConsumer />
      </CSSPuckProvider>
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
      <CSSPuckProvider
        client={client2 as never}
        siteId={TEST_SITE_ID}
        userId="user-1"
      >
        <BranchConsumer />
      </CSSPuckProvider>
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
      <CSSPuckProvider
        client={client as never}
        siteId={TEST_SITE_ID}
        branchId={mainBranch.id}
        userId="user-1"
      >
        <BranchConsumer />
      </CSSPuckProvider>
    );

    // Should use the explicit branchId prop, not the persisted value
    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(mainBranch.id);
    });

    expect(screen.getByTestId('branch-name').textContent).toBe('main');
  });
});
