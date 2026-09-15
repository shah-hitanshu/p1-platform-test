/**
 * Phase 3.2: Branch Service Tests (TDD)
 *
 * Tests for Branch CRUD operations and status management.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { branches, checkpoints, sites } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import {
  archiveBranch,
  clearBranchCache,
  createBranch,
  createMainBranch,
  deleteBranch,
  getBranch,
  getBranchByName,
  getMainBranch,
  isValidStatusTransition,
  listBranches,
  restoreBranch,
  updateBranch,
  updateBranchStatus,
} from '../../src/services/branch-service';
import {
  BranchNotFoundError,
  DuplicateBranchNameError,
  InvalidBranchParamsError,
  InvalidBranchStatusTransitionError,
  MainBranchOnlyError,
  MainBranchProtectionError,
  SiteNotFoundError,
} from '../../src/services/errors';

/**
 * The structure copy is an INSERT ... SELECT, so it is keyed by the table it
 * writes; the relation it reads is what tells its two sources apart.
 */
const STRUCTURE_STATE = 'branch_structure_state';

describe('Phase 3.2: Branch Service', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
    // Branch resolution is memoized per isolate (PCC-3712); the module-scope
    // cache must be emptied so tests don't serve each other's rows.
    clearBranchCache();
  });

  /** A branch row in the schema's property names. */
  function branchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'branch-uuid-123',
      siteId: 'site-uuid-456',
      name: 'feature-branch',
      description: 'A test feature branch',
      status: 'active',
      isMain: false,
      sourceBranchId: 'main-branch-uuid',
      sourceCheckpointId: null,
      createdById: 'user-uuid-789',
      createdByType: 'user',
      createdAt: '2026-01-23T10:00:00.000Z',
      updatedAt: '2026-01-23T10:00:00.000Z',
      archivedAt: null,
      ...overrides,
    };
  }

  function mainBranchRow(siteId = 'site-uuid-456'): Record<string, unknown> {
    return branchRow({
      id: 'main-branch-uuid',
      siteId,
      name: 'main',
      description: 'Main branch',
      isMain: true,
      sourceBranchId: null,
      sourceCheckpointId: null,
    });
  }

  /** A driver error carrying a SQLSTATE, as the stub will wrap it. */
  function driverError(code: string): Error {
    const error = new Error('constraint violation') as NodeJS.ErrnoException;
    error.code = code;
    return error;
  }

  /**
   * The reads and writes every branch creation makes: the source-branch check,
   * the insert, the checkpoint lookup and the checkpoint write-back.
   */
  function stubBranchCreation(row: Record<string, unknown>): void {
    database.on(branches).select.returns([{ id: row.sourceBranchId, isMain: true }]);
    database.on(branches).insert.returns([row]);
    database.on(branches).update.returns([row]);
    database.on(checkpoints).select.returns([{ id: 'latest-checkpoint' }]);
  }

  describe('createBranch', () => {
    it('should create a branch from a source branch', async () => {
      stubBranchCreation(branchRow());

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
      stubBranchCreation(branchRow({ sourceCheckpointId: 'checkpoint-uuid-123' }));

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
      database.on(branches).select.returns([{ id: 'main-branch-uuid', isMain: true }]);
      database.on(branches).insert.rejects(driverError('23505'));

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
      database.on(branches).select.returns([{ id: 'main-branch-uuid', isMain: true }]);
      database.on(branches).insert.rejects(driverError('23503'));

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
      stubBranchCreation(branchRow({ status: 'active' }));

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
      stubBranchCreation(branchRow());

      await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      const [insert] = database.calls(branches).insert;
      expect(insert?.params).toEqual(
        expect.arrayContaining(['site-uuid-456', 'feature-branch']),
      );
    });

    it('should create agent-created branches', async () => {
      stubBranchCreation(branchRow({ createdById: 'agent-uuid-123', createdByType: 'agent' }));

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
      database.on(branches).insert.returns([mainBranchRow('site-uuid-456')]);

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
      database.on(branches).insert.rejects(driverError('23505'));

      await expect(
        createMainBranch({
          siteId: 'site-uuid-456',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        }),
      ).rejects.toThrow(DuplicateBranchNameError);
    });

    it('should throw SiteNotFoundError when site does not exist', async () => {
      database.on(branches).insert.rejects(driverError('23503'));

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
      database.on(branches).select.returns([branchRow({ id: 'branch-123' })]);

      const result = await getBranch('branch-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('branch-123');
      expect(result?.name).toBe('feature-branch');
      expect(result?.status).toBe('active');
    });

    it('should return null when branch not found', async () => {
      const result = await getBranch('non-existent-id');

      expect(result).toBeNull();
    });

    it('should map all branch fields correctly', async () => {
      database.on(branches).select.returns([
        branchRow({
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
        }),
      ]);

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
      await getBranch('branch-uuid-456');

      const [call] = database.calls(branches).select;
      expect(call?.sql).toContain('"id"');
      expect(call?.params).toEqual(expect.arrayContaining(['branch-uuid-456']));
    });
  });

  describe('getBranchByName', () => {
    it('should return branch when found by name in site', async () => {
      database.on(branches).select.returns([branchRow({ name: 'my-feature' })]);

      const result = await getBranchByName('site-uuid-456', 'my-feature');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('my-feature');
    });

    it('should return null when branch name not found in site', async () => {
      const result = await getBranchByName('site-uuid-456', 'non-existent');

      expect(result).toBeNull();
    });

    it('should query by site_id and name', async () => {
      await getBranchByName('site-456', 'feature-x');

      const [call] = database.calls(branches).select;
      expect(call?.sql).toMatch(/site_id.*name|name.*site_id/);
      expect(call?.params).toEqual(expect.arrayContaining(['site-456', 'feature-x']));
    });
  });

  describe('getMainBranch', () => {
    it('should return main branch for site', async () => {
      database.on(branches).select.returns([mainBranchRow('site-uuid-456')]);

      const result = await getMainBranch('site-uuid-456');

      expect(result).not.toBeNull();
      expect(result?.isMain).toBe(true);
      expect(result?.name).toBe('main');
    });

    it('should return null when site has no main branch', async () => {
      const result = await getMainBranch('site-without-main');

      expect(result).toBeNull();
    });

    it('should query by site_id and is_main', async () => {
      await getMainBranch('site-456');

      const [call] = database.calls(branches).select;
      expect(call?.sql).toContain('"is_main"');
      expect(call?.params).toEqual(expect.arrayContaining(['site-456', true]));
    });
  });

  describe('listBranches', () => {
    it('should return all branches for a site', async () => {
      database.on(branches).select.returns([
        mainBranchRow('site-uuid-456'),
        branchRow({ id: 'branch-1', name: 'feature-1' }),
        branchRow({ id: 'branch-2', name: 'feature-2' }),
      ]);

      const result = await listBranches('site-uuid-456');

      expect(result).toHaveLength(3);
    });

    it('should filter branches by status', async () => {
      await listBranches('site-uuid-456', { status: 'active' });

      const [call] = database.calls(branches).select;
      expect(call?.sql).toContain('"status"');
      expect(call?.params).toEqual(expect.arrayContaining(['site-uuid-456', 'active']));
    });

    it('should support limit option', async () => {
      await listBranches('site-uuid-456', { limit: 5 });

      const [call] = database.calls(branches).select;
      expect(call?.sql).toMatch(/limit/i);
      expect(call?.params).toEqual(expect.arrayContaining([5]));
    });

    it('should support offset option', async () => {
      await listBranches('site-uuid-456', { offset: 10 });

      const [call] = database.calls(branches).select;
      expect(call?.sql).toMatch(/offset/i);
      expect(call?.params).toEqual(expect.arrayContaining([10]));
    });

    it('should return empty array when no branches exist', async () => {
      const result = await listBranches('site-uuid-456');

      expect(result).toEqual([]);
    });

    it('should order branches by created_at descending', async () => {
      await listBranches('site-uuid-456');

      const [call] = database.calls(branches).select;
      expect(call?.sql).toMatch(/order by.*created_at.*desc/i);
    });
  });

  describe('updateBranch', () => {
    it('should update branch name', async () => {
      database.on(branches).update.returns([
        branchRow({ id: 'branch-123', name: 'renamed-branch', updatedAt: '2026-01-23T14:00:00.000Z' }),
      ]);

      const result = await updateBranch('branch-123', { name: 'renamed-branch' });

      expect(result).not.toBeNull();
      expect(result?.name).toBe('renamed-branch');
    });

    it('should update branch description', async () => {
      database.on(branches).update.returns([
        branchRow({ id: 'branch-123', description: 'Updated description' }),
      ]);

      const result = await updateBranch('branch-123', { description: 'Updated description' });

      expect(result?.description).toBe('Updated description');
    });

    it('should update both name and description in single call', async () => {
      database.on(branches).update.returns([
        branchRow({ id: 'branch-123', name: 'new-name', description: 'New description' }),
      ]);

      const result = await updateBranch('branch-123', {
        name: 'new-name',
        description: 'New description',
      });

      expect(result?.name).toBe('new-name');
      expect(result?.description).toBe('New description');
    });

    it('should update updatedAt timestamp', async () => {
      const originalTime = '2026-01-23T10:00:00.000Z';
      const updatedTime = '2026-01-23T14:00:00.000Z';
      database.on(branches).update.returns([
        branchRow({ id: 'branch-123', createdAt: originalTime, updatedAt: updatedTime }),
      ]);

      const result = await updateBranch('branch-123', { name: 'new-name' });

      expect(result?.updatedAt).toBe(updatedTime);
      expect(result?.createdAt).toBe(originalTime);
    });

    it('should return null when branch not found', async () => {
      const result = await updateBranch('non-existent', { name: 'new-name' });

      expect(result).toBeNull();
    });

    it('should throw DuplicateBranchNameError for duplicate name in same site', async () => {
      database.on(branches).update.rejects(driverError('23505'));

      await expect(
        updateBranch('branch-123', { name: 'existing-name' }),
      ).rejects.toThrow(DuplicateBranchNameError);
    });

    it('should throw InvalidBranchParamsError for empty name', async () => {
      await expect(
        updateBranch('branch-123', { name: '' }),
      ).rejects.toThrow(InvalidBranchParamsError);
    });

    it('should not throw for empty description (clearing description)', async () => {
      database.on(branches).update.returns([branchRow({ id: 'branch-123', description: null })]);

      const result = await updateBranch('branch-123', { description: '' });

      expect(result?.description).toBeUndefined();
    });
  });

  describe('updateBranchStatus', () => {
    it('should update status from active to review', async () => {
      database.on(branches).select.returns([branchRow({ id: 'branch-123', status: 'active' })]);
      database.on(branches).update.returns([branchRow({ id: 'branch-123', status: 'review' })]);

      const result = await updateBranchStatus('branch-123', 'review');

      expect(result?.status).toBe('review');
    });

    it('should update status from review to merged', async () => {
      database.on(branches).select.returns([branchRow({ id: 'branch-123', status: 'review' })]);
      database.on(branches).update.returns([branchRow({ id: 'branch-123', status: 'merged' })]);

      const result = await updateBranchStatus('branch-123', 'merged');

      expect(result?.status).toBe('merged');
    });

    it('should update status from active to archived', async () => {
      database.on(branches).select.returns([branchRow({ id: 'branch-123', status: 'active' })]);
      database.on(branches).update.returns([branchRow({ id: 'branch-123', status: 'archived' })]);

      const result = await updateBranchStatus('branch-123', 'archived');

      expect(result?.status).toBe('archived');
    });

    it('should throw InvalidBranchStatusTransitionError for invalid transition', async () => {
      // Branch is already merged, cannot go back to active
      database.on(branches).select.returns([branchRow({ id: 'branch-123', status: 'merged' })]);

      await expect(
        updateBranchStatus('branch-123', 'active'),
      ).rejects.toThrow(InvalidBranchStatusTransitionError);
    });

    it('should throw InvalidBranchStatusTransitionError when transitioning archived to active', async () => {
      database.on(branches).select.returns([branchRow({ id: 'branch-123', status: 'archived' })]);

      await expect(
        updateBranchStatus('branch-123', 'active'),
      ).rejects.toThrow(InvalidBranchStatusTransitionError);
    });

    it('should throw MainBranchProtectionError when archiving main branch', async () => {
      database.on(branches).select.returns([mainBranchRow('site-uuid-456')]);

      await expect(
        updateBranchStatus('main-branch-uuid', 'archived'),
      ).rejects.toThrow(MainBranchProtectionError);
    });

    it('should return null when branch not found', async () => {
      const result = await updateBranchStatus('non-existent', 'review');

      expect(result).toBeNull();
    });
  });

  describe('deleteBranch', () => {
    it('should delete branch and related data when found', async () => {
      database.on(branches).select.returns([branchRow({ id: 'branch-123', isMain: false })]);
      database.on(branches).delete.returns([{ id: 'branch-123' }]);

      const result = await deleteBranch('branch-123');

      expect(result).toBe(true);
    });

    it('should return false when branch not found', async () => {
      const result = await deleteBranch('non-existent');

      expect(result).toBe(false);
    });

    it('should throw MainBranchProtectionError when deleting main branch', async () => {
      database.on(branches).select.returns([mainBranchRow('site-uuid-456')]);

      await expect(deleteBranch('main-branch-uuid')).rejects.toThrow(MainBranchProtectionError);
    });

    it('should cascade delete related data before deleting branch', async () => {
      database.on(branches).select.returns([branchRow({ id: 'branch-to-delete', isMain: false })]);
      database.on(branches).delete.returns([{ id: 'branch-to-delete' }]);

      await deleteBranch('branch-to-delete');

      // Everything that references the branch goes first, the branch itself last.
      const deleted = database.statements
        .filter((statement) => statement.sql.startsWith('delete from'))
        .map((statement) => statement.sql);
      expect(deleted[deleted.length - 1]).toContain('"app"."branches"');
      expect(deleted).toEqual(
        expect.arrayContaining([
          expect.stringContaining('"app"."merge_requests"'),
          expect.stringContaining('"app"."branch_document_metadata"'),
          expect.stringContaining('"app"."branch_structure_state"'),
          expect.stringContaining('"app"."checkpoints"'),
          expect.stringContaining('"app"."document_versions"'),
        ]),
      );
      const [branchDelete] = database.calls(branches).delete;
      expect(branchDelete?.params).toContain('branch-to-delete');
    });
  });

  // ===========================================================================
  // PCC-3211: Soft delete — archiveBranch / restoreBranch / listBranches(archived)
  // ===========================================================================

  describe('archiveBranch', () => {
    it('should set archived_at on a non-main branch', async () => {
      database.on(branches).select.returns([branchRow({ id: 'branch-123', isMain: false })]);
      database.on(branches).update.returns([{ id: 'branch-123' }]);

      const result = await archiveBranch('branch-123');

      expect(result).toBe(true);
    });

    it('should return false when branch not found', async () => {
      const result = await archiveBranch('non-existent');

      expect(result).toBe(false);
    });

    it('should throw MainBranchProtectionError for main branch', async () => {
      database.on(branches).select.returns([mainBranchRow('site-uuid-456')]);

      await expect(archiveBranch('main-branch-uuid')).rejects.toThrow(MainBranchProtectionError);
    });

    it('should return already_archived when branch exists but is already archived', async () => {
      database.on(branches).select.returns([
        branchRow({ id: 'branch-123', isMain: false, archivedAt: '2026-05-01T00:00:00.000Z' }),
      ]);

      const result = await archiveBranch('branch-123');

      expect(result).toBe('already_archived');
    });
  });

  describe('restoreBranch', () => {
    const archiveTs = '2026-05-17T10:00:00.000Z';

    it('should clear archived_at and return the restored branch', async () => {
      database.on(branches).select.returns([
        branchRow({ id: 'branch-123', isMain: false, archivedAt: archiveTs }),
      ]);
      database.on(sites).select.returns([{ archivedAt: null }]);
      database.on(branches).update.returns([branchRow({ id: 'branch-123', isMain: false })]);

      const result = await restoreBranch('branch-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('branch-123');
    });

    it('should return null when branch not found', async () => {
      const result = await restoreBranch('non-existent');

      expect(result).toBeNull();
    });

    it('should return null when branch is not archived', async () => {
      database.on(branches).select.returns([branchRow({ id: 'branch-123', isMain: false })]);

      const result = await restoreBranch('branch-123');

      expect(result).toBeNull();
    });

    it('should return null when parent site is archived', async () => {
      database.on(branches).select.returns([
        branchRow({ id: 'branch-123', isMain: false, archivedAt: archiveTs }),
      ]);
      database.on(sites).select.returns([{ archivedAt: archiveTs }]);

      const result = await restoreBranch('branch-123');

      expect(result).toBeNull();
    });
  });

  describe('listBranches — archived filter (PCC-3211)', () => {
    it('should exclude archived branches by default', async () => {
      await listBranches('site-123');

      const [call] = database.calls(branches).select;
      expect(call?.sql).toContain('"archived_at" is null');
    });

    it('should return only archived branches when archived=true', async () => {
      await listBranches('site-123', { archived: true });

      const [call] = database.calls(branches).select;
      expect(call?.sql).toContain('"archived_at" is not null');
    });
  });

  describe('Error Classes', () => {
    it('DuplicateBranchNameError should be an instance of Error', () => {
      const error = new DuplicateBranchNameError('site-123', 'feature-x');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('DuplicateBranchNameError');
      expect(error.siteId).toBe('site-123');
      expect(error.branchName).toBe('feature-x');
    });

    it('InvalidBranchParamsError should be an instance of Error', () => {
      const error = new InvalidBranchParamsError('name is required');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('InvalidBranchParamsError');
      expect(error.message).toContain('name is required');
    });

    it('SiteNotFoundError should be an instance of Error', () => {
      const error = new SiteNotFoundError('site-123');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('SiteNotFoundError');
      expect(error.siteId).toBe('site-123');
    });

    it('MainBranchProtectionError should be an instance of Error', () => {
      const error = new MainBranchProtectionError('delete');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('MainBranchProtectionError');
      expect(error.operation).toBe('delete');
      expect(error.message).toContain('main branch');
    });

    it('InvalidBranchStatusTransitionError should be an instance of Error', () => {
      const error = new InvalidBranchStatusTransitionError('merged', 'active');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('InvalidBranchStatusTransitionError');
      expect(error.fromStatus).toBe('merged');
      expect(error.toStatus).toBe('active');
      expect(error.message).toContain('merged');
      expect(error.message).toContain('active');
    });

    it('BranchNotFoundError should be an instance of Error', () => {
      const error = new BranchNotFoundError('branch-123');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('BranchNotFoundError');
      expect(error.branchId).toBe('branch-123');
    });
  });

  describe('Status Transition Rules', () => {
    it('should allow active → review', () => {
      expect(isValidStatusTransition('active', 'review')).toBe(true);
    });

    it('should allow active → archived', () => {
      expect(isValidStatusTransition('active', 'archived')).toBe(true);
    });

    it('should allow review → merged', () => {
      expect(isValidStatusTransition('review', 'merged')).toBe(true);
    });

    it('should allow review → active (back to development)', () => {
      expect(isValidStatusTransition('review', 'active')).toBe(true);
    });

    it('should disallow merged → active', () => {
      expect(isValidStatusTransition('merged', 'active')).toBe(false);
    });

    it('should disallow merged → review', () => {
      expect(isValidStatusTransition('merged', 'review')).toBe(false);
    });

    it('should disallow archived → active', () => {
      expect(isValidStatusTransition('archived', 'active')).toBe(false);
    });

    it('should disallow archived → merged', () => {
      expect(isValidStatusTransition('archived', 'merged')).toBe(false);
    });

    it('should allow same status (no-op)', () => {
      expect(isValidStatusTransition('active', 'active')).toBe(true);
      expect(isValidStatusTransition('review', 'review')).toBe(true);
      expect(isValidStatusTransition('merged', 'merged')).toBe(true);
      expect(isValidStatusTransition('archived', 'archived')).toBe(true);
    });
  });

  describe('Main-Only Branch Creation Validation', () => {
    it('should throw MainBranchOnlyError when source branch is not main', async () => {
      database.on(branches).select.returns([{ id: 'feature-branch-uuid', isMain: false }]);

      await expect(
        createBranch({
          siteId: 'site-uuid-456',
          name: 'new-feature',
          sourceBranchId: 'feature-branch-uuid',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        }),
      ).rejects.toThrow(MainBranchOnlyError);
    });

    it('should allow creating branch when source is main', async () => {
      stubBranchCreation(branchRow({ id: 'new-branch-uuid' }));

      const result = await createBranch({
        siteId: 'site-uuid-456',
        name: 'new-feature',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('new-branch-uuid');
    });

    it('should throw MainBranchOnlyError with correct properties', () => {
      const error = new MainBranchOnlyError('some-branch-id');

      expect(error.name).toBe('MainBranchOnlyError');
      expect(error.sourceBranchId).toBe('some-branch-id');
      expect(error.message).toContain('main');
      expect(error).toBeInstanceOf(Error);
    });

    it('should throw MainBranchOnlyError when source branch does not exist', async () => {
      await expect(
        createBranch({
          siteId: 'site-uuid-456',
          name: 'new-feature',
          sourceBranchId: 'nonexistent-branch',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        }),
      ).rejects.toThrow(MainBranchOnlyError);
    });
  });

  describe('Copy-on-Write Branch Creation', () => {
    it('should NOT copy document versions when creating a branch', async () => {
      stubBranchCreation(branchRow({ id: 'new-branch-uuid' }));

      await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(database.calls('document_versions').insert).toHaveLength(0);
    });

    it('should NOT copy branch document metadata when creating a branch', async () => {
      stubBranchCreation(branchRow({ id: 'new-branch-uuid' }));

      await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(database.calls('branch_document_metadata').insert).toHaveLength(0);
    });

    it('should still copy branch structure state when creating a branch', async () => {
      stubBranchCreation(branchRow({ id: 'new-branch-uuid' }));

      await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(database.calls(STRUCTURE_STATE).insert).toHaveLength(1);
    });

    it('should use provided sourceCheckpointId without querying for latest', async () => {
      stubBranchCreation(
        branchRow({ id: 'new-branch-uuid', sourceCheckpointId: 'explicit-checkpoint-id' }),
      );

      const result = await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        sourceBranchId: 'main-branch-uuid',
        sourceCheckpointId: 'explicit-checkpoint-id',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(result.sourceCheckpointId).toBe('explicit-checkpoint-id');
      expect(database.calls(checkpoints).select).toHaveLength(0);
    });

    it('should auto-resolve source_checkpoint_id from latest checkpoint when not provided', async () => {
      const created = branchRow({ id: 'new-branch-uuid' });
      database.on(branches).select.returns([{ id: 'main-branch-uuid', isMain: true }]);
      database.on(branches).insert.returns([created]);
      database.on(checkpoints).select.returns([{ id: 'auto-resolved-checkpoint' }]);
      database.on(branches).update.returns([
        { ...created, sourceCheckpointId: 'auto-resolved-checkpoint' },
      ]);

      const result = await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(result.sourceCheckpointId).toBe('auto-resolved-checkpoint');
      const [update] = database.calls(branches).update;
      expect(update?.sql).toContain('"source_checkpoint_id"');
      expect(update?.params).toContain('auto-resolved-checkpoint');
    });

    it('should return valid branch object with copy-on-write creation', async () => {
      stubBranchCreation(branchRow({ id: 'cow-branch-uuid', name: 'cow-feature' }));

      const result = await createBranch({
        siteId: 'site-uuid-456',
        name: 'cow-feature',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(result.id).toBe('cow-branch-uuid');
      expect(result.name).toBe('cow-feature');
      expect(result.status).toBe('active');
      expect(result.isMain).toBe(false);
      expect(result.sourceBranchId).toBe('main-branch-uuid');
    });
  });

  describe('Document Version Inheritance on Branch Creation (Copy-on-Write)', () => {
    it('should NOT copy document versions from source branch (copy-on-write)', async () => {
      stubBranchCreation(branchRow({ id: 'new-branch-uuid' }));

      await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-branch',
        sourceBranchId: 'main-branch-uuid',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(database.calls('document_versions').insert).toHaveLength(0);
    });

    it('should NOT copy document versions from checkpoint (copy-on-write)', async () => {
      stubBranchCreation(
        branchRow({ id: 'new-branch-uuid', sourceCheckpointId: 'checkpoint-uuid-123' }),
      );

      await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature-from-checkpoint',
        sourceBranchId: 'main-branch-uuid',
        sourceCheckpointId: 'checkpoint-uuid-123',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      expect(database.calls('document_versions').insert).toHaveLength(0);
    });
  });
});
