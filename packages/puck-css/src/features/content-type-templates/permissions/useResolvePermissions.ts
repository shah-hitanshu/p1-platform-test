import { useState, useEffect } from 'react';
import type { P1Client, RoleName, RolePermissions } from '@pantheon-systems/css-client';

export type PermissionsOutcome = 'pending' | 'granted' | 'refused' | 'unavailable';

export interface UseResolvePermissionsOptions {
  client: P1Client | null;
  siteId: string;
  branchId: string;
}

export interface UseResolvePermissionsReturn {
  permissions: RolePermissions | null;
  roleName: RoleName | null;
  outcome: PermissionsOutcome;
}

export function useResolvePermissions({
  client,
  siteId,
  branchId,
}: UseResolvePermissionsOptions): UseResolvePermissionsReturn {
  const [permissions, setPermissions] = useState<RolePermissions | null>(null);
  const [roleName, setRoleName] = useState<RoleName | null>(null);
  const [outcome, setOutcome] = useState<PermissionsOutcome>('pending');
  const [retryCount, setRetryCount] = useState(0);

  // Auto-retry transient failures up to 3 times; a genuinely unreachable backend
  // eventually surfaces the error rather than looping.
  useEffect(() => {
    if (outcome !== 'unavailable' || retryCount >= 3) return;
    const id = setTimeout(() => setRetryCount(n => n + 1), 3000);
    return () => clearTimeout(id);
  }, [outcome, retryCount]);

  useEffect(() => {
    setPermissions(null);
    setRoleName(null);
    setOutcome('pending');

    if (!client || !siteId || !branchId) return;

    let cancelled = false;

    (async () => {
      try {
        const role = await client.auth.getRole(siteId, branchId);
        if (cancelled) return;

        setRoleName(role.roleName);

        const p = role.permissions;
        if (!p) {
          setOutcome('unavailable');
          return;
        }
        if (!p.canView) {
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

  return { permissions, roleName, outcome };
}
