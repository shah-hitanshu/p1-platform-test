/**
 * Upstream Review
 *
 * One reading of what a derived page has yet to take from the page it derives
 * from, shared by whatever offers the list and by the drawer that shows it.
 * Both work from the same summary, so a change settled in the drawer leaves the
 * count that led to it.
 */

import { useCallback, useState } from 'react';
import type { ChangeSummary, ChangeSummaryEntry, P1Client } from '@pantheon-systems/css-client';
import { dismissalKey, useReviewSession, type ReviewSession } from './review-session.js';
import {
  useUpstreamDiff,
  type UpstreamDiff,
  type UpstreamRelationType,
} from './upstream-diff-query.js';
import { useUpstreamResolution } from './useUpstreamResolution.js';

export interface UpstreamReview {
  diff: UpstreamDiff;
  relationType: UpstreamRelationType;
  /** Changes this page can take. Structural ones are reported rather than applied. */
  outstanding: number;
  /** The source's only changes were to add, move or remove blocks. */
  structuralOnly: boolean;
  /** Changes settled locally, which no edge records. */
  dismissed: ReadonlySet<string>;
  session: ReviewSession;
  isPending: (entry: ChangeSummaryEntry) => boolean;
  /** Record this change as settled, on its edge where there is one. */
  resolve: (entry: ChangeSummaryEntry, summary: ChangeSummary) => void;
}

export function useUpstreamReview(
  client: P1Client,
  siteId: string,
  branchId: string,
  documentId: string,
  relationType: UpstreamRelationType,
): UpstreamReview {
  // Recovery and in-flight resolutions belong to the editing session, not the drawer.
  const session = useReviewSession();

  // A change with no edge to record on is dismissed above the drawer: the count
  // has to agree with the list, and the drawer only exists while it is open.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const dismiss = useCallback(
    (key: string) => setDismissed((previous) => new Set(previous).add(key)),
    [],
  );

  const diff = useUpstreamDiff(client, siteId, branchId, documentId, relationType);
  const resolution = useUpstreamResolution(client, siteId, branchId, documentId, relationType);

  const resolve = useCallback(
    (entry: ChangeSummaryEntry, summary: ChangeSummary) => {
      if (relationType === 'localization' && entry.propPath !== undefined) {
        resolution.resolve(entry, summary);
        return;
      }
      dismiss(dismissalKey(summary, entry));
    },
    [dismiss, relationType, resolution],
  );

  const visible = diff.state === 'ready'
    ? diff.summary.changes.filter((change) => !dismissed.has(dismissalKey(diff.summary, change)))
    : [];
  const outstanding = visible.filter((change) => change.classification !== 'structural').length;

  return {
    diff,
    relationType,
    outstanding,
    structuralOnly: outstanding === 0
      && visible.some((change) => change.classification === 'structural'),
    dismissed,
    session,
    isPending: resolution.isPending,
    resolve,
  };
}
