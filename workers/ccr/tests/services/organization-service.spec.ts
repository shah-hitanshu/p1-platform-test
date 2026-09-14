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
    /** The listing user's role in this org; null when they reach it via a site. */
    member_role?: string | null;
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

    it('should throw InvalidOrganizationParamsError for a name over 255 characters', async () => {
      const { createOrganization } = await import('../../src/services/organization-service');
      const { InvalidOrganizationParamsError } = await import('../../src/services/errors');

      await expect(
        createOrganization({ name: 'a'.repeat(256) }),
      ).rejects.toThrow(InvalidOrganizationParamsError);
    });

    it('should throw InvalidOrganizationParamsError for a name containing control characters', async () => {
      const { createOrganization } = await import('../../src/services/organization-service');
      const { InvalidOrganizationParamsError } = await import('../../src/services/errors');

      await expect(
        createOrganization({ name: 'Evil\r\nSubject: hijacked' }),
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

    it('should throw InvalidOrganizationParamsError for a name over 255 characters', async () => {
      const { updateOrganization } = await import('../../src/services/organization-service');
      const { InvalidOrganizationParamsError } = await import('../../src/services/errors');

      await expect(
        updateOrganization('org-uuid-123', { name: 'a'.repeat(256) }),
      ).rejects.toThrow(InvalidOrganizationParamsError);
    });

    it('should not validate name when the PATCH does not touch it', async () => {
      const { updateOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockRow = createMockOrganizationRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await expect(
        updateOrganization('org-uuid-123', { settings: { agentIdleTimeoutMs: 1000 } }),
      ).resolves.toBeDefined();
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

    // A deactivated member is suspended from the account: canAccessOrganization
    // refuses them, so listing the org anyway puts an entry in the switcher
    // whose every scoped request comes back 403.
    it('requires an active membership, matching canAccessOrganization', async () => {
      const { getOrganizationsForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getOrganizationsForUser('user-uuid-123');

      const [sql] = vi.mocked(db.query).mock.calls[0];
      expect(sql).toContain('om.is_active = true');
    });

    // The role has to carry the same filter as the WHERE above. A suspended
    // admin who still reaches the org through a site grant otherwise comes
    // back as 'admin', and the dashboard renders tabs that isOrgAdmin 403s.
    it('reads the role from an active membership only', async () => {
      const { getOrganizationsForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getOrganizationsForUser('user-uuid-123');

      const [sql] = vi.mocked(db.query).mock.calls[0];
      expect(sql).toContain('mine.is_active = true');
    });

    // The switcher carries the role so the dashboard can decide, per account,
    // whether to offer the admin tabs.
    it('should report the caller\'s role in each organization', async () => {
      const { getOrganizationsForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [
          createMockOrganizationRow({ id: 'org-mine', member_role: 'admin' }),
          createMockOrganizationRow({ id: 'org-invited', member_role: 'member' }),
        ],
      });

      const result = await getOrganizationsForUser('user-uuid-123');

      expect(result.map((org) => org.role)).toEqual(['admin', 'member']);
    });

    // Reaching an org through a site grant leaves no membership row, so there
    // is no role — and that must not read as admin.
    it('should treat a site-role-only organization as member', async () => {
      const { getOrganizationsForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [createMockOrganizationRow({ id: 'org-shared', member_role: null })],
      });

      const result = await getOrganizationsForUser('user-uuid-456');

      expect(result[0].role).toBe('member');
    });
  });

  // ===========================================================================
  // PCC-3479: per-business-account roles
  // ===========================================================================

  describe('organization roles', () => {
    it('getOrganizationRole returns the membership role', async () => {
      const { getOrganizationRole } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ role: 'admin' }] });

      expect(await getOrganizationRole('org-uuid-123', 'user-uuid-123')).toBe('admin');
    });

    it('getOrganizationRole returns null without a membership row', async () => {
      const { getOrganizationRole } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      expect(await getOrganizationRole('org-uuid-123', 'site-only-user')).toBeNull();
    });

    it('updateOrganizationMember reports null when there is no membership to change', async () => {
      const { updateOrganizationMember } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });

      expect(
        await updateOrganizationMember('org-uuid-123', 'site-only-user', { role: 'admin' }),
      ).toBeNull();
    });

    // One statement for both columns: a mid-request failure can't leave the
    // role committed and the active flag not, or the other way round.
    it('updateOrganizationMember writes role and isActive together', async () => {
      const { updateOrganizationMember } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ role: 'admin', is_active: false }],
      });

      expect(
        await updateOrganizationMember('org-uuid-123', 'user-uuid-123', {
          role: 'admin',
          isActive: false,
        }),
      ).toEqual({ role: 'admin', isActive: false });

      const [sql, params] = vi.mocked(db.query).mock.calls[0];
      expect(sql).toContain('SET role');
      expect(sql).toContain('is_active');
      expect(params).toEqual(['org-uuid-123', 'user-uuid-123', 'admin', false]);
    });

    it('countOrganizationAdmins counts only active admin memberships', async () => {
      const { countOrganizationAdmins } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ count: '2' }] });

      expect(await countOrganizationAdmins('org-uuid-123')).toBe(2);
      // A deactivated admin can't administer the account, so counting them
      // would let the last one who can be demoted or suspended.
      expect(vi.mocked(db.query).mock.calls[0][0]).toContain('is_active = true');
    });

    it('countOrganizationMembers counts only active memberships', async () => {
      const { countOrganizationMembers } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ count: '1' }] });

      expect(await countOrganizationMembers('org-uuid-123')).toBe(1);
      expect(vi.mocked(db.query).mock.calls[0][0]).toContain('is_active = true');
    });

    it('addUserToOrganization defaults a new member to the member role', async () => {
      const { addUserToOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ id: 'membership-id' }] });

      await addUserToOrganization('org-uuid-123', 'user-uuid-123');

      expect(vi.mocked(db.query).mock.calls[0][1]).toContain('member');
    });
  });

  describe('getUserOwnedOrg', () => {
    it('should return the org id when the user owns one', async () => {
      const { getUserOwnedOrg } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ organization_id: 'org-uuid-123' }],
      });

      const result = await getUserOwnedOrg('user-uuid-123');

      expect(result).toBe('org-uuid-123');
      const [sql] = vi.mocked(db.query).mock.calls[0];
      expect(sql).toContain("role = 'owner'");
      expect(sql).toContain('is_active = true');
    });

    it('should return null when the user owns no org', async () => {
      const { getUserOwnedOrg } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getUserOwnedOrg('user-with-no-org');

      expect(result).toBeNull();
    });

    // The hijack bug: an invitee is a member (not owner) of the inviting
    // account, and used to be picked up as if it were theirs to relink.
    it('should return null for a user who is only a member of someone else\'s org', async () => {
      const { getUserOwnedOrg } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      // A role-scoped, active-scoped query naturally excludes a 'member' row —
      // simulate the DB returning nothing because the filter already excluded it.
      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getUserOwnedOrg('invitee-uuid');

      expect(result).toBeNull();
    });

    it('should not select an inactive owner row', async () => {
      const { getUserOwnedOrg } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      // is_active = true is baked into the WHERE clause, so a deactivated
      // owner membership never reaches the application layer as a row at all.
      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getUserOwnedOrg('deactivated-owner-uuid');

      expect(result).toBeNull();
      const [sql] = vi.mocked(db.query).mock.calls[0];
      expect(sql).toContain('is_active = true');
    });
  });

  describe('hasActiveOrgMembership', () => {
    it('should return true when the user has any active membership', async () => {
      const { hasActiveOrgMembership } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ found: true }] });

      expect(await hasActiveOrgMembership('user-uuid-123')).toBe(true);
    });

    it('should return false when the user has no active membership', async () => {
      const { hasActiveOrgMembership } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ found: false }] });

      expect(await hasActiveOrgMembership('user-with-no-org')).toBe(false);
      const [sql] = vi.mocked(db.query).mock.calls[0];
      expect(sql).toContain('is_active = true');
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

    // PCC-3479: with self-service onboarding everyone gets an account minted
    // for them, so the creator has to be able to manage it — otherwise they
    // could not add a single person to the account they just made. `owner`
    // rather than `admin` (057): it is also the row owner_email reads, and the
    // one the roster API refuses to demote or remove.
    it('should make the creator the owner of the new organization', async () => {
      const { createOrgForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce(undefined as never) // BEGIN
        .mockResolvedValueOnce({ rows: [createMockOrganizationRow({ id: 'new-org-id' })] }) // INSERT org
        .mockResolvedValueOnce({ rows: [{ id: 'member-id' }] }) // INSERT membership
        .mockResolvedValueOnce(undefined as never); // COMMIT

      await createOrgForUser('user-uuid-123', 'user@pantheon.com', 'Pantheon', 'space_abc');

      const membershipCall = vi
        .mocked(db.query)
        .mock.calls.find(([sql]) => sql.includes('app.organization_members'));

      expect(membershipCall?.[0]).toContain("'owner'");
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

    // Derived write: an invalid spaceName falls back to the sanitized
    // email-derived name instead of throwing or storing the raw string.
    it('should fall back to the derived name when spaceName is over 255 characters', async () => {
      const { createOrgForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockOrgRow = createMockOrganizationRow({ id: 'new-org-id', name: 'Pantheon' });

      vi.mocked(db.query)
        .mockResolvedValueOnce(undefined as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // name uniqueness check
        .mockResolvedValueOnce({ rows: [mockOrgRow] }) // INSERT org
        .mockResolvedValueOnce({ rows: [{ id: 'member-id' }] }) // INSERT membership
        .mockResolvedValueOnce(undefined as never); // COMMIT

      const result = await createOrgForUser('user-uuid-123', 'user@pantheon.com', 'a'.repeat(256));

      expect(result.name).toBe('Pantheon');
      expect(db.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO app.organizations'),
        ['Pantheon', expect.any(String), null],
      );
    });

    it('should fall back to the derived name when spaceName contains control characters', async () => {
      const { createOrgForUser } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      const mockOrgRow = createMockOrganizationRow({ id: 'new-org-id', name: 'Pantheon' });

      vi.mocked(db.query)
        .mockResolvedValueOnce(undefined as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // name uniqueness check
        .mockResolvedValueOnce({ rows: [mockOrgRow] }) // INSERT org
        .mockResolvedValueOnce({ rows: [{ id: 'member-id' }] }) // INSERT membership
        .mockResolvedValueOnce(undefined as never); // COMMIT

      const result = await createOrgForUser('user-uuid-123', 'user@pantheon.com', 'Evil\r\nSubject: hijacked');

      expect(result.name).toBe('Pantheon');
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

    // Derived write: an invalid name links without renaming rather than
    // throwing, since both callers catch-and-log and would otherwise leave
    // the user with no organization at all.
    it('should link without renaming when spaceName is over 255 characters', async () => {
      const db = await import('../../src/db');
      const { linkOrgToSpace } = await import('../../src/services/organization-service');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'org-uuid-123' }],
        rowCount: 1,
      });

      const result = await linkOrgToSpace('org-uuid-123', 'space_abc', 'a'.repeat(256));

      expect(result).toBe(true);
      expect(db.query).toHaveBeenCalledWith(
        expect.not.stringContaining('name = $3'),
        ['org-uuid-123', 'space_abc'],
      );
    });

    it('should link without renaming when spaceName contains control characters', async () => {
      const db = await import('../../src/db');
      const { linkOrgToSpace } = await import('../../src/services/organization-service');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'org-uuid-123' }],
        rowCount: 1,
      });

      const result = await linkOrgToSpace('org-uuid-123', 'space_abc', 'Evil\r\nSubject: hijacked');

      expect(result).toBe(true);
      expect(db.query).toHaveBeenCalledWith(
        expect.not.stringContaining('name = $3'),
        ['org-uuid-123', 'space_abc'],
      );
    });
  });

  // Content Publisher skips both the subscription and business-account setup
  // on a true here, so a home this user cannot reach strands them with neither.
  describe('isEmailInAnyOrganization', () => {
    it('counts only memberships and sites the user can actually reach', async () => {
      const { isEmailInAnyOrganization } = await import('../../src/services/organization-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ found: false }] });

      await isEmailInAnyOrganization('Invitee@Example.COM');

      const [sql, params] = vi.mocked(db.query).mock.calls[0];
      expect(sql).toContain('om.is_active = true');
      expect(sql).toContain('s.archived_at IS NULL');
      expect(params).toEqual(['invitee@example.com']);
    });
  });
});
