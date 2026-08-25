/**
 * useResolveContentRole Hook
 *
 * Auto-detects the user's ContentRole by querying the CCR backend's
 * auth/me endpoint with site context. Falls back to the provided
 * default role if the backend doesn't return role info.
 *
 * CCR backend role mapping:
 * - ADMIN → 'admin'
 * - EDITOR → 'editor'
 * - VIEWER → 'junior-editor' (read-only structural access)
 * - NO_ACCESS → 'junior-editor' (most restrictive)
 */

import { useState, useEffect } from 'react';
import type { ContentRole } from '../types.js';

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

export interface UseResolveContentRoleOptions {
  baseUrl: string;
  siteId: string;
  branchId: string;
  token: string | null;
  fallbackRole?: ContentRole;
}

export interface UseResolveContentRoleReturn {
  role: ContentRole;
  loading: boolean;
  resolved: boolean;
}

/**
 * Hook to auto-resolve the user's ContentRole from the CCR backend.
 *
 * Calls GET /api/sites/{siteId}/auth/role (when available) to determine
 * the user's effective role. Falls back to the provided fallbackRole
 * if the endpoint is unavailable or returns an error.
 */
export function useResolveContentRole({
  baseUrl,
  siteId,
  branchId,
  token,
  fallbackRole = 'junior-editor',
}: UseResolveContentRoleOptions): UseResolveContentRoleReturn {
  const [role, setRole] = useState<ContentRole>(fallbackRole);
  const [loading, setLoading] = useState(true);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (!baseUrl || !siteId || !token) {
      setRole(fallbackRole);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
        };
        const res = await fetch(
          `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/auth/role`,
          { method: 'GET', headers },
        );

        if (cancelled) return;

        if (res.ok) {
          const data = (await res.json()) as { roleName?: CcrRoleName };
          if (data.roleName) {
            setRole(mapCssRoleToContentRole(data.roleName));
            setResolved(true);
          } else {
            setRole(fallbackRole);
          }
        } else {
          setRole(fallbackRole);
        }
      } catch {
        if (!cancelled) setRole(fallbackRole);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, siteId, branchId, token, fallbackRole]);

  return { role, loading, resolved };
}

export { mapCssRoleToContentRole };
