-- Migration 074: Per-branch upstream change resolutions
--
-- Records which reported changes a derived document has reconciled, per branch,
-- so reconciling on one branch leaves the others reporting what they would have.
--
-- A resolution holds a fingerprint of the upstream value the change was settled
-- against rather than the version it was read from: version numbers count up per
-- (document, branch), while a fingerprint identifies the value itself and so means
-- the same thing read from any branch. A change stays settled while the upstream
-- still holds that value.
--
-- resolutions is {slotId: {propPath: {hash, at}}}: one entry per reported change,
-- since a change is reported per JSON Pointer.

CREATE TABLE app.document_relation_branch_resolutions (
  source_document_id UUID NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  relation_type      TEXT NOT NULL,
  branch_id          UUID NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
  resolutions        JSONB NOT NULL DEFAULT '{}'::jsonb,
  inherited          JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (source_document_id, relation_type, branch_id),
  CHECK (relation_type IN ('template', 'localization'))
);

COMMENT ON TABLE app.document_relation_branch_resolutions IS
  'Per-branch record of which of a derived document''s reported upstream changes have been reconciled.';
COMMENT ON COLUMN app.document_relation_branch_resolutions.resolutions IS
  'Nested {slotId: {propPath: {hash, at}}}; hash fingerprints the upstream value settled against, at is when.';
COMMENT ON COLUMN app.document_relation_branch_resolutions.inherited IS
  'Main''s resolutions when this row was created: its own map started as this, plus or minus the write that created the row. Empty on main''s own row and where the ceiling left that write standing alone. Written once on insert and never updated.';
