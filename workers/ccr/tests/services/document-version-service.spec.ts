/**
 * Phase 3.3: Document Version Service Tests (TDD)
 *
 * Tests for Document Version CRUD operations.
 * Document versions are snapshots of document state on a specific branch.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { DocumentVersionSource } from '../../src/types';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documentVersions } from '../../src/db/schema';
import {
  createDocumentVersion,
  getDocumentVersion,
  getDocumentVersionByNumber,
  getLatestDocumentVersion,
  getLatestDocumentVersionWithFallback,
  getLatestVersionsForBranch,
  listDocumentVersions,
} from '../../src/services/document-version-service';
import {
  DocumentNotFoundError,
  InvalidDocumentVersionParamsError,
} from '../../src/services/errors';

describe('Phase 3.3: Document Version Service', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
  });

  // Mock document version row type (database format)
  type MockDocumentVersionRow = {
    id: string;
    document_id: string;
    branch_id: string;
    version_number: number;
    snapshot: Record<string, unknown>;
    source: DocumentVersionSource;
    created_by_id: string;
    created_by_type: 'user' | 'agent' | 'system';
    created_at: string;
    patch?: unknown[] | null;
    action_type?: string | null;
    action_metadata?: Record<string, unknown> | null;
  };

  // Helper to create a mock document version row
  function createMockVersionRow(overrides: Partial<MockDocumentVersionRow> = {}): MockDocumentVersionRow {
    return {
      id: 'version-uuid-123',
      document_id: 'doc-uuid-456',
      branch_id: 'branch-uuid-789',
      version_number: 1,
      snapshot: { title: 'Test Document', content: [] },
      source: 'edit',
      created_by_id: 'user-uuid-001',
      created_by_type: 'user',
      created_at: '2026-01-23T10:00:00.000Z',
      ...overrides,
    };
  }

  // Row shape for the Drizzle-backed reads (getDocumentVersion,
  // getLatestVersionsForBranch, listDocumentVersions): camelCase, plus the
  // sourceBranchName/isPublished columns those queries add via join/subquery.
  function createStubVersionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'version-uuid-123',
      documentId: 'doc-uuid-456',
      branchId: 'branch-uuid-789',
      versionNumber: 1,
      snapshot: { title: 'Test Document', content: [] },
      patch: null,
      actionType: null,
      actionMetadata: null,
      source: 'edit',
      createdById: 'user-uuid-001',
      createdByType: 'user',
      createdAt: new Date('2026-01-23T10:00:00.000Z'),
      isTombstone: false,
      sourceBranchId: null,
      sourceVersionId: null,
      publishedToVersionId: null,
      sourceBranchName: null,
      isPublished: false,
      ...overrides,
    };
  }

  describe('createDocumentVersion', () => {
    it('should create a document version with auto-incremented version number', async () => {
      const mockRow = createMockVersionRow({ version_number: 1 });
      database.on(documentVersions).insert.returnsRaw([mockRow]);

      const result = await createDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        snapshot: { title: 'Test Document', content: [] },
        source: 'edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('version-uuid-123');
      expect(result.documentId).toBe('doc-uuid-456');
      expect(result.branchId).toBe('branch-uuid-789');
      expect(result.versionNumber).toBe(1);
      expect(result.snapshot).toEqual({ title: 'Test Document', content: [] });
      expect(result.source).toBe('edit');
      expect(result.createdById).toBe('user-uuid-001');
      expect(result.createdByType).toBe('user');
    });

    it('should support different source types', async () => {
      const sources: DocumentVersionSource[] = ['edit', 'merge', 'revert', 'checkpoint'];

      for (const source of sources) {
        const mockRow = createMockVersionRow({ source });
        database.on(documentVersions).insert.returnsRaw([mockRow]);

        const result = await createDocumentVersion({
          documentId: 'doc-uuid-456',
          branchId: 'branch-uuid-789',
          snapshot: { title: 'Test' },
          source,
          createdById: 'user-uuid-001',
          createdByType: 'user',
        });

        expect(result.source).toBe(source);
      }
    });

    it('should throw DocumentNotFoundError when document does not exist', async () => {
      const error = new Error('violates foreign key constraint');
      (error as NodeJS.ErrnoException).code = '23503';

      // No version exists yet, so the write goes straight to the insert, which
      // is where the missing document surfaces.
      database.on(documentVersions).insert.rejects(error);

      await expect(
        createDocumentVersion({
          documentId: 'nonexistent-doc',
          branchId: 'branch-uuid-789',
          snapshot: { title: 'Test' },
          source: 'edit',
          createdById: 'user-uuid-001',
          createdByType: 'user',
        }),
      ).rejects.toThrow(DocumentNotFoundError);
    });

    // Note: snapshot validation is enforced by TypeScript at compile time

    it('should throw InvalidDocumentVersionParamsError when documentId is empty', async () => {

      await expect(
        createDocumentVersion({
          documentId: '',
          branchId: 'branch-uuid-789',
          snapshot: { title: 'Test' },
          source: 'edit',
          createdById: 'user-uuid-001',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidDocumentVersionParamsError);
    });

    it('should throw InvalidDocumentVersionParamsError when branchId is empty', async () => {

      await expect(
        createDocumentVersion({
          documentId: 'doc-uuid-456',
          branchId: '',
          snapshot: { title: 'Test' },
          source: 'edit',
          createdById: 'user-uuid-001',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidDocumentVersionParamsError);
    });

    it('should skip version creation when snapshot is unchanged from latest version', async () => {
      const existingSnapshot = { title: 'Same Title', content: [{ id: 'item1' }] };
      const mockExistingVersion = createMockVersionRow({
        version_number: 5,
        snapshot: existingSnapshot,
      });

      database.on(documentVersions).select.returnsRaw([mockExistingVersion]);

      const result = await createDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        snapshot: existingSnapshot,
        source: 'edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      // Should return existing version without creating new one
      expect(result.versionNumber).toBe(5);
      expect(database.calls(documentVersions).insert).toEqual([]);
    });

    it('should update action_metadata on existing version when snapshot unchanged but puckActions provided', async () => {
      const existingSnapshot = { title: 'Same', content: [{ type: 'A', props: { id: 'a1' } }] };
      const mockExistingVersion = createMockVersionRow({
        version_number: 5,
        snapshot: existingSnapshot,
        action_type: null,
        action_metadata: null,
      });

      database.on(documentVersions).select.returnsRaw([mockExistingVersion]);

      const result = await createDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        snapshot: existingSnapshot,
        source: 'edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        puckActions: [{ type: 'reorder', sourceIndex: 0, destinationIndex: 1 }],
      });

      // Should return existing version (no new version created)
      expect(result.versionNumber).toBe(5);
      // Should have called UPDATE to set action_metadata
      const [updateCall] = database.calls(documentVersions).update;
      expect(updateCall.sql).toContain('UPDATE');
      expect(updateCall.sql).toContain('action_type');
      expect(updateCall.sql).toContain('action_metadata');
      // Should return with actionType set
      expect(result.actionType).toBe('structural');
    });

    it('should NOT update action_metadata when snapshot unchanged and no puckActions', async () => {
      const existingSnapshot = { title: 'Same', content: [] };
      const mockExistingVersion = createMockVersionRow({
        version_number: 5,
        snapshot: existingSnapshot,
      });

      database.on(documentVersions).select.returnsRaw([mockExistingVersion]);

      const result = await createDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        snapshot: existingSnapshot,
        source: 'edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        // No puckActions — should skip entirely
      });

      expect(result.versionNumber).toBe(5);
      expect(database.calls(documentVersions).update).toEqual([]);
    });

    it('should create new version when snapshot differs from latest', async () => {
      const existingSnapshot = { title: 'Old Title' };
      const newSnapshot = { title: 'New Title' };
      const mockExistingVersion = createMockVersionRow({
        version_number: 5,
        snapshot: existingSnapshot,
      });
      const mockNewVersion = createMockVersionRow({
        version_number: 6,
        snapshot: newSnapshot,
      });

      database.on(documentVersions).select.returnsRaw([mockExistingVersion]);
      database.on(documentVersions).insert.returnsRaw([mockNewVersion]);

      const result = await createDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        snapshot: newSnapshot,
        source: 'edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      // Should create new version
      expect(result.versionNumber).toBe(6);
      expect(database.calls(documentVersions).insert).toHaveLength(1);
    });

    it('should skip deduplication check when skipDuplicateCheck is true', async () => {
      const sameSnapshot = { title: 'Same Title' };
      const mockNewVersion = createMockVersionRow({
        version_number: 6,
        snapshot: sameSnapshot,
      });

      database.on(documentVersions).insert.returnsRaw([mockNewVersion]);

      const result = await createDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        snapshot: sameSnapshot,
        source: 'revert',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        skipDuplicateCheck: true,
        skipCompaction: true,
      });

      // Should create new version despite same snapshot
      expect(result.versionNumber).toBe(6);
      // The insert runs on its own: no version was read to compare against.
      expect(database.statements).toHaveLength(1);
    });

    it('should persist sourceVersionId in the INSERT when provided', async () => {
      const snapshot = { title: 'Restored Content' };
      const sourceVersionId = 'source-version-uuid-111';
      const mockRow = createMockVersionRow({
        version_number: 3,
        snapshot,
        source: 'revert',
      });

      database.on(documentVersions).insert.returnsRaw([mockRow]);

      await createDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        snapshot,
        source: 'revert',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        skipDuplicateCheck: true,
        skipCompaction: true,
        sourceVersionId,
      });

      const [insertCall] = database.calls(documentVersions).insert;
      expect(insertCall.sql).toContain('source_version_id');
      expect(insertCall.params).toContain(sourceVersionId);
    });

    it('should leave source_version_id as null when sourceVersionId is omitted', async () => {
      const snapshot = { title: 'Normal Edit' };
      const mockRow = createMockVersionRow({ version_number: 2, snapshot });

      database.on(documentVersions).insert.returnsRaw([mockRow]);

      await createDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        snapshot,
        source: 'edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        skipDuplicateCheck: true,
        skipCompaction: true,
      });

      const [insertCall] = database.calls(documentVersions).insert;
      // source_version_id is the last value the statement casts to uuid.
      const cast = [...insertCall.sql.matchAll(/\$(\d+)::uuid/g)].at(-1) ?? [];
      expect(insertCall.params[Number(cast[1]) - 1]).toBeNull();
    });
  });

  describe('getDocumentVersion', () => {
    it('should return a document version by ID', async () => {

      database.on(documentVersions).select.returnsRaw([createStubVersionRow()]);

      const result = await getDocumentVersion('version-uuid-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('version-uuid-123');
      expect(result?.documentId).toBe('doc-uuid-456');
      expect(result?.branchId).toBe('branch-uuid-789');
    });

    it('should return null when version does not exist', async () => {

      const result = await getDocumentVersion('nonexistent-version');

      expect(result).toBeNull();
    });
  });

  describe('getLatestDocumentVersion', () => {
    it('should return the latest version for a document on a branch', async () => {
      const mockRow = createMockVersionRow({ version_number: 5 });
      database.on(documentVersions).select.returnsRaw([mockRow]);

      const result = await getLatestDocumentVersion('doc-uuid-456', 'branch-uuid-789');

      expect(result).toBeDefined();
      expect(result?.versionNumber).toBe(5);
    });

    it('should return null when no versions exist for document on branch', async () => {
      const result = await getLatestDocumentVersion('doc-uuid-456', 'branch-uuid-789');

      expect(result).toBeNull();
    });
  });

  describe('getLatestVersionsForBranch', () => {
    it('should return latest versions for all documents on a branch', async () => {

      const mockRows = [
        createMockVersionRow({ id: 'v1', document_id: 'doc-1', version_number: 3 }),
        createMockVersionRow({ id: 'v2', document_id: 'doc-2', version_number: 1 }),
        createMockVersionRow({ id: 'v3', document_id: 'doc-3', version_number: 7 }),
      ];
      database.on(documentVersions).select.returnsRaw(mockRows);

      const result = await getLatestVersionsForBranch('branch-uuid-789');

      expect(result).toHaveLength(3);
      expect(result[0].documentId).toBe('doc-1');
      expect(result[0].versionNumber).toBe(3);
      expect(result[1].documentId).toBe('doc-2');
      expect(result[2].documentId).toBe('doc-3');
    });

    it('should return empty array when no documents on branch', async () => {

      const result = await getLatestVersionsForBranch('branch-uuid-789');

      expect(result).toEqual([]);
    });
  });

  describe('listDocumentVersions', () => {
    it('should list all versions for a document on a branch in descending order', async () => {

      database.on(documentVersions).select.returnsRaw([
        createStubVersionRow({ versionNumber: 3 }),
        createStubVersionRow({ versionNumber: 2 }),
        createStubVersionRow({ versionNumber: 1 }),
      ]);

      const result = await listDocumentVersions('doc-uuid-456', 'branch-uuid-789');

      expect(result).toHaveLength(3);
      expect(result[0].versionNumber).toBe(3);
      expect(result[1].versionNumber).toBe(2);
      expect(result[2].versionNumber).toBe(1);
    });

    it('should support pagination with limit', async () => {

      database.on(documentVersions).select.returnsRaw([
        createStubVersionRow({ versionNumber: 3 }),
        createStubVersionRow({ versionNumber: 2 }),
      ]);

      const result = await listDocumentVersions('doc-uuid-456', 'branch-uuid-789', { limit: 2 });

      expect(result).toHaveLength(2);
      expect(database.calls(documentVersions).select[0].sql).toContain('limit');
    });

    it('should support pagination with offset', async () => {

      database.on(documentVersions).select.returnsRaw([createStubVersionRow({ versionNumber: 1 })]);

      const result = await listDocumentVersions('doc-uuid-456', 'branch-uuid-789', { limit: 1, offset: 2 });

      expect(result).toHaveLength(1);
      expect(database.calls(documentVersions).select[0].sql).toContain('offset');
    });

    it('should return empty array when no versions exist', async () => {

      const result = await listDocumentVersions('doc-uuid-456', 'branch-uuid-789');

      expect(result).toEqual([]);
    });
  });

  describe('getDocumentVersionByNumber', () => {
    it('should return a specific version by version number', async () => {
      const mockRow = createMockVersionRow({ version_number: 3 });
      database.on(documentVersions).select.returnsRaw([mockRow]);

      const result = await getDocumentVersionByNumber('doc-uuid-456', 'branch-uuid-789', 3);

      expect(result).toBeDefined();
      expect(result?.versionNumber).toBe(3);
    });

    it('should return null when version number does not exist', async () => {
      const result = await getDocumentVersionByNumber('doc-uuid-456', 'branch-uuid-789', 999);

      expect(result).toBeNull();
    });
  });

  describe('getLatestDocumentVersionWithFallback', () => {
    it('should return branch version with inherited=false when version exists on branch', async () => {
      const mockRow = createMockVersionRow({
        id: 'branch-version-1',
        document_id: 'doc-uuid-456',
        branch_id: 'branch-feature-uuid',
        version_number: 3,
      });
      database.on(documentVersions).select.whenBound(['branch-feature-uuid']).returnsRaw([mockRow]);

      const result = await getLatestDocumentVersionWithFallback(
        'doc-uuid-456',
        'branch-feature-uuid',
        'branch-main-uuid',
      );

      expect(result).not.toBeNull();
      expect(result?.version.id).toBe('branch-version-1');
      expect(result?.version.branchId).toBe('branch-feature-uuid');
      expect(result?.inherited).toBe(false);
    });

    it('should fall back to main published version with inherited=true when no branch version', async () => {
      const mockMainPublishedRow = createMockVersionRow({
        id: 'main-published-version',
        document_id: 'doc-uuid-456',
        branch_id: 'branch-main-uuid',
        version_number: 10,
        source: 'checkpoint',
      });
      // The branch holds no version, so the read that answers is the one bound
      // to main.
      database.on(documentVersions).select
        .whenBound(['branch-main-uuid'])
        .returnsRaw([mockMainPublishedRow]);

      const result = await getLatestDocumentVersionWithFallback(
        'doc-uuid-456',
        'branch-feature-uuid',
        'branch-main-uuid',
      );

      expect(result).not.toBeNull();
      expect(result?.version.id).toBe('main-published-version');
      expect(result?.version.branchId).toBe('branch-main-uuid');
      expect(result?.inherited).toBe(true);
    });

    it('should return null when no version on branch AND no published version on main', async () => {
      const result = await getLatestDocumentVersionWithFallback(
        'doc-uuid-456',
        'branch-feature-uuid',
        'branch-main-uuid',
      );

      expect(result).toBeNull();
    });

    it('should return branch version (not main) when both exist (branch takes priority)', async () => {
      const mockBranchRow = createMockVersionRow({
        id: 'branch-version-local',
        document_id: 'doc-uuid-456',
        branch_id: 'branch-feature-uuid',
        version_number: 2,
      });
      database.on(documentVersions).select
        .whenBound(['branch-feature-uuid'])
        .returnsRaw([mockBranchRow]);

      const result = await getLatestDocumentVersionWithFallback(
        'doc-uuid-456',
        'branch-feature-uuid',
        'branch-main-uuid',
      );

      expect(result).not.toBeNull();
      expect(result?.version.id).toBe('branch-version-local');
      expect(result?.inherited).toBe(false);
      // Should only query once — no fallback needed
      expect(database.statements).toHaveLength(1);
    });

    it('should NOT fall back when branchId === mainBranchId (main branch, no fallback)', async () => {
      // No version on main branch
      const result = await getLatestDocumentVersionWithFallback(
        'doc-uuid-456',
        'branch-main-uuid',
        'branch-main-uuid',
      );

      // Should return null, not attempt fallback
      expect(result).toBeNull();
      // Should only query once — no fallback for main branch
      expect(database.statements).toHaveLength(1);
    });

    it('should return inherited=true with main tombstone if main has tombstone and no branch version', async () => {
      const mockMainTombstoneRow = createMockVersionRow({
        id: 'main-tombstone-version',
        document_id: 'doc-uuid-456',
        branch_id: 'branch-main-uuid',
        version_number: 15,
        snapshot: { _deleted: true },
        source: 'edit',
      });
      database.on(documentVersions).select
        .whenBound(['branch-main-uuid'])
        .returnsRaw([mockMainTombstoneRow]);

      const result = await getLatestDocumentVersionWithFallback(
        'doc-uuid-456',
        'branch-feature-uuid',
        'branch-main-uuid',
      );

      // Should return the tombstone — caller is responsible for handling it
      expect(result).not.toBeNull();
      expect(result?.version.snapshot).toEqual({ _deleted: true });
      expect(result?.inherited).toBe(true);
    });
  });
});
