-- Migration 039: Template Support
-- Implements PROPOSAL-010 infrastructure for content types and template migration
--
-- Adds:
-- - Template reference columns on documents table
-- - migration_jobs table for tracking template migrations
-- - migration_conflicts table for conflict resolution

-- ─────────────────────────────────────────────────────────────────────────────
-- Extend Documents Table with Template References
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE app.documents
  ADD COLUMN template_id UUID REFERENCES app.documents(id),
  ADD COLUMN template_version INTEGER;

COMMENT ON COLUMN app.documents.template_id IS
  'Reference to template document (stored at _registry/templates/*)';
COMMENT ON COLUMN app.documents.template_version IS
  'Version of template this document was created from or last migrated to';

-- Index for finding documents by template (partial index for efficiency)
CREATE INDEX idx_documents_template
  ON app.documents(template_id, template_version)
  WHERE template_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration Jobs Table
-- Tracks template migration operations across affected documents
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.migration_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES app.sites(id),
  branch_id UUID NOT NULL REFERENCES app.branches(id),
  template_id UUID NOT NULL REFERENCES app.documents(id),
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,

  -- Optional pre-migration checkpoint for rollback
  checkpoint_id UUID REFERENCES app.checkpoints(id),

  -- Job status and progress
  status TEXT NOT NULL DEFAULT 'pending',
  total_documents INTEGER NOT NULL DEFAULT 0,
  processed_documents INTEGER NOT NULL DEFAULT 0,

  -- Audit trail
  created_by_id UUID NOT NULL,
  created_by_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  CHECK (created_by_type IN ('user', 'agent', 'system'))
);

COMMENT ON TABLE app.migration_jobs IS
  'Tracks template migration jobs that update documents to new template versions';

CREATE INDEX idx_migration_jobs_branch ON app.migration_jobs(branch_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration Conflicts Table
-- Records documents that had conflicting structural changes during migration
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.migration_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_job_id UUID NOT NULL REFERENCES app.migration_jobs(id),
  document_id UUID NOT NULL REFERENCES app.documents(id),
  branch_id UUID NOT NULL REFERENCES app.branches(id),
  template_id UUID NOT NULL REFERENCES app.documents(id),
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,

  -- Conflict data for review
  template_delta JSONB NOT NULL,    -- Template's structural changes
  document_actions JSONB NOT NULL,  -- Document's own structural actions

  -- Resolution tracking
  resolution TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,

  CHECK (resolution IS NULL OR resolution IN ('apply', 'skip', 'manual'))
);

COMMENT ON TABLE app.migration_conflicts IS
  'Records migration conflicts requiring manual resolution';
COMMENT ON COLUMN app.migration_conflicts.template_delta IS
  'Structural changes from template (extracted from action_metadata)';
COMMENT ON COLUMN app.migration_conflicts.document_actions IS
  'Document''s own structural changes since last template version';
COMMENT ON COLUMN app.migration_conflicts.resolution IS
  'How conflict was resolved: apply (use template), skip (keep document), manual (custom)';

CREATE INDEX idx_migration_conflicts_job ON app.migration_conflicts(migration_job_id);
CREATE INDEX idx_migration_conflicts_unresolved
  ON app.migration_conflicts(branch_id, document_id)
  WHERE resolution IS NULL;
