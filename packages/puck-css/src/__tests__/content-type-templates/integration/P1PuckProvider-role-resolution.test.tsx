/**
 * P1PuckProvider — backend role resolution integration tests.
 *
 * Verifies that the provider exposes the advisory auth endpoint's roleName and
 * permissions, and nothing else decides them.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { P1Client, Branch } from '@pantheon-systems/css-client';

vi.mock('../../../editor/useRealtime.js', () => ({
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

const { P1PuckProvider } = await import('../../../editor/P1PuckProvider.js');
const { useP1Puck } = await import('../../../core/P1PuckContext.js');

const EDITOR_PERMS = {
  canView: true, canEdit: true, canCreateBranch: true, canEditDocuments: true,
  canCreateCheckpoint: true, canProposeMerge: true, canMerge: true,
  canMergeToMain: false, canManageGrants: false, canManageTemplates: false,
};
const NO_ACCESS_PERMS = Object.fromEntries(Object.keys(EDITOR_PERMS).map((k) => [k, false])) as typeof EDITOR_PERMS;
const ADMIN_PERMS = { ...EDITOR_PERMS, canMergeToMain: true, canManageGrants: true, canManageTemplates: true };
const VIEWER = { ...EDITOR_PERMS, canEditDocuments: false, canManageTemplates: false };
const ADMIN = ADMIN_PERMS;
const TEST_SITE_ID = 'site-1';

const mockBranch: Branch = {
  id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

function createMockClient(authImpl: () => Promise<{ roleName: string; permissions: typeof EDITOR_PERMS }>): P1Client {
  const client: Record<string, unknown> = {
    branches: { list: vi.fn().mockResolvedValue([mockBranch]), get: vi.fn().mockResolvedValue(mockBranch) },
    documents: { list: vi.fn().mockResolvedValue([]), getByPath: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    versions: { list: vi.fn().mockResolvedValue([]), getLatest: vi.fn().mockResolvedValue({ id: 'v1', versionNumber: 1, snapshot: { content: [], root: { props: {} } }, createdAt: '2026-01-01T00:00:00Z' }), get: vi.fn(), create: vi.fn() },
    checkpoints: { list: vi.fn().mockResolvedValue([]) },
    presence: { getBranchPresence: vi.fn().mockResolvedValue({ actors: [] }) },
    templates: { list: vi.fn().mockResolvedValue([]) },
    auth: { getRole: vi.fn().mockImplementation(authImpl) },
  };
  client['withPrincipal'] = vi.fn().mockReturnValue(client);
  return client as unknown as P1Client;
}

function wrapper(client: P1Client) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(P1PuckProvider, { client, siteId: 'site-1', branchId: 'branch-1', userId: 'u-1' }, children);
}

describe('P1PuckProvider — role resolution', () => {
  afterEach(() => vi.clearAllMocks());

  it('exposes ADMIN roleName and permissions from the backend response', async () => {
    const client = createMockClient(async () => ({ roleName: 'ADMIN', permissions: ADMIN_PERMS }));
    const { result } = renderHook(() => useP1Puck(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.roleName).toBe('ADMIN'));
    expect(result.current.permissions).toEqual(ADMIN_PERMS);
    expect(result.current.permissionsOutcome).toBe('granted');
  });

  it('exposes VIEWER roleName with canEditDocuments=false', async () => {
    const viewerPerms = { ...EDITOR_PERMS, canEditDocuments: false, canManageTemplates: false };
    const client = createMockClient(async () => ({ roleName: 'VIEWER', permissions: viewerPerms }));
    const { result } = renderHook(() => useP1Puck(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.permissionsOutcome).toBe('granted'));
    expect(result.current.roleName).toBe('VIEWER');
    expect(result.current.permissions?.canEditDocuments).toBe(false);
  });

  it('has no roleName or permissions while pending', () => {
    let resolve: (v: unknown) => void;
    const client = createMockClient(() => new Promise((r) => { resolve = r; }) as Promise<{ roleName: string; permissions: typeof EDITOR_PERMS }>);
    const { result } = renderHook(() => useP1Puck(), { wrapper: wrapper(client) });
    // Before resolution nothing is known, so nothing is granted
    expect(result.current.permissionsOutcome).toBe('pending');
    expect(result.current.roleName).toBeNull();
    expect(result.current.permissions).toBeNull();
    resolve!({ roleName: 'EDITOR', permissions: EDITOR_PERMS });
  });

  it('refuses on NO_ACCESS', async () => {
    const client = createMockClient(async () => ({ roleName: 'NO_ACCESS', permissions: NO_ACCESS_PERMS }));
    const { result } = renderHook(() => useP1Puck(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.permissionsOutcome).toBe('refused'));
    expect(result.current.roleName).toBe('NO_ACCESS');
    expect(result.current.permissions).toBeNull();
  });

  it('goes unavailable on network error', async () => {
    const client = createMockClient(async () => { throw new Error('Network failure'); });
    const { result } = renderHook(() => useP1Puck(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.permissionsOutcome).toBe('unavailable'));
    expect(result.current.roleName).toBeNull();
    expect(result.current.permissions).toBeNull();
  });
});

function PermissionConsumer() {
  const { resolvePermissions } = useP1Puck();
  const perms = resolvePermissions?.({ type: 'Hero', props: { id: 'x' } }, null);
  return (
    <div>
      <span data-testid="puck-edit">{String(perms?.edit)}</span>
      <span data-testid="puck-drag">{String(perms?.drag)}</span>
    </div>
  );
}

function renderPermissions(client: ReturnType<typeof createMockClient>) {
  return render(
    <P1PuckProvider client={client as never} siteId={TEST_SITE_ID} userId="user-1">
      <PermissionConsumer />
    </P1PuckProvider>,
  );
}

describe('P1PuckProvider — resolvePermissions wiring', () => {
  afterEach(() => vi.clearAllMocks());

  it('denies prop editing to a granted VIEWER', async () => {
    renderPermissions(createMockClient(async () => ({ roleName: 'VIEWER', permissions: VIEWER })));
    await waitFor(() => expect(screen.getByTestId('puck-edit').textContent).toBe('false'));
    expect(screen.getByTestId('puck-drag').textContent).toBe('false');
  });

  it('leaves an ADMIN able to edit props', async () => {
    renderPermissions(createMockClient(async () => ({ roleName: 'ADMIN', permissions: ADMIN })));
    await waitFor(() => expect(screen.getByTestId('puck-edit').textContent).toBe('true'));
    expect(screen.getByTestId('puck-drag').textContent).toBe('true');
  });
});
