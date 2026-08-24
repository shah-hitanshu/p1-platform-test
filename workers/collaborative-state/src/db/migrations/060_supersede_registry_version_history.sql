-- Migration 060: Mark superseded versions and exclude them from latest-version queries
--
-- Registry documents carry the overwhelming majority of app.document_versions:
-- a write-only CI sync appended a full descriptor snapshot per component per
-- run, and 719 registry documents accumulated ~89,881 versions. The sync no
-- longer writes unchanged content, but the existing rows keep their query cost:
-- every query that wants only a document's newest version still reads the whole
-- history to find it.
--
-- Nothing here is deleted. Superseded rows are MARKED and then skipped by the
-- queries that only ever wanted the newest version; every history, restore and
-- audit path continues to see the full record. This is the shape the platform's
-- no-delete principle requires — growth pressure is answered by shaping storage
-- and queries, not by dropping rows.
--
-- superseded_at is a hint, and deliberately one-directional: it is set only on
-- rows that a strictly newer version already supersedes, so the newest version
-- can never carry it. A row that should be marked but isn't merely gets read
-- (the query still returns the right answer, just slower). There is no state in
-- which this hides a live document.
--
-- This file holds only the fast, lock-heavy DDL: the ALTER TABLE takes an
-- ACCESS EXCLUSIVE lock but is metadata-only, and the trigger creation is
-- similarly brief. The row-heavy backfill and the index build live in
-- migration 061 so this lock is released before they start — each migration
-- file runs as its own implicit transaction.

ALTER TABLE app.document_versions
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

COMMENT ON COLUMN app.document_versions.superseded_at IS
  'Set when a strictly newer version exists for this (document_id, branch_id); never set on the newest. Queries that want only the latest version may filter on superseded_at IS NULL as an optimization. History, restore and publish lookups must NOT filter on it: a published version is often not the newest one.';

-- Keeping the mark true as new versions arrive.
--
-- A trigger rather than application code because every write path would
-- otherwise have to remember: createDocumentOnBranch, the version API, restore,
-- publish, merge and import all insert here. One of them forgetting would not
-- fail loudly — it would quietly leave rows in the live set, and the reason
-- would be invisible at the call site.
--
-- The cost is one single-row UPDATE per version insert. Because superseded_at
-- is the predicate column of migration 061's partial index, that update is
-- never HOT: it writes a new heap tuple and new entries in every index on the
-- table, not just the partial one. That is accepted deliberately: it is
-- bounded by real editing volume, where the insert itself already dominates,
-- and it replaces an unbounded per-CI-run cost. Marking on a schedule instead
-- would avoid the write amplification and would still be correct (the mark is
-- only a hint), at the price of a job whose lag silently becomes query cost.
CREATE OR REPLACE FUNCTION app.mark_prior_versions_superseded() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE app.document_versions
  SET superseded_at = now()
  WHERE document_id = NEW.document_id
    AND branch_id = NEW.branch_id
    AND version_number < NEW.version_number
    AND superseded_at IS NULL;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_prior_versions_superseded ON app.document_versions;
CREATE TRIGGER trg_mark_prior_versions_superseded
  AFTER INSERT ON app.document_versions
  FOR EACH ROW
  EXECUTE FUNCTION app.mark_prior_versions_superseded();
