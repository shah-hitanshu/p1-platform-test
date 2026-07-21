-- Migration 015: Seed Demo Site Roles
-- Adds default access for demo users on demo sites
--
-- This data mirrors what was previously hardcoded in mock-identity.config.json

-- ─────────────────────────────────────────────────────────────────────────────
-- Demo Sites
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO app.sites (id, pantheon_site_id, name, workflow_settings)
VALUES
    (
        '35b800c4-6010-4908-a724-f1512e2a2144',
        'audi-demo-site',
        'Audi Demo Site',
        '{"mergeApprovalMode": "optional", "minApprovers": 1, "allowSelfApproval": true}'::jsonb
    ),
    (
        '5da7f0d0-81d8-4e92-9a4b-a4cb07090768',
        'demo-site-2',
        'Demo Site 2',
        '{"mergeApprovalMode": "optional", "minApprovers": 1, "allowSelfApproval": true}'::jsonb
    ),
    (
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22',
        'demo-site-3',
        'Demo Site 3',
        '{"mergeApprovalMode": "optional", "minApprovers": 1, "allowSelfApproval": true}'::jsonb
    )
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Demo User Roles
-- Matches users from mock-identity.config.json
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO app.user_site_roles (user_id, site_id, role) VALUES
    -- Alice (11111111-...) : admin on Audi demo site
    ('11111111-1111-1111-1111-111111111111', '35b800c4-6010-4908-a724-f1512e2a2144', 'admin'),

    -- Bob (22222222-...) : team_member on Audi demo site
    ('22222222-2222-2222-2222-222222222222', '35b800c4-6010-4908-a724-f1512e2a2144', 'team_member'),

    -- Carol (33333333-...) : developer on Audi demo site
    ('33333333-3333-3333-3333-333333333333', '35b800c4-6010-4908-a724-f1512e2a2144', 'developer')
ON CONFLICT (user_id, site_id) DO UPDATE SET role = EXCLUDED.role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Demo Agent Roles
-- Zappy AI Assistant access to demo sites
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO app.agent_site_roles (agent_id, site_id, role) VALUES
    -- Zappy has admin access to all demo sites
    ('a0000000-0000-0000-0000-000000000001', '35b800c4-6010-4908-a724-f1512e2a2144', 'admin'),
    ('a0000000-0000-0000-0000-000000000001', '5da7f0d0-81d8-4e92-9a4b-a4cb07090768', 'admin'),
    ('a0000000-0000-0000-0000-000000000001', 'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22', 'admin')
ON CONFLICT (agent_id, site_id) DO UPDATE SET role = EXCLUDED.role;

-- Log successful seeding
DO $$
BEGIN
    RAISE NOTICE 'Demo site roles seeded successfully at %', NOW();
END $$;
