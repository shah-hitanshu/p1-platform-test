/**
 * Agent Politeness System - Phase 1.3: Organization Service Tests (TDD)
 *
 * Tests for Organization CRUD operations.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { OrganizationSettings } from '../../src/types';
import { organizationMembers, organizations, sites, users } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import {
  addUserToOrganization,
  archiveOrganization,
  countOrganizationAdmins,
  countOrganizationMembers,
  createOrgForUser,
  createOrganization,
  deleteOrganization,
  getOrganizationById,
  getOrganizationForSite,
  getOrganizationRole,
  getOrganizationsForUser,
  getSitesByOrganization,
  getUserOwnedOrg,
  hasActiveOrgMembership,
  isEmailInAnyOrganization,
  linkOrgToSpace,
  linkSiteToOrganization,
  listOrganizations,
  restoreOrganization,
  unlinkSiteFromOrganization,
  updateOrganization,
  updateOrganizationMember,
} from '../../src/services/organization-service';
import {
  InvalidOrganizationParamsError,
  OrganizationHasActiveSitesError,
  OrganizationHasSitesError,
  OrganizationNotFoundError,
} from '../../src/services/errors';

describe('Agent Politeness Phase 1.3: Organization Service', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
  });

  // Default organization settings as defined in schema
  const defaultOrganizationSettings: OrganizationSettings = {
    agentIdleTimeoutMs: 5000,
  };

  /**
   * An organization row in the schema's property names. The raw "organizations
   * I belong to" statements alias their columns to the same names, so one
   * builder serves both readers.
   */
  function organizationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'org-uuid-123',
      name: 'Test Organization',
      settings: defaultOrganizationSettings,
      createdAt: new Date('2026-01-26T10:00:00.000Z'),
      updatedAt: new Date('2026-01-26T10:00:00.000Z'),
      archivedAt: null,
      ...overrides,
    };
  }

  /** A driver error carrying a SQLSTATE, as the stub will wrap it. */
  function driverError(code: string): Error {
    const error = new Error('foreign key constraint violation') as NodeJS.ErrnoException;
    error.code = code;
    return error;
  }

  describe('createOrganization', () => {
    it('should create an organization with required fields', async () => {
      database.on(organizations).insert.returns([organizationRow()]);

      const result = await createOrganization({
        name: 'Test Organization',
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Organization');
      expect(result.id).toBeDefined();
      expect(result.settings.agentIdleTimeoutMs).toBe(5000);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create an organization with custom settings', async () => {
      const customSettings: OrganizationSettings = {
        agentIdleTimeoutMs: 10000,
      };
      database.on(organizations).insert.returns([organizationRow({ settings: customSettings })]);

      const result = await createOrganization({
        name: 'Custom Org',
        settings: customSettings,
      });

      expect(result.settings.agentIdleTimeoutMs).toBe(10000);
    });

    it('should throw InvalidOrganizationParamsError for empty name', async () => {
      await expect(
        createOrganization({
          name: '',
        }),
      ).rejects.toThrow(InvalidOrganizationParamsError);
    });

    it('should throw InvalidOrganizationParamsError for whitespace-only name', async () => {
      await expect(
        createOrganization({
          name: '   ',
        }),
      ).rejects.toThrow(InvalidOrganizationParamsError);
    });

    it('should throw InvalidOrganizationParamsError for a name over 255 characters', async () => {
      await expect(
        createOrganization({ name: 'a'.repeat(256) }),
      ).rejects.toThrow(InvalidOrganizationParamsError);
    });

    it('should throw InvalidOrganizationParamsError for a name containing control characters', async () => {
      await expect(
        createOrganization({ name: 'Evil\r\nSubject: hijacked' }),
      ).rejects.toThrow(InvalidOrganizationParamsError);
    });
  });

  describe('getOrganizationById', () => {
    it('should return an organization by ID', async () => {
      database.on(organizations).select.returns([organizationRow()]);

      const result = await getOrganizationById('org-uuid-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('org-uuid-123');
      expect(result?.name).toBe('Test Organization');
    });

    it('should return null for non-existent organization', async () => {
      const result = await getOrganizationById('non-existent-id');

      expect(result).toBeNull();
    });

    it('should parse settings from string format (JSONB)', async () => {
      database.on(organizations).select.returns([
        organizationRow({ settings: JSON.stringify({ agentIdleTimeoutMs: 7500 }) }),
      ]);

      const result = await getOrganizationById('org-uuid-123');

      expect(result?.settings.agentIdleTimeoutMs).toBe(7500);
    });
  });

  describe('updateOrganization', () => {
    it('should update organization name', async () => {
      database.on(organizations).update.returns([organizationRow({ name: 'Updated Name' })]);

      const result = await updateOrganization('org-uuid-123', {
        name: 'Updated Name',
      });

      expect(result).toBeDefined();
      expect(result?.name).toBe('Updated Name');
    });

    it('should update organization settings', async () => {
      const updatedSettings: OrganizationSettings = {
        agentIdleTimeoutMs: 15000,
      };
      database.on(organizations).update.returns([organizationRow({ settings: updatedSettings })]);

      const result = await updateOrganization('org-uuid-123', {
        settings: updatedSettings,
      });

      expect(result?.settings.agentIdleTimeoutMs).toBe(15000);
    });

    // A jsonb parameter is bound as text by a statement that concatenates it,
    // so an object would arrive as [object Object].
    it('merges settings rather than replacing them', async () => {
      database.on(organizations).update.returns([organizationRow()]);

      await updateOrganization('org-uuid-123', { settings: { agentIdleTimeoutMs: 15000 } });

      const [call] = database.calls(organizations).update;
      expect(call?.sql).toContain('||');
      expect(call?.params).toContain(JSON.stringify({ agentIdleTimeoutMs: 15000 }));
    });

    it('should return null for non-existent organization', async () => {
      const result = await updateOrganization('non-existent-id', {
        name: 'New Name',
      });

      expect(result).toBeNull();
    });

    it('reads the organization back when there is nothing to change', async () => {
      database.on(organizations).select.returns([organizationRow()]);

      const result = await updateOrganization('org-uuid-123', {});

      expect(result?.id).toBe('org-uuid-123');
      expect(database.calls(organizations).update).toHaveLength(0);
    });

    it('should throw InvalidOrganizationParamsError for empty name', async () => {
      await expect(
        updateOrganization('org-uuid-123', {
          name: '',
        }),
      ).rejects.toThrow(InvalidOrganizationParamsError);
    });

    it('should throw InvalidOrganizationParamsError for a name over 255 characters', async () => {
      await expect(
        updateOrganization('org-uuid-123', { name: 'a'.repeat(256) }),
      ).rejects.toThrow(InvalidOrganizationParamsError);
    });

    it('should not validate name when the PATCH does not touch it', async () => {
      database.on(organizations).update.returns([organizationRow()]);

      await expect(
        updateOrganization('org-uuid-123', { settings: { agentIdleTimeoutMs: 1000 } }),
      ).resolves.toBeDefined();
    });
  });

  describe('deleteOrganization', () => {
    it('should delete an organization and return true', async () => {
      database.on(organizations).delete.returns([{ id: 'org-uuid-123' }]);

      const result = await deleteOrganization('org-uuid-123');

      expect(result).toBe(true);
    });

    it('should return false for non-existent organization', async () => {
      const result = await deleteOrganization('non-existent-id');

      expect(result).toBe(false);
    });

    it('should throw OrganizationHasSitesError when organization has linked sites', async () => {
      database.on(organizations).delete.rejects(driverError('23503'));

      await expect(deleteOrganization('org-with-sites')).rejects.toThrow(OrganizationHasSitesError);
    });
  });

  // ===========================================================================
  // PCC-3211: Soft delete — archiveOrganization / restoreOrganization / list filter
  // ===========================================================================

  describe('archiveOrganization', () => {
    it('should set archived_at and return true', async () => {
      database.on(sites).select.returnsRaw([{ value: 0 }]);
      database.on(organizations).update.returns([{ id: 'org-uuid-123' }]);

      const result = await archiveOrganization('org-uuid-123');

      expect(result).toBe(true);
    });

    it('should return false when organization not found', async () => {
      database.on(sites).select.returnsRaw([{ value: 0 }]);

      const result = await archiveOrganization('non-existent');

      expect(result).toBe(false);
    });

    it('should return already_archived when org exists but is already archived', async () => {
      database.on(sites).select.returnsRaw([{ value: 0 }]);
      database.on(organizations).select.returns([{ id: 'org-uuid-123' }]);

      const result = await archiveOrganization('org-uuid-123');

      expect(result).toBe('already_archived');
    });

    it('should throw OrganizationHasActiveSitesError when org has active sites', async () => {
      database.on(sites).select.returnsRaw([{ value: 2 }]);

      await expect(archiveOrganization('org-uuid-123')).rejects.toThrow(OrganizationHasActiveSitesError);
    });

    // Two requests can archive at once; the UPDATE carries the same check as
    // the read before it so the second cannot land after a site is added.
    it('re-checks for active sites in the statement that archives', async () => {
      database.on(sites).select.returnsRaw([{ value: 0 }]);
      database.on(organizations).update.returns([{ id: 'org-uuid-123' }]);

      await archiveOrganization('org-uuid-123');

      const [call] = database.calls(organizations).update;
      expect(call?.sql).toContain('not exists');
    });
  });

  describe('restoreOrganization', () => {
    it('should clear archived_at and return true', async () => {
      database.on(organizations).update.returns([{ id: 'org-uuid-123' }]);

      const result = await restoreOrganization('org-uuid-123');

      expect(result).toBe(true);
    });

    it('should return false when organization not found or not archived', async () => {
      const result = await restoreOrganization('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('listOrganizations — archived filter (PCC-3211)', () => {
    it('should exclude archived organizations by default', async () => {
      await listOrganizations();

      const [call] = database.calls(organizations).select;
      expect(call?.sql).toContain('"archived_at" is null');
    });

    it('should return only archived organizations when archived=true', async () => {
      await listOrganizations({ archived: true });

      const [call] = database.calls(organizations).select;
      expect(call?.sql).toContain('"archived_at" is not null');
    });
  });

  describe('listOrganizations', () => {
    it('should list all organizations', async () => {
      database.on(organizations).select.returns([
        organizationRow({ id: 'org-1', name: 'Org One' }),
        organizationRow({ id: 'org-2', name: 'Org Two' }),
      ]);

      const result = await listOrganizations();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Org One');
      expect(result[1].name).toBe('Org Two');
    });

    it('should return empty array when no organizations exist', async () => {
      const result = await listOrganizations();

      expect(result).toEqual([]);
    });

    it('should support pagination with limit and offset', async () => {
      database.on(organizations).select.returns([organizationRow({ id: 'org-2', name: 'Org Two' })]);

      const result = await listOrganizations({ limit: 1, offset: 1 });

      expect(result).toHaveLength(1);
      const [call] = database.calls(organizations).select;
      expect(call?.params).toEqual(expect.arrayContaining([1, 1]));
    });
  });

  describe('linkSiteToOrganization', () => {
    it('should link a site to an organization', async () => {
      database.on(sites).update.returns([{ id: 'site-uuid-123' }]);

      const result = await linkSiteToOrganization('site-uuid-123', 'org-uuid-123');

      expect(result).toBe(true);
      expect(database.calls(sites).update).toHaveLength(1);
    });

    it('should return false when site does not exist', async () => {
      const result = await linkSiteToOrganization('non-existent-site', 'org-uuid-123');

      expect(result).toBe(false);
    });

    it('should throw OrganizationNotFoundError when organization does not exist', async () => {
      database.on(sites).update.rejects(driverError('23503'));

      await expect(linkSiteToOrganization('site-uuid-123', 'non-existent-org')).rejects.toThrow(
        OrganizationNotFoundError,
      );
    });
  });

  describe('unlinkSiteFromOrganization', () => {
    it('should unlink a site from its organization', async () => {
      database.on(sites).update.returns([{ id: 'site-uuid-123' }]);

      const result = await unlinkSiteFromOrganization('site-uuid-123');

      expect(result).toBe(true);
    });

    it('should return false when site does not exist', async () => {
      const result = await unlinkSiteFromOrganization('non-existent-site');

      expect(result).toBe(false);
    });
  });

  describe('getSitesByOrganization', () => {
    function siteRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 'site-1',
        pantheonSiteId: 'ps-1',
        name: 'Site One',
        organizationId: 'org-uuid-123',
        workflowSettings: { mergeApprovalMode: 'optional' },
        createdAt: new Date('2026-01-26T10:00:00.000Z'),
        updatedAt: new Date('2026-01-26T10:00:00.000Z'),
        ...overrides,
      };
    }

    it('should return all sites for an organization', async () => {
      database.on(sites).select.returns([
        siteRow(),
        siteRow({ id: 'site-2', pantheonSiteId: 'ps-2', name: 'Site Two' }),
      ]);

      const result = await getSitesByOrganization('org-uuid-123');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Site One');
      expect(result[1].name).toBe('Site Two');
    });

    it('should return empty array when organization has no sites', async () => {
      const result = await getSitesByOrganization('org-with-no-sites');

      expect(result).toEqual([]);
    });

    it('should map a null pantheon_site_id to undefined', async () => {
      database.on(sites).select.returns([siteRow({ pantheonSiteId: null })]);

      const result = await getSitesByOrganization('org-uuid-123');

      expect(result[0].pantheonSiteId).toBeUndefined();
      expect('pantheonSiteId' in JSON.parse(JSON.stringify(result[0]))).toBe(false);
    });
  });

  describe('getOrganizationForSite', () => {
    it('should return the organization for a site', async () => {
      database.on(organizations).select.returns([organizationRow()]);

      const result = await getOrganizationForSite('site-uuid-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('org-uuid-123');
    });

    it('should return null when site has no organization', async () => {
      const result = await getOrganizationForSite('site-without-org');

      expect(result).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Business Accounts Phase 1: New service functions
  // ───────────────────────────────────────────────────────────────────────────

  describe('getOrganizationsForUser', () => {
    it('should return orgs from direct membership', async () => {
      database.on(organizations).select.returnsRaw([
        organizationRow({ id: 'org-1', name: 'My Org', externalSpaceId: 'space_abc' }),
      ]);

      const result = await getOrganizationsForUser('user-uuid-123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('org-1');
      expect(result[0].name).toBe('My Org');
      expect(result[0].externalSpaceId).toBe('space_abc');
    });

    it('should return orgs from site roles', async () => {
      database.on(organizations).select.returnsRaw([
        organizationRow({ id: 'org-shared', name: 'Shared Org' }),
      ]);

      const result = await getOrganizationsForUser('user-uuid-456');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('org-shared');
    });

    it('should return empty array when user has no orgs', async () => {
      const result = await getOrganizationsForUser('user-with-no-orgs');

      expect(result).toEqual([]);
    });

    it('should include externalSpaceId as null when not set', async () => {
      database.on(organizations).select.returnsRaw([
        organizationRow({ id: 'org-1', name: 'P1 Only Org', externalSpaceId: null }),
      ]);

      const result = await getOrganizationsForUser('user-uuid-123');

      expect(result).toHaveLength(1);
      expect(result[0].externalSpaceId).toBeNull();
    });

    // A deactivated member is suspended from the account: canAccessOrganization
    // refuses them, so listing the org anyway puts an entry in the switcher
    // whose every scoped request comes back 403.
    it('requires an active membership, matching canAccessOrganization', async () => {
      await getOrganizationsForUser('user-uuid-123');

      const [call] = database.calls(organizations).select;
      expect(call?.sql).toContain('om.is_active = true');
    });

    // The role has to carry the same filter as the WHERE above. A suspended
    // admin who still reaches the org through a site grant otherwise comes
    // back as 'admin', and the dashboard renders tabs that isOrgAdmin 403s.
    it('reads the role from an active membership only', async () => {
      await getOrganizationsForUser('user-uuid-123');

      const [call] = database.calls(organizations).select;
      expect(call?.sql).toContain('mine.is_active = true');
    });

    // The switcher carries the role so the dashboard can decide, per account,
    // whether to offer the admin tabs.
    it('should report the caller\'s role in each organization', async () => {
      database.on(organizations).select.returnsRaw([
        organizationRow({ id: 'org-mine', memberRole: 'admin' }),
        organizationRow({ id: 'org-invited', memberRole: 'member' }),
      ]);

      const result = await getOrganizationsForUser('user-uuid-123');

      expect(result.map((org) => org.role)).toEqual(['admin', 'member']);
    });

    // Reaching an org through a site grant leaves no membership row, so there
    // is no role — and that must not read as admin.
    it('should treat a site-role-only organization as member', async () => {
      database.on(organizations).select.returnsRaw([
        organizationRow({ id: 'org-shared', memberRole: null }),
      ]);

      const result = await getOrganizationsForUser('user-uuid-456');

      expect(result[0].role).toBe('member');
    });
  });

  // ===========================================================================
  // PCC-3479: per-business-account roles
  // ===========================================================================

  describe('organization roles', () => {
    it('getOrganizationRole returns the membership role', async () => {
      database.on(organizationMembers).select.returns([{ role: 'admin' }]);

      expect(await getOrganizationRole('org-uuid-123', 'user-uuid-123')).toBe('admin');
    });

    it('getOrganizationRole returns null without a membership row', async () => {
      expect(await getOrganizationRole('org-uuid-123', 'site-only-user')).toBeNull();
    });

    it('updateOrganizationMember reports null when there is no membership to change', async () => {
      expect(
        await updateOrganizationMember('org-uuid-123', 'site-only-user', { role: 'admin' }),
      ).toBeNull();
    });

    // One statement for both columns: a mid-request failure can't leave the
    // role committed and the active flag not, or the other way round.
    it('updateOrganizationMember writes role and isActive together', async () => {
      database.on(organizationMembers).update.returns([{ role: 'admin', isActive: false }]);

      expect(
        await updateOrganizationMember('org-uuid-123', 'user-uuid-123', {
          role: 'admin',
          isActive: false,
        }),
      ).toEqual({ role: 'admin', isActive: false });

      const [call] = database.calls(organizationMembers).update;
      expect(call?.sql).toContain('"role"');
      expect(call?.sql).toContain('"is_active"');
      expect(call?.params).toEqual(['admin', false, 'org-uuid-123', 'user-uuid-123']);
    });

    // An omitted field is left as it stands rather than overwritten with null.
    it('updateOrganizationMember leaves an omitted column alone', async () => {
      database.on(organizationMembers).update.returns([{ role: 'admin', isActive: true }]);

      await updateOrganizationMember('org-uuid-123', 'user-uuid-123', { role: 'admin' });

      const [call] = database.calls(organizationMembers).update;
      expect(call?.sql).toContain('COALESCE');
      expect(call?.params).toEqual(['admin', null, 'org-uuid-123', 'user-uuid-123']);
    });

    it('countOrganizationAdmins counts only active admin memberships', async () => {
      database.on(organizationMembers).select.returnsRaw([{ value: 2 }]);

      expect(await countOrganizationAdmins('org-uuid-123')).toBe(2);
      // A deactivated admin can't administer the account, so counting them
      // would let the last one who can be demoted or suspended.
      const [call] = database.calls(organizationMembers).select;
      expect(call?.sql).toContain('"is_active"');
      expect(call?.params).toContain(true);
    });

    it('countOrganizationMembers counts only active memberships', async () => {
      database.on(organizationMembers).select.returnsRaw([{ value: 1 }]);

      expect(await countOrganizationMembers('org-uuid-123')).toBe(1);
      const [call] = database.calls(organizationMembers).select;
      expect(call?.sql).toContain('"is_active"');
      expect(call?.params).toContain(true);
    });

    it('addUserToOrganization defaults a new member to the member role', async () => {
      database.on(organizationMembers).insert.returns([{ id: 'membership-id' }]);

      await addUserToOrganization('org-uuid-123', 'user-uuid-123');

      const [call] = database.calls(organizationMembers).insert;
      expect(call?.params).toContain('member');
    });

    it('addUserToOrganization reports false when the membership already exists', async () => {
      expect(await addUserToOrganization('org-uuid-123', 'user-uuid-123')).toBe(false);
    });
  });

  describe('getUserOwnedOrg', () => {
    it('should return the org id when the user owns one', async () => {
      database.on(organizationMembers).select.returns([{ organizationId: 'org-uuid-123' }]);

      const result = await getUserOwnedOrg('user-uuid-123');

      expect(result).toBe('org-uuid-123');
      const [call] = database.calls(organizationMembers).select;
      expect(call?.params).toContain('owner');
      expect(call?.params).toContain(true);
    });

    it('should return null when the user owns no org', async () => {
      const result = await getUserOwnedOrg('user-with-no-org');

      expect(result).toBeNull();
    });

    // The hijack bug: an invitee is a member (not owner) of the inviting
    // account, and used to be picked up as if it were theirs to relink.
    it('should return null for a user who is only a member of someone else\'s org', async () => {
      // A role-scoped, active-scoped query naturally excludes a 'member' row —
      // the stub returns nothing because the filter already excluded it.
      const result = await getUserOwnedOrg('invitee-uuid');

      expect(result).toBeNull();
    });

    it('should not select an inactive owner row', async () => {
      // is_active = true is baked into the WHERE clause, so a deactivated
      // owner membership never reaches the application layer as a row at all.
      const result = await getUserOwnedOrg('deactivated-owner-uuid');

      expect(result).toBeNull();
      const [call] = database.calls(organizationMembers).select;
      expect(call?.params).toContain(true);
    });

    // PCC-3987: a plain created_at ASC LIMIT 1 with no other filtering could
    // hand back an archived org. The query must exclude it, matching
    // getOrganizationsForUser.
    it('excludes archived organizations', async () => {
      await getUserOwnedOrg('user-uuid-123');

      const [call] = database.calls(organizationMembers).select;
      expect(call?.sql).toContain('"archived_at" is null');
    });

    // PCC-3987: 068's backfill stamped many memberships with an identical
    // created_at, so ties on created_at alone are arbitrary. The query needs
    // a secondary, deterministic sort key so the same user always gets the
    // same answer.
    it('breaks created_at ties deterministically', async () => {
      await getUserOwnedOrg('user-uuid-123');

      const [call] = database.calls(organizationMembers).select;
      expect(call?.sql).toMatch(/order by .*"created_at" asc, .*"id" asc/);
    });
  });

  describe('hasActiveOrgMembership', () => {
    it('should return true when the user has any active membership', async () => {
      database.on(organizationMembers).select.returns([{ id: 'member-uuid-123' }]);

      expect(await hasActiveOrgMembership('user-uuid-123')).toBe(true);
    });

    it('should return false when the user has no active membership', async () => {
      expect(await hasActiveOrgMembership('user-with-no-org')).toBe(false);

      const [call] = database.calls(organizationMembers).select;
      expect(call?.params).toContain(true);
    });
  });

  describe('createOrgForUser', () => {
    it('should create org with spaceName when provided', async () => {
      database.on(organizations).insert.returns([
        organizationRow({ id: 'new-org-id', name: 'Pantheon', externalSpaceId: 'space_abc' }),
      ]);

      const result = await createOrgForUser('user-uuid-123', 'user@pantheon.com', 'Pantheon', 'space_abc');

      expect(result).toBeDefined();
      expect(result.name).toBe('Pantheon');
      expect(result.externalSpaceId).toBe('space_abc');
    });

    // PCC-3479: with self-service onboarding everyone gets an account minted
    // for them, so the creator has to be able to manage it — otherwise they
    // could not add a single person to the account they just made. `owner`
    // rather than `admin` (057): it is also the row owner_email reads, and the
    // one the roster API refuses to demote or remove.
    it('should make the creator the owner of the new organization', async () => {
      database.on(organizations).insert.returns([organizationRow({ id: 'new-org-id' })]);

      await createOrgForUser('user-uuid-123', 'user@pantheon.com', 'Pantheon', 'space_abc');

      const [membership] = database.calls(organizationMembers).insert;
      expect(membership?.params).toEqual(expect.arrayContaining(['new-org-id', 'user-uuid-123', 'owner']));
    });

    it('should derive org name from email domain when spaceName not provided', async () => {
      database.on(organizations).insert.returns([
        organizationRow({ id: 'new-org-id', name: 'Pantheon' }),
      ]);

      const result = await createOrgForUser('user-uuid-123', 'user@pantheon.com');

      expect(result).toBeDefined();
      expect(result.name).toBe('Pantheon');
    });

    it('should title-case each hyphen-separated segment of the domain, matching migration 054\'s INITCAP', async () => {
      database.on(organizations).insert.returns([
        organizationRow({ id: 'new-org-id', name: 'Big-Corp' }),
      ]);

      await createOrgForUser('user-uuid-123', 'user@big-corp.com');

      const [insert] = database.calls(organizations).insert;
      expect(insert?.params).toEqual(expect.arrayContaining(['Big-Corp']));
    });

    // A name already taken is numbered rather than colliding on the insert.
    it('numbers the derived name past the ones already taken', async () => {
      database.on(organizations).select.returns([
        { name: 'Big-Corp' },
        { name: 'Big-Corp 2' },
      ]);
      database.on(organizations).insert.returns([
        organizationRow({ id: 'new-org-id', name: 'Big-Corp 3' }),
      ]);

      await createOrgForUser('user-uuid-123', 'user@big-corp.com');

      const [insert] = database.calls(organizations).insert;
      expect(insert?.params).toEqual(expect.arrayContaining(['Big-Corp 3']));
    });

    it('should handle public email domains by using username', async () => {
      database.on(organizations).insert.returns([
        organizationRow({ id: 'new-org-id', name: 'johndoe' }),
      ]);

      const result = await createOrgForUser('user-uuid-123', 'johndoe@gmail.com');

      expect(result).toBeDefined();
      const [insert] = database.calls(organizations).insert;
      expect(insert?.params).toEqual(expect.arrayContaining(['johndoe']));
    });

    // Derived write: an invalid spaceName falls back to the sanitized
    // email-derived name instead of throwing or storing the raw string.
    it('should fall back to the derived name when spaceName is over 255 characters', async () => {
      database.on(organizations).insert.returns([
        organizationRow({ id: 'new-org-id', name: 'Pantheon' }),
      ]);

      const result = await createOrgForUser('user-uuid-123', 'user@pantheon.com', 'a'.repeat(256));

      expect(result.name).toBe('Pantheon');
      const [insert] = database.calls(organizations).insert;
      expect(insert?.params).toEqual(expect.arrayContaining(['Pantheon']));
    });

    it('should fall back to the derived name when spaceName contains control characters', async () => {
      database.on(organizations).insert.returns([
        organizationRow({ id: 'new-org-id', name: 'Pantheon' }),
      ]);

      const result = await createOrgForUser('user-uuid-123', 'user@pantheon.com', 'Evil\r\nSubject: hijacked');

      expect(result.name).toBe('Pantheon');
    });

    it('should propagate a failed insert', async () => {
      database.on(organizations).insert.rejects(new Error('insert failed'));

      const failure = await createOrgForUser('user-uuid-123', 'user@test.com').catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect(failure).toHaveProperty('cause.message', 'insert failed');
    });
  });

  describe('linkOrgToSpace', () => {
    it('should link org to external space when org has no existing link', async () => {
      database.on(organizations).update.returns([{ id: 'org-uuid-123' }]);

      const result = await linkOrgToSpace('org-uuid-123', 'space_abc');

      expect(result).toBe(true);
      const [call] = database.calls(organizations).update;
      expect(call?.params).toEqual(expect.arrayContaining(['space_abc', 'org-uuid-123']));
    });

    it('should return false when org already has external_space_id', async () => {
      const result = await linkOrgToSpace('org-uuid-123', 'space_abc');

      expect(result).toBe(false);
    });

    it('should return false when org does not exist', async () => {
      const result = await linkOrgToSpace('non-existent-org', 'space_abc');

      expect(result).toBe(false);
    });

    it('should update org name when spaceName is provided', async () => {
      database.on(organizations).update.returns([{ id: 'org-uuid-123' }]);

      const result = await linkOrgToSpace('org-uuid-123', 'space_abc', 'My Space');

      expect(result).toBe(true);
      const [call] = database.calls(organizations).update;
      expect(call?.sql).toContain('"name"');
      expect(call?.params).toEqual(expect.arrayContaining(['space_abc', 'My Space', 'org-uuid-123']));
    });

    it('leaves the name alone when no space name is given', async () => {
      database.on(organizations).update.returns([{ id: 'org-uuid-123' }]);

      await linkOrgToSpace('org-uuid-123', 'space_abc');

      const [call] = database.calls(organizations).update;
      expect(call?.sql).not.toContain('"name"');
    });

    // Derived write: an invalid name links without renaming rather than
    // throwing, since both callers catch-and-log and would otherwise leave
    // the user with no organization at all.
    it('should link without renaming when spaceName is over 255 characters', async () => {
      database.on(organizations).update.returns([{ id: 'org-uuid-123' }]);

      const result = await linkOrgToSpace('org-uuid-123', 'space_abc', 'a'.repeat(256));

      expect(result).toBe(true);
      const [call] = database.calls(organizations).update;
      expect(call?.sql).not.toContain('"name"');
    });

    it('should link without renaming when spaceName contains control characters', async () => {
      database.on(organizations).update.returns([{ id: 'org-uuid-123' }]);

      const result = await linkOrgToSpace('org-uuid-123', 'space_abc', 'Evil\r\nSubject: hijacked');

      expect(result).toBe(true);
      const [call] = database.calls(organizations).update;
      expect(call?.sql).not.toContain('"name"');
    });
  });

  // Content Publisher skips both the subscription and business-account setup
  // on a true here, so a home this user cannot reach strands them with neither.
  describe('isEmailInAnyOrganization', () => {
    it('counts only memberships and sites the user can actually reach', async () => {
      await isEmailInAnyOrganization('Invitee@Example.COM');

      const [call] = database.calls(users).select;
      expect(call?.sql).toContain('om.is_active = true');
      expect(call?.sql).toContain('s.archived_at IS NULL');
      expect(call?.params).toEqual(['invitee@example.com']);
    });

    it('reports true when the user reaches an organization', async () => {
      database.on(users).select.returnsRaw([{ '?column?': 1 }]);

      expect(await isEmailInAnyOrganization('invitee@example.com')).toBe(true);
    });

    it('reports false when the user reaches none', async () => {
      expect(await isEmailInAnyOrganization('invitee@example.com')).toBe(false);
    });
  });
});
