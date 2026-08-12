/**
 * Regression tests for the editor rendering one workstream behind.
 *
 * Switching workstreams left the canvas showing the previously selected
 * workstream's document, deterministically and without ever self-correcting.
 * The sync key identified the document that had been *requested* rather than
 * the one in hand: branchId flips synchronously when a switch starts, while the
 * new document body is still in flight, so the store published the incoming
 * branch's key beside the outgoing branch's data. That pairing was applied,
 * the new key was recorded as applied, and the correct document — arriving
 * moments later under the same key — was then ignored as already applied.
 *
 * The fix records the identity each payload was actually loaded under and
 * derives the key from that, so the two can never disagree. These tests pin
 * the provider half: that the origin describes the payload, and that it never
 * claims the incoming branch while the outgoing branch's data is still shown.
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
  name: 'bl1059-blog-card-restore',
  isMain: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// One document, two branches — the reported case. The document is site-scoped,
// so its id is identical on both branches and only the branch distinguishes them.
const blogDoc = {
  id: 'doc-blog',
  siteId: 'site-1',
  path: 'blog',
  title: 'Blog',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function pageWithTitle(title: string): PuckData {
  return { content: [{ type: 'Card', props: { title } }], root: { props: { title } } };
}

const mainPage = pageWithTitle('CBB Partners with Teamworks');
const featurePage = pageWithTitle('How the NCAA Found Clarity');

interface ClientOptions {
  /** Per-branch delay before getLatest resolves, to open the in-flight window. */
  latestDelayMs?: Record<string, number>;
  /**
   * Branch id to stamp on the returned version regardless of what was
   * requested — models the copy-on-write fallback to main's published version.
   */
  versionBranchIdOverride?: string;
}

function createMockClient(options: ClientOptions = {}): P1Client {
  const { latestDelayMs = {}, versionBranchIdOverride } = options;

  return {
    branches: {
      list: vi.fn().mockResolvedValue([mainBranch, featureBranch]),
      get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    documents: {
      list: vi.fn().mockResolvedValue([blogDoc]),
      get: vi.fn(),
      getByPath: vi.fn().mockResolvedValue(blogDoc),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    versions: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getLatest: vi.fn().mockImplementation((_siteId: string, branchId: string) => {
        const version = {
          id: `v-${branchId}`,
          documentId: blogDoc.id,
          branchId: versionBranchIdOverride ?? branchId,
          versionNumber: 1,
          snapshot: branchId === featureBranch.id ? featurePage : mainPage,
          createdAt: '2026-01-01T00:00:00Z',
        };
        const delay = latestDelayMs[branchId];
        // Only the branches under test go through a timer; the rest resolve
        // immediately so awaiting a load never needs the clock advanced.
        return delay
          ? new Promise((resolve) => setTimeout(() => resolve(version), delay))
          : Promise.resolve(version);
      }),
      create: vi.fn().mockResolvedValue({ id: 'v-new', versionNumber: 2 }),
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
      children,
    );
  }
  return renderHook(() => useP1Puck(), { wrapper: Wrapper });
}

describe('workstream switch: data origin describes the payload, not the request', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    try { sessionStorage.clear(); } catch { /* noop */ }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('never reports the incoming branch while the outgoing document is still shown', async () => {
    // Delay the new branch's document so the in-flight window stays open.
    const client = createMockClient({ latestDelayMs: { [featureBranch.id]: 400 } });
    const { result } = renderProvider(client);

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => { await result.current.loadDocument('blog'); });

    expect(result.current.currentData).toEqual(mainPage);
    expect(result.current.currentDataOrigin?.branchId).toBe(mainBranch.id);

    // The switch commits the branch synchronously, then the editor reloads the
    // same path on it — the window the bug lived in.
    act(() => { void result.current.switchBranch(featureBranch.id); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.branchId).toBe(featureBranch.id);

    let load: Promise<void> | undefined;
    act(() => { load = result.current.loadDocument('blog'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    // Mid-flight the canvas still holds main's page (safeData is the last payload
    // the provider produced), and branchId already says feature. No origin may
    // exist here: publishing one would pair feature's key with main's data, get
    // applied, and then swallow feature's real document as already applied.
    expect(result.current.safeData).toEqual(mainPage);
    expect(result.current.currentDataOrigin).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await load;
    });

    expect(result.current.currentData).toEqual(featurePage);
    expect(result.current.currentDataOrigin?.branchId).toBe(featureBranch.id);
    expect(result.current.currentDataOrigin?.documentId).toBe(blogDoc.id);
  });

  // The backend serves main's published version for a document not yet edited on
  // the branch, so the version names main. Recording that as the origin would
  // make every consumer reject the payload as belonging to another workstream —
  // turning "one document behind" into "never loads at all".
  it('records the requesting branch when the backend falls back to an inherited version', async () => {
    const client = createMockClient({ versionBranchIdOverride: mainBranch.id });
    const { result } = renderProvider(client);

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    act(() => { void result.current.switchBranch(featureBranch.id); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    await act(async () => { await result.current.loadDocument('blog'); });

    expect(result.current.currentDataOrigin?.branchId).toBe(featureBranch.id);
    expect(result.current.currentDataOrigin?.versionId).toBe(`v-${featureBranch.id}`);
  });
});
