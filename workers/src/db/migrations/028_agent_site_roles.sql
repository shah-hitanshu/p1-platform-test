-- Migration 028: Agent Site Roles (schema reconciliation)
--
-- Migration 014 created agent_site_roles with a basic schema.
-- This migration brings it up to the current design:
--   - Adds revoked_at for soft-delete (preserves grant history)
--   - Uses created_by_id to track who granted the role
--   - Replaces the simple unique constraint with a partial unique index
--     that only covers active (non-revoked) roles
--   - Adds partial indexes for efficient lookups of active roles
--
-- All changes are idempotent so this migration is safe to re-run.

-- Add revoked_at column for soft-delete
ALTER TABLE app.agent_site_roles
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- created_by_id already exists from migration 014; no column addition needed

-- Drop the old unique constraint from migration 014 (agent_id, site_id)
-- so we can replace it with a partial unique index on active roles only.
-- The constraint name is auto-generated as agent_site_roles_agent_id_site_id_key.
ALTER TABLE app.agent_site_roles
  DROP CONSTRAINT IF EXISTS agent_site_roles_agent_id_site_id_key;

-- Only one active (non-revoked) role per agent per site
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_site_roles_active
  ON app.agent_site_roles (agent_id, site_id)
  WHERE revoked_at IS NULL;

-- List roles for an agent (used during authentication)
CREATE INDEX IF NOT EXISTS idx_agent_site_roles_agent_id
  ON app.agent_site_roles (agent_id)
  WHERE revoked_at IS NULL;

-- List agents with roles on a site (admin UI)
CREATE INDEX IF NOT EXISTS idx_agent_site_roles_site_id
  ON app.agent_site_roles (site_id)
  WHERE revoked_at IS NULL;
