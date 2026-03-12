/**
 * Phase 3.3: Document Version Service
 *
 * CRUD operations for Document Versions.
 * Document versions are snapshots of document state on a specific branch.
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Document Versions"
 */

import type { DocumentVersion, DocumentVersionSource } from '../types';
import { query } from '../db';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a new document version.
 */
export interface CreateDocumentVersionParams {
  documentId: string;
  branchId: string;
  snapshot: Record<string, unknown>;
  crdtState?: string; // Base64 encoded
  source: DocumentVersionSource;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  /**
   * Skip duplicate snapshot check and always create a new version.
   * Use for reverts or explicit version creation where duplicates are intentional.
   * @default false
   */
  skipDuplicateCheck?: boolean;
}

/**
 * Options for listing document versions.
 */
export interface ListDocumentVersionsOptions {
  limit?: number;
  offset?: number;
}

/**
 * Database row format for document versions.
 */
interface DocumentVersionRow {
  id: string;
  document_id: string;
  branch_id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  crdt_state: Buffer | null;
  source: DocumentVersionSource;
  created_by_id: string;
  created_by_type: 'user' | 'agent' | 'system';
  created_at: string;
  is_published?: boolean;
  is_tombstone?: boolean;
  source_branch_id: string | null;
  source_version_id: string | null;
  published_to_version_id: string | null;
  source_branch_name?: string | null;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when the referenced document does not exist.
 */
export class DocumentNotFoundError extends Error {
  public readonly name = 'DocumentNotFoundError';

  constructor(public readonly documentId: string) {
    super(`Document with ID "${documentId}" not found.`);
    Object.setPrototypeOf(this, DocumentNotFoundError.prototype);
  }
}

/**
 * Error thrown when document version creation parameters are invalid.
 */
export class InvalidDocumentVersionParamsError extends Error {
  public readonly name = 'InvalidDocumentVersionParamsError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, InvalidDocumentVersionParamsError.prototype);
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
 * Maps a database row to a DocumentVersion domain object.
 */
function mapRowToDocumentVersion(row: DocumentVersionRow): DocumentVersion {
  const version: DocumentVersion = {
    id: row.id,
    documentId: row.document_id,
    branchId: row.branch_id,
    versionNumber: row.version_number,
    snapshot: row.snapshot,
    crdtState: row.crdt_state ? row.crdt_state.toString('base64') : undefined,
    source: row.source,
    createdById: row.created_by_id,
    createdByType: row.created_by_type,
    createdAt: row.created_at,
  };
  if (row.is_published !== undefined) {
    version.isPublished = row.is_published;
  }
  if (row.is_tombstone !== undefined) {
    version.isTombstone = row.is_tombstone;
  }
  return {
    ...version,
    ...(row.source_branch_id != null ? { sourceBranchId: row.source_branch_id } : {}),
    ...(row.source_version_id != null ? { sourceVersionId: row.source_version_id } : {}),
    ...(row.published_to_version_id != null ? { publishedToVersionId: row.published_to_version_id } : {}),
    ...(('source_branch_name' in row && row.source_branch_name != null) ? { sourceBranchName: row.source_branch_name } : {}),
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

/**
 * Checks if an error is a PostgreSQL unique constraint violation.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === '23505'
  );
}

/**
 * Deep comparison of two values for equality.
 * Used to compare snapshots to avoid creating duplicate versions.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every(key => deepEqual(aObj[key], bObj[key]));
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Creates a new document version with auto-incremented version number.
 *
 * @param params - Document version creation parameters
 * @returns The created document version
 * @throws InvalidDocumentVersionParamsError if required fields are missing
 * @throws DocumentNotFoundError if the document does not exist
 */
export async function createDocumentVersion(
  params: CreateDocumentVersionParams,
): Promise<DocumentVersion> {
  // Validate required fields
  if (!params.documentId || params.documentId.trim() === '') {
    throw new InvalidDocumentVersionParamsError('Document ID is required');
  }
  if (!params.branchId || params.branchId.trim() === '') {
    throw new InvalidDocumentVersionParamsError('Branch ID is required');
  }
  if (!params.createdById || params.createdById.trim() === '') {
    throw new InvalidDocumentVersionParamsError('Created by ID is required');
  }

  // Check for duplicate snapshot unless explicitly skipped
  if (params.skipDuplicateCheck !== true) {
    const latestVersion = await getLatestDocumentVersion(
      params.documentId,
      params.branchId,
    );
    if (latestVersion?.snapshot && deepEqual(latestVersion.snapshot, params.snapshot)) {
      console.log(
        `Version creation skipped for document ${params.documentId}: snapshot unchanged`,
      );
      return latestVersion;
    }
  }

  // Convert base64 CRDT state to buffer if provided
  const crdtBuffer = params.crdtState !== undefined && params.crdtState !== ''
    ? Buffer.from(params.crdtState, 'base64')
    : null;

  try {
    // Use a subquery to auto-increment version number
    const result = await query<DocumentVersionRow>(
      `INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot, crdt_state,
        source, created_by_id, created_by_type
      )
      SELECT $1, $2,
        COALESCE(MAX(version_number), 0) + 1,
        $3, $4, $5, $6, $7
      FROM app.document_versions
      WHERE document_id = $1 AND branch_id = $2
      RETURNING *`,
      [
        params.documentId,
        params.branchId,
        params.snapshot,
        crdtBuffer,
        params.source,
        params.createdById,
        params.createdByType,
      ],
    );

    return mapRowToDocumentVersion(getFirstRow(result.rows));
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new DocumentNotFoundError(params.documentId);
    }
    // Unique constraint violation on (document_id, branch_id, version_number)
    // means a concurrent sync (e.g. queue) already wrote a version with the same
    // version_number. Return the latest version instead of failing — the data is
    // in Postgres, which is what the caller needs.
    if (isUniqueViolation(error)) {
      console.warn(
        'createDocumentVersion: unique constraint hit for document ' +
          `${params.documentId} on branch ${params.branchId}, returning latest version`,
      );
      const latest = await getLatestDocumentVersion(params.documentId, params.branchId);
      if (latest !== null) {
        return latest;
      }
    }
    throw new DatabaseError('Failed to create document version', 'createDocumentVersion');
  }
}

/**
 * Retrieves a document version by its ID.
 *
 * @param versionId - The version ID
 * @returns The document version or null if not found
 */
export async function getDocumentVersion(versionId: string): Promise<DocumentVersion | null> {
  const result = await query<DocumentVersionRow>(
    `SELECT dv.*,
       dv.source_branch_id, dv.source_version_id, dv.published_to_version_id,
       b.name AS source_branch_name,
       EXISTS(
         SELECT 1 FROM app.checkpoint_documents cd
         WHERE cd.document_version_id = dv.id
       ) AS is_published
     FROM app.document_versions dv
     LEFT JOIN app.branches b ON b.id = dv.source_branch_id
     WHERE dv.id = $1`,
    [versionId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToDocumentVersion(getFirstRow(result.rows));
}

/**
 * Retrieves the latest version of a document on a branch.
 *
 * @param documentId - The document ID
 * @param branchId - The branch ID
 * @returns The latest document version or null if none exist
 */
export async function getLatestDocumentVersion(
  documentId: string,
  branchId: string,
): Promise<DocumentVersion | null> {
  const result = await query<DocumentVersionRow>(
    `SELECT dv.*,
       dv.source_branch_id, dv.source_version_id, dv.published_to_version_id,
       b.name AS source_branch_name,
       EXISTS(
         SELECT 1 FROM app.checkpoint_documents cd
         WHERE cd.document_version_id = dv.id
       ) AS is_published
     FROM app.document_versions dv
     LEFT JOIN app.branches b ON b.id = dv.source_branch_id
     WHERE dv.document_id = $1 AND dv.branch_id = $2
     ORDER BY dv.version_number DESC
     LIMIT 1`,
    [documentId, branchId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToDocumentVersion(getFirstRow(result.rows));
}

/**
 * Retrieves the latest *published* version of a document on a branch.
 * A published version is one that has been captured in a checkpoint.
 * Uses the checkpoint_documents join table to find the most recent
 * checkpoint-associated version.
 *
 * @param documentId - The document ID
 * @param branchId - The branch ID
 * @returns The latest published document version or null if none exist
 */
export async function getLatestPublishedDocumentVersion(
  documentId: string,
  branchId: string,
): Promise<DocumentVersion | null> {
  const result = await query<DocumentVersionRow>(
    `SELECT dv.*,
       dv.source_branch_id, dv.source_version_id, dv.published_to_version_id,
       b.name AS source_branch_name
     FROM app.document_versions dv
     INNER JOIN app.checkpoint_documents cd ON cd.document_version_id = dv.id
     INNER JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
     LEFT JOIN app.branches b ON b.id = dv.source_branch_id
     WHERE dv.document_id = $1
       AND dv.branch_id = $2
       AND cp.branch_id = $2
     ORDER BY dv.version_number DESC
     LIMIT 1`,
    [documentId, branchId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToDocumentVersion(getFirstRow(result.rows));
}

/**
 * Retrieves the latest version for each document on a branch.
 * Uses a window function to efficiently get the latest version per document.
 *
 * @param branchId - The branch ID
 * @returns Array of latest document versions
 */
export async function getLatestVersionsForBranch(branchId: string): Promise<DocumentVersion[]> {
  const result = await query<DocumentVersionRow>(
    `SELECT DISTINCT ON (document_id) *
     FROM app.document_versions
     WHERE branch_id = $1
     ORDER BY document_id, version_number DESC`,
    [branchId],
  );

  return result.rows.map(mapRowToDocumentVersion);
}

/**
 * Lists all versions for a document on a branch in descending order.
 *
 * @param documentId - The document ID
 * @param branchId - The branch ID
 * @param options - Pagination options
 * @returns Array of document versions
 */
export async function listDocumentVersions(
  documentId: string,
  branchId: string,
  options: ListDocumentVersionsOptions = {},
): Promise<DocumentVersion[]> {
  const { limit, offset } = options;

  let sql = `SELECT dv.*,
       dv.source_branch_id, dv.source_version_id, dv.published_to_version_id,
       b.name AS source_branch_name,
       EXISTS(
         SELECT 1 FROM app.checkpoint_documents cd
         WHERE cd.document_version_id = dv.id
       ) AS is_published
     FROM app.document_versions dv
     LEFT JOIN app.branches b ON b.id = dv.source_branch_id
     WHERE dv.document_id = $1 AND dv.branch_id = $2
     ORDER BY dv.version_number DESC`;
  const params: unknown[] = [documentId, branchId];
  let paramIndex = 3;

  if (limit !== undefined) {
    sql += ` LIMIT $${String(paramIndex)}`;
    params.push(limit);
    paramIndex++;
  }

  if (offset !== undefined) {
    sql += ` OFFSET $${String(paramIndex)}`;
    params.push(offset);
  }

  const result = await query<DocumentVersionRow>(sql, params);

  return result.rows.map(mapRowToDocumentVersion);
}

/**
 * Retrieves a specific version of a document by version number.
 *
 * @param documentId - The document ID
 * @param branchId - The branch ID
 * @param versionNumber - The version number
 * @returns The document version or null if not found
 */
export async function getDocumentVersionByNumber(
  documentId: string,
  branchId: string,
  versionNumber: number,
): Promise<DocumentVersion | null> {
  const result = await query<DocumentVersionRow>(
    `SELECT * FROM app.document_versions
     WHERE document_id = $1 AND branch_id = $2 AND version_number = $3`,
    [documentId, branchId, versionNumber],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToDocumentVersion(getFirstRow(result.rows));
}

// =============================================================================
// Phase 5.2: Batch Sync (for future Queue consumer use)
// =============================================================================

/**
 * Payload for a single item in a batch sync operation.
 */
export interface BatchSyncPayload {
  documentId: string;
  branchId: string;
  snapshot: Record<string, unknown>;
  crdtState: string;
  actorId: string;
  actorType: 'user' | 'agent';
}

/**
 * Result of a batch sync operation.
 */
export interface BatchSyncResult {
  /** Document versions that were successfully inserted */
  inserted: DocumentVersion[];
  /** Number of items that were skipped due to deduplication */
  skippedCount: number;
}

// =============================================================================
// Copy-on-Write Fallback
// =============================================================================

/**
 * Result of getting a document version with copy-on-write fallback.
 */
export interface DocumentVersionWithFallback {
  version: DocumentVersion;
  inherited: boolean;
}

/**
 * Gets the latest document version on a branch, falling back to the latest
 * published version on main if no version exists on the branch.
 *
 * This implements copy-on-write semantics: non-main branches inherit
 * published content from main until they create their own versions.
 *
 * @param documentId - The document ID
 * @param branchId - The branch ID to check first
 * @param mainBranchId - The main branch ID for fallback
 * @returns The document version with inheritance flag, or null if not found
 */
export async function getLatestDocumentVersionWithFallback(
  documentId: string,
  branchId: string,
  mainBranchId: string,
): Promise<DocumentVersionWithFallback | null> {
  // 1. Try getting latest version on the branch
  const branchVersion = await getLatestDocumentVersion(documentId, branchId);
  if (branchVersion !== null) {
    return { version: branchVersion, inherited: false };
  }

  // 2. If branch IS main, no fallback — return null
  if (branchId === mainBranchId) {
    return null;
  }

  // 3. Fall back to latest published version on main
  const mainVersion = await getLatestPublishedDocumentVersion(documentId, mainBranchId);
  if (mainVersion !== null) {
    return { version: mainVersion, inherited: true };
  }

  return null;
}

/**
 * Batch sync multiple document versions to PostgreSQL in a single query (Phase 5.2).
 *
 * Designed for future Queue consumer use (Phase 5.1) where batches of up to
 * 100 sync messages are processed together. Each item in the batch gets its
 * own dedup check via a CTE that compares against the latest snapshot for
 * each (document_id, branch_id) pair.
 *
 * @param payloads - Array of sync payloads to insert
 * @returns Result with inserted versions and skipped count
 */
export async function batchSyncToPostgres(
  payloads: BatchSyncPayload[],
): Promise<BatchSyncResult> {
  if (payloads.length === 0) {
    return { inserted: [], skippedCount: 0 };
  }

  // Build arrays for each column to use with unnest()
  // Note: crdt_state is passed as base64 text[] and decoded in SQL because
  // the postgres driver cannot serialize Buffer[] as a PostgreSQL bytea[] array.
  const documentIds: string[] = [];
  const branchIds: string[] = [];
  const snapshots: (Record<string, unknown>)[] = [];
  const crdtStates: (string | null)[] = [];
  const actorIds: string[] = [];
  const actorTypes: string[] = [];

  for (const payload of payloads) {
    documentIds.push(payload.documentId);
    branchIds.push(payload.branchId);
    snapshots.push(payload.snapshot);
    crdtStates.push(payload.crdtState !== '' ? payload.crdtState : null);
    actorIds.push(payload.actorId);
    actorTypes.push(payload.actorType);
  }

  // Use a CTE-based approach: for each input row, check if the latest snapshot
  // matches. If it does, skip the insert (dedup). Otherwise, compute the next
  // version number and insert.
  const result = await query<DocumentVersionRow>(
    `WITH input_rows AS (
      SELECT
        unnest($1::uuid[]) AS document_id,
        unnest($2::uuid[]) AS branch_id,
        unnest($3::jsonb[]) AS snapshot,
        decode(unnest($4::text[]), 'base64') AS crdt_state,
        unnest($5::uuid[]) AS actor_id,
        unnest($6::text[]) AS actor_type
    ),
    deduped AS (
      SELECT ir.*
      FROM input_rows ir
      LEFT JOIN LATERAL (
        SELECT snapshot FROM app.document_versions
        WHERE document_id = ir.document_id AND branch_id = ir.branch_id
        ORDER BY version_number DESC LIMIT 1
      ) latest ON true
      WHERE latest.snapshot IS DISTINCT FROM ir.snapshot
    )
    INSERT INTO app.document_versions (
      document_id, branch_id, version_number, snapshot, crdt_state,
      source, created_by_id, created_by_type
    )
    SELECT
      d.document_id,
      d.branch_id,
      COALESCE(
        (SELECT MAX(version_number) FROM app.document_versions
         WHERE document_id = d.document_id AND branch_id = d.branch_id),
        0
      ) + ROW_NUMBER() OVER (
        PARTITION BY d.document_id, d.branch_id
        ORDER BY d.document_id
      ),
      d.snapshot,
      d.crdt_state,
      'realtime',
      d.actor_id,
      d.actor_type
    FROM deduped d
    RETURNING *`,
    [documentIds, branchIds, snapshots, crdtStates, actorIds, actorTypes],
  );

  const inserted = result.rows.map(mapRowToDocumentVersion);

  return {
    inserted,
    skippedCount: payloads.length - inserted.length,
  };
}
