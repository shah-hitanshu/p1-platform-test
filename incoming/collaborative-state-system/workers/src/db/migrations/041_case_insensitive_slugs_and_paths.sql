-- Migration 041: Case-Insensitive Slugs and Paths
--
-- Normalizes all slugs and document paths for case-insensitive lookups.
-- Slugs are lowercased and invalid characters (outside [a-z0-9._-]) are
-- replaced with hyphens. Document paths are lowercased. The application
-- layer now validates and normalizes on write; this migration brings
-- existing data into the same canonical form.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: Lowercase slugs in branch_structure_state
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT branch_id, REGEXP_REPLACE(LOWER(slug), '[^a-z0-9._-]', '-', 'g'), COUNT(*)
    FROM app.branch_structure_state
    GROUP BY branch_id, REGEXP_REPLACE(LOWER(slug), '[^a-z0-9._-]', '-', 'g')
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate: found % branch_structure_state rows with duplicate slugs after normalization. Resolve manually before re-running.', dup_count;
  END IF;
END $$;

UPDATE app.branch_structure_state
SET slug = REGEXP_REPLACE(LOWER(slug), '[^a-z0-9._-]', '-', 'g')
WHERE slug != REGEXP_REPLACE(LOWER(slug), '[^a-z0-9._-]', '-', 'g');

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Lowercase slugs in structure_nodes
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT structure_id, parent_node_id, REGEXP_REPLACE(LOWER(slug), '[^a-z0-9._-]', '-', 'g'), COUNT(*)
    FROM app.structure_nodes
    GROUP BY structure_id, parent_node_id, REGEXP_REPLACE(LOWER(slug), '[^a-z0-9._-]', '-', 'g')
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate: found % structure_nodes rows with duplicate slugs after normalization. Resolve manually before re-running.', dup_count;
  END IF;
END $$;

UPDATE app.structure_nodes
SET slug = REGEXP_REPLACE(LOWER(slug), '[^a-z0-9._-]', '-', 'g')
WHERE slug != REGEXP_REPLACE(LOWER(slug), '[^a-z0-9._-]', '-', 'g');

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: Lowercase paths in documents
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT site_id, LOWER(path), COUNT(*)
    FROM app.documents
    WHERE archived_at IS NULL
    GROUP BY site_id, LOWER(path)
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate: found % active document rows with case-insensitive duplicate paths. Resolve manually before re-running.', dup_count;
  END IF;
END $$;

UPDATE app.documents
SET path = LOWER(path)
WHERE path != LOWER(path);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4: Lowercase slugs in checkpoint_structures (historical data)
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE app.checkpoint_structures
SET slug = REGEXP_REPLACE(LOWER(slug), '[^a-z0-9._-]', '-', 'g')
WHERE slug != REGEXP_REPLACE(LOWER(slug), '[^a-z0-9._-]', '-', 'g');
