-- Migration 012: Agent String IDs
-- Changes agent ID from UUID to TEXT for developer-friendly IDs
--
-- This allows registering agents with human-readable IDs like "agent-zappy"
-- or "claude-content-enhancer" instead of auto-generated UUIDs.

-- ─────────────────────────────────────────────────────────────────────────────
-- Change agents.id from UUID to TEXT
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the default constraint first
ALTER TABLE app.agents ALTER COLUMN id DROP DEFAULT;

-- Change the column type from UUID to TEXT
-- Since UUID can be cast to TEXT, this is a safe conversion
ALTER TABLE app.agents ALTER COLUMN id TYPE TEXT USING id::TEXT;

-- Add a new default that generates a UUID as text for backward compatibility
-- This means you can still create agents without specifying an ID
ALTER TABLE app.agents ALTER COLUMN id SET DEFAULT gen_random_uuid()::TEXT;

-- Add a comment explaining the ID format
COMMENT ON COLUMN app.agents.id IS
'Agent identifier. Can be a human-readable string (e.g., "agent-zappy",
"claude-content-enhancer") or a UUID string. If not provided during creation,
a UUID will be auto-generated.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed Mock Organization and Agents for Local Development
-- These correspond to the agents defined in mock-identity.config.json
-- ─────────────────────────────────────────────────────────────────────────────

-- Create mock organization for local development
INSERT INTO app.organizations (id, name, settings)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'Mock Organization (Local Development)',
  '{"agentIdleTimeoutMs": 5000}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Seed mock agents that match mock-identity.config.json
-- These agents use string IDs for developer-friendly identification
INSERT INTO app.agents (id, organization_id, name, description, capabilities, status, settings)
VALUES
  (
    'agent-zappy',
    '00000000-0000-0000-0000-000000000000',
    'Zappy AI Assistant',
    'Mock agent for local development and testing',
    ARRAY['content_edit', 'content_create'],
    'active',
    '{}'::jsonb
  ),
  (
    'agent-helper',
    '00000000-0000-0000-0000-000000000000',
    'Helper Bot',
    'Secondary mock agent for testing',
    ARRAY['content_edit'],
    'active',
    '{}'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  capabilities = EXCLUDED.capabilities,
  status = EXCLUDED.status,
  updated_at = NOW();

-- Log successful seeding
DO $$
BEGIN
    RAISE NOTICE 'Mock agents seeded successfully at %', NOW();
END $$;
