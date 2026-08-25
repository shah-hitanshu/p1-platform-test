-- Migration 057: Index checkpoints by branch, type, and recency
--
-- Publish lookups filter checkpoints on branch_id and checkpoint_type, then
-- order by created_at to reach the newest. idx_checkpoints_branch covers only
-- branch_id and created_at, so checkpoint_type is applied as a heap filter and
-- every non-publish checkpoint on the branch is read before being discarded.

CREATE INDEX IF NOT EXISTS idx_checkpoints_branch_type_created
  ON app.checkpoints (branch_id, checkpoint_type, created_at DESC);
