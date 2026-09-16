/**
 * Phase 3.1: Document Service
 *
 * Site-level CRUD operations for Documents.
 * Branch-scoped operations are in branch-document-service.ts,
 * types/errors/helpers in document-types.ts.
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Documents"
 */

import { and, count, eq, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { db, transaction } from '../db/scope';
import { documents } from '../db/schema';
import type { DocumentRow, ListDocumentsOptions } from './document-types';
import {
  mapRowToDocument,
  normalizePath,
  pathPrefixPattern,
  validatePath,
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
import { DOCUMENT_READ_JOINS, DOCUMENT_READ_COLUMNS } from './document-queries';
import { validateLocale } from './locale';
import { getMainBranch } from './branch-service';
import { planMove, assertPathFreeOnBranch, isTombstonedOnBranch } from './branch-document-service';

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
  isTombstonedOnBranch,
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
    const result = await db().execute<DocumentRow>(sql`
      INSERT INTO app.documents (site_id, path)
       VALUES (${params.siteId}, ${normalizedPath})
       RETURNING *`);

    const row = result.at(0);
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
  const result = await db().execute<DocumentRow>(sql`
    SELECT ${DOCUMENT_READ_COLUMNS}
     FROM app.documents d
     ${DOCUMENT_READ_JOINS}
     WHERE d.id = ${documentId}`);

  const row = result.at(0);
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
    const result = await db().execute<DocumentRow>(sql`
      SELECT ${DOCUMENT_READ_COLUMNS}
       FROM app.documents d
       ${DOCUMENT_READ_JOINS}
       WHERE d.site_id = ${siteId} AND d.path = ${normalizedPath}
         AND d.archived_at IS NULL
       LIMIT 1`);

    const row = result.at(0);
    if (!row) {
      return null;
    }

    return mapRowToDocument(row);
  }

  // Two index probes rather than one COALESCE(bdp.path, d.path) = $2 predicate:
  // that form is unindexable, so it scans the whole site on every lookup and on
  // every 404. This is the hottest query in the system — keep both paths O(1).
  const override = await db().execute<DocumentRow>(sql`
    SELECT ${DOCUMENT_READ_COLUMNS}
     FROM app.branch_document_paths bdp
     JOIN app.documents d ON d.id = bdp.document_id
     ${DOCUMENT_READ_JOINS}
     WHERE bdp.branch_id = ${branchId}
       AND bdp.path = ${normalizedPath}
       AND d.site_id = ${siteId}
       AND d.archived_at IS NULL
     LIMIT 1`);

  const overrideRow = override.at(0);
  if (overrideRow) {
    return { ...mapRowToDocument(overrideRow), path: normalizedPath };
  }

  // No override claims this path, so the global path answers — unless the
  // document moved away from it on this branch, which the NOT EXISTS excludes.
  const result = await db().execute<DocumentRow>(sql`
    SELECT ${DOCUMENT_READ_COLUMNS}
     FROM app.documents d
     ${DOCUMENT_READ_JOINS}
     WHERE d.site_id = ${siteId}
       AND d.path = ${normalizedPath}
       AND d.archived_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM app.branch_document_paths bdp
         WHERE bdp.branch_id = ${branchId} AND bdp.document_id = d.id
       )
     LIMIT 1`);

  const row = result.at(0);
  if (!row) {
    return null;
  }

  return { ...mapRowToDocument(row), path: normalizedPath };
}

/**
 * The result of resolving a document by path, distinguishing a path that
 * never existed from one that existed and was deleted (tombstoned) on the
 * given branch. Extensible: a future status (e.g. `archived`) is a new
 * union member plus a new case at each caller's exhaustive switch — never
 * a change to the existing branches.
 */
export type DocumentResolution =
  | { status: 'found'; document: DocumentWithArchive }
  | { status: 'not_found' }
  | { status: 'deleted'; document: DocumentWithArchive };

/**
 * Resolves a document by path with explicit tombstone awareness. Callers
 * that must not resurrect a deleted document (or must tell a visitor
 * "this page was deleted" instead of "this page never existed") should use
 * this instead of calling getDocumentByPath directly.
 *
 * Tombstone status is only meaningful relative to a branch — when branchId
 * is omitted, a found document is always reported as `found`.
 */
export async function resolveDocumentByPath(
  siteId: string,
  path: string,
  branchId?: string,
): Promise<DocumentResolution> {
  const document = await getDocumentByPath(siteId, path, branchId);
  if (document === null) {
    return { status: 'not_found' };
  }
  if (branchId !== undefined) {
    const tombstoned = await isTombstonedOnBranch(document.id, branchId);
    if (tombstoned) {
      return { status: 'deleted', document };
    }
  }
  return { status: 'found', document };
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
  const assignments: SQL[] = [];
  let normalizedPath: string | undefined;

  if (fields.path !== undefined) {
    normalizedPath = normalizePath(fields.path);
    validatePath(normalizedPath);
    assignments.push(sql`path = ${normalizedPath}`);
  }

  if (fields.locale !== undefined) {
    const locale = fields.locale === null ? null : validateLocale(fields.locale);
    assignments.push(sql`locale = ${locale}`);
  }

  if (assignments.length === 0) {
    return await getDocument(documentId);
  }

  try {
    const result = await db().execute<DocumentRow>(sql`
      WITH upd AS (
         UPDATE app.documents
         SET ${sql.join(assignments, sql`, `)}
         WHERE id = ${documentId}
         RETURNING *
       )
       SELECT ${DOCUMENT_READ_COLUMNS}
       FROM upd d
       ${DOCUMENT_READ_JOINS}`);

    const row = result.at(0);
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
  const deleted = await db()
    .delete(documents)
    .where(eq(documents.id, documentId))
    .returning({ id: documents.id });

  return deleted.length > 0;
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

  // Default: only non-archived documents (archived is false or undefined)
  const archivedPredicate = archived === true
    ? sql`d.archived_at IS NOT NULL`
    : sql`d.archived_at IS NULL`;

  const prefixPattern = pathPrefixPattern(pathPrefix);
  const prefixPredicate = prefixPattern === undefined
    ? sql``
    : sql` AND d.path LIKE ${prefixPattern}`;
  const limitClause = limit === undefined ? sql`` : sql` LIMIT ${limit}`;
  const offsetClause = offset === undefined ? sql`` : sql` OFFSET ${offset}`;

  const result = await db().execute<DocumentRow>(sql`
    SELECT ${DOCUMENT_READ_COLUMNS}
     FROM app.documents d
     ${DOCUMENT_READ_JOINS}
     WHERE d.site_id = ${siteId}
       AND ${archivedPredicate}${prefixPredicate}
     ORDER BY d.path ASC${limitClause}${offsetClause}`);

  return result.map(mapRowToDocument);
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
  const rows = await db()
    .select({ one: sql`1` })
    .from(documents)
    .where(and(
      eq(documents.siteId, siteId),
      eq(documents.path, normalizedPath),
      isNull(documents.archivedAt),
    ))
    .limit(1);

  return rows.length > 0;
}

/**
 * How many of a site's documents hold content in each locale, keyed by the tag
 * stored on the document. Documents whose language is unrecorded are counted
 * under no tag.
 *
 * Holding content means not archived. A page deleted through the editor is
 * recorded as a tombstone version and leaves archived_at NULL, so it is still
 * counted; which of the two removal mechanisms marks a page as gone is what
 * PCC-3618 settles. The count is site-wide rather than branch-scoped, so a
 * translation on an unmerged branch counts the same as published content.
 *
 * @param siteId - The site ID
 * @returns Document counts keyed by locale tag
 */
export async function countDocumentsByLocale(
  siteId: string,
): Promise<Record<string, number>> {
  const rows = await db()
    .select({ locale: documents.locale, count: count() })
    .from(documents)
    .where(and(
      eq(documents.siteId, siteId),
      isNull(documents.archivedAt),
      isNotNull(documents.locale),
    ))
    .groupBy(documents.locale);

  // Built by hand rather than through Object.fromEntries, which widens to any.
  // The null locale the column allows is filtered out above.
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.locale !== null) {
      counts[row.locale] = row.count;
    }
  }
  return counts;
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
  const archived = await db()
    .update(documents)
    .set({ archivedAt: sql`NOW()` })
    .where(and(eq(documents.id, documentId), isNull(documents.archivedAt)))
    .returning({ id: documents.id });

  return archived.length > 0;
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
  const docResult = await db().execute<DocumentRow>(sql`
    SELECT * FROM app.documents WHERE id = ${documentId}`);

  const doc = docResult.at(0);
  if (!doc) {
    throw new DocumentNotFoundError(documentId);
  }

  if (doc.archived_at === null) {
    throw new DocumentNotFoundError(documentId);
  }

  // Check if the path is now occupied by another non-archived document
  const pathConflict = await db()
    .select({ one: sql`1` })
    .from(documents)
    .where(and(
      eq(documents.siteId, doc.site_id),
      eq(documents.path, doc.path),
      ne(documents.id, documentId),
      isNull(documents.archivedAt),
    ))
    .limit(1);

  if (pathConflict.length > 0) {
    throw new DocumentPathConflictError(doc.path);
  }

  // Restore the document
  const result = await db().execute<DocumentRow>(sql`
    WITH upd AS (
       UPDATE app.documents
       SET archived_at = NULL
       WHERE id = ${documentId}
       RETURNING *
     )
     SELECT ${DOCUMENT_READ_COLUMNS}
     FROM upd d
     ${DOCUMENT_READ_JOINS}`);

  const restoredRow = result.at(0);
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

  const docRow = await db()
    .select({ site_id: documents.siteId, path: documents.path })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.archivedAt)));
  const doc = docRow.at(0);
  if (!doc) {
    throw new DocumentNotFoundError(documentId);
  }

  const mainBranch = await getMainBranch(doc.site_id);
  if (!mainBranch) {
    throw new DocumentNotFoundError(documentId);
  }

  try {
    return await transaction(async () => {
      await db().execute(sql`SELECT pg_advisory_xact_lock(hashtext(${mainBranch.id}))`);

      const planned = await planMove(mainBranch.id, doc.site_id, documentId, doc.path, normalized);
      await assertPathFreeOnBranch(
        mainBranch.id,
        doc.site_id,
        planned.map((p) => p.documentId),
        planned.map((p) => p.newPath),
      );

      // sql.param keeps each list one array parameter rather than a row
      // constructor, which unnest cannot read.
      await db().execute(sql`
        UPDATE app.documents d
         SET path = m.path
         FROM unnest(${sql.param(planned.map((move) => move.documentId))}::uuid[],
                     ${sql.param(planned.map((move) => normalizePath(move.newPath)))}::text[])
              AS m(document_id, path)
         WHERE d.id = m.document_id`);

      return { movedCount: planned.length };
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateDocumentPathError(normalized);
    }
    throw error;
  }
}
