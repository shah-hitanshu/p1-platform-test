/**
 * Upstream Diff Query
 *
 * The toolbar pill and the drawer it opens both read the same change summary.
 * Sharing the key and a stale window means one fetch answers both: the pill has
 * to know the count to decide whether to appear, and opening the drawer reuses
 * that read rather than making its own. Recording a resolution invalidates the
 * key, so the window never holds a summary past a change to it.
 *
 * They also have to agree on what an outcome means, so the read is classified
 * here rather than by each reader: a missing edge and an unreachable check both
 * leave no summary, and they call for opposite things.
 */

import { useQuery } from '@tanstack/react-query';
import { NotFoundError, type ChangeSummary, type P1Client } from '@pantheon-systems/css-client';
import { useP1SdkQueryClient } from '../../data/query-provider.js';

export const UPSTREAM_DIFF_KEY = 'p1-upstream-diff';

export type UpstreamRelationType = 'localization' | 'template';

/**
 * How long a fetched summary answers a newly mounted reader. It covers opening
 * the drawer off the pill; past it the next reader refetches.
 */
const DIFF_STALE_MS = 30_000;

export function upstreamDiffQueryKey(
  siteId: string,
  branchId: string,
  documentId: string,
  relationType: UpstreamRelationType,
): (string | undefined)[] {
  return [UPSTREAM_DIFF_KEY, siteId, branchId, documentId, relationType];
}

export function upstreamDiffQuery(
  client: P1Client,
  siteId: string,
  branchId: string,
  documentId: string,
  relationType: UpstreamRelationType,
): {
  queryKey: (string | undefined)[];
  queryFn: () => Promise<ChangeSummary>;
  retry: false;
  staleTime: number;
} {
  return {
    queryKey: upstreamDiffQueryKey(siteId, branchId, documentId, relationType),
    queryFn: () => client.relations.getUpstreamDiff(siteId, branchId, documentId, relationType),
    retry: false,
    staleTime: DIFF_STALE_MS,
  };
}

/** Stands in when a failure carries no message of its own. */
const CHECK_FAILED = 'Could not check for upstream changes';

/** What a reader of the summary has to go on. */
export type UpstreamDiff =
  | { state: 'checking' }
  /** The page derives from nothing: there is nothing to reconcile, and nothing to say. */
  | { state: 'noEdge' }
  /** The check could not be made, so how far the page has drifted is unknown. */
  | { state: 'unavailable'; message: string; retry: () => void }
  /** A summary to work from. `staleReason` is set when the last refresh failed. */
  | { state: 'ready'; summary: ChangeSummary; staleReason: string | null };

export function useUpstreamDiff(
  client: P1Client,
  siteId: string,
  branchId: string,
  documentId: string,
  relationType: UpstreamRelationType,
): UpstreamDiff {
  const queryClient = useP1SdkQueryClient();
  const query = useQuery(
    upstreamDiffQuery(client, siteId, branchId, documentId, relationType),
    queryClient,
  );

  // A gone edge retires the feature whatever is still cached: the summary was
  // read against a relation that no longer describes this page.
  if (query.error instanceof NotFoundError) return { state: 'noEdge' };
  if (query.data !== undefined) {
    return {
      state: 'ready',
      summary: query.data,
      // React Query serves the last good summary through a failed refetch.
      staleReason: query.error === null ? null : query.error.message || CHECK_FAILED,
    };
  }
  if (query.error !== null) {
    return {
      state: 'unavailable',
      message: query.error.message || CHECK_FAILED,
      retry: () => void query.refetch(),
    };
  }
  return { state: 'checking' };
}
