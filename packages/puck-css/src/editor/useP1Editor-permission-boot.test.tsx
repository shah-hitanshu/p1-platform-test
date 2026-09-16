/**
 * useP1Editor — permission boot gate tests.
 *
 * Verifies that useP1Editor gates inFlight/error on the permissionsOutcome
 * from the advisory auth endpoint via P1PuckProvider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import type { P1Client, Branch } from '@pantheon-systems/css-client';
import { richtextField } from '../data/fields.js';

vi.mock('./useRealtime.js', () => ({
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

vi.mock('../auth/index.js', () => ({
  useP1Auth: () => ({
    isAuthenticated: false, isLoading: false, user: null, token: null, error: null,
    authMode: 'mock' as const, isSessionExpired: false,
    login: vi.fn(), logout: vi.fn(), getToken: vi.fn().mockResolvedValue(null),
  }),
}));

const { P1PuckProvider } = await import('./P1PuckProvider.js');
const { useP1Editor } = await import('./useP1Editor.js');

const EDITOR_PERMS = {
  canView: true, canEdit: true, canCreateBranch: true, canEditDocuments: true,
  canCreateCheckpoint: true, canProposeMerge: true, canMerge: true,
  canMergeToMain: false, canManageGrants: false, canManageTemplates: false,
};
const NO_ACCESS_PERMS = Object.fromEntries(Object.keys(EDITOR_PERMS).map((k) => [k, false])) as typeof EDITOR_PERMS;

const mockBranch: Branch = {
  id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

const mockDocument = {
  id: 'doc-1', siteId: 'site-1', path: '/home',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

function makeClient(authImpl: () => Promise<{ roleName: string; permissions: typeof EDITOR_PERMS }>): P1Client {
  const c: Record<string, unknown> = {
    branches: { list: vi.fn().mockResolvedValue([mockBranch]), get: vi.fn().mockResolvedValue(mockBranch) },
    documents: { list: vi.fn().mockResolvedValue([mockDocument]), getByPath: vi.fn().mockResolvedValue(mockDocument), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    versions: { list: vi.fn().mockResolvedValue([]), getLatest: vi.fn().mockResolvedValue({ id: 'v1', versionNumber: 1, snapshot: { content: [], root: { props: {} } }, createdAt: '2026-01-01' }), get: vi.fn(), create: vi.fn() },
    checkpoints: { list: vi.fn().mockResolvedValue([]) },
    presence: { getBranchPresence: vi.fn().mockResolvedValue({ actors: [] }) },
    templates: { list: vi.fn().mockResolvedValue([]) },
    auth: { getRole: vi.fn().mockImplementation(authImpl) },
  };
  c['withPrincipal'] = vi.fn().mockReturnValue(c);
  return c as unknown as P1Client;
}

const mockConfig = { components: {} };

const VIEWER_PERMS = { ...EDITOR_PERMS, canEditDocuments: false };

const mockConfigWithRichtext = {
  components: {
    Para: {
      fields: { body: richtextField },
      render: () => null,
    },
  },
};

const mockConfigWithNestedRichtext = {
  components: {
    Card: {
      fields: {
        meta: {
          type: 'object' as const,
          label: 'Meta',
          objectFields: { body: richtextField },
        },
      },
      render: () => null,
    },
  },
};

function wrapper(client: P1Client) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(P1PuckProvider, { client, siteId: 'site-1', branchId: 'branch-1', userId: 'u-1' }, children);
}

describe('useP1Editor permission boot gate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('stays loading while permissions are pending', async () => {
    // getRole never resolves during this test — permissions stay pending
    const client = makeClient(() => new Promise(() => {}));
    const { result } = renderHook(
      () => useP1Editor({ documentPath: '/home', puckConfig: mockConfig }),
      { wrapper: wrapper(client) },
    );
    // Advance time to trigger document load — but getRole is still pending
    await vi.advanceTimersByTimeAsync(50);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('returns error when permission is refused', async () => {
    const client = makeClient(async () => ({ roleName: 'NO_ACCESS', permissions: NO_ACCESS_PERMS }));
    const { result } = renderHook(
      () => useP1Editor({ documentPath: '/home', puckConfig: mockConfig }),
      { wrapper: wrapper(client) },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toMatch(/refused/i);
  });

  it('returns error when permission check is unavailable', async () => {
    const client = makeClient(async () => { throw new Error('Network failure'); });
    const { result } = renderHook(
      () => useP1Editor({ documentPath: '/home', puckConfig: mockConfig }),
      { wrapper: wrapper(client) },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toMatch(/unavailable/i);
  });

  it('boots normally when permission is granted', async () => {
    const client = makeClient(async () => ({ roleName: 'EDITOR', permissions: EDITOR_PERMS }));
    const { result } = renderHook(
      () => useP1Editor({ documentPath: '/home', puckConfig: mockConfig }),
      { wrapper: wrapper(client) },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('strips contentEditable from fields when role resolves to viewer', async () => {
    const client = makeClient(async () => ({ roleName: 'VIEWER', permissions: VIEWER_PERMS }));
    const { result } = renderHook(
      () => useP1Editor({ documentPath: '/home', puckConfig: mockConfigWithRichtext }),
      { wrapper: wrapper(client) },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    const body = (result.current.puckProps.config as any).components?.Para?.fields?.body;
    expect(body?.contentEditable).toBe(false);
  });

  it('preserves contentEditable when role resolves to editor', async () => {
    const client = makeClient(async () => ({ roleName: 'EDITOR', permissions: EDITOR_PERMS }));
    const { result } = renderHook(
      () => useP1Editor({ documentPath: '/home', puckConfig: mockConfigWithRichtext }),
      { wrapper: wrapper(client) },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    const body = (result.current.puckProps.config as any).components?.Para?.fields?.body;
    expect(body?.contentEditable).not.toBe(false);
  });

  it('strips contentEditable from nested objectFields for a viewer', async () => {
    const client = makeClient(async () => ({ roleName: 'VIEWER', permissions: VIEWER_PERMS }));
    const { result } = renderHook(
      () => useP1Editor({ documentPath: '/home', puckConfig: mockConfigWithNestedRichtext }),
      { wrapper: wrapper(client) },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    const body = (result.current.puckProps.config as any).components?.Card?.fields?.meta?.objectFields?.body;
    expect(body?.contentEditable).toBe(false);
  });

  it('per-component resolvePermissions enforces edit:false for a viewer regardless of params', async () => {
    const client = makeClient(async () => ({ roleName: 'VIEWER', permissions: VIEWER_PERMS }));
    const { result } = renderHook(
      () => useP1Editor({ documentPath: '/home', puckConfig: mockConfigWithRichtext }),
      { wrapper: wrapper(client) },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    const resolvePerms = (result.current.puckProps.config as any).components?.Para?.resolvePermissions;
    expect(resolvePerms).toBeDefined();

    // Simulate Puck passing all-true defaults — the wrapper must override edit to false.
    const perms = resolvePerms(
      { props: { id: 'c1' } },
      { permissions: { edit: true, drag: true, delete: true, duplicate: true }, appState: { data: { root: { props: {} } } } },
    );
    expect(perms.edit).toBe(false);
  });
});
