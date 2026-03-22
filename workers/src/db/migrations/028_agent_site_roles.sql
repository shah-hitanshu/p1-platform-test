-- Migration 028: Agent Site Roles
--
-- Adds a table for assigning site-level roles to agents.
-- This controls what an agent can do on each site (view, edit, admin).
--
-- When an agent authenticates via its API key (aak_), the auth provider
-- queries this table to populate pantheonSiteRoles on the principal.
-- Agent roles are mapped to PantheonRoles for authorization:
--   viewer -> team_member, editor -> developer, admin -> admin
--
-- Roles are soft-deleted via revoked_at so grant history is preserved.
-- The unique partial index ensures only one active role per agent+site.

CREATE TABLE IF NOT EXISTS app.agent_site_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL REFERENCES app.agents(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES app.sites(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

-- Only one active (non-revoked) role per agent per site
CREATE UNIQUE INDEX idx_agent_site_roles_active
  ON app.agent_site_roles (agent_id, site_id)
  WHERE revoked_at IS NULL;

-- List roles for an agent (used during authentication)
CREATE INDEX idx_agent_site_roles_agent_id
  ON app.agent_site_roles (agent_id)
  WHERE revoked_at IS NULL;

-- List agents with roles on a site (admin UI)
CREATE INDEX idx_agent_site_roles_site_id
  ON app.agent_site_roles (site_id)
  WHERE revoked_at IS NULL;
