/**
 * Phase 3.1: Document Service
 *
 * CRUD operations for Documents.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Documents"
 */

import type { Document } from '../types';
import { query } from '../db';

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
 * Escapes LIKE pattern special characters (% and _) in a string.
 * PostgreSQL LIKE treats % as wildcard (any chars) and _ as single char.
 */
function escapeLikePattern(input: string): string {
  return input.replace(/%/g, '\\%').replace(/_/g, '\\_');
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
  const result = await query<DocumentRow>(
    'SELECT * FROM app.documents WHERE site_id = $1 AND path = $2',
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
