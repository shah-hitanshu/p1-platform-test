-- Migration 022: Enforce Main-Only Branching
-- Branches can only be created from the main branch (copy-on-write model).
-- Re-parent any existing branches with non-main source_branch_id to point to main.

-- Step 1: Re-parent existing branches that have a non-main source_branch_id
UPDATE app.branches b
SET source_branch_id = main.id
FROM (
  SELECT id, site_id
  FROM app.branches
  WHERE is_main = TRUE
) main
WHERE b.site_id = main.site_id
  AND b.is_main = FALSE
  AND b.source_branch_id IS NOT NULL
  AND b.source_branch_id != main.id;

-- Step 2: Add a trigger to enforce that non-main branches must reference a main branch
-- (CHECK constraints cannot reference other rows, so we use a trigger)
CREATE OR REPLACE FUNCTION app.enforce_main_only_branching()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_main = FALSE AND NEW.source_branch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM app.branches
      WHERE id = NEW.source_branch_id AND is_main = TRUE
    ) THEN
      RAISE EXCEPTION 'Branches can only be created from the main branch. source_branch_id must reference a main branch.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_main_only_branching ON app.branches;
CREATE TRIGGER trg_enforce_main_only_branching
  BEFORE INSERT OR UPDATE ON app.branches
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_main_only_branching();
