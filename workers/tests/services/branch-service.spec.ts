/**
 * Phase 3.2: Branch Service Tests (TDD)
 *
 * Tests for Branch CRUD operations and status management.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BranchStatus } from '../../src/types';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 3.2: Branch Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Mock branch row type (database format)
  interface MockBranchRow {
    id: string;
    site_id: string;
    name: string;
    description: string | null;
    status: BranchStatus;
    is_main: boolean;
    source_branch_id: string | null;
    source_checkpoint_id: string | null;
    created_by_id: string;
    created_by_type: 'user' | 'agent';
    created_at: string;
    updated_at: string;
  }

  // Helper to create a mock branch row (database format)
  function createMockBranchRow(overrides: Partial<MockBranchRow> = {}): MockBranchRow {
    return {
      id: 'branch-uuid-123',
      site_id: 'site-uuid-456',
      name: 'feature-branch',
      description: 'A test feature branch',
      status: 'active',
      is_main: false,
      source_branch_id: 'main-branch-uuid',
      source_checkpoint_id: null,
      created_by_id: 'user-uuid-789',
      created_by_type: 'user',
      created_at: '2026-01-23T10:00:00.000Z',
      updated_at: '2026-01-23T10:00:00.000Z',
      ...overrides,
    };
  }

  // Helper to create a main branch row
  function createMainBranchRow(siteId = 'site-uuid-456'): MockBranchRow {
    return createMockBranchRow({
      id: 'main-branch-uuid',
      site_id: siteId,
      name: 'main',
      description: 'Main branch',
      is_main: true,
      source_branch_id: null,
      source_checkpoint_id: null,
    });
  }

  describe('createBranch', () => {
    /**
     * Helper to set up mocks for createBranch with transaction.
     * The function uses BEGIN/COMMIT with structure and metadata copy.
     */
    function setupCreateBranchMocks(
      db: { query: ReturnType<typeof vi.fn> },
      branchRow: MockBranchRow,
    ): void {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [branchRow] }) // INSERT branch
        .mockResolvedValueOnce({ rows: [] }) // structure copy
        .mockResolvedValueOnce({ rows: [] }) // metadata copy
        .mockResolvedValueOnce({ rows: [] }); // COMMIT
    }

    it('should create a branch from a source branch', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow();
      setupCreateBranchMocks(db, mockRow);

      const result = await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        description: 'A test feature branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('feature-branch');
      expect(result.description).toBe('A test feature branch');
      expect(result.siteId).toBe('site-uuid-456');
      expect(result.sourceBranchId).toBe('main-branch-uuid');
      expect(result.status).toBe('active');
      expect(result.isMain).toBe(false);
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create a branch with optional source checkpoint', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow({
        source_checkpoint_id: 'checkpoint-uuid-123',
      });
      setupCreateBranchMocks(db, mockRow);

      const result = await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-from-checkpoint',
        sourceBranchId: 'main-branch-uuid',
        sourceCheckpointId: 'checkpoint-uuid-123',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(result.sourceCheckpointId).toBe('checkpoint-uuid-123');
    });

    it('should throw DuplicateBranchNameError for duplicate branch name in same site', async () => {
      const { createBranch, DuplicateBranchNameError } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      // Simulate unique constraint violation during INSERT
      const error = new Error('duplicate key value violates unique constraint');
      (error as NodeJS.ErrnoException).code = '23505';
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(error); // INSERT fails

      await expect(
        createBranch({
          siteId: 'site-uuid-456',
          name: 'existing-branch',
          sourceBranchId: 'main-branch-uuid',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        }),
      ).rejects.toThrow(DuplicateBranchNameError);
    });

    it('should throw SiteNotFoundError when site does not exist', async () => {
      const { createBranch, SiteNotFoundError } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      // Simulate foreign key constraint violation during INSERT
      const error = new Error('insert or update on table "branches" violates foreign key constraint');
      (error as NodeJS.ErrnoException).code = '23503';
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(error); // INSERT fails

      await expect(
        createBranch({
          siteId: 'non-existent-site',
          name: 'new-branch',
          sourceBranchId: 'main-branch-uuid',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        }),
      ).rejects.toThrow(SiteNotFoundError);
    });

    it('should throw InvalidBranchParamsError for empty branch name', async () => {
      const { createBranch, InvalidBranchParamsError } = await import('../../src/services/branch-service');

      await expect(
        createBranch({
          siteId: 'site-uuid-456',
          name: '',
          sourceBranchId: 'main-branch-uuid',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidBranchParamsError);
    });

    it('should throw InvalidBranchParamsError for whitespace-only branch name', async () => {
      const { createBranch, InvalidBranchParamsError } = await import('../../src/services/branch-service');

      await expect(
        createBranch({
          siteId: 'site-uuid-456',
          name: '   ',
          sourceBranchId: 'main-branch-uuid',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidBranchParamsError);
    });

    it('should throw InvalidBranchParamsError for missing sourceBranchId', async () => {
      const { createBranch, InvalidBranchParamsError } = await import('../../src/services/branch-service');

      await expect(
        createBranch({
          siteId: 'site-uuid-456',
          name: 'new-branch',
          sourceBranchId: '',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidBranchParamsError);
    });

    it('should create a branch with status active by default', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow({ status: 'active' });
      setupCreateBranchMocks(db, mockRow);

      const result = await createBranch({
        siteId: 'site-uuid-456',
        name: 'new-feature',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(result.status).toBe('active');
    });

    it('should include INSERT query with correct columns', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow();
      setupCreateBranchMocks(db, mockRow);

      await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining(['site-uuid-456', 'feature-branch']),
      );
    });

    it('should create agent-created branches', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow({
        created_by_id: 'agent-uuid-123',
        created_by_type: 'agent',
      });
      setupCreateBranchMocks(db, mockRow);

      const result = await createBranch({
        siteId: 'site-uuid-456',
        name: 'agent-branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'agent-uuid-123',
        createdByType: 'agent',
      });

      expect(result.createdById).toBe('agent-uuid-123');
      expect(result.createdByType).toBe('agent');
    });
  });

  describe('createMainBranch', () => {
    it('should create the main branch for a site', async () => {
      const { createMainBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMainBranchRow('site-uuid-456');
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createMainBranch({
        siteId: 'site-uuid-456',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(result.name).toBe('main');
      expect(result.isMain).toBe(true);
      expect(result.status).toBe('active');
      expect(result.sourceBranchId).toBeUndefined();
    });

    it('should throw DuplicateBranchNameError if main already exists', async () => {
      const { createMainBranch, DuplicateBranchNameError } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      // Simulate unique constraint violation on is_main partial index
      const error = new Error('duplicate key value violates unique constraint "idx_branches_main"');
      (error as NodeJS.ErrnoException).code = '23505';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(
        createMainBranch({
          siteId: 'site-uuid-456',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        }),
      ).rejects.toThrow(DuplicateBranchNameError);
    });

    it('should throw SiteNotFoundError when site does not exist', async () => {
      const { createMainBranch, SiteNotFoundError } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      // Simulate foreign key constraint violation
      const error = new Error('insert or update on table "branches" violates foreign key constraint');
      (error as NodeJS.ErrnoException).code = '23503';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(
        createMainBranch({
          siteId: 'non-existent-site',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        }),
      ).rejects.toThrow(SiteNotFoundError);
    });
  });

  describe('getBranch', () => {
    it('should return branch when found', async () => {
      const { getBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow({ id: 'branch-123' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getBranch('branch-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('branch-123');
      expect(result?.name).toBe('feature-branch');
      expect(result?.status).toBe('active');
    });

    it('should return null when branch not found', async () => {
      const { getBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getBranch('non-existent-id');

      expect(result).toBeNull();
    });

    it('should map all branch fields correctly', async () => {
      const { getBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow({
        id: 'branch-123',
        site_id: 'site-456',
        name: 'test-branch',
        description: 'Test description',
        status: 'review',
        is_main: false,
        source_branch_id: 'main-uuid',
        source_checkpoint_id: 'checkpoint-uuid',
        created_by_id: 'user-123',
        created_by_type: 'user',
        created_at: '2026-01-23T12:00:00.000Z',
        updated_at: '2026-01-23T14:00:00.000Z',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getBranch('branch-123');

      expect(result).toMatchObject({
        id: 'branch-123',
        siteId: 'site-456',
        name: 'test-branch',
        description: 'Test description',
        status: 'review',
        isMain: false,
        sourceBranchId: 'main-uuid',
        sourceCheckpointId: 'checkpoint-uuid',
        createdById: 'user-123',
        createdByType: 'user',
        createdAt: '2026-01-23T12:00:00.000Z',
        updatedAt: '2026-01-23T14:00:00.000Z',
      });
    });

    it('should query by branch ID', async () => {
      const { getBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getBranch('branch-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('id'),
        expect.arrayContaining(['branch-uuid-456']),
      );
    });
  });

  describe('getBranchByName', () => {
    it('should return branch when found by name in site', async () => {
      const { getBranchByName } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow({ name: 'my-feature' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getBranchByName('site-uuid-456', 'my-feature');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('my-feature');
    });

    it('should return null when branch name not found in site', async () => {
      const { getBranchByName } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getBranchByName('site-uuid-456', 'non-existent');

      expect(result).toBeNull();
    });

    it('should query by site_id and name', async () => {
      const { getBranchByName } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getBranchByName('site-456', 'feature-x');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/site_id.*name|name.*site_id/),
        expect.arrayContaining(['site-456', 'feature-x']),
      );
    });
  });

  describe('getMainBranch', () => {
    it('should return main branch for site', async () => {
      const { getMainBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMainBranchRow('site-uuid-456');
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getMainBranch('site-uuid-456');

      expect(result).not.toBeNull();
      expect(result?.isMain).toBe(true);
      expect(result?.name).toBe('main');
    });

    it('should return null when site has no main branch', async () => {
      const { getMainBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getMainBranch('site-without-main');

      expect(result).toBeNull();
    });

    it('should query by site_id and is_main', async () => {
      const { getMainBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getMainBranch('site-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/is_main.*=.*TRUE|is_main.*=.*true/i),
        expect.arrayContaining(['site-456']),
      );
    });
  });

  describe('listBranches', () => {
    it('should return all branches for a site', async () => {
      const { listBranches } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMainBranchRow('site-uuid-456'),
        createMockBranchRow({ id: 'branch-1', name: 'feature-1' }),
        createMockBranchRow({ id: 'branch-2', name: 'feature-2' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listBranches('site-uuid-456');

      expect(result).toHaveLength(3);
    });

    it('should filter branches by status', async () => {
      const { listBranches } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockBranchRow({ id: 'branch-1', status: 'active' }),
        createMockBranchRow({ id: 'branch-2', status: 'active' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      await listBranches('site-uuid-456', { status: 'active' });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('status'),
        expect.arrayContaining(['site-uuid-456', 'active']),
      );
    });

    it('should support limit option', async () => {
      const { listBranches } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listBranches('site-uuid-456', { limit: 5 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([5]),
      );
    });

    it('should support offset option', async () => {
      const { listBranches } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listBranches('site-uuid-456', { offset: 10 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET'),
        expect.arrayContaining([10]),
      );
    });

    it('should return empty array when no branches exist', async () => {
      const { listBranches } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listBranches('site-uuid-456');

      expect(result).toEqual([]);
    });

    it('should order branches by created_at descending', async () => {
      const { listBranches } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listBranches('site-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/ORDER BY.*created_at.*DESC/i),
        expect.any(Array),
      );
    });
  });

  describe('updateBranch', () => {
    it('should update branch name', async () => {
      const { updateBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const updatedRow = createMockBranchRow({
        id: 'branch-123',
        name: 'renamed-branch',
        updated_at: '2026-01-23T14:00:00.000Z',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      const result = await updateBranch('branch-123', { name: 'renamed-branch' });

      expect(result).not.toBeNull();
      expect(result?.name).toBe('renamed-branch');
    });

    it('should update branch description', async () => {
      const { updateBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const updatedRow = createMockBranchRow({
        id: 'branch-123',
        description: 'Updated description',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      const result = await updateBranch('branch-123', { description: 'Updated description' });

      expect(result?.description).toBe('Updated description');
    });

    it('should update both name and description in single call', async () => {
      const { updateBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const updatedRow = createMockBranchRow({
        id: 'branch-123',
        name: 'new-name',
        description: 'New description',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      const result = await updateBranch('branch-123', {
        name: 'new-name',
        description: 'New description',
      });

      expect(result?.name).toBe('new-name');
      expect(result?.description).toBe('New description');
    });

    it('should update updatedAt timestamp', async () => {
      const { updateBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const originalTime = '2026-01-23T10:00:00.000Z';
      const updatedTime = '2026-01-23T14:00:00.000Z';

      const updatedRow = createMockBranchRow({
        id: 'branch-123',
        created_at: originalTime,
        updated_at: updatedTime,
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      const result = await updateBranch('branch-123', { name: 'new-name' });

      expect(result?.updatedAt).toBe(updatedTime);
      expect(result?.createdAt).toBe(originalTime);
    });

    it('should return null when branch not found', async () => {
      const { updateBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await updateBranch('non-existent', { name: 'new-name' });

      expect(result).toBeNull();
    });

    it('should throw DuplicateBranchNameError for duplicate name in same site', async () => {
      const { updateBranch, DuplicateBranchNameError } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      // Simulate unique constraint violation
      const error = new Error('duplicate key value violates unique constraint');
      (error as NodeJS.ErrnoException).code = '23505';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(
        updateBranch('branch-123', { name: 'existing-name' }),
      ).rejects.toThrow(DuplicateBranchNameError);
    });

    it('should throw InvalidBranchParamsError for empty name', async () => {
      const { updateBranch, InvalidBranchParamsError } = await import('../../src/services/branch-service');

      await expect(
        updateBranch('branch-123', { name: '' }),
      ).rejects.toThrow(InvalidBranchParamsError);
    });

    it('should not throw for empty description (clearing description)', async () => {
      const { updateBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const updatedRow = createMockBranchRow({
        id: 'branch-123',
        description: null,
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      const result = await updateBranch('branch-123', { description: '' });

      expect(result?.description).toBeUndefined();
    });
  });

  describe('updateBranchStatus', () => {
    it('should update status from active to review', async () => {
      const { updateBranchStatus } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      // First call returns current branch state
      const currentRow = createMockBranchRow({ id: 'branch-123', status: 'active' });
      // Second call returns updated branch
      const updatedRow = createMockBranchRow({ id: 'branch-123', status: 'review' });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [currentRow] })
        .mockResolvedValueOnce({ rows: [updatedRow] });

      const result = await updateBranchStatus('branch-123', 'review');

      expect(result?.status).toBe('review');
    });

    it('should update status from review to merged', async () => {
      const { updateBranchStatus } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const currentRow = createMockBranchRow({ id: 'branch-123', status: 'review' });
      const updatedRow = createMockBranchRow({ id: 'branch-123', status: 'merged' });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [currentRow] })
        .mockResolvedValueOnce({ rows: [updatedRow] });

      const result = await updateBranchStatus('branch-123', 'merged');

      expect(result?.status).toBe('merged');
    });

    it('should update status from active to archived', async () => {
      const { updateBranchStatus } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const currentRow = createMockBranchRow({ id: 'branch-123', status: 'active' });
      const updatedRow = createMockBranchRow({ id: 'branch-123', status: 'archived' });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [currentRow] })
        .mockResolvedValueOnce({ rows: [updatedRow] });

      const result = await updateBranchStatus('branch-123', 'archived');

      expect(result?.status).toBe('archived');
    });

    it('should throw InvalidBranchStatusTransitionError for invalid transition', async () => {
      const { updateBranchStatus, InvalidBranchStatusTransitionError } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      // Branch is already merged, cannot go back to active
      const currentRow = createMockBranchRow({ id: 'branch-123', status: 'merged' });
      vi.mocked(db.query).mockResolvedValue({ rows: [currentRow] });

      await expect(
        updateBranchStatus('branch-123', 'active'),
      ).rejects.toThrow(InvalidBranchStatusTransitionError);
    });

    it('should throw InvalidBranchStatusTransitionError when transitioning archived to active', async () => {
      const { updateBranchStatus, InvalidBranchStatusTransitionError } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const currentRow = createMockBranchRow({ id: 'branch-123', status: 'archived' });
      vi.mocked(db.query).mockResolvedValue({ rows: [currentRow] });

      await expect(
        updateBranchStatus('branch-123', 'active'),
      ).rejects.toThrow(InvalidBranchStatusTransitionError);
    });

    it('should throw MainBranchProtectionError when archiving main branch', async () => {
      const { updateBranchStatus, MainBranchProtectionError } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mainRow = createMainBranchRow('site-uuid-456');
      vi.mocked(db.query).mockResolvedValue({ rows: [mainRow] });

      await expect(
        updateBranchStatus('main-branch-uuid', 'archived'),
      ).rejects.toThrow(MainBranchProtectionError);
    });

    it('should return null when branch not found', async () => {
      const { updateBranchStatus } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await updateBranchStatus('non-existent', 'review');

      expect(result).toBeNull();
    });
  });

  describe('deleteBranch', () => {
    it('should delete branch and related data when found', async () => {
      const { deleteBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      // First call to check if it's the main branch, then cascade delete queries
      const branchRow = createMockBranchRow({ id: 'branch-123', is_main: false });
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [branchRow] }) // getBranch check
        .mockResolvedValue({ rows: [], rowCount: 1 }); // all delete queries

      const result = await deleteBranch('branch-123');

      expect(result).toBe(true);
    });

    it('should return false when branch not found', async () => {
      const { deleteBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await deleteBranch('non-existent');

      expect(result).toBe(false);
    });

    it('should throw MainBranchProtectionError when deleting main branch', async () => {
      const { deleteBranch, MainBranchProtectionError } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mainRow = createMainBranchRow('site-uuid-456');
      vi.mocked(db.query).mockResolvedValue({ rows: [mainRow] });

      await expect(deleteBranch('main-branch-uuid')).rejects.toThrow(MainBranchProtectionError);
    });

    it('should cascade delete related data before deleting branch', async () => {
      const { deleteBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const branchRow = createMockBranchRow({ id: 'branch-to-delete', is_main: false });
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [branchRow] }) // getBranch
        .mockResolvedValue({ rows: [], rowCount: 1 }); // all delete queries

      await deleteBranch('branch-to-delete');

      // Verify the final DELETE on branches table was called
      const calls = vi.mocked(db.query).mock.calls;
      const deleteCall = calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('DELETE') &&
          call[0].includes('app.branches'),
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall?.[1]).toContain('branch-to-delete');
    });
  });

  describe('Error Classes', () => {
    it('DuplicateBranchNameError should be an instance of Error', async () => {
      const { DuplicateBranchNameError } = await import('../../src/services/branch-service');

      const error = new DuplicateBranchNameError('site-123', 'feature-x');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('DuplicateBranchNameError');
      expect(error.siteId).toBe('site-123');
      expect(error.branchName).toBe('feature-x');
    });

    it('InvalidBranchParamsError should be an instance of Error', async () => {
      const { InvalidBranchParamsError } = await import('../../src/services/branch-service');

      const error = new InvalidBranchParamsError('name is required');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('InvalidBranchParamsError');
      expect(error.message).toContain('name is required');
    });

    it('SiteNotFoundError should be an instance of Error', async () => {
      const { SiteNotFoundError } = await import('../../src/services/branch-service');

      const error = new SiteNotFoundError('site-123');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('SiteNotFoundError');
      expect(error.siteId).toBe('site-123');
    });

    it('MainBranchProtectionError should be an instance of Error', async () => {
      const { MainBranchProtectionError } = await import('../../src/services/branch-service');

      const error = new MainBranchProtectionError('delete');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('MainBranchProtectionError');
      expect(error.operation).toBe('delete');
      expect(error.message).toContain('main branch');
    });

    it('InvalidBranchStatusTransitionError should be an instance of Error', async () => {
      const { InvalidBranchStatusTransitionError } = await import('../../src/services/branch-service');

      const error = new InvalidBranchStatusTransitionError('merged', 'active');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('InvalidBranchStatusTransitionError');
      expect(error.fromStatus).toBe('merged');
      expect(error.toStatus).toBe('active');
      expect(error.message).toContain('merged');
      expect(error.message).toContain('active');
    });

    it('BranchNotFoundError should be an instance of Error', async () => {
      const { BranchNotFoundError } = await import('../../src/services/branch-service');

      const error = new BranchNotFoundError('branch-123');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('BranchNotFoundError');
      expect(error.branchId).toBe('branch-123');
    });
  });

  describe('Status Transition Rules', () => {
    it('should allow active → review', async () => {
      const { isValidStatusTransition } = await import('../../src/services/branch-service');
      expect(isValidStatusTransition('active', 'review')).toBe(true);
    });

    it('should allow active → archived', async () => {
      const { isValidStatusTransition } = await import('../../src/services/branch-service');
      expect(isValidStatusTransition('active', 'archived')).toBe(true);
    });

    it('should allow review → merged', async () => {
      const { isValidStatusTransition } = await import('../../src/services/branch-service');
      expect(isValidStatusTransition('review', 'merged')).toBe(true);
    });

    it('should allow review → active (back to development)', async () => {
      const { isValidStatusTransition } = await import('../../src/services/branch-service');
      expect(isValidStatusTransition('review', 'active')).toBe(true);
    });

    it('should disallow merged → active', async () => {
      const { isValidStatusTransition } = await import('../../src/services/branch-service');
      expect(isValidStatusTransition('merged', 'active')).toBe(false);
    });

    it('should disallow merged → review', async () => {
      const { isValidStatusTransition } = await import('../../src/services/branch-service');
      expect(isValidStatusTransition('merged', 'review')).toBe(false);
    });

    it('should disallow archived → active', async () => {
      const { isValidStatusTransition } = await import('../../src/services/branch-service');
      expect(isValidStatusTransition('archived', 'active')).toBe(false);
    });

    it('should disallow archived → merged', async () => {
      const { isValidStatusTransition } = await import('../../src/services/branch-service');
      expect(isValidStatusTransition('archived', 'merged')).toBe(false);
    });

    it('should allow same status (no-op)', async () => {
      const { isValidStatusTransition } = await import('../../src/services/branch-service');
      expect(isValidStatusTransition('active', 'active')).toBe(true);
      expect(isValidStatusTransition('review', 'review')).toBe(true);
      expect(isValidStatusTransition('merged', 'merged')).toBe(true);
      expect(isValidStatusTransition('archived', 'archived')).toBe(true);
    });
  });

  describe('Document Version Inheritance on Branch Creation', () => {
    /**
     * Helper to set up mocks for createBranch with transaction and version copying.
     * The function uses BEGIN/COMMIT with structure, metadata, AND document version copy.
     */
    function setupCreateBranchWithVersionsMocks(
      db: { query: ReturnType<typeof vi.fn> },
      branchRow: MockBranchRow,
      fromCheckpoint = false,
    ): void {
      if (fromCheckpoint) {
        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [branchRow] }) // INSERT branch
          .mockResolvedValueOnce({ rows: [] }) // structure copy from checkpoint
          .mockResolvedValueOnce({ rows: [] }) // metadata copy from checkpoint
          .mockResolvedValueOnce({ rows: [] }) // document version copy from checkpoint
          .mockResolvedValueOnce({ rows: [] }); // COMMIT
      } else {
        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [branchRow] }) // INSERT branch
          .mockResolvedValueOnce({ rows: [] }) // structure copy from branch
          .mockResolvedValueOnce({ rows: [] }) // metadata copy from branch
          .mockResolvedValueOnce({ rows: [] }) // document version copy from branch
          .mockResolvedValueOnce({ rows: [] }); // COMMIT
      }
    }

    it('should copy document versions from source branch when creating a new branch', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow({
        id: 'new-branch-uuid',
        source_branch_id: 'main-branch-uuid',
      });
      setupCreateBranchWithVersionsMocks(db, mockRow, false);

      const result = await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('new-branch-uuid');

      // Verify document_versions INSERT was called (5th query in sequence)
      const calls = vi.mocked(db.query).mock.calls;
      const versionCopyCall = calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO app.document_versions') &&
          call[0].includes('FROM app.document_versions'),
      );
      expect(versionCopyCall).toBeDefined();

      // Check the query contains the correct column selection
      if (versionCopyCall) {
        expect(versionCopyCall[0]).toContain('DISTINCT ON (dv.document_id)');
        // The SELECT uses 'branch' as a literal for the source column
        expect(versionCopyCall[0]).toContain("'branch'");
      }
    });

    it('should copy document versions from checkpoint when creating branch from checkpoint', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow({
        id: 'new-branch-uuid',
        source_branch_id: 'main-branch-uuid',
        source_checkpoint_id: 'checkpoint-uuid-123',
      });
      setupCreateBranchWithVersionsMocks(db, mockRow, true);

      const result = await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-from-checkpoint',
        sourceBranchId: 'main-branch-uuid',
        sourceCheckpointId: 'checkpoint-uuid-123',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(result).toBeDefined();
      expect(result.sourceCheckpointId).toBe('checkpoint-uuid-123');

      // Verify checkpoint_documents copy was called
      const calls = vi.mocked(db.query).mock.calls;
      const versionCopyCall = calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO app.document_versions') &&
          call[0].includes('FROM app.checkpoint_documents'),
      );
      expect(versionCopyCall).toBeDefined();
    });

    it('should set version_number to 1 for copied document versions', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow({
        id: 'new-branch-uuid',
        source_branch_id: 'main-branch-uuid',
      });
      setupCreateBranchWithVersionsMocks(db, mockRow, false);

      await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      const calls = vi.mocked(db.query).mock.calls;
      const versionCopyCall = calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO app.document_versions') &&
          call[0].includes('FROM app.document_versions'),
      );

      // Verify the query sets version_number to 1 for the new branch
      if (versionCopyCall) {
        expect(versionCopyCall[0]).toMatch(/SELECT.*\$1.*1.*FROM/s);
      }
    });

    it('should set source to branch for copied document versions', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow({
        id: 'new-branch-uuid',
        source_branch_id: 'main-branch-uuid',
      });
      setupCreateBranchWithVersionsMocks(db, mockRow, false);

      await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      const calls = vi.mocked(db.query).mock.calls;
      const versionCopyCall = calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO app.document_versions') &&
          call[0].includes('FROM app.document_versions'),
      );

      // Verify the query sets source to 'branch'
      if (versionCopyCall) {
        expect(versionCopyCall[0]).toContain("'branch'");
      }
    });

    it('should copy only the latest version of each document', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow({
        id: 'new-branch-uuid',
        source_branch_id: 'main-branch-uuid',
      });
      setupCreateBranchWithVersionsMocks(db, mockRow, false);

      await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      const calls = vi.mocked(db.query).mock.calls;
      const versionCopyCall = calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO app.document_versions') &&
          call[0].includes('FROM app.document_versions'),
      );

      // Verify the query uses DISTINCT ON to get only one version per document
      // and orders by version_number DESC to get the latest
      if (versionCopyCall) {
        expect(versionCopyCall[0]).toContain('DISTINCT ON (dv.document_id)');
        expect(versionCopyCall[0]).toContain('ORDER BY dv.document_id, dv.version_number DESC');
      }
    });

    it('should preserve created_by_id and created_by_type from branch creation params', async () => {
      const { createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const mockRow = createMockBranchRow({
        id: 'new-branch-uuid',
        source_branch_id: 'main-branch-uuid',
        created_by_id: 'agent-uuid-999',
        created_by_type: 'agent',
      });
      setupCreateBranchWithVersionsMocks(db, mockRow, false);

      await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'agent-uuid-999',
        createdByType: 'agent',
      });

      const calls = vi.mocked(db.query).mock.calls;
      const versionCopyCall = calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO app.document_versions') &&
          call[0].includes('FROM app.document_versions'),
      );

      // Verify the parameters include the createdById and createdByType
      if (versionCopyCall && Array.isArray(versionCopyCall[1])) {
        expect(versionCopyCall[1]).toContain('agent-uuid-999');
        expect(versionCopyCall[1]).toContain('agent');
      }
    });
  });
});
