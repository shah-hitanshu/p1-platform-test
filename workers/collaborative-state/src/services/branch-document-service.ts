/**
 * Branch-Scoped Document Operations
 *
 * Operations for managing documents within the context of a branch:
 * listing, creating, checking existence, and deleting (tombstoning).
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Documents"
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { Document } from '../types';
import { query, withTransaction } from '../db';
import type { RedirectSnapshot } from '../types/redirects';
import { REDIRECTS_PATH_PREFIX } from '../types/redirects';
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
} from './document-types';
import {
  SiteNotFoundError,
  DuplicateDocumentPathError,
  DocumentNotFoundError,
  SelfNestingMoveError,
  ImmovableDocumentError,
} from './errors';
import type { DocumentOnBranch, MoveResult } from './document-types';
import {
  TEMPLATE_RELATION_JOIN,
  DOCUMENT_WITH_TEMPLATE_COLUMNS,
  LATEST_VERSION_LISTING_COLUMNS,
  latestVersionOnBranchJoin,
  latestPublishOnBranchJoin,
  publishedOnBranchPredicate,
  documentInBranchSitePredicate,
  effectivePathPrefixPredicate,
  branchInheritsFromMain,
} from './document-queries';
import { enforceUniqueSlotIds } from './slot-id-backstop';

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
  const { pathPrefix, mainBranchId, templateId, limit, offset, orderBy, includeTombstoned = false } = options;
  const tombstoneFilter = includeTombstoned ? '' : ' AND top.is_tombstone = false';
  const orderDir = orderBy?.direction === 'desc' ? 'DESC' : 'ASC';
  const outerOrder =
    orderBy?.field === 'createdAt'
      ? `u.created_at ${orderDir}`
      : `COALESCE(u.branch_path, u.path) ${orderDir}`;

  if (branchInheritsFromMain(branchId, mainBranchId)) {
    // Copy-on-write query: include documents from branch + inherited from main
    // Includes publish state via a batch LEFT JOIN on checkpoint_documents
    let sql = `
      SELECT ${DOCUMENT_WITH_TEMPLATE_COLUMNS},
        bdp.path AS branch_path,
        false AS inherited,
        pub.document_version_id AS published_version_id,
        pub.published_at,
        top.is_tombstone,
        top.snapshot_title,
        top.latest_version_at,
        top.last_modified_by_id,
        top.last_modified_by_type
      FROM app.documents d
      ${TEMPLATE_RELATION_JOIN}
      LEFT JOIN app.branch_document_paths bdp
        ON bdp.branch_id = $1 AND bdp.document_id = d.id
      ${latestVersionOnBranchJoin('$1', LATEST_VERSION_LISTING_COLUMNS)}
      ${latestPublishOnBranchJoin('$2')}
      WHERE d.archived_at IS NULL
        AND ${documentInBranchSitePredicate('$1')}${tombstoneFilter}`;

    const params: unknown[] = [branchId, mainBranchId];

    let pathParamIdx: number | undefined;
    if (pathPrefix !== undefined && pathPrefix !== '') {
      const normalizedPrefix = normalizePath(pathPrefix);
      const escapedPrefix = escapeLikePattern(normalizedPrefix) + '%';
      params.push(escapedPrefix);
      pathParamIdx = params.length;
      sql += ` AND ${effectivePathPrefixPredicate(`$${String(pathParamIdx)}`)}`;
    }

    let templateParamIdx: number | undefined;
    if (templateId !== undefined) {
      params.push(templateId);
      templateParamIdx = params.length;
      sql += ` AND dr.target_document_id = $${String(templateParamIdx)}`;
    }

    // The arms are disjoint — the second takes only documents with no version on
    // the branch — and each emits one row per document, so UNION ALL suffices.
    sql += `

      UNION ALL

      SELECT ${DOCUMENT_WITH_TEMPLATE_COLUMNS},
        bdp.path AS branch_path,
        true AS inherited,
        pub.document_version_id AS published_version_id,
        pub.published_at,
        top.is_tombstone,
        top.snapshot_title,
        top.latest_version_at,
        top.last_modified_by_id,
        top.last_modified_by_type
      FROM app.documents d
      ${TEMPLATE_RELATION_JOIN}
      LEFT JOIN app.branch_document_paths bdp
        ON bdp.branch_id = $1 AND bdp.document_id = d.id
      ${latestVersionOnBranchJoin('$2', LATEST_VERSION_LISTING_COLUMNS)}
      ${latestPublishOnBranchJoin('$2')}
      WHERE d.archived_at IS NULL
        AND ${documentInBranchSitePredicate('$1')}${tombstoneFilter}
        AND ${publishedOnBranchPredicate('$2')}
        AND NOT EXISTS (
          SELECT 1 FROM app.document_versions dv_branch
          WHERE dv_branch.document_id = d.id
            AND dv_branch.branch_id = $1
        )`;

    if (pathParamIdx !== undefined) {
      sql += ` AND ${effectivePathPrefixPredicate(`$${String(pathParamIdx)}`)}`;
    }

    if (templateParamIdx !== undefined) {
      sql += ` AND dr.target_document_id = $${String(templateParamIdx)}`;
    }

    sql = `SELECT * FROM (${sql}) u ORDER BY ${outerOrder}`;
    sql = appendPaginationClauses(sql, params, { limit, offset });

    const result = await query<DocumentOnBranchRow>(sql, params);

    return result.rows.map(mapRowToDocumentOnBranch);
  }

  // Original query: only documents with versions on the branch
  // When called without mainBranchId, the branchId itself is treated as main
  let sql = `
    SELECT ${DOCUMENT_WITH_TEMPLATE_COLUMNS},
      bdp.path AS branch_path,
      false AS inherited,
      pub.document_version_id AS published_version_id,
      pub.published_at,
      top.is_tombstone,
      top.snapshot_title,
      top.latest_version_at,
      top.last_modified_by_id,
      top.last_modified_by_type
    FROM app.documents d
    ${TEMPLATE_RELATION_JOIN}
    LEFT JOIN app.branch_document_paths bdp
      ON bdp.branch_id = $1 AND bdp.document_id = d.id
    ${latestVersionOnBranchJoin('$1', LATEST_VERSION_LISTING_COLUMNS)}
    ${latestPublishOnBranchJoin('$1')}
    WHERE d.archived_at IS NULL
      AND ${documentInBranchSitePredicate('$1')}${tombstoneFilter}`;

  const params: unknown[] = [branchId];

  if (pathPrefix !== undefined && pathPrefix !== '') {
    params.push(escapeLikePattern(pathPrefix) + '%');
    sql += ` AND ${effectivePathPrefixPredicate(`$${String(params.length)}`)}`;
  }

  if (templateId !== undefined) {
    params.push(templateId);
    sql += ` AND dr.target_document_id = $${String(params.length)}`;
  }

  sql = `SELECT * FROM (${sql}) u ORDER BY ${outerOrder}`;
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
  options: Pick<ListDocumentsOnBranchOptions, 'pathPrefix' | 'mainBranchId' | 'templateId' | 'includeTombstoned'> = {},
): Promise<number> {
  const { pathPrefix, mainBranchId, templateId, includeTombstoned = false } = options;

  if (branchInheritsFromMain(branchId, mainBranchId)) {
    let sql = `
      SELECT COUNT(*) AS count FROM (
        SELECT d.id
        FROM app.documents d
        ${TEMPLATE_RELATION_JOIN}
        INNER JOIN app.document_versions dv ON dv.document_id = d.id
        LEFT JOIN app.branch_document_paths bdp
          ON bdp.branch_id = $1 AND bdp.document_id = d.id
        WHERE dv.branch_id = $1
          AND d.archived_at IS NULL${includeTombstoned ? '' : `
          AND NOT EXISTS (
            SELECT 1 FROM app.document_versions dv2
            WHERE dv2.document_id = d.id AND dv2.branch_id = $1
              AND dv2.is_tombstone = true
              AND dv2.version_number = (
                SELECT MAX(dv3.version_number)
                FROM app.document_versions dv3
                WHERE dv3.document_id = d.id AND dv3.branch_id = $1
              )
          )`}`;

    const params: unknown[] = [branchId, mainBranchId];

    if (pathPrefix !== undefined && pathPrefix !== '') {
      const normalizedPrefix = normalizePath(pathPrefix);
      const escapedPrefix = escapeLikePattern(normalizedPrefix) + '%';
      params.push(escapedPrefix);
      sql += ` AND ${effectivePathPrefixPredicate(`$${String(params.length)}`)}`;
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
        LEFT JOIN app.branch_document_paths bdp
          ON bdp.branch_id = $1 AND bdp.document_id = d.id
        WHERE dv.branch_id = $2
          AND cp.branch_id = $2
          AND cp.checkpoint_type = 'publish'
          AND d.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM app.document_versions dv_branch
            WHERE dv_branch.document_id = d.id AND dv_branch.branch_id = $1
          )${includeTombstoned ? '' : `
          AND NOT EXISTS (
            SELECT 1 FROM app.document_versions dv_tomb
            WHERE dv_tomb.document_id = d.id AND dv_tomb.branch_id = $2
              AND dv_tomb.is_tombstone = true
              AND dv_tomb.version_number = (
                SELECT MAX(dv_latest.version_number)
                FROM app.document_versions dv_latest
                WHERE dv_latest.document_id = d.id AND dv_latest.branch_id = $2
              )
          )`}`;

    if (pathPrefix !== undefined && pathPrefix !== '') {
      sql += ` AND ${effectivePathPrefixPredicate(`$${String(params.length)}`)}`;
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
      LEFT JOIN app.branch_document_paths bdp
        ON bdp.branch_id = $1 AND bdp.document_id = d.id
      WHERE dv.branch_id = $1
        AND d.archived_at IS NULL${includeTombstoned ? '' : `
        AND NOT EXISTS (
          SELECT 1 FROM app.document_versions dv2
          WHERE dv2.document_id = d.id AND dv2.branch_id = $1
            AND dv2.is_tombstone = true
            AND dv2.version_number = (
              SELECT MAX(dv3.version_number)
              FROM app.document_versions dv3
              WHERE dv3.document_id = d.id AND dv3.branch_id = $1
            )
        )`}`;

  const params: unknown[] = [branchId];

  if (pathPrefix !== undefined && pathPrefix !== '') {
    params.push(escapeLikePattern(pathPrefix) + '%');
    sql += ` AND ${effectivePathPrefixPredicate(`$${String(params.length)}`)}`;
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

// Sections live under this prefix in the registry; their content pages live
// in the top-level namespace at the same slug.
const SECTIONS_PATH_PREFIX = '_registry/sections/';

export async function assertPathFreeOnBranch(
  branchId: string,
  siteId: string,
  movingDocumentIds: string[],
  paths: string[],
): Promise<void> {
  const result = await query<{ path: string }>(
    `SELECT COALESCE(bdp.path, d.path) AS path
     FROM app.documents d
     LEFT JOIN app.branch_document_paths bdp
       ON bdp.branch_id = $1 AND bdp.document_id = d.id
     WHERE d.site_id = $2
       AND d.archived_at IS NULL
       AND NOT (d.id = ANY($3::uuid[]))
       AND COALESCE(bdp.path, d.path) = ANY($4::text[])
     LIMIT 1`,
    [branchId, siteId, movingDocumentIds, paths],
  );
  const taken = result.rows[0];
  if (taken) {
    getLogger().info('move blocked by occupied path', {
      site_id: siteId,
      branch_id: branchId,
      to_path: taken.path,
      count: paths.length,
      outcome: 'conflict',
    });
    throw new DuplicateDocumentPathError(taken.path, siteId);
  }
}

export interface PlannedMove {
  documentId: string;
  newPath: string;
}

export async function upsertBranchDocumentPaths(
  branchId: string,
  moves: PlannedMove[],
): Promise<void> {
  if (moves.length === 0) return;

  const documentIds: string[] = [];
  const paths: string[] = [];
  for (const move of moves) {
    const normalized = normalizePath(move.newPath);
    validatePath(normalized);
    documentIds.push(move.documentId);
    paths.push(normalized);
  }

  await query(
    `INSERT INTO app.branch_document_paths (branch_id, document_id, path)
     SELECT $1, m.document_id, m.path
     FROM unnest($2::uuid[], $3::text[]) AS m(document_id, path)
     ON CONFLICT (branch_id, document_id) DO UPDATE SET path = EXCLUDED.path`,
    [branchId, documentIds, paths],
  );
}

// $4 raw for substring arithmetic, $5 LIKE-escaped for prefix matching.
// Never share one parameter for both uses: escaping changes string length,
// which shifts the substring offset and corrupts descendant paths.
async function planDescendants(
  branchId: string,
  siteId: string,
  oldPath: string,
  newPath: string,
): Promise<PlannedMove[]> {
  const result = await query<{ id: string; new_path: string }>(
    `SELECT d.id, $3 || substring(COALESCE(bdp.path, d.path) from length($4) + 1) AS new_path
     FROM app.documents d
     LEFT JOIN app.branch_document_paths bdp
       ON bdp.branch_id = $1 AND bdp.document_id = d.id
     WHERE d.site_id = $2
       AND d.archived_at IS NULL
       AND COALESCE(bdp.path, d.path) LIKE $5 || '/%' ESCAPE '\\'`,
    [branchId, siteId, newPath, oldPath, escapeLikePattern(oldPath)],
  );
  return result.rows.map((r) => ({ documentId: r.id, newPath: r.new_path }));
}

async function planLocaleVariants(
  branchId: string,
  siteId: string,
  canonicalMoves: PlannedMove[],
): Promise<PlannedMove[]> {
  if (canonicalMoves.length === 0) return [];

  const newPathByCanonical = new Map(canonicalMoves.map((m) => [m.documentId, m.newPath]));
  const result = await query<{
    variant_id: string;
    canonical_id: string;
    variant_path: string;
    canonical_old_path: string;
  }>(
    `SELECT dr.source_document_id AS variant_id,
            dr.target_document_id AS canonical_id,
            COALESCE(vbdp.path, v.path) AS variant_path,
            COALESCE(cbdp.path, c.path) AS canonical_old_path
     FROM app.document_relations dr
     JOIN app.documents v ON v.id = dr.source_document_id
     JOIN app.documents c ON c.id = dr.target_document_id
     LEFT JOIN app.branch_document_paths vbdp
       ON vbdp.branch_id = $1 AND vbdp.document_id = v.id
     LEFT JOIN app.branch_document_paths cbdp
       ON cbdp.branch_id = $1 AND cbdp.document_id = c.id
     WHERE dr.relation_type = 'localization'
       AND dr.target_document_id = ANY($3::uuid[])
       AND v.site_id = $2
       AND v.archived_at IS NULL`,
    [branchId, siteId, [...newPathByCanonical.keys()]],
  );

  const planned: PlannedMove[] = [];
  for (const row of result.rows) {
    const canonicalNewPath = newPathByCanonical.get(row.canonical_id);
    if (canonicalNewPath === undefined) continue;
    // A customised variant path is a deliberate choice — leave it alone.
    if (!row.variant_path.startsWith(`${row.canonical_old_path}.`)) continue;
    const suffix = row.variant_path.slice(row.canonical_old_path.length);
    planned.push({ documentId: row.variant_id, newPath: `${canonicalNewPath}${suffix}` });
  }
  return planned;
}

export async function planMove(
  branchId: string,
  siteId: string,
  documentId: string,
  oldPath: string,
  newPath: string,
): Promise<PlannedMove[]> {
  if (oldPath === '/' || oldPath === '') {
    throw new ImmovableDocumentError(oldPath);
  }
  if (newPath === oldPath || newPath.startsWith(`${oldPath}/`)) {
    throw new SelfNestingMoveError(oldPath, newPath);
  }

  const planned: PlannedMove[] = [{ documentId, newPath }];
  planned.push(...(await planDescendants(branchId, siteId, oldPath, newPath)));

  if (oldPath.startsWith(SECTIONS_PATH_PREFIX)) {
    const oldContent = oldPath.slice(SECTIONS_PATH_PREFIX.length);
    const newContent = newPath.slice(SECTIONS_PATH_PREFIX.length);
    const contentRoot = await query<{ id: string }>(
      `SELECT d.id FROM app.documents d
       LEFT JOIN app.branch_document_paths bdp
         ON bdp.branch_id = $1 AND bdp.document_id = d.id
       WHERE d.site_id = $2 AND d.archived_at IS NULL
         AND COALESCE(bdp.path, d.path) = $3`,
      [branchId, siteId, oldContent],
    );
    for (const row of contentRoot.rows) {
      planned.push({ documentId: row.id, newPath: newContent });
    }
    planned.push(...(await planDescendants(branchId, siteId, oldContent, newContent)));
  }

  planned.push(...(await planLocaleVariants(branchId, siteId, planned)));

  const deduped = [...new Map(planned.map((move) => [move.documentId, move])).values()];

  getLogger().debug('move plan built', () => ({
    site_id: siteId,
    branch_id: branchId,
    document_id: documentId,
    from_path: oldPath,
    to_path: newPath,
    count: deduped.length,
  }));

  return deduped;
}

export async function moveDocumentOnBranch(
  branchId: string,
  documentId: string,
  newPath: string,
): Promise<MoveResult> {
  const normalized = normalizePath(newPath);
  validatePath(normalized);

  await query('BEGIN');
  try {
    await query('SELECT pg_advisory_xact_lock(hashtext($1))', [branchId]);

    const current = await query<{ site_id: string; path: string }>(
      `SELECT d.site_id, COALESCE(bdp.path, d.path) AS path
       FROM app.documents d
       LEFT JOIN app.branch_document_paths bdp
         ON bdp.branch_id = $1 AND bdp.document_id = d.id
       WHERE d.id = $2 AND d.archived_at IS NULL`,
      [branchId, documentId],
    );
    const doc = current.rows[0];
    if (!doc) {
      throw new DocumentNotFoundError(documentId);
    }

    const planned = await planMove(branchId, doc.site_id, documentId, doc.path, normalized);
    await assertPathFreeOnBranch(
      branchId,
      doc.site_id,
      planned.map((p) => p.documentId),
      planned.map((p) => p.newPath),
    );

    await upsertBranchDocumentPaths(branchId, planned);

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
 * Returns true only when the document's latest version on the branch is a
 * tombstone. Returns false for two other cases that must not be treated as
 * deleted:
 *   - CoW-inherited documents with no local version on the branch at all
 *     (MAX returns NULL → EXISTS evaluates to false)
 *   - Documents with a non-tombstone latest version
 *
 * Use this instead of `!documentExistsOnBranch` whenever "no local version"
 * must be treated as "still alive" (i.e. inherited from main via CoW).
 *
 * @param documentId - The document ID
 * @param branchId - The branch ID
 * @returns True only if the document is explicitly tombstoned on this branch
 */
export async function isTombstonedOnBranch(
  documentId: string,
  branchId: string,
): Promise<boolean> {
  const result = await query<{ tombstoned: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM app.document_versions dv
       WHERE dv.document_id = $1
         AND dv.branch_id = $2
         AND dv.version_number = (
           SELECT MAX(dv2.version_number)
           FROM app.document_versions dv2
           WHERE dv2.document_id = $1 AND dv2.branch_id = $2
         )
         AND dv.is_tombstone = true
     ) AS tombstoned`,
    [documentId, branchId],
  );

  return result.rows[0]?.tombstoned ?? false;
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

    const redirectPath = normalizePath(`${REDIRECTS_PATH_PREFIX}${params.redirect.fromPath}`);
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
