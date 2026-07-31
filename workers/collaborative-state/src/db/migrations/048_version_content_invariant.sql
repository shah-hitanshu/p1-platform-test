-- Migration 048: Repair Recoverable Version Content
--
-- Rows holding neither a snapshot nor a patch cannot be rebuilt. Where the
-- content is derivable from elsewhere, restore it; the rest stay as they are,
-- identifiable by exactly that shape.
--
-- Migration 049 adds the constraint that stops any more of them being written.

-- Repair 1: tombstone rows. Their content is the deletion marker by definition.
UPDATE app.document_versions
SET snapshot = '{"_deleted": true}'::jsonb
WHERE snapshot IS NULL
  AND patch IS NULL
  AND is_tombstone = true;

-- Repair 2: rows copied from another version (publishes, merges, reverts) whose
-- source still holds content. source_version_id makes the original recoverable.
UPDATE app.document_versions target
SET snapshot = source.snapshot
FROM app.document_versions source
WHERE target.source_version_id = source.id
  AND target.snapshot IS NULL
  AND target.patch IS NULL
  AND source.snapshot IS NOT NULL;
