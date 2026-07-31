-- Migration 007: Branch-Scoped Structure Identity
-- Moves structure identity (name, slug, description, structure_type) from
-- site_structures to branch_structure_state for version control consistency.
--
-- This enables:
-- - Renaming structures on a branch without affecting other branches
-- - Full structure state rollback via checkpoints
-- - Structure identity changes being merged like document changes
--
-- Based on PROPOSAL-001-missing-api-endpoints.md

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: Add identity columns to branch_structure_state
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE app.branch_structure_state
    ADD COLUMN name TEXT,
    ADD COLUMN slug TEXT,
    ADD COLUMN description TEXT,
    ADD COLUMN structure_type TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Copy existing data from site_structures
-- For each existing branch_structure_state row, copy identity from site_structures
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE app.branch_structure_state bss
SET
    name = ss.name,
    slug = ss.slug,
    description = ss.description,
    structure_type = ss.structure_type
FROM app.site_structures ss
WHERE bss.structure_id = ss.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: Handle case where branch_structure_state is empty but structures exist
-- Create branch_structure_state entries for main branches that don't have them
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO app.branch_structure_state (
    branch_id,
    structure_id,
    name,
    slug,
    description,
    structure_type,
    structure_tree,
    metadata_schema,
    schema_enforcement
)
SELECT
    b.id AS branch_id,
    ss.id AS structure_id,
    ss.name,
    ss.slug,
    ss.description,
    ss.structure_type,
    '[]'::jsonb AS structure_tree,
    '{"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]}'::jsonb AS metadata_schema,
    'warn' AS schema_enforcement
FROM app.branches b
CROSS JOIN app.site_structures ss
WHERE b.site_id = ss.site_id
  AND b.is_main = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM app.branch_structure_state bss
      WHERE bss.branch_id = b.id AND bss.structure_id = ss.id
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4: Make columns NOT NULL after data migration
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE app.branch_structure_state
    ALTER COLUMN name SET NOT NULL,
    ALTER COLUMN slug SET NOT NULL,
    ALTER COLUMN structure_type SET NOT NULL;

ALTER TABLE app.branch_structure_state
    ALTER COLUMN structure_type SET DEFAULT 'hierarchy';

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 5: Add unique constraint for slug per branch
-- Slug uniqueness is now per-branch instead of per-site
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE app.branch_structure_state
    ADD CONSTRAINT unique_branch_slug UNIQUE(branch_id, slug);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 6: Add identity columns to checkpoint_structures
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE app.checkpoint_structures
    ADD COLUMN name TEXT,
    ADD COLUMN slug TEXT,
    ADD COLUMN description TEXT,
    ADD COLUMN structure_type TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 7: Backfill checkpoint_structures from site_structures
-- For existing checkpoints, copy identity from current site_structures
-- (This is an approximation - ideally checkpoints would have captured this)
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE app.checkpoint_structures cs
SET
    name = ss.name,
    slug = ss.slug,
    description = ss.description,
    structure_type = ss.structure_type
FROM app.site_structures ss
WHERE cs.structure_id = ss.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 8: Make checkpoint columns NOT NULL
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE app.checkpoint_structures
    ALTER COLUMN name SET NOT NULL,
    ALTER COLUMN slug SET NOT NULL,
    ALTER COLUMN structure_type SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 9: Drop old columns from site_structures
-- Structure identity now lives in branch_structure_state
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the old unique constraint first
ALTER TABLE app.site_structures
    DROP CONSTRAINT IF EXISTS site_structures_site_id_slug_key;

-- Drop the now-redundant columns
ALTER TABLE app.site_structures
    DROP COLUMN name,
    DROP COLUMN slug,
    DROP COLUMN description,
    DROP COLUMN structure_type;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 10: Add index for efficient branch structure lookups
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX idx_branch_structure_state_slug ON app.branch_structure_state(branch_id, slug);
