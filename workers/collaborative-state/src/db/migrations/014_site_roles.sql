-- Migration 014: Site Roles
-- Stores user-site and agent-site role mappings in the database
-- Replaces hardcoded config in mock-identity.config.json
--
-- This enables dynamic site provisioning without code changes
-- and prepares for external identity provider integration.

-- ─────────────────────────────────────────────────────────────────────────────
-- User-Site Roles Table
-- Maps Pantheon users to sites with their Pantheon role
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.user_site_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,          -- External user ID (from identity provider)
    site_id UUID NOT NULL REFERENCES app.sites(id) ON DELETE CASCADE,
    role TEXT NOT NULL,             -- 'owner', 'admin', 'developer', 'team_member'

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by_id TEXT,

    UNIQUE(user_id, site_id)
);

CREATE INDEX idx_user_site_roles_user ON app.user_site_roles(user_id);
CREATE INDEX idx_user_site_roles_site ON app.user_site_roles(site_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Agent-Site Roles Table
-- Maps AI agents to sites with their access level
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.agent_site_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,         -- Agent ID (from agent registry)
    site_id UUID NOT NULL REFERENCES app.sites(id) ON DELETE CASCADE,
    role TEXT NOT NULL,             -- 'viewer', 'editor', 'admin'

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by_id TEXT,

    UNIQUE(agent_id, site_id)
);

CREATE INDEX idx_agent_site_roles_agent ON app.agent_site_roles(agent_id);
CREATE INDEX idx_agent_site_roles_site ON app.agent_site_roles(site_id);
