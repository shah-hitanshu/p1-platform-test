-- Add 'completed_with_conflicts' to migration_jobs status CHECK constraint.
-- The application writes this status when some documents had conflicts during migration.

ALTER TABLE app.migration_jobs
  DROP CONSTRAINT IF EXISTS migration_jobs_status_check;

ALTER TABLE app.migration_jobs
  ADD CONSTRAINT migration_jobs_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'completed_with_conflicts', 'failed'));
