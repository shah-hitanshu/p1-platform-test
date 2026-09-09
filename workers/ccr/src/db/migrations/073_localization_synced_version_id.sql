-- Migration 073: Pin a translation to a version's identity rather than its number
--
-- document_relations.synced_version holds a version number, and version numbers
-- restart at 1 on every branch, so a number only resolves on the branch that
-- wrote it. synced_version_id names the version itself, which is unique across
-- the site and resolves the same read from any branch.
--
-- Localization edges pin by id. Template edges keep synced_version and their
-- per-branch overrides in document_relation_branch_sync, which stays sound
-- because a template migration advances the number on the branch it runs on.

ALTER TABLE app.document_relations
  ADD COLUMN synced_version_id UUID REFERENCES app.document_versions(id) ON DELETE SET NULL;

COMMENT ON COLUMN app.document_relations.synced_version_id IS
  'The version of the target this source last matched, by identity. Set on localization edges; template edges pin by synced_version.';

-- The number was written on the branch that created the translation, so that is
-- the branch it resolves against. An edge whose number does not resolve there
-- keeps a null id, which reads as no pin: the diff reports nothing rather than
-- measuring from a version chosen by guesswork.
UPDATE app.document_relations dr
   SET synced_version_id = dv.id
  FROM app.document_versions dv
 WHERE dr.relation_type = 'localization'
   AND dr.synced_version IS NOT NULL
   AND dv.document_id = dr.target_document_id
   AND dv.version_number = dr.synced_version
   AND dv.branch_id = (
     SELECT origin.branch_id
       FROM app.document_versions origin
      WHERE origin.document_id = dr.source_document_id
      ORDER BY origin.version_number ASC, origin.created_at ASC
      LIMIT 1
   )
   -- The pinned version existed when the translation was made, so a candidate
   -- newer than the translation's earliest surviving version is not the one the
   -- number was written against.
   AND dv.created_at <= (
     SELECT MIN(origin.created_at)
       FROM app.document_versions origin
      WHERE origin.document_id = dr.source_document_id
   );

-- Removing a version nulls every pin to it, which scans this column.
CREATE INDEX idx_document_relations_synced_version_id
  ON app.document_relations(synced_version_id)
  WHERE synced_version_id IS NOT NULL;
