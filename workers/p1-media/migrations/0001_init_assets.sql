-- PCC-3383: versioned, site-scoped asset model.
-- Assets are logical identities with mutable metadata defaults; each upload or
-- replacement creates an immutable version. Metadata is a JSON blob (SQLite TEXT +
-- JSON1); `alt` is promoted to its own column for indexed search (R11).

CREATE TABLE IF NOT EXISTS assets (
  asset_id            TEXT PRIMARY KEY,
  site_id             TEXT NOT NULL,
  org_id              TEXT,                 -- stub: unused until CCR grows an org auth tier
  filename            TEXT NOT NULL,
  alt                 TEXT,                 -- promoted from metadata for indexed search
  metadata            TEXT,                 -- JSON blob: caption, credit, byline, …
  meta_schema_version INTEGER,             -- schema version the metadata conforms to (R12)
  current_version     TEXT NOT NULL,        -- versionId the picker selects by default
  created_at          TEXT NOT NULL,
  created_by          TEXT,
  deleted_at          TEXT                  -- soft delete: hidden from library, keeps serving
);

-- Library listing is scoped by site and ordered newest-first.
CREATE INDEX IF NOT EXISTS idx_assets_site ON assets (site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS asset_versions (
  version_id   TEXT NOT NULL,
  asset_id     TEXT NOT NULL REFERENCES assets (asset_id),
  r2_key       TEXT NOT NULL,               -- {siteId}/assets/{assetId}/{versionId}-{filename}
  content_type TEXT,
  size         INTEGER,
  width        INTEGER,
  height       INTEGER,
  uploaded_at  TEXT,
  uploaded_by  TEXT,
  PRIMARY KEY (asset_id, version_id)
);
