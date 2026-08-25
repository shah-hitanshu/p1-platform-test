-- Migration 062: source_version_id FK must not pin source branches [PCC-3737]
--
-- (Numbered 062 because 060/061 landed on main for the registry
-- version-history supersede while this branch was in review.)
--
-- document_versions.source_version_id (added in 026 as publish provenance,
-- now also stamped at insert time by merge execution) references
-- document_versions(id) with no ON DELETE clause. Inbound references from a
-- target branch's merge versions therefore block deleting the source
-- branch's versions: deleteBranch fails with SQLSTATE 23503. Previously only
-- published main-target merges created such references; insert-time stamping
-- widens it to every merge (non-main targets, cancelled/failed jobs), so the
-- provenance link becomes best-effort metadata: null it when the source
-- version goes away.

-- NOTE: source_branch_id (also from 026, set by publish backfill) keeps its
-- NO ACTION reference to app.branches, so deleting a branch whose merge was
-- published still fails on that constraint — a pre-existing case this
-- migration deliberately does not change (tracked as a follow-up).

ALTER TABLE app.document_versions
  DROP CONSTRAINT document_versions_source_version_id_fkey,
  ADD CONSTRAINT document_versions_source_version_id_fkey
    FOREIGN KEY (source_version_id) REFERENCES app.document_versions(id)
    ON DELETE SET NULL;
