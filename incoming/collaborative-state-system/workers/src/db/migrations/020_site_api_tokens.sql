-- Migration 020: Site API Tokens
--
-- Adds a table for per-site API tokens that allow applications (e.g., Puck)
-- to authenticate to the CSS API with scoped, revocable tokens.
--
-- Tokens are stored as SHA-256 hashes; the raw token is shown only once at
-- creation time. A prefix column stores the first 8 characters for display.

CREATE TABLE IF NOT EXISTS app.site_api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES app.sites(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  prefix VARCHAR(12) NOT NULL,
  name TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['read:published'],
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- Fast lookup by token hash (used on every authenticated request)
CREATE INDEX idx_site_api_tokens_hash
  ON app.site_api_tokens (token_hash)
  WHERE revoked_at IS NULL;

-- List tokens for a site (admin UI)
CREATE INDEX idx_site_api_tokens_site_id
  ON app.site_api_tokens (site_id);
