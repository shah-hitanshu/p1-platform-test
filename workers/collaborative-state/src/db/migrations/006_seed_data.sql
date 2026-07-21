-- Migration 006: Seed Data
-- Inserts test data for local development and testing
--
-- This data is designed to exercise all major features of the system

-- ─────────────────────────────────────────────────────────────────────────────
-- Test Sites
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO app.sites (id, pantheon_site_id, name, workflow_settings) VALUES
  (
    'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    'site-acme-corp',
    'Acme Corp Website',
    '{
      "mergeApprovalMode": "required",
      "minApprovers": 1,
      "allowSelfApproval": false,
      "approverMode": "role_based",
      "approverMinRole": "EDITOR"
    }'::jsonb
  ),
  (
    'b2c3d4e5-f6a7-5b6c-9d0e-1f2a3b4c5d6e',
    'site-demo-store',
    'Demo Store',
    '{
      "mergeApprovalMode": "optional",
      "minApprovers": 1,
      "allowSelfApproval": true,
      "approverMode": "both",
      "approverMinRole": "EDITOR"
    }'::jsonb
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Test Documents
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO app.documents (id, site_id, path) VALUES
  -- Acme Corp documents
  ('d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'pages/home'),
  ('d2e3f4a5-b6c7-5d8e-9f0a-1b2c3d4e5f6b', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'pages/about'),
  ('d3e4f5a6-b7c8-6d9e-0f1a-2b3c4d5e6f7c', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'pages/contact'),
  ('d4e5f6a7-b8c9-7d0e-1f2a-3b4c5d6e7f8d', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'components/header'),
  ('d5e6f7a8-b9c0-8d1e-2f3a-4b5c6d7e8f9e', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'components/footer'),

  -- Demo Store documents
  ('d6e7f8a9-b0c1-9d2e-3f4a-5b6c7d8e9f0f', 'b2c3d4e5-f6a7-5b6c-9d0e-1f2a3b4c5d6e', 'pages/home'),
  ('d7e8f9a0-b1c2-0d3e-4f5a-6b7c8d9e0f1a', 'b2c3d4e5-f6a7-5b6c-9d0e-1f2a3b4c5d6e', 'pages/products'),
  ('d8e9f0a1-b2c3-1d4e-5f6a-7b8c9d0e1f2b', 'b2c3d4e5-f6a7-5b6c-9d0e-1f2a3b4c5d6e', 'pages/cart');

-- ─────────────────────────────────────────────────────────────────────────────
-- Test Branches (main branches created first)
-- ─────────────────────────────────────────────────────────────────────────────

-- System user ID for automated operations
-- Using a well-known UUID for the system user
DO $$
DECLARE
  system_user_id UUID := '00000000-0000-0000-0000-000000000001';
  test_user_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN

  -- Main branches
  INSERT INTO app.branches (id, site_id, name, description, status, is_main, created_by_id, created_by_type) VALUES
    ('b1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'main', 'Production branch', 'active', TRUE, system_user_id, 'system'),
    ('b2a3b4c5-d6e7-5f8a-9b0c-1d2e3f4a5b6d', 'b2c3d4e5-f6a7-5b6c-9d0e-1f2a3b4c5d6e', 'main', 'Production branch', 'active', TRUE, system_user_id, 'system');

  -- Feature branches
  INSERT INTO app.branches (id, site_id, name, description, status, is_main, source_branch_id, created_by_id, created_by_type) VALUES
    ('b3a4b5c6-d7e8-6f9a-0b1c-2d3e4f5a6b7e', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'holiday-campaign-2024', 'Q4 holiday promotional updates', 'active', FALSE, 'b1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c', test_user_id, 'user'),
    ('b4a5b6c7-d8e9-7f0a-1b2c-3d4e5f6a7b8f', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'fix-about-typo', 'Fix typo on about page', 'review', FALSE, 'b1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c', test_user_id, 'user');

END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Test Document Versions
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  system_user_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN

  -- Initial versions on main branch for Acme Corp
  INSERT INTO app.document_versions (id, document_id, branch_id, version_number, snapshot, source, created_by_id, created_by_type) VALUES
    (
      'e1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
      'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
      'b1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
      1,
      '{"type": "page", "title": "Welcome to Acme Corp", "components": [{"type": "Hero", "props": {"heading": "Building the Future"}}]}'::jsonb,
      'edit',
      system_user_id,
      'system'
    ),
    (
      'e2a3b4c5-d6e7-5f8a-9b0c-1d2e3f4a5b6d',
      'd2e3f4a5-b6c7-5d8e-9f0a-1b2c3d4e5f6b',
      'b1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
      1,
      '{"type": "page", "title": "About Us", "components": [{"type": "TextBlock", "props": {"content": "Learn more about Acme Corp"}}]}'::jsonb,
      'edit',
      system_user_id,
      'system'
    );

  -- Initial versions on main branch for Demo Store
  INSERT INTO app.document_versions (id, document_id, branch_id, version_number, snapshot, source, created_by_id, created_by_type) VALUES
    (
      'e3a4b5c6-d7e8-6f9a-0b1c-2d3e4f5a6b7e',
      'd6e7f8a9-b0c1-9d2e-3f4a-5b6c7d8e9f0f',
      'b2a3b4c5-d6e7-5f8a-9b0c-1d2e3f4a5b6d',
      1,
      '{"type": "page", "title": "Demo Store Home", "components": [{"type": "ProductGrid", "props": {"columns": 3}}]}'::jsonb,
      'edit',
      system_user_id,
      'system'
    );

END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Test Checkpoints
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  system_user_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN

  INSERT INTO app.checkpoints (id, branch_id, name, message, checkpoint_type, created_by_id, created_by_type) VALUES
    (
      'c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
      'b1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
      'Initial Release',
      'Initial site launch',
      'manual',
      system_user_id,
      'system'
    ),
    (
      'c2a3b4c5-d6e7-5f8a-9b0c-1d2e3f4a5b6d',
      'b2a3b4c5-d6e7-5f8a-9b0c-1d2e3f4a5b6d',
      'Store Launch',
      'Initial store launch',
      'manual',
      system_user_id,
      'system'
    );

END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Link checkpoints to document versions
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO app.checkpoint_documents (checkpoint_id, document_id, document_version_id) VALUES
  ('c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c', 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a', 'e1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c'),
  ('c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c', 'd2e3f4a5-b6c7-5d8e-9f0a-1b2c3d4e5f6b', 'e2a3b4c5-d6e7-5f8a-9b0c-1d2e3f4a5b6d'),
  ('c2a3b4c5-d6e7-5f8a-9b0c-1d2e3f4a5b6d', 'd6e7f8a9-b0c1-9d2e-3f4a-5b6c7d8e9f0f', 'e3a4b5c6-d7e8-6f9a-0b1c-2d3e4f5a6b7e');

-- ─────────────────────────────────────────────────────────────────────────────
-- Test Site Structures
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO app.site_structures (id, site_id, name, slug, description, structure_type) VALUES
  (
    'f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
    'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    'Main Navigation',
    'main-nav',
    'Primary site navigation structure',
    'hierarchy'
  ),
  (
    'f2a3b4c5-d6e7-5f8a-9b0c-1d2e3f4a5b6d',
    'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    'Blog',
    'blog',
    'Blog post collection',
    'collection'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Test Structure Nodes
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO app.structure_nodes (id, structure_id, parent_node_id, position, name, slug, node_type, document_id) VALUES
  -- Main Navigation root nodes
  ('01a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c', 'f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c', NULL, 0, 'Home', 'home', 'document', 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a'),
  ('02a3b4c5-d6e7-5f8a-9b0c-1d2e3f4a5b6d', 'f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c', NULL, 1, 'About', 'about', 'document', 'd2e3f4a5-b6c7-5d8e-9f0a-1b2c3d4e5f6b'),
  ('03a4b5c6-d7e8-6f9a-0b1c-2d3e4f5a6b7e', 'f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c', NULL, 2, 'Contact', 'contact', 'document', 'd3e4f5a6-b7c8-6d9e-0f1a-2b3c4d5e6f7c');

-- ─────────────────────────────────────────────────────────────────────────────
-- Test Branch Structure State
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO app.branch_structure_state (branch_id, structure_id, structure_tree, metadata_schema, schema_enforcement) VALUES
  (
    'b1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
    'f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
    '[
      {"id": "01a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c", "name": "Home", "slug": "home", "path": "/home", "nodeType": "document", "documentId": "d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a", "isVisible": true, "children": []},
      {"id": "02a3b4c5-d6e7-5f8a-9b0c-1d2e3f4a5b6d", "name": "About", "slug": "about", "path": "/about", "nodeType": "document", "documentId": "d2e3f4a5-b6c7-5d8e-9f0a-1b2c3d4e5f6b", "isVisible": true, "children": []},
      {"id": "03a4b5c6-d7e8-6f9a-0b1c-2d3e4f5a6b7e", "name": "Contact", "slug": "contact", "path": "/contact", "nodeType": "document", "documentId": "d3e4f5a6-b7c8-6d9e-0f1a-2b3c4d5e6f7c", "isVisible": true, "children": []}
    ]'::jsonb,
    '{
      "type": "object",
      "properties": {
        "title": {"type": "string", "maxLength": 100},
        "description": {"type": "string", "maxLength": 300},
        "keywords": {"type": "array", "items": {"type": "string"}}
      },
      "required": ["title"]
    }'::jsonb,
    'warn'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Test Branch Document Metadata
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO app.branch_document_metadata (branch_id, structure_id, document_id, metadata, conforms_to_schema, validation_errors) VALUES
  (
    'b1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
    'f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
    'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
    '{"title": "Welcome to Acme Corp", "description": "The official website of Acme Corporation", "keywords": ["acme", "technology", "innovation"]}'::jsonb,
    TRUE,
    '[]'::jsonb
  ),
  (
    'b1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
    'f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
    'd2e3f4a5-b6c7-5d8e-9f0a-1b2c3d4e5f6b',
    '{"title": "About Acme Corp", "description": "Learn about our history and mission"}'::jsonb,
    TRUE,
    '[]'::jsonb
  );

-- Log successful seeding
DO $$
BEGIN
    RAISE NOTICE 'Seed data inserted successfully at %', NOW();
END $$;
