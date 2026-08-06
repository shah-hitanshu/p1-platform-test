import type { Env, AssetRow, AssetVersionRow, MediaAsset } from './types';
import { METADATA_SCHEMA_VERSION } from './schema';

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
}): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = [opts.siteId];
  let sql =
    'SELECT a.asset_id, a.filename, a.alt, a.metadata, a.meta_schema_version, ' +
    'a.current_version, a.created_at, ' +
    'v.r2_key, v.content_type, v.size, v.width, v.height ' +
    'FROM assets a ' +
    'JOIN asset_versions v ON v.asset_id = a.asset_id AND v.version_id = a.current_version ' +
    'WHERE a.site_id = ? AND a.deleted_at IS NULL';

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

  // OR IGNORE: the getAsset() check above only catches a SEQUENTIAL retry. Under a
  // genuinely concurrent double-finalize (two requests for the same assetId/versionId
  // racing past that check before either commits), this makes the loser's write a
  // silent no-op instead of an uncaught PRIMARY KEY violation — both callers then read
  // back the same row via getAsset() below, preserving the idempotent contract.
  await env.MEDIA_DB.batch([
    env.MEDIA_DB.prepare(
      'INSERT OR IGNORE INTO assets (asset_id, site_id, filename, alt, metadata, meta_schema_version, current_version, created_at, created_by) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
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

/** Loads a single asset scoped to its owning site (R0). Returns null if absent/foreign/deleted. */
export async function getAsset(env: Env, siteId: string, assetId: string): Promise<MediaAsset | null> {
  const row = await env.MEDIA_DB.prepare(
    'SELECT a.asset_id, a.filename, a.alt, a.metadata, a.meta_schema_version, a.current_version, a.created_at, ' +
      'v.r2_key, v.content_type, v.size, v.width, v.height ' +
      'FROM assets a ' +
      'JOIN asset_versions v ON v.asset_id = a.asset_id AND v.version_id = a.current_version ' +
      'WHERE a.asset_id = ? AND a.site_id = ? AND a.deleted_at IS NULL',
  )
    .bind(assetId, siteId)
    .first<AssetRow & AssetVersionRow>();
  return row ? rowToAsset(row, env.CDN_BASE_URL) : null;
}

/** Lists a site's assets, newest first, with optional filename/alt search (R11). */
export async function listAssets(
  env: Env,
  siteId: string,
  opts: { search?: string; limit?: number } = {},
): Promise<MediaAsset[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const { sql, params } = buildListQuery({ siteId, search: opts.search, limit });
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

function safeParse(json: string): Record<string, string> {
  try {
    return JSON.parse(json) as Record<string, string>;
  } catch {
    return {};
  }
}
