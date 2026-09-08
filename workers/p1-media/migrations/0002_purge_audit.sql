-- Hard-purge / legal-takedown audit trail.
-- One row per purge ATTEMPT, written before anything is destroyed, updated after.
-- Deliberately has no FK to assets: the purge deletes that row, and the audit record
-- must outlive it. asset_id is a plain TEXT tombstone, not a reference.
--
-- r2_keys embeds sanitized filenames (user text): it stays in this table and must
-- never be copied into a log field. After the asset_versions rows are gone it is the
-- only record of what a failed purge still needs to delete.

CREATE TABLE IF NOT EXISTS purge_audit (
  purge_id            TEXT PRIMARY KEY,   -- server-minted crypto.randomUUID()
  asset_id            TEXT NOT NULL,
  site_id             TEXT,
  requested_by_id     TEXT NOT NULL,      -- caller-supplied; see handlers/purge.ts
  requested_by_type   TEXT NOT NULL,
  reason              TEXT NOT NULL,      -- free text: legal/ticket reference
  status              TEXT NOT NULL,
  r2_keys             TEXT,               -- JSON array of every key targeted
  r2_deleted          INTEGER,
  r2_failed           INTEGER,
  versions_deleted    INTEGER,
  cache_purge_outcome TEXT,               -- 'success' | 'skipped' | 'failed'
  error               TEXT,
  requested_at        TEXT NOT NULL,      -- ISO-8601, matches assets.created_at
  completed_at        TEXT,
  CHECK (requested_by_type IN ('user', 'agent', 'system')),
  CHECK (status IN ('intent', 'completed', 'partial', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_purge_audit_asset ON purge_audit (asset_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_purge_audit_site ON purge_audit (site_id, requested_at DESC);
