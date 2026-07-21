-- Migration 001: Core Schema
-- Creates the fundamental tables: sites, documents, branches, document_versions
--
-- Based on collaborative-state-system-architecture-v2.2.md

-- ─────────────────────────────────────────────────────────────────────────────
-- Sites Table
-- Corresponds to Pantheon websites. Organization ownership is managed by
-- Pantheon, not this service.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pantheon_site_id TEXT UNIQUE NOT NULL,  -- Reference to Pantheon's site identifier
    name TEXT NOT NULL,

    -- Workflow settings for merge approval
    workflow_settings JSONB NOT NULL DEFAULT '{
        "mergeApprovalMode": "optional",
        "minApprovers": 1,
        "allowSelfApproval": true,
        "approverMode": "both",
        "approverMinRole": "EDITOR"
    }',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Documents Table
-- Documents within a site, identified by path
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES app.sites(id),
    path TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(site_id, path)
);

CREATE INDEX idx_documents_site ON app.documents(site_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Branches Table
-- Represents lines of work. Each site has a 'main' branch representing
-- the published state.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES app.sites(id),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    -- Valid statuses: 'active', 'review', 'merged', 'archived'

    -- Is this the main (published) branch?
    is_main BOOLEAN NOT NULL DEFAULT FALSE,

    -- Lineage
    source_branch_id UUID REFERENCES app.branches(id),
    source_checkpoint_id UUID,  -- References checkpoints(id), added after table creation

    -- Ownership
    created_by_id UUID NOT NULL,
    created_by_type TEXT NOT NULL,  -- 'user', 'agent'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(site_id, name)
);

CREATE INDEX idx_branches_site ON app.branches(site_id);
CREATE INDEX idx_branches_status ON app.branches(site_id, status);

-- Ensure only one main branch per site
CREATE UNIQUE INDEX idx_branches_main ON app.branches(site_id) WHERE is_main = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Document Versions Table
-- Snapshots of document state on a branch
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES app.documents(id),
    branch_id UUID NOT NULL REFERENCES app.branches(id),

    -- Version metadata
    version_number INTEGER NOT NULL,

    -- Content snapshot
    snapshot JSONB NOT NULL,

    -- CRDT state for merge support
    crdt_state BYTEA,

    -- What created this version
    source TEXT NOT NULL DEFAULT 'edit',
    -- Valid sources: 'edit', 'merge', 'revert', 'checkpoint'

    -- Authorship
    created_by_id UUID NOT NULL,
    created_by_type TEXT NOT NULL,  -- 'user', 'agent', 'system'
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(document_id, branch_id, version_number)
);

CREATE INDEX idx_versions_doc_branch ON app.document_versions(document_id, branch_id);
CREATE INDEX idx_versions_branch ON app.document_versions(branch_id);
