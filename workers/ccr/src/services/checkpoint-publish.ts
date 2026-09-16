/**
 * Checkpoint Service - Document Publishing
 *
 * Publishes documents by cherry-picking versions to the main branch
 * and creating publish checkpoints with provenance tracking.
 */

import { sql } from 'drizzle-orm';
import { db, transaction } from '../db/scope';
import { getBranch, getMainBranch } from './branch-service';
import type {
  CheckpointRow,
  PublishDocumentParams,
  PublishDocumentResult,
} from './checkpoint-types';
import { getFirstRow, mapRowToCheckpoint } from './checkpoint-mappers';
import { purgeContentCache } from '../cache/purge';

/**
 * Type aliases rather than interfaces: db().execute<T>() constrains T to
 * Record<string, unknown>, which an interface cannot satisfy because it carries
 * no implicit index signature.
 */
type PublishVersionRow = {
  id: string;
  document_id: string;
  branch_id: string;
  version_number: number;
  snapshot: Record<string, unknown> | null;
  is_tombstone: boolean;
};

/** On the same terms as {@link PublishVersionRow}. */
type PublishCopyRow = { id: string; version_number: number };
import { reconstructVersionSnapshot } from './document-version-service';

/**
 * Publishes a document by creating a publish checkpoint capturing the latest
 * version of the document on the branch.
 *
 * @param params - Publish parameters
 * @returns The created checkpoint and published version ID
 * @throws Error if the document has no versions on the branch or is tombstoned
 */
export async function publishDocument(
  params: PublishDocumentParams,
): Promise<PublishDocumentResult> {
  // Resolve the main branch for this site
  const mainBranch = await getMainBranch(params.siteId);
  if (mainBranch === null) {
    throw new Error('Main branch not found for site');
  }

  let checkpointRow: CheckpointRow;
  let publishVersionId: string;


  // The whole read-and-write sequence is one transaction, so a statement that
  // throws — including the FOR UPDATE below, which can block until the query
  // timeout — rolls the rest of it back.
  const published = await transaction(async () => {

    // Get the latest version of the document on the SOURCE branch.
    // FOR UPDATE holds the row against a concurrent edit's compaction nulling
    // its snapshot between this read and COMMIT [PCC-3652]. A compaction
    // statement already waiting on this lock resumes after COMMIT and would
    // miss the checkpoint under its stale statement snapshot — for an on-main
    // publish the pinned_at stamp below is what stops it (see
    // createDocumentVersion's guard). Cross-branch, that compaction targets
    // the unpinned SOURCE row and may null it, which is safe: the checkpoint
    // references the pinned copy on main, and the source keeps its patch.
    // (No gap lock: a concurrent INSERT of a higher version is not blocked,
    // so publish captures the tip as of this read — you publish what you
    // read, and the newer version is simply not yet published.)
    const versionResult = await db().execute<PublishVersionRow>(sql`
      SELECT id, document_id, branch_id, version_number, snapshot, is_tombstone
       FROM app.document_versions
       WHERE document_id = ${params.documentId} AND branch_id = ${params.branchId}
       ORDER BY version_number DESC
       LIMIT 1
       FOR UPDATE`);

    const version = versionResult.at(0);
    if (!version) {
      throw new Error(`Document with ID "${params.documentId}" not found`);
    }

    if (version.is_tombstone) {
      throw new Error('Cannot publish a tombstoned document');
    }
    // The published row must hold a full snapshot at commit time so that
    // compaction (which skips checkpoint-referenced rows) pins exactly the
    // published content [PCC-3652]. The tip normally does; repair the rare
    // row that doesn't, and refuse to publish content that cannot be
    // materialized rather than serve a version that renders as nothing.
    let snapshot = version.snapshot;
    if (snapshot == null) {
      snapshot = await reconstructVersionSnapshot(
        params.documentId,
        params.branchId,
        version.version_number,
      );
      if (snapshot == null) {
        throw new Error(
          `Cannot publish version ${String(version.version_number)}: content is not reconstructable`,
        );
      }
      await db().execute(sql`
        UPDATE app.document_versions
         SET snapshot = ${JSON.stringify(snapshot)}
         WHERE id = ${version.id} AND snapshot IS NULL`);
    }

    publishVersionId = version.id;

    // If publishing from a non-main branch, copy the version to main first
    if (params.branchId !== mainBranch.id) {
      const copyResult = await db().execute<PublishCopyRow>(sql`
        INSERT INTO app.document_versions (
          document_id, branch_id, version_number, snapshot,
          source, created_by_id, created_by_type,
          source_branch_id, source_version_id
        )
        SELECT ${params.documentId}, ${mainBranch.id},
          COALESCE(MAX(version_number), 0) + 1,
          ${JSON.stringify(snapshot)}, 'publish', ${params.createdById}, ${params.createdByType},
          ${params.branchId}, ${version.id}
        FROM app.document_versions
        WHERE document_id = ${params.documentId} AND branch_id = ${mainBranch.id}
        RETURNING id, version_number`);

      publishVersionId = getFirstRow(copyResult).id;

      // Back-link: mark the source version as published
      await db().execute(sql`
        UPDATE app.document_versions
         SET published_to_version_id = ${publishVersionId}
         WHERE id = ${version.id}`);
    }

    // Pin the published row. A real tuple update, so a compaction statement
    // that was waiting on our FOR UPDATE lock re-checks its quals against the
    // stamped tuple (EvalPlanQual) and skips the row — the NOT EXISTS guard
    // alone is checked against a pre-publish snapshot and would miss the
    // checkpoint [PCC-3652].
    await db().execute(sql`
      UPDATE app.document_versions
       SET pinned_at = NOW()
       WHERE id = ${publishVersionId}`);

    // Create publish checkpoint on main
    const checkpointResult = await db().execute<CheckpointRow>(sql`
      INSERT INTO app.checkpoints (
        branch_id, name, checkpoint_type, created_by_id, created_by_type, status
      )
      VALUES (${mainBranch.id}, 'Publish: document', 'publish', ${params.createdById},
              ${params.createdByType}, 'completed')
      RETURNING *`);

    checkpointRow = getFirstRow(checkpointResult);

    // Insert checkpoint_documents row referencing the version on main
    await db().execute(sql`
      INSERT INTO app.checkpoint_documents (checkpoint_id, document_id, document_version_id)
       VALUES (${checkpointRow.id}, ${params.documentId}, ${publishVersionId})`);

    return { checkpointRow, publishVersionId };
  });
  checkpointRow = published.checkpointRow;
  publishVersionId = published.publishVersionId;

  // Post-commit work stays outside the transaction: the publish has already
  // succeeded, and a failure here must not report failure for a committed
  // publish. Purging before the commit would let a concurrent read re-cache the
  // pre-publish version and keep it for a full TTL; purgeContentCache reports
  // failure in logs and never throws.
  await purgeContentCache({
    siteId: params.siteId,
    branchId: mainBranch.id,
    documentId: params.documentId,
  });

  let sourceBranchName: string | undefined;
  if (params.branchId !== mainBranch.id) {
    const sourceBranch = await getBranch(params.branchId);
    if (sourceBranch !== null) {
      sourceBranchName = sourceBranch.name;
    }
  }

  return {
    checkpoint: mapRowToCheckpoint(checkpointRow),
    publishedVersionId: publishVersionId,
    ...(sourceBranchName !== undefined ? { sourceBranchName } : {}),
  };
}
