/**
 * Checkpoint Service - Document Publishing
 *
 * Publishes documents by cherry-picking versions to the main branch
 * and creating publish checkpoints with provenance tracking.
 */

import { query } from '../db';
import { getBranch, getMainBranch } from './branch-service';
import type {
  CheckpointRow,
  PublishDocumentParams,
  PublishDocumentResult,
} from './checkpoint-types';
import { getFirstRow, mapRowToCheckpoint } from './checkpoint-mappers';

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

  await query('BEGIN');

  // Get the latest version of the document on the SOURCE branch
  const versionResult = await query<{
    id: string;
    document_id: string;
    branch_id: string;
    version_number: number;
    snapshot: Record<string, unknown>;
    is_tombstone: boolean;
  }>(
    `SELECT id, document_id, branch_id, version_number, snapshot, is_tombstone
     FROM app.document_versions
     WHERE document_id = $1 AND branch_id = $2
     ORDER BY version_number DESC
     LIMIT 1`,
    [params.documentId, params.branchId],
  );

  if (versionResult.rows.length === 0) {
    await query('ROLLBACK');
    throw new Error(`Document with ID "${params.documentId}" not found`);
  }

  const version = versionResult.rows[0];

  if (version.is_tombstone) {
    await query('ROLLBACK');
    throw new Error('Cannot publish a tombstoned document');
  }

  try {
    let publishVersionId = version.id;

    // If publishing from a non-main branch, copy the version to main first
    if (params.branchId !== mainBranch.id) {
      const copyResult = await query<{ id: string; version_number: number }>(
        `INSERT INTO app.document_versions (
          document_id, branch_id, version_number, snapshot,
          source, created_by_id, created_by_type,
          source_branch_id, source_version_id
        )
        SELECT $1, $2,
          COALESCE(MAX(version_number), 0) + 1,
          $3, 'publish', $4, $5,
          $6, $7
        FROM app.document_versions
        WHERE document_id = $1 AND branch_id = $2
        RETURNING id, version_number`,
        [
          params.documentId,
          mainBranch.id,
          version.snapshot,
          params.createdById,
          params.createdByType,
          params.branchId,
          version.id,
        ],
      );

      publishVersionId = getFirstRow(copyResult.rows).id;

      // Back-link: mark the source version as published
      await query(
        `UPDATE app.document_versions
         SET published_to_version_id = $1
         WHERE id = $2`,
        [publishVersionId, version.id],
      );
    }

    // Create publish checkpoint on main
    const checkpointResult = await query<CheckpointRow>(
      `INSERT INTO app.checkpoints (
        branch_id, name, checkpoint_type, created_by_id, created_by_type, status
      )
      VALUES ($1, $2, 'publish', $3, $4, 'completed')
      RETURNING *`,
      [mainBranch.id, 'Publish: document', params.createdById, params.createdByType],
    );

    const row = getFirstRow(checkpointResult.rows);

    // Insert checkpoint_documents row referencing the version on main
    await query(
      `INSERT INTO app.checkpoint_documents (checkpoint_id, document_id, document_version_id)
       VALUES ($1, $2, $3)`,
      [row.id, params.documentId, publishVersionId],
    );

    await query('COMMIT');

    // After COMMIT, resolve source branch name
    let sourceBranchName: string | undefined;
    if (params.branchId !== mainBranch.id) {
      const sourceBranch = await getBranch(params.branchId);
      if (sourceBranch !== null) {
        sourceBranchName = sourceBranch.name;
      }
    }

    return {
      checkpoint: mapRowToCheckpoint(row),
      publishedVersionId: publishVersionId,
      ...(sourceBranchName !== undefined ? { sourceBranchName } : {}),
    };
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}
