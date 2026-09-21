-- Restoring the superseded mark's invariant under deletes.
--
-- The AFTER INSERT trigger from 0004 only ever adds marks: inserting version N
-- marks everything older on the same (document_id, branch_id). Deleting the
-- newest row therefore promotes an already-marked predecessor to latest, and
-- every query that filters superseded_at IS NULL — counts, checkpoint capture,
-- latest-version reads, merge-base — silently skips the document while
-- history paths still see it.
--
-- A companion trigger rather than code at each deleter, for the same reason
-- 0004 chose a trigger: rollback, branch deletion, site deletion and test
-- cleanup all delete here, and one of them forgetting would not fail loudly.
--
-- Statement-level with a transition table, not FOR EACH ROW: the deleters are
-- bulk DELETEs, and per-row this would re-scan and re-promote once per deleted
-- version. At statement level the promotion runs once per affected
-- (document_id, branch_id), and it runs after the deletes are applied, so
-- MAX(version_number) is already the survivor. A branch or site deletion
-- leaves no survivor and updates nothing.
CREATE OR REPLACE FUNCTION app.unmark_surviving_latest_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE app.document_versions dv
  SET superseded_at = NULL
  FROM (
    SELECT v.document_id, v.branch_id, MAX(v.version_number) AS version_number
    FROM app.document_versions v
    JOIN (SELECT DISTINCT document_id, branch_id FROM deleted_versions) d
      ON d.document_id = v.document_id AND d.branch_id = v.branch_id
    GROUP BY v.document_id, v.branch_id
  ) survivor
  WHERE dv.document_id = survivor.document_id
    AND dv.branch_id = survivor.branch_id
    AND dv.version_number = survivor.version_number
    AND dv.superseded_at IS NOT NULL;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_unmark_surviving_latest_version ON app.document_versions;
--> statement-breakpoint
CREATE TRIGGER trg_unmark_surviving_latest_version
  AFTER DELETE ON app.document_versions
  REFERENCING OLD TABLE AS deleted_versions
  FOR EACH STATEMENT
  EXECUTE FUNCTION app.unmark_surviving_latest_version();
--> statement-breakpoint

COMMENT ON COLUMN app.document_versions.superseded_at IS
  'Set when a strictly newer version exists for this (document_id, branch_id); never set on the newest — kept true by trg_mark_prior_versions_superseded on insert and trg_unmark_surviving_latest_version on delete. Queries that want only the latest version may filter on superseded_at IS NULL as an optimization. History, restore and publish lookups must NOT filter on it: a published version is often not the newest one.';
--> statement-breakpoint

-- Repair rows already stranded by a delete that predates the trigger above.
-- Bounded by the marked rows that have no newer sibling, which is at most one
-- per (document_id, branch_id) and normally zero.
UPDATE app.document_versions v
SET superseded_at = NULL
WHERE v.superseded_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM app.document_versions newer
    WHERE newer.document_id = v.document_id
      AND newer.branch_id = v.branch_id
      AND newer.version_number > v.version_number);
