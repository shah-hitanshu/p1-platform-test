-- Migration 002: Checkpoints
-- Creates checkpoint tables for named snapshots of branch state
--
-- Based on collaborative-state-system-architecture-v2.2.md

-- ─────────────────────────────────────────────────────────────────────────────
-- Checkpoints Table
-- Named snapshots of branch state
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES app.branches(id),

    -- Checkpoint metadata
    name TEXT,
    message TEXT,

    -- Type of checkpoint
    checkpoint_type TEXT NOT NULL DEFAULT 'manual',
    -- Valid types: 'manual', 'auto', 'pre_merge', 'post_merge'

    -- Authorship
    created_by_id UUID NOT NULL,
    created_by_type TEXT NOT NULL,  -- 'user', 'agent', 'system'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_checkpoints_branch ON app.checkpoints(branch_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Checkpoint Documents Table
-- Which document versions are included in each checkpoint
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.checkpoint_documents (
    checkpoint_id UUID NOT NULL REFERENCES app.checkpoints(id),
    document_id UUID NOT NULL REFERENCES app.documents(id),
    document_version_id UUID NOT NULL REFERENCES app.document_versions(id),

    PRIMARY KEY (checkpoint_id, document_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Add foreign key from branches to checkpoints
-- This was deferred because checkpoints table didn't exist yet
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE app.branches
    ADD CONSTRAINT fk_branches_source_checkpoint
    FOREIGN KEY (source_checkpoint_id)
    REFERENCES app.checkpoints(id);
