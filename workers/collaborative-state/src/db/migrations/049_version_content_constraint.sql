-- Migration 049: Version Content Invariant
--
-- Every document_versions row written after this migration must be
-- rebuildable: it either holds a full snapshot, or holds a patch applying to
-- its predecessor. A writer violating that fails loudly rather than
-- corrupting history.
--
-- Rows that predate the migration may hold neither; their content is already
-- unrecoverable from this database. The constraint fences on created_at,
-- stamped at the moment the migration runs, so those rows stay writable: a
-- CHECK is evaluated on every UPDATE to a row, and publishing or merging a
-- version back-links published_to_version_id onto the source row whatever its
-- age. Without the fence, publishing a version that is itself one of these
-- rows would fail.
--
-- NOT VALID skips the initial table scan, which the fence makes a formality:
-- every existing row passes by construction. Enforcement on later INSERT and
-- UPDATE is unaffected.

ALTER TABLE app.document_versions
  DROP CONSTRAINT IF EXISTS document_versions_content_present;

DO $$
BEGIN
  EXECUTE format(
    'ALTER TABLE app.document_versions'
    ' ADD CONSTRAINT document_versions_content_present'
    ' CHECK (snapshot IS NOT NULL OR patch IS NOT NULL OR created_at < %L)'
    ' NOT VALID',
    now()
  );
END $$;
