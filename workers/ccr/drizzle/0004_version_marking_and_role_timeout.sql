-- Objects drizzle-kit cannot express in schema.ts: a role-level setting, the
-- trigger that keeps document_versions.superseded_at true, the backfill that
-- seeds it, and the column documentation.

-- Server-side cap on query runtime for the app role. Postgres only notices a
-- dead client when it tries to send results, so queries abandoned by timed-out
-- workers keep burning CPU to completion.
--
-- Set on the role, not the instance: Cloud SQL rejects statement_timeout as a
-- database flag (invalidFlagName), and role scope is narrower anyway — only
-- sessions logging in AS cssuser (the app, via Hyperdrive) inherit it.
-- Migrations log in as the CI IAM user and SET ROLE afterwards, and role GUC
-- defaults apply at login for the login role only, so migrations and
-- admin/proxy sessions are unaffected. A session needing longer for known work
-- can still raise its own limit with SET statement_timeout.
ALTER ROLE cssuser SET statement_timeout = '30s';
--> statement-breakpoint

COMMENT ON COLUMN app.document_versions.pinned_at IS
  'When publish pinned this row''s snapshot; compaction never nulls a stamped row. NULL for rows never directly published — checkpoint-referenced rows without a stamp are still protected by compaction''s checkpoint_documents guard.';
--> statement-breakpoint

COMMENT ON COLUMN app.document_versions.superseded_at IS
  'Set when a strictly newer version exists for this (document_id, branch_id); never set on the newest. Queries that want only the latest version may filter on superseded_at IS NULL as an optimization. History, restore and publish lookups must NOT filter on it: a published version is often not the newest one.';
--> statement-breakpoint

COMMENT ON TABLE app.branch_document_paths IS
  'Per-branch path overrides. Paths are stored normalized and lowercased, with no leading slash, matching normalizePath.';
--> statement-breakpoint

-- Keeping the superseded mark true as new versions arrive.
--
-- A trigger rather than application code because every write path would
-- otherwise have to remember: createDocumentOnBranch, the version API, restore,
-- publish, merge and import all insert here. One of them forgetting would not
-- fail loudly — it would quietly leave rows in the live set, and the reason
-- would be invisible at the call site.
--
-- The cost is one single-row UPDATE per version insert. Because superseded_at
-- is the predicate column of idx_versions_live_on_branch, that update is never
-- HOT: it writes a new heap tuple and new entries in every index on the table,
-- not just the partial one. That is accepted deliberately — it is bounded by
-- real editing volume, where the insert itself already dominates.
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
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_mark_prior_versions_superseded ON app.document_versions;
--> statement-breakpoint
CREATE TRIGGER trg_mark_prior_versions_superseded
  AFTER INSERT ON app.document_versions
  FOR EACH ROW
  EXECUTE FUNCTION app.mark_prior_versions_superseded();
--> statement-breakpoint

-- Seed the mark for the rows this work exists for: the write-only registry
-- sync's history (_registry/components/* and the registry index — the paths
-- isRegistryWritePath covers). Everything else is left to the trigger above; an
-- unmarked old row costs a read, not correctness, so there is no need to
-- rewrite the whole table.
--
-- The backslash escapes the underscore in the LIKE pattern, which would
-- otherwise match any single character. The index path is an equality test, so
-- it takes the literal name.
--
-- Operational note: this rewrites every row it marks, leaving a dead tuple
-- behind each one. VACUUM cannot run inside a transaction block, so it is not
-- here; autovacuum will get there on its own, and a manual
-- `VACUUM (ANALYZE) app.document_versions` right after deploy makes the
-- improvement immediate rather than eventual.
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
