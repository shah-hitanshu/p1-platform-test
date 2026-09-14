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

import { and, asc, eq, isNull } from 'drizzle-orm';
import { checkpointDocuments, checkpoints, documentVersions, documents } from '../db/schema';
import { db } from '../db/scope';
import {
  reconstructVersionSnapshot,
} from './document-version-service';
import { VersionReconstructionError } from './errors';

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
  const conditions = [isNull(documentVersions.snapshot), eq(checkpoints.checkpointType, 'publish')];
  if (options.siteId !== undefined) {
    conditions.push(eq(documents.siteId, options.siteId));
  }

  const strippedQuery = db()
    .selectDistinct({
      id: documentVersions.id,
      documentId: documentVersions.documentId,
      branchId: documentVersions.branchId,
      versionNumber: documentVersions.versionNumber,
      siteId: documents.siteId,
      path: documents.path,
    })
    .from(checkpointDocuments)
    .innerJoin(checkpoints, eq(checkpoints.id, checkpointDocuments.checkpointId))
    .innerJoin(documentVersions, eq(documentVersions.id, checkpointDocuments.documentVersionId))
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(and(...conditions))
    .orderBy(asc(documents.siteId), asc(documents.path), asc(documentVersions.versionNumber));

  const stripped = options.limit !== undefined
    ? await strippedQuery.limit(options.limit)
    : await strippedQuery;

  const repaired: RepairEntry[] = [];
  const unrecoverable: RepairEntry[] = [];

  for (const row of stripped) {
    let snapshot: Record<string, unknown> | null = null;
    try {
      snapshot = await reconstructVersionSnapshot(
        row.documentId,
        row.branchId,
        row.versionNumber,
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

    const entry: RepairEntry = {
      documentId: row.documentId,
      branchId: row.branchId,
      versionNumber: row.versionNumber,
      siteId: row.siteId,
      path: row.path,
    };

    if (snapshot == null) {
      unrecoverable.push(entry);
      continue;
    }

    if (!options.dryRun) {
      await db()
        .update(documentVersions)
        .set({ snapshot })
        .where(and(eq(documentVersions.id, row.id), isNull(documentVersions.snapshot)));
    }
    repaired.push(entry);
  }

  return { repaired, unrecoverable };
}
