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
import { checkpointDocuments, checkpoints, documentVersions } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub, type RecordedCall } from '../__stubs__/database';

/**
 * The capture query reads from a derived table, so it is keyed by that name:
 * no schema table describes what it selects.
 */
const CAPTURE = 'latest';

describe('Phase 6.1-6.2: Checkpoint Scaling Optimizations', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    database = stubDatabase();
  });

  // =========================================================================
  // Shared mock types and helpers
  // =========================================================================

  /**
   * Standard checkpoint row returned by SELECT queries.
   */
  // A type alias rather than an interface: the stub takes Record<string,
  // unknown>, which an interface cannot satisfy — it carries no index signature.
  type MockCheckpointRow = {
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
  };

  /**
   * Row returned by the CTE-based INSERT in createCheckpoint. The CTE embeds
   * the parent lookup, so parent_checkpoint_id arrives already resolved.
   */
  type MockCheckpointInsertRow = MockCheckpointRow;

  type MockVersionWithDocumentRow = {
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
  };

  /** A checkpoint read through the query builder, in the schema's property names. */
  function createMockCheckpointRow(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const row = createMockInsertRow();
    return {
      id: row.id,
      branchId: row.branch_id,
      name: row.name,
      message: row.message,
      checkpointType: row.checkpoint_type,
      createdById: row.created_by_id,
      createdByType: row.created_by_type,
      createdAt: new Date(row.created_at),
      description: row.description,
      trigger: row.trigger,
      requestedById: row.requested_by_id,
      operationType: row.operation_type,
      affectedRegions: row.affected_regions,
      status: row.status,
      rolledBackById: row.rolled_back_by_id,
      rolledBackAt: null,
      parentCheckpointId: row.parent_checkpoint_id,
      isFullSnapshot: true,
      ...overrides,
    };
  }

  /** The checkpoint INSERT returns *, so its row is in column names. */
  function insertedCheckpointRow(
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
    return insertedCheckpointRow(overrides);
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

  /** The same row as read through the query builder, in schema property names. */
  function asBuilderRow(row: MockVersionWithDocumentRow): Record<string, unknown> {
    return {
      id: row.id,
      documentId: row.document_id,
      branchId: row.branch_id,
      versionNumber: row.version_number,
      snapshot: row.snapshot,
      source: row.source,
      createdById: row.created_by_id,
      createdByType: row.created_by_type,
      createdAt: new Date(row.created_at),
      documentPath: row.document_path,
    };
  }

  // =========================================================================
  // Phase 6.1: Incremental Checkpoints
  // =========================================================================

  describe('Phase 6.1: Incremental Checkpoints', () => {
    describe('createCheckpoint with incremental support', () => {
      it('should create a full checkpoint when no previous checkpoint exists', async () => {
        const { createCheckpoint } = await import('../../src/services/checkpoint-service');

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
        database.on(checkpoints).insert.returnsRaw([mockInsertRow]);
        database.on(CAPTURE).select.returnsRaw([
          { document_id: 'doc-1', document_version_id: 'v-1' },
          { document_id: 'doc-2', document_version_id: 'v-2' },
          { document_id: 'doc-3', document_version_id: 'v-3' },
        ]);

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
        database.on(checkpoints).insert.returnsRaw([mockInsertRow]);
        database.on(CAPTURE).select.returnsRaw([
          { document_id: 'doc-1', document_version_id: 'v-1-new' },
        ]);

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
        const [capture] = database.calls(CAPTURE).select;
        expect(capture.sql).toContain('WITH RECURSIVE chain');
        expect(capture.sql).toContain(
          'nearest.document_version_id IS DISTINCT FROM latest.document_version_id',
        );
        expect(capture.sql).not.toContain('created_at >');
        // Bound to the parent checkpoint, and to the branch being captured.
        expect(capture.params).toEqual([
          'parent-checkpoint-id',
          'branch-uuid-789',
          '\\_registry/%',
          '\\_registry/templates/%',
        ]);
      });

      it('should create an incremental checkpoint with zero documents when nothing changed', async () => {
        const { createCheckpoint } = await import('../../src/services/checkpoint-service');

        const mockInsertRow = createMockInsertRow({
          id: 'incremental-checkpoint-id',
          parent_checkpoint_id: 'parent-checkpoint-id',
        });

        // No docs changed: checkpoint_documents INSERT is skipped
        database.on(checkpoints).insert.returnsRaw([mockInsertRow]);

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

        // CTE may find a parent, but CASE expression nullifies parent_checkpoint_id for merge
        const mockInsertRow = createMockInsertRow({
          id: 'merge-checkpoint-id',
          checkpoint_type: 'post_merge',
          parent_checkpoint_id: null, // CASE nullified for merge type
        });

        database.on(checkpoints).insert.returnsRaw([mockInsertRow]);
        database.on(CAPTURE).select.returnsRaw([
          { document_id: 'doc-1', document_version_id: 'v-1' },
          { document_id: 'doc-2', document_version_id: 'v-2' },
          { document_id: 'doc-3', document_version_id: 'v-3' },
        ]);

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

        const mockInsertRow = createMockInsertRow({
          id: 'pre-merge-checkpoint-id',
          checkpoint_type: 'pre_merge',
          parent_checkpoint_id: null,
        });

        database.on(checkpoints).insert.returnsRaw([mockInsertRow]);
        database.on(CAPTURE).select.returnsRaw([
          { document_id: 'doc-1', document_version_id: 'v-1' },
          { document_id: 'doc-2', document_version_id: 'v-2' },
        ]);

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

        database.on(documentVersions).select.returnsRaw([
          createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
          createMockVersionWithDocument({ document_id: 'doc-2', document_path: 'pages/about' }),
        ]);

        const result = await resolveCheckpointDocuments('incremental-checkpoint');

        expect(database.statements).toHaveLength(1);
        expect(result).toHaveLength(2);
        expect(result.map((d: { documentId: string }) => d.documentId)).toEqual(['doc-1', 'doc-2']);

        const [resolve] = database.calls(documentVersions).select;
        expect(resolve.sql).toContain('WITH RECURSIVE chain');
        expect(resolve.sql).toContain('parent.id = chain.parent_checkpoint_id');
        expect(resolve.params).toEqual(['incremental-checkpoint']);
      });

      it('stops the walk at the nearest full snapshot', async () => {
        const { resolveCheckpointDocuments } = await import('../../src/services/checkpoint-service');

        await resolveCheckpointDocuments('incremental-checkpoint');

        const [resolve] = database.calls(documentVersions).select;
        // Recursion continues only through deltas.
        expect(resolve.sql).toContain('WHERE chain.is_full_snapshot = false');
        // Nearest checkpoint in the chain wins for a given document.
        expect(resolve.sql).toContain('DISTINCT ON (cd.document_id)');
        expect(resolve.sql).toContain('ORDER BY cd.document_id, chain.depth ASC');
      });

      it('should handle resolving a checkpoint that has no documents', async () => {
        const { resolveCheckpointDocuments } = await import('../../src/services/checkpoint-service');

        const result = await resolveCheckpointDocuments('empty-checkpoint');

        expect(result).toEqual([]);
      });
    });

    describe('getDocumentsAtCheckpoint backward compatibility', () => {
      it('should still work for old checkpoints without parent_checkpoint_id', async () => {
        const { getDocumentsAtCheckpoint } = await import('../../src/services/checkpoint-service');

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

        database.on(checkpointDocuments).select.returnsRaw(documents.map(asBuilderRow));

        const result = await getDocumentsAtCheckpoint('old-checkpoint');

        expect(result).toHaveLength(2);
        expect(result[0].documentPath).toBe('pages/home');
      });
    });

    describe('Checkpoint parentCheckpointId in Checkpoint type', () => {
      it('should include parentCheckpointId in checkpoint result when present', async () => {
        const { getCheckpoint } = await import('../../src/services/checkpoint-service');

        const mockRow = createMockCheckpointRow({
          id: 'incremental-cp',
          parentCheckpointId: 'parent-cp',
        });

        database.on(checkpoints).select.returnsRaw([mockRow]);

        const result = await getCheckpoint('incremental-cp');

        expect(result).not.toBeNull();
        expect(result?.parentCheckpointId).toBe('parent-cp');
      });

      it('should have undefined parentCheckpointId for full checkpoints', async () => {
        const { getCheckpoint } = await import('../../src/services/checkpoint-service');

        const mockRow = createMockCheckpointRow({
          id: 'full-cp',
          parentCheckpointId: null,
        });

        database.on(checkpoints).select.returnsRaw([mockRow]);

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

      const mockCheckpointRow = createMockCheckpointRow({
        id: 'checkpoint-to-revert',
        parentCheckpointId: null,
      });

      const newCheckpointInsertRow = createMockInsertRow({
        id: 'new-checkpoint-after-revert',
        message: 'Reverted to checkpoint: v1.0 (checkpoint-to-revert)',
      });

      database.on(checkpoints).select.returnsRaw([mockCheckpointRow]);
      database.on(documentVersions).select.returnsRaw([
        createMockVersionWithDocument({ document_id: 'doc-1' }),
        createMockVersionWithDocument({ document_id: 'doc-2' }),
        createMockVersionWithDocument({ document_id: 'doc-3' }),
      ]);
      database.on(checkpoints).insert.returnsRaw([newCheckpointInsertRow]);

      const result = await revertToCheckpoint({
        checkpointId: 'checkpoint-to-revert',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentsReverted).toBe(3);

      // Three documents take the bulk path, so there is one INSERT, not three.
      const inserts = database.calls(documentVersions).insert;
      expect(inserts).toHaveLength(1);
      const [bulkInsert] = inserts;
      expect(bulkInsert.sql).toContain('INSERT INTO app.document_versions');
      expect(bulkInsert.sql).toContain('JOIN LATERAL');
      // Driven by the resolved document set, so an incremental checkpoint
      // reverts its whole branch rather than just its own delta.
      expect(bulkInsert.sql).toMatch(/unnest\(\s*\$4::uuid\[\],\s*\$5::uuid\[\]\s*\)/);
      expect(bulkInsert.sql).not.toContain('checkpoint_documents');
    });

    it('should correctly pass checkpoint ID and branch parameters to the bulk revert query', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      const mockCheckpointRow = createMockCheckpointRow({
        id: 'cp-to-revert',
        branchId: 'target-branch',
        parentCheckpointId: null,
      });

      const newCheckpointInsertRow = createMockInsertRow({
        id: 'new-cp',
      });

      // Use 3+ documents to trigger the batch INSERT path (threshold = 3)
      database.on(checkpoints).select.returnsRaw([mockCheckpointRow]);
      database.on(documentVersions).select.returnsRaw([
        createMockVersionWithDocument({ document_id: 'doc-1' }),
        createMockVersionWithDocument({ document_id: 'doc-2' }),
        createMockVersionWithDocument({ document_id: 'doc-3' }),
      ]);
      database.on(checkpoints).insert.returnsRaw([newCheckpointInsertRow]);

      await revertToCheckpoint({
        checkpointId: 'cp-to-revert',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      // Verify the bulk insert query was called with the correct parameters
      const bulkInsertCall = database.statements.find(
        (call) => call.sql.includes('JOIN LATERAL'),
      );

      expect(bulkInsertCall).toBeDefined();

      const params = bulkInsertCall!.params;
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

      const mockCheckpointRow = createMockCheckpointRow({
        id: 'empty-checkpoint',
        parentCheckpointId: null,
      });

      const newCheckpointInsertRow = createMockInsertRow({
        id: 'new-cp-after-revert',
      });

      database.on(checkpoints).select.returnsRaw([mockCheckpointRow]);
      database.on(checkpoints).insert.returnsRaw([newCheckpointInsertRow]);

      const result = await revertToCheckpoint({
        checkpointId: 'empty-checkpoint',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentsReverted).toBe(0);
    });

    it('should still create a new checkpoint after batch revert', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      const mockCheckpointRow = createMockCheckpointRow({
        id: 'cp-to-revert',
        name: 'Stable Release',
        parentCheckpointId: null,
      });

      const newCheckpointInsertRow = createMockInsertRow({
        id: 'post-revert-cp',
        message: 'Reverted to checkpoint: Stable Release (cp-to-revert)',
        checkpoint_type: 'manual',
      });

      // Use 3+ documents to trigger the batch INSERT path (threshold = 3)
      database.on(checkpoints).select.returnsRaw([mockCheckpointRow]);
      database.on(documentVersions).select.returnsRaw([
        createMockVersionWithDocument({ document_id: 'doc-1' }),
        createMockVersionWithDocument({ document_id: 'doc-2' }),
        createMockVersionWithDocument({ document_id: 'doc-3' }),
      ]);
      database.on(checkpoints).insert.returnsRaw([newCheckpointInsertRow]);

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

    function stubRevertFlow(docs: MockVersionWithDocumentRow[]): void {
      database.on(checkpoints).select.returnsRaw([
        createMockCheckpointRow({ id: 'cp-old', parentCheckpointId: null }),
      ]);
      database.on(documentVersions).select.returnsRaw(docs);
      database.on(checkpoints).insert.returnsRaw([
        createMockInsertRow({ id: 'cp-after-revert' }),
      ]);
    }

    function documentVersionInsertCalls(): RecordedCall[] {
      return database.calls(documentVersions).insert;
    }

    it('excludes registry documents from a batch revert and reports them as skipped', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      const docs = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: 'pages/about' }),
        createMockVersionWithDocument({ document_id: 'doc-3', document_path: 'pages/contact' }),
        createMockVersionWithDocument({ document_id: 'doc-4', document_path: '_registry/components/heroblock' }),
        createMockVersionWithDocument({ document_id: 'doc-5', document_path: '_registry/index' }),
      ];
      stubRevertFlow(docs);

      const result = await revertToCheckpoint({
        checkpointId: 'cp-old',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentsReverted).toBe(3);
      expect(result.documentsSkipped).toBe(2);

      const [bulkInsert] = documentVersionInsertCalls();
      expect(bulkInsert.sql).toContain('JOIN app.documents');
      expect(bulkInsert.sql).toContain('NOT LIKE');
      expect(bulkInsert.params).toContain('\\_registry/%');
      expect(bulkInsert.params).toContain('\\_registry/templates/%');
    });

    it('keeps registry template documents revertible', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      const docs = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: 'pages/about' }),
        createMockVersionWithDocument({ document_id: 'doc-3', document_path: '_registry/templates/press-release' }),
        createMockVersionWithDocument({ document_id: 'doc-4', document_path: '_registry/components/heroblock' }),
      ];
      stubRevertFlow(docs);

      const result = await revertToCheckpoint({
        checkpointId: 'cp-old',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentsReverted).toBe(3);
      expect(result.documentsSkipped).toBe(1);
    });

    it('keeps datasource and query documents revertible — they live outside _registry/', async () => {
      // Regression guard: datasources and queries were once stored under
      // _registry/, where this filter silently kept them out of merge and
      // revert (migration 068 moved them). They are user-derived content and
      // must revert like any page.
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      const docs = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: '_datasources/blog' }),
        createMockVersionWithDocument({ document_id: 'doc-3', document_path: '_queries/blog' }),
        createMockVersionWithDocument({ document_id: 'doc-4', document_path: '_registry/index' }),
      ];
      stubRevertFlow(docs);

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

      // 4 raw rows would take the batch path; only 2 survive filtering, so
      // the per-document path must be used, inserting exactly the survivors.
      const docs = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: 'pages/about' }),
        createMockVersionWithDocument({ document_id: 'doc-3', document_path: '_registry/components/heroblock' }),
        createMockVersionWithDocument({ document_id: 'doc-4', document_path: '_registry/index' }),
      ];
      stubRevertFlow(docs);

      const result = await revertToCheckpoint({
        checkpointId: 'cp-old',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentsReverted).toBe(2);
      expect(result.documentsSkipped).toBe(2);

      const inserts = documentVersionInsertCalls();
      expect(inserts).toHaveLength(2);
      expect(inserts.map((call) => call.params[0])).toEqual(['doc-1', 'doc-2']);
    });

    it('restores structures but writes no document versions when a checkpoint holds only registry documents', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');

      const docs = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: '_registry/components/heroblock' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: '_registry/index' }),
      ];
      stubRevertFlow(docs);

      const result = await revertToCheckpoint({
        checkpointId: 'cp-old',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.documentsReverted).toBe(0);
      expect(result.documentsSkipped).toBe(2);
      expect(documentVersionInsertCalls()).toHaveLength(0);
      expect(result.checkpoint.id).toBe('cp-after-revert');
    });

    it('warns when registry documents are skipped', async () => {
      const { revertToCheckpoint } = await import('../../src/services/checkpoint-service');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const docs = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: '_registry/index' }),
      ];
      stubRevertFlow(docs);

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
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const docs = [
        createMockVersionWithDocument({ document_id: 'doc-1', document_path: 'pages/home' }),
        createMockVersionWithDocument({ document_id: 'doc-2', document_path: 'pages/about' }),
      ];
      stubRevertFlow(docs);

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
