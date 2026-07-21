-- Migration 023: Copy-on-Write Cleanup — Remove Duplicate Version Rows
--
-- With copy-on-write branching, non-main branches inherit published content from main.
-- Before this change, branch creation copied all version rows from main to the new branch.
-- This migration removes those duplicate v1 rows where the snapshot matches main's latest,
-- since fallback to main now serves the same content.
--
-- Steps:
--   1. Update checkpoint_documents that reference duplicate v1 rows to point to main's version
--   2. Delete branch_document_metadata for documents that will have no remaining versions
--   3. Delete the duplicate v1 version rows

-- Step 1: Remap checkpoint_documents from duplicate branch v1 rows to main's latest version
WITH duplicates AS (
  SELECT
    bv.id AS branch_version_id,
    main_ver.id AS main_version_id
  FROM app.document_versions bv
  JOIN app.branches b ON bv.branch_id = b.id AND b.is_main = FALSE
  JOIN app.sites s ON b.site_id = s.id
  JOIN app.branches mb ON mb.site_id = s.id AND mb.is_main = TRUE
  JOIN LATERAL (
    SELECT dv.id, dv.snapshot
    FROM app.document_versions dv
    WHERE dv.document_id = bv.document_id
      AND dv.branch_id = mb.id
    ORDER BY dv.version_number DESC
    LIMIT 1
  ) main_ver ON true
  WHERE bv.version_number = 1
    AND bv.snapshot = main_ver.snapshot
    -- Only include v1 rows that are the ONLY version on the branch for this document
    -- (if there are higher versions, the v1 is still needed as history)
    AND NOT EXISTS (
      SELECT 1 FROM app.document_versions
      WHERE document_id = bv.document_id
        AND branch_id = bv.branch_id
        AND version_number > 1
    )
)
UPDATE app.checkpoint_documents cd
SET document_version_id = d.main_version_id
FROM duplicates d
WHERE cd.document_version_id = d.branch_version_id;

-- Step 2: Delete branch_document_metadata for documents that will lose their only version
DELETE FROM app.branch_document_metadata bdm
WHERE EXISTS (
  SELECT 1
  FROM app.document_versions bv
  JOIN app.branches b ON bv.branch_id = b.id AND b.is_main = FALSE
  JOIN app.sites s ON b.site_id = s.id
  JOIN app.branches mb ON mb.site_id = s.id AND mb.is_main = TRUE
  JOIN LATERAL (
    SELECT dv.snapshot
    FROM app.document_versions dv
    WHERE dv.document_id = bv.document_id
      AND dv.branch_id = mb.id
    ORDER BY dv.version_number DESC
    LIMIT 1
  ) main_ver ON true
  WHERE bv.version_number = 1
    AND bv.snapshot = main_ver.snapshot
    AND NOT EXISTS (
      SELECT 1 FROM app.document_versions
      WHERE document_id = bv.document_id
        AND branch_id = bv.branch_id
        AND version_number > 1
    )
    AND bdm.document_id = bv.document_id
    AND bdm.branch_id = bv.branch_id
);

-- Step 3: Delete duplicate v1 version rows (only where no higher versions exist)
DELETE FROM app.document_versions bv
USING app.branches b,
      app.sites s,
      app.branches mb
WHERE bv.branch_id = b.id
  AND b.is_main = FALSE
  AND b.site_id = s.id
  AND mb.site_id = s.id
  AND mb.is_main = TRUE
  AND bv.version_number = 1
  AND EXISTS (
    SELECT 1
    FROM app.document_versions dv
    WHERE dv.document_id = bv.document_id
      AND dv.branch_id = mb.id
    ORDER BY dv.version_number DESC
    LIMIT 1
  )
  AND bv.snapshot = (
    SELECT dv.snapshot
    FROM app.document_versions dv
    WHERE dv.document_id = bv.document_id
      AND dv.branch_id = mb.id
    ORDER BY dv.version_number DESC
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM app.document_versions dv2
    WHERE dv2.document_id = bv.document_id
      AND dv2.branch_id = bv.branch_id
      AND dv2.version_number > 1
  );
