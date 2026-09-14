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
import { documentVersions } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';

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
  let database: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    database = stubDatabase();
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

      const mockRow = createMockVersionRow({
        version_number: 3,
        snapshot: { root: { title: 'New Content' } },
      });
      database.on(documentVersions).insert.returnsRaw([mockRow]);

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
      expect(database.calls(documentVersions).insert).toHaveLength(1);
    });

    it('should return null when snapshot is unchanged (dedup)', async () => {
      const { syncCrdtToPostgresConsolidated } = await import(
        '../../src/services/crdt-sync-service'
      );

      // CTE query returns empty result when snapshot matches latest (default: unstubbed insert returns no rows)

      const result = await syncCrdtToPostgresConsolidated({
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: { root: { title: 'Same Content' } },

        actorId: 'user-uuid-001',
        actorType: 'user',
      });

      expect(result).toBeNull();
      expect(database.calls(documentVersions).insert).toHaveLength(1);
    });

    it('should execute a CTE query with correct parameters', async () => {
      const { syncCrdtToPostgresConsolidated } = await import(
        '../../src/services/crdt-sync-service'
      );

      const mockRow = createMockVersionRow();
      database.on(documentVersions).insert.returnsRaw([mockRow]);

      await syncCrdtToPostgresConsolidated({
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: { root: { title: 'Test' } },

        actorId: 'user-uuid-001',
        actorType: 'user',
      });

      // Verify the query uses a CTE pattern
      const call = database.calls(documentVersions).insert[0];
      expect(call.sql).toContain('WITH');
      expect(call.sql).toContain('INSERT INTO app.document_versions');
      expect(call.sql).toContain('RETURNING');

      // Verify the values the statement carries: documentId, branchId,
      // snapshot (as JSON text — the jsonb column is stringified before
      // binding), actorId, actorType.
      expect(call.params).toContain('doc-uuid-123');
      expect(call.params).toContain('branch-uuid-456');
      expect(call.params).toContain(JSON.stringify({ root: { title: 'Test' } }));
      expect(call.params).toContain('user-uuid-001');
      expect(call.params).toContain('user');
    });

    it('should create first version when no prior versions exist', async () => {
      const { syncCrdtToPostgresConsolidated } = await import(
        '../../src/services/crdt-sync-service'
      );

      const mockRow = createMockVersionRow({ version_number: 1 });
      database.on(documentVersions).insert.returnsRaw([mockRow]);

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

      const mockRow = createMockVersionRow({
        created_by_id: 'agent-uuid-001',
        created_by_type: 'agent',
      });
      database.on(documentVersions).insert.returnsRaw([mockRow]);

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

      database.on(documentVersions).insert.rejects(new Error('connection refused'));

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

      const mockRow = createMockVersionRow();
      database.on(documentVersions).insert.returnsRaw([mockRow]);

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
