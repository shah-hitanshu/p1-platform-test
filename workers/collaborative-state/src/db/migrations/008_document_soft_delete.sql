-- Migration 008: Document Soft Delete
-- Adds archived_at column to documents table for soft-delete functionality.
-- Archived documents are excluded from listings by default.
-- Document paths become available for reuse after archival.

-- Add archived_at column
ALTER TABLE app.documents
    ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;

-- Update the unique constraint to only apply to non-archived documents
-- This allows the path to be reused after archival
-- Drop constraint first (this also drops the associated index)
ALTER TABLE app.documents DROP CONSTRAINT IF EXISTS documents_site_id_path_key;

-- Create partial unique index for non-archived documents only
CREATE UNIQUE INDEX documents_site_id_path_active_key
    ON app.documents (site_id, path)
    WHERE archived_at IS NULL;

-- Create index for querying archived documents
CREATE INDEX idx_documents_archived ON app.documents(archived_at)
    WHERE archived_at IS NOT NULL;
