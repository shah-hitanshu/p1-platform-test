-- Migration 064: Index document_versions for per-document latest-version lookups
--
-- Checkpoint capture, getLatestVersionsForBranch, merge-base resolution and
-- merge per-document lookups all run DISTINCT ON (document_id) ... ORDER BY
-- document_id, version_number DESC over a branch. The only indexes available
-- are (document_id, branch_id) and (branch_id) from migration 001, neither of
-- which orders by version_number, so each call reads every version row on the
-- branch and sorts (a 233k-row sort on large branches).
--
-- INCLUDE (id, is_tombstone) makes the scan index-only, which is what actually
-- gets the plan used: without the payload columns every row needs a heap fetch,
-- and the planner keeps choosing the (branch_id) index plus an external sort
-- (measured: 372ms with an 18MB disk spill on a 400k-version branch at the
-- production work_mem of 4MB; 56ms index-only with the payload included). id is
-- what the capture queries select; is_tombstone is what the full-capture arm
-- filters on.
--
-- Plain CREATE INDEX, matching migration 057: this takes a SHARE lock on
-- document_versions for the duration, blocking writes but not reads. Apply in
-- a low-write window.

CREATE INDEX IF NOT EXISTS idx_document_versions_branch_document_version
  ON app.document_versions (branch_id, document_id, version_number DESC)
  INCLUDE (id, is_tombstone);
