-- Migration 009: Organizations
-- Creates the organizations table for agent configuration and site grouping
--
-- Based on collaborative-state-system-architecture-v2.3.md
-- Part of Agent Politeness System

-- ─────────────────────────────────────────────────────────────────────────────
-- Organizations Table
-- Minimal model for agent configuration. While Pantheon's broader organization
-- hierarchy exists externally, this service maintains its own lightweight
-- organization layer specifically for agent idle timeout configuration,
-- agent registry, and site grouping.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,

    -- Organization settings (JSONB for flexibility)
    -- Default includes agentIdleTimeoutMs: 5000 (5 seconds)
    settings JSONB NOT NULL DEFAULT '{
        "agentIdleTimeoutMs": 5000
    }',

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add comment explaining the settings schema
COMMENT ON COLUMN app.organizations.settings IS
'Organization settings JSON schema:
{
  "agentIdleTimeoutMs": number,        // How long humans must be idle (default: 5000ms)
  "agentPriorityTiers": {}             // Future: tier configurations
}';

-- ─────────────────────────────────────────────────────────────────────────────
-- Link Sites to Organizations
-- Sites can optionally belong to an organization for agent configuration
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE app.sites
    ADD COLUMN organization_id UUID REFERENCES app.organizations(id);

CREATE INDEX idx_sites_organization ON app.sites(organization_id);
