-- Migration 054: Index checkpoint_documents by document
--
-- The document listing resolves each document's most recent publish checkpoint
-- through a lateral keyed on checkpoint_documents.document_id. The table's
-- primary key leads with checkpoint_id, so that lookup had no usable index.

CREATE INDEX IF NOT EXISTS idx_checkpoint_documents_document
  ON app.checkpoint_documents (document_id, checkpoint_id);
