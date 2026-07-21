-- Migration 017: Users table for system-level allowlist
--
-- Manages which users are allowed to access the system.
-- When the table is empty, the allowlist is inactive (all authenticated users allowed).
-- Once the first user is added, the allowlist activates.

CREATE TABLE app.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  principal_id TEXT UNIQUE,        -- Set on first login (UUIDv5 from provider)
  auth_provider TEXT,              -- 'google', 'auth0', 'mock'
  system_role TEXT NOT NULL DEFAULT 'member',  -- 'admin' or 'member'
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON app.users(email);
CREATE INDEX idx_users_principal_id ON app.users(principal_id);
