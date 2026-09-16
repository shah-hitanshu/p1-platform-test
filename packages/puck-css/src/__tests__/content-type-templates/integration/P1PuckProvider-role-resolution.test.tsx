/**
 * P1PuckProvider — backend role resolution integration tests.
 *
 * Verifies that the provider resolves userRole from the advisory auth endpoint
 * rather than from the userRole prop.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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
const ADMIN_PERMS = { ...EDITOR_PERMS, canMergeToMain: true, canManageGrants: true, canManageTemplates: true };

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

  it('grants admin role from ADMIN backend response', async () => {
    const client = createMockClient(async () => ({ roleName: 'ADMIN', permissions: ADMIN_PERMS }));
    const { result } = renderHook(() => useP1Puck(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.userRole).toBe('admin'));
    expect(result.current.permissionsOutcome).toBe('granted');
  });

  it('grants junior-editor role from VIEWER backend response', async () => {
    const viewerPerms = { ...EDITOR_PERMS, canEditDocuments: false, canManageTemplates: false };
    const client = createMockClient(async () => ({ roleName: 'VIEWER', permissions: viewerPerms }));
    const { result } = renderHook(() => useP1Puck(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.permissionsOutcome).toBe('granted'));
    expect(result.current.userRole).toBe('junior-editor');
  });

  it('starts as junior-editor while pending', () => {
    let resolve: (v: unknown) => void;
    const client = createMockClient(() => new Promise((r) => { resolve = r; }) as Promise<{ roleName: string; permissions: typeof EDITOR_PERMS }>);
    const { result } = renderHook(() => useP1Puck(), { wrapper: wrapper(client) });
    // Before resolution, outcome is pending and role is most-restrictive
    expect(result.current.permissionsOutcome).toBe('pending');
    expect(result.current.userRole).toBe('junior-editor');
    resolve!({ roleName: 'EDITOR', permissions: EDITOR_PERMS });
  });

  it('refuses on NO_ACCESS', async () => {
    const client = createMockClient(async () => ({ roleName: 'NO_ACCESS', permissions: EDITOR_PERMS }));
    const { result } = renderHook(() => useP1Puck(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.permissionsOutcome).toBe('refused'));
    expect(result.current.userRole).toBe('junior-editor');
  });

  it('goes unavailable on network error', async () => {
    const client = createMockClient(async () => { throw new Error('Network failure'); });
    const { result } = renderHook(() => useP1Puck(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.permissionsOutcome).toBe('unavailable'));
    expect(result.current.userRole).toBe('junior-editor');
  });
});
