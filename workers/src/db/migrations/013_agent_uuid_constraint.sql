-- Migration 013: Agent UUID Constraint
-- Enforces UUID format for agent IDs to ensure compatibility with
-- checkpoints.created_by_id which requires UUID format.
--
-- Background: Migration 012 changed agents.id from UUID to TEXT to allow
-- "human-readable" IDs. However, checkpoints.created_by_id is still UUID,
-- causing checkpoint creation to fail when agents have non-UUID IDs.
--
-- This migration:
-- 1. Updates existing non-UUID agent IDs to valid UUIDs
-- 2. Adds a CHECK constraint requiring UUID format
-- 3. Updates the mock agents to use UUID IDs

-- ─────────────────────────────────────────────────────────────────────────────
-- Update existing non-UUID agent IDs
-- ─────────────────────────────────────────────────────────────────────────────

-- Update agent-zappy to a deterministic UUID
UPDATE app.agents
SET id = 'a0000000-0000-0000-0000-000000000001',
    updated_at = NOW()
WHERE id = 'agent-zappy';

-- Update agent-helper to a deterministic UUID
UPDATE app.agents
SET id = 'a0000000-0000-0000-0000-000000000002',
    updated_at = NOW()
WHERE id = 'agent-helper';

-- ─────────────────────────────────────────────────────────────────────────────
-- Add CHECK constraint for UUID format
-- ─────────────────────────────────────────────────────────────────────────────

-- Add constraint that validates UUID format using regex
-- UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (8-4-4-4-12 hex chars)
ALTER TABLE app.agents
ADD CONSTRAINT agents_id_uuid_format
CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- Update column comment to reflect UUID requirement
COMMENT ON COLUMN app.agents.id IS
'Agent identifier. Must be a valid UUID string (e.g., "a0000000-0000-0000-0000-000000000001").
If not provided during creation, a UUID will be auto-generated.
Note: UUID format is required for compatibility with checkpoints.created_by_id.';

-- Log migration completion
DO $$
BEGIN
    RAISE NOTICE 'Agent UUID constraint added successfully at %', NOW();
END $$;
