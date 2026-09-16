import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { P1Client } from '@pantheon-systems/css-client';
import { useResolveContentRole } from '../../../features/content-type-templates/permissions/useResolveContentRole.js';

const EDITOR_PERMS = {
  canView: true, canEdit: true, canCreateBranch: true, canEditDocuments: true,
  canCreateCheckpoint: true, canProposeMerge: true, canMerge: true,
  canMergeToMain: false, canManageGrants: false, canManageTemplates: false,
};
const ADMIN_PERMS = { ...EDITOR_PERMS, canMergeToMain: true, canManageGrants: true, canManageTemplates: true };
const VIEWER_PERMS = {
  canView: true, canEdit: false, canCreateBranch: false, canEditDocuments: false,
  canCreateCheckpoint: false, canProposeMerge: false, canMerge: false,
  canMergeToMain: false, canManageGrants: false, canManageTemplates: false,
};

function makeClient(impl: () => Promise<{ roleName: string; permissions: typeof EDITOR_PERMS }>): P1Client {
  return { auth: { getRole: vi.fn().mockImplementation(impl) } } as unknown as P1Client;
}

describe('useResolveContentRole', () => {
  it('grants EDITOR with editor perms', async () => {
    const client = makeClient(async () => ({ roleName: 'EDITOR', permissions: EDITOR_PERMS }));
    const { result } = renderHook(() => useResolveContentRole({ client, siteId: 's', branchId: 'b' }));
    await waitFor(() => expect(result.current.outcome).toBe('granted'));
    expect(result.current.permissions).toEqual(EDITOR_PERMS);
  });

  it('grants VIEWER with read-only perms (canView=true)', async () => {
    const client = makeClient(async () => ({ roleName: 'VIEWER', permissions: VIEWER_PERMS }));
    const { result } = renderHook(() => useResolveContentRole({ client, siteId: 's', branchId: 'b' }));
    // VIEWER has canView=true → granted; effectiveRole will be junior-editor
    await waitFor(() => expect(result.current.outcome).toBe('granted'));
    expect(result.current.permissions).toEqual(VIEWER_PERMS);
  });

  it('refuses NO_ACCESS', async () => {
    const client = makeClient(async () => ({ roleName: 'NO_ACCESS', permissions: EDITOR_PERMS }));
    const { result } = renderHook(() => useResolveContentRole({ client, siteId: 's', branchId: 'b' }));
    await waitFor(() => expect(result.current.outcome).toBe('refused'));
    expect(result.current.permissions).toBeNull();
  });

  it('refuses when a non-NO_ACCESS role returns all permissions false', async () => {
    const noPerms = { ...VIEWER_PERMS, canView: false };
    const client = makeClient(async () => ({ roleName: 'EDITOR', permissions: noPerms }));
    const { result } = renderHook(() => useResolveContentRole({ client, siteId: 's', branchId: 'b' }));
    await waitFor(() => expect(result.current.outcome).toBe('refused'));
    expect(result.current.permissions).toBeNull();
  });

  it('refuses on 403', async () => {
    const client = makeClient(async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); });
    const { result } = renderHook(() => useResolveContentRole({ client, siteId: 's', branchId: 'b' }));
    await waitFor(() => expect(result.current.outcome).toBe('refused'));
  });

  it('goes unavailable on 500', async () => {
    const client = makeClient(async () => { throw Object.assign(new Error('Server Error'), { status: 500 }); });
    const { result } = renderHook(() => useResolveContentRole({ client, siteId: 's', branchId: 'b' }));
    await waitFor(() => expect(result.current.outcome).toBe('unavailable'));
  });

  it('retries after a transient 500 and resolves on success', async () => {
    let callCount = 0;
    const client = makeClient(async () => {
      callCount += 1;
      if (callCount === 1) throw Object.assign(new Error('Server Error'), { status: 500 });
      return { roleName: 'EDITOR', permissions: EDITOR_PERMS };
    });
    const { result } = renderHook(() => useResolveContentRole({ client, siteId: 's', branchId: 'b' }));
    await waitFor(() => expect(result.current.outcome).toBe('unavailable'));
    // retry fires after 3 s; allow up to 5 s for it to resolve
    await waitFor(() => expect(result.current.outcome).toBe('granted'), { timeout: 5000 });
  }, 10000);

  it('stays pending with empty branchId', async () => {
    const client = makeClient(async () => ({ roleName: 'EDITOR', permissions: EDITOR_PERMS }));
    const { result } = renderHook(() => useResolveContentRole({ client, siteId: 's', branchId: '' }));
    // Hook guards on !branchId — never calls getRole
    expect(result.current.outcome).toBe('pending');
  });

  it('drops a granted outcome when branchId goes falsy', async () => {
    const client = makeClient(async () => ({ roleName: 'EDITOR', permissions: EDITOR_PERMS }));
    const { result, rerender } = renderHook(
      ({ branchId }: { branchId: string }) => useResolveContentRole({ client, siteId: 's', branchId }),
      { initialProps: { branchId: 'branch-1' } },
    );
    await waitFor(() => expect(result.current.outcome).toBe('granted'));

    rerender({ branchId: '' });
    expect(result.current.outcome).toBe('pending');
    expect(result.current.permissions).toBeNull();
  });

  it('resets to pending on branch switch then resolves', async () => {
    const client = makeClient(async () => ({ roleName: 'ADMIN', permissions: ADMIN_PERMS }));
    const { result, rerender } = renderHook(
      ({ branchId }: { branchId: string }) => useResolveContentRole({ client, siteId: 's', branchId }),
      { initialProps: { branchId: 'branch-1' } },
    );
    await waitFor(() => expect(result.current.outcome).toBe('granted'));

    rerender({ branchId: 'branch-2' });
    expect(result.current.outcome).toBe('pending');
    await waitFor(() => expect(result.current.outcome).toBe('granted'));
  });
});
