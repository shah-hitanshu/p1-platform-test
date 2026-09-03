-- is_active mirrors app.users.is_active: a boolean, not the archived_at-style
-- timestamp used for sites/branches/organizations, since this is the same
-- "suspended person" concept scoped to one org instead of the whole platform.
-- PATCH /api/organizations/{orgId}/users/{userId} reads and writes it, and
-- canAccessOrganization, isOrgAdmin and the member/admin head counts all
-- require it: a deactivated member is suspended from the account, so they
-- neither reach it through membership nor keep the last-admin guard satisfied.
ALTER TABLE app.organization_members ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
