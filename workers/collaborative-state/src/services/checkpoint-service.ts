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
  BranchNotFoundError,
  DatabaseError,
  InvalidCheckpointParamsError,
  MAX_NAME_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_OPERATION_TYPE_LENGTH,
  MAX_AFFECTED_REGIONS,
  MAX_REGION_PATH_LENGTH,
} from './checkpoint-types';
import { getFirstRow, isForeignKeyViolation, mapRowToCheckpoint } from './checkpoint-mappers';
import { getCheckpoint, getDocumentsAtCheckpoint, getStructuresAtCheckpoint } from './checkpoint-queries';
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
} from './checkpoint-types';
export {
  getCheckpoint,
  listCheckpoints,
  getDocumentsAtCheckpoint,
  getDocumentAtCheckpoint,
  resolveCheckpointDocuments,
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
        parent_checkpoint_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        CASE WHEN $4::text IN ('pre_merge', 'post_merge') THEN NULL
             ELSE (SELECT id FROM parent) END
      )
      RETURNING *, (SELECT created_at FROM parent) AS parent_created_at`,
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
      const parentCreatedAt = insertRow.parent_created_at;

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

      if (isIncremental && parentCreatedAt != null && parentCreatedAt !== '') {
        // Incremental: only documents changed since the parent checkpoint.
        const result = await query<{ document_id: string; document_version_id: string }>(
          `SELECT document_id, document_version_id FROM (
            SELECT DISTINCT ON (dv.document_id)
              dv.document_id, dv.id as document_version_id, dv.is_tombstone
            FROM app.document_versions dv
            JOIN app.documents d ON d.id = dv.document_id
            WHERE dv.branch_id = $1 AND dv.created_at > $2
              AND (d.path NOT LIKE $3 ESCAPE '\\' OR d.path LIKE $4 ESCAPE '\\')
            ORDER BY dv.document_id, dv.version_number DESC
          ) latest
          WHERE latest.is_tombstone = false`,
          [params.branchId, parentCreatedAt, registryPathPattern, registryTemplatesPathPattern],
        );
        docVersionRows = result.rows;
      } else {
        // Full: all latest versions for the branch, excluding _registry/*
        // (PCC-3430) — see comment above.
        const result = await query<{ document_id: string; document_version_id: string }>(
          `SELECT document_id, document_version_id FROM (
            SELECT DISTINCT ON (dv.document_id)
              dv.document_id, dv.id as document_version_id, dv.is_tombstone
            FROM app.document_versions dv
            JOIN app.documents d ON d.id = dv.document_id
            WHERE dv.branch_id = $1
              AND (d.path NOT LIKE $2 ESCAPE '\\' OR d.path LIKE $3 ESCAPE '\\')
            ORDER BY dv.document_id, dv.version_number DESC
          ) latest
          WHERE latest.is_tombstone = false`,
          [params.branchId, registryPathPattern, registryTemplatesPathPattern],
        );
        docVersionRows = result.rows;
      }
    }

    // Insert checkpoint_documents entries
    if (docVersionRows.length > 0) {
      const values = docVersionRows
        .map((_, i) => `($1, $${String(i * 2 + 2)}, $${String(i * 2 + 3)})`)
        .join(', ');
      const flatParams: unknown[] = [checkpoint.id];
      for (const row of docVersionRows) {
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
    const { CheckpointNotFoundError } = await import('./checkpoint-types');
    throw new CheckpointNotFoundError(params.checkpointId);
  }

  // Get documents at the checkpoint (before transaction, for verification)
  const documentsAtCheckpoint = await getDocumentsAtCheckpoint(params.checkpointId);

  // Checkpoints captured before _registry/* was excluded from capture still
  // carry registry rows. Restoring them would desync sync-owned registry
  // documents from the registry index, so the revert applies the same filter
  // capture does: skip _registry/* except user-authored _registry/templates/*.
  const revertableDocuments = documentsAtCheckpoint.filter(
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
      // Batch INSERT: single query for all documents at once. The path
      // predicate mirrors the JS filter above so the SQL path stays safe on
      // its own.
      await query(
        `INSERT INTO app.document_versions (
          document_id, branch_id, version_number, snapshot,
          source, created_by_id, created_by_type
        )
        SELECT
          cd.document_id,
          $1,
          lv.max_version + 1,
          dv.snapshot,
          'revert',
          $2,
          $3
        FROM app.checkpoint_documents cd
        JOIN app.document_versions dv ON cd.document_version_id = dv.id
        JOIN app.documents d ON cd.document_id = d.id
        JOIN LATERAL (
          SELECT COALESCE(MAX(version_number), 0) as max_version
          FROM app.document_versions
          WHERE document_id = cd.document_id AND branch_id = $1
        ) lv ON true
        WHERE cd.checkpoint_id = $4
          AND (d.path NOT LIKE $5 ESCAPE '\\' OR d.path LIKE $6 ESCAPE '\\')`,
        [
          checkpoint.branchId,
          params.createdById,
          params.createdByType,
          params.checkpointId,
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
    documentsSkipped,
  };
}
