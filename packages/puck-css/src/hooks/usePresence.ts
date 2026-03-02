/**
 * usePresence Hook
 *
 * Provides document-level presence information with polling.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ActorPresence } from '@pantheon/css-client';
import { usePresenceContext } from '../PresenceContext.js';

/**
 * Options for the usePresence hook.
 */
export interface UsePresenceOptions {
  /** Polling interval in ms (default: 10000) */
  pollingInterval?: number;
  /** Include self in presence list (default: false) */
  includeSelf?: boolean;
}

/**
 * Return value for the usePresence hook.
 */
export interface UsePresenceReturn {
  /** All actors present in the document */
  actors: ActorPresence[];
  /** Actors currently editing */
  editingActors: ActorPresence[];
  /** Human actors only */
  humans: ActorPresence[];
  /** Agent actors only */
  agents: ActorPresence[];
  /** Whether any human is actively editing */
  hasActiveHumans: boolean;
  /** Whether any agent is actively editing */
  hasActiveAgents: boolean;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Force refresh presence data */
  refresh: () => Promise<void>;
}

/**
 * Hook for consuming document-level presence data.
 *
 * @param options - Configuration options
 * @returns Presence state and operations
 *
 * @example
 * ```tsx
 * function CollaboratorList() {
 *   const { actors, hasActiveAgents } = usePresence();
 *
 *   return (
 *     <div>
 *       {hasActiveAgents && <span>Agents are working...</span>}
 *       {actors.map(actor => (
 *         <Avatar key={actor.id} name={actor.name} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePresence(options: UsePresenceOptions = {}): UsePresenceReturn {
  const { pollingInterval = 10000, includeSelf = false } = options;
  const { client, siteId, branchId, userId } = usePresenceContext();

  const [actors, setActors] = useState<ActorPresence[]>([]);
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

      // Filter actors - optionally exclude self
      let filteredActors = branchPresence.actors;
      if (!includeSelf) {
        filteredActors = filteredActors.filter((actor) => actor.actorId !== userId);
      }

      setActors(filteredActors);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [client, siteId, branchId, userId, includeSelf]);

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
  const editingActors = actors.filter((actor) => actor.state === 'editing');
  const humans = actors.filter((actor) => actor.role === 'human');
  const agents = actors.filter((actor) => actor.role === 'agent');
  const hasActiveHumans = humans.some(
    (actor) => actor.state === 'active' || actor.state === 'editing'
  );
  const hasActiveAgents = agents.some(
    (actor) => actor.state === 'active' || actor.state === 'editing'
  );

  return {
    actors,
    editingActors,
    humans,
    agents,
    hasActiveHumans,
    hasActiveAgents,
    isLoading,
    error,
    refresh,
  };
}
