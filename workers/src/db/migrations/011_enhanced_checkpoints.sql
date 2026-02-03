-- Migration 011: Enhanced Checkpoints
-- Adds columns to checkpoints table for Agent Politeness System
--
-- Based on collaborative-state-system-architecture-v2.3.md
-- Part of Agent Politeness System

-- ─────────────────────────────────────────────────────────────────────────────
-- Enhanced Checkpoint Fields
-- These fields support the agent politeness workflow by tracking:
-- - What triggered the checkpoint (manual, human_requested, autonomous)
-- - Who requested the agent action (if human_requested)
-- - What operation type was performed
-- - Which regions were affected
-- - Checkpoint status and rollback information
-- ─────────────────────────────────────────────────────────────────────────────

-- Description for detailed checkpoint metadata
ALTER TABLE app.checkpoints
    ADD COLUMN description TEXT;

-- Trigger: How the checkpoint was created
-- manual: User explicitly created checkpoint
-- human_requested: Agent created checkpoint after user requested work
-- autonomous: Agent created checkpoint during autonomous operation
ALTER TABLE app.checkpoints
    ADD COLUMN trigger TEXT DEFAULT 'manual'
        CHECK (trigger IN ('manual', 'human_requested', 'autonomous'));

-- Who requested the agent action (for human_requested trigger)
ALTER TABLE app.checkpoints
    ADD COLUMN requested_by_id UUID;

-- Category of operation that created this checkpoint
-- Examples: 'content_edit', 'style_update', 'component_add', 'merge'
ALTER TABLE app.checkpoints
    ADD COLUMN operation_type TEXT;

-- JSON array of affected regions (JSON paths)
-- Examples: ["/content/0", "/content/0/props/title"]
ALTER TABLE app.checkpoints
    ADD COLUMN affected_regions JSONB DEFAULT '[]';

-- Checkpoint status
-- completed: Checkpoint represents successfully completed operation
-- rolled_back: Operation was rolled back (agent yielded to human)
-- partial: Operation was interrupted before completion
ALTER TABLE app.checkpoints
    ADD COLUMN status TEXT DEFAULT 'completed'
        CHECK (status IN ('completed', 'rolled_back', 'partial'));

-- Rollback tracking
ALTER TABLE app.checkpoints
    ADD COLUMN rolled_back_by_id UUID;

ALTER TABLE app.checkpoints
    ADD COLUMN rolled_back_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments documenting the enhanced schema
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN app.checkpoints.trigger IS
'How the checkpoint was created:
- manual: User explicitly created checkpoint
- human_requested: Agent created after user requested work
- autonomous: Agent created during autonomous operation';

COMMENT ON COLUMN app.checkpoints.requested_by_id IS
'User ID who requested the agent action (populated when trigger = human_requested)';

COMMENT ON COLUMN app.checkpoints.affected_regions IS
'JSON array of JSON paths affected by this checkpoint.
Example: ["/content/0", "/content/0/props/title"]';

COMMENT ON COLUMN app.checkpoints.status IS
'Checkpoint completion status:
- completed: Operation finished successfully
- rolled_back: Operation was rolled back (agent yielded to human)
- partial: Operation was interrupted before completion';
