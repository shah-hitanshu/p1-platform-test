/**
 * Repair: re-pin published version snapshots [PCC-3652].
 *
 * Compaction used to null the snapshot of checkpoint-referenced (published)
 * versions, leaving published content dependent on patch-chain replay — one
 * broken link anywhere in the chain silently takes the live page down. The
 * compaction guard now prevents new stripping; this repairs the rows stripped
 * before it shipped.
 *
 * Every checkpoint-referenced version missing its snapshot is rebuilt through
 * the production replay logic and written back. Rows whose chain is already
 * broken are reported, not modified — their content is unrecoverable from
 * this database and the document needs a fresh publish from a healthy tip.
 */

import { query } from '../db';
import {
  reconstructVersionSnapshot,
  VersionReconstructionError,
} from './document-version-service';

export interface RepairEntry {
  documentId: string;
  branchId: string;
  versionNumber: number;
  siteId: string;
  path: string;
}

export interface RepairResult {
  repaired: RepairEntry[];
  unrecoverable: RepairEntry[];
}

interface StrippedRow {
  id: string;
  document_id: string;
  branch_id: string;
  version_number: number;
  site_id: string;
  path: string;
}

function toEntry(row: StrippedRow): RepairEntry {
  return {
    documentId: row.document_id,
    branchId: row.branch_id,
    versionNumber: row.version_number,
    siteId: row.site_id,
    path: row.path,
  };
}

/**
 * Finds published versions missing their snapshot and rebuilds them.
 * Only ever fills NULL snapshots, never overwrites one — safe to re-run.
 *
 * Scoped to publish checkpoints: session/manual/merge checkpoints also
 * reference version rows, but "needs a fresh publish" is wrong advice for
 * those, and their retention policy is a separate decision (see PCC-3652
 * review). Pass siteId to limit the repair to one site, and limit to cap how
 * many rows one run touches — useful for piloting against production.
 */
export async function repairPublishedSnapshots(
  options: { dryRun: boolean; siteId?: string; limit?: number },
): Promise<RepairResult> {
  const stripped = await query<StrippedRow>(
    `SELECT DISTINCT dv.id, dv.document_id, dv.branch_id, dv.version_number,
            d.site_id, d.path
     FROM app.checkpoint_documents cd
     JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
     JOIN app.document_versions dv ON dv.id = cd.document_version_id
     JOIN app.documents d ON d.id = dv.document_id
     WHERE dv.snapshot IS NULL
       AND cp.checkpoint_type = 'publish'
       AND ($1::uuid IS NULL OR d.site_id = $1::uuid)
     ORDER BY d.site_id, d.path, dv.version_number
     LIMIT $2`,
    [options.siteId ?? null, options.limit ?? null],
  );

  const repaired: RepairEntry[] = [];
  const unrecoverable: RepairEntry[] = [];

  for (const row of stripped.rows) {
    let snapshot: Record<string, unknown> | null = null;
    try {
      snapshot = await reconstructVersionSnapshot(
        row.document_id,
        row.branch_id,
        row.version_number,
      );
    } catch (error) {
      // Broken chains come in two shapes — a row with neither snapshot nor
      // patch, and a stored patch that no longer applies to its predecessor —
      // and reconstructVersionSnapshot types both as
      // VersionReconstructionError. That is the legacy damage this repair
      // exists to triage: count it unrecoverable and keep going. Anything
      // else (e.g. a dropped connection) must abort the run, not misreport
      // the remaining rows as needing a fresh publish.
      if (!(error instanceof VersionReconstructionError)) {
        throw error;
      }
    }

    if (snapshot == null) {
      unrecoverable.push(toEntry(row));
      continue;
    }

    if (!options.dryRun) {
      await query(
        `UPDATE app.document_versions
         SET snapshot = $1
         WHERE id = $2 AND snapshot IS NULL`,
        [snapshot, row.id],
      );
    }
    repaired.push(toEntry(row));
  }

  return { repaired, unrecoverable };
}
