-- Migration 044: Purge _registry/* rows from checkpoint_documents
--
-- Checkpoint capture excludes _registry/* documents (except user-authored
-- _registry/templates/*): registry documents are sync-owned metadata, and
-- restoring them via revert desyncs them from the registry index. Capture
-- was filtered, but checkpoints created before that carried registry rows,
-- and reverting any of them re-poisoned the registry.
--
-- revertToCheckpoint now applies the same filter at restore time; this
-- migration removes the historical rows so old checkpoints are clean at the
-- source rather than relying on the runtime filter forever.
--
-- LIKE patterns: '_' is a single-character wildcard, so the literal
-- underscore is escaped, mirroring escapeLikePattern in the app code.

DELETE FROM app.checkpoint_documents cd
USING app.documents d
WHERE cd.document_id = d.id
  AND d.path LIKE '\_registry/%' ESCAPE '\'
  AND d.path NOT LIKE '\_registry/templates/%' ESCAPE '\';
