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
  return {
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
    'SELECT * FROM app.document_versions WHERE id = $1',
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
    `SELECT * FROM app.document_versions
     WHERE document_id = $1 AND branch_id = $2
     ORDER BY version_number DESC
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

  let sql = `SELECT * FROM app.document_versions
             WHERE document_id = $1 AND branch_id = $2
             ORDER BY version_number DESC`;
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
