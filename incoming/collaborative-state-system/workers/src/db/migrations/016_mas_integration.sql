-- Migration 016: MAS Integration
-- Adds source column to user_site_roles to distinguish MAS-synced vs locally-granted roles.
-- Allows a user to have two rows per site (one per source: 'local' and 'mas').

-- Add source column to distinguish MAS-synced vs locally-granted roles
ALTER TABLE app.user_site_roles ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'local';

-- Change unique constraint: a user can now have TWO rows per site (one per source)
ALTER TABLE app.user_site_roles DROP CONSTRAINT IF EXISTS user_site_roles_user_id_site_id_key;
ALTER TABLE app.user_site_roles ADD CONSTRAINT user_site_roles_user_site_source_key
  UNIQUE(user_id, site_id, source);

-- Index for cache staleness queries
CREATE INDEX IF NOT EXISTS idx_user_site_roles_updated ON app.user_site_roles(updated_at);
CREATE INDEX IF NOT EXISTS idx_user_site_roles_source ON app.user_site_roles(source);
