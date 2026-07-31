-- Migration 026: Add publish provenance columns to document_versions
--
-- Tracks the lineage between branch versions and main versions during publish.
--   source_branch_id        - which branch the version was copied from (set on the main-side version)
--   source_version_id       - the specific version that was copied (set on the main-side version)
--   published_to_version_id - back-link from the source branch version to the version created on main

ALTER TABLE app.document_versions
  ADD COLUMN source_branch_id UUID REFERENCES app.branches(id),
  ADD COLUMN source_version_id UUID REFERENCES app.document_versions(id),
  ADD COLUMN published_to_version_id UUID REFERENCES app.document_versions(id);

-- Index for efficient lookups by source branch
CREATE INDEX IF NOT EXISTS idx_document_versions_source_branch
  ON app.document_versions(source_branch_id)
  WHERE source_branch_id IS NOT NULL;
