/**
 * Branch Drift Service
 *
 * A branch-scoped roll-up of upstream drift. It enumerates every document on a
 * branch that is the source of a relation edge of the requested type and computes
 * each one's drift against its upstream with the same `buildChangeSummary` engine
 * the per-document upstream-diff uses, so classification is identical. The upstream
 * is the relation's target: a translation's canonical for `localization`, a
 * document's template for `template`. Documents that are in sync are omitted; each
 * returned row carries the per-classification counts a collapsed dashboard row
 * needs, and the full change list stays behind the per-document upstream-diff
 * request made on expand.
 *
 * @see workers/src/services/change-summary-service.ts (per-document engine)
 */

import pLimit from 'p-limit';
import { buildChangeSummary } from './change-summary-service';
import { listDriftCandidates } from './relations-service';
import { findMainBranchId } from './template-read';
import type { ChangeClassification, ChangeRelationType } from './change-summary-service';

/** Bounds the fan-out of per-document change summaries within one request. */
const DRIFT_CONCURRENCY = 8;

/** Candidates compared per request when the caller does not ask for a page size. */
export const DEFAULT_DRIFT_LIMIT = 50;

/** Ceiling on page size: one request compares at most this many candidates. */
export const MAX_DRIFT_LIMIT = 200;

/**
 * One drifted document on a branch. `counts` mirrors a `ChangeSummary`'s
 * per-classification tally; `total` is their sum. `targetDocumentId` is the edge
 * target the drift was measured against; `locale` is set for localization sources
 * and null otherwise.
 */
export interface BranchDriftEntry {
  documentId: string;
  path: string;
  locale: string | null;
  targetDocumentId: string;
  counts: Record<ChangeClassification, number>;
  total: number;
}

/**
 * A page of the branch drift listing.
 */
export interface BranchDriftPage {
  /** The drifted documents among the candidates on this page, ordered by path. */
  drift: BranchDriftEntry[];
  limit: number;
  offset: number;
  /**
   * Whether a further page remains. A page reports only the candidates that turned
   * out to have drifted, so `drift` is often shorter than `limit` and its length
   * says nothing about whether the branch holds more.
   */
  hasMore: boolean;
}

/**
 * How much of the branch one drift listing covers. `offset` walks the candidates
 * in path order; `limit` is clamped to `MAX_DRIFT_LIMIT`, since each candidate on
 * the page costs an upstream comparison.
 */
export interface ListBranchDriftOptions {
  limit?: number;
  offset?: number;
}

/**
 * Returns the requested page of source documents on the branch that have drifted
 * from their upstream edge target, ordered by document path. A document with no
 * drift, or whose target has no version to diff against, is omitted. An empty
 * branch yields an empty page. A non-main branch also reports drift for the
 * documents it inherits from main.
 */
export async function listBranchDrift(
  branchId: string,
  relationType: ChangeRelationType,
  options: ListBranchDriftOptions = {},
): Promise<BranchDriftPage> {
  const pageLimit = Math.min(options.limit ?? DEFAULT_DRIFT_LIMIT, MAX_DRIFT_LIMIT);
  const pageOffset = options.offset ?? 0;

  const mainBranchId = await findMainBranchId(branchId);
  const { candidates, hasMore } = await listDriftCandidates(relationType, branchId, mainBranchId, {
    limit: pageLimit,
    offset: pageOffset,
  });

  const limit = pLimit(DRIFT_CONCURRENCY);
  const entries = await Promise.all(
    candidates.map((candidate) =>
      limit(async (): Promise<BranchDriftEntry | null> => {
        const summary = await buildChangeSummary({
          sourceDocumentId: candidate.documentId,
          branchId,
          relationType,
          mainBranchId,
        });
        if (summary === null) {
          return null;
        }

        const total = Object.values(summary.counts).reduce((sum, count) => sum + count, 0);
        if (total === 0) {
          return null;
        }

        return {
          documentId: candidate.documentId,
          path: candidate.path,
          locale: candidate.locale,
          targetDocumentId: summary.targetDocumentId,
          counts: summary.counts,
          total,
        };
      }),
    ),
  );

  return {
    drift: entries.filter((entry): entry is BranchDriftEntry => entry !== null),
    limit: pageLimit,
    offset: pageOffset,
    hasMore,
  };
}
