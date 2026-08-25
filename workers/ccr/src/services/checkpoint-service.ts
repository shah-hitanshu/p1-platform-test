/**
 * Phase 3.3: Checkpoint Service
 *
 * Core checkpoint operations: create and revert.
 * Simple queries are in checkpoint-queries.ts, publishing in checkpoint-publish.ts,
 * types/errors in checkpoint-types.ts, and mappers in checkpoint-mappers.ts.
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Checkpoints"
 */

import { query } from '../db';
import type {
  CheckpointInsertRow,
  CreateCheckpointParams,
  CreateCheckpointResult,
  RevertToCheckpointParams,
  RevertToCheckpointResult,
} from './checkpoint-types';
import {
  MAX_NAME_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_OPERATION_TYPE_LENGTH,
  MAX_AFFECTED_REGIONS,
  MAX_REGION_PATH_LENGTH,
} from './checkpoint-types';
import { BranchNotFoundError, DatabaseError, InvalidCheckpointParamsError } from './errors';
import { getFirstRow, isForeignKeyViolation, mapRowToCheckpoint } from './checkpoint-mappers';
import {
  NEAREST_CHECKPOINT_CHAIN_ENTRIES,
  getCheckpoint,
  getStructuresAtCheckpoint,
  resolveCheckpointDeletions,
  resolveCheckpointDocuments,
} from './checkpoint-queries';
import { escapeLikePattern } from './document-types';

// Re-export everything from sub-modules for backward compatibility
export type {
  CreateCheckpointParams,
  CreateCheckpointResult,
  ListCheckpointsOptions,
  RevertToCheckpointParams,
  RevertToCheckpointResult,
  CheckpointDocumentVersion,
  CheckpointStructure,
  ListCheckpointsByAgentOptions,
  PublishDocumentParams,
  PublishDocumentResult,
} from './checkpoint-types';
export {
  BranchNotFoundError,
  CheckpointNotFoundError,
  InvalidCheckpointParamsError,
  DatabaseError,
} from './errors';
export {
  getCheckpoint,
  listCheckpoints,
  getDocumentsAtCheckpoint,
  getDocumentAtCheckpoint,
  resolveCheckpointDocuments,
  resolveCheckpointDeletions,
  getStructuresAtCheckpoint,
  getStructureAtCheckpoint,
  getLatestCheckpoint,
  getCheckpointDocumentCount,
  deleteCheckpoint,
  updateCheckpointStatus,
  listCheckpointsByAgent,
  listCheckpointsByOperationType,
} from './checkpoint-queries';
export { publishDocument } from './checkpoint-publish';

// =============================================================================
// Core Service Functions
// =============================================================================

/** Documents per checkpoint_documents INSERT statement (2 binds each). */
const MANIFEST_INSERT_CHUNK_SIZE = 10_000;

/** Snapshot written with a tombstone version, matching deleteDocumentOnBranch. */
const TOMBSTONE_SNAPSHOT = { _deleted: true };

/**
 * Creates a checkpoint capturing the current state of a branch.
 * Captures all latest document versions on the branch.
 *
 * @param params - Checkpoint creation parameters
 * @returns The created checkpoint and document count
 * @throws InvalidCheckpointParamsError if required fields are missing
 * @throws BranchNotFoundError if the branch does not exist
 */
export async function createCheckpoint(
  params: CreateCheckpointParams,
): Promise<CreateCheckpointResult> {
  // Validate required fields
  if (!params.branchId || params.branchId.trim() === '') {
    throw new InvalidCheckpointParamsError('Branch ID is required');
  }
  if (!params.createdById || params.createdById.trim() === '') {
    throw new InvalidCheckpointParamsError('Created by ID is required');
  }

  // Validate optional field lengths
  if (params.name != null && params.name.length > MAX_NAME_LENGTH) {
    throw new InvalidCheckpointParamsError(
      `Name exceeds maximum length of ${String(MAX_NAME_LENGTH)}`,
    );
  }
  if (params.message != null && params.message.length > MAX_MESSAGE_LENGTH) {
    throw new InvalidCheckpointParamsError(
      `Message exceeds maximum length of ${String(MAX_MESSAGE_LENGTH)}`,
    );
  }
  if (params.description != null && params.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new InvalidCheckpointParamsError(
      `Description exceeds maximum length of ${String(MAX_DESCRIPTION_LENGTH)}`,
    );
  }
  if (params.operationType != null && params.operationType.length > MAX_OPERATION_TYPE_LENGTH) {
    throw new InvalidCheckpointParamsError(
      `Operation type exceeds maximum length of ${String(MAX_OPERATION_TYPE_LENGTH)}`,
    );
  }
  if (params.affectedRegions != null) {
    if (params.affectedRegions.length > MAX_AFFECTED_REGIONS) {
      throw new InvalidCheckpointParamsError(
        `Affected regions exceeds maximum of ${String(MAX_AFFECTED_REGIONS)}`,
      );
    }
    for (const region of params.affectedRegions) {
      if (typeof region !== 'string' || region.length > MAX_REGION_PATH_LENGTH) {
        throw new InvalidCheckpointParamsError(
          `Invalid affected region: must be string under ${String(MAX_REGION_PATH_LENGTH)} chars`,
        );
      }
    }
  }

  try {
    // Use transaction for multi-step operation
    await query('BEGIN');

    // Phase 6.1: CTE-based INSERT embeds parent checkpoint lookup
    // to avoid an extra query while enabling incremental checkpoints.
    // For merge types (pre_merge, post_merge), CASE nullifies parent_checkpoint_id
    // to force full snapshots.
    const checkpointResult = await query<CheckpointInsertRow>(
      `WITH parent AS (
        SELECT id, created_at
        FROM app.checkpoints
        WHERE branch_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      )
      INSERT INTO app.checkpoints (
        branch_id, name, message, checkpoint_type,
        created_by_id, created_by_type,
        description, trigger, requested_by_id, operation_type, affected_regions, status,
        parent_checkpoint_id, is_full_snapshot
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        CASE WHEN $4::text IN ('pre_merge', 'post_merge') THEN NULL
             ELSE (SELECT id FROM parent) END,
        CASE WHEN $13::boolean THEN false
             WHEN $14::boolean THEN true
             ELSE (CASE WHEN $4::text IN ('pre_merge', 'post_merge') THEN NULL
                        ELSE (SELECT id FROM parent) END) IS NULL
        END
      )
      RETURNING *`,
      [
        params.branchId,
        params.name ?? null,
        params.message ?? null,
        params.checkpointType,
        params.createdById,
        params.createdByType,
        params.description ?? null,
        params.trigger ?? 'manual',
        params.requestedById ?? null,
        params.operationType ?? null,
        params.affectedRegions ? JSON.stringify(params.affectedRegions) : '[]',
        'completed',
        params.documentVersionIds !== undefined,
        params.forceFullSnapshot === true,
      ],
    );

    const insertRow = getFirstRow(checkpointResult.rows);
    const checkpoint = mapRowToCheckpoint(insertRow);

    // Determine which document versions to capture in this checkpoint.
    // When explicit documentVersionIds are provided (e.g. from merge),
    // use only those — never sweep in unrelated documents.
    let docVersionRows: { document_id: string; document_version_id: string }[];

    if (params.documentVersionIds !== undefined) {
      // Explicit list — used by merge to capture only merge-touched documents
      docVersionRows = params.documentVersionIds.map((dv) => ({
        document_id: dv.documentId,
        document_version_id: dv.documentVersionId,
      }));
    } else {
      // Automatic mode: determine incremental vs full from the CTE result
      // forceFullSnapshot overrides incremental logic (used by agent_pre_edit)
      const isIncremental = insertRow.parent_checkpoint_id != null && params.forceFullSnapshot !== true;
      const parentCheckpointId = insertRow.parent_checkpoint_id;

      // _registry/* is excluded from checkpoint capture (PCC-3430): those
      // documents are sync-owned metadata written by syncComponentRegistry,
      // not user-editable content. Sweeping them into an agent edit-session
      // checkpoint means a later rollback can silently revert a registry
      // descriptor to stale content behind the registry index's back.
      //
      // EXCEPTION: _registry/templates/ documents are user-authored content
      // types (see isSystemManagedPath in merge-execution-service.ts) and
      // must continue to be captured/revertible normally — mirroring the
      // same exception merge already applies for the same reason.
      //
      // Patterns are escaped and parameterized (escapeLikePattern) rather
      // than inlined as literals: an inlined '_registry/%' would have '_'
      // match any single character under LIKE's semantics, not just a
      // literal underscore.
      const registryPathPattern = escapeLikePattern('_registry/') + '%';
      const registryTemplatesPathPattern = escapeLikePattern('_registry/templates/') + '%';

      // What counts as a capturable version, shared by both arms below so the
      // two modes can never disagree about it. A superseded version is never
      // the newest one (PCC-3660), so skipping it changes no answer and avoids
      // reading registry history to find the head.
      const capturable = (notLike: string, like: string): string =>
        `dv.superseded_at IS NULL
             AND (d.path NOT LIKE ${notLike} ESCAPE '\\' OR d.path LIKE ${like} ESCAPE '\\')`;

      if (isIncremental && parentCheckpointId != null) {
        // Incremental: the documents whose latest version differs from what the
        // parent chain already records for them.
        //
        // The delta is defined by version identity, not by a timestamp. A
        // `created_at > parent.created_at` boundary races the parent's own
        // transaction — `now()` is transaction start, so a version written
        // while the parent was committing lands on the wrong side of the
        // comparison and is captured twice or not at all. Comparing ids has no
        // such window, and it costs an index scan the full capture already pays
        // for (idx_document_versions_branch_document_version).
        //
        // It also makes deletions representable, which the timestamp form could
        // not: a newly-tombstoned document has a version id the parent doesn't
        // hold, so the tombstone enters the manifest. That matters because
        // dropping it would leave the parent's live version as the nearest
        // entry in the chain, and resolving or reverting to this checkpoint
        // would resurrect the document. This is the one thing the two arms do
        // differ on, deliberately: a full snapshot needs no tombstones, because
        // there absence is the deletion.
        const result = await query<{ document_id: string; document_version_id: string }>(
          `${NEAREST_CHECKPOINT_CHAIN_ENTRIES},
           latest AS (
             SELECT DISTINCT ON (dv.document_id)
               dv.document_id, dv.id as document_version_id
             FROM app.document_versions dv
             JOIN app.documents d ON d.id = dv.document_id
             WHERE dv.branch_id = $2
               AND ${capturable('$3', '$4')}
             ORDER BY dv.document_id, dv.version_number DESC
           )
           SELECT latest.document_id, latest.document_version_id
           FROM latest
           LEFT JOIN nearest ON nearest.document_id = latest.document_id
           WHERE nearest.document_version_id IS DISTINCT FROM latest.document_version_id`,
          [
            parentCheckpointId,
            params.branchId,
            registryPathPattern,
            registryTemplatesPathPattern,
          ],
        );
        docVersionRows = result.rows;
      } else {
        // Full: every live document on the branch.
        const result = await query<{ document_id: string; document_version_id: string }>(
          `SELECT document_id, document_version_id FROM (
            SELECT DISTINCT ON (dv.document_id)
              dv.document_id, dv.id as document_version_id, dv.is_tombstone
            FROM app.document_versions dv
            JOIN app.documents d ON d.id = dv.document_id
            WHERE dv.branch_id = $1
              AND ${capturable('$2', '$3')}
            ORDER BY dv.document_id, dv.version_number DESC
          ) latest
          WHERE latest.is_tombstone = false`,
          [params.branchId, registryPathPattern, registryTemplatesPathPattern],
        );
        docVersionRows = result.rows;
      }
    }

    // Insert checkpoint_documents entries. Chunked because the statement binds
    // 2N+1 parameters and Postgres caps a statement at 65,535 — an unchunked
    // insert fails outright above ~32,767 documents.
    for (let start = 0; start < docVersionRows.length; start += MANIFEST_INSERT_CHUNK_SIZE) {
      const chunk = docVersionRows.slice(start, start + MANIFEST_INSERT_CHUNK_SIZE);
      const values = chunk
        .map((_, i) => `($1, $${String(i * 2 + 2)}, $${String(i * 2 + 3)})`)
        .join(', ');
      const flatParams: unknown[] = [checkpoint.id];
      for (const row of chunk) {
        flatParams.push(row.document_id, row.document_version_id);
      }

      await query(
        `INSERT INTO app.checkpoint_documents (checkpoint_id, document_id, document_version_id)
         VALUES ${values}`,
        flatParams,
      );
    }

    // Capture structure state from branch_structure_state
    await query(
      `INSERT INTO app.checkpoint_structures (
        checkpoint_id, structure_id, name, slug, description, structure_type,
        structure_tree, metadata_schema, schema_enforcement
      )
      SELECT $1, bss.structure_id, bss.name, bss.slug, bss.description, bss.structure_type,
             bss.structure_tree, bss.metadata_schema, bss.schema_enforcement
      FROM app.branch_structure_state bss
      WHERE bss.branch_id = $2`,
      [checkpoint.id, params.branchId],
    );

    // Capture document metadata from branch_document_metadata
    await query(
      `INSERT INTO app.checkpoint_document_metadata (
        checkpoint_id, structure_id, document_id, metadata
      )
      SELECT $1, bdm.structure_id, bdm.document_id, bdm.metadata
      FROM app.branch_document_metadata bdm
      WHERE bdm.branch_id = $2`,
      [checkpoint.id, params.branchId],
    );

    await query('COMMIT');

    return {
      checkpoint,
      documentCount: docVersionRows.length,
    };
  } catch (error) {
    await query('ROLLBACK');
    console.error('createCheckpoint error:', error);
    if (isForeignKeyViolation(error)) {
      throw new BranchNotFoundError(params.branchId);
    }
    throw new DatabaseError(`Failed to create checkpoint: ${error instanceof Error ? error.message : String(error)}`, 'createCheckpoint');
  }
}

/**
 * Reverts a branch to a checkpoint's state.
 * Creates new document versions with source='revert' and a new checkpoint.
 *
 * @param params - Revert parameters
 * @returns The new checkpoint and count of reverted documents
 * @throws CheckpointNotFoundError if checkpoint does not exist
 */
export async function revertToCheckpoint(
  params: RevertToCheckpointParams,
): Promise<RevertToCheckpointResult> {
  // Validate required fields
  if (!params.createdById || params.createdById.trim() === '') {
    throw new InvalidCheckpointParamsError('Created by ID is required');
  }

  // Get the checkpoint (before transaction to avoid holding locks)
  const checkpoint = await getCheckpoint(params.checkpointId);
  if (!checkpoint) {
    const { CheckpointNotFoundError } = await import('./errors');
    throw new CheckpointNotFoundError(params.checkpointId);
  }

  // Resolve the full document set, not just this checkpoint's manifest: an
  // incremental checkpoint holds only what changed since its parent, so
  // reading one manifest restores a partial branch.
  const documentsAtCheckpoint = await resolveCheckpointDocuments(params.checkpointId);

  // Documents the chain records as deleted at this checkpoint. Restoring only
  // the live set would leave anything recreated since the checkpoint in place,
  // so a revert has to re-apply those deletions too.
  const deletionsAtCheckpoint = await resolveCheckpointDeletions(params.checkpointId);

  // Checkpoints captured before _registry/* was excluded from capture still
  // carry registry rows. Restoring them would desync sync-owned registry
  // documents from the registry index, so the revert applies the same filter
  // capture does: skip _registry/* except user-authored _registry/templates/*.
  const revertableDocuments = documentsAtCheckpoint.filter(
    (doc) =>
      !doc.documentPath.startsWith('_registry/') ||
      doc.documentPath.startsWith('_registry/templates/'),
  );
  const revertableDeletions = deletionsAtCheckpoint.filter(
    (doc) =>
      !doc.documentPath.startsWith('_registry/') ||
      doc.documentPath.startsWith('_registry/templates/'),
  );
  const documentsSkipped = documentsAtCheckpoint.length - revertableDocuments.length;
  if (documentsSkipped > 0) {
    console.warn(
      `[revertToCheckpoint] Skipping ${String(documentsSkipped)} _registry/* document(s) in checkpoint ` +
        `${params.checkpointId}: registry documents are sync-owned and are not restored by revert. ` +
        'This checkpoint predates registry filtering in checkpoint capture.',
    );
  }

  try {
    // Use transaction for the revert operations
    await query('BEGIN');

    // Phase 6.2: Batch revert optimization.
    // For large document counts, use a single bulk INSERT...SELECT with JOIN LATERAL.
    // For small counts, use the per-document loop (simpler, negligible overhead).
    const BATCH_REVERT_THRESHOLD = 3;

    // Same escaped patterns as capture: '_' is a LIKE wildcard, so the
    // literal underscore must be escaped and the pattern parameterized.
    const registryPathPattern = escapeLikePattern('_registry/') + '%';
    const registryTemplatesPathPattern = escapeLikePattern('_registry/templates/') + '%';

    if (revertableDocuments.length >= BATCH_REVERT_THRESHOLD) {
      // Batch INSERT: single query for all documents at once. Driven by the
      // resolved document set rather than a single checkpoint's manifest —
      // reading checkpoint_documents directly would restore only the delta of
      // an incremental checkpoint. The path predicate mirrors the JS filter
      // above so the SQL path stays safe on its own.
      await query(
        `INSERT INTO app.document_versions (
          document_id, branch_id, version_number, snapshot,
          source, created_by_id, created_by_type
        )
        SELECT
          m.document_id,
          $1,
          lv.max_version + 1,
          dv.snapshot,
          'revert',
          $2,
          $3
        FROM unnest($4::uuid[], $5::uuid[]) AS m(document_id, document_version_id)
        JOIN app.document_versions dv ON dv.id = m.document_version_id
        JOIN app.documents d ON d.id = m.document_id
        JOIN LATERAL (
          SELECT COALESCE(MAX(version_number), 0) as max_version
          FROM app.document_versions
          WHERE document_id = m.document_id AND branch_id = $1
        ) lv ON true
        WHERE (d.path NOT LIKE $6 ESCAPE '\\' OR d.path LIKE $7 ESCAPE '\\')`,
        [
          checkpoint.branchId,
          params.createdById,
          params.createdByType,
          revertableDocuments.map((doc) => doc.documentId),
          revertableDocuments.map((doc) => doc.versionId),
          registryPathPattern,
          registryTemplatesPathPattern,
        ],
      );
    } else {
      // Per-document INSERT for small counts
      for (const doc of revertableDocuments) {
        await query(
          `INSERT INTO app.document_versions (
            document_id, branch_id, version_number, snapshot,
            source, created_by_id, created_by_type
          )
          SELECT $1, $2,
            COALESCE(MAX(version_number), 0) + 1,
            $3, 'revert', $4, $5
          FROM app.document_versions
          WHERE document_id = $1 AND branch_id = $2`,
          [
            doc.documentId,
            checkpoint.branchId,
            doc.snapshot,
            params.createdById,
            params.createdByType,
          ],
        );
      }
    }

    // Get structures at the checkpoint
    await getStructuresAtCheckpoint(params.checkpointId);

    // Delete current structure state for the branch
    await query(
      'DELETE FROM app.branch_structure_state WHERE branch_id = $1',
      [checkpoint.branchId],
    );

    // Restore structure state from checkpoint
    await query(
      `INSERT INTO app.branch_structure_state (
        branch_id, structure_id, name, slug, description, structure_type,
        structure_tree, metadata_schema, schema_enforcement
      )
      SELECT $1, cs.structure_id, cs.name, cs.slug, cs.description, cs.structure_type,
             cs.structure_tree, cs.metadata_schema, cs.schema_enforcement
      FROM app.checkpoint_structures cs
      WHERE cs.checkpoint_id = $2`,
      [checkpoint.branchId, params.checkpointId],
    );

    // Delete current document metadata for the branch
    await query(
      'DELETE FROM app.branch_document_metadata WHERE branch_id = $1',
      [checkpoint.branchId],
    );

    // Restore document metadata from checkpoint
    await query(
      `INSERT INTO app.branch_document_metadata (
        branch_id, structure_id, document_id, metadata
      )
      SELECT $1, cdm.structure_id, cdm.document_id, cdm.metadata
      FROM app.checkpoint_document_metadata cdm
      WHERE cdm.checkpoint_id = $2`,
      [checkpoint.branchId, params.checkpointId],
    );

    // Re-apply deletions the checkpoint recorded, for documents that are live
    // again now. The latest-version guard keeps this idempotent: a document
    // still deleted gets no redundant tombstone, which matters because version
    // depth is what the serving path pays for. Registry paths are filtered the
    // same way the restore above filters them.
    if (revertableDeletions.length > 0) {
      await query(
        `INSERT INTO app.document_versions (
          document_id, branch_id, version_number, snapshot,
          source, created_by_id, created_by_type, is_tombstone
        )
        SELECT
          m.document_id,
          $1,
          latest.version_number + 1,
          $5,
          'revert',
          $2,
          $3,
          true
        FROM unnest($4::uuid[]) AS m(document_id)
        JOIN app.documents d ON d.id = m.document_id
        JOIN LATERAL (
          SELECT version_number, is_tombstone
          FROM app.document_versions
          WHERE document_id = m.document_id AND branch_id = $1
          ORDER BY version_number DESC
          LIMIT 1
        ) latest ON true
        WHERE latest.is_tombstone = false
          AND (d.path NOT LIKE $6 ESCAPE '\\' OR d.path LIKE $7 ESCAPE '\\')`,
        [
          checkpoint.branchId,
          params.createdById,
          params.createdByType,
          revertableDeletions.map((doc) => doc.documentId),
          TOMBSTONE_SNAPSHOT,
          registryPathPattern,
          registryTemplatesPathPattern,
        ],
      );
    }

    // Update the original checkpoint status to rolled_back
    await query(
      `UPDATE app.checkpoints
       SET status = 'rolled_back', rolled_back_by_id = $2, rolled_back_at = $3
       WHERE id = $1`,
      [params.checkpointId, params.createdById, new Date().toISOString()],
    );

    await query('COMMIT');
  } catch (error) {
    await query('ROLLBACK');
    throw new DatabaseError(
      `Failed to revert to checkpoint: ${error instanceof Error ? error.message : String(error)}`,
      'revertToCheckpoint',
    );
  }

  // Create a checkpoint documenting the revert (separate transaction)
  const revertMessage = params.message ??
    `Reverted to checkpoint: ${checkpoint.name ?? ''} (${params.checkpointId})`.trim();

  const { checkpoint: newCheckpoint } = await createCheckpoint({
    branchId: checkpoint.branchId,
    message: revertMessage,
    checkpointType: 'manual',
    createdById: params.createdById,
    createdByType: params.createdByType,
  });

  return {
    checkpoint: newCheckpoint,
    documentsReverted: revertableDocuments.length,
    documentsDeleted: revertableDeletions.length,
    documentsSkipped,
  };
}
