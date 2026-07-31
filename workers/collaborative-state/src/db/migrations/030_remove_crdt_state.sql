-- Migration: 030_remove_crdt_state
-- Description: Remove deprecated crdt_state column from document_versions
-- Phase 3: CRDT storage removal

ALTER TABLE app.document_versions DROP COLUMN IF EXISTS crdt_state;
