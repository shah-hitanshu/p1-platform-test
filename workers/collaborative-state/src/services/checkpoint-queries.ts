/**
 * Checkpoint Service - Read/List Query Functions
 *
 * Simple database queries for retrieving checkpoints,
 * documents at checkpoints, and structures at checkpoints.
 */

import type { Checkpoint, CheckpointStatus } from '../types';
import { query } from '../db';
import type {
  CheckpointDocumentVersion,
  CheckpointRow,
  CheckpointStructure,
  CheckpointStructureRow,
  ListCheckpointsOptions,
  ListCheckpointsByAgentOptions,
  VersionWithDocumentRow,
} from './checkpoint-types';
import { CheckpointNotFoundError } from './checkpoint-types';
import {
  getFirstRow,
  mapRowToCheckpoint,
  mapRowToCheckpointDocumentVersion,
  mapRowToCheckpointStructure,
} from './checkpoint-mappers';
import { normalizePath } from './document-types';

/**
 * Retrieves a checkpoint by its ID.
 *
 * @param checkpointId - The checkpoint ID
 * @returns The checkpoint or null if not found
 */
export async function getCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
  const result = await query<CheckpointRow>(
    'SELECT * FROM app.checkpoints WHERE id = $1',
    [checkpointId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToCheckpoint(getFirstRow(result.rows));
}

/**
 * Lists checkpoints for a branch in descending order by creation time.
 *
 * @param branchId - The branch ID
 * @param options - Filtering and pagination options
 * @returns Array of checkpoints
 */
export async function listCheckpoints(
  branchId: string,
  options: ListCheckpointsOptions = {},
): Promise<Checkpoint[]> {
  const { checkpointType, limit, offset } = options;

  let sql = 'SELECT * FROM app.checkpoints WHERE branch_id = $1';
  const params: unknown[] = [branchId];
  let paramIndex = 2;

  if (checkpointType !== undefined) {
    sql += ` AND checkpoint_type = $${String(paramIndex)}`;
    params.push(checkpointType);
    paramIndex++;
  }

  sql += ' ORDER BY created_at DESC';

  if (limit !== undefined) {
    sql += ` LIMIT $${String(paramIndex)}`;
    params.push(limit);
    paramIndex++;
  }

  if (offset !== undefined) {
    sql += ` OFFSET $${String(paramIndex)}`;
    params.push(offset);
  }

  const result = await query<CheckpointRow>(sql, params);

  return result.rows.map(mapRowToCheckpoint);
}

/**
 * Gets all document versions captured in a checkpoint.
 *
 * @param checkpointId - The checkpoint ID
 * @returns Array of document versions with paths
 */
export async function getDocumentsAtCheckpoint(
  checkpointId: string,
): Promise<CheckpointDocumentVersion[]> {
  const result = await query<VersionWithDocumentRow>(
    `SELECT dv.*, d.path as document_path
     FROM app.checkpoint_documents cd
     JOIN app.document_versions dv ON cd.document_version_id = dv.id
     JOIN app.documents d ON cd.document_id = d.id
     WHERE cd.checkpoint_id = $1
     ORDER BY d.path`,
    [checkpointId],
  );

  return result.rows.map(mapRowToCheckpointDocumentVersion);
}

/**
 * Gets a specific document's version at a checkpoint by path.
 *
 * @param checkpointId - The checkpoint ID
 * @param documentPath - The document path
 * @returns The document version or null if not found
 */
export async function getDocumentAtCheckpoint(
  checkpointId: string,
  documentPath: string,
): Promise<CheckpointDocumentVersion | null> {
  const normalizedPath = normalizePath(documentPath);
  const result = await query<VersionWithDocumentRow>(
    `SELECT dv.*, d.path as document_path
     FROM app.checkpoint_documents cd
     JOIN app.document_versions dv ON cd.document_version_id = dv.id
     JOIN app.documents d ON cd.document_id = d.id
     WHERE cd.checkpoint_id = $1 AND d.path = $2`,
    [checkpointId, normalizedPath],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToCheckpointDocumentVersion(getFirstRow(result.rows));
}

/**
 * Resolves the complete set of documents for a checkpoint, walking the
 * parent chain for incremental checkpoints. Newer checkpoint entries
 * override older ones for the same document.
 *
 * @param checkpointId - The checkpoint ID to resolve
 * @returns Complete array of document versions representing the checkpoint state
 */
export async function resolveCheckpointDocuments(
  checkpointId: string,
): Promise<CheckpointDocumentVersion[]> {
  // Collect checkpoint chain from newest to oldest
  const chain: CheckpointDocumentVersion[][] = [];
  let currentCheckpointId: string | null = checkpointId;

  while (currentCheckpointId !== null) {
    const checkpoint = await getCheckpoint(currentCheckpointId);
    if (!checkpoint) break;

    const docs = await getDocumentsAtCheckpoint(currentCheckpointId);
    chain.push(docs);

    currentCheckpointId = checkpoint.parentCheckpointId ?? null;
  }

  // Merge documents: process from oldest (end) to newest (start)
  // so newer entries override older ones for the same documentId
  const documentMap = new Map<string, CheckpointDocumentVersion>();
  for (let i = chain.length - 1; i >= 0; i--) {
    const chainEntry = chain[i];
    if (!chainEntry) continue;
    for (const doc of chainEntry) {
      documentMap.set(doc.documentId, doc);
    }
  }

  return Array.from(documentMap.values());
}

/**
 * Gets all structures captured in a checkpoint.
 *
 * @param checkpointId - The checkpoint ID
 * @returns Array of checkpoint structures
 */
export async function getStructuresAtCheckpoint(
  checkpointId: string,
): Promise<CheckpointStructure[]> {
  const result = await query<CheckpointStructureRow>(
    `SELECT * FROM app.checkpoint_structures
     WHERE checkpoint_id = $1
     ORDER BY name`,
    [checkpointId],
  );

  return result.rows.map(mapRowToCheckpointStructure);
}

/**
 * Gets a specific structure's state at a checkpoint.
 *
 * @param checkpointId - The checkpoint ID
 * @param structureId - The structure ID
 * @returns The structure state or null if not found
 */
export async function getStructureAtCheckpoint(
  checkpointId: string,
  structureId: string,
): Promise<CheckpointStructure | null> {
  const result = await query<CheckpointStructureRow>(
    `SELECT * FROM app.checkpoint_structures
     WHERE checkpoint_id = $1 AND structure_id = $2`,
    [checkpointId, structureId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToCheckpointStructure(getFirstRow(result.rows));
}

/**
 * Gets the most recent checkpoint for a branch.
 *
 * @param branchId - The branch ID
 * @returns The latest checkpoint or null if none exist
 */
export async function getLatestCheckpoint(branchId: string): Promise<Checkpoint | null> {
  const result = await query<CheckpointRow>(
    `SELECT * FROM app.checkpoints
     WHERE branch_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [branchId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToCheckpoint(getFirstRow(result.rows));
}

/**
 * Gets the count of documents in a checkpoint.
 *
 * @param checkpointId - The checkpoint ID
 * @returns The document count
 */
export async function getCheckpointDocumentCount(checkpointId: string): Promise<number> {
  const result = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM app.checkpoint_documents WHERE checkpoint_id = $1',
    [checkpointId],
  );

  return parseInt(getFirstRow(result.rows).count, 10);
}

/**
 * Deletes a checkpoint and its document associations.
 *
 * @param checkpointId - The checkpoint ID
 * @returns True if deleted, false if not found
 */
export async function deleteCheckpoint(checkpointId: string): Promise<boolean> {
  try {
    await query('BEGIN');

    // Delete checkpoint_documents first (foreign key)
    await query(
      'DELETE FROM app.checkpoint_documents WHERE checkpoint_id = $1',
      [checkpointId],
    );

    // Delete the checkpoint
    const result = await query(
      'DELETE FROM app.checkpoints WHERE id = $1',
      [checkpointId],
    );

    await query('COMMIT');
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}

/**
 * Updates the status of a checkpoint.
 * Used when rolling back or marking a checkpoint as partial.
 *
 * @param checkpointId - The checkpoint ID
 * @param status - The new status
 * @param rolledBackById - Optional user ID who performed the rollback
 * @returns The updated checkpoint or null if not found
 * @throws CheckpointNotFoundError if the checkpoint does not exist
 */
export async function updateCheckpointStatus(
  checkpointId: string,
  status: CheckpointStatus,
  rolledBackById?: string,
): Promise<Checkpoint> {
  const rolledBackAt = status === 'rolled_back' ? new Date().toISOString() : null;

  const result = await query<CheckpointRow>(
    `UPDATE app.checkpoints
     SET status = $2, rolled_back_by_id = $3, rolled_back_at = $4
     WHERE id = $1
     RETURNING *`,
    [checkpointId, status, rolledBackById ?? null, rolledBackAt],
  );

  if (result.rows.length === 0) {
    throw new CheckpointNotFoundError(checkpointId);
  }

  return mapRowToCheckpoint(getFirstRow(result.rows));
}

/**
 * Lists checkpoints created by a specific agent.
 *
 * @param agentId - The agent ID (createdById where createdByType='agent')
 * @param options - Filtering and pagination options
 * @returns Array of checkpoints created by the agent
 */
export async function listCheckpointsByAgent(
  agentId: string,
  options: ListCheckpointsByAgentOptions = {},
): Promise<Checkpoint[]> {
  const { limit, offset, branchId, operationType, trigger, status } = options;

  let sql = `SELECT * FROM app.checkpoints
     WHERE created_by_id = $1 AND created_by_type = 'agent'`;
  const params: unknown[] = [agentId];
  let paramIndex = 2;

  if (branchId !== undefined) {
    sql += ` AND branch_id = $${String(paramIndex)}`;
    params.push(branchId);
    paramIndex++;
  }

  if (operationType !== undefined) {
    sql += ` AND operation_type = $${String(paramIndex)}`;
    params.push(operationType);
    paramIndex++;
  }

  if (trigger !== undefined) {
    sql += ` AND trigger = $${String(paramIndex)}`;
    params.push(trigger);
    paramIndex++;
  }

  if (status !== undefined) {
    sql += ` AND status = $${String(paramIndex)}`;
    params.push(status);
    paramIndex++;
  }

  sql += ' ORDER BY created_at DESC';

  if (limit !== undefined) {
    sql += ` LIMIT $${String(paramIndex)}`;
    params.push(limit);
    paramIndex++;
  }

  if (offset !== undefined) {
    sql += ` OFFSET $${String(paramIndex)}`;
    params.push(offset);
  }

  const result = await query<CheckpointRow>(sql, params);

  return result.rows.map(mapRowToCheckpoint);
}

/**
 * Lists checkpoints filtered by operation type.
 *
 * @param branchId - The branch ID
 * @param operationType - The operation type to filter by
 * @param options - Pagination options
 * @returns Array of checkpoints with the specified operation type
 */
export async function listCheckpointsByOperationType(
  branchId: string,
  operationType: string,
  options: { limit?: number; offset?: number } = {},
): Promise<Checkpoint[]> {
  const { limit, offset } = options;

  let sql = `SELECT * FROM app.checkpoints
     WHERE branch_id = $1 AND operation_type = $2`;
  const params: unknown[] = [branchId, operationType];
  let paramIndex = 3;

  sql += ' ORDER BY created_at DESC';

  if (limit !== undefined) {
    sql += ` LIMIT $${String(paramIndex)}`;
    params.push(limit);
    paramIndex++;
  }

  if (offset !== undefined) {
    sql += ` OFFSET $${String(paramIndex)}`;
    params.push(offset);
  }

  const result = await query<CheckpointRow>(sql, params);

  return result.rows.map(mapRowToCheckpoint);
}
