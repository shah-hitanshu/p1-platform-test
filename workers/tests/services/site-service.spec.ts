/**
 * Phase 3.1: Site Service Tests (TDD)
 *
 * Tests for Site CRUD operations.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowSettings } from '../../src/types';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 3.1: Site Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Default workflow settings as defined in schema
  const defaultWorkflowSettings: WorkflowSettings = {
    mergeApprovalMode: 'optional',
    minApprovers: 1,
    allowSelfApproval: true,
    approverMode: 'both',
    approverMinRole: 'EDITOR',
  };

  // Mock site row type (database format)
  interface MockSiteRow {
    id: string;
    pantheon_site_id: string;
    name: string;
    workflow_settings: WorkflowSettings;
    created_at: string;
    updated_at: string;
  }

  // Helper to create a mock site row (database format)
  function createMockSiteRow(overrides: Partial<MockSiteRow> = {}): MockSiteRow {
    return {
      id: 'site-uuid-123',
      pantheon_site_id: 'pantheon-site-abc',
      name: 'Test Site',
      workflow_settings: defaultWorkflowSettings,
      created_at: '2026-01-23T10:00:00.000Z',
      updated_at: '2026-01-23T10:00:00.000Z',
      ...overrides,
    };
  }

  describe('createSite', () => {
    it('should create a site with all fields', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRow = createMockSiteRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Test Site',
        workflowSettings: {
          mergeApprovalMode: 'required',
          minApprovers: 2,
        },
      });

      expect(result).toBeDefined();
      expect(result.pantheonSiteId).toBe('pantheon-site-abc');
      expect(result.name).toBe('Test Site');
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create a site with default workflow settings when not provided', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRow = createMockSiteRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createSite({
        pantheonSiteId: 'pantheon-site-xyz',
        name: 'Another Site',
      });

      expect(result.workflowSettings).toEqual(defaultWorkflowSettings);
    });

    it('should merge partial workflow settings with defaults', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const customSettings: WorkflowSettings = {
        ...defaultWorkflowSettings,
        mergeApprovalMode: 'required',
        minApprovers: 3,
      };
      const mockRow = createMockSiteRow({ workflow_settings: customSettings });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createSite({
        pantheonSiteId: 'pantheon-site-xyz',
        name: 'Site with Custom Settings',
        workflowSettings: {
          mergeApprovalMode: 'required',
          minApprovers: 3,
        },
      });

      expect(result.workflowSettings.mergeApprovalMode).toBe('required');
      expect(result.workflowSettings.minApprovers).toBe(3);
      // Defaults should be preserved for unspecified fields
      expect(result.workflowSettings.allowSelfApproval).toBe(true);
    });

    it('should throw DuplicatePantheonSiteIdError for duplicate pantheonSiteId', async () => {
      const { createSite, DuplicatePantheonSiteIdError } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      // Simulate unique constraint violation
      const error = new Error('duplicate key value violates unique constraint');
      (error as NodeJS.ErrnoException).code = '23505';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(
        createSite({
          pantheonSiteId: 'existing-site-id',
          name: 'Duplicate Site',
        }),
      ).rejects.toThrow(DuplicatePantheonSiteIdError);
    });

    it('should validate required pantheonSiteId field', async () => {
      const { createSite, InvalidSiteParamsError } = await import('../../src/services/site-service');

      await expect(
        createSite({
          pantheonSiteId: '',
          name: 'Site',
        }),
      ).rejects.toThrow(InvalidSiteParamsError);
    });

    it('should validate required name field', async () => {
      const { createSite, InvalidSiteParamsError } = await import('../../src/services/site-service');

      await expect(
        createSite({
          pantheonSiteId: 'valid-id',
          name: '',
        }),
      ).rejects.toThrow(InvalidSiteParamsError);
    });

    it('should include INSERT query with correct columns', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRow = createMockSiteRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Test Site',
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining(['pantheon-site-abc', 'Test Site']),
      );
    });
  });

  describe('getSite', () => {
    it('should return site when found', async () => {
      const { getSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRow = createMockSiteRow({ id: 'site-123' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getSite('site-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('site-123');
      expect(result?.pantheonSiteId).toBe('pantheon-site-abc');
      expect(result?.name).toBe('Test Site');
    });

    it('should return null when site not found', async () => {
      const { getSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getSite('non-existent-id');

      expect(result).toBeNull();
    });

    it('should include workflow settings in response', async () => {
      const { getSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const customSettings: WorkflowSettings = {
        mergeApprovalMode: 'required',
        minApprovers: 2,
        allowSelfApproval: false,
        approverMode: 'explicit',
        approverMinRole: 'ADMIN',
      };
      const mockRow = createMockSiteRow({ workflow_settings: customSettings });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getSite('site-123');

      expect(result?.workflowSettings).toEqual(customSettings);
    });

    it('should query by site ID', async () => {
      const { getSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getSite('site-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('id'),
        expect.arrayContaining(['site-uuid-456']),
      );
    });
  });

  describe('getSiteByPantheonId', () => {
    it('should return site when found by Pantheon ID', async () => {
      const { getSiteByPantheonId } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRow = createMockSiteRow({ pantheon_site_id: 'my-pantheon-site' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getSiteByPantheonId('my-pantheon-site');

      expect(result).not.toBeNull();
      expect(result?.pantheonSiteId).toBe('my-pantheon-site');
    });

    it('should return null when Pantheon ID not found', async () => {
      const { getSiteByPantheonId } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getSiteByPantheonId('non-existent-pantheon-id');

      expect(result).toBeNull();
    });

    it('should query by pantheon_site_id column', async () => {
      const { getSiteByPantheonId } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getSiteByPantheonId('pantheon-abc');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('pantheon_site_id'),
        expect.arrayContaining(['pantheon-abc']),
      );
    });
  });

  describe('updateSite', () => {
    it('should update site name', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const updatedRow = createMockSiteRow({
        id: 'site-123',
        name: 'Updated Name',
        updated_at: '2026-01-23T12:00:00.000Z',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      const result = await updateSite('site-123', { name: 'Updated Name' });

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Updated Name');
    });

    it('should update workflow settings partially', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const updatedSettings: WorkflowSettings = {
        ...defaultWorkflowSettings,
        minApprovers: 5,
      };
      const updatedRow = createMockSiteRow({
        id: 'site-123',
        workflow_settings: updatedSettings,
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      const result = await updateSite('site-123', {
        workflowSettings: { minApprovers: 5 },
      });

      expect(result?.workflowSettings.minApprovers).toBe(5);
    });

    it('should merge workflow settings without overwriting entire object', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      // First call returns current site state
      const currentRow = createMockSiteRow({ id: 'site-123' });
      // Second call returns updated site
      const updatedRow = createMockSiteRow({
        id: 'site-123',
        workflow_settings: {
          ...defaultWorkflowSettings,
          mergeApprovalMode: 'required',
        },
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [currentRow] })
        .mockResolvedValueOnce({ rows: [updatedRow] });

      const result = await updateSite('site-123', {
        workflowSettings: { mergeApprovalMode: 'required' },
      });

      // Should preserve existing settings not being updated
      expect(result?.workflowSettings.allowSelfApproval).toBe(true);
      expect(result?.workflowSettings.mergeApprovalMode).toBe('required');
    });

    it('should update updatedAt timestamp', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const originalTime = '2026-01-23T10:00:00.000Z';
      const updatedTime = '2026-01-23T14:00:00.000Z';

      const updatedRow = createMockSiteRow({
        id: 'site-123',
        created_at: originalTime,
        updated_at: updatedTime,
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      const result = await updateSite('site-123', { name: 'New Name' });

      expect(result?.updatedAt).toBe(updatedTime);
      expect(result?.createdAt).toBe(originalTime);
    });

    it('should return null when site not found', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await updateSite('non-existent', { name: 'New Name' });

      expect(result).toBeNull();
    });

    it('should update both name and workflow settings in single call', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const updatedRow = createMockSiteRow({
        id: 'site-123',
        name: 'New Site Name',
        workflow_settings: { ...defaultWorkflowSettings, minApprovers: 3 },
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      const result = await updateSite('site-123', {
        name: 'New Site Name',
        workflowSettings: { minApprovers: 3 },
      });

      expect(result?.name).toBe('New Site Name');
      expect(result?.workflowSettings.minApprovers).toBe(3);
    });
  });

  describe('deleteSite', () => {
    it('should delete site when found', async () => {
      const { deleteSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await deleteSite('site-123');

      expect(result).toBe(true);
    });

    it('should return false when site not found', async () => {
      const { deleteSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await deleteSite('non-existent');

      expect(result).toBe(false);
    });

    it('should execute DELETE query', async () => {
      const { deleteSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });

      await deleteSite('site-to-delete');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        expect.arrayContaining(['site-to-delete']),
      );
    });
  });

  describe('listSites', () => {
    it('should return all sites when no options provided', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockSiteRow({ id: 'site-1', name: 'Site 1' }),
        createMockSiteRow({ id: 'site-2', name: 'Site 2' }),
        createMockSiteRow({ id: 'site-3', name: 'Site 3' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listSites();

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('site-1');
      expect(result[1].id).toBe('site-2');
      expect(result[2].id).toBe('site-3');
    });

    it('should support limit option', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockSiteRow({ id: 'site-1' }),
        createMockSiteRow({ id: 'site-2' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      await listSites({ limit: 2 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([2]),
      );
    });

    it('should support offset option', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSites({ offset: 10 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET'),
        expect.arrayContaining([10]),
      );
    });

    it('should support both limit and offset options', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSites({ limit: 25, offset: 50 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/LIMIT.*OFFSET|OFFSET.*LIMIT/),
        expect.arrayContaining([25, 50]),
      );
    });

    it('should return empty array when no sites exist', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listSites();

      expect(result).toEqual([]);
    });

    it('should map all rows to Site objects', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockSiteRow({
          id: 'site-1',
          pantheon_site_id: 'pantheon-1',
          name: 'First Site',
        }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listSites();

      expect(result[0]).toMatchObject({
        id: 'site-1',
        pantheonSiteId: 'pantheon-1',
        name: 'First Site',
      });
    });
  });

  describe('Error Classes', () => {
    it('DuplicatePantheonSiteIdError should be an instance of Error', async () => {
      const { DuplicatePantheonSiteIdError } = await import('../../src/services/site-service');

      const error = new DuplicatePantheonSiteIdError('pantheon-123');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('DuplicatePantheonSiteIdError');
      expect(error.pantheonSiteId).toBe('pantheon-123');
    });

    it('InvalidSiteParamsError should be an instance of Error', async () => {
      const { InvalidSiteParamsError } = await import('../../src/services/site-service');

      const error = new InvalidSiteParamsError('name is required');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('InvalidSiteParamsError');
      expect(error.message).toContain('name is required');
    });
  });
});
