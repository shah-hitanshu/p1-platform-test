-- Migration 061: backfill superseded_at for registry sync history, then index
-- the live set. Split from migration 060 so its ACCESS EXCLUSIVE lock is not
-- held for the duration of this backfill and index build: here the UPDATE
-- takes only row locks (reads and unrelated writes proceed), and the CREATE
-- INDEX takes a SHARE lock (reads proceed; writes to the table wait for the
-- build).
--
-- Backfill the rows this work exists for: the write-only registry sync's
-- history (_registry/components/* and the registry index — exactly the paths
-- isRegistryWritePath covers). Everything else is left to migration 060's
-- trigger, which marks it as new versions arrive; an unmarked old row costs a
-- read, not correctness, so there is no need to rewrite the whole table here.
--
-- The backslash escapes the underscore in the LIKE pattern, which would
-- otherwise match any single character. The index path is an equality test, so
-- it takes the literal name.
UPDATE app.document_versions v
SET superseded_at = now()
FROM app.documents d
WHERE d.id = v.document_id
  AND (d.path LIKE '\_registry/components/%' OR d.path = '_registry/index')
  AND v.superseded_at IS NULL
  AND v.version_number < (
    SELECT MAX(v2.version_number)
    FROM app.document_versions v2
    WHERE v2.document_id = v.document_id
      AND v2.branch_id = v.branch_id
  );

-- Operational note: the UPDATE above rewrites every row it marks, leaving a
-- dead tuple behind each one — on production that is ~89,881 of them, and until
-- they are reclaimed the extra heap pages cost more than the marking saves.
-- VACUUM cannot run inside a transaction block, so it is not in this file;
-- autovacuum will get there on its own, and a manual
-- `VACUUM (ANALYZE) app.document_versions` right after deploy makes the
-- improvement immediate rather than eventual.

-- Covers the live set only, so a lookup for a document's newest version on a
-- branch walks one entry instead of the document's whole history. Built after
-- the backfill so it starts at its steady-state size.
CREATE INDEX IF NOT EXISTS idx_versions_live_on_branch
  ON app.document_versions (branch_id, document_id, version_number DESC)
  WHERE superseded_at IS NULL;
