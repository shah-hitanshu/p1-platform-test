/**
 * Document Relations Service
 *
 * Accessors for the app.document_relations edge table. Template edges are read
 * inline via the JOIN constants in document-queries.ts; localization edges need
 * standalone lookups (a translation's canonical, a canonical's translations),
 * so those reads and the edge write live here.
 *
 * A 'localization' edge points from a localized document (derived) to the
 * canonical it derives from (upstream). synced_version_id records the canonical
 * version the translation is aligned to, by identity: version numbers restart on
 * every branch, so a number read on another branch names a different version or
 * none. Template edges pin by synced_version instead.
 *
 * @see src/db/schema/document-relations.sql.ts (documentRelations)
 */

import { query } from '../db';
import { findMainBranchId } from './template-read';
import {
  branchDocumentPathJoin,
  branchInheritsFromMain,
  documentInBranchSitePredicate,
  publishedOnBranchJoin,
} from './document-queries';
import { getFirstRow } from './checkpoint-mappers';
import { isAuthority } from '@pantheon-systems/p1-content-validator';
import type { Authority } from '@pantheon-systems/p1-content-validator';
import { AuthorityOverrideLimitError, UpstreamResolutionLimitError } from './errors';

/**
 * An edge between two documents in app.document_relations.
 */
export interface DocumentRelation {
  id: string;
  derivedDocumentId: string;
  upstreamDocumentId: string;
  relationType: 'template' | 'localization';
  syncedUpstreamVersion: number | null;
  /** The pinned upstream version by identity, which resolves on any branch. */
  syncedUpstreamVersionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface DocumentRelationRow {
  id: string;
  source_document_id: string;
  target_document_id: string;
  relation_type: 'template' | 'localization';
  synced_version: number | null;
  synced_version_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * Parameters for writing a localization edge.
 */
export interface CreateLocalizationEdgeParams {
  derivedDocumentId: string;
  upstreamDocumentId: string;
  syncedUpstreamVersion: number | null;
  syncedUpstreamVersionId: string | null;
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
 * What one of a translation's props was last reconciled against: a fingerprint of
 * the canonical value someone settled the change on, and when they settled it.
 * The change stays settled while the canonical still holds that value.
 */
export interface UpstreamResolution {
  hash: string;
  at: string;
}

/**
 * Each of a translation's reconciled props on one branch, keyed by slot id then
 * the JSON Pointer the change was reported at. An entry means someone settled
 * that change, whether by taking the canonical value, rewriting it, or dismissing
 * it. The absence of an entry means the change has never been reconciled.
 *
 * Held per branch, unlike `AuthorityOverrides`: reconciling on one branch settles
 * nothing on another, whose translation has not received the work. A branch with
 * no row of its own reads main's, on the same terms it reads main's content.
 *
 * Keyed by pointer rather than by top-level prop name, also unlike
 * `AuthorityOverrides`: authority belongs to a field as authored, while a
 * resolution settles one reported change, and a change is reported per pointer.
 */
export type UpstreamResolutions = Map<string, Map<string, UpstreamResolution>>;

/** The same resolutions as stored and served, nested plain objects. */
export type UpstreamResolutionsJson = Record<string, Record<string, UpstreamResolution>>;

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
    derivedDocumentId: row.source_document_id,
    upstreamDocumentId: row.target_document_id,
    relationType: row.relation_type,
    syncedUpstreamVersion: row.synced_version,
    syncedUpstreamVersionId: row.synced_version_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

/**
 * Returns the edge of the given type whose derived document is the given
 * document, or null. A derived document has at most one edge per relation type
 * (UNIQUE source_document_id, relation_type), so this identifies the single
 * upstream of that kind.
 */
export async function getEdgeByDerivedDocument(
  derivedDocumentId: string,
  relationType: 'template' | 'localization',
): Promise<DocumentRelation | null> {
  const result = await query<DocumentRelationRow>(
    `SELECT * FROM app.document_relations
     WHERE source_document_id = $1 AND relation_type = $2`,
    [derivedDocumentId, relationType],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapRowToRelation(getFirstRow(result.rows));
}

/**
 * Returns the localization edge whose derived document is the given document, or
 * null — the canonical a translation derives from.
 */
export async function getLocalizationEdgeByDerivedDocument(
  derivedDocumentId: string,
): Promise<DocumentRelation | null> {
  return getEdgeByDerivedDocument(derivedDocumentId, 'localization');
}

/**
 * Returns every localization edge whose upstream is the given canonical
 * document, oldest first. Each edge's derived document is one locale variant of
 * the canonical.
 */
export async function listLocalizationEdgesByUpstreamDocument(
  upstreamDocumentId: string,
): Promise<DocumentRelation[]> {
  const result = await query<DocumentRelationRow>(
    `SELECT * FROM app.document_relations
     WHERE target_document_id = $1 AND relation_type = 'localization'
     ORDER BY created_at ASC`,
    [upstreamDocumentId],
  );
  return result.rows.map(mapRowToRelation);
}

/**
 * One drift candidate: a derived document the branch can see, in path order.
 * `path` is the document's path on this branch, which a move there overrides.
 */
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
 * A document is visible to a branch listing on the same terms as the branch
 * document listing: either the branch holds versions of it and the newest is not a
 * tombstone, or the branch holds none and inherits a published, non-tombstoned copy
 * from main. `alias` is the documents alias the predicate constrains, so both ends
 * of an edge can be checked in one query, and `pubAlias` names that end's
 * {@link publishedOnBranchJoin}, which carries whether main published it.
 *
 * A null `pubAlias` returns the first arm alone, for a branch with no distinct main
 * to inherit from. `mainParam` goes unread then, and so may the join.
 *
 * @see workers/src/services/branch-document-service.ts (listDocumentsOnBranch)
 */
function visibleOnBranch(
  alias: string,
  pubAlias: string | null,
  branchParam: string,
  mainParam: string,
): string {
  const liveOnBranch = `(
      EXISTS (
        SELECT 1 FROM app.document_versions dv
         WHERE dv.document_id = ${alias}.id AND dv.branch_id = ${branchParam}
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.document_versions dv_tomb
         WHERE dv_tomb.document_id = ${alias}.id AND dv_tomb.branch_id = ${branchParam}
           AND dv_tomb.is_tombstone = true
           AND dv_tomb.version_number = (
             SELECT MAX(dv_latest.version_number) FROM app.document_versions dv_latest
              WHERE dv_latest.document_id = ${alias}.id AND dv_latest.branch_id = ${branchParam}
           )
      )
    )`;

  if (pubAlias === null) {
    return liveOnBranch;
  }

  return `(
    ${liveOnBranch}
    OR (
      NOT EXISTS (
        SELECT 1 FROM app.document_versions dv
         WHERE dv.document_id = ${alias}.id AND dv.branch_id = ${branchParam}
      )
      AND ${pubAlias}.document_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM app.document_versions dv_tomb
         WHERE dv_tomb.document_id = ${alias}.id AND dv_tomb.branch_id = ${mainParam}
           AND dv_tomb.is_tombstone = true
           AND dv_tomb.version_number = (
             SELECT MAX(dv_latest.version_number) FROM app.document_versions dv_latest
              WHERE dv_latest.document_id = ${alias}.id AND dv_latest.branch_id = ${mainParam}
           )
      )
    )
  )`;
}

/**
 * One page of the documents on a branch that derive from an edge of the given
 * type and could have drifted from it, ordered by path and paged in the
 * database.
 */
export async function listDriftCandidates(
  relationType: string,
  branchId: string,
  mainBranchId: string | undefined,
  page: { limit: number; offset: number },
): Promise<DriftCandidatePage> {
  const inherits = branchInheritsFromMain(branchId, mainBranchId);
  // One row beyond the page answers whether another page remains.
  const result = await query<{ id: string; path: string; locale: string | null }>(
    `SELECT d.id, COALESCE(bdp.path, d.path) AS path, d.locale
       FROM app.document_relations dr
       JOIN app.documents d ON d.id = dr.source_document_id
       ${branchDocumentPathJoin('$2')}
       -- An archived upstream is nothing to reconcile against. An upstream deleted on
       -- the branch it is read from is dropped by the summary instead, since which
       -- branch that is gets resolved per document.
       JOIN app.documents upstream
         ON upstream.id = dr.target_document_id AND upstream.archived_at IS NULL
       ${inherits ? publishedOnBranchJoin('pub_d', 'd', '$5') : ''}
      WHERE dr.relation_type = $1
        -- Pinned to nothing, so the diff would run the upstream against itself.
        -- A localization edge pins by version identity, a template edge by number.
        -- Whether a pinned document has actually drifted is settled by the
        -- comparison, which resolves either pin without consulting this branch.
        AND CASE WHEN $1::text = 'localization'
                 THEN dr.synced_version_id IS NOT NULL
                 ELSE dr.synced_version IS NOT NULL
            END
        AND d.archived_at IS NULL
        AND ${visibleOnBranch('d', inherits ? 'pub_d' : null, '$2', '$5')}
      ORDER BY COALESCE(bdp.path, d.path) ASC
      LIMIT $3 OFFSET $4`,
    // The branch to inherit from binds last so that dropping it renumbers nothing.
    // It has to be dropped rather than passed as null: Postgres cannot infer a type
    // for a parameter the statement never mentions.
    inherits
      ? [relationType, branchId, page.limit + 1, page.offset, mainBranchId]
      : [relationType, branchId, page.limit + 1, page.offset],
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
 * One locale variant of a canonical, as the branch sees it. `path` is the
 * variant's path on this branch, which a move there overrides.
 */
export interface LocaleVariantRow {
  canonicalDocumentId: string;
  documentId: string;
  path: string;
  locale: string;
}

/**
 * Every locale variant the branch can see, paired with the canonical it derives
 * from, ordered by canonical so a caller can group in one pass. Both ends of the
 * edge must be visible on the branch and unarchived, so a translation authored on
 * another branch is absent and one inherited from main is present.
 *
 * Unlike the drift listing this applies no `synced_version` predicate: a variant in
 * sync with its canonical is content the branch holds, and coverage counts it.
 *
 * A variant with no `locale` is skipped — the tag is what a caller buckets by, and
 * the localization edge alone does not supply one.
 */
export async function listLocaleVariantsOnBranch(
  branchId: string,
  mainBranchId: string | undefined,
): Promise<LocaleVariantRow[]> {
  const inherits = branchInheritsFromMain(branchId, mainBranchId);
  const result = await query<{
    canonical_document_id: string;
    id: string;
    path: string;
    locale: string;
  }>(
    `SELECT dr.target_document_id AS canonical_document_id, d.id,
            COALESCE(bdp.path, d.path) AS path, d.locale
       FROM app.documents d
       ${branchDocumentPathJoin('$1')}
       JOIN app.document_relations dr
         ON dr.source_document_id = d.id AND dr.relation_type = 'localization'
       JOIN app.documents upstream ON upstream.id = dr.target_document_id
       ${inherits ? publishedOnBranchJoin('pub_d', 'd', '$2') : ''}
       ${inherits ? publishedOnBranchJoin('pub_u', 'upstream', '$2') : ''}
      WHERE ${documentInBranchSitePredicate('$1')}
        AND d.archived_at IS NULL
        AND d.locale IS NOT NULL
        AND upstream.archived_at IS NULL
        AND ${visibleOnBranch('d', inherits ? 'pub_d' : null, '$1', '$2')}
        AND ${visibleOnBranch('upstream', inherits ? 'pub_u' : null, '$1', '$2')}
      ORDER BY dr.target_document_id ASC`,
    inherits ? [branchId, mainBranchId] : [branchId],
  );

  return result.rows.map((row) => ({
    canonicalDocumentId: row.canonical_document_id,
    documentId: row.id,
    path: row.path,
    locale: row.locale,
  }));
}

/**
 * Writes a localization edge from a translation (derived) to its canonical
 * (upstream). Runs on the caller's connection, so it participates in an ambient
 * transaction.
 */
export async function createLocalizationEdge(
  params: CreateLocalizationEdgeParams,
): Promise<DocumentRelation> {
  const result = await query<DocumentRelationRow>(
    `INSERT INTO app.document_relations
       (source_document_id, target_document_id, relation_type, synced_version, synced_version_id)
     VALUES ($1, $2, 'localization', $3, $4)
     RETURNING *`,
    [
      params.derivedDocumentId,
      params.upstreamDocumentId,
      params.syncedUpstreamVersion,
      params.syncedUpstreamVersionId,
    ],
  );
  return mapRowToRelation(getFirstRow(result.rows));
}

/** The key the authority map lives under; interpolated into the statements below. */
const AUTHORITY_KEY = 'authorityOverrides';

/**
 * Reads a nested slot-then-prop map, keeping only the props whose value `isValue`
 * proves. Both the nesting and the leaves are proven rather than asserted, since
 * the JSONB holding them takes any shape; a prop storing something else is
 * dropped, which leaves it on whatever the absence of an entry means for that map.
 */
function propMapFromStored<T>(
  stored: unknown,
  isValue: (value: unknown) => value is T,
): Map<string, Map<string, T>> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return new Map();
  }

  const parsed = new Map<string, Map<string, T>>();
  for (const [slotId, props] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof props !== 'object' || props === null || Array.isArray(props)) {
      continue;
    }
    const propEntries = Object.entries(props).filter((entry): entry is [string, T] =>
      isValue(entry[1]),
    );
    parsed.set(slotId, new Map(propEntries));
  }
  return parsed;
}

/**
 * One per-prop map as stored in JSONB and served over the API. `Object.fromEntries`
 * defines own properties, so a slot id of `__proto__` lands as an entry instead of
 * reassigning the prototype.
 */
function propMapToJson<T>(map: Map<string, Map<string, T>>): Record<string, Record<string, T>> {
  return Object.fromEntries([...map].map(([slotId, props]) => [slotId, Object.fromEntries(props)]));
}

export function authorityOverridesFromMetadata(
  metadata: Record<string, unknown>,
): AuthorityOverrides {
  return propMapFromStored(metadata[AUTHORITY_KEY], isAuthority);
}

export function authorityOverridesToJson(overrides: AuthorityOverrides): AuthorityOverridesJson {
  return propMapToJson(overrides);
}

/**
 * A resolution is a fingerprint of the canonical value and the time it was settled,
 * so anything without both is not one. A dropped entry reads as unresolved, which
 * leaves the change listed as outstanding rather than hiding it.
 */
function isUpstreamResolution(value: unknown): value is UpstreamResolution {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const { hash, at } = value as Record<string, unknown>;
  return typeof hash === 'string' && hash.length > 0 && typeof at === 'string' && at.length > 0;
}

/**
 * The stored resolutions map, keeping only the props holding a resolution. A prop
 * storing anything else is dropped, which reads as unresolved and leaves the
 * change listed.
 */
function resolutionsFromJson(stored: unknown): UpstreamResolutions {
  return propMapFromStored(stored, isUpstreamResolution);
}

export function upstreamResolutionsToJson(
  resolutions: UpstreamResolutions,
): UpstreamResolutionsJson {
  return propMapToJson(resolutions);
}

/**
 * Returns every per-prop authority override on a translation's localization
 * edge, nested by slot id then prop name. Empty when the document has no edge or
 * no overrides.
 */
export async function getAuthorityOverrides(
  derivedDocumentId: string,
): Promise<AuthorityOverrides> {
  const edge = await getLocalizationEdgeByDerivedDocument(derivedDocumentId);
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
  derivedDocumentId: string,
  slotId: string,
  propName: string,
): Promise<Authority | null> {
  const overrides = await getAuthorityOverrides(derivedDocumentId);
  return overrides.get(slotId)?.get(propName) ?? null;
}

/**
 * What each of a translation's props was last reconciled against on this branch,
 * nested by slot id then the pointer the change was reported at. Empty when
 * nothing has been reconciled there.
 *
 * A branch with no row of its own reads main's, since it is serving main's
 * translation until it edits it — the branch would otherwise report as outstanding
 * work already done to the very content it shows. `mainBranchId` is the branch to
 * inherit from, and passing it for main itself changes nothing.
 */
export async function getUpstreamResolutions(
  derivedDocumentId: string,
  branchId: string,
  mainBranchId?: string,
): Promise<UpstreamResolutions> {
  const inheritsFromMain = mainBranchId !== undefined && mainBranchId !== branchId;
  const result = inheritsFromMain
    ? await query<{ resolutions: UpstreamResolutionsJson }>(
      `SELECT resolutions FROM app.document_relation_branch_resolutions
        WHERE source_document_id = $1 AND relation_type = 'localization'
          AND branch_id IN ($2, $3)
        ORDER BY (branch_id = $2) DESC
        LIMIT 1`,
      [derivedDocumentId, branchId, mainBranchId],
    )
    : await query<{ resolutions: UpstreamResolutionsJson }>(
      `SELECT resolutions FROM app.document_relation_branch_resolutions
        WHERE source_document_id = $1 AND relation_type = 'localization' AND branch_id = $2`,
      [derivedDocumentId, branchId],
    );
  const stored = result.rows[0]?.resolutions;
  return stored === undefined ? new Map() : resolutionsFromJson(stored);
}

/**
 * The edge's `metadata`, one of its per-prop maps, and one slot within that map,
 * each read straight off the row being updated and each falling back to an empty
 * object when what is stored is not one. `$2` names the slot.
 *
 * These must stay direct references to `metadata`, not a CTE or sub-select. Under
 * READ COMMITTED a statement that waits on a concurrently updated row re-evaluates
 * expressions over the row it finally locks; a sub-select keeps the snapshot it
 * started with, and a map read through one loses the concurrent update.
 */
const STORED_METADATA = `(CASE WHEN jsonb_typeof(metadata) = 'object'
       THEN metadata ELSE '{}'::jsonb END)`;

const STORED_AUTHORITY = `(CASE WHEN jsonb_typeof(metadata -> '${AUTHORITY_KEY}') = 'object'
       THEN metadata -> '${AUTHORITY_KEY}' ELSE '{}'::jsonb END)`;

const STORED_AUTHORITY_SLOT =
  `(CASE WHEN jsonb_typeof(metadata -> '${AUTHORITY_KEY}' -> $2::text) = 'object'
       THEN metadata -> '${AUTHORITY_KEY}' -> $2::text ELSE '{}'::jsonb END)`;

/**
 * Ceiling on how many (slotId, propName) entries one of a translation's per-prop
 * maps holds. Each entry is a key pair in the localization edge's metadata JSONB,
 * so without a ceiling a client could grow one row without limit.
 */
export const MAX_OVERRIDE_ENTRIES = 1000;

/**
 * Writes one (slotId, propName) entry into a per-prop map and reports what the row
 * ended up holding for that key, leaving every other prop, slot, and metadata key
 * as it found them. `stored` is null when the row holds no entry for the key, and
 * `hasEdge` is false when the document has no localization edge.
 *
 * One statement, so concurrent writes to the same edge resolve per prop rather
 * than per map: the loser of a race is the prop, not everything the winner read.
 * The same statement enforces `MAX_OVERRIDE_ENTRIES`, so the ceiling holds under a
 * race: a new entry beyond it leaves the stored map untouched, which the caller
 * sees as a `stored` that does not match what it asked for. Replacing an entry
 * already in the map is always allowed, since it does not grow the map.
 */
async function setAuthorityEntry(
  derivedDocumentId: string,
  slotId: string,
  propName: string,
  value: string,
): Promise<{ hasEdge: boolean; stored: string | null }> {
  const map = STORED_AUTHORITY;
  const slot = STORED_AUTHORITY_SLOT;
  const result = await query<{ stored: string | null }>(
    `UPDATE app.document_relations
        SET metadata = CASE
              WHEN COALESCE(${slot} ? $3::text, false)
                OR (
                  SELECT COUNT(*)
                    FROM jsonb_each(${map}) slot,
                         jsonb_each(slot.value) prop
                ) < $5
              THEN ${STORED_METADATA} || jsonb_build_object(
                     '${AUTHORITY_KEY}',
                     ${map} || jsonb_build_object(
                       $2::text,
                       ${slot} || jsonb_build_object($3::text, $4::text)
                     )
                   )
              ELSE metadata
            END
      WHERE source_document_id = $1 AND relation_type = 'localization'
      RETURNING metadata -> '${AUTHORITY_KEY}' -> $2::text ->> $3::text AS stored`,
    [derivedDocumentId, slotId, propName, value, MAX_OVERRIDE_ENTRIES],
  );
  if (result.rows.length === 0) {
    return { hasEdge: false, stored: null };
  }
  return { hasEdge: true, stored: getFirstRow(result.rows).stored };
}

/**
 * Removes one (slotId, propName) entry from a per-prop map, pruning the slot entry
 * once its last prop is removed. Removing an absent entry leaves the map as it was.
 * A no-op when the document has no localization edge.
 *
 * One statement, on the same terms as `setAuthorityEntry`.
 */
async function clearAuthorityEntry(
  derivedDocumentId: string,
  slotId: string,
  propName: string,
): Promise<void> {
  const map = STORED_AUTHORITY;
  const slot = STORED_AUTHORITY_SLOT;
  await query(
    `UPDATE app.document_relations
        SET metadata = ${STORED_METADATA} || jsonb_build_object(
              '${AUTHORITY_KEY}',
              CASE WHEN (${slot} - $3::text) = '{}'::jsonb
                   THEN ${map} - $2::text
                   ELSE ${map} || jsonb_build_object(
                          $2::text,
                          ${slot} - $3::text
                        )
              END
            )
      WHERE source_document_id = $1 AND relation_type = 'localization'`,
    [derivedDocumentId, slotId, propName],
  );
}

/**
 * Sets the authority override for one (slotId, propName) on a translation,
 * breaking that prop's inheritance from its slot's template default. Overwrites
 * any existing override for the key. A no-op when the document has no
 * localization edge.
 *
 * @throws AuthorityOverrideLimitError when the map is full and the key is new
 */
export async function setAuthorityOverride(
  derivedDocumentId: string,
  slotId: string,
  propName: string,
  authority: Authority,
): Promise<void> {
  const { hasEdge, stored } = await setAuthorityEntry(
    derivedDocumentId,
    slotId,
    propName,
    authority,
  );
  // No edge means no localization edge, which is not this function's business.
  if (!hasEdge) {
    return;
  }
  if (stored !== authority) {
    throw new AuthorityOverrideLimitError(derivedDocumentId, MAX_OVERRIDE_ENTRIES);
  }
}

/**
 * Clears the authority override for one (slotId, propName), restoring the prop to
 * its slot's template default. Clearing an absent override leaves the map as it
 * was. A no-op when the document has no localization edge.
 */
export async function clearAuthorityOverride(
  derivedDocumentId: string,
  slotId: string,
  propName: string,
): Promise<void> {
  await clearAuthorityEntry(derivedDocumentId, slotId, propName);
}

/** One reported change, named the way the change summary reports it. */
export interface UpstreamResolutionTarget {
  slotId: string;
  propPath: string;
}

/**
 * One reported change and a fingerprint of the canonical value it was settled
 * against. Each target carries its own, since a batch settles changes to several
 * props and every prop holds a different value.
 */
export interface UpstreamResolutionEntry extends UpstreamResolutionTarget {
  hash: string;
}

/**
 * The object at `source`, or empty when what is stored there is not one. The
 * column takes any JSON, so every level a statement walks is proven this way
 * before it is walked: a slot holding a scalar would otherwise make the merge and
 * the prune both raise, leaving a row no request could repair.
 */
function jsonObject(source: string): string {
  return `(CASE WHEN jsonb_typeof(${source}) = 'object' THEN ${source} ELSE '{}'::jsonb END)`;
}

/**
 * The map at `source` merged with the batch bound to `batchParam`, slot by slot,
 * so props the batch does not name stay where they were.
 */
function mergedWithBatch(source: string, batchParam = '$3'): string {
  return `(
  SELECT COALESCE(jsonb_object_agg(m.slot, m.props), '{}'::jsonb) FROM (
    SELECT COALESCE(stored.key, batch.key) AS slot,
           COALESCE(${jsonObject('stored.value')}, '{}'::jsonb)
             || COALESCE(batch.value, '{}'::jsonb) AS props
      FROM jsonb_each(${jsonObject(source)}) stored
      FULL OUTER JOIN jsonb_each(${batchParam}::jsonb) batch ON batch.key = stored.key
  ) m)`;
}

/**
 * The map at `source` minus the props the batch bound to `batchParam` names,
 * dropping a slot left with none.
 */
function prunedByBatch(source: string, batchParam = '$3'): string {
  return `(
  SELECT COALESCE(jsonb_object_agg(m.slot, m.props), '{}'::jsonb) FROM (
    SELECT stored.key AS slot,
           ${jsonObject('stored.value')} - (
             SELECT COALESCE(array_agg(p.path), ARRAY[]::text[])
               FROM jsonb_array_elements_text(
                      COALESCE(${batchParam}::jsonb -> stored.key, '[]'::jsonb)
                    ) AS p(path)
           ) AS props
      FROM jsonb_each(${jsonObject(source)}) stored
  ) m WHERE m.props <> '{}'::jsonb)`;
}

/** How many entries the map at `source` holds, counted over every slot. */
function entryCount(source: string): string {
  return `(SELECT COUNT(*) FROM jsonb_each(${source}) slot, jsonb_each(slot.value) prop)`;
}

/**
 * The map a branch inherits: main's, named by the branch parameter at
 * `branchParam`. Empty on main, and empty when main holds none.
 */
function inheritedMap(branchParam: string): string {
  return `COALESCE((
    SELECT i.resolutions FROM app.document_relation_branch_resolutions i
     WHERE i.source_document_id = $1 AND i.relation_type = 'localization'
       AND i.branch_id = ${branchParam}
  ), '{}'::jsonb)`;
}

/** The row being updated on a conflict; `r` is the conflict target. */
const STORED_RESOLUTIONS = 'r.resolutions';

/**
 * The batch as `{slotId: {propPath: {hash, at}}}`, passed as an object rather than
 * a JSON string: a string bound to a `jsonb` parameter arrives as a jsonb string
 * scalar, which `jsonb_each` cannot walk.
 *
 * Every entry in one batch shares `at`, so the changes settled together read as
 * one act of reconciling.
 *
 * Null-prototype objects throughout: a slot or prop named `__proto__` is a key
 * here, and assigning one on an ordinary object sets the prototype instead.
 */
function resolutionBatch(
  entries: UpstreamResolutionEntry[],
  at: string,
): Record<string, Record<string, UpstreamResolution>> {
  const batch = Object.create(null) as Record<string, Record<string, UpstreamResolution>>;
  for (const entry of entries) {
    const slot = batch[entry.slotId] ?? (Object.create(null) as Record<string, UpstreamResolution>);
    slot[entry.propPath] = { hash: entry.hash, at };
    batch[entry.slotId] = slot;
  }
  return batch;
}

/** The batch as `{slotId: [propPath]}`, on the same terms. */
function clearBatch(targets: UpstreamResolutionTarget[]): Record<string, string[]> {
  const batch = Object.create(null) as Record<string, string[]>;
  for (const target of targets) {
    batch[target.slotId] = [...(batch[target.slotId] ?? []), target.propPath];
  }
  return batch;
}

/**
 * Records that the changes reported at `targets` on a translation were reconciled
 * against the canonical values `entries` fingerprint, on this branch. Overwrites
 * any earlier resolution for a target, so reconciling a change again re-points its
 * mark, and leaves every other prop and slot as it found them.
 *
 * A branch writing for the first time carries main's marks over, so settling one
 * change on a branch does not hide the rest of the work main had already done to
 * the translation the branch is serving. `mainBranchId` is the branch to inherit
 * from; main itself inherits nothing.
 *
 * The row holds the map it inherited as `inherited`, so its own map is that
 * baseline plus the batch that created it. Where the ceiling holds a first write to
 * the batch alone, the baseline is empty, keeping the row equal to its baseline
 * plus that batch.
 *
 * One statement for the whole batch, so the row is written once however many
 * changes were settled, and concurrent writes resolve per prop rather than per map.
 * The same statement enforces `MAX_OVERRIDE_ENTRIES` over the result, so a batch
 * that would carry the map past the ceiling leaves it untouched rather than landing
 * in part, and a first write whose inherited map would breach it carries the batch
 * alone.
 *
 * A no-op when the document has no localization edge, so no resolutions are held
 * for a document that derives from nothing.
 *
 * @throws UpstreamResolutionLimitError when the batch would exceed the ceiling
 */
export async function setUpstreamResolutions(
  derivedDocumentId: string,
  branchId: string,
  entries: UpstreamResolutionEntry[],
  mainBranchId?: string,
): Promise<UpstreamResolutions> {
  if (entries.length === 0) {
    return getUpstreamResolutions(derivedDocumentId, branchId, mainBranchId);
  }
  const seeded = mergedWithBatch(inheritedMap('$5'));
  const seededFits = `${entryCount(seeded)} <= $4`;
  const merged = mergedWithBatch(STORED_RESOLUTIONS);
  const at = new Date().toISOString();
  const result = await query<{ stored: UpstreamResolutionsJson }>(
    `INSERT INTO app.document_relation_branch_resolutions AS r
       (source_document_id, relation_type, branch_id, resolutions, inherited)
     SELECT $1, 'localization', $2,
            CASE WHEN ${seededFits} THEN ${seeded} ELSE $3::jsonb END,
            CASE WHEN ${seededFits} THEN ${inheritedMap('$5')} ELSE '{}'::jsonb END
      WHERE EXISTS (
        SELECT 1 FROM app.document_relations
         WHERE source_document_id = $1 AND relation_type = 'localization'
      )
     ON CONFLICT (source_document_id, relation_type, branch_id)
     DO UPDATE SET
       resolutions = CASE
         WHEN ${entryCount(merged)} <= $4
         THEN ${merged}
         ELSE r.resolutions
       END,
       updated_at = NOW()
     RETURNING resolutions AS stored`,
    [
      derivedDocumentId,
      branchId,
      resolutionBatch(entries, at),
      MAX_OVERRIDE_ENTRIES,
      mainBranchId ?? branchId,
    ],
  );
  const stored = result.rows[0]?.stored;
  if (stored === undefined) {
    return new Map();
  }
  const resolutions = resolutionsFromJson(stored);
  const landed = entries.every(
    (entry) => resolutions.get(entry.slotId)?.get(entry.propPath)?.hash === entry.hash,
  );
  if (!landed) {
    throw new UpstreamResolutionLimitError(derivedDocumentId, MAX_OVERRIDE_ENTRIES);
  }
  return resolutions;
}

/**
 * Clears the resolutions at `targets`, returning those changes to the outstanding
 * list. A target with no resolution leaves the map as it was, and a slot left with
 * no resolutions is dropped.
 *
 * A branch clearing an inherited mark takes main's map over minus what it cleared,
 * so the change returns to the list on this branch alone. Clearing a mark the
 * branch does not hold either way leaves it with no map of its own, so it goes on
 * reading main's rather than being cut off from resolutions main records later.
 * The row holds the map it inherited as `inherited`, so its own map is that
 * baseline minus what the clear removed.
 *
 * Unlike recording, this is not held to the canonical still holding the slot: a
 * resolution left behind by a slot that has gone can still be cleared.
 */
export async function clearUpstreamResolutions(
  derivedDocumentId: string,
  branchId: string,
  targets: UpstreamResolutionTarget[],
  mainBranchId?: string,
): Promise<UpstreamResolutions> {
  if (targets.length === 0) {
    return getUpstreamResolutions(derivedDocumentId, branchId, mainBranchId);
  }
  const inherited = inheritedMap('$4');
  const result = await query<{ stored: UpstreamResolutionsJson }>(
    `INSERT INTO app.document_relation_branch_resolutions AS r
       (source_document_id, relation_type, branch_id, resolutions, inherited)
     SELECT $1, 'localization', $2, ${prunedByBatch(inherited)}, ${inherited}
      WHERE EXISTS (
        SELECT 1 FROM app.document_relations
         WHERE source_document_id = $1 AND relation_type = 'localization'
      )
        AND (
          EXISTS (
            SELECT 1 FROM app.document_relation_branch_resolutions own
             WHERE own.source_document_id = $1 AND own.relation_type = 'localization'
               AND own.branch_id = $2
          )
          OR ${prunedByBatch(inherited)} <> ${jsonObject(inherited)}
        )
     ON CONFLICT (source_document_id, relation_type, branch_id)
     DO UPDATE SET
       resolutions = ${prunedByBatch(STORED_RESOLUTIONS)}, updated_at = NOW()
     RETURNING resolutions AS stored`,
    [derivedDocumentId, branchId, clearBatch(targets), mainBranchId ?? branchId],
  );
  const stored = result.rows[0]?.stored;
  // Nothing was written when the clear names no resolution this branch holds, so
  // the resolutions in force are still whatever it reads.
  return stored === undefined
    ? getUpstreamResolutions(derivedDocumentId, branchId, mainBranchId)
    : resolutionsFromJson(stored);
}

/**
 * One row's difference from the map it started with, as the batches that carry it:
 * `sets` holds the resolutions to record, keyed by slot then pointer, and `clears`
 * the pointers to remove, keyed by slot.
 */
interface CarriedResolutions {
  sets: Record<string, Record<string, UpstreamResolution>>;
  clears: Record<string, string[]>;
}

/**
 * What a branch settled itself: the difference between the resolutions it `holds`
 * and the `inherited` copy of main's its row started as. Null when the two agree
 * throughout, so the branch has settled nothing of its own.
 *
 * An entry the branch holds that `inherited` records differently, or not at all,
 * is the branch's own mark and is set. An entry only `inherited` holds the branch
 * cleared, so it is removed. An entry the two agree on came over untouched and is
 * left out of both batches.
 *
 * Null-prototype objects throughout: a slot or prop named `__proto__` is a key
 * here, and assigning one on an ordinary object sets the prototype instead.
 */
function carriedResolutions(
  holds: UpstreamResolutions,
  inherited: UpstreamResolutions,
): CarriedResolutions | null {
  const sets = Object.create(null) as Record<string, Record<string, UpstreamResolution>>;
  const clears = Object.create(null) as Record<string, string[]>;
  let settled = false;
  for (const [slotId, props] of holds) {
    for (const [propPath, resolution] of props) {
      const came = inherited.get(slotId)?.get(propPath);
      if (came?.hash === resolution.hash && came.at === resolution.at) {
        continue;
      }
      const slot = sets[slotId] ?? (Object.create(null) as Record<string, UpstreamResolution>);
      slot[propPath] = resolution;
      sets[slotId] = slot;
      settled = true;
    }
  }
  for (const [slotId, props] of inherited) {
    for (const propPath of props.keys()) {
      if (holds.get(slotId)?.has(propPath) === true) {
        continue;
      }
      clears[slotId] = [...(clears[slotId] ?? []), propPath];
      settled = true;
    }
  }
  return settled ? { sets, clears } : null;
}

/**
 * Applies one translation's carried batches to `targetBranchId`: the map that
 * branch holds minus the cleared pointers, merged with the recorded ones. `$3` is
 * the set batch, `$4` the clear batch, and `$5` the branch to inherit from.
 *
 * A target with no row of its own is seeded the way its own first write seeds one:
 * main's map with the batches applied, and main's map recorded as what the row
 * started with. Main inherits nothing, so a row seeded for main starts empty.
 *
 * One statement per translation, applied slot-wise over the row's own map, so a
 * resolution recorded on the target while the carry runs survives it.
 *
 * The same statement enforces `MAX_OVERRIDE_ENTRIES` over the result. A seeded row
 * that would breach the ceiling holds the set batch alone and starts from nothing,
 * both columns turning on the one condition so they cannot disagree about which
 * map the row began as. An existing row the batches would take past the ceiling is
 * left as it stands, and the changes it settled are listed again.
 *
 * A no-op when the document has no localization edge, so no resolutions are held
 * for a document that derives from nothing.
 */
async function applyCarriedResolutions(
  derivedDocumentId: string,
  targetBranchId: string,
  mainBranchId: string,
  carried: CarriedResolutions,
): Promise<void> {
  const inherited = inheritedMap('$5');
  const seeded = mergedWithBatch(prunedByBatch(inherited, '$4'), '$3');
  const merged = mergedWithBatch(prunedByBatch(STORED_RESOLUTIONS, '$4'), '$3');
  await query(
    `INSERT INTO app.document_relation_branch_resolutions AS r
       (source_document_id, relation_type, branch_id, resolutions, inherited)
     SELECT $1, 'localization', $2,
            CASE WHEN seed.within_ceiling THEN seed.resolutions ELSE $3::jsonb END,
            CASE WHEN seed.within_ceiling THEN seed.inherited ELSE '{}'::jsonb END
       FROM (
         SELECT ${seeded} AS resolutions,
                ${inherited} AS inherited,
                ${entryCount(seeded)} <= $6 AS within_ceiling
       ) seed
      WHERE EXISTS (
        SELECT 1 FROM app.document_relations
         WHERE source_document_id = $1 AND relation_type = 'localization'
      )
     ON CONFLICT (source_document_id, relation_type, branch_id)
     DO UPDATE SET
       resolutions = CASE
         WHEN ${entryCount(merged)} <= $6
         THEN ${merged}
         ELSE r.resolutions
       END,
       updated_at = NOW()`,
    [
      derivedDocumentId,
      targetBranchId,
      carried.sets,
      carried.clears,
      mainBranchId,
      MAX_OVERRIDE_ENTRIES,
    ],
  );
}

/**
 * Carries what `sourceBranchId` settled onto `targetBranchId`, for every
 * translation the source branch holds resolutions for.
 *
 * A resolution fingerprints the canonical value the change was settled against, so
 * it reads the same from either branch and the source branch's fingerprint and
 * time land on the target as they stand. The source branch's row started as the
 * copy of main's it records in `inherited`, so the difference between the two is
 * that branch's own doing: a mark it recorded is set on the target, and a mark it
 * cleared is removed from the target. An entry the two agree on came over
 * untouched, and the target's entry for it stands, whatever the target has settled
 * since.
 *
 * A carry leaves the target holding what it would hold had it settled those
 * changes itself. A workstream receiving one has its row seeded from main the way
 * its own first write would seed it, so it goes on to carry those marks as its own
 * doing when it merges in turn.
 *
 * Every row the source branch holds is carried, whether or not the translation's
 * content landed. Recording a resolution is not an edit, so a translation
 * reconciled on a branch without being retranslated has no version of its own to
 * travel alongside. `excludedDocumentIds` names the translations whose landed
 * content did not come from the source branch, whose reconciling was not what
 * landed either.
 *
 * Idempotent, so a merge that resumes may run it again.
 */
export async function carryUpstreamResolutions(
  sourceBranchId: string,
  targetBranchId: string,
  excludedDocumentIds: readonly string[],
): Promise<void> {
  if (sourceBranchId === targetBranchId) {
    return;
  }
  const held = await query<{
    source_document_id: string;
    resolutions: UpstreamResolutionsJson;
    inherited: UpstreamResolutionsJson;
  }>(
    `SELECT source_document_id, resolutions, inherited
       FROM app.document_relation_branch_resolutions
      WHERE branch_id = $1 AND relation_type = 'localization'
        AND NOT (source_document_id = ANY($2::uuid[]))`,
    [sourceBranchId, [...excludedDocumentIds]],
  );
  const carried = held.rows.flatMap((row) => {
    const batches = carriedResolutions(
      resolutionsFromJson(row.resolutions),
      resolutionsFromJson(row.inherited),
    );
    return batches === null ? [] : [{ derivedDocumentId: row.source_document_id, batches }];
  });
  if (carried.length === 0) {
    return;
  }
  const mainBranchId = (await findMainBranchId(targetBranchId)) ?? targetBranchId;
  for (const { derivedDocumentId, batches } of carried) {
    await applyCarriedResolutions(derivedDocumentId, targetBranchId, mainBranchId, batches);
  }
}
