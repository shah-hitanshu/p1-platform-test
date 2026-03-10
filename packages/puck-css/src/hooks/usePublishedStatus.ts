/**
 * usePublishedStatus Hook
 *
 * Determines whether the current document version is published
 * by checking checkpoint data.
 */

import { useState, useCallback, useEffect } from 'react';
import type { CSSClient } from '@pantheon/css-client';

export interface UsePublishedStatusParams {
  client: CSSClient;
  siteId: string;
  branchId: string;
  documentId: string;
  currentVersionId?: string;
}

export interface UsePublishedStatusReturn {
  /**
   * Whether the current version matches the latest published version.
   */
  isCurrentVersionPublished: boolean;

  /**
   * Whether the document has any published version.
   */
  hasPublishedVersion: boolean;

  /**
   * The version ID from the most recent checkpoint containing the document.
   */
  latestPublishedVersionId: string | null;

  /**
   * All version IDs that have been published for this document.
   */
  publishedVersionIds: Set<string>;

  /**
   * Loading state.
   */
  loading: boolean;

  /**
   * Re-fetch published status.
   */
  refresh: () => Promise<void>;
}

/**
 * Hook for determining whether the current document version is published.
 *
 * @param params - Configuration for published status checking
 * @returns Published status state and refresh function
 *
 * @example
 * ```tsx
 * const { isCurrentVersionPublished, hasPublishedVersion } = usePublishedStatus({
 *   client,
 *   siteId,
 *   branchId,
 *   documentId,
 *   currentVersionId,
 * });
 * ```
 */
export function usePublishedStatus({
  client,
  siteId,
  branchId,
  documentId,
  currentVersionId,
}: UsePublishedStatusParams): UsePublishedStatusReturn {
  const [latestPublishedVersionId, setLatestPublishedVersionId] = useState<string | null>(null);
  const [publishedVersionIds, setPublishedVersionIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!documentId) {
      setLatestPublishedVersionId(null);
      setPublishedVersionIds(new Set());
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const checkpoints = await client.checkpoints.list(siteId, branchId);

      const collectedVersionIds = new Set<string>();
      let foundLatestVersionId: string | null = null;

      for (const checkpoint of checkpoints) {
        const documents = await client.checkpoints.getDocuments(siteId, checkpoint.id);

        for (const doc of documents) {
          if (doc.documentId === documentId) {
            // The API may not always populate versionId on checkpoint
            // documents. When present, track it; when absent, use the
            // checkpoint ID as a stand-in so hasPublishedVersion is true.
            const vid = doc.versionId ?? checkpoint.id;
            collectedVersionIds.add(vid);

            // Checkpoints are returned most-recent-first,
            // so the first match is the latest published version.
            if (foundLatestVersionId === null) {
              foundLatestVersionId = vid;
            }
          }
        }
      }

      setLatestPublishedVersionId(foundLatestVersionId);
      setPublishedVersionIds(collectedVersionIds);
    } catch {
      setLatestPublishedVersionId(null);
      setPublishedVersionIds(new Set());
    } finally {
      setLoading(false);
    }
  }, [client, siteId, branchId, documentId]);

  // Initial fetch
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isCurrentVersionPublished =
    currentVersionId != null &&
    latestPublishedVersionId != null &&
    currentVersionId === latestPublishedVersionId;

  const hasPublishedVersion = publishedVersionIds.size > 0;

  return {
    isCurrentVersionPublished,
    hasPublishedVersion,
    latestPublishedVersionId,
    publishedVersionIds,
    loading,
    refresh,
  };
}
