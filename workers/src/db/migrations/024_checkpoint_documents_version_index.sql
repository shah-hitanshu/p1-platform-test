-- Migration 024: Add index on checkpoint_documents.document_version_id
--
-- Supports efficient lookup of whether a document version has been published
-- (captured in a checkpoint). Without this index, queries joining on
-- document_version_id require a full scan of checkpoint_documents.

CREATE INDEX IF NOT EXISTS idx_checkpoint_documents_version_id
  ON app.checkpoint_documents(document_version_id);
