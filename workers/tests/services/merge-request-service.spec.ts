/**
 * Phase 5.1a: Merge Request Service Tests (TDD)
 *
 * Tests for Merge Request CRUD operations and status management.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MergeRequestStatus } from '../../src/types';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 5.1a: Merge Request Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Mock merge request row type (database format)
  interface MockMergeRequestRow {
    id: string;
    site_id: string;
    source_branch_id: string;
    target_branch_id: string;
    base_checkpoint_id: string | null;
    title: string;
    description: string | null;
    status: MergeRequestStatus;
    has_conflicts: boolean;
    conflict_details: string | null;
    created_by_id: string;
    created_by_type: 'user' | 'agent';
    created_at: string;
    updated_at: string;
    merged_at: string | null;
    merged_by_id: string | null;
    merged_by_type: string | null;
  }

  // Helper to create a mock merge request row (database format)
  function createMockMergeRequestRow(overrides: Partial<MockMergeRequestRow> = {}): MockMergeRequestRow {
    return {
      id: 'mr-uuid-123',
      site_id: 'site-uuid-456',
      source_branch_id: 'feature-branch-uuid',
      target_branch_id: 'main-branch-uuid',
      base_checkpoint_id: 'checkpoint-uuid-789',
      title: 'Add new feature',
      description: 'This PR adds a new feature',
      status: 'open',
      has_conflicts: false,
      conflict_details: null,
      created_by_id: 'user-uuid-abc',
      created_by_type: 'user',
      created_at: '2026-01-24T10:00:00.000Z',
      updated_at: '2026-01-24T10:00:00.000Z',
      merged_at: null,
      merged_by_id: null,
      merged_by_type: null,
      ...overrides,
    };
  }

  describe('createMergeRequest', () => {
    it('should create a merge request between two branches', async () => {
      const { createMergeRequest } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const mockRow = createMockMergeRequestRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

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
      const { createMergeRequest } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const mockRow = createMockMergeRequestRow({ description: null });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createMergeRequest({
        siteId: 'site-uuid-456',
        sourceBranchId: 'feature-branch-uuid',
        targetBranchId: 'main-branch-uuid',
        title: 'Quick fix',
        createdById: 'user-uuid-abc',
        createdByType: 'user',
      });

      expect(result.description).toBeUndefined();
    });

    it('should create a merge request with base checkpoint', async () => {
      const { createMergeRequest } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const mockRow = createMockMergeRequestRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

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
    });

    it('should throw InvalidMergeRequestParamsError when title is empty', async () => {
      const { createMergeRequest, InvalidMergeRequestParamsError } = await import(
        '../../src/services/merge-request-service'
      );

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
    });

    it('should throw InvalidMergeRequestParamsError when title is only whitespace', async () => {
      const { createMergeRequest, InvalidMergeRequestParamsError } = await import(
        '../../src/services/merge-request-service'
      );

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
    });

    it('should throw InvalidMergeRequestParamsError when source and target are the same', async () => {
      const { createMergeRequest, InvalidMergeRequestParamsError } = await import(
        '../../src/services/merge-request-service'
      );

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
    });

    it('should throw SourceBranchNotFoundError when source branch does not exist', async () => {
      const { createMergeRequest, SourceBranchNotFoundError } = await import(
        '../../src/services/merge-request-service'
      );
      const db = await import('../../src/db');

      // Simulate foreign key violation for source branch
      const error = new Error('violates foreign key constraint');
      (error as Error & { code: string }).code = '23503';
      (error as Error & { constraint: string }).constraint = 'merge_requests_source_branch_id_fkey';
      vi.mocked(db.query).mockRejectedValue(error);

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

    it('should throw TargetBranchNotFoundError when target branch does not exist', async () => {
      const { createMergeRequest, TargetBranchNotFoundError } = await import(
        '../../src/services/merge-request-service'
      );
      const db = await import('../../src/db');

      // Simulate foreign key violation for target branch
      const error = new Error('violates foreign key constraint');
      (error as Error & { code: string }).code = '23503';
      (error as Error & { constraint: string }).constraint = 'merge_requests_target_branch_id_fkey';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(
        createMergeRequest({
          siteId: 'site-uuid-456',
          sourceBranchId: 'feature-branch-uuid',
          targetBranchId: 'nonexistent-branch',
          title: 'Test',
          createdById: 'user-uuid-abc',
          createdByType: 'user',
        }),
      ).rejects.toThrow(TargetBranchNotFoundError);
    });

    it('should allow agent to create merge request', async () => {
      const { createMergeRequest } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const mockRow = createMockMergeRequestRow({
        created_by_type: 'agent',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

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
      const { getMergeRequest } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const mockRow = createMockMergeRequestRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getMergeRequest('mr-uuid-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('mr-uuid-123');
      expect(result?.title).toBe('Add new feature');
    });

    it('should return null when merge request not found', async () => {
      const { getMergeRequest } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getMergeRequest('nonexistent-uuid');

      expect(result).toBeNull();
    });

    it('should return merge request with conflict details', async () => {
      const { getMergeRequest } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const conflictDetails = {
        documentConflicts: [
          {
            documentId: 'doc-uuid',
            documentPath: 'pages/home',
            conflictType: 'both-modified',
            sourceVersion: 3,
            targetVersion: 2,
          },
        ],
        structureConflicts: [],
      };

      const mockRow = createMockMergeRequestRow({
        has_conflicts: true,
        conflict_details: JSON.stringify(conflictDetails),
        status: 'conflicted',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getMergeRequest('mr-uuid-123');

      expect(result?.hasConflicts).toBe(true);
      expect(result?.conflictDetails).toEqual(conflictDetails);
      expect(result?.status).toBe('conflicted');
    });

    it('should return merged merge request with merge metadata', async () => {
      const { getMergeRequest } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const mockRow = createMockMergeRequestRow({
        status: 'merged',
        merged_at: '2026-01-24T12:00:00.000Z',
        merged_by_id: 'admin-uuid',
        merged_by_type: 'user',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getMergeRequest('mr-uuid-123');

      expect(result?.status).toBe('merged');
      expect(result?.mergedAt).toBe('2026-01-24T12:00:00.000Z');
      expect(result?.mergedById).toBe('admin-uuid');
      expect(result?.mergedByType).toBe('user');
    });
  });

  describe('listMergeRequests', () => {
    it('should list all merge requests for a site', async () => {
      const { listMergeRequests } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockMergeRequestRow({ id: 'mr-1', title: 'First PR' }),
        createMockMergeRequestRow({ id: 'mr-2', title: 'Second PR' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listMergeRequests('site-uuid-456');

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('First PR');
      expect(result[1].title).toBe('Second PR');
    });

    it('should filter merge requests by status', async () => {
      const { listMergeRequests } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const mockRows = [createMockMergeRequestRow({ status: 'open' })];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listMergeRequests('site-uuid-456', { status: 'open' });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('open');
    });

    it('should filter merge requests by source branch', async () => {
      const { listMergeRequests } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const mockRows = [createMockMergeRequestRow()];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listMergeRequests('site-uuid-456', {
        sourceBranchId: 'feature-branch-uuid',
      });

      expect(result).toHaveLength(1);
      expect(result[0].sourceBranchId).toBe('feature-branch-uuid');
    });

    it('should filter merge requests by target branch', async () => {
      const { listMergeRequests } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const mockRows = [createMockMergeRequestRow()];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listMergeRequests('site-uuid-456', {
        targetBranchId: 'main-branch-uuid',
      });

      expect(result).toHaveLength(1);
      expect(result[0].targetBranchId).toBe('main-branch-uuid');
    });

    it('should support pagination with limit and offset', async () => {
      const { listMergeRequests } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const mockRows = [createMockMergeRequestRow()];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      await listMergeRequests('site-uuid-456', { limit: 10, offset: 20 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([10, 20]),
      );
    });

    it('should return empty array when no merge requests exist', async () => {
      const { listMergeRequests } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listMergeRequests('site-uuid-456');

      expect(result).toEqual([]);
    });
  });

  describe('updateMergeRequest', () => {
    it('should update merge request title', async () => {
      const { updateMergeRequest } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const mockRow = createMockMergeRequestRow({ title: 'Updated title' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await updateMergeRequest('mr-uuid-123', { title: 'Updated title' });

      expect(result.title).toBe('Updated title');
    });

    it('should update merge request description', async () => {
      const { updateMergeRequest } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      const mockRow = createMockMergeRequestRow({ description: 'New description' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await updateMergeRequest('mr-uuid-123', { description: 'New description' });

      expect(result.description).toBe('New description');
    });

    it('should throw MergeRequestNotFoundError when merge request does not exist', async () => {
      const { updateMergeRequest, MergeRequestNotFoundError } = await import(
        '../../src/services/merge-request-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await expect(
        updateMergeRequest('nonexistent-uuid', { title: 'New title' }),
      ).rejects.toThrow(MergeRequestNotFoundError);
    });

    it('should throw InvalidMergeRequestParamsError when title is empty', async () => {
      const { updateMergeRequest, InvalidMergeRequestParamsError } = await import(
        '../../src/services/merge-request-service'
      );

      await expect(updateMergeRequest('mr-uuid-123', { title: '' })).rejects.toThrow(
        InvalidMergeRequestParamsError,
      );
    });
  });

  describe('updateMergeRequestStatus', () => {
    it('should transition from open to approved', async () => {
      const { updateMergeRequestStatus } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      // First call returns current status
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ status: 'open' }] })
        .mockResolvedValueOnce({ rows: [createMockMergeRequestRow({ status: 'approved' })] });

      const result = await updateMergeRequestStatus('mr-uuid-123', 'approved');

      expect(result.status).toBe('approved');
    });

    it('should transition from approved to merged with merge metadata', async () => {
      const { updateMergeRequestStatus } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ status: 'approved' }] })
        .mockResolvedValueOnce({
          rows: [
            createMockMergeRequestRow({
              status: 'merged',
              merged_at: '2026-01-24T12:00:00.000Z',
              merged_by_id: 'admin-uuid',
              merged_by_type: 'user',
            }),
          ],
        });

      const result = await updateMergeRequestStatus('mr-uuid-123', 'merged', {
        mergedById: 'admin-uuid',
        mergedByType: 'user',
      });

      expect(result.status).toBe('merged');
      expect(result.mergedById).toBe('admin-uuid');
    });

    it('should transition from open to closed', async () => {
      const { updateMergeRequestStatus } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ status: 'open' }] })
        .mockResolvedValueOnce({ rows: [createMockMergeRequestRow({ status: 'closed' })] });

      const result = await updateMergeRequestStatus('mr-uuid-123', 'closed');

      expect(result.status).toBe('closed');
    });

    it('should transition from open to conflicted', async () => {
      const { updateMergeRequestStatus } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ status: 'open' }] })
        .mockResolvedValueOnce({
          rows: [createMockMergeRequestRow({ status: 'conflicted', has_conflicts: true })],
        });

      const result = await updateMergeRequestStatus('mr-uuid-123', 'conflicted');

      expect(result.status).toBe('conflicted');
    });

    it('should throw InvalidMergeRequestStatusTransitionError for invalid transition', async () => {
      const { updateMergeRequestStatus, InvalidMergeRequestStatusTransitionError } = await import(
        '../../src/services/merge-request-service'
      );
      const db = await import('../../src/db');

      // merged is terminal state
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ status: 'merged' }] });

      await expect(updateMergeRequestStatus('mr-uuid-123', 'open')).rejects.toThrow(
        InvalidMergeRequestStatusTransitionError,
      );
    });

    it('should throw MergeRequestNotFoundError when merge request does not exist', async () => {
      const { updateMergeRequestStatus, MergeRequestNotFoundError } = await import(
        '../../src/services/merge-request-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await expect(updateMergeRequestStatus('nonexistent-uuid', 'approved')).rejects.toThrow(
        MergeRequestNotFoundError,
      );
    });
  });

  describe('updateMergeRequestConflicts', () => {
    it('should update conflict details', async () => {
      const { updateMergeRequestConflicts } = await import(
        '../../src/services/merge-request-service'
      );
      const db = await import('../../src/db');

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

      const mockRow = createMockMergeRequestRow({
        has_conflicts: true,
        conflict_details: JSON.stringify(conflictDetails),
        status: 'conflicted',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await updateMergeRequestConflicts('mr-uuid-123', conflictDetails);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflictDetails).toEqual(conflictDetails);
    });

    it('should clear conflicts when passing empty conflict details', async () => {
      const { updateMergeRequestConflicts } = await import(
        '../../src/services/merge-request-service'
      );
      const db = await import('../../src/db');

      const mockRow = createMockMergeRequestRow({
        has_conflicts: false,
        conflict_details: null,
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await updateMergeRequestConflicts('mr-uuid-123', {
        documentConflicts: [],
        structureConflicts: [],
      });

      expect(result.hasConflicts).toBe(false);
    });

    it('should throw MergeRequestNotFoundError when merge request does not exist', async () => {
      const { updateMergeRequestConflicts, MergeRequestNotFoundError } = await import(
        '../../src/services/merge-request-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

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
      const { deleteMergeRequest } = await import('../../src/services/merge-request-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ id: 'mr-uuid-123' }] });

      await expect(deleteMergeRequest('mr-uuid-123')).resolves.not.toThrow();
    });

    it('should throw MergeRequestNotFoundError when merge request does not exist', async () => {
      const { deleteMergeRequest, MergeRequestNotFoundError } = await import(
        '../../src/services/merge-request-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await expect(deleteMergeRequest('nonexistent-uuid')).rejects.toThrow(
        MergeRequestNotFoundError,
      );
    });

    it('should not allow deleting a merged merge request', async () => {
      const { deleteMergeRequest, CannotDeleteMergedRequestError } = await import(
        '../../src/services/merge-request-service'
      );
      const db = await import('../../src/db');

      // First call checks status
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [createMockMergeRequestRow({ status: 'merged' })],
      });

      await expect(deleteMergeRequest('mr-uuid-123')).rejects.toThrow(
        CannotDeleteMergedRequestError,
      );
    });
  });

  describe('isValidStatusTransition', () => {
    it('should allow open -> approved', async () => {
      const { isValidStatusTransition } = await import('../../src/services/merge-request-service');

      expect(isValidStatusTransition('open', 'approved')).toBe(true);
    });

    it('should allow open -> closed', async () => {
      const { isValidStatusTransition } = await import('../../src/services/merge-request-service');

      expect(isValidStatusTransition('open', 'closed')).toBe(true);
    });

    it('should allow open -> conflicted', async () => {
      const { isValidStatusTransition } = await import('../../src/services/merge-request-service');

      expect(isValidStatusTransition('open', 'conflicted')).toBe(true);
    });

    it('should allow approved -> merged', async () => {
      const { isValidStatusTransition } = await import('../../src/services/merge-request-service');

      expect(isValidStatusTransition('approved', 'merged')).toBe(true);
    });

    it('should allow approved -> closed', async () => {
      const { isValidStatusTransition } = await import('../../src/services/merge-request-service');

      expect(isValidStatusTransition('approved', 'closed')).toBe(true);
    });

    it('should allow conflicted -> open (after conflict resolution)', async () => {
      const { isValidStatusTransition } = await import('../../src/services/merge-request-service');

      expect(isValidStatusTransition('conflicted', 'open')).toBe(true);
    });

    it('should allow conflicted -> closed', async () => {
      const { isValidStatusTransition } = await import('../../src/services/merge-request-service');

      expect(isValidStatusTransition('conflicted', 'closed')).toBe(true);
    });

    it('should not allow merged -> any state (terminal)', async () => {
      const { isValidStatusTransition } = await import('../../src/services/merge-request-service');

      expect(isValidStatusTransition('merged', 'open')).toBe(false);
      expect(isValidStatusTransition('merged', 'closed')).toBe(false);
      expect(isValidStatusTransition('merged', 'approved')).toBe(false);
    });

    it('should not allow closed -> any state (terminal)', async () => {
      const { isValidStatusTransition } = await import('../../src/services/merge-request-service');

      expect(isValidStatusTransition('closed', 'open')).toBe(false);
      expect(isValidStatusTransition('closed', 'merged')).toBe(false);
    });

    it('should not allow open -> merged directly (must go through approved)', async () => {
      const { isValidStatusTransition } = await import('../../src/services/merge-request-service');

      expect(isValidStatusTransition('open', 'merged')).toBe(false);
    });
  });

  describe('Error Classes', () => {
    it('should export MergeRequestNotFoundError with correct properties', async () => {
      const { MergeRequestNotFoundError } = await import(
        '../../src/services/merge-request-service'
      );

      const error = new MergeRequestNotFoundError('mr-uuid-123');

      expect(error.name).toBe('MergeRequestNotFoundError');
      expect(error.mergeRequestId).toBe('mr-uuid-123');
      expect(error.message).toContain('mr-uuid-123');
    });

    it('should export InvalidMergeRequestParamsError with correct properties', async () => {
      const { InvalidMergeRequestParamsError } = await import(
        '../../src/services/merge-request-service'
      );

      const error = new InvalidMergeRequestParamsError('Title is required');

      expect(error.name).toBe('InvalidMergeRequestParamsError');
      expect(error.message).toBe('Title is required');
    });

    it('should export InvalidMergeRequestStatusTransitionError with correct properties', async () => {
      const { InvalidMergeRequestStatusTransitionError } = await import(
        '../../src/services/merge-request-service'
      );

      const error = new InvalidMergeRequestStatusTransitionError('open', 'merged');

      expect(error.name).toBe('InvalidMergeRequestStatusTransitionError');
      expect(error.fromStatus).toBe('open');
      expect(error.toStatus).toBe('merged');
    });

    it('should export SourceBranchNotFoundError with correct properties', async () => {
      const { SourceBranchNotFoundError } = await import(
        '../../src/services/merge-request-service'
      );

      const error = new SourceBranchNotFoundError('branch-uuid');

      expect(error.name).toBe('SourceBranchNotFoundError');
      expect(error.branchId).toBe('branch-uuid');
    });

    it('should export TargetBranchNotFoundError with correct properties', async () => {
      const { TargetBranchNotFoundError } = await import(
        '../../src/services/merge-request-service'
      );

      const error = new TargetBranchNotFoundError('branch-uuid');

      expect(error.name).toBe('TargetBranchNotFoundError');
      expect(error.branchId).toBe('branch-uuid');
    });

    it('should export CannotDeleteMergedRequestError with correct properties', async () => {
      const { CannotDeleteMergedRequestError } = await import(
        '../../src/services/merge-request-service'
      );

      const error = new CannotDeleteMergedRequestError('mr-uuid-123');

      expect(error.name).toBe('CannotDeleteMergedRequestError');
      expect(error.mergeRequestId).toBe('mr-uuid-123');
    });
  });
});
