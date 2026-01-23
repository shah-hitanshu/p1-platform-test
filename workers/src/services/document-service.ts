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
}

/**
 * Database row format for documents.
 */
interface DocumentRow {
  id: string;
  site_id: string;
  path: string;
  created_at: string;
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

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Maps a database row to a Document domain object.
 */
function mapRowToDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    siteId: row.site_id,
    path: row.path,
    createdAt: row.created_at,
  };
}

/**
 * Validates document path format.
 * - Must not be empty
 * - Must not start with /
 * - Must not end with /
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
): Promise<Document[]> {
  const { limit, offset, pathPrefix } = options;

  let sql = 'SELECT * FROM app.documents WHERE site_id = $1';
  const params: unknown[] = [siteId];

  if (pathPrefix !== undefined && pathPrefix !== '') {
    params.push(pathPrefix + '%');
    sql += ' AND path LIKE $' + String(params.length);
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
       SELECT 1 FROM app.documents WHERE site_id = $1 AND path = $2
     ) as exists`,
    [siteId, path],
  );

  return result.rows[0]?.exists ?? false;
}
