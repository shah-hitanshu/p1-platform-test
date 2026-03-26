/**
 * Phase 3.1: Document Service
 *
 * Site-level CRUD operations for Documents.
 * Branch-scoped operations are in branch-document-service.ts,
 * types/errors/helpers in document-types.ts.
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Documents"
 */

import type { Document } from '../types';
import { query } from '../db';
import type { DocumentRow, ListDocumentsOptions } from './document-types';
import {
  mapRowToDocument,
  validatePath,
  escapeLikePattern,
  isUniqueConstraintViolation,
  isForeignKeyViolation,
  SiteNotFoundError,
  DuplicateDocumentPathError,
  DocumentNotFoundError,
  DocumentPathConflictError,
} from './document-types';
import type { DocumentWithArchive } from './document-types';

// =============================================================================
// Re-exports for backward compatibility
// =============================================================================

// Re-export everything from document-types
export {
  SiteNotFoundError,
  DuplicateDocumentPathError,
  InvalidDocumentPathError,
  DocumentNotFoundError,
  DocumentPathConflictError,
  isTombstoneRow,
  mapRowToDocumentOnBranch,
  mapRowToDocument,
  validatePath,
  escapeLikePattern,
  isUniqueConstraintViolation,
  isForeignKeyViolation,
  mapRowToDocumentVersion,
} from './document-types';

export type {
  CreateDocumentParams,
  ListDocumentsOptions,
  DocumentRow,
  DocumentOnBranchRow,
  DocumentWithArchive,
  DocumentOnBranch,
  ListDocumentsOnBranchOptions,
  CreateDocumentOnBranchParams,
  CreateDocumentOnBranchResult,
  DeleteDocumentOnBranchParams,
  DocumentVersion,
  DocumentVersionRow,
} from './document-types';

// Re-export everything from branch-document-service
export {
  listDocumentsOnBranch,
  createDocumentOnBranch,
  documentExistsOnBranch,
  deleteDocumentOnBranch,
} from './branch-document-service';

// =============================================================================
// Site-Level Service Functions
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
  params: { siteId: string; path: string },
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
 * Deprecated: prefer deleteDocumentOnBranch with tombstone versions.
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
 * Deprecated: prefer createDocumentOnBranch to recreate after tombstone.
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
