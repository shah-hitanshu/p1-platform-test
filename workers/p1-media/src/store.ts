import type { Env, AssetRow, AssetVersionRow, MediaAsset } from './types';
import { METADATA_SCHEMA_VERSION } from './schema';
import { CHAT_RETENTION_DAYS, type AssetOrigin } from './upload-shared';

// R2 key limit is 1024 bytes; the composed prefix is ~95 chars.
const MAX_FILENAME_BYTES = 200;

/** Raised when a caller acts on an asset that isn't theirs / doesn't exist (R0). */
export class NotFoundError extends Error {}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable without a DB)
// ---------------------------------------------------------------------------

/**
 * Sanitizes a client filename for use in an R2 key: non-alphanumerics (except dot
 * and hyphen) → "-", collapse repeated dots, strip leading/trailing dots, truncate.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9.-]/g, '-')
    .replace(/\.{2,}/g, '-')
    // (?<!\.) anchors where the trailing branch may start matching — without it,
    // \.+$ is ambiguous about its start position within a run of dots, which is
    // quadratic time on a long run (CodeQL js/polynomial-redos).
    .replace(/^\.+|(?<!\.)\.+$/g, '')
    .slice(0, MAX_FILENAME_BYTES);
}

/** Escapes LIKE wildcards so user search terms match literally (R11). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function buildKey(siteId: string, assetId: string, versionId: string, filename: string): string {
  return `${siteId}/assets/${assetId}/${versionId}-${filename}`;
}

export function cdnUrl(cdnBaseUrl: string, r2Key: string): string {
  const encoded = r2Key.split('/').map(encodeURIComponent).join('/');
  return `${cdnBaseUrl}/${encoded}`;
}

/**
 * Builds the site-scoped list query. Kept pure and separate so the R11 escaping and
 * mandatory site_id filter are directly testable. Search matches the filename, the
 * promoted alt column, or any string VALUE in the metadata blob (caption, credit, …
 * — values only, so a term like "caption" doesn't match every asset carrying that
 * field). json_valid guards the json_each scan: one corrupt blob must not fail the
 * whole listing (rowToAsset tolerates the same).
 */
export function buildListQuery(opts: {
  siteId: string;
  search?: string;
  limit: number;
  origin?: AssetOrigin;
}): { sql: string; params: (string | number)[] } {
  // Defaulted here, not at the caller, so every existing route excludes chat at once.
  // Pre-existing rows read as 'library', making this a no-op over old data.
  const params: (string | number)[] = [opts.siteId, opts.origin ?? 'library'];
  let sql =
    'SELECT a.asset_id, a.filename, a.alt, a.metadata, a.meta_schema_version, ' +
    'a.current_version, a.created_at, a.origin, ' +
    'v.r2_key, v.content_type, v.size, v.width, v.height ' +
    'FROM assets a ' +
    'JOIN asset_versions v ON v.asset_id = a.asset_id AND v.version_id = a.current_version ' +
    'WHERE a.site_id = ? AND a.origin = ? AND a.deleted_at IS NULL';

  if (opts.search) {
    const like = `%${escapeLike(opts.search.toLowerCase())}%`;
    sql +=
      " AND (LOWER(a.filename) LIKE ? ESCAPE '\\' OR LOWER(a.alt) LIKE ? ESCAPE '\\'" +
      ' OR (a.metadata IS NOT NULL AND json_valid(a.metadata) AND EXISTS (' +
      'SELECT 1 FROM json_each(a.metadata) ' +
      "WHERE json_each.type = 'text' AND LOWER(json_each.value) LIKE ? ESCAPE '\\')))";
    params.push(like, like, like);
  }

  sql += ' ORDER BY a.created_at DESC LIMIT ?';
  params.push(opts.limit);
  return { sql, params };
}

/** Maps a joined asset+version row to the API shape. */
export function rowToAsset(
  row: AssetRow & Partial<AssetVersionRow>,
  cdnBaseUrl: string,
): MediaAsset {
  // Fold the promoted `alt` column back into the flat metadata map so every schema
  // field is addressed uniformly by consumers.
  let metadata: Record<string, string> = {};
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, string>;
    } catch {
      // Corrupt blob — present no metadata rather than fail the whole listing.
      metadata = {};
    }
  }
  if (row.alt != null) metadata.alt = row.alt;

  const asset: MediaAsset = {
    assetId: row.asset_id,
    versionId: row.current_version,
    url: cdnUrl(cdnBaseUrl, row.r2_key ?? ''),
    filename: row.filename,
    metadata,
  };
  if (row.content_type != null) asset.contentType = row.content_type;
  if (row.size != null) asset.size = row.size;
  if (row.width != null) asset.width = row.width;
  if (row.height != null) asset.height = row.height;
  if (row.meta_schema_version != null) asset.metaSchemaVersion = row.meta_schema_version;
  if (row.created_at != null) asset.createdAt = row.created_at;
  // Absent rather than 'library' — see MediaAsset.origin.
  if (row.origin != null && row.origin !== 'library') asset.origin = row.origin;
  return asset;
}

// ---------------------------------------------------------------------------
// R2 + D1 composite operations
// ---------------------------------------------------------------------------

export interface FinalizedUpload {
  siteId: string;
  assetId: string;
  versionId: string;
  filename: string; // sanitized
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  createdBy?: string;
  metadata?: Record<string, string>;
  /** Omitted means 'library'. */
  origin?: AssetOrigin;
}

/**
 * Completes a presigned upload: bytes already landed in R2 (the caller confirms this
 * via `head()` before calling here), so this only performs the D1 write. The key is
 * rebuilt from siteId/assetId/versionId/filename rather than accepted as a param, so a
 * caller can never point this at an arbitrary path — it can only ever reference what
 * buildKey derives (and that derivation must match what the presigned URL was actually
 * signed for, or the caller's own head() check would already have failed).
 *
 * Idempotent: if this assetId already exists (e.g. a client retries finalize after a
 * network blip masked an actual prior success), returns the existing asset rather than
 * attempting a duplicate insert.
 */
export async function finalizeAssetCreation(env: Env, fu: FinalizedUpload): Promise<MediaAsset> {
  const existing = await getAsset(env, fu.siteId, fu.assetId);
  if (existing) return existing;

  const key = buildKey(fu.siteId, fu.assetId, fu.versionId, fu.filename);
  const now = new Date().toISOString();
  const { alt, metaJson } = splitMetadata(fu.metadata);
  const origin: AssetOrigin = fu.origin ?? 'library';
  const expiresAt = origin === 'chat' ? chatExpiryFrom(now) : null;

  // OR IGNORE: the getAsset() check above only catches a SEQUENTIAL retry. Under a
  // genuinely concurrent double-finalize (two requests for the same assetId/versionId
  // racing past that check before either commits), this makes the loser's write a
  // silent no-op instead of an uncaught PRIMARY KEY violation — both callers then read
  // back the same row via getAsset() below, preserving the idempotent contract.
  await env.MEDIA_DB.batch([
    env.MEDIA_DB.prepare(
      'INSERT OR IGNORE INTO assets (asset_id, site_id, filename, alt, metadata, meta_schema_version, current_version, created_at, created_by, origin, expires_at, from_chat) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      fu.assetId,
      fu.siteId,
      fu.filename,
      alt,
      metaJson,
      METADATA_SCHEMA_VERSION,
      fu.versionId,
      now,
      fu.createdBy ?? null,
      origin,
      expiresAt,
      origin === 'chat' ? 1 : 0,
    ),
    env.MEDIA_DB.prepare(
      'INSERT OR IGNORE INTO asset_versions (version_id, asset_id, r2_key, content_type, size, width, height, uploaded_at, uploaded_by) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      fu.versionId,
      fu.assetId,
      key,
      fu.contentType,
      fu.size,
      fu.width ?? null,
      fu.height ?? null,
      now,
      fu.createdBy ?? null,
    ),
  ]);

  const asset = await getAsset(env, fu.siteId, fu.assetId);
  if (!asset) throw new Error('Asset vanished immediately after finalize');
  return asset;
}

/**
 * Throws NotFoundError unless assetId is owned by siteId and not soft-deleted (R0).
 * Used at version-presign time so a client can't mint (and waste an upload against) a
 * presigned URL for an asset that doesn't exist or isn't theirs — finalize re-checks
 * this regardless, since presign never persists anything binding.
 */
export async function assertOwnedAsset(env: Env, siteId: string, assetId: string): Promise<void> {
  const owner = await env.MEDIA_DB.prepare(
    'SELECT asset_id FROM assets WHERE asset_id = ? AND site_id = ? AND deleted_at IS NULL',
  )
    .bind(assetId, siteId)
    .first<{ asset_id: string }>();
  if (!owner) throw new NotFoundError(`Asset ${assetId} not found for site`);
}

export interface FinalizedVersion {
  siteId: string;
  assetId: string;
  versionId: string;
  filename: string; // sanitized
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  uploadedBy?: string;
}

/**
 * Completes a presigned add-version upload: bytes already landed in R2 (confirmed by
 * the caller via head()), so this only performs the ownership check + the D1 write.
 * Idempotent for the same reason as finalizeAssetCreation: if this exact versionId is
 * already the asset's current version, returns the existing asset rather than
 * attempting a duplicate insert.
 */
export async function finalizeVersionAdd(env: Env, fv: FinalizedVersion): Promise<MediaAsset> {
  const owner = await env.MEDIA_DB.prepare(
    'SELECT asset_id, current_version FROM assets WHERE asset_id = ? AND site_id = ? AND deleted_at IS NULL',
  )
    .bind(fv.assetId, fv.siteId)
    .first<{ asset_id: string; current_version: string }>();
  if (!owner) throw new NotFoundError(`Asset ${fv.assetId} not found for site`);

  if (owner.current_version === fv.versionId) {
    const asset = await getAsset(env, fv.siteId, fv.assetId);
    if (asset) return asset;
  }

  const key = buildKey(fv.siteId, fv.assetId, fv.versionId, fv.filename);
  const now = new Date().toISOString();

  // OR IGNORE: see finalizeAssetCreation's identical comment — protects against a
  // concurrent double-finalize racing past the current_version check above. The
  // subsequent UPDATE is naturally idempotent regardless (same versionId either way).
  await env.MEDIA_DB.batch([
    env.MEDIA_DB.prepare(
      'INSERT OR IGNORE INTO asset_versions (version_id, asset_id, r2_key, content_type, size, width, height, uploaded_at, uploaded_by) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      fv.versionId,
      fv.assetId,
      key,
      fv.contentType,
      fv.size,
      fv.width ?? null,
      fv.height ?? null,
      now,
      fv.uploadedBy ?? null,
    ),
    env.MEDIA_DB.prepare('UPDATE assets SET current_version = ?, filename = ? WHERE asset_id = ? AND site_id = ?').bind(
      fv.versionId,
      fv.filename,
      fv.assetId,
      fv.siteId,
    ),
  ]);

  const asset = await getAsset(env, fv.siteId, fv.assetId);
  if (!asset) throw new Error('Asset vanished immediately after finalizing version');
  return asset;
}

async function getAssetRow(
  env: Env,
  siteId: string,
  assetId: string,
  /** Include a soft-deleted row — for readers that hold their own reference to it. */
  includeDeleted = false,
): Promise<(AssetRow & AssetVersionRow) | null> {
  return env.MEDIA_DB.prepare(
    'SELECT a.asset_id, a.filename, a.alt, a.metadata, a.meta_schema_version, a.current_version, a.created_at, ' +
      'a.origin, a.expires_at, a.deleted_at, ' +
      'v.r2_key, v.content_type, v.size, v.width, v.height ' +
      'FROM assets a ' +
      'JOIN asset_versions v ON v.asset_id = a.asset_id AND v.version_id = a.current_version ' +
      'WHERE a.asset_id = ? AND a.site_id = ?' +
      (includeDeleted ? '' : ' AND a.deleted_at IS NULL'),
  )
    .bind(assetId, siteId)
    .first<AssetRow & AssetVersionRow>();
}

/** Loads a single asset scoped to its owning site (R0). Returns null if absent/foreign/deleted. */
export async function getAsset(env: Env, siteId: string, assetId: string): Promise<MediaAsset | null> {
  const row = await getAssetRow(env, siteId, assetId);
  return row ? rowToAsset(row, env.CDN_BASE_URL) : null;
}

/**
 * The asset as stored, plus the current version's R2 key. The key is kept off MediaAsset,
 * which is the public response body and should not carry the storage layout.
 *
 * Soft-deleted rows are included. A library delete hides the asset from the library but not
 * from the conversation that uploaded it, which keeps its own reference and can still read
 * the file until retention collects the bytes. `deleted` reports which case this is, so
 * callers acting on the library's behalf need to check it.
 */
export async function getStoredAsset(
  env: Env,
  siteId: string,
  assetId: string,
): Promise<{ asset: MediaAsset; r2Key: string; deleted: boolean } | null> {
  const row = await getAssetRow(env, siteId, assetId, true);
  if (!row) return null;
  return {
    asset: rowToAsset(row, env.CDN_BASE_URL),
    r2Key: row.r2_key,
    deleted: row.deleted_at != null,
  };
}

/** Lists a site's assets, newest first, with optional filename/alt search (R11). */
export async function listAssets(
  env: Env,
  siteId: string,
  opts: { search?: string; limit?: number; origin?: AssetOrigin } = {},
): Promise<MediaAsset[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const { sql, params } = buildListQuery({ siteId, search: opts.search, limit, origin: opts.origin });
  const { results } = await env.MEDIA_DB.prepare(sql)
    .bind(...params)
    .all<AssetRow & AssetVersionRow>();
  return (results ?? []).map((r) => rowToAsset(r, env.CDN_BASE_URL));
}

/**
 * Updates an asset's metadata defaults (R0 ownership; caller validates against R6/R13
 * first). `alt` maps to its promoted column; other fields merge into the JSON blob
 * (null clears). Stamps the current schema version (R12). Returns null if not owned.
 */
export async function updateAssetMetadata(
  env: Env,
  siteId: string,
  assetId: string,
  patch: Record<string, string | null>,
): Promise<MediaAsset | null> {
  const existing = await env.MEDIA_DB.prepare(
    'SELECT metadata FROM assets WHERE asset_id = ? AND site_id = ? AND deleted_at IS NULL',
  )
    .bind(assetId, siteId)
    .first<{ metadata: string | null }>();
  if (!existing) return null;

  const blob: Record<string, string> = existing.metadata ? safeParse(existing.metadata) : {};
  let alt: string | null | undefined;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'alt') {
      alt = v; // may be null to clear
    } else if (v === null) {
      delete blob[k];
    } else {
      blob[k] = v;
    }
  }
  const metaJson = Object.keys(blob).length ? JSON.stringify(blob) : null;

  const sets = ['metadata = ?', 'meta_schema_version = ?'];
  const params: (string | number | null)[] = [metaJson, METADATA_SCHEMA_VERSION];
  if (alt !== undefined) {
    sets.push('alt = ?');
    params.push(alt);
  }
  params.push(assetId, siteId);

  await env.MEDIA_DB.prepare(`UPDATE assets SET ${sets.join(', ')} WHERE asset_id = ? AND site_id = ?`)
    .bind(...params)
    .run();

  return getAsset(env, siteId, assetId);
}

/**
 * Moves a chat upload into the library (R0 ownership). This updates the row in place — the R2
 * key and all ids stay the same — and clearing expires_at is what takes the asset out of the
 * retention sweep. The caller validates the content type first. Returns null if not owned.
 */
export async function promoteAsset(
  env: Env,
  siteId: string,
  assetId: string,
  /** Written in the same statement, so the asset is never in the library unlabelled. */
  metadata?: Record<string, string>,
): Promise<MediaAsset | null> {
  const { alt, metaJson } = splitMetadata(metadata);
  // deleted_at is cleared as well, so an image removed from the library can be added back.
  // The chat that uploaded it is the only place still holding a reference.
  const columns = ["origin = 'library'", 'expires_at = NULL', 'deleted_at = NULL'];
  const params: (string | number | null)[] = [];
  // Absent metadata leaves what is already there; the caller is promoting, not editing.
  if (metadata !== undefined) {
    columns.push('alt = ?', 'metadata = ?', 'meta_schema_version = ?');
    params.push(alt, metaJson, METADATA_SCHEMA_VERSION);
  }
  // from_chat, not origin: a promoted asset reads as 'library', so origin cannot tell a
  // chat upload being added back from a library asset someone deleted. Without this the
  // clause above is an undelete for any asset id the caller can name.
  const res = await env.MEDIA_DB.prepare(
    `UPDATE assets SET ${columns.join(', ')} ` +
      'WHERE asset_id = ? AND site_id = ? AND (deleted_at IS NULL OR from_chat = 1)',
  )
    .bind(...params, assetId, siteId)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return null;
  return getAsset(env, siteId, assetId);
}

/** One chat asset the retention sweep may collect, with every version's key. */
export interface ExpiredChatAsset {
  assetId: string;
  r2Keys: string[];
}

export interface ExpiredChatPage {
  assets: ExpiredChatAsset[];
  /** Everything eligible right now, including what this page left behind. */
  total: number;
}

// Shared so the count and the page can never disagree about what "expired" means.
const EXPIRED_CHAT_PREDICATE =
  "origin = 'chat' AND ((expires_at IS NOT NULL AND expires_at < ?) OR deleted_at IS NOT NULL)";

/**
 * A bounded page of chat uploads that have aged out or been cleared, plus how many are
 * eligible in total. Soft-deleted rows are included so clearing a conversation does not need
 * its own hard-delete endpoint: it calls the existing DELETE, and this picks up the bytes on
 * the next run.
 *
 * The limit is in SQL, not applied to the results: the first armed run faces however large a
 * backlog dry-run accumulated, and buffering that whole join to throw most of it away is the
 * shape that falls over. The count is a separate index-backed query, so `deferred` stays exact
 * without materializing anything.
 *
 * Not site-scoped — it runs on a Cron Trigger with no request behind it.
 */
export async function findExpiredChatAssets(env: Env, now: string, limit: number): Promise<ExpiredChatPage> {
  const counted = await env.MEDIA_DB.prepare(
    `SELECT COUNT(*) AS n FROM assets WHERE ${EXPIRED_CHAT_PREDICATE}`,
  )
    .bind(now)
    .first<{ n: number }>();

  // Bounded by asset, not by row: the join fans out over versions, and the cap the caller
  // means is a number of assets to delete.
  const { results } = await env.MEDIA_DB.prepare(
    'SELECT a.asset_id, v.r2_key FROM assets a ' +
      'JOIN asset_versions v ON v.asset_id = a.asset_id ' +
      'WHERE a.asset_id IN (' +
      `SELECT asset_id FROM assets WHERE ${EXPIRED_CHAT_PREDICATE} ORDER BY asset_id LIMIT ?` +
      ')',
  )
    .bind(now, limit)
    .all<{ asset_id: string; r2_key: string }>();

  const byAsset = new Map<string, string[]>();
  for (const row of results ?? []) {
    const keys = byAsset.get(row.asset_id);
    if (keys) keys.push(row.r2_key);
    else byAsset.set(row.asset_id, [row.r2_key]);
  }
  return {
    assets: [...byAsset].map(([assetId, r2Keys]) => ({ assetId, r2Keys })),
    total: counted?.n ?? 0,
  };
}

/**
 * Removes a chat asset's D1 rows, atomically and only while it is still a chat asset. Both
 * statements carry the origin guard, so a promote landing between the sweep's SELECT and
 * this call leaves the row untouched; without it on the versions delete, a promoted asset
 * could lose its versions and become unreadable. Returns false if no longer eligible.
 */
export async function hardDeleteChatAsset(env: Env, assetId: string): Promise<boolean> {
  const [, assetDelete] = await env.MEDIA_DB.batch([
    env.MEDIA_DB.prepare(
      'DELETE FROM asset_versions WHERE asset_id = ? ' +
        "AND EXISTS (SELECT 1 FROM assets WHERE asset_id = ? AND origin = 'chat')",
    ).bind(assetId, assetId),
    env.MEDIA_DB.prepare("DELETE FROM assets WHERE asset_id = ? AND origin = 'chat'").bind(assetId),
  ]);
  return (assetDelete.meta?.changes ?? 0) > 0;
}

/**
 * As softDeleteAsset, but only while the asset is still a chat upload. Clearing a conversation
 * should drop what that conversation uploaded; an image the user has since added to the
 * library is a library asset now, and just happens to have arrived through chat. Without this
 * guard, clearing a conversation silently removes it from the picker.
 */
export async function softDeleteChatAsset(env: Env, siteId: string, assetId: string): Promise<boolean> {
  const res = await env.MEDIA_DB.prepare(
    "UPDATE assets SET deleted_at = ? WHERE asset_id = ? AND site_id = ? AND deleted_at IS NULL AND origin = 'chat'",
  )
    .bind(new Date().toISOString(), assetId, siteId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Soft-deletes an asset (R0 ownership). Bytes keep serving; hidden from the library. Returns false if not owned. */
export async function softDeleteAsset(env: Env, siteId: string, assetId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await env.MEDIA_DB.prepare(
    'UPDATE assets SET deleted_at = ? WHERE asset_id = ? AND site_id = ? AND deleted_at IS NULL',
  )
    .bind(now, assetId, siteId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// internal
// ---------------------------------------------------------------------------

function splitMetadata(metadata?: Record<string, string>): { alt: string | null; metaJson: string | null } {
  if (!metadata) return { alt: null, metaJson: null };
  const { alt = null, ...rest } = metadata;
  const metaJson = Object.keys(rest).length ? JSON.stringify(rest) : null;
  return { alt, metaJson };
}

function chatExpiryFrom(fromIso: string): string {
  return new Date(Date.parse(fromIso) + CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function safeParse(json: string): Record<string, string> {
  try {
    return JSON.parse(json) as Record<string, string>;
  } catch {
    return {};
  }
}
