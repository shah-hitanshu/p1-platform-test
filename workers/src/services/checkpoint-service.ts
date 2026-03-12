/**
 * Phase 3.3: Checkpoint Service
 *
 * CRUD operations for Checkpoints and checkpoint-related functionality.
 * Checkpoints are named snapshots of branch state at a point in time.
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Checkpoints"
 */

import type {
  Checkpoint,
  CheckpointType,
  CheckpointStatus,
  CheckpointTrigger,
  DocumentVersion,
} from '../types';
import { query } from '../db';
import { getBranch, getMainBranch } from './branch-service';

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
  /** Detailed description of what the checkpoint contains */
  description?: string;
  /** How this checkpoint was triggered */
  trigger?: CheckpointTrigger;
  /** User ID who requested the agent action (if trigger = human_requested) */
  requestedById?: string;
  /** Category of operation that created this checkpoint */
  operationType?: string;
  /** JSON paths of regions affected by this checkpoint */
  affectedRegions?: string[];
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
 * Options for listing checkpoints by agent.
 */
export interface ListCheckpointsByAgentOptions {
  limit?: number;
  offset?: number;
  branchId?: string;
  operationType?: string;
  trigger?: CheckpointTrigger;
  status?: CheckpointStatus;
}

/**
 * Document version with path information for checkpoint queries.
 */
export interface CheckpointDocumentVersion extends DocumentVersion {
  documentPath: string;
  versionId: string;
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
  // Enhanced checkpoint fields (Agent Politeness)
  description: string | null;
  trigger: CheckpointTrigger | null;
  requested_by_id: string | null;
  operation_type: string | null;
  affected_regions: string[] | null;
  status: CheckpointStatus | null;
  rolled_back_by_id: string | null;
  rolled_back_at: string | null;
  // Incremental checkpoint support (Phase 6.1)
  parent_checkpoint_id: string | null;
}

/**
 * Extended row returned by CTE-based INSERT in createCheckpoint.
 * The CTE embeds parent checkpoint lookup, so RETURNING includes
 * parent_created_at alongside standard checkpoint fields.
 */
interface CheckpointInsertRow extends CheckpointRow {
  parent_created_at: string | null;
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
    parentCheckpointId: row.parent_checkpoint_id ?? undefined,
    createdById: row.created_by_id,
    createdByType: row.created_by_type,
    createdAt: row.created_at,
    // Enhanced checkpoint fields (Agent Politeness)
    description: row.description ?? undefined,
    trigger: row.trigger ?? undefined,
    requestedById: row.requested_by_id ?? undefined,
    operationType: row.operation_type ?? undefined,
    affectedRegions: row.affected_regions ?? undefined,
    status: row.status ?? undefined,
    rolledBackById: row.rolled_back_by_id ?? undefined,
    rolledBackAt: row.rolled_back_at ?? undefined,
  };
}

/**
 * Maps a version with document row to CheckpointDocumentVersion.
 */
function mapRowToCheckpointDocumentVersion(row: VersionWithDocumentRow): CheckpointDocumentVersion {
  return {
    id: row.id,
    versionId: row.id,
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
// Input Validation Constants
// =============================================================================

/** Maximum length for checkpoint name */
const MAX_NAME_LENGTH = 255;

/** Maximum length for checkpoint message */
const MAX_MESSAGE_LENGTH = 1000;

/** Maximum length for checkpoint description */
const MAX_DESCRIPTION_LENGTH = 5000;

/** Maximum length for operation type */
const MAX_OPERATION_TYPE_LENGTH = 100;

/** Maximum number of affected regions per checkpoint */
const MAX_AFFECTED_REGIONS = 100;

/** Maximum length for a single affected region path */
const MAX_REGION_PATH_LENGTH = 500;

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

    // Determine incremental mode from the CTE result
    const isIncremental = insertRow.parent_checkpoint_id != null;
    const parentCreatedAt = insertRow.parent_created_at;

    // Get document versions — incremental only captures changes since parent
    let latestVersionsResult: { rows: { document_id: string; document_version_id: string }[] };

    if (isIncremental && parentCreatedAt != null && parentCreatedAt !== '') {
      // Incremental: only documents changed since the parent checkpoint
      latestVersionsResult = await query<{ document_id: string; document_version_id: string }>(
        `SELECT document_id, document_version_id FROM (
          SELECT DISTINCT ON (dv.document_id)
            dv.document_id, dv.id as document_version_id, dv.is_tombstone
          FROM app.document_versions dv
          WHERE dv.branch_id = $1 AND dv.created_at > $2
          ORDER BY dv.document_id, dv.version_number DESC
        ) latest
        WHERE latest.is_tombstone = false`,
        [params.branchId, parentCreatedAt],
      );
    } else {
      // Full: all latest versions for the branch
      latestVersionsResult = await query<{ document_id: string; document_version_id: string }>(
        `SELECT document_id, document_version_id FROM (
          SELECT DISTINCT ON (dv.document_id)
            dv.document_id, dv.id as document_version_id, dv.is_tombstone
          FROM app.document_versions dv
          WHERE dv.branch_id = $1
          ORDER BY dv.document_id, dv.version_number DESC
        ) latest
        WHERE latest.is_tombstone = false`,
        [params.branchId],
      );
    }

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
      documentCount: latestVersionsResult.rows.length,
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
    for (const doc of chain[i]) {
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
    throw new CheckpointNotFoundError(params.checkpointId);
  }

  // Get documents at the checkpoint (before transaction, for verification)
  const documentsAtCheckpoint = await getDocumentsAtCheckpoint(params.checkpointId);

  try {
    // Use transaction for the revert operations
    await query('BEGIN');

    // Phase 6.2: Batch revert optimization.
    // For large document counts, use a single bulk INSERT...SELECT with JOIN LATERAL.
    // For small counts, use the per-document loop (simpler, negligible overhead).
    const BATCH_REVERT_THRESHOLD = 3;

    if (documentsAtCheckpoint.length >= BATCH_REVERT_THRESHOLD) {
      // Batch INSERT: single query for all documents at once
      await query(
        `INSERT INTO app.document_versions (
          document_id, branch_id, version_number, snapshot, crdt_state,
          source, created_by_id, created_by_type
        )
        SELECT
          cd.document_id,
          $1,
          lv.max_version + 1,
          dv.snapshot,
          dv.crdt_state,
          'revert',
          $2,
          $3
        FROM app.checkpoint_documents cd
        JOIN app.document_versions dv ON cd.document_version_id = dv.id
        JOIN LATERAL (
          SELECT COALESCE(MAX(version_number), 0) as max_version
          FROM app.document_versions
          WHERE document_id = cd.document_id AND branch_id = $1
        ) lv ON true
        WHERE cd.checkpoint_id = $4`,
        [checkpoint.branchId, params.createdById, params.createdByType, params.checkpointId],
      );
    } else {
      // Per-document INSERT for small counts
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
            doc.snapshot,
            doc.crdtState !== undefined && doc.crdtState !== '' ?
              Buffer.from(doc.crdtState, 'base64') : null,
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

// =============================================================================
// Enhanced Checkpoint Functions (Agent Politeness)
// =============================================================================

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

// =============================================================================
// Publish Document
// =============================================================================

/**
 * Parameters for publishing a document.
 */
export interface PublishDocumentParams {
  siteId: string;
  branchId: string;
  documentId: string;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
}

/**
 * Result of publishing a document.
 */
export interface PublishDocumentResult {
  checkpoint: Checkpoint;
  publishedVersionId: string;
  sourceBranchName?: string;
}

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
    crdt_state: Buffer | null;
    is_tombstone: boolean;
  }>(
    `SELECT id, document_id, branch_id, version_number, snapshot, crdt_state, is_tombstone
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
          document_id, branch_id, version_number, snapshot, crdt_state,
          source, created_by_id, created_by_type,
          source_branch_id, source_version_id
        )
        SELECT $1, $2,
          COALESCE(MAX(version_number), 0) + 1,
          $3, $4, 'publish', $5, $6,
          $7, $8
        FROM app.document_versions
        WHERE document_id = $1 AND branch_id = $2
        RETURNING id, version_number`,
        [
          params.documentId,
          mainBranch.id,
          version.snapshot,
          version.crdt_state,
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
