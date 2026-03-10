/**
 * Phase 3.3: Checkpoint Service Tests (TDD)
 *
 * Tests for Checkpoint CRUD operations, document capture, and revert functionality.
 * Checkpoints are named snapshots of branch state at a point in time.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CheckpointType, DocumentVersionSource } from '../../src/types';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 3.3: Checkpoint Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Mock checkpoint row type (database format)
  interface MockCheckpointRow {
    id: string;
    branch_id: string;
    name: string | null;
    message: string | null;
    checkpoint_type: CheckpointType;
    created_by_id: string;
    created_by_type: 'user' | 'agent' | 'system';
    created_at: string;
  }

  // Mock checkpoint document row (database format)
  interface MockCheckpointDocumentRow {
    checkpoint_id: string;
    document_id: string;
    document_version_id: string;
  }

  // Mock document version row for checkpoint queries
  interface MockVersionWithDocumentRow {
    id: string;
    document_id: string;
    branch_id: string;
    version_number: number;
    snapshot: Record<string, unknown>;
    crdt_state: Buffer | null;
    source: DocumentVersionSource;
    created_by_id: string;
    created_by_type: 'user' | 'agent' | 'system';
    created_at: string;
    document_path: string;
  }

  // Helper to create a mock checkpoint row
  function createMockCheckpointRow(overrides: Partial<MockCheckpointRow> = {}): MockCheckpointRow {
    return {
      id: 'checkpoint-uuid-123',
      branch_id: 'branch-uuid-789',
      name: 'v1.0',
      message: 'First release checkpoint',
      checkpoint_type: 'manual',
      created_by_id: 'user-uuid-001',
      created_by_type: 'user',
      created_at: '2026-01-23T10:00:00.000Z',
      ...overrides,
    };
  }

  // Helper to create a mock checkpoint document row
  function createMockCheckpointDocRow(overrides: Partial<MockCheckpointDocumentRow> = {}): MockCheckpointDocumentRow {
    return {
      checkpoint_id: 'checkpoint-uuid-123',
      document_id: 'doc-uuid-456',
      document_version_id: 'version-uuid-789',
      ...overrides,
    };
  }

  // Helper to create a mock version with document info
  function createMockVersionWithDocument(
    overrides: Partial<MockVersionWithDocumentRow> = {},
  ): MockVersionWithDocumentRow {
    return {
      id: 'version-uuid-789',
      document_id: 'doc-uuid-456',
      branch_id: 'branch-uuid-789',
      version_number: 1,
      snapshot: { title: 'Test Document', content: [] },
      crdt_state: null,
      source: 'edit',
      created_by_id: 'user-uuid-001',
      created_by_type: 'user',
      created_at: '2026-01-23T09:00:00.000Z',
      document_path: 'pages/home',
      ...overrides,
    };
  }

  describe('createCheckpoint', () => {
    it('should create a checkpoint capturing current branch state', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockCheckpointRow = createMockCheckpointRow();
      const mockCheckpointDocRows = [
        createMockCheckpointDocRow({ document_id: 'doc-1', document_version_id: 'v-1' }),
        createMockCheckpointDocRow({ document_id: 'doc-2', document_version_id: 'v-2' }),
      ];

      // Transaction flow: BEGIN, insert checkpoint, get latest versions, insert docs, COMMIT
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint
        .mockResolvedValueOnce({ rows: mockCheckpointDocRows }) // get latest versions
        .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        name: 'v1.0',
        message: 'First release checkpoint',
        checkpointType: 'manual',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result).toBeDefined();
      expect(result.checkpoint.id).toBe('checkpoint-uuid-123');
      expect(result.checkpoint.branchId).toBe('branch-uuid-789');
      expect(result.checkpoint.name).toBe('v1.0');
      expect(result.checkpoint.message).toBe('First release checkpoint');
      expect(result.checkpoint.checkpointType).toBe('manual');
      expect(result.documentCount).toBe(2);
    });

    it('should create a checkpoint with optional name and message', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockCheckpointRow = createMockCheckpointRow({ name: null, message: null });
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint
        .mockResolvedValueOnce({ rows: [] }) // get latest versions (empty)
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'auto',
        createdById: 'system',
        createdByType: 'system',
      });

      expect(result.checkpoint.name).toBeUndefined();
      expect(result.checkpoint.message).toBeUndefined();
    });

    it('should support different checkpoint types', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const types: CheckpointType[] = ['manual', 'auto', 'pre_merge', 'post_merge'];

      for (const checkpointType of types) {
        const mockRow = createMockCheckpointRow({ checkpoint_type: checkpointType });
        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockRow] }) // insert checkpoint
          .mockResolvedValueOnce({ rows: [] }) // get latest versions (empty)
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await createCheckpoint({
          branchId: 'branch-uuid-789',
          checkpointType,
          createdById: 'user-uuid-001',
          createdByType: 'user',
        });

        expect(result.checkpoint.checkpointType).toBe(checkpointType);
      }
    });

    it('should create checkpoint with zero documents when branch is empty', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockCheckpointRow = createMockCheckpointRow();
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint
        .mockResolvedValueOnce({ rows: [] }) // No documents on branch
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'manual',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentCount).toBe(0);
    });

    it('should throw BranchNotFoundError when branch does not exist', async () => {
      const { createCheckpoint, BranchNotFoundError } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const error = new Error('violates foreign key constraint');
      (error as NodeJS.ErrnoException).code = '23503';
      // BEGIN succeeds, then INSERT fails
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(error); // INSERT fails

      await expect(
        createCheckpoint({
          branchId: 'nonexistent-branch',
          checkpointType: 'manual',
          createdById: 'user-uuid-001',
          createdByType: 'user',
        }),
      ).rejects.toThrow(BranchNotFoundError);
    });

    it('should throw InvalidCheckpointParamsError when branchId is empty', async () => {
      const { createCheckpoint, InvalidCheckpointParamsError } = await import('../../src/services/checkpoint-service');

      await expect(
        createCheckpoint({
          branchId: '',
          checkpointType: 'manual',
          createdById: 'user-uuid-001',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidCheckpointParamsError);
    });

    it('should throw InvalidCheckpointParamsError when createdById is empty', async () => {
      const { createCheckpoint, InvalidCheckpointParamsError } = await import('../../src/services/checkpoint-service');

      await expect(
        createCheckpoint({
          branchId: 'branch-uuid-789',
          checkpointType: 'manual',
          createdById: '',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidCheckpointParamsError);
    });

    it('should exclude tombstoned documents from checkpoint', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockCheckpointRow = createMockCheckpointRow();

      // Transaction flow: BEGIN, insert checkpoint, get latest versions, insert docs, COMMIT
      // The latest versions query should filter out documents whose snapshot
      // contains { _deleted: true } (tombstones).
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint
        .mockResolvedValueOnce({
          rows: [
            // Only live documents should appear — tombstoned ones filtered by SQL
            createMockCheckpointDocRow({ document_id: 'doc-live', document_version_id: 'v-live' }),
          ],
        }) // get latest versions (filtering tombstones)
        .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
        .mockResolvedValueOnce({ rows: [] }) // structure capture
        .mockResolvedValueOnce({ rows: [] }) // metadata capture
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'manual',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      // Find the SQL query that fetches latest versions (the one with DISTINCT ON)
      const allCalls = vi.mocked(db.query).mock.calls;
      const latestVersionsCall = allCalls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('DISTINCT ON'),
      );

      expect(latestVersionsCall).toBeDefined();
      // The SQL should filter out tombstoned documents via snapshot check
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(latestVersionsCall![0]).toContain('is_tombstone');
    });
  });

  describe('getCheckpoint', () => {
    it('should return a checkpoint by ID', async () => {
      const { getCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockRow = createMockCheckpointRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getCheckpoint('checkpoint-uuid-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('checkpoint-uuid-123');
      expect(result?.branchId).toBe('branch-uuid-789');
      expect(result?.name).toBe('v1.0');
      expect(result?.checkpointType).toBe('manual');
    });

    it('should return null when checkpoint does not exist', async () => {
      const { getCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getCheckpoint('nonexistent-checkpoint');

      expect(result).toBeNull();
    });

    it('should handle checkpoint without name or message', async () => {
      const { getCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockRow = createMockCheckpointRow({ name: null, message: null });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getCheckpoint('checkpoint-uuid-123');

      expect(result?.name).toBeUndefined();
      expect(result?.message).toBeUndefined();
    });
  });

  describe('listCheckpoints', () => {
    it('should list checkpoints for a branch in descending order by creation time', async () => {
      const { listCheckpoints } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockCheckpointRow({ id: 'cp-3', created_at: '2026-01-23T12:00:00.000Z' }),
        createMockCheckpointRow({ id: 'cp-2', created_at: '2026-01-23T11:00:00.000Z' }),
        createMockCheckpointRow({ id: 'cp-1', created_at: '2026-01-23T10:00:00.000Z' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listCheckpoints('branch-uuid-789');

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('cp-3');
      expect(result[1].id).toBe('cp-2');
      expect(result[2].id).toBe('cp-1');
    });

    it('should support pagination with limit', async () => {
      const { listCheckpoints } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockCheckpointRow({ id: 'cp-3' }),
        createMockCheckpointRow({ id: 'cp-2' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listCheckpoints('branch-uuid-789', { limit: 2 });

      expect(result).toHaveLength(2);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.any(Array),
      );
    });

    it('should support pagination with offset', async () => {
      const { listCheckpoints } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockRows = [createMockCheckpointRow({ id: 'cp-1' })];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listCheckpoints('branch-uuid-789', { limit: 1, offset: 2 });

      expect(result).toHaveLength(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET'),
        expect.any(Array),
      );
    });

    it('should filter by checkpoint type', async () => {
      const { listCheckpoints } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockRows = [createMockCheckpointRow({ checkpoint_type: 'manual' })];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listCheckpoints('branch-uuid-789', { checkpointType: 'manual' });

      expect(result).toHaveLength(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('checkpoint_type'),
        expect.arrayContaining(['branch-uuid-789', 'manual']),
      );
    });

    it('should return empty array when no checkpoints exist', async () => {
      const { listCheckpoints } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listCheckpoints('branch-uuid-789');

      expect(result).toEqual([]);
    });
  });

  describe('getDocumentsAtCheckpoint', () => {
    it('should return all document versions captured in a checkpoint', async () => {
      const { getDocumentsAtCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: 'pages/about' }),
        createMockVersionWithDocument({ document_id: 'doc-3', document_path: 'components/header' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await getDocumentsAtCheckpoint('checkpoint-uuid-123');

      expect(result).toHaveLength(3);
      expect(result[0].documentPath).toBe('pages/home');
      expect(result[1].documentPath).toBe('pages/about');
      expect(result[2].documentPath).toBe('components/header');
    });

    it('should return empty array for checkpoint with no documents', async () => {
      const { getDocumentsAtCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getDocumentsAtCheckpoint('checkpoint-uuid-123');

      expect(result).toEqual([]);
    });

    it('should include document version details', async () => {
      const { getDocumentsAtCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockRow = createMockVersionWithDocument({
        version_number: 5,
        snapshot: { title: 'Home Page', components: [] },
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getDocumentsAtCheckpoint('checkpoint-uuid-123');

      expect(result[0].versionNumber).toBe(5);
      expect(result[0].snapshot).toEqual({ title: 'Home Page', components: [] });
    });
  });

  describe('getDocumentAtCheckpoint', () => {
    it('should return a specific document version at a checkpoint by path', async () => {
      const { getDocumentAtCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockRow = createMockVersionWithDocument({ document_path: 'pages/home' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getDocumentAtCheckpoint('checkpoint-uuid-123', 'pages/home');

      expect(result).toBeDefined();
      expect(result?.documentPath).toBe('pages/home');
    });

    it('should return null when document path not found in checkpoint', async () => {
      const { getDocumentAtCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getDocumentAtCheckpoint('checkpoint-uuid-123', 'nonexistent/path');

      expect(result).toBeNull();
    });
  });

  describe('revertToCheckpoint', () => {
    it('should create new document versions with source=revert', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      // Setup: checkpoint exists, has documents
      const mockCheckpointRow = createMockCheckpointRow();
      const mockVersionRows = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: 'pages/about' }),
      ];
      const newCheckpointRow = createMockCheckpointRow({
        id: 'new-checkpoint-after-revert',
        message: 'Reverted to checkpoint: checkpoint-uuid-123',
        checkpoint_type: 'manual',
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // Get checkpoint
        .mockResolvedValueOnce({ rows: mockVersionRows }) // Get documents at checkpoint
        .mockResolvedValueOnce({ rows: [] }) // revertToCheckpoint: BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'new-version-1' }] }) // Create revert version 1
        .mockResolvedValueOnce({ rows: [{ id: 'new-version-2' }] }) // Create revert version 2
        .mockResolvedValueOnce({ rows: [] }) // Get structures at checkpoint
        .mockResolvedValueOnce({ rows: [] }) // Delete current structures
        .mockResolvedValueOnce({ rows: [] }) // Restore structures
        .mockResolvedValueOnce({ rows: [] }) // Delete current metadata
        .mockResolvedValueOnce({ rows: [] }) // Restore metadata
        .mockResolvedValueOnce({ rows: [] }) // inline UPDATE checkpoint status
        .mockResolvedValueOnce({ rows: [] }) // revertToCheckpoint: COMMIT
        // createCheckpoint transaction
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [newCheckpointRow] }) // Insert checkpoint
        .mockResolvedValueOnce({ rows: [] }) // Get latest versions (empty after revert)
        .mockResolvedValueOnce({ rows: [] }) // Structure capture
        .mockResolvedValueOnce({ rows: [] }) // Metadata capture
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await revertToCheckpoint({
        checkpointId: 'checkpoint-uuid-123',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result).toBeDefined();
      expect(result.checkpoint.message).toContain('Reverted to checkpoint');
      expect(result.documentsReverted).toBe(2);
    });

    it('should throw CheckpointNotFoundError when checkpoint does not exist', async () => {
      const { revertToCheckpoint, CheckpointNotFoundError } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await expect(
        revertToCheckpoint({
          checkpointId: 'nonexistent-checkpoint',
          createdById: 'user-uuid-001',
          createdByType: 'user',
        }),
      ).rejects.toThrow(CheckpointNotFoundError);
    });

    it('should create a checkpoint documenting the revert', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockCheckpointRow = createMockCheckpointRow({ name: 'v1.0' });
      const newCheckpointRow = createMockCheckpointRow({
        id: 'revert-checkpoint',
        message: 'Reverted to checkpoint: v1.0 (checkpoint-uuid-123)',
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // Get checkpoint
        .mockResolvedValueOnce({ rows: [] }) // No documents at checkpoint
        .mockResolvedValueOnce({ rows: [] }) // revertToCheckpoint: BEGIN
        .mockResolvedValueOnce({ rows: [] }) // Get structures at checkpoint
        .mockResolvedValueOnce({ rows: [] }) // Delete current structures
        .mockResolvedValueOnce({ rows: [] }) // Restore structures
        .mockResolvedValueOnce({ rows: [] }) // Delete current metadata
        .mockResolvedValueOnce({ rows: [] }) // Restore metadata
        .mockResolvedValueOnce({ rows: [] }) // inline UPDATE checkpoint status
        .mockResolvedValueOnce({ rows: [] }) // revertToCheckpoint: COMMIT
        // createCheckpoint transaction
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [newCheckpointRow] }) // Insert checkpoint
        .mockResolvedValueOnce({ rows: [] }) // Get latest versions
        .mockResolvedValueOnce({ rows: [] }) // Structure capture
        .mockResolvedValueOnce({ rows: [] }) // Metadata capture
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await revertToCheckpoint({
        checkpointId: 'checkpoint-uuid-123',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.checkpoint).toBeDefined();
      expect(result.checkpoint.id).toBe('revert-checkpoint');
    });

    it('should handle revert with custom message', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockCheckpointRow = createMockCheckpointRow();
      const newCheckpointRow = createMockCheckpointRow({
        id: 'revert-checkpoint',
        message: 'Rolling back due to production issue',
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // Get checkpoint
        .mockResolvedValueOnce({ rows: [] }) // No documents at checkpoint
        .mockResolvedValueOnce({ rows: [] }) // revertToCheckpoint: BEGIN
        .mockResolvedValueOnce({ rows: [] }) // Get structures at checkpoint
        .mockResolvedValueOnce({ rows: [] }) // Delete current structures
        .mockResolvedValueOnce({ rows: [] }) // Restore structures
        .mockResolvedValueOnce({ rows: [] }) // Delete current metadata
        .mockResolvedValueOnce({ rows: [] }) // Restore metadata
        .mockResolvedValueOnce({ rows: [] }) // inline UPDATE checkpoint status
        .mockResolvedValueOnce({ rows: [] }) // revertToCheckpoint: COMMIT
        // createCheckpoint transaction
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [newCheckpointRow] }) // Insert checkpoint
        .mockResolvedValueOnce({ rows: [] }) // Get latest versions
        .mockResolvedValueOnce({ rows: [] }) // Structure capture
        .mockResolvedValueOnce({ rows: [] }) // Metadata capture
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await revertToCheckpoint({
        checkpointId: 'checkpoint-uuid-123',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        message: 'Rolling back due to production issue',
      });

      expect(result.checkpoint.message).toBe('Rolling back due to production issue');
    });
  });

  describe('deleteCheckpoint', () => {
    it('should delete a checkpoint and its document associations', async () => {
      const { deleteCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 2 }) // Delete checkpoint_documents
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // Delete checkpoint
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await deleteCheckpoint('checkpoint-uuid-123');

      expect(result).toBe(true);
    });

    it('should return false when checkpoint does not exist', async () => {
      const { deleteCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // No checkpoint_documents deleted
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // No checkpoint deleted
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await deleteCheckpoint('nonexistent-checkpoint');

      expect(result).toBe(false);
    });
  });

  describe('getLatestCheckpoint', () => {
    it('should return the most recent checkpoint for a branch', async () => {
      const { getLatestCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockRow = createMockCheckpointRow({
        id: 'latest-checkpoint',
        created_at: '2026-01-23T15:00:00.000Z',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getLatestCheckpoint('branch-uuid-789');

      expect(result).toBeDefined();
      expect(result?.id).toBe('latest-checkpoint');
    });

    it('should return null when branch has no checkpoints', async () => {
      const { getLatestCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getLatestCheckpoint('branch-uuid-789');

      expect(result).toBeNull();
    });
  });

  describe('getCheckpointDocumentCount', () => {
    it('should return the count of documents in a checkpoint', async () => {
      const { getCheckpointDocumentCount } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ count: '5' }] });

      const result = await getCheckpointDocumentCount('checkpoint-uuid-123');

      expect(result).toBe(5);
    });

    it('should return 0 for checkpoint with no documents', async () => {
      const { getCheckpointDocumentCount } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ count: '0' }] });

      const result = await getCheckpointDocumentCount('checkpoint-uuid-123');

      expect(result).toBe(0);
    });
  });
});
