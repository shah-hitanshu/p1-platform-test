/**
 * useSitePresence Hook
 *
 * Provides site-level presence aggregation with polling.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { SitePresence, BranchPresenceSummary } from '@pantheon/css-client';
import { usePresenceContext } from '../PresenceContext.js';

/**
 * Options for the useSitePresence hook.
 */
export interface UseSitePresenceOptions {
  /** Polling interval in ms (default: 5000) */
  pollingInterval?: number;
}

/**
 * Return value for the useSitePresence hook.
 */
export interface UseSitePresenceReturn {
  /** Site presence summary */
  presence: SitePresence | null;
  /** Branches with active collaborators */
  activeBranches: BranchPresenceSummary[];
  /** Total collaborators across site */
  totalActors: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refresh presence data */
  refresh: () => Promise<void>;
}

/**
 * Hook for consuming site-level presence data.
 *
 * @param options - Configuration options
 * @returns Site presence state and operations
 *
 * @example
 * ```tsx
 * function SiteCollaborators() {
 *   const { presence, activeBranches, totalActors } = useSitePresence();
 *
 *   return (
 *     <div>
 *       <span>{totalActors} collaborators on this site</span>
 *       {activeBranches.map(branch => (
 *         <BranchBadge key={branch.branchId} name={branch.branchName} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useSitePresence(
  options: UseSitePresenceOptions = {}
): UseSitePresenceReturn {
  const { pollingInterval = 5000 } = options;
  const { client, siteId } = usePresenceContext();

  const [presence, setPresence] = useState<SitePresence | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Track mounted state to avoid state updates after unmount
  const mountedRef = useRef(true);

  // Ref for fetchPresence to avoid restarting polling interval
  const fetchPresenceRef = useRef<() => Promise<void>>(async () => {});

  // Fetch presence data
  const fetchPresence = useCallback(async () => {
    try {
      const sitePresence = await client.presence.getSitePresence(siteId);

      if (!mountedRef.current) return;

      setPresence(sitePresence);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [client, siteId]);

  // Keep ref in sync with callback
  useEffect(() => {
    fetchPresenceRef.current = fetchPresence;
  }, [fetchPresence]);

  // Manual refresh function
  const refresh = useCallback(async () => {
    await fetchPresence();
  }, [fetchPresence]);

  // Initial fetch and polling
  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch
    void fetchPresenceRef.current();

    // Set up polling - use ref to avoid restarting interval when callback changes
    const intervalId = setInterval(() => {
      void fetchPresenceRef.current();
    }, pollingInterval);

    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [pollingInterval]);

  // Derived values
  const activeBranches = presence?.branches ?? [];
  const totalActors = presence?.summary.totalActors ?? 0;

  return {
    presence,
    activeBranches,
    totalActors,
    isLoading,
    error,
    refresh,
  };
}
