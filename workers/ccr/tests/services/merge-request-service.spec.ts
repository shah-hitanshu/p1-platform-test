/**
 * Phase 5.1a: Merge Request Service Tests
 *
 * Tests for Merge Request CRUD operations and status management.
 * Based on collaborative-state-system-architecture-v2.2.md
 */

import { describe, it, expect } from 'vitest';
import { stubDatabase } from '../__stubs__/database';
import { branches, mergeRequests } from '../../src/db/schema';
import {
  claimMergeRequestForExecution,
  createMergeRequest,
  deleteMergeRequest,
  getMergeRequest,
  isValidStatusTransition,
  listMergeRequests,
  restoreMergeRequestClaim,
  updateMergeRequest,
  updateMergeRequestConflicts,
  updateMergeRequestStatus,
} from '../../src/services/merge-request-service';
import {
  CannotDeleteMergedRequestError,
  InvalidMergeRequestParamsError,
  InvalidMergeRequestStatusTransitionError,
  MergeRequestNotFoundError,
  SourceBranchNotFoundError,
  TargetBranchNotFoundError,
  TargetBranchNotMainError,
} from '../../src/services/errors';

describe('Phase 5.1a: Merge Request Service', () => {
  type MergeRequestRow = typeof mergeRequests.$inferSelect;

  function mergeRequestRow(overrides: Partial<MergeRequestRow> = {}): MergeRequestRow {
    return {
      id: 'mr-uuid-123',
      siteId: 'site-uuid-456',
      sourceBranchId: 'feature-branch-uuid',
      targetBranchId: 'main-branch-uuid',
      baseCheckpointId: 'checkpoint-uuid-789',
      title: 'Add new feature',
      description: 'This PR adds a new feature',
      status: 'open',
      hasConflicts: false,
      conflictDetails: null,
      createdById: 'user-uuid-abc',
      createdByType: 'user',
      createdAt: new Date('2026-01-24T10:00:00.000Z'),
      updatedAt: new Date('2026-01-24T10:00:00.000Z'),
      mergedAt: null,
      mergedById: null,
      mergedByType: null,
      closedAt: null,
      closedById: null,
      closedByType: null,
      ...overrides,
    };
  }

  describe('createMergeRequest', () => {
    it('should create a merge request between two branches', async () => {
      const { on } = stubDatabase();
      on(branches).select.returns([{ id: 'main-branch-uuid', isMain: true }]);
      on(mergeRequests).insert.returns([mergeRequestRow()]);

      const result = await createMergeRequest({
        siteId: 'site-uuid-456',
        sourceBranchId: 'feature-branch-uuid',
        targetBranchId: 'main-branch-uuid',
        title: 'Add new feature',
        description: 'This PR adds a new feature',
        createdById: 'user-uuid-abc',
        createdByType: 'user',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('mr-uuid-123');
      expect(result.siteId).toBe('site-uuid-456');
      expect(result.sourceBranchId).toBe('feature-branch-uuid');
      expect(result.targetBranchId).toBe('main-branch-uuid');
      expect(result.title).toBe('Add new feature');
      expect(result.description).toBe('This PR adds a new feature');
      expect(result.status).toBe('open');
      expect(result.hasConflicts).toBe(false);
      expect(result.createdById).toBe('user-uuid-abc');
      expect(result.createdByType).toBe('user');
    });

    it('should create a merge request without description', async () => {
      const { on, calls } = stubDatabase();
      on(branches).select.returns([{ id: 'main-branch-uuid', isMain: true }]);
      on(mergeRequests).insert.returns([mergeRequestRow({ description: null })]);

      const result = await createMergeRequest({
        siteId: 'site-uuid-456',
        sourceBranchId: 'feature-branch-uuid',
        targetBranchId: 'main-branch-uuid',
        title: 'Quick fix',
        createdById: 'user-uuid-abc',
        createdByType: 'user',
      });

      expect(result.description).toBeUndefined();
      expect(calls(mergeRequests).insert[0].params).toEqual([
        'site-uuid-456',
        'feature-branch-uuid',
        'main-branch-uuid',
        null,
        'Quick fix',
        null,
        'user-uuid-abc',
        'user',
      ]);
    });

    it('should create a merge request with base checkpoint', async () => {
      const { on, calls } = stubDatabase();
      on(branches).select.returns([{ id: 'main-branch-uuid', isMain: true }]);
      on(mergeRequests).insert.returns([mergeRequestRow()]);

      const result = await createMergeRequest({
        siteId: 'site-uuid-456',
        sourceBranchId: 'feature-branch-uuid',
        targetBranchId: 'main-branch-uuid',
        baseCheckpointId: 'checkpoint-uuid-789',
        title: 'Add new feature',
        createdById: 'user-uuid-abc',
        createdByType: 'user',
      });

      expect(result.baseCheckpointId).toBe('checkpoint-uuid-789');
      expect(calls(mergeRequests).insert[0].params).toContain('checkpoint-uuid-789');
    });

    it('should throw InvalidMergeRequestParamsError when title is empty', async () => {
      const { calls } = stubDatabase();

      await expect(
        createMergeRequest({
          siteId: 'site-uuid-456',
          sourceBranchId: 'feature-branch-uuid',
          targetBranchId: 'main-branch-uuid',
          title: '',
          createdById: 'user-uuid-abc',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidMergeRequestParamsError);

      expect(calls(mergeRequests).insert).toHaveLength(0);
    });

    it('should throw InvalidMergeRequestParamsError when title is only whitespace', async () => {
      const { calls } = stubDatabase();

      await expect(
        createMergeRequest({
          siteId: 'site-uuid-456',
          sourceBranchId: 'feature-branch-uuid',
          targetBranchId: 'main-branch-uuid',
          title: '   ',
          createdById: 'user-uuid-abc',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidMergeRequestParamsError);

      expect(calls(mergeRequests).insert).toHaveLength(0);
    });

    it('should throw InvalidMergeRequestParamsError when source and target are the same', async () => {
      const { calls } = stubDatabase();

      await expect(
        createMergeRequest({
          siteId: 'site-uuid-456',
          sourceBranchId: 'same-branch-uuid',
          targetBranchId: 'same-branch-uuid',
          title: 'Invalid merge',
          createdById: 'user-uuid-abc',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidMergeRequestParamsError);

      expect(calls(mergeRequests).insert).toHaveLength(0);
    });

    it('should throw SourceBranchNotFoundError when source branch does not exist', async () => {
      const { on } = stubDatabase();
      on(branches).select.returns([{ id: 'main-branch-uuid', isMain: true }]);
      on(mergeRequests).insert.rejects(
        Object.assign(new Error('fk'), {
          code: '23503',
          constraint: 'merge_requests_source_branch_id_fkey',
        }),
      );

      await expect(
        createMergeRequest({
          siteId: 'site-uuid-456',
          sourceBranchId: 'nonexistent-branch',
          targetBranchId: 'main-branch-uuid',
          title: 'Test',
          createdById: 'user-uuid-abc',
          createdByType: 'user',
        }),
      ).rejects.toThrow(SourceBranchNotFoundError);
    });

    it('should throw TargetBranchNotFoundError when the target branch foreign key is violated', async () => {
      const { on } = stubDatabase();
      on(branches).select.returns([{ id: 'main-branch-uuid', isMain: true }]);
      on(mergeRequests).insert.rejects(
        Object.assign(new Error('fk'), {
          code: '23503',
          constraint: 'merge_requests_target_branch_id_fkey',
        }),
      );

      await expect(
        createMergeRequest({
          siteId: 'site-uuid-456',
          sourceBranchId: 'feature-branch-uuid',
          targetBranchId: 'main-branch-uuid',
          title: 'Test',
          createdById: 'user-uuid-abc',
          createdByType: 'user',
        }),
      ).rejects.toThrow(TargetBranchNotFoundError);
    });

    it('should throw TargetBranchNotMainError when target branch does not exist', async () => {
      const { calls } = stubDatabase();

      await expect(
        createMergeRequest({
          siteId: 'site-uuid-456',
          sourceBranchId: 'feature-branch-uuid',
          targetBranchId: 'nonexistent-branch',
          title: 'Test',
          createdById: 'user-uuid-abc',
          createdByType: 'user',
        }),
      ).rejects.toThrow(TargetBranchNotMainError);

      expect(calls(mergeRequests).insert).toHaveLength(0);
    });

    it('should allow agent to create merge request', async () => {
      const { on } = stubDatabase();
      on(branches).select.returns([{ id: 'main-branch-uuid', isMain: true }]);
      on(mergeRequests).insert.returns([mergeRequestRow({ createdByType: 'agent' })]);

      const result = await createMergeRequest({
        siteId: 'site-uuid-456',
        sourceBranchId: 'feature-branch-uuid',
        targetBranchId: 'main-branch-uuid',
        title: 'Agent PR',
        createdById: 'agent-uuid-abc',
        createdByType: 'agent',
      });

      expect(result.createdByType).toBe('agent');
    });
  });

  describe('getMergeRequest', () => {
    it('should return merge request by ID', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).select.returns([mergeRequestRow()]);

      const result = await getMergeRequest('mr-uuid-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('mr-uuid-123');
      expect(result?.title).toBe('Add new feature');
      expect(calls(mergeRequests).select[0].params).toEqual(['mr-uuid-123']);
    });

    it('should return null when merge request not found', async () => {
      stubDatabase();

      const result = await getMergeRequest('nonexistent-uuid');

      expect(result).toBeNull();
    });

    it('should return merge request with conflict details', async () => {
      const { on } = stubDatabase();
      const conflictDetails = {
        documentConflicts: [
          {
            documentId: 'doc-uuid',
            documentPath: 'pages/home',
            conflictType: 'both-modified' as const,
            sourceVersion: 3,
            targetVersion: 2,
          },
        ],
        structureConflicts: [],
      };
      on(mergeRequests).select.returns([
        mergeRequestRow({ hasConflicts: true, conflictDetails, status: 'conflicted' }),
      ]);

      const result = await getMergeRequest('mr-uuid-123');

      expect(result?.hasConflicts).toBe(true);
      expect(result?.conflictDetails).toEqual(conflictDetails);
      expect(result?.status).toBe('conflicted');
    });

    it('should return merged merge request with merge metadata', async () => {
      const { on } = stubDatabase();
      on(mergeRequests).select.returns([
        mergeRequestRow({
          status: 'merged',
          mergedAt: new Date('2026-01-24T12:00:00.000Z'),
          mergedById: 'admin-uuid',
          mergedByType: 'user',
        }),
      ]);

      const result = await getMergeRequest('mr-uuid-123');

      expect(result?.status).toBe('merged');
      expect(result?.mergedAt).toEqual(new Date('2026-01-24T12:00:00.000Z'));
      expect(result?.mergedById).toBe('admin-uuid');
      expect(result?.mergedByType).toBe('user');
    });
  });

  describe('listMergeRequests', () => {
    it('should list all merge requests for a site', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).select.returns([
        mergeRequestRow({ id: 'mr-1', title: 'First PR' }),
        mergeRequestRow({ id: 'mr-2', title: 'Second PR' }),
      ]);

      const result = await listMergeRequests('site-uuid-456');

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('First PR');
      expect(result[1].title).toBe('Second PR');
      expect(calls(mergeRequests).select[0].params).toEqual(['site-uuid-456', 50]);
    });

    it('should filter merge requests by status', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).select.returns([mergeRequestRow({ status: 'open' })]);

      const result = await listMergeRequests('site-uuid-456', { status: 'open' });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('open');
      expect(calls(mergeRequests).select[0].sql).toContain('"status" =');
      expect(calls(mergeRequests).select[0].params).toContain('open');
    });

    it('should filter merge requests by source branch', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).select.returns([mergeRequestRow()]);

      const result = await listMergeRequests('site-uuid-456', {
        sourceBranchId: 'feature-branch-uuid',
      });

      expect(result).toHaveLength(1);
      expect(result[0].sourceBranchId).toBe('feature-branch-uuid');
      expect(calls(mergeRequests).select[0].sql).toContain('"source_branch_id" =');
      expect(calls(mergeRequests).select[0].params).toContain('feature-branch-uuid');
    });

    it('should filter merge requests by target branch', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).select.returns([mergeRequestRow()]);

      const result = await listMergeRequests('site-uuid-456', {
        targetBranchId: 'main-branch-uuid',
      });

      expect(result).toHaveLength(1);
      expect(result[0].targetBranchId).toBe('main-branch-uuid');
      expect(calls(mergeRequests).select[0].sql).toContain('"target_branch_id" =');
      expect(calls(mergeRequests).select[0].params).toContain('main-branch-uuid');
    });

    it('should leave unrequested filters out of the query', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).select.returns([mergeRequestRow()]);

      await listMergeRequests('site-uuid-456');

      const { sql } = calls(mergeRequests).select[0];
      expect(sql).not.toContain('"status" =');
      expect(sql).not.toContain('"source_branch_id" =');
      expect(sql).not.toContain('"target_branch_id" =');
    });

    it('should support pagination with limit and offset', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).select.returns([mergeRequestRow()]);

      await listMergeRequests('site-uuid-456', { limit: 10, offset: 20 });

      const { sql, params } = calls(mergeRequests).select[0];
      expect(sql).toContain('limit');
      expect(sql).toContain('offset');
      expect(params).toEqual(['site-uuid-456', 10, 20]);
    });

    it('should return empty array when no merge requests exist', async () => {
      stubDatabase();

      const result = await listMergeRequests('site-uuid-456');

      expect(result).toEqual([]);
    });
  });

  describe('updateMergeRequest', () => {
    it('should update merge request title', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).update.returns([mergeRequestRow({ title: 'Updated title' })]);

      const result = await updateMergeRequest('mr-uuid-123', { title: 'Updated title' });

      expect(result.title).toBe('Updated title');
      const { sql, params } = calls(mergeRequests).update[0];
      expect(sql).toContain('"title" =');
      expect(sql).not.toContain('"description" =');
      expect(params).toContain('Updated title');
    });

    it('should update merge request description', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).update.returns([mergeRequestRow({ description: 'New description' })]);

      const result = await updateMergeRequest('mr-uuid-123', {
        description: 'New description',
      });

      expect(result.description).toBe('New description');
      const { sql, params } = calls(mergeRequests).update[0];
      expect(sql).toContain('"description" =');
      expect(sql).not.toContain('"title" =');
      expect(params).toContain('New description');
    });

    it('should throw MergeRequestNotFoundError when merge request does not exist', async () => {
      stubDatabase();

      await expect(
        updateMergeRequest('nonexistent-uuid', { title: 'New title' }),
      ).rejects.toThrow(MergeRequestNotFoundError);
    });

    it('should throw InvalidMergeRequestParamsError when title is empty', async () => {
      const { calls } = stubDatabase();

      await expect(updateMergeRequest('mr-uuid-123', { title: '' })).rejects.toThrow(
        InvalidMergeRequestParamsError,
      );

      expect(calls(mergeRequests).update).toHaveLength(0);
    });
  });

  describe('updateMergeRequestStatus', () => {
    it('should transition from open to approved', async () => {
      const { on } = stubDatabase();
      on(mergeRequests).select.returns([{ status: 'open' }]);
      on(mergeRequests).update.returns([mergeRequestRow({ status: 'approved' })]);

      const result = await updateMergeRequestStatus('mr-uuid-123', 'approved');

      expect(result.status).toBe('approved');
    });

    it('should transition from approved to merged with merge metadata', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).select.returns([{ status: 'approved' }]);
      on(mergeRequests).update.returns([
        mergeRequestRow({
          status: 'merged',
          mergedAt: new Date('2026-01-24T12:00:00.000Z'),
          mergedById: 'admin-uuid',
          mergedByType: 'user',
        }),
      ]);

      const result = await updateMergeRequestStatus('mr-uuid-123', 'merged', {
        mergedById: 'admin-uuid',
        mergedByType: 'user',
      });

      expect(result.status).toBe('merged');
      expect(result.mergedById).toBe('admin-uuid');
      const { sql, params } = calls(mergeRequests).update[0];
      expect(sql).toContain('"merged_at" =');
      expect(params).toEqual(expect.arrayContaining(['merged', 'admin-uuid', 'user']));
    });

    it('should transition from open to closed', async () => {
      const { on } = stubDatabase();
      on(mergeRequests).select.returns([{ status: 'open' }]);
      on(mergeRequests).update.returns([mergeRequestRow({ status: 'closed' })]);

      const result = await updateMergeRequestStatus('mr-uuid-123', 'closed');

      expect(result.status).toBe('closed');
    });

    it('should transition from open to conflicted', async () => {
      const { on } = stubDatabase();
      on(mergeRequests).select.returns([{ status: 'open' }]);
      on(mergeRequests).update.returns([
        mergeRequestRow({ status: 'conflicted', hasConflicts: true }),
      ]);

      const result = await updateMergeRequestStatus('mr-uuid-123', 'conflicted');

      expect(result.status).toBe('conflicted');
    });

    it('should throw InvalidMergeRequestStatusTransitionError for invalid transition', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).select.returns([{ status: 'merged' }]);

      await expect(updateMergeRequestStatus('mr-uuid-123', 'open')).rejects.toThrow(
        InvalidMergeRequestStatusTransitionError,
      );

      expect(calls(mergeRequests).update).toHaveLength(0);
    });

    it('should throw MergeRequestNotFoundError when merge request does not exist', async () => {
      const { calls } = stubDatabase();

      await expect(updateMergeRequestStatus('nonexistent-uuid', 'approved')).rejects.toThrow(
        MergeRequestNotFoundError,
      );

      expect(calls(mergeRequests).update).toHaveLength(0);
    });

    it('should transition from approved to merging when merge execution claims the MR [PCC-3737]', async () => {
      const { on } = stubDatabase();
      on(mergeRequests).select.returns([{ status: 'approved' }]);
      on(mergeRequests).update.returns([mergeRequestRow({ status: 'merging' })]);

      const result = await updateMergeRequestStatus('mr-uuid-123', 'merging');

      expect(result.status).toBe('merging');
    });

    it('should transition from merging to merged when the job finalizes [PCC-3737]', async () => {
      const { on } = stubDatabase();
      on(mergeRequests).select.returns([{ status: 'merging' }]);
      on(mergeRequests).update.returns([
        mergeRequestRow({
          status: 'merged',
          mergedAt: new Date('2026-01-24T12:00:00.000Z'),
          mergedById: 'admin-uuid',
          mergedByType: 'user',
        }),
      ]);

      const result = await updateMergeRequestStatus('mr-uuid-123', 'merged', {
        mergedById: 'admin-uuid',
        mergedByType: 'user',
      });

      expect(result.status).toBe('merged');
    });

    it('gates the merging status to execution-shaped edges [PCC-3737]', () => {
      // A merge job can only claim an MR that is executable.
      expect(isValidStatusTransition('approved', 'merging')).toBe(true);
      expect(isValidStatusTransition('conflicted', 'merging')).toBe(true);
      expect(isValidStatusTransition('open', 'merging')).toBe(false);
      expect(isValidStatusTransition('closed', 'merging')).toBe(false);
      expect(isValidStatusTransition('merged', 'merging')).toBe(false);

      // A merge in flight can only finish, surface conflicts found at plan
      // time, or restore to the job's prior status on failure/cancellation —
      // never wander to open/closed, which would orphan the running job.
      expect(isValidStatusTransition('merging', 'merged')).toBe(true);
      expect(isValidStatusTransition('merging', 'conflicted')).toBe(true);
      expect(isValidStatusTransition('merging', 'approved')).toBe(true);
      expect(isValidStatusTransition('merging', 'open')).toBe(false);
      expect(isValidStatusTransition('merging', 'closed')).toBe(false);

      // The legacy direct edges stay valid while the inline merge path
      // exists; PCC-3737 Phase 4 removes them — flip these expectations
      // deliberately then, not as a silent map edit.
      expect(isValidStatusTransition('approved', 'merged')).toBe(true);
      expect(isValidStatusTransition('conflicted', 'merged')).toBe(true);
    });
  });

  describe('claimMergeRequestForExecution (PCC-3737)', () => {
    it('claims with plain single-status quals — never the EPQ-racy self-select shape', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).update.returns([{ id: 'mr-uuid-123' }]);

      const prior = await claimMergeRequestForExecution('mr-uuid-123');
      expect(prior).toBe('approved');

      // The claim MUST be a plain qual on the target table. The previous
      // UPDATE ... FROM (self-select) shape let BOTH concurrent executes win
      // under READ COMMITTED: EvalPlanQual re-evaluates a blocked loser's
      // qual against the STALE subquery row (reproduced on PG 16). A plain
      // qual re-evaluates against the winner's committed row -> 0 rows.
      expect(calls(mergeRequests).update).toHaveLength(1);
      const { sql, params } = calls(mergeRequests).update[0];
      expect(sql).not.toContain('FROM (');
      expect(sql).toContain('"status" =');
      expect(params).toEqual(expect.arrayContaining(['merging', 'mr-uuid-123', 'approved']));
    });

    it('returns null when the MR is not executable (race lost or wrong state)', async () => {
      const { calls } = stubDatabase();

      const prior = await claimMergeRequestForExecution('mr-uuid-123');

      expect(prior).toBeNull();
      // Both single-status UPDATEs (approved, then conflicted) are tried before giving up.
      expect(calls(mergeRequests).update).toHaveLength(2);
    });

    it('restoreMergeRequestClaim only allows map-governed exits from merging', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).update.returns([{ id: 'mr-uuid-123' }]);

      await restoreMergeRequestClaim('mr-uuid-123', 'approved');
      const { sql, params } = calls(mergeRequests).update[0];
      expect(sql).toContain('"status" =');
      expect(params).toEqual(expect.arrayContaining(['approved', 'mr-uuid-123', 'merging']));

      await expect(restoreMergeRequestClaim('mr-uuid-123', 'open')).rejects.toThrow(
        InvalidMergeRequestStatusTransitionError,
      );
    });
  });

  describe('updateMergeRequestConflicts', () => {
    it('should update conflict details', async () => {
      const { on } = stubDatabase();
      const conflictDetails = {
        documentConflicts: [
          {
            documentId: 'doc-uuid',
            documentPath: 'pages/home',
            conflictType: 'both-modified' as const,
            sourceVersion: 3,
            targetVersion: 2,
          },
        ],
        structureConflicts: [],
      };
      on(mergeRequests).update.returns([
        mergeRequestRow({ hasConflicts: true, conflictDetails, status: 'conflicted' }),
      ]);

      const result = await updateMergeRequestConflicts('mr-uuid-123', conflictDetails);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflictDetails).toEqual(conflictDetails);
    });

    it('should clear conflicts when passing empty conflict details', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).update.returns([
        mergeRequestRow({ hasConflicts: false, conflictDetails: null }),
      ]);

      const result = await updateMergeRequestConflicts('mr-uuid-123', {
        documentConflicts: [],
        structureConflicts: [],
      });

      expect(result.hasConflicts).toBe(false);
      expect(result.conflictDetails).toBeUndefined();
      expect(calls(mergeRequests).update[0].params).toEqual(
        expect.arrayContaining([false, null]),
      );
    });

    it('should throw MergeRequestNotFoundError when merge request does not exist', async () => {
      stubDatabase();

      await expect(
        updateMergeRequestConflicts('nonexistent-uuid', {
          documentConflicts: [],
          structureConflicts: [],
        }),
      ).rejects.toThrow(MergeRequestNotFoundError);
    });
  });

  describe('deleteMergeRequest', () => {
    it('should delete a merge request', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).select.returns([mergeRequestRow()]);

      await expect(deleteMergeRequest('mr-uuid-123')).resolves.not.toThrow();

      expect(calls(mergeRequests).delete).toHaveLength(1);
      expect(calls(mergeRequests).delete[0].params).toEqual(['mr-uuid-123']);
    });

    it('should throw MergeRequestNotFoundError when merge request does not exist', async () => {
      const { calls } = stubDatabase();

      await expect(deleteMergeRequest('nonexistent-uuid')).rejects.toThrow(
        MergeRequestNotFoundError,
      );

      expect(calls(mergeRequests).delete).toHaveLength(0);
    });

    it('should not allow deleting a merged merge request', async () => {
      const { on, calls } = stubDatabase();
      on(mergeRequests).select.returns([mergeRequestRow({ status: 'merged' })]);

      await expect(deleteMergeRequest('mr-uuid-123')).rejects.toThrow(
        CannotDeleteMergedRequestError,
      );

      expect(calls(mergeRequests).delete).toHaveLength(0);
    });
  });

  describe('isValidStatusTransition', () => {
    it('should allow open -> approved', () => {
      expect(isValidStatusTransition('open', 'approved')).toBe(true);
    });

    it('should allow open -> closed', () => {
      expect(isValidStatusTransition('open', 'closed')).toBe(true);
    });

    it('should allow open -> conflicted', () => {
      expect(isValidStatusTransition('open', 'conflicted')).toBe(true);
    });

    it('should allow approved -> merged', () => {
      expect(isValidStatusTransition('approved', 'merged')).toBe(true);
    });

    it('should allow approved -> closed', () => {
      expect(isValidStatusTransition('approved', 'closed')).toBe(true);
    });

    it('should allow conflicted -> open (after conflict resolution)', () => {
      expect(isValidStatusTransition('conflicted', 'open')).toBe(true);
    });

    it('should allow conflicted -> closed', () => {
      expect(isValidStatusTransition('conflicted', 'closed')).toBe(true);
    });

    it('should not allow merged -> any state (terminal)', () => {
      expect(isValidStatusTransition('merged', 'open')).toBe(false);
      expect(isValidStatusTransition('merged', 'closed')).toBe(false);
      expect(isValidStatusTransition('merged', 'approved')).toBe(false);
    });

    it('should allow closed -> open (reopen) but not closed -> merged', () => {
      // Closed can be reopened
      expect(isValidStatusTransition('closed', 'open')).toBe(true);
      // But cannot go directly to merged
      expect(isValidStatusTransition('closed', 'merged')).toBe(false);
    });

    it('should not allow open -> merged directly (must go through approved)', () => {
      expect(isValidStatusTransition('open', 'merged')).toBe(false);
    });
  });

  describe('Error Classes', () => {
    it('should export MergeRequestNotFoundError with correct properties', () => {
      const error = new MergeRequestNotFoundError('mr-uuid-123');

      expect(error.name).toBe('MergeRequestNotFoundError');
      expect(error.mergeRequestId).toBe('mr-uuid-123');
      expect(error.message).toContain('mr-uuid-123');
    });

    it('should export InvalidMergeRequestParamsError with correct properties', () => {
      const error = new InvalidMergeRequestParamsError('Title is required');

      expect(error.name).toBe('InvalidMergeRequestParamsError');
      expect(error.message).toBe('Title is required');
    });

    it('should export InvalidMergeRequestStatusTransitionError with correct properties', () => {
      const error = new InvalidMergeRequestStatusTransitionError('open', 'merged');

      expect(error.name).toBe('InvalidMergeRequestStatusTransitionError');
      expect(error.fromStatus).toBe('open');
      expect(error.toStatus).toBe('merged');
    });

    it('should export SourceBranchNotFoundError with correct properties', () => {
      const error = new SourceBranchNotFoundError('branch-uuid');

      expect(error.name).toBe('SourceBranchNotFoundError');
      expect(error.branchId).toBe('branch-uuid');
    });

    it('should export TargetBranchNotFoundError with correct properties', () => {
      const error = new TargetBranchNotFoundError('branch-uuid');

      expect(error.name).toBe('TargetBranchNotFoundError');
      expect(error.branchId).toBe('branch-uuid');
    });

    it('should export CannotDeleteMergedRequestError with correct properties', () => {
      const error = new CannotDeleteMergedRequestError('mr-uuid-123');

      expect(error.name).toBe('CannotDeleteMergedRequestError');
      expect(error.mergeRequestId).toBe('mr-uuid-123');
    });
  });

  describe('Main-Only Merge Target Validation', () => {
    it('should throw TargetBranchNotMainError when target branch is not main', async () => {
      const { on, calls } = stubDatabase();
      on(branches).select.returns([{ id: 'feature-branch-uuid', isMain: false }]);

      await expect(
        createMergeRequest({
          siteId: 'site-uuid-456',
          sourceBranchId: 'other-feature-uuid',
          targetBranchId: 'feature-branch-uuid',
          title: 'Test MR',
          createdById: 'user-uuid-abc',
          createdByType: 'user',
        }),
      ).rejects.toThrow(TargetBranchNotMainError);

      expect(calls(mergeRequests).insert).toHaveLength(0);
    });

    it('should allow creating merge request when target branch is main', async () => {
      const { on } = stubDatabase();
      on(branches).select.returns([{ id: 'main-branch-uuid', isMain: true }]);
      on(mergeRequests).insert.returns([mergeRequestRow()]);

      const result = await createMergeRequest({
        siteId: 'site-uuid-456',
        sourceBranchId: 'feature-branch-uuid',
        targetBranchId: 'main-branch-uuid',
        title: 'Add new feature',
        createdById: 'user-uuid-abc',
        createdByType: 'user',
      });

      expect(result).toBeDefined();
      expect(result.targetBranchId).toBe('main-branch-uuid');
    });

    it('should throw TargetBranchNotMainError with correct properties', () => {
      const error = new TargetBranchNotMainError('branch-uuid');

      expect(error.name).toBe('TargetBranchNotMainError');
      expect(error.targetBranchId).toBe('branch-uuid');
      expect(error.message).toContain('branch-uuid');
      expect(error).toBeInstanceOf(Error);
    });
  });
});
