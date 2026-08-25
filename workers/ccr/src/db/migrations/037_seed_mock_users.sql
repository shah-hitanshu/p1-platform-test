-- Migration 035: Seed mock development users with stable stub UUIDs
--
-- Ensures Alice, Bob, and Carol exist in app.users with the stub UUIDs
-- used by the mock login form and referenced throughout the seed data
-- (migrations 006, 015, 033).
--
-- Background: if a mock user logged in before this migration their record
-- was auto-created with gen_random_uuid() rather than the stub UUID, causing
-- user_site_roles lookups (which use dbUserId) to return no results.
-- This was first observed for Alice whose record pre-dated the mock login fix.
--
-- This migration is idempotent: safe to run on a fresh DB or one where
-- some/all mock users already have correct stub UUIDs.

DO $$
DECLARE
  mock_user RECORD;
  old_id TEXT;
BEGIN
  FOR mock_user IN
    SELECT *
    FROM (VALUES
      ('11111111-1111-1111-1111-111111111111'::UUID, 'alice@example.com', 'Alice Developer', 'admin'),
      ('22222222-2222-2222-2222-222222222222'::UUID, 'bob@example.com',   'Bob Reviewer',   'member'),
      ('33333333-3333-3333-3333-333333333333'::UUID, 'carol@example.com', 'Carol Editor',   'admin')
    ) AS t(stub_id, email, name, system_role)
  LOOP
    -- Nothing to do if already using the correct stub UUID
    IF EXISTS (SELECT 1 FROM app.users WHERE id = mock_user.stub_id) THEN
      CONTINUE;
    END IF;

    -- Find any existing record for this email with a different UUID
    SELECT id::TEXT INTO old_id FROM app.users WHERE email = mock_user.email;

    IF old_id IS NOT NULL THEN
      -- Drop old_id rows that would conflict with an existing stub_id row
      -- (same site + source combination already exists for the stub UUID)
      DELETE FROM app.user_site_roles old_row
      WHERE old_row.user_id = old_id
        AND EXISTS (
          SELECT 1 FROM app.user_site_roles stub_row
          WHERE stub_row.user_id = mock_user.stub_id::TEXT
            AND stub_row.site_id = old_row.site_id
            AND stub_row.source = old_row.source
        );

      -- Migrate remaining old_id rows to the stub UUID
      UPDATE app.user_site_roles
      SET user_id = mock_user.stub_id::TEXT
      WHERE user_id = old_id;

      -- Remove the old random-UUID record
      DELETE FROM app.users WHERE id = old_id::UUID;
    END IF;

    -- Insert with the correct stub UUID.
    -- Set principal_id = stub_id so the first-login self-heal path is skipped on
    -- next login (avoids the self-join DELETE that would wipe user_site_roles
    -- when principal.id == userRow.id).
    INSERT INTO app.users (id, email, name, auth_provider, system_role, is_active, principal_id)
    VALUES (mock_user.stub_id, mock_user.email, mock_user.name, 'mock', mock_user.system_role, true, mock_user.stub_id::TEXT)
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

-- Grant mock admin users (Alice, Carol) owner access to all active demo sites
-- so they can see everything in a local dev environment.
-- ON CONFLICT DO NOTHING makes this safe to re-run.
INSERT INTO app.user_site_roles (user_id, site_id, role, source, created_by_id, updated_at)
SELECT
  u.id::TEXT,
  s.id,
  'owner',
  'local',
  u.id::TEXT,
  NOW()
FROM app.users u
CROSS JOIN app.sites s
WHERE u.email IN ('alice@example.com', 'carol@example.com')
  AND u.system_role = 'admin'
  AND s.archived_at IS NULL
ON CONFLICT (user_id, site_id, source) DO NOTHING;
