/**
 * Phase 3.1: Document Service
 *
 * Site-level CRUD operations for Documents.
 * Branch-scoped operations are in branch-document-service.ts,
 * types/errors/helpers in document-types.ts.
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Documents"
 */

import { query } from '../db';
import type { DocumentRow, ListDocumentsOptions } from './document-types';
import {
  mapRowToDocument,
  normalizePath,
  validatePath,
  escapeLikePattern,
  isUniqueConstraintViolation,
  isForeignKeyViolation,
} from './document-types';
import {
  SiteNotFoundError,
  DuplicateDocumentPathError,
  DocumentNotFoundError,
  DocumentPathConflictError,
} from './errors';
import type { DocumentWithArchive, MoveResult } from './document-types';
import { TEMPLATE_RELATION_JOIN, DOCUMENT_WITH_TEMPLATE_COLUMNS } from './document-queries';
import { validateLocale } from './locale';
import { getMainBranch } from './branch-service';
import { planMove, assertPathFreeOnBranch } from './branch-document-service';

// =============================================================================
// Re-exports for backward compatibility
// =============================================================================

// Re-export everything from document-types
export {
  isTombstoneRow,
  mapRowToDocumentOnBranch,
  mapRowToDocument,
  normalizePath,
  validatePath,
  escapeLikePattern,
  isUniqueConstraintViolation,
  isForeignKeyViolation,
  mapRowToDocumentVersion,
} from './document-types';

export {
  SiteNotFoundError,
  DuplicateDocumentPathError,
  InvalidDocumentPathError,
  DocumentNotFoundError,
  DocumentPathConflictError,
  PageConflictError,
} from './errors';

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
  listTemplatesOnBranch,
  createDocumentOnBranch,
  documentExistsOnBranch,
  deleteDocumentOnBranch,
  deleteDocumentWithRedirect,
} from './branch-document-service';

export type {
  DeleteDocumentWithRedirectParams,
  DeleteDocumentWithRedirectResult,
  MoveResult,
} from './document-types';

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
): Promise<DocumentWithArchive> {
  const normalizedPath = normalizePath(params.path);
  validatePath(normalizedPath);

  try {
    const result = await query<DocumentRow>(
      `INSERT INTO app.documents (site_id, path)
       VALUES ($1, $2)
       RETURNING *`,
      [params.siteId, normalizedPath],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to insert document');
    }

    return mapRowToDocument(row);
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new SiteNotFoundError(params.siteId);
    }
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateDocumentPathError(normalizedPath, params.siteId);
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
export async function getDocument(documentId: string): Promise<DocumentWithArchive | null> {
  const result = await query<DocumentRow>(
    `SELECT ${DOCUMENT_WITH_TEMPLATE_COLUMNS}
     FROM app.documents d
     ${TEMPLATE_RELATION_JOIN}
     WHERE d.id = $1`,
    [documentId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return mapRowToDocument(row);
}

/**
 * Retrieves a document by its path within a site.
 *
 * With a branchId, resolves against that branch's effective paths
 *
 * @param siteId - The site ID
 * @param path - The document path (will be normalized)
 * @param branchId - Resolve against this branch's path overrides
 * @returns The document (carrying its effective path) or null if not found
 */
export async function getDocumentByPath(
  siteId: string,
  path: string,
  branchId?: string,
): Promise<DocumentWithArchive | null> {
  const normalizedPath = normalizePath(path);

  // Only return non-archived documents
  // Archived documents with the same path are considered deleted and should not be returned
  if (branchId === undefined) {
    const result = await query<DocumentRow>(
      `SELECT ${DOCUMENT_WITH_TEMPLATE_COLUMNS}
       FROM app.documents d
       ${TEMPLATE_RELATION_JOIN}
       WHERE d.site_id = $1 AND d.path = $2 AND d.archived_at IS NULL
       LIMIT 1`,
      [siteId, normalizedPath],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return mapRowToDocument(row);
  }

  // Two index probes rather than one COALESCE(bdp.path, d.path) = $2 predicate:
  // that form is unindexable, so it scans the whole site on every lookup and on
  // every 404. This is the hottest query in the system — keep both paths O(1).
  const override = await query<DocumentRow>(
    `SELECT ${DOCUMENT_WITH_TEMPLATE_COLUMNS}
     FROM app.branch_document_paths bdp
     JOIN app.documents d ON d.id = bdp.document_id
     ${TEMPLATE_RELATION_JOIN}
     WHERE bdp.branch_id = $3
       AND bdp.path = $2
       AND d.site_id = $1
       AND d.archived_at IS NULL
     LIMIT 1`,
    [siteId, normalizedPath, branchId],
  );

  const overrideRow = override.rows[0];
  if (overrideRow) {
    return { ...mapRowToDocument(overrideRow), path: normalizedPath };
  }

  // No override claims this path, so the global path answers — unless the
  // document moved away from it on this branch, which the NOT EXISTS excludes.
  const result = await query<DocumentRow>(
    `SELECT ${DOCUMENT_WITH_TEMPLATE_COLUMNS}
     FROM app.documents d
     ${TEMPLATE_RELATION_JOIN}
     WHERE d.site_id = $1
       AND d.path = $2
       AND d.archived_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM app.branch_document_paths bdp
         WHERE bdp.branch_id = $3 AND bdp.document_id = d.id
       )
     LIMIT 1`,
    [siteId, normalizedPath, branchId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return { ...mapRowToDocument(row), path: normalizedPath };
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
): Promise<DocumentWithArchive | null> {
  return await updateDocumentFields(documentId, { path: newPath });
}

/**
 * Updates a document's path, its locale, or both in one statement. A field left
 * undefined keeps its stored value; a `locale` of null clears it, leaving the
 * document naming no language. Null when the document does not exist.
 *
 * @throws DuplicateDocumentPathError if the new path already exists
 * @throws InvalidDocumentPathError if the path format is invalid
 * @throws InvalidLocaleError if the locale is not a well-formed language tag
 */
export async function updateDocumentFields(
  documentId: string,
  fields: { path?: string; locale?: string | null },
): Promise<DocumentWithArchive | null> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  let normalizedPath: string | undefined;

  if (fields.path !== undefined) {
    normalizedPath = normalizePath(fields.path);
    validatePath(normalizedPath);
    values.push(normalizedPath);
    assignments.push(`path = $${String(values.length)}`);
  }

  if (fields.locale !== undefined) {
    values.push(fields.locale === null ? null : validateLocale(fields.locale));
    assignments.push(`locale = $${String(values.length)}`);
  }

  if (assignments.length === 0) {
    return await getDocument(documentId);
  }

  values.push(documentId);

  try {
    const result = await query<DocumentRow>(
      `WITH upd AS (
         UPDATE app.documents
         SET ${assignments.join(', ')}
         WHERE id = $${String(values.length)}
         RETURNING *
       )
       SELECT ${DOCUMENT_WITH_TEMPLATE_COLUMNS}
       FROM upd d
       ${TEMPLATE_RELATION_JOIN}`,
      values,
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return mapRowToDocument(row);
  } catch (error) {
    if (isUniqueConstraintViolation(error) && normalizedPath !== undefined) {
      throw new DuplicateDocumentPathError(normalizedPath);
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

  let sql = `SELECT ${DOCUMENT_WITH_TEMPLATE_COLUMNS}
     FROM app.documents d
     ${TEMPLATE_RELATION_JOIN}
     WHERE d.site_id = $1`;
  const params: unknown[] = [siteId];

  // Filter by archived status
  if (archived === true) {
    sql += ' AND d.archived_at IS NOT NULL';
  } else {
    // Default: only non-archived documents (archived is false or undefined)
    sql += ' AND d.archived_at IS NULL';
  }

  if (pathPrefix !== undefined && pathPrefix !== '') {
    // Normalize prefix to match stored paths, then escape LIKE wildcards
    const normalizedPrefix = normalizePath(pathPrefix);
    params.push(escapeLikePattern(normalizedPrefix) + '%');
    sql += ' AND d.path LIKE $' + String(params.length) + " ESCAPE '\\'";
  }

  sql += ' ORDER BY d.path ASC';

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
  const normalizedPath = normalizePath(path);
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM app.documents WHERE site_id = $1 AND path = $2 AND archived_at IS NULL
     ) as exists`,
    [siteId, normalizedPath],
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

  const doc = docResult.rows[0];
  if (!doc) {
    throw new DocumentNotFoundError(documentId);
  }

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
    `WITH upd AS (
       UPDATE app.documents
       SET archived_at = NULL
       WHERE id = $1
       RETURNING *
     )
     SELECT ${DOCUMENT_WITH_TEMPLATE_COLUMNS}
     FROM upd d
     ${TEMPLATE_RELATION_JOIN}`,
    [documentId],
  );

  const restoredRow = result.rows[0];
  if (!restoredRow) {
    throw new DocumentNotFoundError(documentId);
  }

  return mapRowToDocument(restoredRow);
}

/**
 * Moves a document on the main branch by rewriting global paths, so the move shows
 * up on every branch that has not overridden the path. Descendants, section content
 * pages, and locale variants move with it.
 *
 * @param documentId - The document to move
 * @param newPath - The destination path (will be normalized)
 * @returns The number of documents moved, counting the cascade
 * @throws DocumentNotFoundError if the document is missing or archived, or its site has no main branch
 * @throws DuplicateDocumentPathError if any destination path is occupied
 * @throws InvalidDocumentPathError if the path format is invalid
 * @throws SelfNestingMoveError if the destination sits inside the document's own subtree
 * @throws ImmovableDocumentError if the document is at the site root
 */
export async function moveDocumentGlobally(
  documentId: string,
  newPath: string,
): Promise<MoveResult> {
  const normalized = normalizePath(newPath);
  validatePath(normalized);

  const docRow = await query<{ site_id: string; path: string }>(
    'SELECT site_id, path FROM app.documents WHERE id = $1 AND archived_at IS NULL',
    [documentId],
  );
  const doc = docRow.rows[0];
  if (!doc) {
    throw new DocumentNotFoundError(documentId);
  }

  const mainBranch = await getMainBranch(doc.site_id);
  if (!mainBranch) {
    throw new DocumentNotFoundError(documentId);
  }

  await query('BEGIN');
  try {
    await query('SELECT pg_advisory_xact_lock(hashtext($1))', [mainBranch.id]);

    const planned = await planMove(mainBranch.id, doc.site_id, documentId, doc.path, normalized);
    await assertPathFreeOnBranch(
      mainBranch.id,
      doc.site_id,
      planned.map((p) => p.documentId),
      planned.map((p) => p.newPath),
    );

    await query(
      `UPDATE app.documents d
       SET path = m.path
       FROM unnest($1::uuid[], $2::text[]) AS m(document_id, path)
       WHERE d.id = m.document_id`,
      [
        planned.map((move) => move.documentId),
        planned.map((move) => normalizePath(move.newPath)),
      ],
    );

    await query('COMMIT');
    return { movedCount: planned.length };
  } catch (error) {
    await query('ROLLBACK');
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateDocumentPathError(normalized);
    }
    throw error;
  }
}
