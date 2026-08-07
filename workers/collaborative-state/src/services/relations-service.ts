/**
 * Document Relations Service
 *
 * Accessors for the app.document_relations edge table. Template edges are read
 * inline via the JOIN constants in document-queries.ts; localization edges need
 * standalone lookups (a translation's canonical, a canonical's translations),
 * so those reads and the edge write live here.
 *
 * A 'localization' edge points from a localized document (source) to the
 * canonical it derives from (target). synced_version records the canonical
 * version the translation is aligned to.
 *
 * @see workers/src/db/migrations/042_document_relations.sql
 */

import { query } from '../db';
import { getFirstRow } from './checkpoint-mappers';
import { isAuthority } from '@pantheon-systems/p1-content-validator';
import type { Authority } from '@pantheon-systems/p1-content-validator';

/**
 * An edge between two documents in app.document_relations.
 */
export interface DocumentRelation {
  id: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  relationType: 'template' | 'localization';
  syncedVersion: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface DocumentRelationRow {
  id: string;
  source_document_id: string;
  target_document_id: string;
  relation_type: 'template' | 'localization';
  synced_version: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * Parameters for writing a localization edge.
 */
export interface CreateLocalizationEdgeParams {
  sourceDocumentId: string;
  targetDocumentId: string;
  syncedVersion: number | null;
}

export type { Authority };

/**
 * A translation's per-prop authority overrides, keyed by slot id then prop name.
 * An entry breaks that prop's inheritance from the slot's template default; the
 * absence of an entry means the prop follows the template default.
 *
 * The keys are slot ids and prop names a caller chooses, so a Map: a missing key
 * stays missing instead of resolving to an `Object.prototype` member.
 */
export type AuthorityOverrides = Map<string, Map<string, Authority>>;

/** The same overrides as stored and served, nested plain objects. */
export type AuthorityOverridesJson = Record<string, Record<string, Authority>>;

/**
 * The keys this service writes into a localization edge's `metadata` JSONB. The
 * column tolerates other keys, which a write merges around rather than replacing.
 */
export interface LocalizationEdgeMetadata {
  authorityOverrides?: AuthorityOverridesJson;
}

function mapRowToRelation(row: DocumentRelationRow): DocumentRelation {
  return {
    id: row.id,
    sourceDocumentId: row.source_document_id,
    targetDocumentId: row.target_document_id,
    relationType: row.relation_type,
    syncedVersion: row.synced_version,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

/**
 * Returns the edge of the given type whose source is the given document, or null.
 * A source has at most one edge per relation type (UNIQUE source_document_id,
 * relation_type), so this identifies the single upstream of that kind.
 */
export async function getEdgeBySource(
  sourceDocumentId: string,
  relationType: 'template' | 'localization',
): Promise<DocumentRelation | null> {
  const result = await query<DocumentRelationRow>(
    `SELECT * FROM app.document_relations
     WHERE source_document_id = $1 AND relation_type = $2`,
    [sourceDocumentId, relationType],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapRowToRelation(getFirstRow(result.rows));
}

/**
 * Returns the localization edge whose source is the given document, or null — the
 * canonical a translation derives from.
 */
export async function getLocalizationEdgeBySource(
  sourceDocumentId: string,
): Promise<DocumentRelation | null> {
  return getEdgeBySource(sourceDocumentId, 'localization');
}

/**
 * Returns every localization edge that targets the given canonical document,
 * oldest first. Each edge's source is one locale variant of the canonical.
 */
export async function listLocalizationEdgesByTarget(
  targetDocumentId: string,
): Promise<DocumentRelation[]> {
  const result = await query<DocumentRelationRow>(
    `SELECT * FROM app.document_relations
     WHERE target_document_id = $1 AND relation_type = 'localization'
     ORDER BY created_at ASC`,
    [targetDocumentId],
  );
  return result.rows.map(mapRowToRelation);
}

/** One drift candidate: a source document the branch can see, in path order. */
export interface DriftCandidate {
  documentId: string;
  path: string;
  locale: string | null;
}

/**
 * A page of drift candidates on a branch, ordered by path, with whether the branch
 * holds more beyond it.
 */
export interface DriftCandidatePage {
  candidates: DriftCandidate[];
  hasMore: boolean;
}

/**
 * A document is visible to the drift listing on the same terms as the branch
 * document listing: either the branch holds versions of it and the newest is not a
 * tombstone, or the branch holds none and inherits a published, non-tombstoned copy
 * from main. `$3` is null when the branch is main, which leaves only the first arm.
 *
 * @see workers/src/services/branch-document-service.ts (listDocumentsOnBranch)
 */
const VISIBLE_ON_BRANCH = `(
    (
      EXISTS (
        SELECT 1 FROM app.document_versions dv
         WHERE dv.document_id = d.id AND dv.branch_id = $2
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.document_versions dv_tomb
         WHERE dv_tomb.document_id = d.id AND dv_tomb.branch_id = $2
           AND dv_tomb.is_tombstone = true
           AND dv_tomb.version_number = (
             SELECT MAX(dv_latest.version_number) FROM app.document_versions dv_latest
              WHERE dv_latest.document_id = d.id AND dv_latest.branch_id = $2
           )
      )
    )
    OR (
      NOT EXISTS (
        SELECT 1 FROM app.document_versions dv
         WHERE dv.document_id = d.id AND dv.branch_id = $2
      )
      AND EXISTS (
        SELECT 1 FROM app.document_versions dv
          JOIN app.checkpoint_documents cd ON cd.document_version_id = dv.id
          JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
         WHERE dv.document_id = d.id AND dv.branch_id = $3
           AND cp.branch_id = $3 AND cp.checkpoint_type = 'publish'
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.document_versions dv_tomb
         WHERE dv_tomb.document_id = d.id AND dv_tomb.branch_id = $3
           AND dv_tomb.is_tombstone = true
           AND dv_tomb.version_number = (
             SELECT MAX(dv_latest.version_number) FROM app.document_versions dv_latest
              WHERE dv_latest.document_id = d.id AND dv_latest.branch_id = $3
           )
      )
    )
  )`;

/**
 * One page of the documents on a branch that source an edge of the given type and
 * could have drifted from it, ordered by path and paged in the database.
 */
export async function listDriftCandidates(
  relationType: string,
  branchId: string,
  mainBranchId: string | undefined,
  page: { limit: number; offset: number },
): Promise<DriftCandidatePage> {
  // One row beyond the page answers whether another page remains.
  const result = await query<{ id: string; path: string; locale: string | null }>(
    `SELECT d.id, d.path, d.locale
       FROM app.document_relations dr
       JOIN app.documents d ON d.id = dr.source_document_id
       -- An archived target is nothing to reconcile against. A target deleted on the
       -- branch it is read from is dropped by the summary instead, since which branch
       -- that is gets resolved per document.
       JOIN app.documents target
         ON target.id = dr.target_document_id AND target.archived_at IS NULL
      WHERE dr.relation_type = $1
        -- Pinned to nothing, so the diff would run the target against itself.
        AND dr.synced_version IS NOT NULL
        -- A localization source is pinned to its canonical on this branch: equal to
        -- the newest version there means nothing to take, and no version there at all
        -- makes MAX null, which drops the row. A template source is pinned to a
        -- version in whichever branch holds the template, so only the pinning above
        -- is checked here.
        AND (
          $1::text <> 'localization'
          OR dr.synced_version <> (
            SELECT MAX(dv.version_number)
              FROM app.document_versions dv
             WHERE dv.document_id = dr.target_document_id
               AND dv.branch_id = $2
          )
        )
        AND d.archived_at IS NULL
        AND ${VISIBLE_ON_BRANCH}
      ORDER BY d.path ASC
      LIMIT $4 OFFSET $5`,
    [relationType, branchId, mainBranchId ?? null, page.limit + 1, page.offset],
  );

  const rows = result.rows.slice(0, page.limit);
  return {
    candidates: rows.map((row) => ({
      documentId: row.id,
      path: row.path,
      locale: row.locale,
    })),
    hasMore: result.rows.length > page.limit,
  };
}

/**
 * Writes a localization edge from a translation (source) to its canonical
 * (target). Runs on the caller's connection, so it participates in an ambient
 * transaction.
 */
export async function createLocalizationEdge(
  params: CreateLocalizationEdgeParams,
): Promise<DocumentRelation> {
  const result = await query<DocumentRelationRow>(
    `INSERT INTO app.document_relations
       (source_document_id, target_document_id, relation_type, synced_version)
     VALUES ($1, $2, 'localization', $3)
     RETURNING *`,
    [params.sourceDocumentId, params.targetDocumentId, params.syncedVersion],
  );
  return mapRowToRelation(getFirstRow(result.rows));
}

/**
 * Reads the override map off an edge's metadata. `LocalizationEdgeMetadata` states
 * what this service writes; the column can hold anything, so both the nesting and
 * the stored authorities are proven here rather than asserted. A prop storing
 * anything other than an authority is dropped, leaving it on its slot default.
 */
export function authorityOverridesFromMetadata(
  metadata: Record<string, unknown>,
): AuthorityOverrides {
  const overrides = metadata.authorityOverrides;
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    return new Map();
  }

  const parsed: AuthorityOverrides = new Map();
  for (const [slotId, props] of Object.entries(overrides as Record<string, unknown>)) {
    if (typeof props !== 'object' || props === null || Array.isArray(props)) {
      continue;
    }
    const propEntries = Object.entries(props).filter(
      (entry): entry is [string, Authority] => isAuthority(entry[1]),
    );
    parsed.set(slotId, new Map(propEntries));
  }
  return parsed;
}

/**
 * The overrides as stored in JSONB and served over the API. `Object.fromEntries`
 * defines own properties, so a slot id of `__proto__` lands as an entry instead of
 * reassigning the prototype.
 */
export function authorityOverridesToJson(overrides: AuthorityOverrides): AuthorityOverridesJson {
  return Object.fromEntries(
    [...overrides].map(([slotId, props]) => [slotId, Object.fromEntries(props)]),
  );
}

/**
 * Returns every per-prop authority override on a translation's localization
 * edge, nested by slot id then prop name. Empty when the source has no edge or
 * no overrides.
 */
export async function getAuthorityOverrides(
  sourceDocumentId: string,
): Promise<AuthorityOverrides> {
  const edge = await getLocalizationEdgeBySource(sourceDocumentId);
  if (edge === null) {
    return new Map();
  }
  return authorityOverridesFromMetadata(edge.metadata);
}

/**
 * Returns the authority override for one (slotId, propName) on a translation, or
 * null when no override is set — in which case the prop follows its slot's
 * template default.
 */
export async function getAuthorityOverride(
  sourceDocumentId: string,
  slotId: string,
  propName: string,
): Promise<Authority | null> {
  const overrides = await getAuthorityOverrides(sourceDocumentId);
  return overrides.get(slotId)?.get(propName) ?? null;
}

/**
 * The edge's `metadata`, its `authorityOverrides`, and one slot's map, each read
 * straight off the row being updated and each falling back to an empty object when
 * what is stored is not one.
 *
 * These must stay direct references to `metadata`, not a CTE or sub-select. Under
 * READ COMMITTED a statement that waits on a concurrently updated row re-evaluates
 * expressions over the row it finally locks; a sub-select keeps the snapshot it
 * started with, and a map read through one loses the concurrent update.
 */
const STORED_METADATA = `(CASE WHEN jsonb_typeof(metadata) = 'object'
       THEN metadata ELSE '{}'::jsonb END)`;
const STORED_OVERRIDES = `(CASE WHEN jsonb_typeof(metadata -> 'authorityOverrides') = 'object'
       THEN metadata -> 'authorityOverrides' ELSE '{}'::jsonb END)`;
const STORED_SLOT = `(CASE WHEN jsonb_typeof(metadata -> 'authorityOverrides' -> $2::text) = 'object'
       THEN metadata -> 'authorityOverrides' -> $2::text ELSE '{}'::jsonb END)`;

/**
 * Ceiling on how many (slotId, propName) entries one translation's authority map
 * holds. Each entry is a key pair in the localization edge's metadata JSONB, so
 * without a ceiling a client could grow one row without limit.
 */
export const MAX_OVERRIDE_ENTRIES = 1000;

/** Raised when a translation's authority map is at `MAX_OVERRIDE_ENTRIES`. */
export class AuthorityOverrideLimitError extends Error {
  public readonly name = 'AuthorityOverrideLimitError';

  constructor(public readonly sourceDocumentId: string) {
    super(`A translation holds at most ${String(MAX_OVERRIDE_ENTRIES)} authority overrides.`);
    Object.setPrototypeOf(this, AuthorityOverrideLimitError.prototype);
  }
}

/**
 * Sets the authority override for one (slotId, propName) on a translation,
 * breaking that prop's inheritance from its slot's template default. Overwrites
 * any existing override for the key and leaves every other prop, slot, and
 * metadata key as it found them. A no-op when the source has no localization edge.
 *
 * One statement, so concurrent writes to the same edge resolve per prop rather
 * than per map: the loser of a race is the prop, not everything the winner read.
 * The same statement enforces `MAX_OVERRIDE_ENTRIES`, so the ceiling holds under a
 * race: a new entry beyond it leaves the stored map untouched and raises
 * `AuthorityOverrideLimitError`. Replacing an entry already in the map is always
 * allowed, since it does not grow the map.
 *
 * @throws AuthorityOverrideLimitError when the map is full and the key is new
 */
export async function setAuthorityOverride(
  sourceDocumentId: string,
  slotId: string,
  propName: string,
  authority: Authority,
): Promise<void> {
  const result = await query<{ stored: string | null }>(
    `UPDATE app.document_relations
        SET metadata = CASE
              WHEN COALESCE(${STORED_SLOT} ? $3::text, false)
                OR (
                  SELECT COUNT(*)
                    FROM jsonb_each(${STORED_OVERRIDES}) slot,
                         jsonb_each(slot.value) prop
                ) < $5
              THEN ${STORED_METADATA} || jsonb_build_object(
                     'authorityOverrides',
                     ${STORED_OVERRIDES} || jsonb_build_object(
                       $2::text,
                       ${STORED_SLOT} || jsonb_build_object($3::text, $4::text)
                     )
                   )
              ELSE metadata
            END
      WHERE source_document_id = $1 AND relation_type = 'localization'
      RETURNING metadata -> 'authorityOverrides' -> $2::text ->> $3::text AS stored`,
    [sourceDocumentId, slotId, propName, authority, MAX_OVERRIDE_ENTRIES],
  );
  // No row means no localization edge, which is not this function's business.
  if (result.rows.length === 0) {
    return;
  }
  if (getFirstRow(result.rows).stored !== authority) {
    throw new AuthorityOverrideLimitError(sourceDocumentId);
  }
}

/**
 * Clears the authority override for one (slotId, propName), restoring the prop to
 * its slot's template default. Prunes the slot entry once its last prop override
 * is removed. Clearing an absent override leaves the map as it was. A no-op when
 * the source has no localization edge.
 *
 * One statement, on the same terms as `setAuthorityOverride`.
 */
export async function clearAuthorityOverride(
  sourceDocumentId: string,
  slotId: string,
  propName: string,
): Promise<void> {
  await query(
    `UPDATE app.document_relations
        SET metadata = ${STORED_METADATA} || jsonb_build_object(
              'authorityOverrides',
              CASE WHEN (${STORED_SLOT} - $3::text) = '{}'::jsonb
                   THEN ${STORED_OVERRIDES} - $2::text
                   ELSE ${STORED_OVERRIDES} || jsonb_build_object(
                          $2::text,
                          ${STORED_SLOT} - $3::text
                        )
              END
            )
      WHERE source_document_id = $1 AND relation_type = 'localization'`,
    [sourceDocumentId, slotId, propName],
  );
}
