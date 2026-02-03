/**
 * Phase 3.1: Document Service
 *
 * CRUD operations for Documents.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Documents"
 */

import type { Document, Json } from '../types';
import { query } from '../db';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Checks if a snapshot represents a tombstone (deleted document version).
 * Tombstones are marked with { _deleted: true }.
 */
function isTombstoneSnapshot(snapshot: Json): boolean {
  if (typeof snapshot !== 'object' || snapshot === null) {
    return false;
  }
  // Use Object.prototype.hasOwnProperty to check for _deleted property
  // and cast to access the value
  const obj = snapshot as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(obj, '_deleted') && obj._deleted === true;
}

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a new document.
 */
export interface CreateDocumentParams {
  siteId: string;
  path: string;
}

/**
 * Options for listing documents.
 */
export interface ListDocumentsOptions {
  limit?: number;
  offset?: number;
  pathPrefix?: string;
  /** Filter by archived status: true = only archived, false = only non-archived, undefined = non-archived (default) */
  archived?: boolean;
}

/**
 * Database row format for documents.
 */
interface DocumentRow {
  id: string;
  site_id: string;
  path: string;
  created_at: string;
  archived_at: string | null;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when attempting to create a document for a non-existent site.
 */
export class SiteNotFoundError extends Error {
  public readonly name = 'SiteNotFoundError';

  constructor(public readonly siteId: string) {
    super(`Site with ID "${siteId}" not found.`);
    Object.setPrototypeOf(this, SiteNotFoundError.prototype);
  }
}

/**
 * Error thrown when attempting to create a document with a duplicate path.
 */
export class DuplicateDocumentPathError extends Error {
  public readonly name = 'DuplicateDocumentPathError';

  constructor(
    public readonly path: string,
    public readonly siteId?: string,
  ) {
    super(`A document with path "${path}" already exists in this site.`);
    Object.setPrototypeOf(this, DuplicateDocumentPathError.prototype);
  }
}

/**
 * Error thrown when document path is invalid.
 */
export class InvalidDocumentPathError extends Error {
  public readonly name = 'InvalidDocumentPathError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, InvalidDocumentPathError.prototype);
  }
}

/**
 * Error thrown when document is not found.
 */
export class DocumentNotFoundError extends Error {
  public readonly name = 'DocumentNotFoundError';

  constructor(public readonly documentId: string) {
    super(`Document with ID "${documentId}" not found.`);
    Object.setPrototypeOf(this, DocumentNotFoundError.prototype);
  }
}

/**
 * Error thrown when restoring a document but the path is occupied.
 */
export class DocumentPathConflictError extends Error {
  public readonly name = 'DocumentPathConflictError';

  constructor(public readonly path: string) {
    super(`Path "${path}" is occupied by another document.`);
    Object.setPrototypeOf(this, DocumentPathConflictError.prototype);
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extended document type with archivedAt field.
 */
export interface DocumentWithArchive extends Document {
  archivedAt?: string;
}

/**
 * Maps a database row to a Document domain object.
 */
function mapRowToDocument(row: DocumentRow): DocumentWithArchive {
  const doc: DocumentWithArchive = {
    id: row.id,
    siteId: row.site_id,
    path: row.path,
    createdAt: row.created_at,
  };
  if (row.archived_at !== null) {
    doc.archivedAt = row.archived_at;
  }
  return doc;
}

/**
 * Validates document path format.
 * - Must not be empty
 * - Must not start with /
 * - Must not end with /
 * - Must not contain path traversal sequences
 *
 * @throws InvalidDocumentPathError if path is invalid
 */
function validatePath(path: string): void {
  if (!path || path.trim() === '') {
    throw new InvalidDocumentPathError('path cannot be empty');
  }
  if (path.startsWith('/')) {
    throw new InvalidDocumentPathError('path cannot start with /');
  }
  if (path.endsWith('/')) {
    throw new InvalidDocumentPathError('path cannot end with /');
  }
  // Check for path traversal attempts
  if (path.includes('..')) {
    throw new InvalidDocumentPathError('path cannot contain traversal sequences');
  }
}

/**
 * Escapes LIKE pattern special characters in a string.
 * PostgreSQL LIKE treats % as wildcard (any chars) and _ as single char.
 * Backslashes must be escaped first to avoid double-escaping.
 */
function escapeLikePattern(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * Checks if an error is a PostgreSQL unique constraint violation.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === '23505'
  );
}

/**
 * Checks if an error is a PostgreSQL foreign key violation.
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
 * Creates a new document.
 *
 * @param params - Document creation parameters
 * @returns The created document
 * @throws SiteNotFoundError if site does not exist
 * @throws DuplicateDocumentPathError if path already exists in site
 * @throws InvalidDocumentPathError if path format is invalid
 */
export async function createDocument(
  params: CreateDocumentParams,
): Promise<Document> {
  validatePath(params.path);

  try {
    const result = await query<DocumentRow>(
      `INSERT INTO app.documents (site_id, path)
       VALUES ($1, $2)
       RETURNING *`,
      [params.siteId, params.path],
    );

    return mapRowToDocument(result.rows[0]);
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new SiteNotFoundError(params.siteId);
    }
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateDocumentPathError(params.path, params.siteId);
    }
    throw error;
  }
}

/**
 * Retrieves a document by its ID.
 *
 * @param documentId - The document ID
 * @returns The document or null if not found
 */
export async function getDocument(documentId: string): Promise<Document | null> {
  const result = await query<DocumentRow>(
    'SELECT * FROM app.documents WHERE id = $1',
    [documentId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToDocument(result.rows[0]);
}

/**
 * Retrieves a document by its path within a site.
 *
 * @param siteId - The site ID
 * @param path - The document path
 * @returns The document or null if not found
 */
export async function getDocumentByPath(
  siteId: string,
  path: string,
): Promise<Document | null> {
  // Order by archived_at NULLS FIRST to prefer non-archived documents
  // This ensures if both an archived and non-archived document exist with the same path,
  // we return the non-archived one
  const result = await query<DocumentRow>(
    `SELECT * FROM app.documents
     WHERE site_id = $1 AND path = $2
     ORDER BY archived_at NULLS FIRST
     LIMIT 1`,
    [siteId, path],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToDocument(result.rows[0]);
}

/**
 * Updates a document's path.
 *
 * @param documentId - The document ID
 * @param newPath - The new path
 * @returns The updated document or null if not found
 * @throws DuplicateDocumentPathError if new path already exists
 * @throws InvalidDocumentPathError if path format is invalid
 */
export async function updateDocumentPath(
  documentId: string,
  newPath: string,
): Promise<Document | null> {
  validatePath(newPath);

  try {
    const result = await query<DocumentRow>(
      `UPDATE app.documents
       SET path = $1
       WHERE id = $2
       RETURNING *`,
      [newPath, documentId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return mapRowToDocument(result.rows[0]);
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateDocumentPathError(newPath);
    }
    throw error;
  }
}

/**
 * Deletes a document.
 *
 * @param documentId - The document ID
 * @returns True if deleted, false if not found
 */
export async function deleteDocument(documentId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM app.documents WHERE id = $1',
    [documentId],
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Lists documents in a site with optional filtering and pagination.
 *
 * @param siteId - The site ID
 * @param options - Filtering and pagination options
 * @returns Array of documents
 */
export async function listDocuments(
  siteId: string,
  options: ListDocumentsOptions = {},
): Promise<DocumentWithArchive[]> {
  const { limit, offset, pathPrefix, archived } = options;

  let sql = 'SELECT * FROM app.documents WHERE site_id = $1';
  const params: unknown[] = [siteId];

  // Filter by archived status
  if (archived === true) {
    sql += ' AND archived_at IS NOT NULL';
  } else {
    // Default: only non-archived documents (archived is false or undefined)
    sql += ' AND archived_at IS NULL';
  }

  if (pathPrefix !== undefined && pathPrefix !== '') {
    // Escape LIKE wildcards to prevent injection, then add trailing % for prefix match
    params.push(escapeLikePattern(pathPrefix) + '%');
    sql += ' AND path LIKE $' + String(params.length) + " ESCAPE '\\'";
  }

  sql += ' ORDER BY path ASC';

  if (limit !== undefined) {
    params.push(limit);
    sql += ' LIMIT $' + String(params.length);
  }

  if (offset !== undefined) {
    params.push(offset);
    sql += ' OFFSET $' + String(params.length);
  }

  const result = await query<DocumentRow>(sql, params);

  return result.rows.map(mapRowToDocument);
}

/**
 * Checks if a document exists at a given path in a site.
 *
 * @param siteId - The site ID
 * @param path - The document path
 * @returns True if document exists, false otherwise
 */
export async function documentExists(
  siteId: string,
  path: string,
): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM app.documents WHERE site_id = $1 AND path = $2 AND archived_at IS NULL
     ) as exists`,
    [siteId, path],
  );

  return result.rows[0]?.exists ?? false;
}

/**
 * Archives (soft-deletes) a document.
 * The document path becomes available for reuse after archival.
 *
 * @param documentId - The document ID
 * @returns True if archived, false if not found
 */
export async function archiveDocument(documentId: string): Promise<boolean> {
  const result = await query(
    `UPDATE app.documents
     SET archived_at = NOW()
     WHERE id = $1 AND archived_at IS NULL`,
    [documentId],
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Restores an archived document.
 *
 * @param documentId - The document ID
 * @returns The restored document
 * @throws DocumentNotFoundError if document doesn't exist or isn't archived
 * @throws DocumentPathConflictError if path is now occupied by another document
 */
export async function restoreDocument(documentId: string): Promise<DocumentWithArchive> {
  // First, get the document to check if it exists and is archived
  const docResult = await query<DocumentRow>(
    'SELECT * FROM app.documents WHERE id = $1',
    [documentId],
  );

  if (docResult.rows.length === 0) {
    throw new DocumentNotFoundError(documentId);
  }

  const doc = docResult.rows[0];

  if (doc.archived_at === null) {
    throw new DocumentNotFoundError(documentId);
  }

  // Check if the path is now occupied by another non-archived document
  const pathConflict = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM app.documents
       WHERE site_id = $1 AND path = $2 AND id != $3 AND archived_at IS NULL
     ) as exists`,
    [doc.site_id, doc.path, documentId],
  );

  if (pathConflict.rows[0]?.exists === true) {
    throw new DocumentPathConflictError(doc.path);
  }

  // Restore the document
  const result = await query<DocumentRow>(
    `UPDATE app.documents
     SET archived_at = NULL
     WHERE id = $1
     RETURNING *`,
    [documentId],
  );

  return mapRowToDocument(result.rows[0]);
}

// =============================================================================
// Branch-Scoped Document Operations
// =============================================================================

/**
 * Options for listing documents on a branch.
 */
export interface ListDocumentsOnBranchOptions {
  pathPrefix?: string;
}

/**
 * Parameters for creating a document on a branch.
 */
export interface CreateDocumentOnBranchParams {
  siteId: string;
  branchId: string;
  path: string;
  snapshot?: Record<string, unknown>;
  createdById: string;
  createdByType: 'user' | 'agent';
}

/**
 * Result of creating a document on a branch.
 */
export interface CreateDocumentOnBranchResult {
  document: Document;
  version: DocumentVersion;
}

/**
 * Parameters for deleting a document on a branch (tombstone).
 */
export interface DeleteDocumentOnBranchParams {
  documentId: string;
  branchId: string;
  deletedById: string;
  deletedByType: 'user' | 'agent';
}

/**
 * Document version type for internal use.
 */
interface DocumentVersion {
  id: string;
  documentId: string;
  branchId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
  crdtState?: string;
  source: string;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  createdAt: string;
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
  source: string;
  created_by_id: string;
  created_by_type: 'user' | 'agent' | 'system';
  created_at: string;
}

/**
 * Maps a database row to a DocumentVersion object.
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
 * Lists documents that have versions on a specific branch.
 * Excludes documents that have been tombstoned (deleted) on the branch.
 *
 * @param branchId - The branch ID
 * @param options - Filtering options
 * @returns Array of documents
 */
export async function listDocumentsOnBranch(
  branchId: string,
  options: ListDocumentsOnBranchOptions = {},
): Promise<DocumentWithArchive[]> {
  const { pathPrefix } = options;

  let sql = `
    SELECT DISTINCT d.*
    FROM app.documents d
    INNER JOIN app.document_versions dv ON dv.document_id = d.id
    WHERE dv.branch_id = $1
      AND d.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM app.document_versions dv2
        WHERE dv2.document_id = d.id
          AND dv2.branch_id = $1
          AND dv2.snapshot->>'_deleted' = 'true'
          AND dv2.version_number = (
            SELECT MAX(dv3.version_number)
            FROM app.document_versions dv3
            WHERE dv3.document_id = d.id AND dv3.branch_id = $1
          )
      )`;

  const params: unknown[] = [branchId];

  if (pathPrefix !== undefined && pathPrefix !== '') {
    params.push(escapeLikePattern(pathPrefix) + '%');
    sql += ` AND d.path LIKE $${String(params.length)} ESCAPE '\\\\'`;
  }

  sql += ' ORDER BY d.path ASC';

  const result = await query<DocumentRow>(sql, params);

  return result.rows.map(mapRowToDocument);
}

/**
 * Creates a document and its initial version on a branch atomically.
 * If the document path already exists (site-level), reuses the existing document
 * and creates a new version on the branch.
 *
 * @param params - Document creation parameters
 * @returns The created document and version
 * @throws SiteNotFoundError if site does not exist
 * @throws InvalidDocumentPathError if path format is invalid
 */
export async function createDocumentOnBranch(
  params: CreateDocumentOnBranchParams,
): Promise<CreateDocumentOnBranchResult> {
  validatePath(params.path);

  try {
    await query('BEGIN');

    let document: Document;
    let isRecreation = false;

    // Try to create the document using SAVEPOINT to handle unique constraint violations
    // PostgreSQL aborts transactions on errors, so we need SAVEPOINT to recover
    await query('SAVEPOINT insert_doc');
    try {
      const docResult = await query<DocumentRow>(
        `INSERT INTO app.documents (site_id, path)
         VALUES ($1, $2)
         RETURNING *`,
        [params.siteId, params.path],
      );
      await query('RELEASE SAVEPOINT insert_doc');
      document = mapRowToDocument(docResult.rows[0]);
    } catch (docError) {
      // Rollback to savepoint to clear the error state and allow further queries
      await query('ROLLBACK TO SAVEPOINT insert_doc');

      // If document already exists, find it
      if (isUniqueConstraintViolation(docError)) {
        const existingResult = await query<DocumentRow>(
          `SELECT * FROM app.documents
           WHERE site_id = $1 AND path = $2 AND archived_at IS NULL`,
          [params.siteId, params.path],
        );
        if (existingResult.rows.length === 0) {
          await query('ROLLBACK');
          throw new DuplicateDocumentPathError(params.path, params.siteId);
        }
        document = mapRowToDocument(existingResult.rows[0]);

        // Check if the latest version on this branch is a tombstone
        // If so, this is a recreation - we should start fresh
        const latestVersionResult = await query<DocumentVersionRow>(
          `SELECT * FROM app.document_versions
           WHERE document_id = $1 AND branch_id = $2
           ORDER BY version_number DESC
           LIMIT 1`,
          [document.id, params.branchId],
        );

        if (latestVersionResult.rows.length > 0) {
          const latestVersion = latestVersionResult.rows[0];
          const snapshot = latestVersion.snapshot;
          if (isTombstoneSnapshot(snapshot)) {
            // This is a recreation after tombstone - delete all versions on this branch
            // to start fresh with version 1
            await query(
              `DELETE FROM app.document_versions
               WHERE document_id = $1 AND branch_id = $2`,
              [document.id, params.branchId],
            );
            isRecreation = true;
          } else {
            // Document exists and is not tombstoned - this is a duplicate
            await query('ROLLBACK');
            throw new DuplicateDocumentPathError(params.path, params.siteId);
          }
        }
        // If no versions exist on this branch, it's fine to create version 1
      } else if (isForeignKeyViolation(docError)) {
        await query('ROLLBACK');
        throw new SiteNotFoundError(params.siteId);
      } else {
        throw docError;
      }
    }

    // Create the initial version with provided snapshot or empty object
    // After deletion of tombstoned versions, this will be version 1
    const versionResult = await query<DocumentVersionRow>(
      `INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot, crdt_state,
        source, created_by_id, created_by_type
      )
      SELECT $1, $2,
        COALESCE(MAX(version_number), 0) + 1,
        $3, NULL, $4, $5, $6
      FROM app.document_versions
      WHERE document_id = $1 AND branch_id = $2
      RETURNING *`,
      [
        document.id,
        params.branchId,
        params.snapshot ?? {},
        isRecreation ? 'recreate' : 'edit',
        params.createdById,
        params.createdByType,
      ],
    );

    await query('COMMIT');

    return {
      document,
      version: mapRowToDocumentVersion(versionResult.rows[0]),
    };
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}

/**
 * Checks if a document exists (has a non-tombstoned version) on a branch.
 *
 * @param documentId - The document ID
 * @param branchId - The branch ID
 * @returns True if document exists on branch and is not tombstoned
 */
export async function documentExistsOnBranch(
  documentId: string,
  branchId: string,
): Promise<boolean> {
  // Check if document has any version on this branch where:
  // 1. The latest version is NOT a tombstone (snapshot->>'_deleted' != 'true')
  // Note: We need COALESCE because NULL = 'true' returns NULL in SQL, not false
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM app.document_versions dv
       WHERE dv.document_id = $1
         AND dv.branch_id = $2
         AND dv.version_number = (
           SELECT MAX(dv2.version_number)
           FROM app.document_versions dv2
           WHERE dv2.document_id = $1 AND dv2.branch_id = $2
         )
         AND COALESCE(dv.snapshot->>'_deleted', '') != 'true'
     ) as exists`,
    [documentId, branchId],
  );

  return result.rows[0]?.exists ?? false;
}

/**
 * Soft-deletes a document on a branch by creating a tombstone version.
 * The document remains visible on other branches.
 *
 * @param params - Delete parameters
 * @returns True if tombstone created successfully
 * @throws DocumentNotFoundError if document does not exist
 */
export async function deleteDocumentOnBranch(
  params: DeleteDocumentOnBranchParams,
): Promise<boolean> {
  try {
    await query<DocumentVersionRow>(
      `INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot, crdt_state,
        source, created_by_id, created_by_type
      )
      SELECT $1, $2,
        COALESCE(MAX(version_number), 0) + 1,
        $3, NULL, $4, $5, $6
      FROM app.document_versions
      WHERE document_id = $1 AND branch_id = $2
      RETURNING *`,
      [
        params.documentId,
        params.branchId,
        { _deleted: true },
        'edit',
        params.deletedById,
        params.deletedByType,
      ],
    );

    return true;
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new DocumentNotFoundError(params.documentId);
    }
    throw error;
  }
}
