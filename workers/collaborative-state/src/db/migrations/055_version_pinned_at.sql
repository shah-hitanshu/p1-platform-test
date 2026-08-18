-- Migration 055: Version Pinned At
--
-- Publish stamps this on the version row it checkpoints, and compaction skips
-- any stamped row. The stamp exists because the checkpoint_documents NOT
-- EXISTS guard alone cannot close the publish-moment race: a compaction
-- UPDATE already waiting on the published row's lock resumes without an
-- EvalPlanQual recheck when publish only locks the row, so its NOT EXISTS was
-- evaluated against a pre-publish snapshot. Stamping is a real tuple update,
-- which forces the recheck, and 'pinned_at IS NULL' is then tested against
-- the updated tuple. [PCC-3652]
--
-- NULL means the row was never directly published; rows published before this
-- column existed stay NULL and remain protected by the NOT EXISTS guard,
-- which has no race for already-committed checkpoints.

ALTER TABLE app.document_versions
  ADD COLUMN pinned_at TIMESTAMPTZ;

COMMENT ON COLUMN app.document_versions.pinned_at IS
  'When publish pinned this row''s snapshot; compaction never nulls a stamped row. NULL for rows never directly published — checkpoint-referenced rows without a stamp are still protected by compaction''s checkpoint_documents guard.';
