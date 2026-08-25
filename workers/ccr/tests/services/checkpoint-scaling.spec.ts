/**
 * Phase 6.1-6.2: Checkpoint Scaling Optimization Tests (TDD)
 *
 * Tests for incremental checkpoints and batch revert operations.
 * Based on SCALING-PLAN.md Phases 6.1 and 6.2.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 *
 * Key design decisions:
 * - Parent checkpoint detection is embedded in the INSERT query using a CTE
 *   (WITH parent AS ...) to avoid adding an extra query that would break
 *   existing test mock sequences.
 * - For merge types (pre_merge, post_merge), a CASE expression nullifies
 *   parent_checkpoint_id to force full checkpoints.
 * - Batch revert uses INSERT...SELECT with JOIN LATERAL for per-row version numbers.
 * - Bulk INSERT is skipped when documentsAtCheckpoint.length === 0 for
 *   backward compatibility with existing 0-doc revert tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  CheckpointType,
  CheckpointTrigger,
  CheckpointStatus,
  DocumentVersionSource,
} from '../../src/types';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 6.1-6.2: Checkpoint Scaling Optimizations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // =========================================================================
  // Shared mock types and helpers
  // =========================================================================

  /**
   * Standard checkpoint row returned by SELECT queries.
   */
  interface MockCheckpointRow {
    id: string;
    branch_id: string;
    name: string | null;
    message: string | null;
    checkpoint_type: CheckpointType;
    created_by_id: string;
    created_by_type: 'user' | 'agent' | 'system';
    created_at: string;
    description: string | null;
    trigger: CheckpointTrigger | null;
    requested_by_id: string | null;
    operation_type: string | null;
    affected_regions: string[] | null;
    status: CheckpointStatus | null;
    rolled_back_by_id: string | null;
    rolled_back_at: string | null;
    parent_checkpoint_id: string | null;
  }

  /**
   * Row returned by the CTE-based INSERT in createCheckpoint. The CTE embeds
   * the parent lookup, so parent_checkpoint_id arrives already resolved.
   */
  type MockCheckpointInsertRow = MockCheckpointRow;

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

  function createMockCheckpointRow(
    overrides: Partial<MockCheckpointRow> = {},
  ): MockCheckpointRow {
    return {
      id: 'checkpoint-uuid-123',
      branch_id: 'branch-uuid-789',
      name: 'v1.0',
      message: 'Test checkpoint',
      checkpoint_type: 'manual',
      created_by_id: 'user-uuid-001',
      created_by_type: 'user',
      created_at: '2026-03-01T10:00:00.000Z',
      description: null,
      trigger: 'manual',
      requested_by_id: null,
      operation_type: null,
      affected_regions: null,
      status: 'completed',
      rolled_back_by_id: null,
      rolled_back_at: null,
      parent_checkpoint_id: null,
      ...overrides,
    };
  }

  /**
   * Creates a mock INSERT row for the CTE-based checkpoint insert
   * that the CTE-based INSERT returns via RETURNING.
   */
  function createMockInsertRow(
    overrides: Partial<MockCheckpointInsertRow> = {},
  ): MockCheckpointInsertRow {
    return {
      ...createMockCheckpointRow(overrides),
    };
  }

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
      created_at: '2026-03-01T09:00:00.000Z',
      document_path: 'pages/home',
      ...overrides,
    };
  }

  // =========================================================================
  // Phase 6.1: Incremental Checkpoints
  // =========================================================================

  describe('Phase 6.1: Incremental Checkpoints', () => {
    describe('createCheckpoint with incremental support', () => {
      it('should create a full checkpoint when no previous checkpoint exists', async () => {
        const { createCheckpoint } = await import('../../src/services/checkpoint-service');
        const db = await import('../../src/db');

        const mockInsertRow = createMockInsertRow({
          parent_checkpoint_id: null,
        });

        // CTE-based INSERT keeps the same query count as before:
        // 1. BEGIN
        // 2. INSERT checkpoint (CTE: WITH parent AS (...) INSERT ... RETURNING *)
        // 3. Get ALL latest versions (full snapshot, since no parent)
        // 4. INSERT checkpoint_documents
        // 5. INSERT checkpoint structures
        // 6. INSERT checkpoint metadata
        // 7. COMMIT
        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockInsertRow] }) // INSERT with CTE
          .mockResolvedValueOnce({
            rows: [
              { document_id: 'doc-1', document_version_id: 'v-1' },
              { document_id: 'doc-2', document_version_id: 'v-2' },
              { document_id: 'doc-3', document_version_id: 'v-3' },
            ],
          }) // Get ALL latest versions
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint_documents
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint structures
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint metadata
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await createCheckpoint({
          branchId: 'branch-uuid-789',
          checkpointType: 'manual',
          createdById: 'user-uuid-001',
          createdByType: 'user',
        });

        expect(result.checkpoint.id).toBe('checkpoint-uuid-123');
        expect(result.documentCount).toBe(3);
        expect(result.checkpoint.parentCheckpointId).toBeUndefined();
      });

      it('should create an incremental checkpoint capturing only changed documents', async () => {
        const { createCheckpoint } = await import('../../src/services/checkpoint-service');
        const db = await import('../../src/db');

        const mockInsertRow = createMockInsertRow({
          id: 'incremental-checkpoint-id',
          parent_checkpoint_id: 'parent-checkpoint-id',
        });

        // CTE-based INSERT detects parent -> incremental mode:
        // 1. BEGIN
        // 2. INSERT checkpoint (CTE sets parent_checkpoint_id)
        // 3. Get versions whose id differs from what the parent chain records
        // 4. INSERT checkpoint_documents (only changed docs)
        // 5. INSERT checkpoint structures
        // 6. INSERT checkpoint metadata
        // 7. COMMIT
        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockInsertRow] }) // INSERT with CTE
          .mockResolvedValueOnce({
            rows: [
              { document_id: 'doc-1', document_version_id: 'v-1-new' },
            ],
          }) // Get CHANGED versions only
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint_documents
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint structures
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint metadata
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await createCheckpoint({
          branchId: 'branch-uuid-789',
          checkpointType: 'auto',
          createdById: 'agent-uuid-001',
          createdByType: 'agent',
        });

        expect(result.documentCount).toBe(1);
        expect(result.checkpoint.parentCheckpointId).toBe('parent-checkpoint-id');

        // The delta is defined against the parent chain's recorded versions,
        // not against a timestamp — a clock boundary races the parent's own
        // transaction.
        const queryCalls = vi.mocked(db.query).mock.calls;
        const versionQueryCall = queryCalls[2]; // 3rd call (index 2)
        const versionSql = versionQueryCall[0];
        expect(versionSql).toContain('WITH RECURSIVE chain');
        expect(versionSql).toContain(
          'nearest.document_version_id IS DISTINCT FROM latest.document_version_id',
        );
        expect(versionSql).not.toContain('created_at >');
        // Bound to the parent checkpoint, and to the branch being captured.
        expect(versionQueryCall[1]).toEqual([
          'parent-checkpoint-id',
          'branch-uuid-789',
          '\\_registry/%',
          '\\_registry/templates/%',
        ]);
      });

      it('should create an incremental checkpoint with zero documents when nothing changed', async () => {
        const { createCheckpoint } = await import('../../src/services/checkpoint-service');
        const db = await import('../../src/db');

        const mockInsertRow = createMockInsertRow({
          id: 'incremental-checkpoint-id',
          parent_checkpoint_id: 'parent-checkpoint-id',
        });

        // No docs changed: checkpoint_documents INSERT is skipped
        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockInsertRow] }) // INSERT with CTE
          .mockResolvedValueOnce({ rows: [] }) // No changed documents
          // No INSERT checkpoint_documents (0 rows -> skipped)
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint structures
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint metadata
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await createCheckpoint({
          branchId: 'branch-uuid-789',
          checkpointType: 'auto',
          createdById: 'agent-uuid-001',
          createdByType: 'agent',
        });

        expect(result.documentCount).toBe(0);
        expect(result.checkpoint.parentCheckpointId).toBe('parent-checkpoint-id');
      });

      it('should create a full checkpoint for merge operations regardless of existing checkpoints', async () => {
        const { createCheckpoint } = await import('../../src/services/checkpoint-service');
        const db = await import('../../src/db');

        // CTE may find a parent, but CASE expression nullifies parent_checkpoint_id for merge
        const mockInsertRow = createMockInsertRow({
          id: 'merge-checkpoint-id',
          checkpoint_type: 'post_merge',
          parent_checkpoint_id: null, // CASE nullified for merge type
        });

        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockInsertRow] }) // INSERT with CTE
          .mockResolvedValueOnce({
            rows: [
              { document_id: 'doc-1', document_version_id: 'v-1' },
              { document_id: 'doc-2', document_version_id: 'v-2' },
              { document_id: 'doc-3', document_version_id: 'v-3' },
            ],
          }) // Get ALL latest versions (full snapshot for merge)
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint_documents
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint structures
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint metadata
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await createCheckpoint({
          branchId: 'branch-uuid-789',
          checkpointType: 'post_merge',
          createdById: 'system',
          createdByType: 'system',
        });

        // Merge checkpoints should capture all documents (full checkpoint)
        expect(result.documentCount).toBe(3);
        expect(result.checkpoint.parentCheckpointId).toBeUndefined();
      });

      it('should create a full checkpoint for pre_merge operations', async () => {
        const { createCheckpoint } = await import('../../src/services/checkpoint-service');
        const db = await import('../../src/db');

        const mockInsertRow = createMockInsertRow({
          id: 'pre-merge-checkpoint-id',
          checkpoint_type: 'pre_merge',
          parent_checkpoint_id: null,
        });

        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [mockInsertRow] }) // INSERT with CTE
          .mockResolvedValueOnce({
            rows: [
              { document_id: 'doc-1', document_version_id: 'v-1' },
              { document_id: 'doc-2', document_version_id: 'v-2' },
            ],
          }) // Get ALL latest versions
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint_documents
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint structures
          .mockResolvedValueOnce({ rows: [] }) // INSERT checkpoint metadata
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await createCheckpoint({
          branchId: 'branch-uuid-789',
          checkpointType: 'pre_merge',
          createdById: 'system',
          createdByType: 'system',
        });

        expect(result.documentCount).toBe(2);
        expect(result.checkpoint.parentCheckpointId).toBeUndefined();
      });
    });

    describe('Checkpoint chain resolution', () => {
      // The chain walk and the nearest-wins merge run inside one recursive
      // query now, so these cover the statement's shape and row mapping;
      // the resolution semantics are covered against a real database in
      // tests/integration/checkpoint-chain-resolution.integration.spec.ts.
      it('resolves in a single query that walks the parent chain', async () => {
        const { resolveCheckpointDocuments } = await import('../../src/services/checkpoint-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValueOnce({
          rows: [
            createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
            createMockVersionWithDocument({ document_id: 'doc-2', document_path: 'pages/about' }),
          ],
        });

        const result = await resolveCheckpointDocuments('incremental-checkpoint');

        expect(vi.mocked(db.query)).toHaveBeenCalledTimes(1);
        expect(result).toHaveLength(2);
        expect(result.map((d: { documentId: string }) => d.documentId)).toEqual(['doc-1', 'doc-2']);

        const [sql, params] = vi.mocked(db.query).mock.calls[0]!;
        expect(sql).toContain('WITH RECURSIVE chain');
        expect(sql).toContain('parent.id = chain.parent_checkpoint_id');
        expect(params).toEqual(['incremental-checkpoint']);
      });

      it('stops the walk at the nearest full snapshot', async () => {
        const { resolveCheckpointDocuments } = await import('../../src/services/checkpoint-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

        await resolveCheckpointDocuments('incremental-checkpoint');

        const [sql] = vi.mocked(db.query).mock.calls[0]!;
        // Recursion continues only through deltas.
        expect(sql).toContain('WHERE chain.is_full_snapshot = false');
        // Nearest checkpoint in the chain wins for a given document.
        expect(sql).toContain('DISTINCT ON (cd.document_id)');
        expect(sql).toContain('ORDER BY cd.document_id, chain.depth ASC');
      });

      it('should handle resolving a checkpoint that has no documents', async () => {
        const { resolveCheckpointDocuments } = await import('../../src/services/checkpoint-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

        const result = await resolveCheckpointDocuments('empty-checkpoint');

        expect(result).toEqual([]);
      });
    });

    describe('getDocumentsAtCheckpoint backward compatibility', () => {
      it('should still work for old checkpoints without parent_checkpoint_id', async () => {
        const { getDocumentsAtCheckpoint } = await import('../../src/services/checkpoint-service');
        const db = await import('../../src/db');

        // Old-style checkpoint (pre-incremental) — no parent_checkpoint_id column
        const documents = [
          createMockVersionWithDocument({
            document_id: 'doc-1',
            document_path: 'pages/home',
          }),
          createMockVersionWithDocument({
            document_id: 'doc-2',
            document_path: 'pages/about',
          }),
        ];

        vi.mocked(db.query).mockResolvedValueOnce({ rows: documents });

        const result = await getDocumentsAtCheckpoint('old-checkpoint');

        expect(result).toHaveLength(2);
        expect(result[0].documentPath).toBe('pages/home');
      });
    });

    describe('Checkpoint parentCheckpointId in Checkpoint type', () => {
      it('should include parentCheckpointId in checkpoint result when present', async () => {
        const { getCheckpoint } = await import('../../src/services/checkpoint-service');
        const db = await import('../../src/db');

        const mockRow = createMockCheckpointRow({
          id: 'incremental-cp',
          parent_checkpoint_id: 'parent-cp',
        });

        vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockRow] });

        const result = await getCheckpoint('incremental-cp');

        expect(result).not.toBeNull();
        expect(result?.parentCheckpointId).toBe('parent-cp');
      });

      it('should have undefined parentCheckpointId for full checkpoints', async () => {
        const { getCheckpoint } = await import('../../src/services/checkpoint-service');
        const db = await import('../../src/db');

        const mockRow = createMockCheckpointRow({
          id: 'full-cp',
          parent_checkpoint_id: null,
        });

        vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockRow] });

        const result = await getCheckpoint('full-cp');

        expect(result).not.toBeNull();
        expect(result?.parentCheckpointId).toBeUndefined();
      });
    });
  });

  // =========================================================================
  // Phase 6.2: Batch Revert Operations
  // =========================================================================

  describe('Phase 6.2: Batch Revert Operations', () => {
    it('should use a single bulk INSERT...SELECT instead of a loop for revert', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockCheckpointRow = createMockCheckpointRow({
        id: 'checkpoint-to-revert',
        parent_checkpoint_id: null,
      });

      const newCheckpointInsertRow = createMockInsertRow({
        id: 'new-checkpoint-after-revert',
        message: 'Reverted to checkpoint: v1.0 (checkpoint-to-revert)',
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // Get checkpoint
        .mockResolvedValueOnce({
          rows: [
            createMockVersionWithDocument({ document_id: 'doc-1' }),
            createMockVersionWithDocument({ document_id: 'doc-2' }),
            createMockVersionWithDocument({ document_id: 'doc-3' }),
          ],
        }) // getDocumentsAtCheckpoint
        .mockResolvedValueOnce({ rows: [] }) // Resolve deletions across the chain
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 3 }) // Bulk INSERT...SELECT for all docs at once
        .mockResolvedValueOnce({ rows: [] }) // Get structures at checkpoint
        .mockResolvedValueOnce({ rows: [] }) // Delete current structures
        .mockResolvedValueOnce({ rows: [] }) // Restore structures
        .mockResolvedValueOnce({ rows: [] }) // Delete current metadata
        .mockResolvedValueOnce({ rows: [] }) // Restore metadata
        .mockResolvedValueOnce({ rows: [] }) // UPDATE checkpoint status
        .mockResolvedValueOnce({ rows: [] }) // COMMIT
        // createCheckpoint sub-transaction (CTE-based, no separate get-latest)
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [newCheckpointInsertRow] }) // INSERT with CTE
        .mockResolvedValueOnce({ rows: [] }) // Get latest versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT structures
        .mockResolvedValueOnce({ rows: [] }) // INSERT metadata
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await revertToCheckpoint({
        checkpointId: 'checkpoint-to-revert',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentsReverted).toBe(3);

      // Verify that between BEGIN and structure operations there is only ONE
      // bulk INSERT query (not 3 individual ones)
      const queryCalls = vi.mocked(db.query).mock.calls;
      const beginIndex = queryCalls.findIndex(
        (call) => typeof call[0] === 'string' && call[0] === 'BEGIN',
      );

      // The query after BEGIN should be a bulk INSERT...SELECT with JOIN LATERAL
      const bulkInsertCall = queryCalls[beginIndex + 1];
      expect(typeof bulkInsertCall[0]).toBe('string');
      const bulkInsertSql = bulkInsertCall[0];
      expect(bulkInsertSql).toContain('INSERT INTO app.document_versions');
      expect(bulkInsertSql).toContain('JOIN LATERAL');
      // Driven by the resolved document set, so an incremental checkpoint
      // reverts its whole branch rather than just its own delta.
      expect(bulkInsertSql).toContain('unnest($4::uuid[], $5::uuid[])');
      expect(bulkInsertSql).not.toContain('checkpoint_documents');
    });

    it('should correctly pass checkpoint ID and branch parameters to the bulk revert query', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockCheckpointRow = createMockCheckpointRow({
        id: 'cp-to-revert',
        branch_id: 'target-branch',
        parent_checkpoint_id: null,
      });

      const newCheckpointInsertRow = createMockInsertRow({
        id: 'new-cp',
      });

      // Use 3+ documents to trigger the batch INSERT path (threshold = 3)
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // Get checkpoint
        .mockResolvedValueOnce({
          rows: [
            createMockVersionWithDocument({ document_id: 'doc-1' }),
            createMockVersionWithDocument({ document_id: 'doc-2' }),
            createMockVersionWithDocument({ document_id: 'doc-3' }),
          ],
        }) // getDocumentsAtCheckpoint
        .mockResolvedValueOnce({ rows: [] }) // Resolve deletions across the chain
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 3 }) // Bulk INSERT...SELECT
        .mockResolvedValueOnce({ rows: [] }) // Get structures
        .mockResolvedValueOnce({ rows: [] }) // Delete structures
        .mockResolvedValueOnce({ rows: [] }) // Restore structures
        .mockResolvedValueOnce({ rows: [] }) // Delete metadata
        .mockResolvedValueOnce({ rows: [] }) // Restore metadata
        .mockResolvedValueOnce({ rows: [] }) // UPDATE checkpoint status
        .mockResolvedValueOnce({ rows: [] }) // COMMIT
        // createCheckpoint sub-transaction
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [newCheckpointInsertRow] }) // INSERT with CTE
        .mockResolvedValueOnce({ rows: [] }) // Get latest versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT structures
        .mockResolvedValueOnce({ rows: [] }) // INSERT metadata
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await revertToCheckpoint({
        checkpointId: 'cp-to-revert',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      // Verify the bulk insert query was called with the correct parameters
      const queryCalls = vi.mocked(db.query).mock.calls;
      const bulkInsertCall = queryCalls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('JOIN LATERAL'),
      );

      expect(bulkInsertCall).toBeDefined();

      const params = bulkInsertCall![1];
      expect(params).toContain('target-branch'); // branch_id
      expect(params).toContain('user-uuid-001'); // created_by_id
      expect(params).toContain('user'); // created_by_type
      // The resolved document and version ids replace the checkpoint id: the
      // statement no longer reads a manifest, so it cannot restore a delta.
      expect(params).toEqual(
        expect.arrayContaining([['doc-1', 'doc-2', 'doc-3']]),
      );
      expect(params).not.toContain('cp-to-revert');
    });

    it('should handle revert with zero documents gracefully', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockCheckpointRow = createMockCheckpointRow({
        id: 'empty-checkpoint',
        parent_checkpoint_id: null,
      });

      const newCheckpointInsertRow = createMockInsertRow({
        id: 'new-cp-after-revert',
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // Get checkpoint
        .mockResolvedValueOnce({ rows: [] }) // No documents at checkpoint
        .mockResolvedValueOnce({ rows: [] }) // Resolve deletions across the chain
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        // No bulk INSERT (0 documents -> skipped for backward compatibility)
        .mockResolvedValueOnce({ rows: [] }) // Get structures
        .mockResolvedValueOnce({ rows: [] }) // Delete structures
        .mockResolvedValueOnce({ rows: [] }) // Restore structures
        .mockResolvedValueOnce({ rows: [] }) // Delete metadata
        .mockResolvedValueOnce({ rows: [] }) // Restore metadata
        .mockResolvedValueOnce({ rows: [] }) // UPDATE checkpoint status
        .mockResolvedValueOnce({ rows: [] }) // COMMIT
        // createCheckpoint sub-transaction
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [newCheckpointInsertRow] }) // INSERT with CTE
        .mockResolvedValueOnce({ rows: [] }) // Get latest versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT structures
        .mockResolvedValueOnce({ rows: [] }) // INSERT metadata
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await revertToCheckpoint({
        checkpointId: 'empty-checkpoint',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentsReverted).toBe(0);
    });

    it('should still create a new checkpoint after batch revert', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const mockCheckpointRow = createMockCheckpointRow({
        id: 'cp-to-revert',
        name: 'Stable Release',
        parent_checkpoint_id: null,
      });

      const newCheckpointInsertRow = createMockInsertRow({
        id: 'post-revert-cp',
        message: 'Reverted to checkpoint: Stable Release (cp-to-revert)',
        checkpoint_type: 'manual',
      });

      // Use 3+ documents to trigger the batch INSERT path (threshold = 3)
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // Get checkpoint
        .mockResolvedValueOnce({
          rows: [
            createMockVersionWithDocument({ document_id: 'doc-1' }),
            createMockVersionWithDocument({ document_id: 'doc-2' }),
            createMockVersionWithDocument({ document_id: 'doc-3' }),
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // Resolve deletions across the chain
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 3 }) // Bulk INSERT
        .mockResolvedValueOnce({ rows: [] }) // Get structures
        .mockResolvedValueOnce({ rows: [] }) // Delete structures
        .mockResolvedValueOnce({ rows: [] }) // Restore structures
        .mockResolvedValueOnce({ rows: [] }) // Delete metadata
        .mockResolvedValueOnce({ rows: [] }) // Restore metadata
        .mockResolvedValueOnce({ rows: [] }) // UPDATE status
        .mockResolvedValueOnce({ rows: [] }) // COMMIT
        // createCheckpoint sub-transaction
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [newCheckpointInsertRow] }) // INSERT with CTE
        .mockResolvedValueOnce({ rows: [] }) // Get latest versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT structures
        .mockResolvedValueOnce({ rows: [] }) // INSERT metadata
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await revertToCheckpoint({
        checkpointId: 'cp-to-revert',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.checkpoint).toBeDefined();
      expect(result.checkpoint.id).toBe('post-revert-cp');
      expect(result.checkpoint.message).toContain('Reverted to checkpoint');
    });

    it('should preserve existing revert validation (CheckpointNotFoundError)', async () => {
      const { revertToCheckpoint, CheckpointNotFoundError } = await import(
        '../../src/services/checkpoint-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await expect(
        revertToCheckpoint({
          checkpointId: 'nonexistent',
          createdById: 'user-uuid-001',
          createdByType: 'user',
        }),
      ).rejects.toThrow(CheckpointNotFoundError);
    });

    it('should preserve existing revert validation (InvalidCheckpointParamsError)', async () => {
      const { revertToCheckpoint, InvalidCheckpointParamsError } = await import(
        '../../src/services/checkpoint-service'
      );

      await expect(
        revertToCheckpoint({
          checkpointId: 'some-checkpoint',
          createdById: '',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidCheckpointParamsError);
    });
  });

  // =========================================================================
  // Revert registry filtering
  // =========================================================================

  describe('revert registry filtering', () => {
    // Checkpoints created before capture excluded _registry/* still contain
    // registry rows. Reverting them must not restore those rows: registry
    // documents are sync-owned metadata, and restoring them out-of-band
    // desyncs them from the registry index. _registry/templates/* documents
    // are user-authored content and must keep reverting normally — the same
    // exception capture applies.

    function mockRevertFlow(
      db: { query: unknown },
      docs: MockVersionWithDocumentRow[],
      documentInsertCount: number,
    ): void {
      let chain = vi
        .mocked(db.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [createMockCheckpointRow({ id: 'cp-old', parent_checkpoint_id: null })] }) // getCheckpoint
        .mockResolvedValueOnce({ rows: docs }) // resolveCheckpointDocuments
        .mockResolvedValueOnce({ rows: [] }) // resolveCheckpointDeletions
        .mockResolvedValueOnce({ rows: [] }); // BEGIN
      for (let i = 0; i < documentInsertCount; i++) {
        chain = chain.mockResolvedValueOnce({ rows: [] }); // document_versions INSERT(s)
      }
      chain
        .mockResolvedValueOnce({ rows: [] }) // getStructuresAtCheckpoint
        .mockResolvedValueOnce({ rows: [] }) // DELETE structures
        .mockResolvedValueOnce({ rows: [] }) // INSERT structures
        .mockResolvedValueOnce({ rows: [] }) // DELETE metadata
        .mockResolvedValueOnce({ rows: [] }) // INSERT metadata
        .mockResolvedValueOnce({ rows: [] }) // UPDATE checkpoint status
        .mockResolvedValueOnce({ rows: [] }) // COMMIT
        .mockResolvedValueOnce({ rows: [] }) // createCheckpoint BEGIN
        .mockResolvedValueOnce({ rows: [createMockInsertRow({ id: 'cp-after-revert' })] }) // INSERT with CTE
        .mockResolvedValueOnce({ rows: [] }) // get latest versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT structures
        .mockResolvedValueOnce({ rows: [] }) // INSERT metadata
        .mockResolvedValueOnce({ rows: [] }); // COMMIT
    }

    function documentVersionInsertCalls(db: { query: unknown }): unknown[][] {
      return vi
        .mocked(db.query as ReturnType<typeof vi.fn>)
        .mock.calls.filter(
          (call) =>
            typeof call[0] === 'string' && (call[0]).includes('INSERT INTO app.document_versions'),
        );
    }

    it('excludes registry documents from a batch revert and reports them as skipped', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const docs = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: 'pages/about' }),
        createMockVersionWithDocument({ document_id: 'doc-3', document_path: 'pages/contact' }),
        createMockVersionWithDocument({ document_id: 'doc-4', document_path: '_registry/components/heroblock' }),
        createMockVersionWithDocument({ document_id: 'doc-5', document_path: '_registry/index' }),
      ];
      mockRevertFlow(db, docs, 1);

      const result = await revertToCheckpoint({
        checkpointId: 'cp-old',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentsReverted).toBe(3);
      expect(result.documentsSkipped).toBe(2);

      const [bulkInsert] = documentVersionInsertCalls(db);
      const sql = bulkInsert[0] as string;
      expect(sql).toContain('JOIN app.documents');
      expect(sql).toContain('NOT LIKE');
      const params = bulkInsert[1] as unknown[];
      expect(params).toContain('\\_registry/%');
      expect(params).toContain('\\_registry/templates/%');
    });

    it('keeps registry template documents revertible', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const docs = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: 'pages/about' }),
        createMockVersionWithDocument({ document_id: 'doc-3', document_path: '_registry/templates/press-release' }),
        createMockVersionWithDocument({ document_id: 'doc-4', document_path: '_registry/components/heroblock' }),
      ];
      mockRevertFlow(db, docs, 1);

      const result = await revertToCheckpoint({
        checkpointId: 'cp-old',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentsReverted).toBe(3);
      expect(result.documentsSkipped).toBe(1);
    });

    it('applies the batch threshold to the filtered count, not the raw row count', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      // 4 raw rows would take the batch path; only 2 survive filtering, so
      // the per-document path must be used, inserting exactly the survivors.
      const docs = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: 'pages/about' }),
        createMockVersionWithDocument({ document_id: 'doc-3', document_path: '_registry/components/heroblock' }),
        createMockVersionWithDocument({ document_id: 'doc-4', document_path: '_registry/index' }),
      ];
      mockRevertFlow(db, docs, 2);

      const result = await revertToCheckpoint({
        checkpointId: 'cp-old',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentsReverted).toBe(2);
      expect(result.documentsSkipped).toBe(2);

      const inserts = documentVersionInsertCalls(db);
      expect(inserts).toHaveLength(2);
      const insertedDocIds = inserts.map((call) => (call[1] as unknown[])[0]);
      expect(insertedDocIds).toEqual(['doc-1', 'doc-2']);
    });

    it('restores structures but writes no document versions when a checkpoint holds only registry documents', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');

      const docs = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: '_registry/components/heroblock' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: '_registry/index' }),
      ];
      mockRevertFlow(db, docs, 0);

      const result = await revertToCheckpoint({
        checkpointId: 'cp-old',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentsReverted).toBe(0);
      expect(result.documentsSkipped).toBe(2);
      expect(documentVersionInsertCalls(db)).toHaveLength(0);
      expect(result.checkpoint.id).toBe('cp-after-revert');
    });

    it('warns when registry documents are skipped', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const docs = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: '_registry/index' }),
      ];
      mockRevertFlow(db, docs, 1);

      await revertToCheckpoint({
        checkpointId: 'cp-old',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('_registry'));
      warnSpy.mockRestore();
    });

    it('does not warn when nothing is skipped', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const db = await import('../../src/db');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const docs = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: 'pages/about' }),
      ];
      mockRevertFlow(db, docs, 2);

      await revertToCheckpoint({
        checkpointId: 'cp-old',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
