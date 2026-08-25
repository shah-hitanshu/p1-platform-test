-- Migration 063: Record whether a checkpoint is a full snapshot
--
-- Incremental checkpoints (migration 019) capture only the documents that
-- changed since their parent, so reconstructing the full document set means
-- walking the parent chain. Nothing recorded where that walk can stop, so a
-- resolver had to walk to the branch root — and revert, which reads a single
-- manifest, silently restored a partial set.
--
-- Backfill mirrors the forceFullSnapshot call sites as they existed when the
-- historical rows were written: session_pre_edit (session-checkpoint-client)
-- and pre_migration (migration-service) always swept the whole branch, and
-- parentless checkpoints terminate a walk regardless of how they captured.
-- Everything else with a parent captured a delta.

ALTER TABLE app.checkpoints
  ADD COLUMN is_full_snapshot BOOLEAN;

UPDATE app.checkpoints
  SET is_full_snapshot = (
    parent_checkpoint_id IS NULL
    OR checkpoint_type IN ('session_pre_edit', 'pre_migration')
  );

-- Default false: a writer that forgets to set this describes its checkpoint as
-- a delta, so a resolver keeps walking rather than stopping early on a
-- manifest that doesn't hold the full set.
ALTER TABLE app.checkpoints
  ALTER COLUMN is_full_snapshot SET DEFAULT false,
  ALTER COLUMN is_full_snapshot SET NOT NULL;

COMMENT ON COLUMN app.checkpoints.is_full_snapshot IS
  'True when this checkpoint captured every live document on the branch, so a parent-chain walk can stop here. False for deltas (incremental capture, or an explicit document list such as publish).';
