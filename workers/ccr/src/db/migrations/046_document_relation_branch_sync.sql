-- Migration 046: Per-branch derivation sync overrides
--
-- document_relations holds one shared edge per (source_document, relation_type)
-- with a single synced_version. This table overrides that version per branch, so
-- a migration on a non-main branch advances only that branch's sync while other
-- branches keep inheriting document_relations.synced_version. The effective
-- synced_version for a branch is COALESCE(this branch's override, the edge's base).

CREATE TABLE app.document_relation_branch_sync (
  source_document_id UUID NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  relation_type      TEXT NOT NULL,
  branch_id          UUID NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
  synced_version     INTEGER NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (source_document_id, relation_type, branch_id),
  CHECK (relation_type IN ('template', 'localization'))
);

COMMENT ON TABLE app.document_relation_branch_sync IS
  'Per-branch synced_version override for a document_relations edge; absent rows inherit the edge base.';
COMMENT ON COLUMN app.document_relation_branch_sync.synced_version IS
  'Version of the target this source is aligned to on this branch.';
