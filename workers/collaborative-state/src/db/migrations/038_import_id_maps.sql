-- Migration 038: Import ID maps table for bundle import traceability
-- Stores source UUID to target UUID mappings per import run.

CREATE TABLE IF NOT EXISTS app.import_id_maps (
  import_key  TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (import_key, source_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_import_id_maps_key ON app.import_id_maps(import_key);
