/**
 * Phase 5.2: Batch Sync Function Tests (TDD)
 *
 * Tests for the batch sync function that inserts multiple document versions
 * in a single query. This is designed for future Queue consumer use (Phase 5.1)
 * where batches of up to 100 sync messages are processed together.
 *
 * Key behaviors:
 * - Accept an array of sync payloads
 * - INSERT multiple document versions in one statement
 * - Handle per-row dedup within the batch (skip rows whose snapshot matches latest)
 * - Return results indicating which rows were inserted vs skipped
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocumentVersionSource } from '../../src/types';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 5.2: Batch Sync Function', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Types for testing
  // ===========================================================================

  interface MockDocumentVersionRow {
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
  }

  function createMockVersionRow(
    overrides: Partial<MockDocumentVersionRow> = {},
  ): MockDocumentVersionRow {
    return {
      id: 'version-uuid-001',
      document_id: 'doc-uuid-123',
      branch_id: 'branch-uuid-456',
      version_number: 1,
      snapshot: { root: { title: 'Test' } },
      crdt_state: null,
      source: 'realtime',
      created_by_id: 'user-uuid-001',
      created_by_type: 'user',
      created_at: '2026-03-01T10:00:00.000Z',
      ...overrides,
    };
  }

  // ===========================================================================
  // batchSyncToPostgres tests
  // ===========================================================================

  describe('batchSyncToPostgres', () => {
    it('should be exported from document-version-service', async () => {
      const mod = await import('../../src/services/document-version-service');
      expect(mod.batchSyncToPostgres).toBeDefined();
      expect(typeof mod.batchSyncToPostgres).toBe('function');
    });

    it('should insert multiple document versions in a single query', async () => {
      const { batchSyncToPostgres } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      const mockRows = [
        createMockVersionRow({
          id: 'version-001',
          document_id: 'doc-001',
          branch_id: 'branch-001',
          version_number: 1,
        }),
        createMockVersionRow({
          id: 'version-002',
          document_id: 'doc-002',
          branch_id: 'branch-001',
          version_number: 1,
        }),
        createMockVersionRow({
          id: 'version-003',
          document_id: 'doc-003',
          branch_id: 'branch-001',
          version_number: 2,
        }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await batchSyncToPostgres([
        {
          documentId: 'doc-001',
          branchId: 'branch-001',
          snapshot: { root: { title: 'Doc 1' } },
          crdtState: 'base64-1',
          actorId: 'user-001',
          actorType: 'user',
        },
        {
          documentId: 'doc-002',
          branchId: 'branch-001',
          snapshot: { root: { title: 'Doc 2' } },
          crdtState: 'base64-2',
          actorId: 'user-001',
          actorType: 'user',
        },
        {
          documentId: 'doc-003',
          branchId: 'branch-001',
          snapshot: { root: { title: 'Doc 3' } },
          crdtState: 'base64-3',
          actorId: 'agent-001',
          actorType: 'agent',
        },
      ]);

      expect(result.inserted).toHaveLength(3);
      expect(result.inserted[0].documentId).toBe('doc-001');
      expect(result.inserted[1].documentId).toBe('doc-002');
      expect(result.inserted[2].documentId).toBe('doc-003');
    });

    it('should return empty results for empty input', async () => {
      const { batchSyncToPostgres } = await import(
        '../../src/services/document-version-service'
      );

      const result = await batchSyncToPostgres([]);

      expect(result.inserted).toHaveLength(0);
      expect(result.skippedCount).toBe(0);
    });

    it('should handle a single-item batch', async () => {
      const { batchSyncToPostgres } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      const mockRow = createMockVersionRow({
        id: 'version-001',
        document_id: 'doc-001',
        branch_id: 'branch-001',
        version_number: 5,
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await batchSyncToPostgres([
        {
          documentId: 'doc-001',
          branchId: 'branch-001',
          snapshot: { root: { title: 'Single' } },
          crdtState: 'base64-single',
          actorId: 'user-001',
          actorType: 'user',
        },
      ]);

      expect(result.inserted).toHaveLength(1);
      expect(result.inserted[0].versionNumber).toBe(5);
    });

    it('should report skipped count when some rows are deduped', async () => {
      const { batchSyncToPostgres } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      // Only 2 of 3 rows inserted (one deduped by the query)
      const mockRows = [
        createMockVersionRow({
          id: 'version-001',
          document_id: 'doc-001',
          version_number: 2,
        }),
        createMockVersionRow({
          id: 'version-003',
          document_id: 'doc-003',
          version_number: 1,
        }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await batchSyncToPostgres([
        {
          documentId: 'doc-001',
          branchId: 'branch-001',
          snapshot: { root: { title: 'Changed' } },
          crdtState: 'base64-1',
          actorId: 'user-001',
          actorType: 'user',
        },
        {
          documentId: 'doc-002',
          branchId: 'branch-001',
          snapshot: { root: { title: 'Same as latest' } },
          crdtState: 'base64-2',
          actorId: 'user-001',
          actorType: 'user',
        },
        {
          documentId: 'doc-003',
          branchId: 'branch-001',
          snapshot: { root: { title: 'New Doc' } },
          crdtState: 'base64-3',
          actorId: 'agent-001',
          actorType: 'agent',
        },
      ]);

      expect(result.inserted).toHaveLength(2);
      expect(result.skippedCount).toBe(1);
    });

    it('should handle all rows being deduped', async () => {
      const { batchSyncToPostgres } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      // No rows inserted (all deduped)
      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await batchSyncToPostgres([
        {
          documentId: 'doc-001',
          branchId: 'branch-001',
          snapshot: { root: { title: 'Same' } },
          crdtState: 'base64-1',
          actorId: 'user-001',
          actorType: 'user',
        },
        {
          documentId: 'doc-002',
          branchId: 'branch-001',
          snapshot: { root: { title: 'Same' } },
          crdtState: 'base64-2',
          actorId: 'user-001',
          actorType: 'user',
        },
      ]);

      expect(result.inserted).toHaveLength(0);
      expect(result.skippedCount).toBe(2);
    });

    it('should use source=realtime for all batch items', async () => {
      const { batchSyncToPostgres } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      const mockRow = createMockVersionRow({
        source: 'realtime',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await batchSyncToPostgres([
        {
          documentId: 'doc-001',
          branchId: 'branch-001',
          snapshot: { root: {} },
          crdtState: 'base64',
          actorId: 'user-001',
          actorType: 'user',
        },
      ]);

      expect(result.inserted[0].source).toBe('realtime');
    });

    it('should convert crdtState base64 strings to Buffers', async () => {
      const { batchSyncToPostgres } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      const crdtBase64 = Buffer.from('crdt-data').toString('base64');
      const mockRow = createMockVersionRow({
        crdt_state: Buffer.from('crdt-data'),
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await batchSyncToPostgres([
        {
          documentId: 'doc-001',
          branchId: 'branch-001',
          snapshot: { root: {} },
          crdtState: crdtBase64,
          actorId: 'user-001',
          actorType: 'user',
        },
      ]);

      // Verify the query was called
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('should handle items with empty CRDT state', async () => {
      const { batchSyncToPostgres } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      const mockRow = createMockVersionRow({ crdt_state: null });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await batchSyncToPostgres([
        {
          documentId: 'doc-001',
          branchId: 'branch-001',
          snapshot: { root: {} },
          crdtState: '',
          actorId: 'user-001',
          actorType: 'user',
        },
      ]);

      expect(result.inserted).toHaveLength(1);
      expect(result.inserted[0].crdtState).toBeUndefined();
    });

    it('should throw on database errors', async () => {
      const { batchSyncToPostgres } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockRejectedValue(new Error('connection refused'));

      await expect(
        batchSyncToPostgres([
          {
            documentId: 'doc-001',
            branchId: 'branch-001',
            snapshot: { root: {} },
            crdtState: 'base64',
            actorId: 'user-001',
            actorType: 'user',
          },
        ]),
      ).rejects.toThrow();
    });

    it('should handle mixed actor types within a batch', async () => {
      const { batchSyncToPostgres } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      const mockRows = [
        createMockVersionRow({
          id: 'v1',
          document_id: 'doc-001',
          created_by_id: 'user-001',
          created_by_type: 'user',
        }),
        createMockVersionRow({
          id: 'v2',
          document_id: 'doc-002',
          created_by_id: 'agent-001',
          created_by_type: 'agent',
        }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await batchSyncToPostgres([
        {
          documentId: 'doc-001',
          branchId: 'branch-001',
          snapshot: { root: { title: 'User edit' } },
          crdtState: 'base64-1',
          actorId: 'user-001',
          actorType: 'user',
        },
        {
          documentId: 'doc-002',
          branchId: 'branch-001',
          snapshot: { root: { title: 'Agent edit' } },
          crdtState: 'base64-2',
          actorId: 'agent-001',
          actorType: 'agent',
        },
      ]);

      expect(result.inserted).toHaveLength(2);
      expect(result.inserted[0].createdByType).toBe('user');
      expect(result.inserted[1].createdByType).toBe('agent');
    });

    it('should handle items across different branches', async () => {
      const { batchSyncToPostgres } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      const mockRows = [
        createMockVersionRow({
          id: 'v1',
          document_id: 'doc-001',
          branch_id: 'branch-A',
          version_number: 3,
        }),
        createMockVersionRow({
          id: 'v2',
          document_id: 'doc-001',
          branch_id: 'branch-B',
          version_number: 1,
        }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await batchSyncToPostgres([
        {
          documentId: 'doc-001',
          branchId: 'branch-A',
          snapshot: { root: { title: 'On branch A' } },
          crdtState: 'base64-1',
          actorId: 'user-001',
          actorType: 'user',
        },
        {
          documentId: 'doc-001',
          branchId: 'branch-B',
          snapshot: { root: { title: 'On branch B' } },
          crdtState: 'base64-2',
          actorId: 'user-001',
          actorType: 'user',
        },
      ]);

      expect(result.inserted).toHaveLength(2);
      expect(result.inserted[0].branchId).toBe('branch-A');
      expect(result.inserted[1].branchId).toBe('branch-B');
    });
  });

  // ===========================================================================
  // BatchSyncPayload type tests
  // ===========================================================================

  describe('BatchSyncPayload', () => {
    it('should be exported from document-version-service', async () => {
      const mod = await import('../../src/services/document-version-service');
      // TypeScript type export — verify by using the function signature
      expect(mod.batchSyncToPostgres).toBeDefined();
    });
  });

  // ===========================================================================
  // BatchSyncResult type tests
  // ===========================================================================

  describe('BatchSyncResult', () => {
    it('should contain inserted array and skippedCount', async () => {
      const { batchSyncToPostgres } = await import(
        '../../src/services/document-version-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await batchSyncToPostgres([]);

      expect(result).toHaveProperty('inserted');
      expect(result).toHaveProperty('skippedCount');
      expect(Array.isArray(result.inserted)).toBe(true);
      expect(typeof result.skippedCount).toBe('number');
    });
  });
});
