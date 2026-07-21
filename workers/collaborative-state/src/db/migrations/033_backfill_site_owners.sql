-- Backfill owner roles for existing sites.
-- Assigns the main branch creator as 'owner' for each site that
-- doesn't already have an explicit owner in user_site_roles.
-- Only considers user-created branches to avoid seeding agent UUIDs
-- into the user role table.
INSERT INTO app.user_site_roles (user_id, site_id, role, source, created_by_id, updated_at)
SELECT b.created_by_id, b.site_id, 'owner', 'local', b.created_by_id, NOW()
FROM app.branches b
WHERE b.is_main = true
  AND b.created_by_id IS NOT NULL
  AND b.created_by_type = 'user'
ON CONFLICT (user_id, site_id, source) DO NOTHING;
