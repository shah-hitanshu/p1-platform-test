-- Migration 025: Add is_tombstone column to document_versions
--
-- Replaces the convention of storing { _deleted: true } in the snapshot JSON
-- with a dedicated boolean column. This prevents tombstone spoofing via
-- user-submitted snapshots and enables more efficient queries.

ALTER TABLE app.document_versions
  ADD COLUMN is_tombstone BOOLEAN NOT NULL DEFAULT false;

-- Backfill from existing tombstone snapshots
UPDATE app.document_versions
  SET is_tombstone = true
  WHERE snapshot->>'_deleted' = 'true';

-- Index for efficient tombstone filtering in COW queries
CREATE INDEX IF NOT EXISTS idx_document_versions_tombstone
  ON app.document_versions(document_id, branch_id)
  WHERE is_tombstone = true;
