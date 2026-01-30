/**
 * useBranchPresence Hook
 *
 * Provides branch-level presence aggregation with polling.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { BranchPresence, DocumentPresenceSummary } from '@pantheon/css-client';
import { usePresenceContext } from '../PresenceContext.js';

/**
 * Options for the useBranchPresence hook.
 */
export interface UseBranchPresenceOptions {
  /** Polling interval in ms (default: 5000) */
  pollingInterval?: number;
}

/**
 * Return value for the useBranchPresence hook.
 */
export interface UseBranchPresenceReturn {
  /** Branch presence summary */
  presence: BranchPresence | null;
  /** Documents with active collaborators */
  activeDocuments: DocumentPresenceSummary[];
  /** Total collaborators across branch */
  totalActors: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refresh presence data */
  refresh: () => Promise<void>;
}

/**
 * Hook for consuming branch-level presence data.
 *
 * @param options - Configuration options
 * @returns Branch presence state and operations
 *
 * @example
 * ```tsx
 * function BranchCollaborators() {
 *   const { presence, activeDocuments, totalActors } = useBranchPresence();
 *
 *   return (
 *     <div>
 *       <span>{totalActors} collaborators on this branch</span>
 *       {activeDocuments.map(doc => (
 *         <DocumentBadge key={doc.documentId} path={doc.documentPath} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useBranchPresence(
  options: UseBranchPresenceOptions = {}
): UseBranchPresenceReturn {
  const { pollingInterval = 5000 } = options;
  const { client, siteId, branchId } = usePresenceContext();

  const [presence, setPresence] = useState<BranchPresence | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Track mounted state to avoid state updates after unmount
  const mountedRef = useRef(true);

  // Ref for fetchPresence to avoid restarting polling interval
  const fetchPresenceRef = useRef<() => Promise<void>>(async () => {});

  // Fetch presence data
  const fetchPresence = useCallback(async () => {
    try {
      const branchPresence = await client.presence.getBranchPresence(siteId, branchId);

      if (!mountedRef.current) return;

      setPresence(branchPresence);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [client, siteId, branchId]);

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
  const activeDocuments = presence?.documentSummary ?? [];
  const totalActors = presence?.summary.totalActors ?? 0;

  return {
    presence,
    activeDocuments,
    totalActors,
    isLoading,
    error,
    refresh,
  };
}
