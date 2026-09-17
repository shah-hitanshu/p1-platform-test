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
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { db, transaction } from '../db/scope';
import { toIsoTimestamp } from '../db/helpers';
import { documentVersions } from '../db/schema';
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
  pathPrefixPattern,
  validatePath,
  isUniqueConstraintViolation,
  isForeignKeyViolation,
  isRegistryWritePath,
  registryWriteIsRedundant,
  registryIndexStampRefresh,
  REGISTRY_INDEX_PATH,
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
  DOCUMENT_READ_JOINS,
  TEMPLATE_RELATION_JOIN,
  DOCUMENT_READ_COLUMNS,
  LATEST_VERSION_LISTING_COLUMNS,
  latestVersionOnBranchJoin,
  latestPublishOnBranchJoin,
  publishedOnBranchPredicate,
  documentInBranchSitePredicate,
  effectivePathPrefixPredicate,
  branchInheritsFromMain,
} from './document-queries';
import { enforceUniqueSlotIds } from './slot-id-backstop';
import { validateLocale } from './locale';
import type { CreateDocumentVersionParams } from './document-version-service';

function paginationClauses(options: { limit?: number; offset?: number }): SQL {
  const limit = options.limit === undefined ? sql`` : sql` LIMIT ${options.limit}`;
  const offset = options.offset === undefined ? sql`` : sql` OFFSET ${options.offset}`;
  return sql`${limit}${offset}`;
}

/**
 * Wraps the listing query so last_modified_by_id resolves to a display name
 * and picture. Only users have a picture — app.agents has no avatar column.
 * Aliased au/ag because the wrapper already owns `u` and orders on it.
 */
function withAuthorName(inner: SQL, orderBy: SQL): SQL {
  return sql`SELECT u.*,
      COALESCE(
        CASE u.last_modified_by_type
          WHEN 'user'  THEN COALESCE(au.name, au.email)
          WHEN 'agent' THEN ag.name
          ELSE 'System'
        END, 'System') AS last_modified_by_name,
      CASE u.last_modified_by_type
        WHEN 'user' THEN au.avatar_url
        ELSE NULL
      END AS last_modified_by_avatar_url
    FROM (${inner}) u
    LEFT JOIN app.users  au ON au.id = u.last_modified_by_id
    LEFT JOIN app.agents ag ON ag.id = u.last_modified_by_id::text
    ORDER BY ${orderBy}`;
}

/**
 * The filters both listings share: a LIKE pattern on the branch's effective
 * path, and the template a document derives from. Each carries its own value,
 * so the two arms of an inheriting listing can repeat the same filter.
 */
function listingFilters(
  pathPrefix: string | undefined,
  templateId: string | undefined,
): SQL {
  const pattern = pathPrefixPattern(pathPrefix);
  const prefix = pattern === undefined
    ? sql``
    : sql` AND ${effectivePathPrefixPredicate(pattern)}`;
  const template = templateId === undefined
    ? sql``
    : sql` AND dr.target_document_id = ${templateId}`;
  return sql`${prefix}${template}`;
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
  const {
    pathPrefix, mainBranchId, templateId, limit, offset, orderBy, includeTombstoned = false,
  } = options;
  const tombstoneFilter = includeTombstoned ? sql`` : sql` AND top.is_tombstone = false`;
  const orderDir = orderBy?.direction === 'desc' ? sql`DESC` : sql`ASC`;
  const outerOrder =
    orderBy?.field === 'createdAt'
      ? sql`u.created_at ${orderDir}`
      : sql`COALESCE(u.branch_path, u.path) ${orderDir}`;
  const inherits = branchInheritsFromMain(branchId, mainBranchId);
  const filters = listingFilters(pathPrefix, templateId);

  if (inherits) {
    // Copy-on-write query: include documents from branch + inherited from main
    // Includes publish state via a batch LEFT JOIN on checkpoint_documents.
    // The arms are disjoint — the second takes only documents with no version on
    // the branch — and each emits one row per document, so UNION ALL suffices.
    const inner = sql`
      SELECT ${DOCUMENT_READ_COLUMNS},
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
      ${DOCUMENT_READ_JOINS}
      LEFT JOIN app.branch_document_paths bdp
        ON bdp.branch_id = ${branchId} AND bdp.document_id = d.id
      ${latestVersionOnBranchJoin(branchId, LATEST_VERSION_LISTING_COLUMNS)}
      ${latestPublishOnBranchJoin(mainBranchId)}
      WHERE d.archived_at IS NULL
        AND ${documentInBranchSitePredicate(branchId)}${tombstoneFilter}${filters}

      UNION ALL

      SELECT ${DOCUMENT_READ_COLUMNS},
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
      ${DOCUMENT_READ_JOINS}
      LEFT JOIN app.branch_document_paths bdp
        ON bdp.branch_id = ${branchId} AND bdp.document_id = d.id
      ${latestVersionOnBranchJoin(mainBranchId, LATEST_VERSION_LISTING_COLUMNS)}
      ${latestPublishOnBranchJoin(mainBranchId)}
      WHERE d.archived_at IS NULL
        AND ${documentInBranchSitePredicate(branchId)}${tombstoneFilter}
        AND ${publishedOnBranchPredicate(mainBranchId)}
        AND NOT EXISTS (
          SELECT 1 FROM app.document_versions dv_branch
          WHERE dv_branch.document_id = d.id
            AND dv_branch.branch_id = ${branchId}
        )${filters}`;

    const result = await db().execute<DocumentOnBranchRow>(
      sql`${withAuthorName(inner, outerOrder)}${paginationClauses({ limit, offset })}`,
    );

    return result.map(mapRowToDocumentOnBranch);
  }

  // Original query: only documents with versions on the branch
  // When called without mainBranchId, the branchId itself is treated as main
  const inner = sql`
    SELECT ${DOCUMENT_READ_COLUMNS},
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
    ${DOCUMENT_READ_JOINS}
    LEFT JOIN app.branch_document_paths bdp
      ON bdp.branch_id = ${branchId} AND bdp.document_id = d.id
    ${latestVersionOnBranchJoin(branchId, LATEST_VERSION_LISTING_COLUMNS)}
    ${latestPublishOnBranchJoin(branchId)}
    WHERE d.archived_at IS NULL
      AND ${documentInBranchSitePredicate(branchId)}${tombstoneFilter}${filters}`;

  const result = await db().execute<DocumentOnBranchRow>(
    sql`${withAuthorName(inner, outerOrder)}${paginationClauses({ limit, offset })}`,
  );

  return result.map(mapRowToDocumentOnBranch);
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
  const inherits = branchInheritsFromMain(branchId, mainBranchId);
  const filters = listingFilters(pathPrefix, templateId);

  /** The branch's own tombstone exclusion, against the aliases its arm uses. */
  const notTombstonedOn = (branch: string, tomb: SQL, latest: SQL): SQL =>
    includeTombstoned
      ? sql``
      : sql`
          AND NOT EXISTS (
            SELECT 1 FROM app.document_versions ${tomb}
            WHERE ${tomb}.document_id = d.id AND ${tomb}.branch_id = ${branch}
              AND ${tomb}.is_tombstone = true
              AND ${tomb}.version_number = (
                SELECT MAX(${latest}.version_number)
                FROM app.document_versions ${latest}
                WHERE ${latest}.document_id = d.id AND ${latest}.branch_id = ${branch}
              )
          )`;

  if (inherits) {
    const statement = sql`
      SELECT COUNT(*) AS count FROM (
        SELECT d.id
        FROM app.documents d
        ${TEMPLATE_RELATION_JOIN}
        INNER JOIN app.document_versions dv ON dv.document_id = d.id
        LEFT JOIN app.branch_document_paths bdp
          ON bdp.branch_id = ${branchId} AND bdp.document_id = d.id
        WHERE dv.branch_id = ${branchId}
          AND dv.superseded_at IS NULL
          AND d.archived_at IS NULL${notTombstonedOn(branchId, sql`dv2`, sql`dv3`)}${filters}

        UNION

        SELECT d.id
        FROM app.documents d
        ${TEMPLATE_RELATION_JOIN}
        -- No superseded_at filter here, unlike the arm above: this arm matches
        -- the version a publish checkpoint pinned, which is routinely an older
        -- version than the branch's newest. Filtering it would drop published
        -- inherited documents out of the count.
        INNER JOIN app.document_versions dv ON dv.document_id = d.id
        INNER JOIN app.checkpoint_documents cd ON cd.document_version_id = dv.id
        INNER JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
        LEFT JOIN app.branch_document_paths bdp
          ON bdp.branch_id = ${branchId} AND bdp.document_id = d.id
        WHERE dv.branch_id = ${mainBranchId}
          AND cp.branch_id = ${mainBranchId}
          AND cp.checkpoint_type = 'publish'
          AND d.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM app.document_versions dv_branch
            WHERE dv_branch.document_id = d.id AND dv_branch.branch_id = ${branchId}
          )${notTombstonedOn(mainBranchId, sql`dv_tomb`, sql`dv_latest`)}${filters}
      ) counted`;

    const result = await db().execute<ListingCountRow>(statement);
    const countRow = result.at(0);
    return countRow ? parseInt(countRow.count, 10) : 0;
  }

  const statement = sql`
    SELECT COUNT(*) AS count FROM (
      SELECT DISTINCT d.id
      FROM app.documents d
      ${TEMPLATE_RELATION_JOIN}
      INNER JOIN app.document_versions dv ON dv.document_id = d.id
      LEFT JOIN app.branch_document_paths bdp
        ON bdp.branch_id = ${branchId} AND bdp.document_id = d.id
      WHERE dv.branch_id = ${branchId}
        AND dv.superseded_at IS NULL
        AND d.archived_at IS NULL${notTombstonedOn(branchId, sql`dv2`, sql`dv3`)}${filters}
    ) counted`;

  const result = await db().execute<ListingCountRow>(statement);
  const countRow = result.at(0);
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
  // sql.param keeps each list one array parameter rather than a row
  // constructor, which ANY cannot read.
  const result = await db().execute<TakenPathRow>(sql`
    SELECT COALESCE(bdp.path, d.path) AS path
     FROM app.documents d
     LEFT JOIN app.branch_document_paths bdp
       ON bdp.branch_id = ${branchId} AND bdp.document_id = d.id
     WHERE d.site_id = ${siteId}
       AND d.archived_at IS NULL
       AND NOT (d.id = ANY(${sql.param(movingDocumentIds)}::uuid[]))
       AND COALESCE(bdp.path, d.path) = ANY(${sql.param(paths)}::text[])
     LIMIT 1`);
  const taken = result.at(0);
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

  await db().execute(sql`
    INSERT INTO app.branch_document_paths (branch_id, document_id, path)
     SELECT ${branchId}, m.document_id, m.path
     FROM unnest(${sql.param(documentIds)}::uuid[], ${sql.param(paths)}::text[])
          AS m(document_id, path)
     ON CONFLICT (branch_id, document_id) DO UPDATE SET path = EXCLUDED.path`);
}

// The old path is bound twice: raw for the substring arithmetic, LIKE-escaped
// for the prefix match. Never share one value for both uses: escaping changes
// the string's length, which shifts the substring offset and corrupts
// descendant paths.
async function planDescendants(
  branchId: string,
  siteId: string,
  oldPath: string,
  newPath: string,
): Promise<PlannedMove[]> {
  // escapeLikePattern escapes with a backslash, which is LIKE's default escape
  // character.
  const result = await db().execute<PlannedDescendantRow>(sql`
    SELECT d.id,
           ${newPath} || substring(COALESCE(bdp.path, d.path) from length(${oldPath}) + 1)
             AS new_path
     FROM app.documents d
     LEFT JOIN app.branch_document_paths bdp
       ON bdp.branch_id = ${branchId} AND bdp.document_id = d.id
     WHERE d.site_id = ${siteId}
       AND d.archived_at IS NULL
       AND COALESCE(bdp.path, d.path) LIKE ${escapeLikePattern(oldPath)} || '/%'`);
  return result.map((r) => ({ documentId: r.id, newPath: r.new_path }));
}

async function planLocaleVariants(
  branchId: string,
  siteId: string,
  canonicalMoves: PlannedMove[],
): Promise<PlannedMove[]> {
  if (canonicalMoves.length === 0) return [];

  const newPathByCanonical = new Map(canonicalMoves.map((m) => [m.documentId, m.newPath]));
  const result = await db().execute<LocaleVariantMoveRow>(sql`
    SELECT dr.source_document_id AS variant_id,
            dr.target_document_id AS canonical_id,
            COALESCE(vbdp.path, v.path) AS variant_path,
            COALESCE(cbdp.path, c.path) AS canonical_old_path
     FROM app.document_relations dr
     JOIN app.documents v ON v.id = dr.source_document_id
     JOIN app.documents c ON c.id = dr.target_document_id
     LEFT JOIN app.branch_document_paths vbdp
       ON vbdp.branch_id = ${branchId} AND vbdp.document_id = v.id
     LEFT JOIN app.branch_document_paths cbdp
       ON cbdp.branch_id = ${branchId} AND cbdp.document_id = c.id
     WHERE dr.relation_type = 'localization'
       AND dr.target_document_id = ANY(${sql.param([...newPathByCanonical.keys()])}::uuid[])
       AND v.site_id = ${siteId}
       AND v.archived_at IS NULL`);

  const planned: PlannedMove[] = [];
  for (const row of result) {
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
    const contentRoot = await db().execute<DocumentIdRow>(sql`
      SELECT d.id FROM app.documents d
       LEFT JOIN app.branch_document_paths bdp
         ON bdp.branch_id = ${branchId} AND bdp.document_id = d.id
       WHERE d.site_id = ${siteId} AND d.archived_at IS NULL
         AND COALESCE(bdp.path, d.path) = ${oldContent}`);
    for (const row of contentRoot) {
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

  try {
    return await transaction(async () => {
      await db().execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);

      const current = await db().execute<DocumentSitePathRow>(sql`
        SELECT d.site_id, COALESCE(bdp.path, d.path) AS path
         FROM app.documents d
         LEFT JOIN app.branch_document_paths bdp
           ON bdp.branch_id = ${branchId} AND bdp.document_id = d.id
         WHERE d.id = ${documentId} AND d.archived_at IS NULL`);
      const doc = current.at(0);
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

      return { movedCount: planned.length };
    });
  } catch (error) {
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

/**
 * Type aliases rather than interfaces throughout this group: db().execute<T>()
 * constrains T to Record<string, unknown>, which an interface cannot satisfy
 * because it carries no implicit index signature. A timestamp is the text form a
 * raw statement returns, which toIsoTimestamp normalises.
 */
type ListingCountRow = { count: string };

/** On the same terms as {@link ListingCountRow}. */
type TakenPathRow = { path: string };

/** On the same terms as {@link ListingCountRow}. */
type DocumentIdRow = { id: string };

/** On the same terms as {@link ListingCountRow}. */
type DocumentSitePathRow = { site_id: string; path: string };

/** On the same terms as {@link ListingCountRow}. */
type PlannedDescendantRow = { id: string; new_path: string };

/** On the same terms as {@link ListingCountRow}. */
type LocaleVariantMoveRow = {
  variant_id: string;
  canonical_id: string;
  variant_path: string;
  canonical_old_path: string;
};

/** On the same terms as {@link ListingCountRow}. */
type TemplateOnBranchRow = {
  id: string;
  path: string;
  inherited: boolean;
  snapshot: Record<string, unknown> | null;
  version_number: number;
  created_at: string;
};

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

  // escapeLikePattern escapes with a backslash, which is LIKE's default escape
  // character.
  const rows = await db().execute<TemplateOnBranchRow>(sql`
    SELECT id, path, inherited, snapshot, version_number, created_at FROM (
      SELECT d.id, d.path, false AS inherited,
        v.snapshot, v.version_number, v.created_at
      FROM app.documents d
      JOIN LATERAL (
        SELECT dv.snapshot, dv.version_number, dv.created_at, dv.is_tombstone
        FROM app.document_versions dv
        WHERE dv.document_id = d.id AND dv.branch_id = ${branchId}
        ORDER BY dv.version_number DESC LIMIT 1
      ) v ON true
      WHERE d.path LIKE ${likePrefix}
        AND d.archived_at IS NULL
        AND v.is_tombstone = false

      UNION

      SELECT d.id, d.path, true AS inherited,
        v.snapshot, v.version_number, v.created_at
      FROM app.documents d
      JOIN LATERAL (
        SELECT dv.snapshot, dv.version_number, dv.created_at, dv.is_tombstone
        FROM app.document_versions dv
        WHERE dv.document_id = d.id AND dv.branch_id = ${inheritFrom}
        ORDER BY dv.version_number DESC LIMIT 1
      ) v ON true
      WHERE ${branchId}::uuid <> ${inheritFrom}::uuid
        AND d.path LIKE ${likePrefix}
        AND d.archived_at IS NULL
        AND v.is_tombstone = false
        AND NOT EXISTS (
          SELECT 1 FROM app.document_versions dv_branch
          WHERE dv_branch.document_id = d.id AND dv_branch.branch_id = ${branchId}
        )
    ) combined
    ORDER BY path ASC`);
  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    inherited: row.inherited,
    snapshot: row.snapshot,
    versionNumber: row.version_number,
    createdAt: toIsoTimestamp(row.created_at),
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
/**
 * Appends a version at MAX(version_number) + 1, retrying the collision.
 *
 * Two writers computing that MAX concurrently pick the same number and one
 * loses the unique index. The savepoint keeps the surrounding transaction
 * usable so the loser can recompute against the winner's row instead of
 * failing the whole write.
 */
const VERSION_INSERT_ATTEMPTS = 4;

/**
 * The slice of a version write this helper needs. Named off
 * CreateDocumentVersionParams rather than restated, so the field types stay
 * tied to the service that owns them — that one carries patch, Puck action
 * metadata and duplicate-snapshot handling this path has no business with.
 */
type InsertDocumentVersionParams = Pick<
  CreateDocumentVersionParams,
  'documentId' | 'branchId' | 'snapshot' | 'source' | 'createdById' | 'createdByType'
>;

async function insertNextDocumentVersion(
  params: InsertDocumentVersionParams,
): Promise<DocumentVersionRow[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < VERSION_INSERT_ATTEMPTS; attempt++) {
    try {
      // A nested transaction is a savepoint, so a losing insert rolls back to
      // here and leaves the enclosing transaction usable for the next attempt.
      return await transaction(async () => {
        const result = await db().execute<DocumentVersionRow>(sql`
          INSERT INTO app.document_versions (
            document_id, branch_id, version_number, snapshot,
            source, created_by_id, created_by_type
          )
          SELECT ${params.documentId}, ${params.branchId},
            COALESCE(MAX(version_number), 0) + 1,
            ${JSON.stringify(params.snapshot)}, ${params.source},
            ${params.createdById}, ${params.createdByType}
          FROM app.document_versions
          WHERE document_id = ${params.documentId} AND branch_id = ${params.branchId}
          RETURNING *`);
        return [...result];
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Answers a registry write whose content the branch already stores.
 *
 * Components need nothing done — the stored version is already the answer.
 * The index additionally carries stamps the editor reads to decide how much
 * it has to re-verify, so those are refreshed on the stored row rather than
 * written as a new version: the content is identical, only the confirmation
 * time moved.
 */
async function settleRedundantRegistryWrite(
  normalizedPath: string,
  latestVersion: DocumentVersionRow,
  incoming: Record<string, unknown>,
): Promise<DocumentVersionRow> {
  if (normalizedPath !== REGISTRY_INDEX_PATH) {
    return latestVersion;
  }
  const refreshed = registryIndexStampRefresh(incoming, latestVersion.snapshot);
  const updated = await db().execute<DocumentVersionRow>(sql`
    UPDATE app.document_versions
     SET snapshot = ${JSON.stringify(refreshed)}
     WHERE id = ${latestVersion.id}
     RETURNING *`);
  return updated.at(0) ?? latestVersion;
}

export async function createDocumentOnBranch(
  params: CreateDocumentOnBranchParams,
): Promise<CreateDocumentOnBranchResult> {
  const normalizedPath = normalizePath(params.path);
  validatePath(normalizedPath);
  const locale = params.locale === undefined ? null : validateLocale(params.locale);

  return transaction(async () => {
    let document: Document;
    let isRecreation = false;
    let documentCreated = false;

    // Reusing an existing path is routine here (branch copy-on-write, recreation
    // after a tombstone, repeated registry syncs), so the insert conflicts on
    // purpose rather than by accident. DO NOTHING makes that a zero-row result
    // instead of an error, which keeps Postgres from logging an ERROR line per
    // attempt and removes the SAVEPOINT round-trips this used to need to
    // recover from the aborted statement.
    //
    // On conflict the stored row is read below rather than written to, so a
    // locale names the language a document is created in and never relabels one
    // that already exists.
    let insertedRow: DocumentRow | undefined;
    try {
      const docResult = await db().execute<DocumentRow>(sql`
        INSERT INTO app.documents (site_id, path, locale)
         VALUES (${params.siteId}, ${normalizedPath}, ${locale})
         ON CONFLICT (site_id, path) WHERE archived_at IS NULL DO NOTHING
         RETURNING *`);
      insertedRow = docResult.at(0);
    } catch (docError) {
      if (isForeignKeyViolation(docError)) {
        throw new SiteNotFoundError(params.siteId);
      }
      throw docError;
    }

    if (insertedRow !== undefined) {
      document = mapRowToDocument(insertedRow);
      documentCreated = true;
      getLogger().debug('document insert created a new path', () => ({
        site_id: params.siteId,
        branch_id: params.branchId,
        document_id: document.id,
        doc_path: normalizedPath,
        'db.operation.name': 'INSERT',
        outcome: 'created',
      }));
    } else {
      const existingResult = await db().execute<DocumentRow>(sql`
        SELECT ${DOCUMENT_READ_COLUMNS} FROM app.documents d
         ${DOCUMENT_READ_JOINS}
         WHERE d.site_id = ${params.siteId} AND d.path = ${normalizedPath}
           AND d.archived_at IS NULL`);
      const existingRow = existingResult.at(0);
      if (!existingRow) {
        throw new DuplicateDocumentPathError(normalizedPath, params.siteId);
      }
      document = mapRowToDocument(existingRow);
      // The conflict this PR stops provoking. It used to be visible only as an
      // ERROR line in the Postgres log, which is both the wrong severity and
      // the wrong place; debug because it is the routine case, and its whole
      // problem was volume.
      getLogger().debug('document path already existed, reusing', () => ({
        site_id: params.siteId,
        branch_id: params.branchId,
        document_id: document.id,
        doc_path: normalizedPath,
        'db.operation.name': 'INSERT',
        outcome: 'reused',
      }));

      // Check if the latest version on this branch is a tombstone
      // If so, this is a recreation - we should start fresh
      const latestVersionResult = await db().execute<DocumentVersionRow>(sql`
        SELECT * FROM app.document_versions
         WHERE document_id = ${document.id} AND branch_id = ${params.branchId}
         ORDER BY version_number DESC
         LIMIT 1`);

      const latestVersion = latestVersionResult.at(0);
      if (latestVersion !== undefined) {
        if (isTombstoneRow(latestVersion)) {
          // This is a recreation after tombstone. The prior history is kept —
          // not deleted — because app.checkpoint_documents.document_version_id
          // has a plain (NO ACTION) FK to document_versions, and a checkpoint
          // can pin any version on this branch, tombstone included. Deleting
          // those rows here threw a FK violation and 500'd the recreate
          // (PCC-3938). insertNextDocumentVersion below already scopes
          // MAX(version_number) to (document_id, branch_id), so the new
          // version simply continues the sequence instead of resetting to 1.
          isRecreation = true;
          // Info rather than debug: this is a state transition worth finding
          // afterwards, even though the branch's version history now persists
          // across it rather than being reset.
          getLogger().info('document recreated after tombstone', {
            site_id: params.siteId,
            branch_id: params.branchId,
            document_id: document.id,
            doc_path: normalizedPath,
            outcome: 'recreated',
          });
        } else if (isRegistryWritePath(normalizedPath)) {
          // Registry paths (_registry/components/* and the registry index)
          // are written by a write:registry-scoped token with no read access
          // at all, so it has no way to discover an existing document's ID up
          // front, nor to check whether anything changed. Both checks happen
          // here instead: an unchanged descriptor is answered with the version
          // already stored, so a sync run over an unchanged component set
          // writes no history. Anything genuinely new falls through and
          // appends a version — every other path keeps the duplicate check
          // below.
          const incoming = enforceUniqueSlotIds(document.id, params.snapshot ?? {});
          if (registryWriteIsRedundant(normalizedPath, incoming, latestVersion.snapshot)) {
            const settled = await settleRedundantRegistryWrite(
              normalizedPath,
              latestVersion,
              incoming,
            );
            // Debug here, info below: a sync run over an unchanged component
            // set should be silent at info, so a registry version write in
            // production stands out on its own rather than sitting among the
            // runs that wrote nothing.
            getLogger().debug('registry write repeats stored content, no version written', () => ({
              site_id: params.siteId,
              branch_id: params.branchId,
              document_id: document.id,
              doc_path: normalizedPath,
              version_id: settled.id,
              outcome: 'skipped_unchanged',
            }));
            return { document, version: mapRowToDocumentVersion(settled) };
          }
          getLogger().info('registry content changed, writing a new version', {
            site_id: params.siteId,
            branch_id: params.branchId,
            document_id: document.id,
            doc_path: normalizedPath,
            outcome: 'registry_changed',
          });
        } else {
          // Document exists and is not tombstoned - this is a duplicate
          throw new DuplicateDocumentPathError(normalizedPath, params.siteId);
        }
      }
      // If no versions exist on this branch, it's fine to create version 1
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
          await db().execute(sql`
            INSERT INTO app.document_relations
               (source_document_id, target_document_id, relation_type, synced_version)
             VALUES (${document.id}, ${templateId}, 'template',
                     ${params.templateVersion ?? null})
             ON CONFLICT (source_document_id, relation_type)
             DO UPDATE SET target_document_id = EXCLUDED.target_document_id,
                           synced_version = EXCLUDED.synced_version`);
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
        await db().execute(sql`
          DELETE FROM app.document_relations
           WHERE source_document_id = ${document.id} AND relation_type = 'template'`);
        document.templateId = undefined;
        document.templateVersion = undefined;
      }
    }

    // Create the version with provided snapshot or empty object. On a
    // recreation this continues the branch's existing version sequence
    // rather than resetting to 1 — see the comment above where isRecreation
    // is set.
    const snapshot = enforceUniqueSlotIds(document.id, params.snapshot ?? {});
    const versionResult = await insertNextDocumentVersion({
      documentId: document.id,
      branchId: params.branchId,
      snapshot,
      source: isRecreation ? 'recreate' : 'edit',
      createdById: params.createdById,
      createdByType: params.createdByType,
    });

    const versionRow = versionResult.at(0);
    if (!versionRow) {
      throw new Error('Failed to insert document version');
    }

    return {
      document,
      version: mapRowToDocumentVersion(versionRow),
    };
  });
}

/**
 * Whether the document's highest-numbered version on the branch is a tombstone or
 * is not. A document with no version on the branch answers false either way: the
 * MAX is null, so no row matches.
 */
async function latestVersionOnBranchIsTombstone(
  documentId: string,
  branchId: string,
  tombstone: boolean,
): Promise<boolean> {
  const rows = await db()
    .select({ one: sql`1` })
    .from(documentVersions)
    .where(and(
      eq(documentVersions.documentId, documentId),
      eq(documentVersions.branchId, branchId),
      eq(documentVersions.versionNumber, sql`(
        SELECT MAX(dv2.version_number) FROM app.document_versions dv2
         WHERE dv2.document_id = ${documentId} AND dv2.branch_id = ${branchId}
      )`),
      eq(documentVersions.isTombstone, tombstone),
    ))
    .limit(1);

  return rows.length > 0;
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
  return latestVersionOnBranchIsTombstone(documentId, branchId, false);
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
  return latestVersionOnBranchIsTombstone(documentId, branchId, true);
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
    await db().execute<DocumentVersionRow>(sql`
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type, is_tombstone
      )
      SELECT ${params.documentId}, ${params.branchId},
        COALESCE(MAX(version_number), 0) + 1,
        ${JSON.stringify({ _deleted: true })}, 'edit',
        ${params.deletedById}, ${params.deletedByType}, true
      FROM app.document_versions
      WHERE document_id = ${params.documentId} AND branch_id = ${params.branchId}
      RETURNING *`);

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
  return transaction(async () => {
    await deleteDocumentOnBranch({
      documentId: params.documentId,
      branchId: params.branchId,
      deletedById: params.deletedById,
      deletedByType: params.deletedByType,
    });

    const redirectPath = normalizePath(`${REDIRECTS_PATH_PREFIX}${params.redirect.fromPath}`);
    validatePath(redirectPath);

    let redirectDocId: string;

    // A redirect document for this path usually already exists (the same page
    // gets moved more than once), so conflict is the expected case, not an error.
    let insertedRedirectRow: DocumentRow | undefined;
    try {
      const docResult = await db().execute<DocumentRow>(sql`
        INSERT INTO app.documents (site_id, path)
         VALUES (${params.siteId}, ${redirectPath})
         ON CONFLICT (site_id, path) WHERE archived_at IS NULL DO NOTHING
         RETURNING *`);
      insertedRedirectRow = docResult.at(0);
    } catch (docError) {
      if (isForeignKeyViolation(docError)) {
        throw new SiteNotFoundError(params.siteId);
      }
      throw docError;
    }

    if (insertedRedirectRow !== undefined) {
      redirectDocId = insertedRedirectRow.id;
    } else {
      const existingResult = await db().execute<DocumentRow>(sql`
        SELECT * FROM app.documents
         WHERE site_id = ${params.siteId} AND path = ${redirectPath}
           AND archived_at IS NULL`);
      const existingRow = existingResult.at(0);
      if (existingRow === undefined) {
        throw new DuplicateDocumentPathError(redirectPath, params.siteId);
      }
      redirectDocId = existingRow.id;
    }

    getLogger().debug('redirect document resolved', () => ({
      site_id: params.siteId,
      branch_id: params.branchId,
      document_id: redirectDocId,
      doc_path: redirectPath,
      'db.operation.name': 'INSERT',
      outcome: insertedRedirectRow !== undefined ? 'created' : 'reused',
    }));

    const snapshot: RedirectSnapshot = {
      fromPath: '/' + params.redirect.fromPath,
      destination: params.redirect.destination,
      redirectType: params.redirect.redirectType,
      parenting: params.redirect.parenting,
    };

    const versionResult = await db().execute<DocumentVersionRow>(sql`
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type
      )
      SELECT ${redirectDocId}, ${params.branchId},
        COALESCE(MAX(version_number), 0) + 1,
        ${JSON.stringify(snapshot)}, 'edit',
        ${params.deletedById}, ${params.deletedByType}
      FROM app.document_versions
      WHERE document_id = ${redirectDocId} AND branch_id = ${params.branchId}
      RETURNING *`);

    const version = versionResult.at(0);
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
