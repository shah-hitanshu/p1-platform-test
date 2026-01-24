/**
 * Phase 3.3: Checkpoint Service
 *
 * CRUD operations for Checkpoints and checkpoint-related functionality.
 * Checkpoints are named snapshots of branch state at a point in time.
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Checkpoints"
 */

import type { Checkpoint, CheckpointType, DocumentVersion } from '../types';
import { query } from '../db';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a new checkpoint.
 */
export interface CreateCheckpointParams {
  branchId: string;
  name?: string;
  message?: string;
  checkpointType: CheckpointType;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
}

/**
 * Result of creating a checkpoint.
 */
export interface CreateCheckpointResult {
  checkpoint: Checkpoint;
  documentCount: number;
}

/**
 * Options for listing checkpoints.
 */
export interface ListCheckpointsOptions {
  checkpointType?: CheckpointType;
  limit?: number;
  offset?: number;
}

/**
 * Parameters for reverting to a checkpoint.
 */
export interface RevertToCheckpointParams {
  checkpointId: string;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  message?: string;
}

/**
 * Result of reverting to a checkpoint.
 */
export interface RevertToCheckpointResult {
  checkpoint: Checkpoint;
  documentsReverted: number;
}

/**
 * Document version with path information for checkpoint queries.
 */
export interface CheckpointDocumentVersion extends DocumentVersion {
  documentPath: string;
}

/**
 * Database row format for checkpoints.
 */
interface CheckpointRow {
  id: string;
  branch_id: string;
  name: string | null;
  message: string | null;
  checkpoint_type: CheckpointType;
  created_by_id: string;
  created_by_type: 'user' | 'agent' | 'system';
  created_at: string;
}

/**
 * Database row for document versions with document path (joined).
 */
interface VersionWithDocumentRow {
  id: string;
  document_id: string;
  branch_id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  crdt_state: Buffer | null;
  source: string;
  created_by_id: string;
  created_by_type: 'user' | 'agent' | 'system';
  created_at: string;
  document_path: string;
}

/**
 * Database row for checkpoint structures.
 */
interface CheckpointStructureRow {
  checkpoint_id: string;
  structure_id: string;
  name: string;
  slug: string;
  description: string | null;
  structure_type: string;
  structure_tree: Record<string, unknown>[];
  metadata_schema: Record<string, unknown>;
  schema_enforcement: string;
}

/**
 * Structure state captured in a checkpoint.
 */
export interface CheckpointStructure {
  checkpointId: string;
  structureId: string;
  name: string;
  slug: string;
  description?: string;
  structureType: string;
  structureTree: Record<string, unknown>[];
  metadataSchema: Record<string, unknown>;
  schemaEnforcement: string;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when the referenced branch does not exist.
 */
export class BranchNotFoundError extends Error {
  public readonly name = 'BranchNotFoundError';

  constructor(public readonly branchId: string) {
    super(`Branch with ID "${branchId}" not found.`);
    Object.setPrototypeOf(this, BranchNotFoundError.prototype);
  }
}

/**
 * Error thrown when the referenced checkpoint does not exist.
 */
export class CheckpointNotFoundError extends Error {
  public readonly name = 'CheckpointNotFoundError';

  constructor(public readonly checkpointId: string) {
    super(`Checkpoint with ID "${checkpointId}" not found.`);
    Object.setPrototypeOf(this, CheckpointNotFoundError.prototype);
  }
}

/**
 * Error thrown when checkpoint creation parameters are invalid.
 */
export class InvalidCheckpointParamsError extends Error {
  public readonly name = 'InvalidCheckpointParamsError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, InvalidCheckpointParamsError.prototype);
  }
}

/**
 * Error thrown when an unexpected database error occurs.
 */
export class DatabaseError extends Error {
  public readonly name = 'DatabaseError';

  constructor(message: string, public readonly operation: string) {
    super(message);
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Maps a database row to a Checkpoint domain object.
 */
function mapRowToCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    branchId: row.branch_id,
    name: row.name ?? undefined,
    message: row.message ?? undefined,
    checkpointType: row.checkpoint_type,
    createdById: row.created_by_id,
    createdByType: row.created_by_type,
    createdAt: row.created_at,
  };
}

/**
 * Maps a version with document row to CheckpointDocumentVersion.
 */
function mapRowToCheckpointDocumentVersion(row: VersionWithDocumentRow): CheckpointDocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    branchId: row.branch_id,
    versionNumber: row.version_number,
    snapshot: row.snapshot,
    crdtState: row.crdt_state ? row.crdt_state.toString('base64') : undefined,
    source: row.source as CheckpointDocumentVersion['source'],
    createdById: row.created_by_id,
    createdByType: row.created_by_type,
    createdAt: row.created_at,
    documentPath: row.document_path,
  };
}

/**
 * Maps a checkpoint structure row to CheckpointStructure domain object.
 */
function mapRowToCheckpointStructure(row: CheckpointStructureRow): CheckpointStructure {
  return {
    checkpointId: row.checkpoint_id,
    structureId: row.structure_id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    structureType: row.structure_type,
    structureTree: row.structure_tree,
    metadataSchema: row.metadata_schema,
    schemaEnforcement: row.schema_enforcement,
  };
}

/**
 * Gets the first row from a query result, throwing if not present.
 */
function getFirstRow<T>(rows: T[]): T {
  const first = rows[0];
  if (first === undefined) {
    throw new Error('Expected query to return at least one row');
  }
  return first;
}

/**
 * Checks if an error is a PostgreSQL foreign key constraint violation.
 */
function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === '23503'
  );
}

// =============================================================================
// Service Functions
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

  try {
    // Use transaction for multi-step operation
    await query('BEGIN');

    // Create the checkpoint
    const checkpointResult = await query<CheckpointRow>(
      `INSERT INTO app.checkpoints (
        branch_id, name, message, checkpoint_type,
        created_by_id, created_by_type
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        params.branchId,
        params.name ?? null,
        params.message ?? null,
        params.checkpointType,
        params.createdById,
        params.createdByType,
      ],
    );

    const checkpoint = mapRowToCheckpoint(getFirstRow(checkpointResult.rows));

    // Get latest versions for all documents on this branch
    const latestVersionsResult = await query<{ document_id: string; document_version_id: string }>(
      `SELECT DISTINCT ON (dv.document_id)
        dv.document_id,
        dv.id as document_version_id
      FROM app.document_versions dv
      WHERE dv.branch_id = $1
      ORDER BY dv.document_id, dv.version_number DESC`,
      [params.branchId],
    );

    // Insert checkpoint_documents entries
    if (latestVersionsResult.rows.length > 0) {
      const values = latestVersionsResult.rows
        .map((_, i) => `($1, $${String(i * 2 + 2)}, $${String(i * 2 + 3)})`)
        .join(', ');
      const flatParams: unknown[] = [checkpoint.id];
      for (const row of latestVersionsResult.rows) {
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
        checkpoint_id, document_id, structure_id, node_id, position, metadata
      )
      SELECT $1, bdm.document_id, bdm.structure_id, bdm.node_id, bdm.position, bdm.metadata
      FROM app.branch_document_metadata bdm
      WHERE bdm.branch_id = $2`,
      [checkpoint.id, params.branchId],
    );

    await query('COMMIT');

    return {
      checkpoint,
      documentCount: latestVersionsResult.rows.length,
    };
  } catch (error) {
    await query('ROLLBACK');
    if (isForeignKeyViolation(error)) {
      throw new BranchNotFoundError(params.branchId);
    }
    throw new DatabaseError('Failed to create checkpoint', 'createCheckpoint');
  }
}

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
  const result = await query<VersionWithDocumentRow>(
    `SELECT dv.*, d.path as document_path
     FROM app.checkpoint_documents cd
     JOIN app.document_versions dv ON cd.document_version_id = dv.id
     JOIN app.documents d ON cd.document_id = d.id
     WHERE cd.checkpoint_id = $1 AND d.path = $2`,
    [checkpointId, documentPath],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToCheckpointDocumentVersion(getFirstRow(result.rows));
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

  // Get the checkpoint
  const checkpoint = await getCheckpoint(params.checkpointId);
  if (!checkpoint) {
    throw new CheckpointNotFoundError(params.checkpointId);
  }

  // Get documents at the checkpoint
  const documentsAtCheckpoint = await getDocumentsAtCheckpoint(params.checkpointId);

  // Create new versions for each document with source='revert'
  for (const doc of documentsAtCheckpoint) {
    await query(
      `INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot, crdt_state,
        source, created_by_id, created_by_type
      )
      SELECT $1, $2,
        COALESCE(MAX(version_number), 0) + 1,
        $3, $4, 'revert', $5, $6
      FROM app.document_versions
      WHERE document_id = $1 AND branch_id = $2`,
      [
        doc.documentId,
        checkpoint.branchId,
        JSON.stringify(doc.snapshot),
        doc.crdtState !== undefined && doc.crdtState !== '' ?
          Buffer.from(doc.crdtState, 'base64') : null,
        params.createdById,
        params.createdByType,
      ],
    );
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
      branch_id, document_id, structure_id, node_id, position, metadata
    )
    SELECT $1, cdm.document_id, cdm.structure_id, cdm.node_id, cdm.position, cdm.metadata
    FROM app.checkpoint_document_metadata cdm
    WHERE cdm.checkpoint_id = $2`,
    [checkpoint.branchId, params.checkpointId],
  );

  // Create a checkpoint documenting the revert
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
    documentsReverted: documentsAtCheckpoint.length,
  };
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
