-- Migration 019: Incremental Checkpoints (Phase 6.1)
--
-- Adds parent_checkpoint_id to support incremental checkpoints.
-- Incremental checkpoints only capture documents that changed since the parent,
-- reducing checkpoint size for branches with many documents.

ALTER TABLE app.checkpoints
  ADD COLUMN parent_checkpoint_id UUID REFERENCES app.checkpoints(id);

-- Index for walking the checkpoint chain (only on incremental checkpoints)
CREATE INDEX idx_checkpoints_parent
  ON app.checkpoints(parent_checkpoint_id)
  WHERE parent_checkpoint_id IS NOT NULL;
