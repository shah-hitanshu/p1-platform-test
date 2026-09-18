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
 * @see src/db/schema/document-relations.schema.ts (documentRelations)
 */

import { and, asc, desc, eq, inArray, sql, type InferSelectModel, type SQL } from 'drizzle-orm';
import { db } from '../db/scope';
import { toIsoTimestamp } from '../db/helpers';
import { documentRelationBranchResolutions, documentRelations } from '../db/schema';
import { findMainBranchId } from './template-read';
import {
  branchDocumentPathJoin,
  branchInheritsFromMain,
  documentInBranchSitePredicate,
  publishedOnBranchJoin,
} from './document-queries';
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

/**
 * The edge as the builder returns it. `metadata` is typed `unknown` on the
 * column because the jsonb tolerates keys this service does not write.
 */
function mapRelationRow(row: InferSelectModel<typeof documentRelations>): DocumentRelation {
  return {
    id: row.id,
    derivedDocumentId: row.sourceDocumentId,
    upstreamDocumentId: row.targetDocumentId,
    relationType: row.relationType as 'template' | 'localization',
    syncedUpstreamVersion: row.syncedVersion,
    syncedUpstreamVersionId: row.syncedVersionId,
    metadata: row.metadata as DocumentRelation['metadata'],
    createdAt: toIsoTimestamp(row.createdAt),
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
  const rows = await db()
    .select()
    .from(documentRelations)
    .where(and(
      eq(documentRelations.sourceDocumentId, derivedDocumentId),
      eq(documentRelations.relationType, relationType),
    ));
  const row = rows.at(0);
  return row === undefined ? null : mapRelationRow(row);
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
  const rows = await db()
    .select()
    .from(documentRelations)
    .where(and(
      eq(documentRelations.targetDocumentId, upstreamDocumentId),
      eq(documentRelations.relationType, 'localization'),
    ))
    .orderBy(asc(documentRelations.createdAt));
  return rows.map(mapRelationRow);
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
 * of an edge can be checked in one query.
 *
 * A null `inherited` returns the first arm alone, for a branch with no distinct
 * main to inherit from. Otherwise `pubAlias` names that end's
 * {@link publishedOnBranchJoin}, which carries whether main published it.
 *
 * @see workers/src/services/branch-document-service.ts (listDocumentsOnBranch)
 */
function visibleOnBranch(
  alias: SQL,
  branchId: string,
  inherited: { pubAlias: SQL; mainBranchId: string } | null,
): SQL {
  const liveOnBranch = sql`(
      EXISTS (
        SELECT 1 FROM app.document_versions dv
         WHERE dv.document_id = ${alias}.id AND dv.branch_id = ${branchId}
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.document_versions dv_tomb
         WHERE dv_tomb.document_id = ${alias}.id AND dv_tomb.branch_id = ${branchId}
           AND dv_tomb.is_tombstone = true
           AND dv_tomb.version_number = (
             SELECT MAX(dv_latest.version_number) FROM app.document_versions dv_latest
              WHERE dv_latest.document_id = ${alias}.id AND dv_latest.branch_id = ${branchId}
           )
      )
    )`;

  if (inherited === null) {
    return liveOnBranch;
  }

  const { pubAlias, mainBranchId } = inherited;
  return sql`(
    ${liveOnBranch}
    OR (
      NOT EXISTS (
        SELECT 1 FROM app.document_versions dv
         WHERE dv.document_id = ${alias}.id AND dv.branch_id = ${branchId}
      )
      AND ${pubAlias}.document_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM app.document_versions dv_tomb
         WHERE dv_tomb.document_id = ${alias}.id AND dv_tomb.branch_id = ${mainBranchId}
           AND dv_tomb.is_tombstone = true
           AND dv_tomb.version_number = (
             SELECT MAX(dv_latest.version_number) FROM app.document_versions dv_latest
              WHERE dv_latest.document_id = ${alias}.id AND dv_latest.branch_id = ${mainBranchId}
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
  const inherited = branchInheritsFromMain(branchId, mainBranchId)
    ? { pubAlias: sql`pub_d`, mainBranchId }
    : null;
  // One row beyond the page answers whether another page remains.
  const result = await db().execute<DriftCandidateRow>(sql`
    SELECT d.id, COALESCE(bdp.path, d.path) AS path, d.locale
       FROM app.document_relations dr
       JOIN app.documents d ON d.id = dr.source_document_id
       ${branchDocumentPathJoin(branchId)}
       -- An archived upstream is nothing to reconcile against. An upstream deleted on
       -- the branch it is read from is dropped by the summary instead, since which
       -- branch that is gets resolved per document.
       JOIN app.documents upstream
         ON upstream.id = dr.target_document_id AND upstream.archived_at IS NULL
       ${inherited === null
    ? sql``
    : publishedOnBranchJoin(inherited.pubAlias, sql`d`, inherited.mainBranchId)}
      WHERE dr.relation_type = ${relationType}
        -- Pinned to nothing, so the diff would run the upstream against itself.
        -- A localization edge pins by version identity, a template edge by number.
        -- Whether a pinned document has actually drifted is settled by the
        -- comparison, which resolves either pin without consulting this branch.
        AND CASE WHEN ${relationType}::text = 'localization'
                 THEN dr.synced_version_id IS NOT NULL
                 ELSE dr.synced_version IS NOT NULL
            END
        AND d.archived_at IS NULL
        AND ${visibleOnBranch(sql`d`, branchId, inherited)}
      ORDER BY COALESCE(bdp.path, d.path) ASC
      LIMIT ${page.limit + 1} OFFSET ${page.offset}`);

  const rows = result.slice(0, page.limit);
  return {
    candidates: rows.map((row) => ({
      documentId: row.id,
      path: row.path,
      locale: row.locale,
    })),
    hasMore: result.length > page.limit,
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
  const inheritsMain = branchInheritsFromMain(branchId, mainBranchId);
  const derived = inheritsMain ? { pubAlias: sql`pub_d`, mainBranchId } : null;
  const upstream = inheritsMain ? { pubAlias: sql`pub_u`, mainBranchId } : null;
  const result = await db().execute<LocaleVariantQueryRow>(sql`
    SELECT dr.target_document_id AS canonical_document_id, d.id,
            COALESCE(bdp.path, d.path) AS path, d.locale
       FROM app.documents d
       ${branchDocumentPathJoin(branchId)}
       JOIN app.document_relations dr
         ON dr.source_document_id = d.id AND dr.relation_type = 'localization'
       JOIN app.documents upstream ON upstream.id = dr.target_document_id
       ${derived === null
    ? sql``
    : publishedOnBranchJoin(derived.pubAlias, sql`d`, derived.mainBranchId)}
       ${upstream === null
    ? sql``
    : publishedOnBranchJoin(upstream.pubAlias, sql`upstream`, upstream.mainBranchId)}
      WHERE ${documentInBranchSitePredicate(branchId)}
        AND d.archived_at IS NULL
        AND d.locale IS NOT NULL
        AND upstream.archived_at IS NULL
        AND ${visibleOnBranch(sql`d`, branchId, derived)}
        AND ${visibleOnBranch(sql`upstream`, branchId, upstream)}
      ORDER BY dr.target_document_id ASC`);

  return result.map((row) => ({
    canonicalDocumentId: row.canonical_document_id,
    documentId: row.id,
    path: row.path,
    locale: row.locale,
  }));
}

/**
 * A canonical's translation in one locale, wherever it was authored.
 */
export interface TranslationInLocale {
  documentId: string;
  /** Whether the branch serves the translation: its own live version, or main's published one. */
  liveOnBranch: boolean;
  syncedUpstreamVersion: number | null;
  syncedUpstreamVersionId: string | null;
}

/**
 * The translation of a canonical in the given locale, or null when the site holds
 * none. Documents are site-scoped, so one row serves every branch and the locale
 * is held at most once across the whole site.
 *
 * `liveOnBranch` applies the same visibility rule as {@link listLocaleVariantsOnBranch},
 * so a caller deciding whether the locale is available and a caller listing what the
 * branch holds answer from one rule.
 */
export async function findTranslationInLocale(
  canonicalDocumentId: string,
  locale: string,
  branchId: string,
  mainBranchId: string | undefined,
): Promise<TranslationInLocale | null> {
  const inherited = branchInheritsFromMain(branchId, mainBranchId)
    ? { pubAlias: sql`pub_d`, mainBranchId }
    : null;
  const result = await db().execute<{
    id: string;
    live_on_branch: boolean;
    synced_version: number | null;
    synced_version_id: string | null;
  }>(sql`
    SELECT d.id, dr.synced_version, dr.synced_version_id,
           ${visibleOnBranch(sql`d`, branchId, inherited)} AS live_on_branch
      FROM app.documents d
      JOIN app.document_relations dr
        ON dr.source_document_id = d.id AND dr.relation_type = 'localization'
      ${inherited === null
    ? sql``
    : publishedOnBranchJoin(inherited.pubAlias, sql`d`, inherited.mainBranchId)}
     WHERE dr.target_document_id = ${canonicalDocumentId}
       AND d.locale = ${locale}
       AND d.archived_at IS NULL
     -- Nothing constrains a canonical to one unarchived translation per locale, and
     -- which row comes back decides both the answer and the document a take-over
     -- versions. One the branch serves settles the locale as taken; an unordered
     -- pick could answer from a second row and take over alongside it.
     ORDER BY live_on_branch DESC
     LIMIT 1`);

  const row = result[0];
  if (row === undefined) {
    return null;
  }
  return {
    documentId: row.id,
    liveOnBranch: row.live_on_branch,
    syncedUpstreamVersion: row.synced_version,
    syncedUpstreamVersionId: row.synced_version_id,
  };
}

/**
 * The ids of a canonical's translations that the branch serves: the ones it holds a
 * live version of, and the ones it inherits published from main. Answers for every
 * locale at once, so a listing costs one query rather than one per variant.
 */
export async function listServedTranslationIds(
  canonicalDocumentId: string,
  branchId: string,
  mainBranchId: string | undefined,
): Promise<Set<string>> {
  const inherited = branchInheritsFromMain(branchId, mainBranchId)
    ? { pubAlias: sql`pub_d`, mainBranchId }
    : null;
  const result = await db().execute<{ id: string }>(sql`
    SELECT d.id
      FROM app.documents d
      JOIN app.document_relations dr
        ON dr.source_document_id = d.id AND dr.relation_type = 'localization'
      ${inherited === null
    ? sql``
    : publishedOnBranchJoin(inherited.pubAlias, sql`d`, inherited.mainBranchId)}
     WHERE dr.target_document_id = ${canonicalDocumentId}
       AND d.archived_at IS NULL
       AND ${visibleOnBranch(sql`d`, branchId, inherited)}`);

  return new Set(result.map((row) => row.id));
}

/**
 * Writes a localization edge from a translation (derived) to its canonical
 * (upstream). Runs on the caller's connection, so it participates in an ambient
 * transaction.
 */
export async function createLocalizationEdge(
  params: CreateLocalizationEdgeParams,
): Promise<DocumentRelation> {
  const [row] = await db()
    .insert(documentRelations)
    .values({
      sourceDocumentId: params.derivedDocumentId,
      targetDocumentId: params.upstreamDocumentId,
      relationType: 'localization',
      syncedVersion: params.syncedUpstreamVersion,
      syncedVersionId: params.syncedUpstreamVersionId,
    })
    .returning();
  if (row === undefined) {
    throw new Error('Failed to insert localization edge');
  }
  return mapRelationRow(row);
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
  const branchIds = mainBranchId !== undefined && mainBranchId !== branchId
    ? [branchId, mainBranchId]
    : [branchId];
  const rows = await db()
    .select({ resolutions: documentRelationBranchResolutions.resolutions })
    .from(documentRelationBranchResolutions)
    .where(and(
      eq(documentRelationBranchResolutions.sourceDocumentId, derivedDocumentId),
      eq(documentRelationBranchResolutions.relationType, 'localization'),
      inArray(documentRelationBranchResolutions.branchId, branchIds),
    ))
    // The branch's own row answers ahead of the one it inherits from main.
    .orderBy(desc(sql`${documentRelationBranchResolutions.branchId} = ${branchId}`))
    .limit(1);
  const stored = rows.at(0)?.resolutions;
  return stored === undefined
    ? new Map()
    : resolutionsFromJson(stored);
}

/**
 * The edge's `metadata`, one of its per-prop maps, and one slot within that map,
 * each read straight off the row being updated and each falling back to an empty
 * object when what is stored is not one.
 *
 * These must stay direct references to `metadata`, not a CTE or sub-select. Under
 * READ COMMITTED a statement that waits on a concurrently updated row re-evaluates
 * expressions over the row it finally locks; a sub-select keeps the snapshot it
 * started with, and a map read through one loses the concurrent update.
 */
const AUTHORITY_KEY_SQL = sql`${AUTHORITY_KEY}::text`;

const STORED_METADATA = sql`(CASE WHEN jsonb_typeof(metadata) = 'object'
       THEN metadata ELSE '{}'::jsonb END)`;

const STORED_AUTHORITY = sql`(CASE WHEN jsonb_typeof(metadata -> ${AUTHORITY_KEY_SQL}) = 'object'
       THEN metadata -> ${AUTHORITY_KEY_SQL} ELSE '{}'::jsonb END)`;

/** The slot `slotId` names within the stored authority map. */
function storedAuthoritySlot(slotId: string): SQL {
  return sql`(CASE WHEN jsonb_typeof(metadata -> ${AUTHORITY_KEY_SQL} -> ${slotId}::text) = 'object'
       THEN metadata -> ${AUTHORITY_KEY_SQL} -> ${slotId}::text ELSE '{}'::jsonb END)`;
}

/** A type alias, not an interface: db().execute<T>() constrains T to Record<string, unknown>. */
type AuthorityEntryRow = { stored: string | null };

/** On the same terms as {@link AuthorityEntryRow}. */
type StoredResolutionsRow = { stored: UpstreamResolutionsJson };

/** On the same terms as {@link AuthorityEntryRow}. */
type DriftCandidateRow = { id: string; path: string; locale: string | null };

/** On the same terms as {@link AuthorityEntryRow}. */
type LocaleVariantQueryRow = {
  canonical_document_id: string;
  id: string;
  path: string;
  locale: string;
};

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
  const slot = storedAuthoritySlot(slotId);
  const rows = await db().execute<AuthorityEntryRow>(sql`
    UPDATE app.document_relations
        SET metadata = CASE
              WHEN COALESCE(${slot} ? ${propName}::text, false)
                OR (
                  SELECT COUNT(*)
                    FROM jsonb_each(${map}) slot,
                         jsonb_each(slot.value) prop
                ) < ${MAX_OVERRIDE_ENTRIES}
              THEN ${STORED_METADATA} || jsonb_build_object(
                     ${AUTHORITY_KEY_SQL},
                     ${map} || jsonb_build_object(
                       ${slotId}::text,
                       ${slot} || jsonb_build_object(${propName}::text, ${value}::text)
                     )
                   )
              ELSE metadata
            END
      WHERE source_document_id = ${derivedDocumentId} AND relation_type = 'localization'
      RETURNING metadata -> ${AUTHORITY_KEY_SQL} -> ${slotId}::text ->> ${propName}::text AS stored`);
  const row = rows.at(0);
  if (row === undefined) {
    return { hasEdge: false, stored: null };
  }
  return { hasEdge: true, stored: row.stored };
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
  const slot = storedAuthoritySlot(slotId);
  await db().execute(sql`
    UPDATE app.document_relations
        SET metadata = ${STORED_METADATA} || jsonb_build_object(
              ${AUTHORITY_KEY_SQL},
              CASE WHEN (${slot} - ${propName}::text) = '{}'::jsonb
                   THEN ${map} - ${slotId}::text
                   ELSE ${map} || jsonb_build_object(
                          ${slotId}::text,
                          ${slot} - ${propName}::text
                        )
              END
            )
      WHERE source_document_id = ${derivedDocumentId} AND relation_type = 'localization'`);
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
function jsonObject(source: SQL): SQL {
  return sql`(CASE WHEN jsonb_typeof(${source}) = 'object' THEN ${source} ELSE '{}'::jsonb END)`;
}

/**
 * The map at `source` merged with the batch bound to `batchParam`, slot by slot,
 * so props the batch does not name stay where they were.
 */
function mergedWithBatch(source: SQL, batch: SQL): SQL {
  return sql`(
  SELECT COALESCE(jsonb_object_agg(m.slot, m.props), '{}'::jsonb) FROM (
    SELECT COALESCE(stored.key, batch.key) AS slot,
           COALESCE(${jsonObject(sql`stored.value`)}, '{}'::jsonb)
             || COALESCE(batch.value, '{}'::jsonb) AS props
      FROM jsonb_each(${jsonObject(source)}) stored
      FULL OUTER JOIN jsonb_each(${batch}) batch ON batch.key = stored.key
  ) m)`;
}

/**
 * The map at `source` minus the props the batch bound to `batchParam` names,
 * dropping a slot left with none.
 */
function prunedByBatch(source: SQL, batch: SQL): SQL {
  return sql`(
  SELECT COALESCE(jsonb_object_agg(m.slot, m.props), '{}'::jsonb) FROM (
    SELECT stored.key AS slot,
           ${jsonObject(sql`stored.value`)} - (
             SELECT COALESCE(array_agg(p.path), ARRAY[]::text[])
               FROM jsonb_array_elements_text(
                      COALESCE(${batch} -> stored.key, '[]'::jsonb)
                    ) AS p(path)
           ) AS props
      FROM jsonb_each(${jsonObject(source)}) stored
  ) m WHERE m.props <> '{}'::jsonb)`;
}

/** How many entries the map at `source` holds, counted over every slot. */
function entryCount(source: SQL): SQL {
  return sql`(SELECT COUNT(*) FROM jsonb_each(${source}) slot, jsonb_each(slot.value) prop)`;
}

/**
 * The map a branch inherits: main's, named by the branch parameter at
 * `branchParam`. Empty on main, and empty when main holds none.
 */
function inheritedMap(derivedDocumentId: string, branchId: string): SQL {
  return sql`COALESCE((
    SELECT i.resolutions FROM app.document_relation_branch_resolutions i
     WHERE i.source_document_id = ${derivedDocumentId} AND i.relation_type = 'localization'
       AND i.branch_id = ${branchId}
  ), '{}'::jsonb)`;
}

/** The row being updated on a conflict; `r` is the conflict target. */
const STORED_RESOLUTIONS = sql`r.resolutions`;

/**
 * The batch as `{slotId: {propPath: {hash, at}}}`. It reaches the statement
 * stringified: the Drizzle client serializes json as identity, so an object bound
 * to a `jsonb` parameter would arrive as `[object Object]`.
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
  const at = new Date().toISOString();
  const batch = sql`${JSON.stringify(resolutionBatch(entries, at))}::jsonb`;
  const inherited = inheritedMap(derivedDocumentId, mainBranchId ?? branchId);
  const seeded = mergedWithBatch(inherited, batch);
  const seededFits = sql`${entryCount(seeded)} <= ${MAX_OVERRIDE_ENTRIES}`;
  const merged = mergedWithBatch(STORED_RESOLUTIONS, batch);
  const rows = await db().execute<StoredResolutionsRow>(sql`
    INSERT INTO app.document_relation_branch_resolutions AS r
       (source_document_id, relation_type, branch_id, resolutions, inherited)
     SELECT ${derivedDocumentId}, 'localization', ${branchId},
            CASE WHEN ${seededFits} THEN ${seeded} ELSE ${batch} END,
            CASE WHEN ${seededFits} THEN ${inherited} ELSE '{}'::jsonb END
      WHERE EXISTS (
        SELECT 1 FROM app.document_relations
         WHERE source_document_id = ${derivedDocumentId} AND relation_type = 'localization'
      )
     ON CONFLICT (source_document_id, relation_type, branch_id)
     DO UPDATE SET
       resolutions = CASE
         WHEN ${entryCount(merged)} <= ${MAX_OVERRIDE_ENTRIES}
         THEN ${merged}
         ELSE r.resolutions
       END,
       updated_at = NOW()
     RETURNING resolutions AS stored`);
  const stored = rows.at(0)?.stored;
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
  const batch = sql`${JSON.stringify(clearBatch(targets))}::jsonb`;
  const inherited = inheritedMap(derivedDocumentId, mainBranchId ?? branchId);
  const rows = await db().execute<StoredResolutionsRow>(sql`
    INSERT INTO app.document_relation_branch_resolutions AS r
       (source_document_id, relation_type, branch_id, resolutions, inherited)
     SELECT ${derivedDocumentId}, 'localization', ${branchId},
            ${prunedByBatch(inherited, batch)}, ${inherited}
      WHERE EXISTS (
        SELECT 1 FROM app.document_relations
         WHERE source_document_id = ${derivedDocumentId} AND relation_type = 'localization'
      )
        AND (
          EXISTS (
            SELECT 1 FROM app.document_relation_branch_resolutions own
             WHERE own.source_document_id = ${derivedDocumentId}
               AND own.relation_type = 'localization'
               AND own.branch_id = ${branchId}
          )
          OR ${prunedByBatch(inherited, batch)} <> ${jsonObject(inherited)}
        )
     ON CONFLICT (source_document_id, relation_type, branch_id)
     DO UPDATE SET
       resolutions = ${prunedByBatch(STORED_RESOLUTIONS, batch)}, updated_at = NOW()
     RETURNING resolutions AS stored`);
  const stored = rows.at(0)?.stored;
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
 *
 * `baseline` names, for every pointer either batch touches, the value `inherited`
 * held there — the value both this branch and the branch it inherited from last
 * agreed on. It is what the receiving branch is expected to still hold for that
 * pointer; a pointer left out of `baseline` was expected to hold nothing.
 */
interface CarriedResolutions {
  sets: Record<string, Record<string, UpstreamResolution>>;
  clears: Record<string, string[]>;
  baseline: Record<string, Record<string, UpstreamResolution>>;
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
  const baseline = Object.create(null) as Record<string, Record<string, UpstreamResolution>>;
  const markBaseline = (slotId: string, propPath: string, resolution: UpstreamResolution): void => {
    const slot = baseline[slotId] ?? (Object.create(null) as Record<string, UpstreamResolution>);
    slot[propPath] = resolution;
    baseline[slotId] = slot;
  };
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
      if (came !== undefined) {
        markBaseline(slotId, propPath, came);
      }
      settled = true;
    }
  }
  for (const [slotId, props] of inherited) {
    for (const [propPath, resolution] of props) {
      if (holds.get(slotId)?.has(propPath) === true) {
        continue;
      }
      clears[slotId] = [...(clears[slotId] ?? []), propPath];
      markBaseline(slotId, propPath, resolution);
      settled = true;
    }
  }
  return settled ? { sets, clears, baseline } : null;
}

/**
 * The SET batch at `setsParam` (`{slot: {prop: resolution}}`), pruned to the
 * pointers where `stored`'s current value for that pointer is not distinct from
 * `baselineParam`'s — the value the carrying branch last agreed the receiving
 * branch held there. A pointer `stored` now holds differently, or holds when
 * `baselineParam` expected none, has been settled or cleared independently on the
 * receiving branch since, and is left out so the carry does not overwrite it.
 */
function setsUnlessTargetDiverged(setsParam: SQL, stored: SQL, baselineParam: SQL): SQL {
  return sql`(
  SELECT COALESCE(jsonb_object_agg(b.slot, b.props), '{}'::jsonb) FROM (
    SELECT slot.key AS slot,
           (SELECT COALESCE(jsonb_object_agg(prop.key, prop.value), '{}'::jsonb)
              FROM jsonb_each(slot.value) prop
             WHERE NOT (
               (${jsonObject(stored)} -> slot.key -> prop.key)
                 IS DISTINCT FROM (${jsonObject(baselineParam)} -> slot.key -> prop.key)
             )
           ) AS props
      FROM jsonb_each(${setsParam}) slot
  ) b WHERE b.props <> '{}'::jsonb)`;
}

/**
 * The CLEAR batch at `clearsParam` (`{slot: [prop, ...]}`), pruned on the same
 * terms as `setsUnlessTargetDiverged`: only the pointers where `stored` still
 * holds what `baselineParam` expects, so a clear from the batch does not remove a
 * resolution the receiving branch has recorded, or changed, on its own since.
 */
function clearsUnlessTargetDiverged(clearsParam: SQL, stored: SQL, baselineParam: SQL): SQL {
  return sql`(
  SELECT COALESCE(jsonb_object_agg(b.slot, b.props), '{}'::jsonb) FROM (
    SELECT slot.key AS slot,
           (SELECT COALESCE(jsonb_agg(prop), '[]'::jsonb)
              FROM jsonb_array_elements_text(slot.value) prop
             WHERE NOT (
               (${jsonObject(stored)} -> slot.key -> prop)
                 IS DISTINCT FROM (${jsonObject(baselineParam)} -> slot.key -> prop)
             )
           ) AS props
      FROM jsonb_each(${clearsParam}) slot
  ) b WHERE b.props <> '[]'::jsonb)`;
}

/**
 * Applies one translation's carried batches to `targetBranchId`: the map that
 * branch holds minus the cleared pointers, merged with the recorded ones. `sets`
 * is the set batch, `clears` the clear batch, `mainBranchId` the branch to
 * inherit from, and `baseline` the baseline the carrying branch last agreed the
 * target held.
 *
 * A target with no row of its own is seeded the way its own first write seeds one:
 * main's map with the batches applied, and main's map recorded as what the row
 * started with. Main inherits nothing, so a row seeded for main starts empty.
 * Absent a row, the target's effective value for every pointer either batch
 * touches is whatever main currently holds there, so the seed guards both
 * batches against `inherited` — main's current map — exactly as the existing-row
 * path guards them against `r.resolutions`: a carried change is applied only
 * where that current value still matches `baseline`, what the carrying branch
 * last agreed the target held. Without this guard, "no row yet" would apply a
 * stale set or clear whenever main moved on that pointer after the carrying
 * branch captured its baseline — the same effective review protected only when
 * the receiver happened to already have a row from resolving an unrelated field.
 *
 * For an existing row, a pointer either batch names is applied only where the
 * row's current value for it still matches `baseline` — what the carrying branch
 * last saw there. A pointer the target has since settled, cleared, or changed on
 * its own no longer matches, and is left out of the merge, so the carry does not
 * silently overwrite work the target did on its own while the carrying branch was
 * open, in either direction.
 *
 * One statement per translation, applied slot-wise over the row's own map, so a
 * resolution recorded on the target while the carry runs survives it.
 *
 * The same statement enforces `MAX_OVERRIDE_ENTRIES` over the result. A seeded row
 * that would breach the ceiling holds the guarded set batch alone and starts from
 * nothing, both columns turning on the one condition so they cannot disagree
 * about which map the row began as — the fallback reuses the same filtered batch
 * the ceiling check itself was computed from, so it cannot reintroduce a set the
 * guard just rejected. An existing row the batches would take past the ceiling is
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
  const sets = sql`${JSON.stringify(carried.sets)}::jsonb`;
  const clears = sql`${JSON.stringify(carried.clears)}::jsonb`;
  const baseline = sql`${JSON.stringify(carried.baseline)}::jsonb`;
  const inherited = inheritedMap(derivedDocumentId, mainBranchId);
  const seededSets = setsUnlessTargetDiverged(sets, inherited, baseline);
  const seededClears = clearsUnlessTargetDiverged(clears, inherited, baseline);
  const seeded = mergedWithBatch(prunedByBatch(inherited, seededClears), seededSets);
  const guardedSets = setsUnlessTargetDiverged(sets, STORED_RESOLUTIONS, baseline);
  const guardedClears = clearsUnlessTargetDiverged(clears, STORED_RESOLUTIONS, baseline);
  const merged = mergedWithBatch(prunedByBatch(STORED_RESOLUTIONS, guardedClears), guardedSets);
  await db().execute(sql`
    INSERT INTO app.document_relation_branch_resolutions AS r
       (source_document_id, relation_type, branch_id, resolutions, inherited)
     SELECT ${derivedDocumentId}, 'localization', ${targetBranchId},
            CASE WHEN seed.within_ceiling THEN seed.resolutions ELSE ${seededSets} END,
            CASE WHEN seed.within_ceiling THEN seed.inherited ELSE '{}'::jsonb END
       FROM (
         SELECT ${seeded} AS resolutions,
                ${inherited} AS inherited,
                ${entryCount(seeded)} <= ${MAX_OVERRIDE_ENTRIES} AS within_ceiling
       ) seed
      WHERE EXISTS (
        SELECT 1 FROM app.document_relations
         WHERE source_document_id = ${derivedDocumentId} AND relation_type = 'localization'
      )
     ON CONFLICT (source_document_id, relation_type, branch_id)
     DO UPDATE SET
       resolutions = CASE
         WHEN ${entryCount(merged)} <= ${MAX_OVERRIDE_ENTRIES}
         THEN ${merged}
         ELSE r.resolutions
       END,
       updated_at = NOW()`);
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
 * A mark the source branch's diff does touch is applied only where the target
 * still holds, for that same pointer, what the source branch's own `inherited`
 * recorded — the value both branches last agreed on. A pointer the target has
 * since recorded, cleared, or changed on its own no longer matches, and is left
 * where the target put it: the target may have settled or cleared that pointer
 * itself while the source branch was open, and a carry must not silently
 * overwrite that in either direction, any more than a source branch's own
 * untouched entries should be.
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
  const held = await db()
    .select({
      sourceDocumentId: documentRelationBranchResolutions.sourceDocumentId,
      resolutions: documentRelationBranchResolutions.resolutions,
      inherited: documentRelationBranchResolutions.inherited,
    })
    .from(documentRelationBranchResolutions)
    .where(and(
      eq(documentRelationBranchResolutions.branchId, sourceBranchId),
      eq(documentRelationBranchResolutions.relationType, 'localization'),
      // ANY over a bound array rather than notInArray: an empty exclusion list
      // has to leave every row in, and sql.param keeps the array one parameter
      // instead of a row constructor.
      sql`NOT (${documentRelationBranchResolutions.sourceDocumentId}
        = ANY(${sql.param([...excludedDocumentIds])}::uuid[]))`,
    ));
  const carried = held.flatMap((row) => {
    const batches = carriedResolutions(
      resolutionsFromJson(row.resolutions),
      resolutionsFromJson(row.inherited),
    );
    return batches === null ? [] : [{ derivedDocumentId: row.sourceDocumentId, batches }];
  });
  if (carried.length === 0) {
    return;
  }
  const mainBranchId = (await findMainBranchId(targetBranchId)) ?? targetBranchId;
  for (const { derivedDocumentId, batches } of carried) {
    await applyCarriedResolutions(derivedDocumentId, targetBranchId, mainBranchId, batches);
  }
}
