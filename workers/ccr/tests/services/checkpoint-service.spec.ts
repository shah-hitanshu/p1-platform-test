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
    parent_checkpoint_id?: string | null;
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

    it('records whether the capture was a full snapshot or a delta', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      // Forced full sweep despite having a parent — what session pre-edit does.
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({
          rows: [createMockCheckpointRow({ parent_checkpoint_id: 'parent-checkpoint' })],
        })
        .mockResolvedValueOnce({ rows: [] }) // capture query
        .mockResolvedValueOnce({ rows: [] }) // structures
        .mockResolvedValueOnce({ rows: [] }) // metadata
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'session_pre_edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        forceFullSnapshot: true,
      });

      const insertParams = vi.mocked(db.query).mock.calls[1]?.[1] ?? [];
      expect(insertParams[12]).toBe(false); // not an explicit document list
      expect(insertParams[13]).toBe(true); // forced full snapshot

      vi.mocked(db.query).mockReset();

      // An explicit document list is a delta whatever the parent says.
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [createMockCheckpointRow()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'publish',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        documentVersionIds: [{ documentId: 'doc-1', documentVersionId: 'v-1' }],
      });

      const publishParams = vi.mocked(db.query).mock.calls[1]?.[1] ?? [];
      expect(publishParams[12]).toBe(true);
      expect(publishParams[13]).toBe(false);
    });

    it('chunks the manifest INSERT so a large branch stays under the bind-parameter cap', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const manyDocs = Array.from({ length: 10_001 }, (_, i) =>
        createMockCheckpointDocRow({ document_id: `doc-${String(i)}`, document_version_id: `v-${String(i)}` }),
      );

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [createMockCheckpointRow()] }) // insert checkpoint
        .mockResolvedValueOnce({ rows: manyDocs }) // capture query
        .mockResolvedValue({ rows: [] }); // manifest inserts, structures, metadata, COMMIT

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'manual',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      const manifestInserts = vi
        .mocked(db.query)
        .mock.calls.filter(([sql]) => sql.includes('INSERT INTO app.checkpoint_documents'));

      expect(manifestInserts).toHaveLength(2);
      for (const [, params] of manifestInserts) {
        expect((params ?? []).length).toBeLessThan(65_535);
      }
      expect(result.documentCount).toBe(10_001);
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

      expect(latestVersionsCall![0]).toContain('is_tombstone');
    });

    // PCC-3430: root cause of the p1-teamworks stale-registry-descriptor bug.
    // agent_pre_edit checkpoints (forceFullSnapshot: true) previously swept in
    // the latest version of every document on the branch, including
    // _registry/components/* and _registry/index — sync-owned metadata, not
    // user-editable content. If such a checkpoint is later rolled back
    // (orphaned agent session cleanup), the registry document is silently
    // reverted to its checkpoint-time content, desyncing it from whatever the
    // registry index believes is the latest hash — the index is never told
    // about this out-of-band revert. syncComponentRegistry's fast path then
    // trusts the (now-wrong) index forever, exactly matching the reported
    // symptom (same descriptor frozen at the same registeredAt across every
    // subsequent sync). _registry/* must never be captured by, or revertible
    // via, an agent edit-session checkpoint.
    it('PCC-3430: excludes _registry/* documents from the full-snapshot capture query', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockCheckpointRow = createMockCheckpointRow({ checkpoint_type: 'agent_pre_edit' });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint
        .mockResolvedValueOnce({
          rows: [
            createMockCheckpointDocRow({ document_id: 'doc-page', document_version_id: 'v-page' }),
          ],
        }) // get latest versions (registry doc excluded by SQL)
        .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
        .mockResolvedValueOnce({ rows: [] }) // structure capture
        .mockResolvedValueOnce({ rows: [] }) // metadata capture
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'agent_pre_edit',
        createdById: 'agent-001',
        createdByType: 'agent',
        forceFullSnapshot: true,
      });

      const allCalls = vi.mocked(db.query).mock.calls;
      const fullCaptureCall = allCalls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('DISTINCT ON'),
      );

      expect(fullCaptureCall).toBeDefined();
      const [sql, sqlParams] = fullCaptureCall as [string, unknown[]];
      // Must join documents to filter by path, and must exclude _registry/*
      // via an escaped, parameterized pattern — not an inlined literal, since
      // '_' is a LIKE wildcard (matches any single character) and an inlined
      // '_registry/%' would also match e.g. 'xregistry/...'.
      expect(sql).toMatch(/join\s+app\.documents/i);
      expect(sql).toMatch(/not\s+like\s+\$\d+\s+escape/i);
      expect(sqlParams).toContain('\\_registry/%');
      // The templates exception (isSystemManagedPath's own exclusion) must
      // still be captured/revertible normally.
      expect(sql).toMatch(/like\s+\$\d+\s+escape/i);
      expect(sqlParams).toContain('\\_registry/templates/%');
    });

    it('PCC-3430: excludes _registry/* documents from the incremental capture query', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockCheckpointRow = createMockCheckpointRow({ checkpoint_type: 'auto' });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        // Insert checkpoint row — includes a parent, and no forceFullSnapshot,
        // so createCheckpoint takes the incremental branch.
        .mockResolvedValueOnce({
          rows: [{ ...mockCheckpointRow, parent_checkpoint_id: 'parent-checkpoint-1', parent_created_at: '2026-01-01T00:00:00.000Z' }],
        })
        .mockResolvedValueOnce({ rows: [] }) // get changed-since-parent versions (empty)
        .mockResolvedValueOnce({ rows: [] }) // structure capture
        .mockResolvedValueOnce({ rows: [] }) // metadata capture
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'auto',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      const allCalls = vi.mocked(db.query).mock.calls;
      const incrementalCaptureCall = allCalls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('DISTINCT ON') &&
          call[0].includes('WITH RECURSIVE chain'),
      );

      expect(incrementalCaptureCall).toBeDefined();
      const [sql, sqlParams] = incrementalCaptureCall as [string, unknown[]];
      expect(sql).toMatch(/join\s+app\.documents/i);
      expect(sql).toMatch(/not\s+like\s+\$\d+\s+escape/i);
      expect(sqlParams).toContain('\\_registry/%');
      expect(sql).toMatch(/like\s+\$\d+\s+escape/i);
      expect(sqlParams).toContain('\\_registry/templates/%');
    });

    it('PCC-3430: does not exclude _registry/templates/* — those are user-authored content types, not sync-owned metadata', async () => {
      const { createCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockCheckpointRow = createMockCheckpointRow({ checkpoint_type: 'agent_pre_edit' });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint
        .mockResolvedValueOnce({
          rows: [
            createMockCheckpointDocRow({ document_id: 'doc-template', document_version_id: 'v-template' }),
          ],
        }) // get latest versions — a _registry/templates/* row IS returned
        .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
        .mockResolvedValueOnce({ rows: [] }) // structure capture
        .mockResolvedValueOnce({ rows: [] }) // metadata capture
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await createCheckpoint({
        branchId: 'branch-uuid-789',
        checkpointType: 'agent_pre_edit',
        createdById: 'agent-001',
        createdByType: 'agent',
        forceFullSnapshot: true,
      });

      // The mocked "get latest versions" query returned one row (the
      // template), so it must be reflected in the checkpoint's document
      // count — the WHERE clause's templates exception must not be
      // structured in a way that a real Postgres server would reject or
      // that this test's mock bypasses.
      expect(result.documentCount).toBe(1);

      const allCalls = vi.mocked(db.query).mock.calls;
      const fullCaptureCall = allCalls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('DISTINCT ON'),
      );
      const [sql] = fullCaptureCall as [string, unknown[]];
      // The exception must be expressed as "excluded UNLESS templates" (an
      // OR against a LIKE, not just a second unconditional exclusion) —
      // guards against a future edit collapsing this into a plain AND that
      // would exclude templates again.
      expect(sql).toMatch(/not\s+like\s+\$\d+\s+escape\s+'\\\\?'\s+or\s+d\.path\s+like\s+\$\d+\s+escape/i);
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

    it('should include versionId matching the version id', async () => {
      const { getDocumentsAtCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockRow = createMockVersionWithDocument({
        id: 'version-uuid-specific',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getDocumentsAtCheckpoint('checkpoint-uuid-123');

      expect(result[0].versionId).toBe('version-uuid-specific');
      expect(result[0].id).toBe('version-uuid-specific');
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
        .mockResolvedValueOnce({ rows: [] }) // Resolve deletions across the chain
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

    it('resolves the parent chain rather than one manifest, so an incremental checkpoint restores the full document set', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      // Three documents takes the batch INSERT path (threshold is 3).
      const mockCheckpointRow = createMockCheckpointRow({ parent_checkpoint_id: 'parent-checkpoint' });
      const resolvedRows = [
        createMockVersionWithDocument({ id: 'version-1', document_id: 'doc-1', document_path: 'pages/about' }),
        createMockVersionWithDocument({ id: 'version-2', document_id: 'doc-2', document_path: 'pages/contact' }),
        createMockVersionWithDocument({ id: 'version-3', document_id: 'doc-3', document_path: 'pages/home' }),
      ];

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // Get checkpoint
        .mockResolvedValueOnce({ rows: resolvedRows }) // Resolve documents across the chain
        .mockResolvedValueOnce({ rows: [] }) // Resolve deletions across the chain
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // Batch revert INSERT
        .mockResolvedValueOnce({ rows: [] }) // Get structures at checkpoint
        .mockResolvedValueOnce({ rows: [] }) // Delete current structures
        .mockResolvedValueOnce({ rows: [] }) // Restore structures
        .mockResolvedValueOnce({ rows: [] }) // Delete current metadata
        .mockResolvedValueOnce({ rows: [] }) // Restore metadata
        .mockResolvedValueOnce({ rows: [] }) // UPDATE checkpoint status
        .mockResolvedValueOnce({ rows: [] }) // COMMIT
        .mockResolvedValueOnce({ rows: [] }) // createCheckpoint: BEGIN
        .mockResolvedValueOnce({ rows: [createMockCheckpointRow({ id: 'revert-checkpoint' })] })
        .mockResolvedValueOnce({ rows: [] }) // Capture query
        .mockResolvedValueOnce({ rows: [] }) // Structure capture
        .mockResolvedValueOnce({ rows: [] }) // Metadata capture
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await revertToCheckpoint({
        checkpointId: 'checkpoint-uuid-123',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      const calls = vi.mocked(db.query).mock.calls;

      // The document set comes from a chain walk that stops at the nearest
      // full snapshot, not from this checkpoint's own manifest.
      const resolveSql = calls[1]?.[0] ?? '';
      expect(resolveSql).toContain('WITH RECURSIVE chain');
      expect(resolveSql).toContain('chain.is_full_snapshot = false');

      // The batch INSERT is driven by the resolved ids, so it cannot fall back
      // to a single manifest's rows.
      const revertInsert = calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO app.document_versions'),
      );
      expect(revertInsert?.[0]).not.toContain('cd.checkpoint_id');
      expect(revertInsert?.[1]).toEqual(
        expect.arrayContaining([
          ['doc-1', 'doc-2', 'doc-3'],
          ['version-1', 'version-2', 'version-3'],
        ]),
      );
      expect(result.documentsReverted).toBe(3);
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
        .mockResolvedValueOnce({ rows: [] }) // Resolve deletions across the chain
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
        .mockResolvedValueOnce({ rows: [] }) // Resolve deletions across the chain
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
