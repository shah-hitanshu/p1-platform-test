import { useQueries } from '@tanstack/react-query';
import { NotFoundError, type P1Client } from '@pantheon-systems/css-client';
import { useP1SdkQueryClient } from '../../data/query-provider.js';
import { upstreamDiffQuery } from './upstream-diff-query.js';
import type { LocaleRow } from './locale-rows.js';

export type LocaleReviewStatus =
  | 'checking'
  | 'unavailable'
  | 'noSource'
  | 'translated'
  | 'needsReview';

export function useLocaleReviewStatus(
  client: P1Client | undefined,
  siteId: string | undefined,
  branchId: string | undefined,
  rows: LocaleRow[],
  enabled: boolean,
): ReadonlyMap<string, LocaleReviewStatus> {
  const queryClient = useP1SdkQueryClient();
  const translationIds = [...new Set(
    rows.flatMap((row) => !row.isSource && row.documentId !== null ? [row.documentId] : []),
  )];

  // Disabling a closed menu retains the drawer's query keys and cached summaries.
  const queries = useQueries({
    queries: client && siteId && branchId
      ? translationIds.map((documentId) => ({
          ...upstreamDiffQuery(client, siteId, branchId, documentId, 'localization'),
          enabled,
        }))
      : [],
  }, queryClient);

  return new Map(translationIds.map((documentId, index): [string, LocaleReviewStatus] => {
    const query = queries[index];

    // A failed refresh cannot establish that the cached translation is still current.
    if (!query) return [documentId, 'unavailable'];
    if (query.error instanceof NotFoundError) return [documentId, 'noSource'];
    if (query.error) return [documentId, 'unavailable'];
    if (!query.data) return [documentId, 'checking'];

    // Advisory changes concern locale-owned values and require no source update.
    const needsReview = query.data.changes.some(
      (entry) => entry.classification !== 'advisory' && entry.classification !== 'structural',
    );
    return [documentId, needsReview ? 'needsReview' : 'translated'];
  }));
}
