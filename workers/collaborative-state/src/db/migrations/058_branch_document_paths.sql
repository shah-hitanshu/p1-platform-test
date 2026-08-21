-- Migration 058: Branch-scoped document path overrides
--
-- app.documents.path is global — a move written there lands on every branch at
-- once. A row here means "on this branch, this document lives at this path";
-- absence means the document uses its global documents.path.
--
-- No separate branch_id index: the primary key already leads with branch_id,
-- and the unique constraint serves path lookups on a branch.

CREATE TABLE app.branch_document_paths (
  branch_id   uuid NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  path        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, document_id),
  UNIQUE (branch_id, path)
);

COMMENT ON TABLE app.branch_document_paths IS
  'Per-branch path overrides. Paths are stored normalized and lowercased, with no leading slash, matching normalizePath and migration 041.';
