/**
 * Tests for the `?branch=<id>` deep link honored by P1PuckProvider.
 *
 * The dashboard's "Open in visual editor" builds
 * `{siteUrl}/p1{page.path}?branch={branchId}`. Without this the editor resolved
 * its workstream from sessionStorage/main only, so a deep link landed on main
 * with a blank canvas (the page exists only on the linked branch).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

const TEST_SITE_ID = 'site-deep-link-test';
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

vi.mock('../editor/useDocuments', () => ({
  useDocuments: () => ({ documents: [], loading: false }),
}));

vi.mock('../core/utils/debounce', () => ({
  debounce: (fn: (...args: unknown[]) => unknown) => {
    const debounced = (() => {
      /* no-op: these tests never rely on a delayed auto-save */
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
    checkpoints: { create: vi.fn() },
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

// Imports must come after mocks
import { P1PuckProvider } from '../editor/P1PuckProvider.js';
import { useP1Puck } from '../core/P1PuckContext.js';

function BranchConsumer() {
  const { branchId, currentBranch } = useP1Puck();
  return (
    <div>
      <span data-testid="branch-id">{branchId}</span>
      <span data-testid="branch-name">{currentBranch?.name ?? 'none'}</span>
    </div>
  );
}

function renderProvider(client = createMockClient()) {
  return render(
    <P1PuckProvider client={client as never} siteId={TEST_SITE_ID} userId="user-1">
      <BranchConsumer />
    </P1PuckProvider>,
  );
}

describe('?branch= deep link', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, '', '/p1');
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens the branch named by ?branch= instead of falling back to main', async () => {
    window.history.replaceState({}, '', `/p1/about?branch=${featureBranch.id}`);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(featureBranch.id);
      expect(screen.getByTestId('branch-name').textContent).toBe('feature');
    });
  });

  it('lets ?branch= win over a different persisted branch', async () => {
    sessionStorage.setItem(STORAGE_KEY, mainBranch.id);
    window.history.replaceState({}, '', `/p1/about?branch=${featureBranch.id}`);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(featureBranch.id);
    });
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(featureBranch.id);
  });

  // A param left in the URL would re-apply on the next provider remount and
  // silently undo a manual workstream switch.
  it('strips the param once consumed, preserving the rest of the URL', async () => {
    window.history.replaceState(
      {},
      '',
      `/p1/about?branch=${featureBranch.id}&keep=1`,
    );

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(featureBranch.id);
    });
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.pathname).toBe('/p1/about');
  });

  it('falls back to main when ?branch= names a branch this site does not have', async () => {
    window.history.replaceState({}, '', '/p1/about?branch=branch-from-another-site');

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(mainBranch.id);
      expect(screen.getByTestId('branch-name').textContent).toBe('main');
    });
  });

  // The id lands in API paths and the realtime URL unescaped, so a malformed
  // one must never reach the wire — documents.list fires on mount, well before
  // refreshBranches could reject it.
  it.each([
    ['path traversal', 'a/../../../../admin'],
    ['query injection', 'a?foo=1'],
    ['percent-encoded separator', 'a%2f..%2fadmin'],
    ['empty', ''],
  ])('ignores a %s ?branch= value instead of requesting it', async (_label, value) => {
    sessionStorage.setItem(STORAGE_KEY, featureBranch.id);
    window.history.replaceState(
      {},
      '',
      `/p1/about?branch=${encodeURIComponent(value)}`,
    );
    const client = createMockClient();

    renderProvider(client);

    // Resolution falls through to the persisted branch, as if no param existed.
    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(featureBranch.id);
    });
    for (const [, branchArg] of client._principalClient.documents.list.mock.calls) {
      expect(branchArg).not.toBe(value);
    }
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(featureBranch.id);
  });

  // Next.js enables StrictMode by default, so the double-invoked initializer
  // and double-run effect are the shape this actually ships in.
  it('resolves the deep link under StrictMode', async () => {
    window.history.replaceState({}, '', `/p1/about?branch=${featureBranch.id}`);
    const client = createMockClient();

    render(
      <React.StrictMode>
        <P1PuckProvider client={client as never} siteId={TEST_SITE_ID} userId="user-1">
          <BranchConsumer />
        </P1PuckProvider>
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(featureBranch.id);
      expect(screen.getByTestId('branch-name').textContent).toBe('feature');
    });
  });

  it('leaves branch resolution untouched when no param is present', async () => {
    sessionStorage.setItem(STORAGE_KEY, featureBranch.id);
    window.history.replaceState({}, '', '/p1/about');

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('branch-id').textContent).toBe(featureBranch.id);
    });
  });
});
