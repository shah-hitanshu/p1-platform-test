-- Migration 027: Agent API Keys
--
-- Adds a table for agent API keys that allow AI agents to authenticate
-- to the CSS API with revocable, hashed tokens.
--
-- Modeled after app.site_api_tokens (migration 020), but scoped to agents
-- instead of sites. Unlike site tokens which have per-token scopes,
-- agent keys are purely authentication credentials -- authorization is
-- determined by the agent's per-site roles in agent_site_roles.
--
-- Tokens are stored as SHA-256 hashes; the raw token is shown only once at
-- creation time. A prefix column stores the first characters (e.g. "aak_abc123")
-- for display in management UIs.
--
-- Note: agent_id is TEXT (not UUID) because app.agents.id was changed to TEXT
-- in migration 012. The column stores UUID-formatted strings enforced by a
-- CHECK constraint on app.agents.

CREATE TABLE IF NOT EXISTS app.agent_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL REFERENCES app.agents(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  prefix VARCHAR(12) NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- Fast lookup by token hash (used on every authenticated request)
-- Partial index excludes revoked keys since they will never match
CREATE INDEX idx_agent_api_keys_hash
  ON app.agent_api_keys (token_hash)
  WHERE revoked_at IS NULL;

-- List keys for an agent (admin UI)
CREATE INDEX idx_agent_api_keys_agent_id
  ON app.agent_api_keys (agent_id);
