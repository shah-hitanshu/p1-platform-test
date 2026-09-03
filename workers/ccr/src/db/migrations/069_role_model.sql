-- PCC-3479: the P1 role model
--
-- Two separate notions of "admin", which used to be one:
--
--   app.users.system_role         platform-wide, granted by us. In practice just
--                                 member or superadmin: `superadmin` is P1-only
--                                 (no Content Publisher counterpart) and reaches
--                                 every organization, every site under them, and
--                                 the staff tools. The legacy `admin` value is
--                                 still accepted by the column but no longer read
--                                 by anything.
--
--   organization_members.role     per business account, granted by whoever runs
--                                 that account. Decides who may manage its
--                                 users, agents and agent API keys. One of
--                                 member, admin, or owner — owner being an
--                                 admin that also answers "who does this
--                                 account belong to", which owner_email needs
--                                 and which the roster API will not demote or
--                                 remove while it is the last one.
--
-- Keeping them apart is what stops "admin of the business account I set up for
-- myself" from meaning "admin of every business account I am ever invited to" —
-- which self-service onboarding would otherwise make the common case.

-- --------------------------------------------------------------------------
-- Per-account role
-- --------------------------------------------------------------------------

ALTER TABLE app.organization_members
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

ALTER TABLE app.organization_members
    DROP CONSTRAINT IF EXISTS organization_members_role_check;
ALTER TABLE app.organization_members
    ADD CONSTRAINT organization_members_role_check
    CHECK (role IN ('member', 'admin', 'owner'));

COMMENT ON COLUMN app.organization_members.role IS
    'Role within this business account: member (default), admin (manages its users, agents and agent API keys), or owner — an admin that is also who the account belongs to, which is what owner_email reports. An account may have more than one; the roster API refuses to demote or remove the last.';

-- Covers both roles that administer an account: isOrgAdmin and
-- countOrganizationAdmins accept owner as well as admin, so an index on
-- `role = 'admin'` alone would stop serving them.
CREATE INDEX IF NOT EXISTS idx_org_members_org_admin
    ON app.organization_members(organization_id)
    WHERE role IN ('admin', 'owner');

-- --------------------------------------------------------------------------
-- Backfill
-- --------------------------------------------------------------------------

-- Anyone who was a platform admin keeps administering the accounts they already
-- belong to — which is what the platform role was standing in for. This has to
-- run before the demotion below, while system_role still says who they were.
-- Superadmins pass every org check on the strength of the role alone, but are
-- granted rows too so a later demotion doesn't silently strip them of accounts
-- they actually run.
UPDATE app.organization_members om
   SET role = 'admin'
  FROM app.users u
 WHERE u.id = om.user_id
   AND u.system_role IN ('admin', 'superadmin')
   AND om.role <> 'admin';

-- Every account gets an owner: its earliest member. createOrgForUser inserts
-- the creator first, so that is the person the account was set up for — and on
-- the single-member accounts Phase 1 produces, the only candidate anyway.
--
-- This also settles the "no admin" case the platform-admin backfill above
-- leaves behind. An account with no admin cannot be managed by anyone, and
-- accounts created before this migration recorded no role at all; owner counts
-- as admin everywhere, so promoting the earliest member covers both.
--
-- Runs after the platform-admin pass and deliberately overwrites it: someone
-- who is both the earliest member and a former platform admin should come out
-- of this as owner, which is the stronger of the two.
--
-- The NOT IN guard makes the statement re-runnable by hand. Nothing can hold
-- 'owner' before the CHECK above, so on the migration's own run it excludes
-- nothing.
UPDATE app.organization_members
   SET role = 'owner'
 WHERE id IN (
        SELECT DISTINCT ON (organization_id) id
          FROM app.organization_members
         WHERE organization_id NOT IN (
                SELECT organization_id
                  FROM app.organization_members
                 WHERE role = 'owner'
               )
         ORDER BY organization_id, created_at, id
       );

-- --------------------------------------------------------------------------
-- Platform role
-- --------------------------------------------------------------------------

-- Everyone starts over as a plain member. `admin` used to mean "ADMIN on every
-- site on the platform", which is not what the people holding it needed —
-- managing their own business account is organization_members.role now, and the
-- backfill above has already given each of them that. Superadmin is granted
-- deliberately, one person at a time, rather than inherited by a rename:
--
--   UPDATE app.users SET system_role = 'superadmin' WHERE email = '...';
UPDATE app.users
   SET system_role = 'member', updated_at = NOW()
 WHERE system_role NOT IN ('member', 'superadmin');

-- The column never had a CHECK, so the value set was only enforced in
-- application code. Pin it now that a third role exists. `admin` stays a legal
-- value — nothing reads it any more, so a row carrying it is exactly a member.
ALTER TABLE app.users DROP CONSTRAINT IF EXISTS users_system_role_check;
ALTER TABLE app.users
    ADD CONSTRAINT users_system_role_check
    CHECK (system_role IN ('member', 'admin', 'superadmin'));

COMMENT ON COLUMN app.users.system_role IS
    'Platform-wide role: member (default), or superadmin (P1-only Pantheon staff: sees every organization, every site under them, and the staff tools). `admin` is legacy and grants nothing. Administering a single business account is organization_members.role, not this.';
