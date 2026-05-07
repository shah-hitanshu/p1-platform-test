/**
 * useCheckpoints Hook
 *
 * Provides checkpoint (publish) functionality.
 */

import { useState, useCallback, useEffect } from 'react';
import type { Checkpoint } from '@pantheon-systems/css-client';
import type { CSSClient } from '@pantheon-systems/css-client';

export interface UseCheckpointsParams {
  client: CSSClient;
  siteId: string;
  branchId: string;
}

export interface UseCheckpointsReturn {
  /**
   * List of checkpoints on the current branch.
   */
  checkpoints: Checkpoint[];

  /**
   * Loading state.
   */
  loading: boolean;

  /**
   * Error state.
   */
  error: Error | null;

  /**
   * Create publishing state.
   */
  isPublishing: boolean;

  /**
   * Create a checkpoint (publish).
   */
  create: (name?: string) => Promise<Checkpoint>;

  /**
   * Revert to a checkpoint.
   */
  revert: (checkpointId: string, name?: string) => Promise<Checkpoint>;

  /**
   * Refresh the checkpoints list.
   */
  refresh: () => Promise<void>;

  /**
   * Get the latest checkpoint.
   */
  latestCheckpoint: Checkpoint | null;
}

/**
 * Hook for managing checkpoints.
 *
 * @param params - Configuration for checkpoint management
 * @returns Checkpoint state and operations
 *
 * @example
 * ```tsx
 * const { checkpoints, create, isPublishing } = useCheckpoints({
 *   client,
 *   siteId,
 *   branchId,
 * });
 *
 * // Publish (create checkpoint)
 * await create('Release v1.0');
 * ```
 */
export function useCheckpoints({
  client,
  siteId,
  branchId,
}: UseCheckpointsParams): UseCheckpointsReturn {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  // Fetch checkpoints
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cpList = await client.checkpoints.list(siteId, branchId);
      setCheckpoints(cpList);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, siteId, branchId]);

  // Initial fetch
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Get latest checkpoint
  const latestCheckpoint =
    checkpoints.length > 0
      ? checkpoints.reduce((latest, cp) =>
          new Date(cp.createdAt) > new Date(latest.createdAt) ? cp : latest
        )
      : null;

  // Create checkpoint (publish)
  const create = useCallback(
    async (name?: string): Promise<Checkpoint> => {
      setIsPublishing(true);
      setError(null);

      try {
        const checkpoint = await client.checkpoints.create(siteId, {
          branchId,
          name,
          type: 'manual',
        });

        await refresh();
        return checkpoint;
      } catch (err) {
        const createError = err instanceof Error ? err : new Error(String(err));
        setError(createError);
        throw createError;
      } finally {
        setIsPublishing(false);
      }
    },
    [client, siteId, branchId, refresh]
  );

  // Revert to checkpoint
  const revert = useCallback(
    async (checkpointId: string, name?: string): Promise<Checkpoint> => {
      setError(null);

      try {
        const checkpoint = await client.checkpoints.revert(siteId, branchId, checkpointId, name);
        await refresh();
        return checkpoint;
      } catch (err) {
        const revertError = err instanceof Error ? err : new Error(String(err));
        setError(revertError);
        throw revertError;
      }
    },
    [client, siteId, branchId, refresh]
  );

  return {
    checkpoints,
    loading,
    error,
    isPublishing,
    create,
    revert,
    refresh,
    latestCheckpoint,
  };
}
