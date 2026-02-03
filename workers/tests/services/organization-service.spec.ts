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
      const { createOrganization, InvalidOrganizationParamsError } = await import(
        '../../src/services/organization-service'
      );

      await expect(
        createOrganization({
          name: '',
        }),
      ).rejects.toThrow(InvalidOrganizationParamsError);
    });

    it('should throw InvalidOrganizationParamsError for whitespace-only name', async () => {
      const { createOrganization, InvalidOrganizationParamsError } = await import(
        '../../src/services/organization-service'
      );

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
      const { updateOrganization, InvalidOrganizationParamsError } = await import(
        '../../src/services/organization-service'
      );

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
      const { deleteOrganization, OrganizationHasSitesError } = await import(
        '../../src/services/organization-service'
      );
      const db = await import('../../src/db');

      // Simulate foreign key constraint violation
      const error = new Error('foreign key constraint violation') as NodeJS.ErrnoException;
      error.code = '23503';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(deleteOrganization('org-with-sites')).rejects.toThrow(OrganizationHasSitesError);
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
      const { linkSiteToOrganization, OrganizationNotFoundError } = await import(
        '../../src/services/organization-service'
      );
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
});
