/**
 * useBranches Hook
 *
 * Provides branch management functionality.
 */

import { useState, useCallback, useEffect } from 'react';
import type { Branch } from '@pantheon/css-client';
import type { CSSClient } from '@pantheon/css-client';

interface UseBranchesParams {
  client: CSSClient;
  siteId: string;
  initialBranchId: string;
}

interface UseBranchesReturn {
  /**
   * List of all branches for the site.
   */
  branches: Branch[];

  /**
   * Currently selected branch.
   */
  currentBranch: Branch | null;

  /**
   * Current branch ID.
   */
  branchId: string;

  /**
   * Loading state.
   */
  loading: boolean;

  /**
   * Error state.
   */
  error: Error | null;

  /**
   * Switch to a different branch.
   */
  switchBranch: (branchId: string) => Promise<void>;

  /**
   * Refresh the branches list.
   */
  refresh: () => Promise<void>;

  /**
   * Get main branch.
   */
  mainBranch: Branch | null;
}

/**
 * Hook for managing branches.
 *
 * @param params - Configuration for branch management
 * @returns Branch state and operations
 *
 * @example
 * ```tsx
 * const { branches, currentBranch, switchBranch } = useBranches({
 *   client,
 *   siteId,
 *   initialBranchId,
 * });
 *
 * // Switch to a different branch
 * await switchBranch(otherBranchId);
 * ```
 */
export function useBranches({
  client,
  siteId,
  initialBranchId,
}: UseBranchesParams): UseBranchesReturn {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch branches
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const branchList = await client.branches.list(siteId);
      setBranches(branchList.filter((b) => b.isMain || b.status === 'active'));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, siteId]);

  // Initial fetch
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Get current branch object
  const currentBranch = branches.find((b) => b.id === branchId) ?? null;

  // Get main branch
  const mainBranch = branches.find((b) => b.isMain) ?? null;

  // Switch branch
  const switchBranch = useCallback(
    async (newBranchId: string): Promise<void> => {
      // Verify the branch exists
      const branch = branches.find((b) => b.id === newBranchId);
      if (!branch) {
        // Try refreshing first
        await refresh();
        const refreshedBranch = branches.find((b) => b.id === newBranchId);
        if (!refreshedBranch) {
          throw new Error(`Branch not found: ${newBranchId}`);
        }
      }

      setBranchId(newBranchId);
    },
    [branches, refresh]
  );

  return {
    branches,
    currentBranch,
    branchId,
    loading,
    error,
    switchBranch,
    refresh,
    mainBranch,
  };
}
