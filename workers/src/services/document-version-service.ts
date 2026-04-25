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
import { compare as jsonPatchCompare, applyPatch } from 'fast-json-patch';

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
  patch?: unknown[]; // RFC 6902 JSON Patch operations
  source: DocumentVersionSource;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  actionType?: string; // Puck action type (e.g., "insert", "reorder", "set")
  actionMetadata?: Record<string, unknown>; // Additional Puck action context
  /**
   * Skip duplicate snapshot check and always create a new version.
   * Use for reverts or explicit version creation where duplicates are intentional.
   * @default false
   */
  skipDuplicateCheck?: boolean;
  /** Mark this version as a tombstone (document deletion). */
  isTombstone?: boolean;
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
  snapshot: Record<string, unknown> | null;
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
  patch: import('fast-json-patch').Operation[] | null;
  action_type: string | null;
  action_metadata: Record<string, unknown> | null;
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
    snapshot: row.snapshot ?? undefined,
    patch: row.patch ?? undefined,
    actionType: row.action_type ?? undefined,
    actionMetadata: row.action_metadata ?? undefined,
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
  let latestVersion: DocumentVersion | null = null;
  if (params.skipDuplicateCheck !== true) {
    latestVersion = await getLatestDocumentVersion(
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

  // Compute forward diff from previous version to new version.
  // The diff is stored on the NEW version (patch = how to get from previous to this).
  // The previous version's snapshot is nulled (unless it's v1, the permanent baseline).
  // Both operations use a single CTE for atomicity — if the INSERT fails, the
  // UPDATE rolls back too.
  if (latestVersion === null && params.skipDuplicateCheck !== true) {
    latestVersion = await getLatestDocumentVersion(
      params.documentId,
      params.branchId,
    );
  }

  let forwardPatch: unknown[] | null = null;
  if (latestVersion?.snapshot != null) {
    try {
      const patchOps = jsonPatchCompare(
        latestVersion.snapshot,
        params.snapshot,
      );
      if (patchOps.length > 0) {
        forwardPatch = patchOps;
      }
    } catch (diffError) {
      // If diff computation fails, proceed with full baseline — no data loss
      console.warn('Failed to compute diff, storing full baseline:', diffError);
    }
  }

  try {
    // Use a CTE to atomically:
    // 1. Null previous version's snapshot (convert to diff-only) — skip v1 (permanent baseline)
    // 2. Insert new version as baseline with full snapshot + forward patch
    const shouldNullPrevious = latestVersion != null
      && latestVersion.versionNumber > 1
      && forwardPatch != null;

    const result = await query<DocumentVersionRow>(
      `WITH nullify_previous AS (
        UPDATE app.document_versions
        SET snapshot = NULL
        WHERE id = $11::uuid
          AND $12::boolean = true
        RETURNING id
      )
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        patch, action_type, action_metadata,
        source, created_by_id, created_by_type, is_tombstone
      )
      SELECT $1, $2,
        COALESCE(MAX(version_number), 0) + 1,
        $3,
        $4, $5, $6,
        $7, $8, $9, $10
      FROM app.document_versions
      WHERE document_id = $1 AND branch_id = $2
      RETURNING *`,
      [
        params.documentId,
        params.branchId,
        params.snapshot,
        forwardPatch ? JSON.stringify(forwardPatch) : (params.patch ? JSON.stringify(params.patch) : null),
        params.actionType ?? null,
        params.actionMetadata ? JSON.stringify(params.actionMetadata) : null,
        params.source,
        params.createdById,
        params.createdByType,
        params.isTombstone === true,
        shouldNullPrevious && latestVersion
          ? latestVersion.id
          : '00000000-0000-0000-0000-000000000000',
        shouldNullPrevious,
      ],
    );

    const newVersion = mapRowToDocumentVersion(getFirstRow(result.rows));
    if (forwardPatch && latestVersion) {
      console.log(
        `Created v${String(newVersion.versionNumber)} with `
        + `${String(forwardPatch.length)} patch ops, `
        + `nulled v${String(latestVersion.versionNumber)} snapshot`,
      );
    }

    return newVersion;
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
         JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
         WHERE cd.document_version_id = dv.id
           AND cp.checkpoint_type = 'publish'
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
         JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
         WHERE cd.document_version_id = dv.id
           AND cp.checkpoint_type = 'publish'
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
       AND cp.checkpoint_type = 'publish'
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
         JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
         WHERE cd.document_version_id = dv.id
           AND cp.checkpoint_type = 'publish'
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
// Version Snapshot Reconstruction
// =============================================================================

/**
 * Reconstructs the full snapshot for a given version by finding the nearest
 * baseline (a version with a non-null snapshot) and applying all intermediate
 * RFC 6902 JSON patches forward.
 *
 * @param documentId - The document ID
 * @param branchId - The branch ID
 * @param versionNumber - The version number to reconstruct
 * @returns The reconstructed snapshot, or null if the version or baseline is not found
 */
export async function reconstructVersionSnapshot(
  documentId: string,
  branchId: string,
  versionNumber: number,
): Promise<Record<string, unknown> | null> {
  // 1. Get the requested version
  const version = await getDocumentVersionByNumber(documentId, branchId, versionNumber);
  if (!version) return null;

  // If it's a baseline (has snapshot), return directly
  if (version.snapshot) return version.snapshot;

  // 2. Find nearest baseline at or before this version
  const baselineResult = await query<DocumentVersionRow>(
    `SELECT * FROM app.document_versions
     WHERE document_id = $1 AND branch_id = $2 AND version_number <= $3 AND snapshot IS NOT NULL
     ORDER BY version_number DESC LIMIT 1`,
    [documentId, branchId, versionNumber],
  );

  const baseline = baselineResult.rows[0];
  if (!baseline?.snapshot) return null;

  // 3. Load all diff versions between baseline and requested version (exclusive baseline, inclusive target)
  const diffsResult = await query<DocumentVersionRow>(
    `SELECT * FROM app.document_versions
     WHERE document_id = $1 AND branch_id = $2
       AND version_number > $3 AND version_number <= $4
     ORDER BY version_number ASC`,
    [documentId, branchId, baseline.version_number, versionNumber],
  );

  // 4. Apply patches forward — each version's patch is the forward diff from its predecessor
  let snapshot: Record<string, unknown> = typeof baseline.snapshot === 'string'
    ? JSON.parse(baseline.snapshot) as Record<string, unknown>
    : structuredClone(baseline.snapshot);
  for (const diffRow of diffsResult.rows) {
    if (diffRow.patch) {
      const ops = typeof diffRow.patch === 'string'
        ? JSON.parse(diffRow.patch) as import('fast-json-patch').Operation[]
        : diffRow.patch;
      const patchResult = applyPatch(snapshot, ops, false, false);
      snapshot = patchResult.newDocument;
    }
  }

  return snapshot;
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
  actorId: string;
  actorType: 'user' | 'agent';
  patch?: unknown[]; // RFC 6902 JSON Patch operations
  actionType?: string; // Puck action type
  actionMetadata?: Record<string, unknown>; // Puck action context
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
  const documentIds: string[] = [];
  const branchIds: string[] = [];
  const snapshots: (Record<string, unknown>)[] = [];
  const actorIds: string[] = [];
  const actorTypes: string[] = [];
  const actionTypes: (string | null)[] = [];
  const actionMetadatas: (string | null)[] = [];

  for (const payload of payloads) {
    documentIds.push(payload.documentId);
    branchIds.push(payload.branchId);
    snapshots.push(payload.snapshot);
    actorIds.push(payload.actorId);
    actorTypes.push(payload.actorType);
    actionTypes.push(payload.actionType ?? null);
    actionMetadatas.push(payload.actionMetadata ? JSON.stringify(payload.actionMetadata) : null);
  }

  // Use a CTE-based approach: for each input row, check if the latest snapshot
  // matches. If it does, skip the insert (dedup). Otherwise, compute the next
  // version number and insert as a baseline (full snapshot).
  const result = await query<DocumentVersionRow>(
    `WITH input_rows AS (
      SELECT
        unnest($1::uuid[]) AS document_id,
        unnest($2::uuid[]) AS branch_id,
        unnest($3::jsonb[]) AS snapshot,
        unnest($4::uuid[]) AS actor_id,
        unnest($5::text[]) AS actor_type,
        unnest($6::text[]) AS action_type,
        unnest($7::jsonb[]) AS action_metadata
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
      document_id, branch_id, version_number, snapshot,
      action_type, action_metadata,
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
      d.action_type,
      d.action_metadata,
      'realtime',
      d.actor_id,
      d.actor_type
    FROM deduped d
    RETURNING *`,
    [documentIds, branchIds, snapshots, actorIds, actorTypes, actionTypes, actionMetadatas],
  );

  const inserted = result.rows.map(mapRowToDocumentVersion);

  // Post-insert: compute forward diffs and convert previous versions.
  // For each inserted version:
  // 1. Compute forward patch from previous version's snapshot → this version's snapshot
  // 2. Store the forward patch on THIS version (patch = how to get from prev to this)
  // 3. Null previous version's snapshot (unless it's v1, the permanent baseline)
  for (const insertedVersion of inserted) {
    try {
      const prevResult = await query<DocumentVersionRow>(
        `SELECT * FROM app.document_versions
         WHERE document_id = $1 AND branch_id = $2 AND version_number = $3`,
        [insertedVersion.documentId, insertedVersion.branchId, insertedVersion.versionNumber - 1],
      );
      const prevRow = prevResult.rows[0];
      if (prevRow?.snapshot != null && insertedVersion.snapshot != null) {
        const patchOps = jsonPatchCompare(
          prevRow.snapshot,
          insertedVersion.snapshot,
        );
        if (patchOps.length > 0) {
          // Store forward patch on the NEW version, null previous snapshot atomically
          const shouldNullPrev = prevRow.version_number > 1;
          await query(
            `WITH update_new AS (
              UPDATE app.document_versions SET patch = $1 WHERE id = $2
            )
            UPDATE app.document_versions SET snapshot = NULL
            WHERE id = $3 AND $4::boolean = true`,
            [
              JSON.stringify(patchOps),
              insertedVersion.id,
              prevRow.id,
              shouldNullPrev,
            ],
          );
        }
      }
    } catch (diffError) {
      // If diff conversion fails, both versions keep full snapshots — no data loss
      console.warn('batchSync: failed to convert previous version to diff:', diffError);
    }
  }

  return {
    inserted,
    skippedCount: payloads.length - inserted.length,
  };
}
