-- Migration 004: Authorization
-- Creates branch grants and guest links tables for access control
--
-- Based on collaborative-state-system-architecture-v2.2.md

-- ─────────────────────────────────────────────────────────────────────────────
-- Branch Grants Table
-- Role elevation for actors on specific branches
-- This is the primary authorization table owned by this service
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.branch_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,

    -- Actor identity (from Pantheon Identity or Agent Service)
    actor_id UUID NOT NULL,
    actor_type TEXT NOT NULL,  -- 'user', 'agent'

    -- Elevated role for this branch
    role TEXT NOT NULL,  -- 'VIEWER', 'EDITOR', 'ADMIN'

    -- Grant metadata
    granted_by_id UUID NOT NULL,
    granted_by_type TEXT NOT NULL,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    reason TEXT,

    UNIQUE(branch_id, actor_id)
);

CREATE INDEX idx_branch_grants_branch ON app.branch_grants(branch_id);
CREATE INDEX idx_branch_grants_actor ON app.branch_grants(actor_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Guest Links Table
-- View-only, branch-scoped access tokens
-- NOTE: Candidate for extraction to shared approval/access service
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.guest_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,

    -- Recipient
    email TEXT NOT NULL,
    name TEXT,

    -- Auth
    token_hash TEXT NOT NULL UNIQUE,

    -- Lifecycle
    status TEXT NOT NULL DEFAULT 'active',
    -- Valid: 'active', 'revoked', 'expired'
    expires_at TIMESTAMPTZ NOT NULL,

    -- Metadata
    created_by_id UUID NOT NULL,
    created_by_type TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    message TEXT,

    -- Usage tracking
    access_count INTEGER DEFAULT 0,
    last_access_at TIMESTAMPTZ
);

CREATE INDEX idx_guest_links_token ON app.guest_links(token_hash);
CREATE INDEX idx_guest_links_branch ON app.guest_links(branch_id);
CREATE INDEX idx_guest_links_status ON app.guest_links(status, expires_at);
