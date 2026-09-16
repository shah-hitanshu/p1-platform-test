import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { P1Client } from '@pantheon-systems/css-client';
import { useResolvePermissions } from '../../../features/content-type-templates/permissions/useResolvePermissions.js';

const ADMIN_PERMS = {
  canView: true, canEdit: true, canCreateBranch: true, canEditDocuments: true,
  canCreateCheckpoint: true, canProposeMerge: true, canMerge: true,
  canMergeToMain: true, canManageGrants: true, canManageTemplates: true,
};
const NO_ACCESS_PERMS = Object.fromEntries(Object.keys(ADMIN_PERMS).map((k) => [k, false])) as typeof ADMIN_PERMS;

function makeClient(impl: () => Promise<unknown>): P1Client {
  return { auth: { getRole: vi.fn().mockImplementation(impl) } } as unknown as P1Client;
}

describe('useResolvePermissions roleName', () => {
  it('passes the backend roleName through verbatim', async () => {
    const client = makeClient(async () => ({ roleName: 'ADMIN', permissions: ADMIN_PERMS }));
    const { result } = renderHook(() => useResolvePermissions({ client, siteId: 's', branchId: 'b' }));
    await waitFor(() => expect(result.current.outcome).toBe('granted'));
    expect(result.current.roleName).toBe('ADMIN');
  });

  it('reports NO_ACCESS as the roleName of a refused response', async () => {
    const client = makeClient(async () => ({ roleName: 'NO_ACCESS', permissions: NO_ACCESS_PERMS }));
    const { result } = renderHook(() => useResolvePermissions({ client, siteId: 's', branchId: 'b' }));
    await waitFor(() => expect(result.current.outcome).toBe('refused'));
    expect(result.current.roleName).toBe('NO_ACCESS');
  });

  it('leaves roleName null when the request fails', async () => {
    const client = makeClient(async () => { throw Object.assign(new Error('Server Error'), { status: 500 }); });
    const { result } = renderHook(() => useResolvePermissions({ client, siteId: 's', branchId: 'b' }));
    await waitFor(() => expect(result.current.outcome).toBe('unavailable'));
    expect(result.current.roleName).toBeNull();
  });
});
