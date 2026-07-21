-- Migration 010: Agent Registry
-- Creates the agents table for organization-level agent accounts
--
-- Based on collaborative-state-system-architecture-v2.3.md
-- Part of Agent Politeness System

-- ─────────────────────────────────────────────────────────────────────────────
-- Agents Table
-- Agent registry at the organization level. Each agent has individual account
-- with status, capabilities, and settings for the Agent Politeness System.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES app.organizations(id),

    -- Agent identity
    name TEXT NOT NULL,
    description TEXT,

    -- What the agent can do
    capabilities TEXT[] NOT NULL DEFAULT '{}',

    -- Agent status: controls whether agent can operate
    -- active: can perform all allowed operations
    -- suspended: cannot start new operations but can complete in-progress work
    -- disabled: cannot perform any operations
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'disabled')),

    -- Agent-specific settings (JSONB for flexibility)
    settings JSONB NOT NULL DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique agent name within organization
    UNIQUE(organization_id, name)
);

-- Indexes for common queries
CREATE INDEX idx_agents_organization ON app.agents(organization_id);
CREATE INDEX idx_agents_status ON app.agents(status);

-- Add comment explaining the settings schema
COMMENT ON COLUMN app.agents.settings IS
'Agent settings JSON schema:
{
  "priorityTier": "default",           // Future: tier reference
  "allowedOperationTypes": ["*"],      // Future: operation restrictions
  "maxConcurrentDocuments": 10         // Future: concurrency limits
}';

COMMENT ON COLUMN app.agents.capabilities IS
'Array of capability strings describing what the agent can do.
Examples: ["edit", "create", "delete", "merge", "approve"]';
