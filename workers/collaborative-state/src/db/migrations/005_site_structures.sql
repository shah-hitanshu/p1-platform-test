-- Migration 005: Site Structures
-- Creates tables for hierarchical document organization, navigation,
-- and metadata schemas
--
-- Based on collaborative-state-system-architecture-v2.2.md

-- ─────────────────────────────────────────────────────────────────────────────
-- Site Structures Table
-- Organizational containers (e.g., "Main Navigation", "Blog", "Documentation")
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.site_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES app.sites(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,           -- URL-safe identifier
    description TEXT,

    structure_type TEXT NOT NULL DEFAULT 'hierarchy',
    -- Types: 'collection' (flat list), 'hierarchy' (nested tree)

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(site_id, slug)
);

CREATE INDEX idx_site_structures_site ON app.site_structures(site_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Structure Nodes Table
-- Hierarchy entries (sections, document refs, external links)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.structure_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    structure_id UUID NOT NULL REFERENCES app.site_structures(id),

    -- Hierarchy
    parent_node_id UUID REFERENCES app.structure_nodes(id),
    position INTEGER NOT NULL DEFAULT 0,  -- Order among siblings

    -- Node identity
    name TEXT NOT NULL,
    slug TEXT NOT NULL,           -- URL segment for this node

    -- What this node represents
    node_type TEXT NOT NULL DEFAULT 'section',
    -- Types: 'section' (grouping only), 'document' (links to document), 'external' (external URL)

    -- For document nodes
    document_id UUID REFERENCES app.documents(id),

    -- For external nodes
    external_url TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(structure_id, parent_node_id, slug)
);

CREATE INDEX idx_structure_nodes_parent ON app.structure_nodes(parent_node_id, position);
CREATE INDEX idx_structure_nodes_structure ON app.structure_nodes(structure_id);
CREATE INDEX idx_structure_nodes_document ON app.structure_nodes(document_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Branch Structure State Table
-- Branch-specific structure state and metadata schema
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.branch_structure_state (
    branch_id UUID NOT NULL REFERENCES app.branches(id),
    structure_id UUID NOT NULL REFERENCES app.site_structures(id),

    -- Denormalized tree for efficient reads (computed from structure_nodes)
    structure_tree JSONB NOT NULL DEFAULT '[]',

    -- Metadata schema (JSON Schema format) - versioned per branch
    metadata_schema JSONB NOT NULL DEFAULT '{
        "type": "object",
        "properties": {
            "title": {"type": "string", "maxLength": 100},
            "description": {"type": "string", "maxLength": 300}
        },
        "required": ["title"]
    }',

    -- Schema enforcement mode
    schema_enforcement TEXT NOT NULL DEFAULT 'warn',
    -- 'strict': reject non-conforming documents on save
    -- 'warn': allow but flag non-conforming documents
    -- 'none': no enforcement

    has_changes_since_checkpoint BOOLEAN DEFAULT FALSE,
    last_modified_at TIMESTAMPTZ,
    last_modified_by UUID,

    PRIMARY KEY (branch_id, structure_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Branch Document Metadata Table
-- Document metadata within a structure (separate from document content)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.branch_document_metadata (
    branch_id UUID NOT NULL REFERENCES app.branches(id),
    structure_id UUID NOT NULL REFERENCES app.site_structures(id),
    document_id UUID NOT NULL REFERENCES app.documents(id),

    -- Metadata conforming to the structure's schema
    metadata JSONB NOT NULL DEFAULT '{}',

    -- Validation state (cached, updated on schema or metadata change)
    conforms_to_schema BOOLEAN DEFAULT TRUE,
    validation_errors JSONB DEFAULT '[]',

    last_modified_at TIMESTAMPTZ,
    last_modified_by UUID,

    PRIMARY KEY (branch_id, structure_id, document_id)
);

CREATE INDEX idx_branch_doc_metadata_document ON app.branch_document_metadata(document_id);
CREATE INDEX idx_branch_doc_metadata_conformance ON app.branch_document_metadata(branch_id, structure_id, conforms_to_schema);

-- ─────────────────────────────────────────────────────────────────────────────
-- Checkpoint Structures Table
-- Structure snapshots at checkpoints
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.checkpoint_structures (
    checkpoint_id UUID NOT NULL REFERENCES app.checkpoints(id),
    structure_id UUID NOT NULL REFERENCES app.site_structures(id),

    structure_tree JSONB NOT NULL,
    metadata_schema JSONB NOT NULL,
    schema_enforcement TEXT NOT NULL,

    PRIMARY KEY (checkpoint_id, structure_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Checkpoint Document Metadata Table
-- Document metadata snapshots at checkpoints
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.checkpoint_document_metadata (
    checkpoint_id UUID NOT NULL REFERENCES app.checkpoints(id),
    structure_id UUID NOT NULL REFERENCES app.site_structures(id),
    document_id UUID NOT NULL REFERENCES app.documents(id),

    metadata JSONB NOT NULL,

    PRIMARY KEY (checkpoint_id, structure_id, document_id)
);
