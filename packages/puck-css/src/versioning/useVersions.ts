/**
 * useVersions Hook
 *
 * Provides document version history and comparison functionality.
 */

import { useState, useCallback, useEffect } from 'react';
import type { DocumentVersion, PuckData } from '@pantheon-systems/css-client';
import type { P1Client } from '@pantheon-systems/css-client';
import type { ComponentDiff } from '../core/types.js';
import { diffPuckData } from './utils/diff.js';

export interface UseVersionsParams {
  client: P1Client;
  siteId: string;
  branchId: string;
  documentId: string | null;
}

export interface UseVersionsReturn {
  /**
   * List of versions for the current document.
   */
  versions: DocumentVersion[];

  /**
   * Loading state.
   */
  loading: boolean;

  /**
   * Error state.
   */
  error: Error | null;

  /**
   * Refresh the versions list.
   */
  refresh: () => Promise<void>;

  /**
   * Get the latest version.
   */
  latestVersion: DocumentVersion | null;

  /**
   * Compare two versions.
   */
  compareVersions: (beforeId: string, afterId: string) => Promise<ComponentDiff[]>;

  /**
   * Get version by ID.
   */
  getVersion: (versionId: string) => DocumentVersion | undefined;

  /**
   * Currently selected version for comparison.
   */
  selectedVersion: DocumentVersion | null;

  /**
   * Set selected version for comparison.
   */
  setSelectedVersion: (version: DocumentVersion | null) => void;

  /**
   * Comparison result.
   */
  comparisonDiffs: ComponentDiff[] | null;

  /**
   * Whether comparison is loading.
   */
  isComparing: boolean;
}

/**
 * Hook for managing document versions and comparisons.
 *
 * @param params - Configuration for version management
 * @returns Version state and operations
 *
 * @example
 * ```tsx
 * const { versions, compareVersions, latestVersion } = useVersions({
 *   client,
 *   siteId,
 *   branchId,
 *   documentId,
 * });
 *
 * // Compare versions
 * const diffs = await compareVersions(oldVersionId, newVersionId);
 * ```
 */
export function useVersions({
  client,
  siteId,
  branchId,
  documentId,
}: UseVersionsParams): UseVersionsReturn {
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<DocumentVersion | null>(null);
  const [comparisonDiffs, setComparisonDiffs] = useState<ComponentDiff[] | null>(null);
  const [isComparing, setIsComparing] = useState(false);

  // Fetch versions
  const refresh = useCallback(async () => {
    if (!documentId) {
      setVersions([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const versionList = await client.versions.list(siteId, branchId, documentId);
      // Sort by version number descending (newest first)
      versionList.sort((a, b) => b.versionNumber - a.versionNumber);
      setVersions(versionList);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, siteId, branchId, documentId]);

  // Initial fetch when documentId changes
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Get latest version
  const latestVersion: DocumentVersion | null = versions[0] ?? null;

  // Get version by ID
  const getVersion = useCallback(
    (versionId: string): DocumentVersion | undefined => {
      return versions.find((v) => v.id === versionId);
    },
    [versions]
  );

  // Compare two versions
  const compareVersions = useCallback(
    async (beforeId: string, afterId: string): Promise<ComponentDiff[]> => {
      setIsComparing(true);
      setError(null);

      try {
        const beforeVersion = versions.find((v) => v.id === beforeId);
        const afterVersion = versions.find((v) => v.id === afterId);

        if (!beforeVersion || !afterVersion) {
          throw new Error('Version not found');
        }

        const beforeData = beforeVersion.snapshot as unknown as PuckData;
        const afterData = afterVersion.snapshot as unknown as PuckData;

        const diffs = diffPuckData(beforeData, afterData);
        setComparisonDiffs(diffs);

        return diffs;
      } catch (err) {
        const compareError = err instanceof Error ? err : new Error(String(err));
        setError(compareError);
        throw compareError;
      } finally {
        setIsComparing(false);
      }
    },
    [versions]
  );

  // Clear comparison when selected version changes
  useEffect(() => {
    if (!selectedVersion) {
      setComparisonDiffs(null);
    }
  }, [selectedVersion]);

  return {
    versions,
    loading,
    error,
    refresh,
    latestVersion,
    compareVersions,
    getVersion,
    selectedVersion,
    setSelectedVersion,
    comparisonDiffs,
    isComparing,
  };
}
