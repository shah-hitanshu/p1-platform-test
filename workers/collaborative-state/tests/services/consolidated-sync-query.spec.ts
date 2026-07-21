/**
 * Phase 5.2: Consolidated Sync Query Tests (TDD)
 *
 * Tests for the consolidated single-query sync that replaces the 2-3 serial
 * queries per sync operation (getDocument + getLatestDocumentVersion +
 * createDocumentVersion) with a single CTE-based query.
 *
 * The consolidated query performs dedup check and insert atomically:
 * - Checks latest snapshot to avoid inserting duplicates
 * - Auto-increments version number
 * - Returns the new version or empty result (dedup)
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocumentVersionSource } from '../../src/types';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock document service (used by the existing syncCrdtToPostgres for validation)
vi.mock('../../src/services/document-service', () => ({
  getDocument: vi.fn(),
}));

// Mock document version service (still used by non-consolidated paths)
vi.mock('../../src/services/document-version-service', () => ({
  createDocumentVersion: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
}));

describe('Phase 5.2: Consolidated Sync Query', () => {
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
      source: 'realtime',
      created_by_id: 'user-uuid-001',
      created_by_type: 'user',
      created_at: '2026-03-01T10:00:00.000Z',
      ...overrides,
    };
  }

  // ===========================================================================
  // syncCrdtToPostgresConsolidated tests
  // ===========================================================================

  describe('syncCrdtToPostgresConsolidated', () => {
    it('should be exported from crdt-sync-service', async () => {
      const mod = await import('../../src/services/crdt-sync-service');
      expect(mod.syncCrdtToPostgresConsolidated).toBeDefined();
      expect(typeof mod.syncCrdtToPostgresConsolidated).toBe('function');
    });

    it('should create a new version with a single query when snapshot differs', async () => {
      const { syncCrdtToPostgresConsolidated } = await import(
        '../../src/services/crdt-sync-service'
      );
      const db = await import('../../src/db');

      const mockRow = createMockVersionRow({
        version_number: 3,
        snapshot: { root: { title: 'New Content' } },
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await syncCrdtToPostgresConsolidated({
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: { root: { title: 'New Content' } },

        actorId: 'user-uuid-001',
        actorType: 'user',
      });

      if (result === null) {
        throw new Error('Expected result to not be null');
      }
      expect(result.documentId).toBe('doc-uuid-123');
      expect(result.branchId).toBe('branch-uuid-456');
      expect(result.versionNumber).toBe(3);
      expect(result.source).toBe('realtime');

      // Verify only ONE query was executed (not 2-3)
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('should return null when snapshot is unchanged (dedup)', async () => {
      const { syncCrdtToPostgresConsolidated } = await import(
        '../../src/services/crdt-sync-service'
      );
      const db = await import('../../src/db');

      // CTE query returns empty result when snapshot matches latest
      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await syncCrdtToPostgresConsolidated({
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: { root: { title: 'Same Content' } },

        actorId: 'user-uuid-001',
        actorType: 'user',
      });

      expect(result).toBeNull();
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('should execute a CTE query with correct parameters', async () => {
      const { syncCrdtToPostgresConsolidated } = await import(
        '../../src/services/crdt-sync-service'
      );
      const db = await import('../../src/db');

      const mockRow = createMockVersionRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await syncCrdtToPostgresConsolidated({
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: { root: { title: 'Test' } },

        actorId: 'user-uuid-001',
        actorType: 'user',
      });

      // Verify the query uses a CTE pattern
      const call = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
      const queryStr = call[0];
      const queryParams = call[1];
      expect(queryStr).toContain('WITH');
      expect(queryStr).toContain('INSERT INTO app.document_versions');
      expect(queryStr).toContain('RETURNING');

      // Verify parameters: documentId, branchId, snapshot, actorId, actorType
      expect(queryParams[0]).toBe('doc-uuid-123'); // documentId
      expect(queryParams[1]).toBe('branch-uuid-456'); // branchId
      // snapshot should be JSON
      expect(queryParams[2]).toEqual({ root: { title: 'Test' } });
      expect(queryParams[3]).toBe('user-uuid-001'); // actorId
      expect(queryParams[4]).toBe('user'); // actorType
    });

    it('should create first version when no prior versions exist', async () => {
      const { syncCrdtToPostgresConsolidated } = await import(
        '../../src/services/crdt-sync-service'
      );
      const db = await import('../../src/db');

      const mockRow = createMockVersionRow({ version_number: 1 });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await syncCrdtToPostgresConsolidated({
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: { root: { title: 'First Version' } },

        actorId: 'user-uuid-001',
        actorType: 'user',
      });

      if (result === null) {
        throw new Error('Expected result to not be null');
      }
      expect(result.versionNumber).toBe(1);
    });

    it('should support agent actor type', async () => {
      const { syncCrdtToPostgresConsolidated } = await import(
        '../../src/services/crdt-sync-service'
      );
      const db = await import('../../src/db');

      const mockRow = createMockVersionRow({
        created_by_id: 'agent-uuid-001',
        created_by_type: 'agent',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await syncCrdtToPostgresConsolidated({
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: { root: {} },

        actorId: 'agent-uuid-001',
        actorType: 'agent',
      });

      if (result === null) {
        throw new Error('Expected result to not be null');
      }
      expect(result.createdById).toBe('agent-uuid-001');
      expect(result.createdByType).toBe('agent');
    });

    it('should throw on database errors', async () => {
      const { syncCrdtToPostgresConsolidated } = await import(
        '../../src/services/crdt-sync-service'
      );
      const db = await import('../../src/db');

      vi.mocked(db.query).mockRejectedValue(new Error('connection refused'));

      await expect(
        syncCrdtToPostgresConsolidated({
          documentId: 'doc-uuid-123',
          branchId: 'branch-uuid-456',
          snapshot: { root: {} },

          actorId: 'user-uuid-001',
          actorType: 'user',
        }),
      ).rejects.toThrow();
    });

    it('should validate required fields', async () => {
      const { syncCrdtToPostgresConsolidated } = await import(
        '../../src/services/crdt-sync-service'
      );

      // Missing documentId
      await expect(
        syncCrdtToPostgresConsolidated({
          documentId: '',
          branchId: 'branch-uuid-456',
          snapshot: { root: {} },

          actorId: 'user-uuid-001',
          actorType: 'user',
        }),
      ).rejects.toThrow();

      // Missing branchId
      await expect(
        syncCrdtToPostgresConsolidated({
          documentId: 'doc-uuid-123',
          branchId: '',
          snapshot: { root: {} },

          actorId: 'user-uuid-001',
          actorType: 'user',
        }),
      ).rejects.toThrow();

      // Missing actorId
      await expect(
        syncCrdtToPostgresConsolidated({
          documentId: 'doc-uuid-123',
          branchId: 'branch-uuid-456',
          snapshot: { root: {} },

          actorId: '',
          actorType: 'user',
        }),
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // ConsolidatedSyncParams type tests
  // ===========================================================================

  describe('ConsolidatedSyncParams', () => {
    it('should not require siteId (validation moved to DO level)', async () => {
      const { syncCrdtToPostgresConsolidated } = await import(
        '../../src/services/crdt-sync-service'
      );
      const db = await import('../../src/db');

      const mockRow = createMockVersionRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      // Should work without siteId — no getDocument() call needed
      const result = await syncCrdtToPostgresConsolidated({
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: { root: {} },

        actorId: 'user-uuid-001',
        actorType: 'user',
      });

      expect(result).not.toBeNull();
    });
  });
});
