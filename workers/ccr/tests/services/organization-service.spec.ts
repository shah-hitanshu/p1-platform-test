/**
 * Agent Politeness System - Phase 1.3: Organization Service Tests (TDD)
 *
 * Tests for Organization CRUD operations.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OrganizationSettings } from '../../src/types';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Agent Politeness Phase 1.3: Organization Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Default organization settings as defined in schema
  const defaultOrganizationSettings: OrganizationSettings = {
    agentIdleTimeoutMs: 5000,
  };

  // Mock organization row type (database format)
  interface MockOrganizationRow {
    id: string;
    name: string;
    settings: OrganizationSettings | string;
    created_at: string;
    updated_at: string;
    archived_at: string | null;
    /** PCC space this org is linked to; absent/null for P1-only orgs. */
    external_space_id?: string | null;
  }

  // Helper to create a mock organization row (database format)
  function createMockOrganizationRow(
    overrides: Partial<MockOrganizationRow> = {},
  ): MockOrganizationRow {
    return {
      id: 'org-uuid-123',
      name: 'Test Organization',
      settings: defaultOrganizationSettings,
      created_at: '2026-01-26T10:00:00.000Z',
      updated_at: '2026-01-26T10:00:00.000Z',
      archived_at: null,
      ...overrides,
    };
  }

  describe('createOrganization', () => {
    it('should create an organization with required fields', async () => {
      const { createOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockRow = createMockOrganizationRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

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
      const { createOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const customSettings: OrganizationSettings = {
        agentIdleTimeoutMs: 10000,
      };
      const mockRow = createMockOrganizationRow({ settings: customSettings });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createOrganization({
        name: 'Custom Org',
        settings: customSettings,
      });

      expect(result.settings.agentIdleTimeoutMs).toBe(10000);
    });

    it('should throw InvalidOrganizationParamsError for empty name', async () => {
      const { createOrganization } = await import('../../src/services/organization-service');
      const { InvalidOrganizationParamsError } = await import('../../src/services/errors');

      await expect(
        createOrganization({
          name: '',
        }),
      ).rejects.toThrow(InvalidOrganizationParamsError);
    });

    it('should throw InvalidOrganizationParamsError for whitespace-only name', async () => {
      const { createOrganization } = await import('../../src/services/organization-service');
      const { InvalidOrganizationParamsError } = await import('../../src/services/errors');

      await expect(
        createOrganization({
          name: '   ',
        }),
      ).rejects.toThrow(InvalidOrganizationParamsError);
    });
  });

  describe('getOrganizationById', () => {
    it('should return an organization by ID', async () => {
      const { getOrganizationById } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockRow = createMockOrganizationRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getOrganizationById('org-uuid-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('org-uuid-123');
      expect(result?.name).toBe('Test Organization');
    });

    it('should return null for non-existent organization', async () => {
      const { getOrganizationById } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getOrganizationById('non-existent-id');

      expect(result).toBeNull();
    });

    it('should parse settings from string format (JSONB)', async () => {
      const { getOrganizationById } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockRow = createMockOrganizationRow({
        settings: JSON.stringify({ agentIdleTimeoutMs: 7500 }),
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getOrganizationById('org-uuid-123');

      expect(result?.settings.agentIdleTimeoutMs).toBe(7500);
    });
  });

  describe('updateOrganization', () => {
    it('should update organization name', async () => {
      const { updateOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockRow = createMockOrganizationRow({ name: 'Updated Name' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await updateOrganization('org-uuid-123', {
        name: 'Updated Name',
      });

      expect(result).toBeDefined();
      expect(result?.name).toBe('Updated Name');
    });

    it('should update organization settings', async () => {
      const { updateOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const updatedSettings: OrganizationSettings = {
        agentIdleTimeoutMs: 15000,
      };
      const mockRow = createMockOrganizationRow({ settings: updatedSettings });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await updateOrganization('org-uuid-123', {
        settings: updatedSettings,
      });

      expect(result?.settings.agentIdleTimeoutMs).toBe(15000);
    });

    it('should return null for non-existent organization', async () => {
      const { updateOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await updateOrganization('non-existent-id', {
        name: 'New Name',
      });

      expect(result).toBeNull();
    });

    it('should throw InvalidOrganizationParamsError for empty name', async () => {
      const { updateOrganization } = await import('../../src/services/organization-service');
      const { InvalidOrganizationParamsError } = await import('../../src/services/errors');

      await expect(
        updateOrganization('org-uuid-123', {
          name: '',
        }),
      ).rejects.toThrow(InvalidOrganizationParamsError);
    });
  });

  describe('deleteOrganization', () => {
    it('should delete an organization and return true', async () => {
      const { deleteOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ id: 'org-uuid-123' }] });

      const result = await deleteOrganization('org-uuid-123');

      expect(result).toBe(true);
    });

    it('should return false for non-existent organization', async () => {
      const { deleteOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await deleteOrganization('non-existent-id');

      expect(result).toBe(false);
    });

    it('should throw OrganizationHasSitesError when organization has linked sites', async () => {
      const { deleteOrganization } = await import('../../src/services/organization-service');
      const { OrganizationHasSitesError } = await import('../../src/services/errors');
      const db = await import('../../src/db');

      // Simulate foreign key constraint violation
      const error = new Error('foreign key constraint violation') as NodeJS.ErrnoException;
      error.code = '23503';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(deleteOrganization('org-with-sites')).rejects.toThrow(OrganizationHasSitesError);
    });
  });

  // ===========================================================================
  // PCC-3211: Soft delete — archiveOrganization / restoreOrganization / list filter
  // ===========================================================================

  describe('archiveOrganization', () => {
    const txOk = { rows: [], rowCount: 0 };

    it('should set archived_at and return true', async () => {
      const { archiveOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // no active sites check
        .mockResolvedValueOnce(txOk) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'org-uuid-123' }], rowCount: 1 }) // UPDATE
        .mockResolvedValueOnce(txOk); // COMMIT

      const result = await archiveOrganization('org-uuid-123');

      expect(result).toBe(true);
    });

    it('should return false when organization not found', async () => {
      const { archiveOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // no active sites (pre-check)
        .mockResolvedValueOnce(txOk) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE → not found (TOCTOU guard)
        .mockResolvedValueOnce(txOk) // COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // recheck active sites → none
        .mockResolvedValueOnce({ rows: [] }); // SELECT id → not found → return false

      const result = await archiveOrganization('non-existent');

      expect(result).toBe(false);
    });

    it('should return already_archived when org exists but is already archived', async () => {
      const { archiveOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // no active sites (pre-check)
        .mockResolvedValueOnce(txOk) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE → no match (already archived)
        .mockResolvedValueOnce(txOk) // COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // recheck active sites → none
        .mockResolvedValueOnce({ rows: [{ id: 'org-uuid-123' }] }); // SELECT id → exists

      const result = await archiveOrganization('org-uuid-123');

      expect(result).toBe('already_archived');
    });

    it('should throw OrganizationHasActiveSitesError when org has active sites', async () => {
      const { archiveOrganization } = await import('../../src/services/organization-service');
      const { OrganizationHasActiveSitesError } = await import('../../src/services/errors');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: '2' }] }); // active sites found

      await expect(archiveOrganization('org-uuid-123')).rejects.toThrow(OrganizationHasActiveSitesError);
    });
  });

  describe('restoreOrganization', () => {
    const txOk = { rows: [], rowCount: 0 };

    it('should clear archived_at and return true', async () => {
      const { restoreOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce(txOk) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'org-uuid-123' }], rowCount: 1 }) // UPDATE
        .mockResolvedValueOnce(txOk); // COMMIT

      const result = await restoreOrganization('org-uuid-123');

      expect(result).toBe(true);
    });

    it('should return false when organization not found or not archived', async () => {
      const { restoreOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce(txOk) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE → no match
        .mockResolvedValueOnce(txOk); // COMMIT

      const result = await restoreOrganization('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('listOrganizations — archived filter (PCC-3211)', () => {
    it('should exclude archived organizations by default', async () => {
      const { listOrganizations } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listOrganizations();

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('archived_at IS NULL');
    });

    it('should return only archived organizations when archived=true', async () => {
      const { listOrganizations } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listOrganizations({ archived: true });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('archived_at IS NOT NULL');
    });
  });

  describe('listOrganizations', () => {
    it('should list all organizations', async () => {
      const { listOrganizations } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockOrganizationRow({ id: 'org-1', name: 'Org One' }),
        createMockOrganizationRow({ id: 'org-2', name: 'Org Two' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listOrganizations();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Org One');
      expect(result[1].name).toBe('Org Two');
    });

    it('should return empty array when no organizations exist', async () => {
      const { listOrganizations } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listOrganizations();

      expect(result).toEqual([]);
    });

    it('should support pagination with limit and offset', async () => {
      const { listOrganizations } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockRows = [createMockOrganizationRow({ id: 'org-2', name: 'Org Two' })];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listOrganizations({ limit: 1, offset: 1 });

      expect(result).toHaveLength(1);
      expect(db.query).toHaveBeenCalled();
    });
  });

  describe('linkSiteToOrganization', () => {
    it('should link a site to an organization', async () => {
      const { linkSiteToOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ id: 'site-uuid-123' }] });

      const result = await linkSiteToOrganization('site-uuid-123', 'org-uuid-123');

      expect(result).toBe(true);
      expect(db.query).toHaveBeenCalled();
    });

    it('should return false when site does not exist', async () => {
      const { linkSiteToOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await linkSiteToOrganization('non-existent-site', 'org-uuid-123');

      expect(result).toBe(false);
    });

    it('should throw OrganizationNotFoundError when organization does not exist', async () => {
      const { linkSiteToOrganization } = await import('../../src/services/organization-service');
      const { OrganizationNotFoundError } = await import('../../src/services/errors');
      const db = await import('../../src/db');

      // Simulate foreign key constraint violation
      const error = new Error('foreign key constraint violation') as NodeJS.ErrnoException;
      error.code = '23503';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(linkSiteToOrganization('site-uuid-123', 'non-existent-org')).rejects.toThrow(
        OrganizationNotFoundError,
      );
    });
  });

  describe('unlinkSiteFromOrganization', () => {
    it('should unlink a site from its organization', async () => {
      const { unlinkSiteFromOrganization } = await import(
        '../../src/services/organization-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ id: 'site-uuid-123' }] });

      const result = await unlinkSiteFromOrganization('site-uuid-123');

      expect(result).toBe(true);
    });

    it('should return false when site does not exist', async () => {
      const { unlinkSiteFromOrganization } = await import(
        '../../src/services/organization-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await unlinkSiteFromOrganization('non-existent-site');

      expect(result).toBe(false);
    });
  });

  describe('getSitesByOrganization', () => {
    it('should return all sites for an organization', async () => {
      const { getSitesByOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockSiteRows = [
        {
          id: 'site-1',
          pantheon_site_id: 'ps-1',
          name: 'Site One',
          organization_id: 'org-uuid-123',
          workflow_settings: { mergeApprovalMode: 'optional' },
          created_at: '2026-01-26T10:00:00.000Z',
          updated_at: '2026-01-26T10:00:00.000Z',
        },
        {
          id: 'site-2',
          pantheon_site_id: 'ps-2',
          name: 'Site Two',
          organization_id: 'org-uuid-123',
          workflow_settings: { mergeApprovalMode: 'optional' },
          created_at: '2026-01-26T10:00:00.000Z',
          updated_at: '2026-01-26T10:00:00.000Z',
        },
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockSiteRows });

      const result = await getSitesByOrganization('org-uuid-123');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Site One');
      expect(result[1].name).toBe('Site Two');
    });

    it('should return empty array when organization has no sites', async () => {
      const { getSitesByOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getSitesByOrganization('org-with-no-sites');

      expect(result).toEqual([]);
    });

    it('should map a null pantheon_site_id to undefined', async () => {
      const { getSitesByOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [
          {
            id: 'site-1',
            pantheon_site_id: null,
            name: 'Site One',
            organization_id: 'org-uuid-123',
            workflow_settings: { mergeApprovalMode: 'optional' },
            created_at: '2026-01-26T10:00:00.000Z',
            updated_at: '2026-01-26T10:00:00.000Z',
          },
        ],
      });

      const result = await getSitesByOrganization('org-uuid-123');

      expect(result[0].pantheonSiteId).toBeUndefined();
      expect('pantheonSiteId' in JSON.parse(JSON.stringify(result[0]))).toBe(false);
    });
  });

  describe('getOrganizationForSite', () => {
    it('should return the organization for a site', async () => {
      const { getOrganizationForSite } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockRow = createMockOrganizationRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getOrganizationForSite('site-uuid-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('org-uuid-123');
    });

    it('should return null when site has no organization', async () => {
      const { getOrganizationForSite } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getOrganizationForSite('site-without-org');

      expect(result).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Business Accounts Phase 1: New service functions
  // ───────────────────────────────────────────────────────────────────────────

  describe('getOrganizationsForUser', () => {
    it('should return orgs from direct membership', async () => {
      const { getOrganizationsForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockOrganizationRow({ id: 'org-1', name: 'My Org', external_space_id: 'space_abc' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await getOrganizationsForUser('user-uuid-123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('org-1');
      expect(result[0].name).toBe('My Org');
      expect(result[0].externalSpaceId).toBe('space_abc');
    });

    it('should return orgs from site roles', async () => {
      const { getOrganizationsForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockOrganizationRow({ id: 'org-shared', name: 'Shared Org' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await getOrganizationsForUser('user-uuid-456');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('org-shared');
    });

    it('should return empty array when user has no orgs', async () => {
      const { getOrganizationsForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getOrganizationsForUser('user-with-no-orgs');

      expect(result).toEqual([]);
    });

    it('should include externalSpaceId as null when not set', async () => {
      const { getOrganizationsForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockOrganizationRow({ id: 'org-1', name: 'P1 Only Org', external_space_id: null }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await getOrganizationsForUser('user-uuid-123');

      expect(result).toHaveLength(1);
      expect(result[0].externalSpaceId).toBeNull();
    });
  });

  describe('getUserPrimaryOrg', () => {
    it('should return org id when user has membership', async () => {
      const { getUserPrimaryOrg } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ organization_id: 'org-uuid-123' }],
      });

      const result = await getUserPrimaryOrg('user-uuid-123');

      expect(result).toBe('org-uuid-123');
    });

    it('should return null when user has no membership', async () => {
      const { getUserPrimaryOrg } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getUserPrimaryOrg('user-with-no-org');

      expect(result).toBeNull();
    });
  });

  describe('createOrgForUser', () => {
    it('should create org with spaceName when provided', async () => {
      const { createOrgForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockOrgRow = createMockOrganizationRow({
        id: 'new-org-id',
        name: 'Pantheon',
        external_space_id: 'space_abc',
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce(undefined as never) // BEGIN
        .mockResolvedValueOnce({ rows: [mockOrgRow] }) // INSERT org
        .mockResolvedValueOnce({ rows: [{ id: 'member-id' }] }) // INSERT membership
        .mockResolvedValueOnce(undefined as never); // COMMIT

      const result = await createOrgForUser('user-uuid-123', 'user@pantheon.com', 'Pantheon', 'space_abc');

      expect(result).toBeDefined();
      expect(result.name).toBe('Pantheon');
      expect(result.externalSpaceId).toBe('space_abc');
    });

    it('should derive org name from email domain when spaceName not provided', async () => {
      const { createOrgForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockOrgRow = createMockOrganizationRow({
        id: 'new-org-id',
        name: 'Pantheon',
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce(undefined as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // name uniqueness check
        .mockResolvedValueOnce({ rows: [mockOrgRow] }) // INSERT org
        .mockResolvedValueOnce({ rows: [{ id: 'member-id' }] }) // INSERT membership
        .mockResolvedValueOnce(undefined as never); // COMMIT

      const result = await createOrgForUser('user-uuid-123', 'user@pantheon.com');

      expect(result).toBeDefined();
      expect(result.name).toBe('Pantheon');
    });

    it('should title-case each hyphen-separated segment of the domain, matching migration 054\'s INITCAP', async () => {
      const { createOrgForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockOrgRow = createMockOrganizationRow({
        id: 'new-org-id',
        name: 'Big-Corp',
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce(undefined as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // name uniqueness check
        .mockResolvedValueOnce({ rows: [mockOrgRow] }) // INSERT org
        .mockResolvedValueOnce({ rows: [{ id: 'member-id' }] }) // INSERT membership
        .mockResolvedValueOnce(undefined as never); // COMMIT

      await createOrgForUser('user-uuid-123', 'user@big-corp.com');

      expect(db.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO app.organizations'),
        ['Big-Corp', expect.any(String), null],
      );
    });

    it('should handle public email domains by using username', async () => {
      const { createOrgForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockOrgRow = createMockOrganizationRow({
        id: 'new-org-id',
        name: 'johndoe',
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce(undefined as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // name uniqueness check
        .mockResolvedValueOnce({ rows: [mockOrgRow] }) // INSERT org
        .mockResolvedValueOnce({ rows: [{ id: 'member-id' }] }) // INSERT membership
        .mockResolvedValueOnce(undefined as never); // COMMIT

      const result = await createOrgForUser('user-uuid-123', 'johndoe@gmail.com');

      expect(result).toBeDefined();
    });

    it('should rollback on error', async () => {
      const { createOrgForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce(undefined as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // name uniqueness check
        .mockRejectedValueOnce(new Error('insert failed')); // INSERT org fails

      await expect(createOrgForUser('user-uuid-123', 'user@test.com')).rejects.toThrow('insert failed');

      // Verify ROLLBACK was called
      const calls = vi.mocked(db.query).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toContain('ROLLBACK');
    });
  });

  describe('linkOrgToSpace', () => {
    it('should link org to external space when org has no existing link', async () => {
      const db = await import('../../src/db');
      const { linkOrgToSpace } = await import('../../src/services/organization-service');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'org-uuid-123' }],
        rowCount: 1,
      });

      const result = await linkOrgToSpace('org-uuid-123', 'space_abc');

      expect(result).toBe(true);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE app.organizations'),
        ['org-uuid-123', 'space_abc'],
      );
    });

    it('should return false when org already has external_space_id', async () => {
      const db = await import('../../src/db');
      const { linkOrgToSpace } = await import('../../src/services/organization-service');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await linkOrgToSpace('org-uuid-123', 'space_abc');

      expect(result).toBe(false);
    });

    it('should return false when org does not exist', async () => {
      const db = await import('../../src/db');
      const { linkOrgToSpace } = await import('../../src/services/organization-service');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await linkOrgToSpace('non-existent-org', 'space_abc');

      expect(result).toBe(false);
    });

    it('should update org name when spaceName is provided', async () => {
      const db = await import('../../src/db');
      const { linkOrgToSpace } = await import('../../src/services/organization-service');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'org-uuid-123' }],
        rowCount: 1,
      });

      const result = await linkOrgToSpace('org-uuid-123', 'space_abc', 'My Space');

      expect(result).toBe(true);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('name = $3'),
        ['org-uuid-123', 'space_abc', 'My Space'],
      );
    });
  });
});
