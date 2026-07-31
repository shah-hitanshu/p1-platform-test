-- Migration 029: Version Patches
--
-- Switches version storage from full-snapshot-per-version to RFC 6902 JSON diffs
-- with periodic full-snapshot baselines.
--
-- Version rows will be one of:
--   Baseline: snapshot populated, patch null — full document JSON
--   Diff: snapshot null, patch populated — RFC 6902 patch from previous version
--
-- Also adds action_type and action_metadata for rich version history
-- (e.g., "User edited Hero component" instead of raw JSON paths).

-- Add patch column for RFC 6902 JSON diffs
ALTER TABLE app.document_versions ADD COLUMN IF NOT EXISTS patch JSONB;

-- Add Puck action metadata columns
ALTER TABLE app.document_versions ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE app.document_versions ADD COLUMN IF NOT EXISTS action_metadata JSONB;

-- Make snapshot nullable — diff versions have patch instead of snapshot
ALTER TABLE app.document_versions ALTER COLUMN snapshot DROP NOT NULL;

-- Note: crdt_state column is kept for now (removed in Phase 3).
-- Phase 2 stops writing to it but doesn't drop it yet.
