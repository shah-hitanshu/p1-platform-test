-- Migration 042: Document Relations
--
-- Models derivation relationships between documents as edges. A 'template' edge
-- links a document (source) to the template it derives from (target); a
-- 'localization' edge links a localized document (source) to the original it
-- derives from (target). synced_version tracks the target version the source is
-- aligned to. A new derivation type is a new relation_type value, not a new column.

CREATE TABLE app.document_relations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id UUID NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  target_document_id UUID NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  relation_type      TEXT NOT NULL,
  synced_version     INTEGER,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (source_document_id, relation_type),
  CHECK (relation_type IN ('template', 'localization'))
);

COMMENT ON TABLE app.document_relations IS
  'Edges between documents by derivation type (e.g. template).';
COMMENT ON COLUMN app.document_relations.source_document_id IS
  'The dependent document; target_document_id is what it derives from.';
COMMENT ON COLUMN app.document_relations.synced_version IS
  'Version of the target this source is aligned to; NULL when unbound.';
COMMENT ON COLUMN app.document_relations.metadata IS
  'Relation-type-specific attributes; shape varies by relation_type.';

-- Source-side lookups (TEMPLATE_RELATION_JOIN, the rollback subquery) are served
-- by the UNIQUE (source_document_id, relation_type) constraint's backing index.
CREATE INDEX idx_document_relations_target
  ON app.document_relations (target_document_id, synced_version);

-- Backfill existing template associations as 'template' edges.
INSERT INTO app.document_relations (source_document_id, target_document_id, relation_type, synced_version)
SELECT id, template_id, 'template', template_version
FROM app.documents
WHERE template_id IS NOT NULL;

-- Drop the per-document template columns. Dropping template_id also removes
-- idx_documents_template and the self-referential foreign key.
ALTER TABLE app.documents DROP COLUMN template_id;
ALTER TABLE app.documents DROP COLUMN template_version;
