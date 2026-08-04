/**
 * One-time backfill: moves a legacy top-level snapshot `title` to the canonical
 * `root.props.title`.
 *
 * Listings COALESCE both locations, so this is cleanup rather than a correctness
 * requirement — once every environment has run it, the legacy arm of that
 * projection can be dropped.
 *
 * Only the latest version of each document is converted, and by writing a new
 * version rather than rewriting rows. Most non-latest rows store a forward patch
 * with no snapshot at all, so there is nothing to edit in place, and mutating
 * patches would corrupt the chain reconstruction replays. Writing a new version
 * also keeps the baseline/diff invariants owned by the version service, as the
 * template content backfill does.
 */

import { query } from '../db';
import { createDocumentVersion } from './document-version-service';
import { applyTitleToSnapshot, isRecord } from './document-title';

const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';

export type BackfillSkipReason = 'already-canonical' | 'no-title' | 'unreadable';

export interface TitleBackfillOutcome {
  action: 'convert' | 'skip';
  reason?: BackfillSkipReason;
  /** The snapshot to write. Present only when action is 'convert'. */
  snapshot?: Record<string, unknown> & { root: { props: Record<string, unknown> } };
}

/**
 * Decides whether a snapshot needs converting, and produces the converted
 * snapshot when it does.
 *
 * A snapshot carrying both locations is still converted, to drop the stale
 * top-level copy — the canonical value wins, since that is what the editor
 * autosaves.
 */
export function classifyTitleBackfill(snapshot: unknown): TitleBackfillOutcome {
  if (!isRecord(snapshot)) {
    return { action: 'skip', reason: 'unreadable' };
  }

  const hasLegacyKey = 'title' in snapshot;
  const legacyTitle = typeof snapshot.title === 'string' ? snapshot.title : undefined;
  const root = snapshot.root;
  const canonicalTitle =
    isRecord(root) && isRecord(root.props) && typeof root.props.title === 'string'
      ? root.props.title
      : undefined;

  if (!hasLegacyKey) {
    return {
      action: 'skip',
      reason: canonicalTitle === undefined ? 'no-title' : 'already-canonical',
    };
  }

  // A legacy key holding a non-string is junk rather than a title.
  if (legacyTitle === undefined && canonicalTitle === undefined) {
    return { action: 'skip', reason: 'no-title' };
  }

  const withoutLegacyKey = { ...snapshot };
  delete withoutLegacyKey.title;
  const converted = applyTitleToSnapshot(withoutLegacyKey, canonicalTitle ?? legacyTitle);

  return {
    action: 'convert',
    snapshot: converted as Record<string, unknown> & { root: { props: Record<string, unknown> } },
  };
}

export interface BackfillEntry {
  documentId: string;
  branchId: string;
  path: string;
}

export interface SkippedEntry extends BackfillEntry {
  reason: BackfillSkipReason;
}

export interface PageTitleBackfillResult {
  converted: BackfillEntry[];
  skipped: SkippedEntry[];
}

export interface BackfillPageTitlesOptions {
  /** Limit to one site. Omit to sweep every site in the database. */
  siteId?: string;
  /** Report candidates without writing new versions. @default false */
  dryRun?: boolean;
}

interface CandidateRow {
  document_id: string;
  branch_id: string;
  path: string;
  snapshot: Record<string, unknown> | null;
}

/**
 * Converts the latest version of every document whose title still sits at the
 * snapshot's top level, writing one new version per (document, branch) pair.
 *
 * Only rows that could need work are fetched: a snapshot carrying the legacy
 * key, plus anything unreadable. A latest version is always stored as a
 * baseline, so a NULL or non-object snapshot means that invariant no longer
 * holds — those are reported as `unreadable` rather than silently dropped from
 * the sweep, which is why the filter is not `snapshot ? 'title'` alone.
 */
export async function backfillPageTitles(
  options: BackfillPageTitlesOptions = {},
): Promise<PageTitleBackfillResult> {
  const { siteId, dryRun = false } = options;

  const candidates = await query<CandidateRow>(
    `SELECT dv.document_id, dv.branch_id, d.path, dv.snapshot
     FROM app.document_versions dv
     INNER JOIN app.documents d ON d.id = dv.document_id
     WHERE d.archived_at IS NULL
       AND dv.is_tombstone = false
       AND ($1::uuid IS NULL OR d.site_id = $1::uuid)
       AND (
         dv.snapshot ? 'title'
         OR dv.snapshot IS NULL
         OR jsonb_typeof(dv.snapshot) <> 'object'
       )
       AND dv.version_number = (
         SELECT MAX(dv2.version_number)
         FROM app.document_versions dv2
         WHERE dv2.document_id = dv.document_id AND dv2.branch_id = dv.branch_id
       )`,
    [siteId ?? null],
  );

  const result: PageTitleBackfillResult = { converted: [], skipped: [] };

  for (const candidate of candidates.rows) {
    const entry: BackfillEntry = {
      documentId: candidate.document_id,
      branchId: candidate.branch_id,
      path: candidate.path,
    };

    const outcome = classifyTitleBackfill(candidate.snapshot);
    if (outcome.action === 'skip' || outcome.snapshot === undefined) {
      result.skipped.push({ ...entry, reason: outcome.reason ?? 'unreadable' });
      continue;
    }

    if (!dryRun) {
      await createDocumentVersion({
        documentId: candidate.document_id,
        branchId: candidate.branch_id,
        snapshot: outcome.snapshot,
        source: 'edit',
        createdById: SYSTEM_UUID,
        createdByType: 'system',
        // Moving a value, not authoring one: action_type stays null so a template
        // migration spanning this version propagates no delta to bound pages.
        forceNonStructural: true,
      });
    }

    result.converted.push(entry);
  }

  return result;
}
