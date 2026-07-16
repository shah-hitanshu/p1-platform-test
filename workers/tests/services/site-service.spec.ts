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

// Mock the screenshot producer so we can assert when the trigger fires.
vi.mock('../../src/queues/screenshot-producer', () => ({
  requestSiteScreenshot: vi.fn().mockResolvedValue(undefined),
}));

// Mock the branch-document-service and checkpoint-publish so root-page seeding
// inside createSite does not add unexpected query() calls to the mock.
vi.mock('../../src/services/branch-document-service', () => ({
  createDocumentOnBranch: vi.fn().mockResolvedValue({ document: { id: 'seeded-doc' }, version: { id: 'v1' } }),
}));
vi.mock('../../src/services/checkpoint-publish', () => ({
  publishDocument: vi.fn().mockResolvedValue({ checkpoint: { id: 'cp1' } }),
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
    allowed_origins: string[] | null;
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
      allowed_origins: [],
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
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(error)        // INSERT site fails
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

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

    it('should insert owner role in user_site_roles when creatorId is provided', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRow = createMockSiteRow({ id: 'site-new-123' });
      // BEGIN, INSERT site, INSERT user_site_roles, INSERT main branch, COMMIT
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] })        // BEGIN
        .mockResolvedValueOnce({ rows: [mockRow] })  // INSERT site
        .mockResolvedValueOnce({ rows: [] })          // INSERT user_site_roles
        .mockResolvedValueOnce({ rows: [{ id: 'branch-1', site_id: 'site-new-123', name: 'main', description: 'Main branch', status: 'active', is_main: true, source_branch_id: null, source_checkpoint_id: null, created_by_id: 'creator-user-id', created_by_type: 'user', created_at: '2026-01-23T10:00:00.000Z', updated_at: '2026-01-23T10:00:00.000Z' }] }) // INSERT main branch
        .mockResolvedValueOnce({ rows: [] });         // COMMIT

      await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Test Site',
        creatorId: 'creator-user-id',
      });

      expect(db.query).toHaveBeenCalledTimes(5);
      const calls = vi.mocked(db.query).mock.calls;
      expect(calls[2][0]).toEqual(expect.stringContaining('INSERT INTO app.user_site_roles'));
      expect(calls[2][1]).toEqual(['creator-user-id', 'site-new-123', 'owner', 'local', 'creator-user-id']);
    });

    it('should not insert any role when creatorId is omitted', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRow = createMockSiteRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Test Site',
      });

      // BEGIN, INSERT site, INSERT main branch, COMMIT — no role INSERT
      expect(db.query).toHaveBeenCalledTimes(4);
      const calls = vi.mocked(db.query).mock.calls;
      const hasRoleInsert = calls.some(
        (call) => typeof call[0] === 'string' && (call[0].includes('user_site_roles') || call[0].includes('agent_site_roles')),
      );
      expect(hasRoleInsert).toBe(false);
    });

    it('should insert admin role in agent_site_roles when createdByType is agent', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRow = createMockSiteRow({ id: 'site-agent-123' });
      // BEGIN, INSERT site, INSERT agent_site_roles (grantRole), INSERT main branch, COMMIT
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] })        // BEGIN
        .mockResolvedValueOnce({ rows: [mockRow] })  // INSERT site
        .mockResolvedValueOnce({ rows: [{ id: 'role-1', agent_id: 'agent-1', site_id: 'site-agent-123', role: 'admin', created_by_id: 'agent-1', created_at: '2026-01-23T10:00:00.000Z', revoked_at: null }] }) // INSERT agent_site_roles
        .mockResolvedValueOnce({ rows: [{ id: 'branch-1', site_id: 'site-agent-123', name: 'main', description: 'Main branch', status: 'active', is_main: true, source_branch_id: null, source_checkpoint_id: null, created_by_id: 'agent-1', created_by_type: 'agent', created_at: '2026-01-23T10:00:00.000Z', updated_at: '2026-01-23T10:00:00.000Z' }] }) // INSERT main branch
        .mockResolvedValueOnce({ rows: [] });         // COMMIT

      await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Agent Site',
        creatorId: 'agent-1',
        createdByType: 'agent',
      });

      expect(db.query).toHaveBeenCalledTimes(5);
      const calls = vi.mocked(db.query).mock.calls;
      expect(calls[2][0]).toEqual(expect.stringContaining('INSERT INTO app.agent_site_roles'));
    });

    it('should not insert into user_site_roles when createdByType is agent', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRow = createMockSiteRow({ id: 'site-agent-456' });
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] })        // BEGIN
        .mockResolvedValueOnce({ rows: [mockRow] })  // INSERT site
        .mockResolvedValueOnce({ rows: [{ id: 'role-1', agent_id: 'agent-1', site_id: 'site-agent-456', role: 'admin', created_by_id: 'agent-1', created_at: '2026-01-23T10:00:00.000Z', revoked_at: null }] }) // INSERT agent_site_roles
        .mockResolvedValueOnce({ rows: [{ id: 'branch-1', site_id: 'site-agent-456', name: 'main', description: 'Main branch', status: 'active', is_main: true, source_branch_id: null, source_checkpoint_id: null, created_by_id: 'agent-1', created_by_type: 'agent', created_at: '2026-01-23T10:00:00.000Z', updated_at: '2026-01-23T10:00:00.000Z' }] }) // INSERT main branch
        .mockResolvedValueOnce({ rows: [] });         // COMMIT

      await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Agent Site',
        creatorId: 'agent-1',
        createdByType: 'agent',
      });

      const calls = vi.mocked(db.query).mock.calls;
      const hasUserRoleInsert = calls.some(
        (call) => typeof call[0] === 'string' && call[0].includes('user_site_roles'),
      );
      expect(hasUserRoleInsert).toBe(false);
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

    it('should clear allowedOrigins when passed an empty array', async () => {
      // Verifies the COALESCE($2::text[], allowed_origins) path:
      // passing [] should overwrite existing allowed_origins to empty (clear behaviour).
      const { updateSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      // The DB returns a row with allowed_origins = [] after the UPDATE
      const updatedRow = createMockSiteRow({
        id: 'site-123',
        allowed_origins: [],
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      const result = await updateSite('site-123', { allowedOrigins: [] });

      expect(result).not.toBeNull();
      expect(result?.allowedOrigins).toEqual([]);
    });
  });

  describe('deleteSite', () => {
    it('should delete site and related data when found', async () => {
      const { deleteSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      // Mock getSite returns a site
      const mockSiteRow = createMockSiteRow({ id: 'site-123' });
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockSiteRow] }) // getSite
        .mockResolvedValueOnce({ rows: [{ id: 'branch-1' }] }) // get branch IDs
        .mockResolvedValue({ rows: [], rowCount: 1 }); // all delete queries

      const result = await deleteSite('site-123');

      expect(result).toBe(true);
    });

    it('should return false when site not found', async () => {
      const { deleteSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      // Mock getSite returns no site
      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await deleteSite('non-existent');

      expect(result).toBe(false);
    });

    it('should cascade delete branches and related data', async () => {
      const { deleteSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockSiteRow = createMockSiteRow({ id: 'site-to-delete' });
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockSiteRow] }) // getSite
        .mockResolvedValueOnce({ rows: [{ id: 'branch-1' }, { id: 'branch-2' }] }) // get branch IDs
        .mockResolvedValue({ rows: [], rowCount: 1 }); // all subsequent delete queries

      await deleteSite('site-to-delete');

      // Verify final DELETE on sites table was called
      const calls = vi.mocked(db.query).mock.calls;
      const deleteCall = calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('DELETE') &&
          call[0].includes('app.sites'),
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall?.[1]).toContain('site-to-delete');
    });
  });

  describe('listSites', () => {
    it('should return sites for the given user', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockSiteRow({ id: 'site-1', name: 'Site 1' }),
        createMockSiteRow({ id: 'site-2', name: 'Site 2' }),
        createMockSiteRow({ id: 'site-3', name: 'Site 3' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listSites({ principalId: 'user-1' });

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

      await listSites({ principalId: 'user-1', limit: 2 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([2]),
      );
    });

    it('should support offset option', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSites({ principalId: 'user-1', offset: 10 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET'),
        expect.arrayContaining([10]),
      );
    });

    it('should support both limit and offset options', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSites({ principalId: 'user-1', limit: 25, offset: 50 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/LIMIT.*OFFSET|OFFSET.*LIMIT/),
        expect.arrayContaining([25, 50]),
      );
    });

    it('should return empty array when user has no sites', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listSites({ principalId: 'user-1' });

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

      const result = await listSites({ principalId: 'user-1' });

      expect(result[0]).toMatchObject({
        id: 'site-1',
        pantheonSiteId: 'pantheon-1',
        name: 'First Site',
      });
    });

    it('should filter by principalId when provided', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockSiteRow({ id: 'site-1', name: 'My Site' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listSites({ principalId: 'user-abc' });

      expect(result).toHaveLength(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INNER JOIN app.user_site_roles'),
        expect.arrayContaining(['user-abc']),
      );
    });

    it('should support pagination with principalId filtering', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSites({ principalId: 'user-abc', limit: 10, offset: 20 });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('INNER JOIN app.user_site_roles');
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
    });

    it('should return empty array when user has no site roles', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listSites({ principalId: 'user-no-sites' });

      expect(result).toEqual([]);
    });

    it('should use DISTINCT to deduplicate multi-source roles', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSites({ principalId: 'user-abc' });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('DISTINCT');
    });

    it('should query agent_site_roles when principalType is agent', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSites({ principalId: 'agent-abc', principalType: 'agent' });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('INNER JOIN app.agent_site_roles');
      expect(sql).toContain('revoked_at IS NULL');
      expect(db.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['agent-abc']),
      );
    });

    it('should support pagination with agent principalType', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSites({ principalId: 'agent-abc', principalType: 'agent', limit: 10, offset: 20 });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('INNER JOIN app.agent_site_roles');
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
    });

    // ---------------------------------------------------------------------
    // PCC-3190: when an agent acts on behalf of a user, the result must be
    // intersected with the acting user's user_site_roles so the agent
    // cannot leak sites the user has no access to.
    // ---------------------------------------------------------------------
    describe('PCC-3190: agent + actingUserId intersection', () => {
      it('should join user_site_roles when actingUserId is provided with agent principal', async () => {
        const { listSites } = await import('../../src/services/site-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listSites({
          principalId: 'agent-abc',
          principalType: 'agent',
          actingUserId: 'db-user-xyz',
        });

        const sql = vi.mocked(db.query).mock.calls[0][0];
        const params = vi.mocked(db.query).mock.calls[0][1];

        // Both joins must be present so the result intersects agent + user roles.
        expect(sql).toContain('INNER JOIN app.agent_site_roles');
        expect(sql).toContain('INNER JOIN app.user_site_roles');
        // Both ids must be in the parameter list.
        expect(params).toContain('agent-abc');
        expect(params).toContain('db-user-xyz');
      });

      it('should NOT join user_site_roles when actingUserId is absent (legacy agent path)', async () => {
        const { listSites } = await import('../../src/services/site-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listSites({
          principalId: 'agent-abc',
          principalType: 'agent',
        });

        const sql = vi.mocked(db.query).mock.calls[0][0];

        // Legacy agent calls (no acting user) keep the original SQL shape so
        // direct agent traffic continues to work as before.
        expect(sql).toContain('INNER JOIN app.agent_site_roles');
        expect(sql).not.toContain('INNER JOIN app.user_site_roles');
      });

      it('should ignore actingUserId for user principals (not used in user-scoped flow)', async () => {
        const { listSites } = await import('../../src/services/site-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listSites({
          principalId: 'user-1',
          principalType: 'user',
          actingUserId: 'should-be-ignored',
        });

        const sql = vi.mocked(db.query).mock.calls[0][0];
        const params = vi.mocked(db.query).mock.calls[0][1];

        // User principals already filter by the user's own role table; the
        // actingUserId concept does not apply to them.
        expect(sql).toContain('INNER JOIN app.user_site_roles');
        expect(sql).not.toContain('app.agent_site_roles');
        expect(params).not.toContain('should-be-ignored');
      });

      it('should support pagination with agent + actingUserId intersection', async () => {
        const { listSites } = await import('../../src/services/site-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listSites({
          principalId: 'agent-abc',
          principalType: 'agent',
          actingUserId: 'db-user-xyz',
          limit: 10,
          offset: 20,
        });

        const sql = vi.mocked(db.query).mock.calls[0][0];
        expect(sql).toContain('INNER JOIN app.agent_site_roles');
        expect(sql).toContain('INNER JOIN app.user_site_roles');
        expect(sql).toContain('LIMIT');
        expect(sql).toContain('OFFSET');
      });

      it('should still respect agent_site_roles.revoked_at IS NULL when intersecting', async () => {
        const { listSites } = await import('../../src/services/site-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listSites({
          principalId: 'agent-abc',
          principalType: 'agent',
          actingUserId: 'db-user-xyz',
        });

        const sql = vi.mocked(db.query).mock.calls[0][0];
        // The revoked_at filter must remain even with the user join, otherwise
        // revoked agent grants could come back through the intersection.
        expect(sql).toContain('revoked_at IS NULL');
      });
    });

    // ---------------------------------------------------------------------
    // System admins (users.system_role = 'admin') have ADMIN on all sites
    // (see getEffectiveRole in src/auth/authorization.ts), so listSites must
    // return every site for them instead of only sites with explicit
    // user_site_roles grants.
    // ---------------------------------------------------------------------
    describe('systemRole admin bypass (user principals)', () => {
      it('should select all sites without joining user_site_roles for a system admin user', async () => {
        const { listSites } = await import('../../src/services/site-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listSites({
          principalId: 'db-user-admin',
          principalType: 'user',
          systemRole: 'admin',
        });

        const sql = vi.mocked(db.query).mock.calls[0][0];
        expect(sql).toContain('FROM app.sites');
        expect(sql).not.toContain('user_site_roles');
        expect(sql).not.toContain('agent_site_roles');
        // Active-only default and ordering must be preserved.
        expect(sql).toContain('archived_at IS NULL');
        expect(sql).toContain('ORDER BY s.created_at DESC');
      });

      it('should preserve the archived filter for a system admin user', async () => {
        const { listSites } = await import('../../src/services/site-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listSites({
          principalId: 'db-user-admin',
          principalType: 'user',
          systemRole: 'admin',
          archived: true,
        });

        const sql = vi.mocked(db.query).mock.calls[0][0];
        expect(sql).toContain('archived_at IS NOT NULL');
        expect(sql).not.toContain('user_site_roles');
      });

      it('should keep LIMIT/OFFSET parameter numbering correct on the admin path', async () => {
        const { listSites } = await import('../../src/services/site-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listSites({
          principalId: 'db-user-admin',
          principalType: 'user',
          systemRole: 'admin',
          limit: 10,
          offset: 20,
        });

        const sql = vi.mocked(db.query).mock.calls[0][0];
        const params = vi.mocked(db.query).mock.calls[0][1];

        // The admin path does not filter by principalId, so it must not be
        // in the params and the placeholder numbering must line up exactly
        // with the params actually passed.
        expect(params).not.toContain('db-user-admin');
        const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
        expect(Math.max(...placeholders)).toBe(params.length);
        const limitIndex = params.indexOf(10);
        const offsetIndex = params.indexOf(20);
        expect(sql).toContain(`LIMIT $${String(limitIndex + 1)}`);
        expect(sql).toContain(`OFFSET $${String(offsetIndex + 1)}`);
      });

      it('should map admin-path rows to Site objects', async () => {
        const { listSites } = await import('../../src/services/site-service');
        const db = await import('../../src/db');

        const mockRows = [
          createMockSiteRow({ id: 'site-1', pantheon_site_id: 'pantheon-1', name: 'All Sites 1' }),
          createMockSiteRow({ id: 'site-2', pantheon_site_id: 'pantheon-2', name: 'All Sites 2' }),
        ];
        vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

        const result = await listSites({
          principalId: 'db-user-admin',
          principalType: 'user',
          systemRole: 'admin',
        });

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ id: 'site-1', pantheonSiteId: 'pantheon-1', name: 'All Sites 1' });
      });

      it('should still join user_site_roles for a non-admin systemRole', async () => {
        const { listSites } = await import('../../src/services/site-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listSites({
          principalId: 'db-user-member',
          principalType: 'user',
          systemRole: 'member',
        });

        const sql = vi.mocked(db.query).mock.calls[0][0];
        const params = vi.mocked(db.query).mock.calls[0][1];
        expect(sql).toContain('INNER JOIN app.user_site_roles');
        expect(params).toContain('db-user-member');
      });

      it('should still join user_site_roles when systemRole is undefined', async () => {
        const { listSites } = await import('../../src/services/site-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listSites({ principalId: 'db-user-plain', principalType: 'user' });

        const sql = vi.mocked(db.query).mock.calls[0][0];
        expect(sql).toContain('INNER JOIN app.user_site_roles');
      });

      it('should NOT bypass role filtering for agent principals even with systemRole admin', async () => {
        const { listSites } = await import('../../src/services/site-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listSites({
          principalId: 'agent-abc',
          principalType: 'agent',
          systemRole: 'admin',
        });

        const sql = vi.mocked(db.query).mock.calls[0][0];
        // Agent traffic keeps its own role scoping regardless of systemRole.
        expect(sql).toContain('INNER JOIN app.agent_site_roles');
        expect(sql).toContain('revoked_at IS NULL');
      });

      it('should keep PCC-3190 intersection semantics for agents with systemRole admin and actingUserId', async () => {
        const { listSites } = await import('../../src/services/site-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listSites({
          principalId: 'agent-abc',
          principalType: 'agent',
          systemRole: 'admin',
          actingUserId: 'db-user-xyz',
        });

        const sql = vi.mocked(db.query).mock.calls[0][0];
        const params = vi.mocked(db.query).mock.calls[0][1];
        expect(sql).toContain('INNER JOIN app.agent_site_roles');
        expect(sql).toContain('INNER JOIN app.user_site_roles');
        expect(params).toContain('agent-abc');
        expect(params).toContain('db-user-xyz');
      });
    });
  });

  describe('getSiteAllowedOrigins', () => {
    it('should return string[] for a known site with origins configured', async () => {
      const { getSiteAllowedOrigins } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ allowed_origins: ['https://mysite.com', '*-mysite.pantheonsite.io'] }],
      });

      const result = await getSiteAllowedOrigins('site-123');

      expect(result).toEqual(['https://mysite.com', '*-mysite.pantheonsite.io']);
    });

    it('should return null for an unknown siteId (site not found)', async () => {
      const { getSiteAllowedOrigins } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getSiteAllowedOrigins('non-existent-site');

      expect(result).toBeNull();
    });

    it('should return empty array for a site with no allowed_origins configured (null in DB)', async () => {
      const { getSiteAllowedOrigins } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ allowed_origins: null }],
      });

      const result = await getSiteAllowedOrigins('site-empty');

      expect(result).toEqual([]);
    });

    it('should return empty array for a site with an empty allowed_origins array in DB', async () => {
      const { getSiteAllowedOrigins } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ allowed_origins: [] }],
      });

      const result = await getSiteAllowedOrigins('site-no-origins');

      expect(result).toEqual([]);
    });

    it('should propagate DB errors', async () => {
      const { getSiteAllowedOrigins } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockRejectedValue(new Error('DB connection error'));

      await expect(getSiteAllowedOrigins('site-123')).rejects.toThrow('DB connection error');
    });

    it('should query by site ID with correct column', async () => {
      const { getSiteAllowedOrigins } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getSiteAllowedOrigins('site-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('allowed_origins'),
        expect.arrayContaining(['site-uuid-456']),
      );
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

  describe('Site url field', () => {
    it('should persist url on createSite', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRow: MockSiteRow & { url: string } = {
        ...createMockSiteRow(),
        url: 'https://example.com',
      };
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Test Site',
        url: 'https://example.com',
      });

      expect(result.url).toBe('https://example.com');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining(['https://example.com']),
      );
    });

    it('should accept createSite without a url', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockRow = createMockSiteRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createSite({
        pantheonSiteId: 'pantheon-site-abc',
        name: 'Test Site',
      });

      expect(result.url).toBeUndefined();
    });

    it('should reject createSite when url is malformed', async () => {
      const { createSite, InvalidSiteParamsError } = await import('../../src/services/site-service');

      await expect(
        createSite({
          pantheonSiteId: 'pantheon-site-abc',
          name: 'Test Site',
          url: 'not a url',
        }),
      ).rejects.toThrow(InvalidSiteParamsError);
    });

    it('should persist url on updateSite', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const updatedRow: MockSiteRow & { url: string } = {
        ...createMockSiteRow({ id: 'site-123' }),
        url: 'https://new.example.com',
      };
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      const result = await updateSite('site-123', {
        url: 'https://new.example.com',
      });

      expect(result?.url).toBe('https://new.example.com');
      const calls = vi.mocked(db.query).mock.calls;
      const updateCall = calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('UPDATE app.sites'),
      );
      expect(updateCall?.[1]).toEqual(expect.arrayContaining(['https://new.example.com']));
    });

    it('should reject updateSite when url is malformed', async () => {
      const { updateSite, InvalidSiteParamsError } = await import('../../src/services/site-service');

      await expect(
        updateSite('site-123', { url: 'also not a url' }),
      ).rejects.toThrow(InvalidSiteParamsError);
    });

    it('should include url in getSite result when present in row', async () => {
      const { getSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const row: MockSiteRow & { url: string } = {
        ...createMockSiteRow({ id: 'site-123' }),
        url: 'https://example.com',
      };
      vi.mocked(db.query).mockResolvedValue({ rows: [row] });

      const result = await getSite('site-123');

      expect(result?.url).toBe('https://example.com');
    });
  });

  describe('Screenshot trigger on url change', () => {
    const fakeEnv = { SCREENSHOT_QUEUE: { send: vi.fn() } };

    it('createSite with env and a url enqueues a screenshot request', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');
      const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');

      const mockRow: MockSiteRow & { url: string } = {
        ...createMockSiteRow({ id: 'site-99' }),
        url: 'https://example.com',
      };
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await createSite(
        { pantheonSiteId: 'p1', name: 'S', url: 'https://example.com' },
        fakeEnv as unknown as Parameters<typeof createSite>[1],
      );

      expect(requestSiteScreenshot).toHaveBeenCalledWith(
        fakeEnv,
        expect.objectContaining({ id: 'site-99', url: 'https://example.com' }),
        'url_changed',
      );
    });

    it('createSite without env never triggers a screenshot', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');
      const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');

      const mockRow: MockSiteRow & { url: string } = {
        ...createMockSiteRow({ id: 'site-99' }),
        url: 'https://example.com',
      };
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await createSite({ pantheonSiteId: 'p1', name: 'S', url: 'https://example.com' });

      expect(requestSiteScreenshot).not.toHaveBeenCalled();
    });

    it('createSite with env but no url does not trigger', async () => {
      const { createSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');
      const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');

      vi.mocked(db.query).mockResolvedValue({ rows: [createMockSiteRow()] });

      await createSite(
        { pantheonSiteId: 'p1', name: 'S' },
        fakeEnv as unknown as Parameters<typeof createSite>[1],
      );

      expect(requestSiteScreenshot).not.toHaveBeenCalled();
    });

    it('updateSite triggers when url is set to a new value', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');
      const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');

      const priorRow: MockSiteRow & { url: string | null } = {
        ...createMockSiteRow({ id: 'site-77' }),
        url: 'https://old.example.com',
      };
      const updatedRow: MockSiteRow & { url: string } = {
        ...createMockSiteRow({ id: 'site-77' }),
        url: 'https://new.example.com',
      };
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [priorRow] }) // getSite for prior url
        .mockResolvedValueOnce({ rows: [updatedRow] }); // UPDATE result

      await updateSite(
        'site-77',
        { url: 'https://new.example.com' },
        fakeEnv as unknown as Parameters<typeof updateSite>[2],
      );

      expect(requestSiteScreenshot).toHaveBeenCalledWith(
        fakeEnv,
        expect.objectContaining({ id: 'site-77', url: 'https://new.example.com' }),
        'url_changed',
      );
    });

    it('updateSite does not trigger when url is unchanged', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');
      const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');

      const sameUrl = 'https://example.com';
      const priorRow: MockSiteRow & { url: string } = {
        ...createMockSiteRow({ id: 'site-77' }),
        url: sameUrl,
      };
      const updatedRow: MockSiteRow & { url: string } = {
        ...createMockSiteRow({ id: 'site-77' }),
        url: sameUrl,
      };
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [priorRow] })
        .mockResolvedValueOnce({ rows: [updatedRow] });

      await updateSite(
        'site-77',
        { url: sameUrl },
        fakeEnv as unknown as Parameters<typeof updateSite>[2],
      );

      expect(requestSiteScreenshot).not.toHaveBeenCalled();
    });

    it('updateSite without env never triggers', async () => {
      const { updateSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');
      const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');

      const updatedRow: MockSiteRow & { url: string } = {
        ...createMockSiteRow({ id: 'site-77' }),
        url: 'https://new.example.com',
      };
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      await updateSite('site-77', { url: 'https://new.example.com' });

      expect(requestSiteScreenshot).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // PCC-3211: Soft delete — archiveSite / restoreSite / listSites(archived)
  // ===========================================================================

  describe('archiveSite', () => {
    const txOk = { rows: [], rowCount: 0 }; // mock for BEGIN / COMMIT

    it('should set archived_at on the site and cascade to branches and documents', async () => {
      const { archiveSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const archiveTs = '2026-05-17T10:00:00.000Z';
      vi.mocked(db.query)
        .mockResolvedValueOnce(txOk) // BEGIN
        .mockResolvedValueOnce({ rows: [{ archived_at: archiveTs }], rowCount: 1 }) // UPDATE sites
        .mockResolvedValueOnce({ rows: [], rowCount: 2 }) // UPDATE branches
        .mockResolvedValueOnce({ rows: [], rowCount: 3 }) // UPDATE documents
        .mockResolvedValueOnce(txOk); // COMMIT

      const result = await archiveSite('site-123');

      expect(result).toBe(true);
    });

    it('should return false when site does not exist', async () => {
      const { archiveSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce(txOk) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE sites (no match)
        .mockResolvedValueOnce({ rows: [] }) // SELECT id (not found)
        .mockResolvedValueOnce(txOk); // COMMIT

      const result = await archiveSite('non-existent');

      expect(result).toBe(false);
    });

    it('should return already_archived when site exists but is already archived', async () => {
      const { archiveSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce(txOk) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE sites (no match: already archived)
        .mockResolvedValueOnce({ rows: [{ id: 'site-123' }] }) // SELECT id (exists)
        .mockResolvedValueOnce(txOk); // COMMIT

      const result = await archiveSite('site-123');

      expect(result).toBe('already_archived');
    });

    it('should cascade archived_at to branches and documents using the same timestamp', async () => {
      const { archiveSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const archiveTs = '2026-05-17T10:00:00.000Z';
      vi.mocked(db.query)
        .mockResolvedValueOnce(txOk) // BEGIN
        .mockResolvedValueOnce({ rows: [{ archived_at: archiveTs }], rowCount: 1 }) // UPDATE sites
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE branches
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE documents
        .mockResolvedValueOnce(txOk); // COMMIT

      await archiveSite('site-123');

      const calls = vi.mocked(db.query).mock.calls;
      const branchCall = calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('app.branches') && c[0].includes('archived_at'),
      );
      const documentCall = calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('app.documents') && c[0].includes('archived_at'),
      );
      expect(branchCall).toBeDefined();
      expect(documentCall).toBeDefined();
      expect(branchCall?.[1]).toContain(archiveTs);
      expect(documentCall?.[1]).toContain(archiveTs);
    });
  });

  describe('restoreSite', () => {
    const txOk = { rows: [], rowCount: 0 }; // mock for BEGIN / COMMIT

    it('should clear archived_at on site and restore cascade-archived branches and documents', async () => {
      const { restoreSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const archiveTs = '2026-05-17T10:00:00.000Z';
      const mockSiteRow = { ...createMockSiteRow({ id: 'site-123' }), archived_at: archiveTs };
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockSiteRow] }) // SELECT (check archived_at)
        .mockResolvedValueOnce(txOk) // BEGIN
        .mockResolvedValueOnce({ rows: [{ ...mockSiteRow, archived_at: null }], rowCount: 1 }) // UPDATE sites
        .mockResolvedValueOnce({ rows: [], rowCount: 2 }) // UPDATE branches
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE documents
        .mockResolvedValueOnce(txOk); // COMMIT

      const result = await restoreSite('site-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('site-123');
    });

    it('should return null when site not found', async () => {
      const { restoreSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] }); // SELECT → not found

      const result = await restoreSite('non-existent');

      expect(result).toBeNull();
    });

    it('should return null when site is not archived', async () => {
      const { restoreSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const mockSiteRow = { ...createMockSiteRow({ id: 'site-123' }), archived_at: null };
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockSiteRow] }); // SELECT → active site

      const result = await restoreSite('site-123');

      expect(result).toBeNull();
    });

    it('should only restore branches/docs archived at the same timestamp (not independently-archived ones)', async () => {
      const { restoreSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      const archiveTs = '2026-05-17T10:00:00.000Z';
      const mockSiteRow = { ...createMockSiteRow({ id: 'site-123' }), archived_at: archiveTs };
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockSiteRow] }) // SELECT
        .mockResolvedValueOnce(txOk) // BEGIN
        .mockResolvedValueOnce({ rows: [{ ...mockSiteRow, archived_at: null }], rowCount: 1 }) // UPDATE sites
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE branches
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE documents
        .mockResolvedValueOnce(txOk); // COMMIT

      await restoreSite('site-123');

      const calls = vi.mocked(db.query).mock.calls;
      const branchRestoreCall = calls.find(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('app.branches') &&
          c[0].includes('archived_at = NULL'),
      );
      expect(branchRestoreCall).toBeDefined();
      expect(branchRestoreCall?.[1]).toContain(archiveTs);
    });
  });

  describe('getCachedSiteAllowedOrigins (PCC-3334)', () => {
    it('should return origins from DB on first call', async () => {
      const { getCachedSiteAllowedOrigins } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ allowed_origins: ['https://custom.example.com'] }],
      });

      const result = await getCachedSiteAllowedOrigins('site-123');
      expect(result).toEqual(['https://custom.example.com']);
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('should return cached result on second call without querying DB again', async () => {
      const { getCachedSiteAllowedOrigins } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ allowed_origins: ['https://cached.example.com'] }],
      });

      // First call — hits DB
      await getCachedSiteAllowedOrigins('site-cache-test');
      // Second call — should use cache, not DB
      const result = await getCachedSiteAllowedOrigins('site-cache-test');

      expect(result).toEqual(['https://cached.example.com']);
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('should return null for unknown site and not cache it', async () => {
      const { getCachedSiteAllowedOrigins } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getCachedSiteAllowedOrigins('nonexistent-site');
      expect(result).toBeNull();

      // Second call should also hit DB since null is not cached
      await getCachedSiteAllowedOrigins('nonexistent-site');
      expect(db.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('listSites — archived filter (PCC-3211)', () => {
    it('should exclude archived sites by default', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSites({ principalId: 'user-1' });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('archived_at IS NULL');
    });

    it('should return only archived sites when archived=true', async () => {
      const { listSites } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listSites({ principalId: 'user-1', archived: true });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('archived_at IS NOT NULL');
    });
  });
});
