/**
 * Branch-Scoped Document Operations
 *
 * Operations for managing documents within the context of a branch:
 * listing, creating, checking existence, and deleting (tombstoning).
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Documents"
 */

import type { Document } from '../types';
import { query, withTransaction } from '../db';
import type {
  ListDocumentsOnBranchOptions,
  CreateDocumentOnBranchParams,
  CreateDocumentOnBranchResult,
  DeleteDocumentOnBranchParams,
  DeleteDocumentWithRedirectParams,
  DeleteDocumentWithRedirectResult,
  DocumentVersionRow,
  DocumentOnBranchRow,
  DocumentRow,
} from './document-types';
import {
  escapeLikePattern,
  isTombstoneRow,
  mapRowToDocumentOnBranch,
  mapRowToDocument,
  mapRowToDocumentVersion,
  normalizePath,
  validatePath,
  isUniqueConstraintViolation,
  isForeignKeyViolation,
  isRegistryWritePath,
  SiteNotFoundError,
  DuplicateDocumentPathError,
  DocumentNotFoundError,
} from './document-types';
import type { DocumentOnBranch } from './document-types';
import {
  TEMPLATE_RELATION_JOIN,
  DOCUMENT_WITH_TEMPLATE_COLUMNS,
  branchInheritsFromMain,
} from './document-queries';
import { enforceUniqueSlotIds } from './slot-id-backstop';
import type { RedirectSnapshot } from '../types/redirects';

function appendPaginationClauses(
  sql: string,
  params: unknown[],
  options: { limit?: number; offset?: number },
): string {
  if (options.limit !== undefined) {
    params.push(options.limit);
    sql += ` LIMIT $${String(params.length)}`;
  }
  if (options.offset !== undefined) {
    params.push(options.offset);
    sql += ` OFFSET $${String(params.length)}`;
  }
  return sql;
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
): Promise<DocumentOnBranch[]> {
  const { pathPrefix, mainBranchId, templateId, limit, offset, orderBy } = options;
  const orderColumn = orderBy?.field === 'createdAt' ? 'created_at' : 'path';
  const orderDir = orderBy?.direction === 'desc' ? 'DESC' : 'ASC';
  const orderClause = `ORDER BY ${orderColumn} ${orderDir}`;

  if (branchInheritsFromMain(branchId, mainBranchId)) {
    // Copy-on-write query: include documents from branch + inherited from main
    // Includes publish state via LEFT JOIN LATERAL on checkpoint_documents
    let sql = `
      SELECT DISTINCT ${DOCUMENT_WITH_TEMPLATE_COLUMNS},
        false AS inherited,
        pub.document_version_id AS published_version_id,
        pub.published_at,
        snap.snapshot_title,
        snap.latest_version_at,
        snap.last_modified_by_id,
        snap.last_modified_by_type
      FROM app.documents d
      ${TEMPLATE_RELATION_JOIN}
      INNER JOIN app.document_versions dv ON dv.document_id = d.id
      LEFT JOIN LATERAL (
        SELECT cd.document_version_id, cp.created_at AS published_at
        FROM app.checkpoint_documents cd
        INNER JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
        WHERE cd.document_id = d.id AND cp.branch_id = $2
          AND cp.checkpoint_type = 'publish'
        ORDER BY cp.created_at DESC
        LIMIT 1
      ) pub ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(dv_snap.snapshot->'root'->'props'->>'title', dv_snap.snapshot->>'title') AS snapshot_title,
          dv_snap.created_at AS latest_version_at,
          dv_snap.created_by_id AS last_modified_by_id,
          dv_snap.created_by_type AS last_modified_by_type
        FROM app.document_versions dv_snap
        WHERE dv_snap.document_id = d.id AND dv_snap.branch_id = $1
          AND dv_snap.is_tombstone = false
        ORDER BY dv_snap.version_number DESC
        LIMIT 1
      ) snap ON true
      WHERE dv.branch_id = $1
        AND d.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM app.document_versions dv2
          WHERE dv2.document_id = d.id
            AND dv2.branch_id = $1
            AND dv2.is_tombstone = true
            AND dv2.version_number = (
              SELECT MAX(dv3.version_number)
              FROM app.document_versions dv3
              WHERE dv3.document_id = d.id AND dv3.branch_id = $1
            )
        )`;

    const params: unknown[] = [branchId, mainBranchId];

    if (pathPrefix !== undefined && pathPrefix !== '') {
      // Normalize prefix to match stored paths, then escape LIKE wildcards
      const normalizedPrefix = normalizePath(pathPrefix);
      const escapedPrefix = escapeLikePattern(normalizedPrefix) + '%';
      params.push(escapedPrefix);
      sql += ` AND d.path LIKE $${String(params.length)} ESCAPE '\\'`;
    }

    let templateParamIdx: number | undefined;
    if (templateId !== undefined) {
      params.push(templateId);
      templateParamIdx = params.length;
      sql += ` AND dr.target_document_id = $${String(templateParamIdx)}`;
    }

    sql += `

      UNION

      SELECT DISTINCT ${DOCUMENT_WITH_TEMPLATE_COLUMNS},
        true AS inherited,
        pub.document_version_id AS published_version_id,
        pub.published_at,
        snap.snapshot_title,
        snap.latest_version_at,
        snap.last_modified_by_id,
        snap.last_modified_by_type
      FROM app.documents d
      ${TEMPLATE_RELATION_JOIN}
      INNER JOIN app.document_versions dv ON dv.document_id = d.id
      INNER JOIN app.checkpoint_documents cd ON cd.document_version_id = dv.id
      INNER JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
      LEFT JOIN LATERAL (
        SELECT cd2.document_version_id, cp2.created_at AS published_at
        FROM app.checkpoint_documents cd2
        INNER JOIN app.checkpoints cp2 ON cp2.id = cd2.checkpoint_id
        WHERE cd2.document_id = d.id AND cp2.branch_id = $2
          AND cp2.checkpoint_type = 'publish'
        ORDER BY cp2.created_at DESC
        LIMIT 1
      ) pub ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(dv_snap.snapshot->'root'->'props'->>'title', dv_snap.snapshot->>'title') AS snapshot_title,
          dv_snap.created_at AS latest_version_at,
          dv_snap.created_by_id AS last_modified_by_id,
          dv_snap.created_by_type AS last_modified_by_type
        FROM app.document_versions dv_snap
        WHERE dv_snap.document_id = d.id AND dv_snap.branch_id = $2
          AND dv_snap.is_tombstone = false
        ORDER BY dv_snap.version_number DESC
        LIMIT 1
      ) snap ON true
      WHERE dv.branch_id = $2
        AND cp.branch_id = $2
        AND cp.checkpoint_type = 'publish'
        AND d.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM app.document_versions dv_branch
          WHERE dv_branch.document_id = d.id
            AND dv_branch.branch_id = $1
        )
        AND NOT EXISTS (
          SELECT 1 FROM app.document_versions dv_tomb
          WHERE dv_tomb.document_id = d.id
            AND dv_tomb.branch_id = $2
            AND dv_tomb.is_tombstone = true
            AND dv_tomb.version_number = (
              SELECT MAX(dv_latest.version_number)
              FROM app.document_versions dv_latest
              WHERE dv_latest.document_id = d.id AND dv_latest.branch_id = $2
            )
        )`;

    if (pathPrefix !== undefined && pathPrefix !== '') {
      sql += ` AND d.path LIKE $${String(params.length)} ESCAPE '\\'`;
    }

    if (templateId !== undefined && templateParamIdx !== undefined) {
      sql += ` AND dr.target_document_id = $${String(templateParamIdx)}`;
    }

    sql += ` ${orderClause}`;
    sql = appendPaginationClauses(sql, params, { limit, offset });

    const result = await query<DocumentOnBranchRow>(sql, params);

    return result.rows.map(mapRowToDocumentOnBranch);
  }

  // Original query: only documents with versions on the branch
  // When called without mainBranchId, the branchId itself is treated as main
  let sql = `
    SELECT DISTINCT ${DOCUMENT_WITH_TEMPLATE_COLUMNS},
      false AS inherited,
      pub.document_version_id AS published_version_id,
      pub.published_at,
      snap.snapshot_title,
      snap.latest_version_at,
      snap.last_modified_by_id,
      snap.last_modified_by_type
    FROM app.documents d
    ${TEMPLATE_RELATION_JOIN}
    INNER JOIN app.document_versions dv ON dv.document_id = d.id
    LEFT JOIN LATERAL (
      SELECT cd.document_version_id, cp.created_at AS published_at
      FROM app.checkpoint_documents cd
      INNER JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
      WHERE cd.document_id = d.id AND cp.branch_id = $1
        AND cp.checkpoint_type = 'publish'
      ORDER BY cp.created_at DESC
      LIMIT 1
    ) pub ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(dv_snap.snapshot->'root'->'props'->>'title', dv_snap.snapshot->>'title') AS snapshot_title,
        dv_snap.created_at AS latest_version_at,
        dv_snap.created_by_id AS last_modified_by_id,
        dv_snap.created_by_type AS last_modified_by_type
      FROM app.document_versions dv_snap
      WHERE dv_snap.document_id = d.id AND dv_snap.branch_id = $1
        AND dv_snap.is_tombstone = false
      ORDER BY dv_snap.version_number DESC
      LIMIT 1
    ) snap ON true
    WHERE dv.branch_id = $1
      AND d.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM app.document_versions dv2
        WHERE dv2.document_id = d.id
          AND dv2.branch_id = $1
          AND dv2.is_tombstone = true
          AND dv2.version_number = (
            SELECT MAX(dv3.version_number)
            FROM app.document_versions dv3
            WHERE dv3.document_id = d.id AND dv3.branch_id = $1
          )
      )`;

  const params: unknown[] = [branchId];

  if (pathPrefix !== undefined && pathPrefix !== '') {
    params.push(escapeLikePattern(pathPrefix) + '%');
    sql += ` AND d.path LIKE $${String(params.length)} ESCAPE '\\'`;
  }

  if (templateId !== undefined) {
    params.push(templateId);
    sql += ` AND dr.target_document_id = $${String(params.length)}`;
  }

  sql += ` ${orderClause}`;
  sql = appendPaginationClauses(sql, params, { limit, offset });

  const result = await query<DocumentOnBranchRow>(sql, params);

  return result.rows.map(mapRowToDocumentOnBranch);
}

/**
 * Counts documents on a branch, using the same filtering as listDocumentsOnBranch
 * but without LIMIT/OFFSET.
 */
export async function countDocumentsOnBranch(
  branchId: string,
  options: Pick<ListDocumentsOnBranchOptions, 'pathPrefix' | 'mainBranchId' | 'templateId'> = {},
): Promise<number> {
  const { pathPrefix, mainBranchId, templateId } = options;

  if (branchInheritsFromMain(branchId, mainBranchId)) {
    let sql = `
      SELECT COUNT(*) AS count FROM (
        SELECT d.id
        FROM app.documents d
        ${TEMPLATE_RELATION_JOIN}
        INNER JOIN app.document_versions dv ON dv.document_id = d.id
        WHERE dv.branch_id = $1
          AND d.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM app.document_versions dv2
            WHERE dv2.document_id = d.id AND dv2.branch_id = $1
              AND dv2.is_tombstone = true
              AND dv2.version_number = (
                SELECT MAX(dv3.version_number)
                FROM app.document_versions dv3
                WHERE dv3.document_id = d.id AND dv3.branch_id = $1
              )
          )`;

    const params: unknown[] = [branchId, mainBranchId];

    if (pathPrefix !== undefined && pathPrefix !== '') {
      const normalizedPrefix = normalizePath(pathPrefix);
      const escapedPrefix = escapeLikePattern(normalizedPrefix) + '%';
      params.push(escapedPrefix);
      sql += ` AND d.path LIKE $${String(params.length)} ESCAPE '\\'`;
    }

    let templateParamIdx: number | undefined;
    if (templateId !== undefined) {
      params.push(templateId);
      templateParamIdx = params.length;
      sql += ` AND dr.target_document_id = $${String(templateParamIdx)}`;
    }

    sql += `

        UNION

        SELECT d.id
        FROM app.documents d
        ${TEMPLATE_RELATION_JOIN}
        INNER JOIN app.document_versions dv ON dv.document_id = d.id
        INNER JOIN app.checkpoint_documents cd ON cd.document_version_id = dv.id
        INNER JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
        WHERE dv.branch_id = $2
          AND cp.branch_id = $2
          AND cp.checkpoint_type = 'publish'
          AND d.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM app.document_versions dv_branch
            WHERE dv_branch.document_id = d.id AND dv_branch.branch_id = $1
          )
          AND NOT EXISTS (
            SELECT 1 FROM app.document_versions dv_tomb
            WHERE dv_tomb.document_id = d.id AND dv_tomb.branch_id = $2
              AND dv_tomb.is_tombstone = true
              AND dv_tomb.version_number = (
                SELECT MAX(dv_latest.version_number)
                FROM app.document_versions dv_latest
                WHERE dv_latest.document_id = d.id AND dv_latest.branch_id = $2
              )
          )`;

    if (pathPrefix !== undefined && pathPrefix !== '') {
      sql += ` AND d.path LIKE $${String(params.length)} ESCAPE '\\'`;
    }

    if (templateId !== undefined && templateParamIdx !== undefined) {
      sql += ` AND dr.target_document_id = $${String(templateParamIdx)}`;
    }

    sql += ') counted';

    const result = await query<{ count: string }>(sql, params);
    const countRow = result.rows[0];
    return countRow ? parseInt(countRow.count, 10) : 0;
  }

  let sql = `
    SELECT COUNT(*) AS count FROM (
      SELECT d.id
      FROM app.documents d
      ${TEMPLATE_RELATION_JOIN}
      INNER JOIN app.document_versions dv ON dv.document_id = d.id
      WHERE dv.branch_id = $1
        AND d.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM app.document_versions dv2
          WHERE dv2.document_id = d.id AND dv2.branch_id = $1
            AND dv2.is_tombstone = true
            AND dv2.version_number = (
              SELECT MAX(dv3.version_number)
              FROM app.document_versions dv3
              WHERE dv3.document_id = d.id AND dv3.branch_id = $1
            )
        )`;

  const params: unknown[] = [branchId];

  if (pathPrefix !== undefined && pathPrefix !== '') {
    params.push(escapeLikePattern(pathPrefix) + '%');
    sql += ` AND d.path LIKE $${String(params.length)} ESCAPE '\\'`;
  }

  if (templateId !== undefined) {
    params.push(templateId);
    sql += ` AND dr.target_document_id = $${String(params.length)}`;
  }

  sql += ') counted';

  const result = await query<{ count: string }>(sql, params);
  const countRow = result.rows[0];
  return countRow ? parseInt(countRow.count, 10) : 0;
}

const TEMPLATES_PATH_PREFIX = '_registry/templates/';

/** A template resolved for a branch, carrying the version served there. */
export interface TemplateOnBranch {
  id: string;
  path: string;
  inherited: boolean;
  snapshot: Record<string, unknown> | null;
  versionNumber: number;
  createdAt: string;
}

interface TemplateOnBranchRow {
  id: string;
  path: string;
  inherited: boolean;
  snapshot: Record<string, unknown> | null;
  version_number: number;
  created_at: string;
}

/**
 * Lists templates visible on a branch, each carrying the version served there:
 * templates with a local version (at that version), plus templates inherited
 * from main — a version on main and none on the branch — at main's latest.
 * Templates inherit main's latest version with no publish gate, unlike page
 * listing whose inherited arm requires a publish checkpoint. A template whose
 * latest version on the resolving branch is a tombstone is excluded. The
 * inherited arm is inert when no distinct main branch is given.
 *
 * @param branchId - The branch to list templates for
 * @param mainBranchId - The main branch to inherit from; omit or equal to
 *   branchId to list a single branch without inheritance
 */
export async function listTemplatesOnBranch(
  branchId: string,
  mainBranchId?: string,
): Promise<TemplateOnBranch[]> {
  const likePrefix = escapeLikePattern(TEMPLATES_PATH_PREFIX) + '%';
  const inheritFrom = branchInheritsFromMain(branchId, mainBranchId) ? mainBranchId : branchId;

  const sql = `
    SELECT id, path, inherited, snapshot, version_number, created_at FROM (
      SELECT d.id, d.path, false AS inherited,
        v.snapshot, v.version_number, v.created_at
      FROM app.documents d
      JOIN LATERAL (
        SELECT dv.snapshot, dv.version_number, dv.created_at, dv.is_tombstone
        FROM app.document_versions dv
        WHERE dv.document_id = d.id AND dv.branch_id = $1
        ORDER BY dv.version_number DESC LIMIT 1
      ) v ON true
      WHERE d.path LIKE $3 ESCAPE '\\'
        AND d.archived_at IS NULL
        AND v.is_tombstone = false

      UNION

      SELECT d.id, d.path, true AS inherited,
        v.snapshot, v.version_number, v.created_at
      FROM app.documents d
      JOIN LATERAL (
        SELECT dv.snapshot, dv.version_number, dv.created_at, dv.is_tombstone
        FROM app.document_versions dv
        WHERE dv.document_id = d.id AND dv.branch_id = $2
        ORDER BY dv.version_number DESC LIMIT 1
      ) v ON true
      WHERE $1 <> $2
        AND d.path LIKE $3 ESCAPE '\\'
        AND d.archived_at IS NULL
        AND v.is_tombstone = false
        AND NOT EXISTS (
          SELECT 1 FROM app.document_versions dv_branch
          WHERE dv_branch.document_id = d.id AND dv_branch.branch_id = $1
        )
    ) combined
    ORDER BY path ASC`;

  const result = await query<TemplateOnBranchRow>(sql, [branchId, inheritFrom, likePrefix]);
  return result.rows.map((row) => ({
    id: row.id,
    path: row.path,
    inherited: row.inherited,
    snapshot: row.snapshot,
    versionNumber: row.version_number,
    createdAt: row.created_at,
  }));
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
  const normalizedPath = normalizePath(params.path);
  validatePath(normalizedPath);

  try {
    await query('BEGIN');

    let document: Document;
    let isRecreation = false;
    let documentCreated = false;

    // Try to create the document using SAVEPOINT to handle unique constraint violations
    // PostgreSQL aborts transactions on errors, so we need SAVEPOINT to recover
    await query('SAVEPOINT insert_doc');
    try {
      const docResult = await query<DocumentRow>(
        `INSERT INTO app.documents (site_id, path)
         VALUES ($1, $2)
         RETURNING *`,
        [params.siteId, normalizedPath],
      );
      await query('RELEASE SAVEPOINT insert_doc');
      const insertedRow = docResult.rows[0];
      if (!insertedRow) {
        throw new Error('Failed to insert document');
      }
      document = mapRowToDocument(insertedRow);
      documentCreated = true;
    } catch (docError) {
      // Rollback to savepoint to clear the error state and allow further queries
      await query('ROLLBACK TO SAVEPOINT insert_doc');

      // If document already exists, find it
      if (isUniqueConstraintViolation(docError)) {
        const existingResult = await query<DocumentRow>(
          `SELECT ${DOCUMENT_WITH_TEMPLATE_COLUMNS} FROM app.documents d
           ${TEMPLATE_RELATION_JOIN}
           WHERE d.site_id = $1 AND d.path = $2 AND d.archived_at IS NULL`,
          [params.siteId, normalizedPath],
        );
        const existingRow = existingResult.rows[0];
        if (!existingRow) {
          await query('ROLLBACK');
          throw new DuplicateDocumentPathError(normalizedPath, params.siteId);
        }
        document = mapRowToDocument(existingRow);

        // Check if the latest version on this branch is a tombstone
        // If so, this is a recreation - we should start fresh
        const latestVersionResult = await query<DocumentVersionRow>(
          `SELECT * FROM app.document_versions
           WHERE document_id = $1 AND branch_id = $2
           ORDER BY version_number DESC
           LIMIT 1`,
          [document.id, params.branchId],
        );

        const latestVersion = latestVersionResult.rows[0];
        if (latestVersion !== undefined) {
          if (isTombstoneRow(latestVersion)) {
            // This is a recreation after tombstone - delete all versions on this branch
            // to start fresh with version 1
            await query(
              `DELETE FROM app.document_versions
               WHERE document_id = $1 AND branch_id = $2`,
              [document.id, params.branchId],
            );
            isRecreation = true;
          } else if (isRegistryWritePath(normalizedPath)) {
            // Registry paths (_registry/components/* and the registry index)
            // are written by a write:registry-scoped token with no read
            // access at all, so it has no way to discover an existing
            // document's ID up front. Fall through and append a new version
            // instead of erroring — every other path keeps the duplicate
            // check below.
          } else {
            // Document exists and is not tombstoned - this is a duplicate
            await query('ROLLBACK');
            throw new DuplicateDocumentPathError(normalizedPath, params.siteId);
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

    // A recreation can inherit a stale edge from a prior incarnation, so upsert
    // to the requested template or clear the edge when the recreation names none.
    const templateId =
      params.templateId !== undefined && params.templateId !== null && params.templateId !== ''
        ? params.templateId
        : null;
    if (documentCreated || isRecreation) {
      if (templateId !== null) {
        try {
          await query(
            `INSERT INTO app.document_relations
               (source_document_id, target_document_id, relation_type, synced_version)
             VALUES ($1, $2, 'template', $3)
             ON CONFLICT (source_document_id, relation_type)
             DO UPDATE SET target_document_id = EXCLUDED.target_document_id,
                           synced_version = EXCLUDED.synced_version`,
            [document.id, templateId, params.templateVersion ?? null],
          );
        } catch (relError) {
          if (isForeignKeyViolation(relError)) {
            throw new DocumentNotFoundError(templateId);
          }
          throw relError;
        }
        document.templateId = templateId;
        if (params.templateVersion !== undefined && params.templateVersion !== null) {
          document.templateVersion = params.templateVersion;
        }
      } else if (isRecreation) {
        await query(
          `DELETE FROM app.document_relations
           WHERE source_document_id = $1 AND relation_type = 'template'`,
          [document.id],
        );
        document.templateId = undefined;
        document.templateVersion = undefined;
      }
    }

    // Create the initial version with provided snapshot or empty object
    // After deletion of tombstoned versions, this will be version 1
    const snapshot = enforceUniqueSlotIds(document.id, params.snapshot ?? {});
    const versionResult = await query<DocumentVersionRow>(
      `INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type
      )
      SELECT $1, $2,
        COALESCE(MAX(version_number), 0) + 1,
        $3, $4, $5, $6
      FROM app.document_versions
      WHERE document_id = $1 AND branch_id = $2
      RETURNING *`,
      [
        document.id,
        params.branchId,
        snapshot,
        isRecreation ? 'recreate' : 'edit',
        params.createdById,
        params.createdByType,
      ],
    );

    await query('COMMIT');

    const versionRow = versionResult.rows[0];
    if (!versionRow) {
      throw new Error('Failed to insert document version');
    }

    return {
      document,
      version: mapRowToDocumentVersion(versionRow),
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
  // 1. The latest version is NOT a tombstone
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
         AND dv.is_tombstone = false
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
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type, is_tombstone
      )
      SELECT $1, $2,
        COALESCE(MAX(version_number), 0) + 1,
        $3, $4, $5, $6, true
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

/**
 * Atomically deletes a document on a branch and creates a redirect.
 * Both the tombstone and redirect are created within a single transaction --
 * if either fails, both roll back.
 */
export async function deleteDocumentWithRedirect(
  params: DeleteDocumentWithRedirectParams,
): Promise<DeleteDocumentWithRedirectResult> {
  return withTransaction(async () => {
    await deleteDocumentOnBranch({
      documentId: params.documentId,
      branchId: params.branchId,
      deletedById: params.deletedById,
      deletedByType: params.deletedByType,
    });

    const redirectPath = normalizePath(`_registry/redirects/${params.redirect.fromPath}`);
    validatePath(redirectPath);

    let redirectDocId: string;

    await query('SAVEPOINT insert_redirect_doc');
    try {
      const docResult = await query<DocumentRow>(
        `INSERT INTO app.documents (site_id, path)
         VALUES ($1, $2)
         RETURNING *`,
        [params.siteId, redirectPath],
      );
      await query('RELEASE SAVEPOINT insert_redirect_doc');
      const row = docResult.rows[0];
      if (row === undefined) {
        throw new Error('Failed to insert redirect document');
      }
      redirectDocId = row.id;
    } catch (docError) {
      if (isUniqueConstraintViolation(docError)) {
        await query('ROLLBACK TO SAVEPOINT insert_redirect_doc');

        const existingResult = await query<DocumentRow>(
          `SELECT * FROM app.documents
           WHERE site_id = $1 AND path = $2 AND archived_at IS NULL`,
          [params.siteId, redirectPath],
        );
        const existingRow = existingResult.rows[0];
        if (existingRow === undefined) {
          throw new DuplicateDocumentPathError(redirectPath, params.siteId);
        }
        redirectDocId = existingRow.id;
      } else {
        throw docError;
      }
    }

    const snapshot: RedirectSnapshot = {
      fromPath: '/' + params.redirect.fromPath,
      destination: params.redirect.destination,
      redirectType: params.redirect.redirectType,
      parenting: params.redirect.parenting,
    };

    const versionResult = await query<DocumentVersionRow>(
      `INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type
      )
      SELECT $1, $2,
        COALESCE(MAX(version_number), 0) + 1,
        $3, $4, $5, $6
      FROM app.document_versions
      WHERE document_id = $1 AND branch_id = $2
      RETURNING *`,
      [
        redirectDocId,
        params.branchId,
        snapshot,
        'edit',
        params.deletedById,
        params.deletedByType,
      ],
    );

    const version = versionResult.rows[0];
    if (version === undefined) {
      throw new Error('Failed to insert redirect version');
    }

    return {
      redirect: {
        id: redirectDocId,
        fromPath: snapshot.fromPath,
        destination: snapshot.destination,
        redirectType: snapshot.redirectType,
        parenting: snapshot.parenting,
        updatedAt: version.created_at,
      },
    };
  });
}
