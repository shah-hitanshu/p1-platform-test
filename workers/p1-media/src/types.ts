export interface Env {
  MEDIA_BUCKET: R2Bucket;
  MEDIA_DB: D1Database;
  CSS_BASE_URL: string;
  CDN_BASE_URL: string;
  CSS_SERVICE?: Fetcher;
  MAX_UPLOAD_BYTES?: string;
  IMAGES: ImagesBinding;
  // R2 S3-compatible API credentials, used to sign presigned PUT URLs for direct
  // browser-to-R2 uploads. Distinct from the MEDIA_BUCKET binding (which has no
  // presign capability) — set via `wrangler secret put`, never committed.
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  // Orphan-reconcile Cron Trigger: defaults to dry-run (log candidates, delete
  // nothing) unless this is literally the string "false" — unset/misconfigured
  // must fail safe. See handlers/reconcile.ts.
  RECONCILE_DRY_RUN?: string;
}

// ---------------------------------------------------------------------------
// D1 row shapes (snake_case — as stored)
// ---------------------------------------------------------------------------

export interface AssetRow {
  asset_id: string;
  site_id: string;
  org_id: string | null; // stub — unused until CCR grows an org auth tier
  filename: string;
  alt: string | null; // promoted from metadata for indexed search
  metadata: string | null; // JSON blob (SQLite TEXT + JSON1)
  meta_schema_version: number | null;
  current_version: string;
  created_at: string;
  created_by: string | null;
  deleted_at: string | null;
}

export interface AssetVersionRow {
  version_id: string;
  asset_id: string;
  r2_key: string;
  content_type: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  uploaded_at: string | null;
  uploaded_by: string | null;
}

// ---------------------------------------------------------------------------
// API shapes (camelCase — as returned)
// ---------------------------------------------------------------------------

// Clean asset-shaped list/detail item. Replaces the legacy bare-key MediaItem;
// consumers are migrated once (see design R1), not carried on a compat layer.
//
// `metadata` is a single FLAT map of every advertised schema field that is set —
// including `alt`. It is stored with `alt` promoted to its own column for indexed
// search, but presented uniformly so a schema-driven consumer addresses every field
// the same way (no special-casing alt). The plugin spreads this map into its flat
// MediaValue: { assetId, versionId, url, metaSchemaVersion, ...metadata }.
export interface MediaAsset {
  assetId: string;
  versionId: string; // the current version
  url: string; // immutable CDN URL for the current version
  filename: string;
  contentType?: string;
  size?: number;
  width?: number;
  height?: number;
  metadata: Record<string, string>; // flat; includes alt when set
  metaSchemaVersion?: number;
  createdAt?: string;
}
