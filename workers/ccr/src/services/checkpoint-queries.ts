/**
 * Checkpoint Service - Read/List Query Functions
 *
 * Simple database queries for retrieving checkpoints,
 * documents at checkpoints, and structures at checkpoints.
 */

import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Checkpoint, CheckpointStatus } from '../types';
import { db, transaction } from '../db/scope';
import {
  checkpointDocuments,
  checkpoints,
  checkpointStructures,
  documents,
  documentVersions,
} from '../db/schema';
import type {
  CheckpointDocumentVersion,
  CheckpointStructure,
  ListCheckpointsOptions,
  ListCheckpointsByAgentOptions,
  VersionWithDocumentRow,
} from './checkpoint-types';
import { CheckpointNotFoundError } from './errors';
import {
  checkpointColumns,
  checkpointDocumentVersionColumns,
  checkpointStructureColumns,
  mapDrizzleRowToCheckpoint,
  mapDrizzleRowToCheckpointDocumentVersion,
  mapDrizzleRowToCheckpointStructure,
  mapRowToCheckpointDocumentVersion,
} from './checkpoint-mappers';
import { normalizePath } from './document-types';

/**
 * Retrieves a checkpoint by its ID.
 *
 * @param checkpointId - The checkpoint ID
 * @returns The checkpoint or null if not found
 */
export async function getCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
  const [row] = await db()
    .select(checkpointColumns)
    .from(checkpoints)
    .where(eq(checkpoints.id, checkpointId));

  return row === undefined ? null : mapDrizzleRowToCheckpoint(row);
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

  const conditions = [eq(checkpoints.branchId, branchId)];
  if (checkpointType !== undefined) {
    conditions.push(eq(checkpoints.checkpointType, checkpointType));
  }

  let statement = db()
    .select(checkpointColumns)
    .from(checkpoints)
    .where(and(...conditions))
    .orderBy(desc(checkpoints.createdAt))
    .$dynamic();

  if (limit !== undefined) {
    statement = statement.limit(limit);
  }
  if (offset !== undefined) {
    statement = statement.offset(offset);
  }

  return (await statement).map(mapDrizzleRowToCheckpoint);
}

/**
 * Gets the document versions this checkpoint's own manifest records.
 *
 * This is the raw manifest, not the branch state. An incremental checkpoint
 * holds only its delta, and that delta includes tombstones, so the result can
 * both omit live documents and name deleted ones. For "what did the branch look
 * like here", which is almost always the question, use
 * resolveCheckpointDocuments.
 *
 * @param checkpointId - The checkpoint ID
 * @returns Array of document versions with paths, as captured
 */
export async function getDocumentsAtCheckpoint(
  checkpointId: string,
): Promise<CheckpointDocumentVersion[]> {
  const rows = await db()
    .select(checkpointDocumentVersionColumns)
    .from(checkpointDocuments)
    .innerJoin(documentVersions, eq(checkpointDocuments.documentVersionId, documentVersions.id))
    .innerJoin(documents, eq(checkpointDocuments.documentId, documents.id))
    .where(eq(checkpointDocuments.checkpointId, checkpointId))
    .orderBy(asc(documents.path));

  return rows.map(mapDrizzleRowToCheckpointDocumentVersion);
}

/**
 * Gets a specific document's version from a checkpoint's own manifest.
 *
 * Manifest-scoped like getDocumentsAtCheckpoint: returns null for a document
 * an incremental checkpoint did not capture, even when the branch had it.
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
  const [row] = await db()
    .select(checkpointDocumentVersionColumns)
    .from(checkpointDocuments)
    .innerJoin(documentVersions, eq(checkpointDocuments.documentVersionId, documentVersions.id))
    .innerJoin(documents, eq(checkpointDocuments.documentId, documents.id))
    .where(and(
      eq(checkpointDocuments.checkpointId, checkpointId),
      eq(documents.path, normalizedPath),
    ));

  return row === undefined ? null : mapDrizzleRowToCheckpointDocumentVersion(row);
}

/**
 * The chain a checkpoint resolves over: itself plus its ancestors, stopping at
 * the nearest full snapshot. That snapshot already holds every live document on
 * the branch, so anything older is either superseded or no longer live —
 * without the stop the walk would run to the branch root and resurrect
 * documents the snapshot omitted.
 *
 * `nearest` picks each document's entry from the closest checkpoint that
 * mentions it, which is what makes a delta override its parent.
 */
export function nearestCheckpointChainEntries(checkpointId: string): SQL {
  return sql`WITH RECURSIVE chain AS (
       SELECT c.id, c.parent_checkpoint_id, c.is_full_snapshot, 0 AS depth
       FROM app.checkpoints c
       WHERE c.id = ${checkpointId}
     UNION ALL
       SELECT parent.id, parent.parent_checkpoint_id, parent.is_full_snapshot, chain.depth + 1
       FROM chain
       JOIN app.checkpoints parent ON parent.id = chain.parent_checkpoint_id
       WHERE chain.is_full_snapshot = false
     ),
     nearest AS (
       SELECT DISTINCT ON (cd.document_id) cd.document_version_id, cd.document_id
       FROM chain
       JOIN app.checkpoint_documents cd ON cd.checkpoint_id = chain.id
       ORDER BY cd.document_id, chain.depth ASC
     )`;
}

/**
 * Resolves the live document set for a checkpoint, walking the parent chain for
 * incremental checkpoints. Newer checkpoint entries override older ones for the
 * same document.
 *
 * Documents whose nearest entry is a tombstone were deleted as of this
 * checkpoint, so they are excluded — see resolveCheckpointDeletions for those.
 *
 * @param checkpointId - The checkpoint ID to resolve
 * @returns Complete array of document versions representing the checkpoint state
 */
export async function resolveCheckpointDocuments(
  checkpointId: string,
): Promise<CheckpointDocumentVersion[]> {
  // A recursive CTE has no builder form, so the chain walk stays raw (D6). Its
  // rows come back in the column names the statement gives them, which is why
  // they take the snake_case mapper.
  const rows = await db().execute<VersionWithDocumentRow>(sql`
    ${nearestCheckpointChainEntries(checkpointId)}
    SELECT dv.*, d.path as document_path
    FROM app.document_versions dv
    JOIN nearest ON nearest.document_version_id = dv.id
    JOIN app.documents d ON d.id = nearest.document_id
    WHERE dv.is_tombstone = false
    ORDER BY d.path
  `);

  return rows.map(mapRowToCheckpointDocumentVersion);
}

/**
 * Resolves the documents that were deleted as of a checkpoint: those whose
 * nearest entry in the chain is a tombstone.
 *
 * A full snapshot never records tombstones — it captures the live set, so
 * absence is the deletion — which is why the walk stopping at one is what keeps
 * this bounded to deletions the chain actually describes.
 *
 * @param checkpointId - The checkpoint ID to resolve
 * @returns Document ids and paths deleted as of the checkpoint
 */
export async function resolveCheckpointDeletions(
  checkpointId: string,
): Promise<{ documentId: string; documentPath: string }[]> {
  const rows = await db().execute<{ document_id: string; document_path: string }>(sql`
    ${nearestCheckpointChainEntries(checkpointId)}
    SELECT nearest.document_id, d.path as document_path
    FROM app.documents d
    JOIN nearest ON nearest.document_id = d.id
    JOIN app.document_versions dv ON dv.id = nearest.document_version_id
    WHERE dv.is_tombstone = true
    ORDER BY d.path
  `);

  return rows.map((row) => ({
    documentId: row.document_id,
    documentPath: row.document_path,
  }));
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
  const rows = await db()
    .select(checkpointStructureColumns)
    .from(checkpointStructures)
    .where(eq(checkpointStructures.checkpointId, checkpointId))
    .orderBy(asc(checkpointStructures.name));

  return rows.map(mapDrizzleRowToCheckpointStructure);
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
  const [row] = await db()
    .select(checkpointStructureColumns)
    .from(checkpointStructures)
    .where(and(
      eq(checkpointStructures.checkpointId, checkpointId),
      eq(checkpointStructures.structureId, structureId),
    ));

  return row === undefined ? null : mapDrizzleRowToCheckpointStructure(row);
}

/**
 * Gets the most recent checkpoint for a branch.
 *
 * @param branchId - The branch ID
 * @returns The latest checkpoint or null if none exist
 */
export async function getLatestCheckpoint(branchId: string): Promise<Checkpoint | null> {
  const [row] = await db()
    .select(checkpointColumns)
    .from(checkpoints)
    .where(eq(checkpoints.branchId, branchId))
    .orderBy(desc(checkpoints.createdAt))
    .limit(1);

  return row === undefined ? null : mapDrizzleRowToCheckpoint(row);
}

/**
 * Gets the count of documents in a checkpoint.
 *
 * @param checkpointId - The checkpoint ID
 * @returns The document count
 */
export async function getCheckpointDocumentCount(checkpointId: string): Promise<number> {
  const [row] = await db()
    .select({ count: count() })
    .from(checkpointDocuments)
    .where(eq(checkpointDocuments.checkpointId, checkpointId));

  return row?.count ?? 0;
}

/**
 * Deletes a checkpoint and its document associations.
 *
 * @param checkpointId - The checkpoint ID
 * @returns True if deleted, false if not found
 */
export async function deleteCheckpoint(checkpointId: string): Promise<boolean> {
  return transaction(async () => {
    // Delete checkpoint_documents first (foreign key)
    await db()
      .delete(checkpointDocuments)
      .where(eq(checkpointDocuments.checkpointId, checkpointId));

    const deleted = await db()
      .delete(checkpoints)
      .where(eq(checkpoints.id, checkpointId))
      .returning({ id: checkpoints.id });

    return deleted.length > 0;
  });
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
  const rolledBackAt = status === 'rolled_back' ? new Date() : null;

  const [row] = await db()
    .update(checkpoints)
    .set({ status, rolledBackById: rolledBackById ?? null, rolledBackAt })
    .where(eq(checkpoints.id, checkpointId))
    .returning(checkpointColumns);

  if (row === undefined) {
    throw new CheckpointNotFoundError(checkpointId);
  }

  return mapDrizzleRowToCheckpoint(row);
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

  const conditions = [
    eq(checkpoints.createdById, agentId),
    eq(checkpoints.createdByType, 'agent'),
  ];
  if (branchId !== undefined) conditions.push(eq(checkpoints.branchId, branchId));
  if (operationType !== undefined) conditions.push(eq(checkpoints.operationType, operationType));
  if (trigger !== undefined) conditions.push(eq(checkpoints.trigger, trigger));
  if (status !== undefined) conditions.push(eq(checkpoints.status, status));

  let statement = db()
    .select(checkpointColumns)
    .from(checkpoints)
    .where(and(...conditions))
    .orderBy(desc(checkpoints.createdAt))
    .$dynamic();

  if (limit !== undefined) {
    statement = statement.limit(limit);
  }
  if (offset !== undefined) {
    statement = statement.offset(offset);
  }

  return (await statement).map(mapDrizzleRowToCheckpoint);
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

  let statement = db()
    .select(checkpointColumns)
    .from(checkpoints)
    .where(and(
      eq(checkpoints.branchId, branchId),
      eq(checkpoints.operationType, operationType),
    ))
    .orderBy(desc(checkpoints.createdAt))
    .$dynamic();

  if (limit !== undefined) {
    statement = statement.limit(limit);
  }
  if (offset !== undefined) {
    statement = statement.offset(offset);
  }

  return (await statement).map(mapDrizzleRowToCheckpoint);
}
