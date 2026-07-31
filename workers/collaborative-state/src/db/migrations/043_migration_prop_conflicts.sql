-- Record prop-level migration conflicts alongside structural ones.
-- prop_conflicts lists the props a template changed that the document had
-- locally edited; conflict_type distinguishes these from structural conflicts
-- so resolution can act surgically on the diverged props.

ALTER TABLE app.migration_conflicts
  ADD COLUMN prop_conflicts JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE app.migration_conflicts
  ADD COLUMN conflict_type TEXT NOT NULL DEFAULT 'structural'
    CHECK (conflict_type IN ('structural', 'prop'));
