import { useState, useEffect } from 'react';
import type { P1Client, RolePermissions } from '@pantheon-systems/css-client';
import type { ContentRole } from '../types.js';

export type PermissionsOutcome = 'pending' | 'granted' | 'refused' | 'unavailable';

export interface UseResolveContentRoleOptions {
  client: P1Client | null;
  siteId: string;
  branchId: string;
}

export interface UseResolveContentRoleReturn {
  permissions: RolePermissions | null;
  outcome: PermissionsOutcome;
}

type CcrRoleName = 'ADMIN' | 'EDITOR' | 'VIEWER' | 'NO_ACCESS';

function mapCssRoleToContentRole(ccrRole: CcrRoleName): ContentRole {
  switch (ccrRole) {
    case 'ADMIN':
      return 'admin';
    case 'EDITOR':
      return 'editor';
    case 'VIEWER':
    case 'NO_ACCESS':
    default:
      return 'junior-editor';
  }
}

export function useResolveContentRole({
  client,
  siteId,
  branchId,
}: UseResolveContentRoleOptions): UseResolveContentRoleReturn {
  const [permissions, setPermissions] = useState<RolePermissions | null>(null);
  const [outcome, setOutcome] = useState<PermissionsOutcome>('pending');
  const [retryCount, setRetryCount] = useState(0);

  // Auto-retry transient failures up to 3 times; a genuinely unreachable backend
  // eventually surfaces the error rather than looping.
  useEffect(() => {
    if (outcome !== 'unavailable' || retryCount >= 3) return;
    const id = setTimeout(() => setRetryCount(n => n + 1), 3000);
    return () => clearTimeout(id);
  }, [outcome, retryCount]);

  // Reset retry budget when identity changes, not on every fetch trigger.
  useEffect(() => {
    setRetryCount(0);
  }, [client, siteId, branchId]);

  useEffect(() => {
    setPermissions(null);
    setOutcome('pending');

    if (!client || !siteId || !branchId) return;

    let cancelled = false;

    (async () => {
      try {
        const role = await client.auth.getRole(siteId, branchId);
        if (cancelled) return;

        if (role.roleName === 'NO_ACCESS') {
          setOutcome('refused');
          return;
        }

        const p = role.permissions;
        if (!p.canView && !p.canEdit && !p.canEditDocuments) {
          setOutcome('refused');
          return;
        }

        setPermissions(p);
        setOutcome('granted');
      } catch (err: unknown) {
        if (cancelled) return;
        const status = (err as { status?: number }).status;
        setOutcome(status === 403 ? 'refused' : 'unavailable');
      }
    })();

    return () => { cancelled = true; };
  }, [client, siteId, branchId, retryCount]);

  return { permissions, outcome };
}

export { mapCssRoleToContentRole };
