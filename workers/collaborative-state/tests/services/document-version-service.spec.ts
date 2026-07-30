/**
 * Phase 3.3: Document Version Service Tests (TDD)
 *
 * Tests for Document Version CRUD operations.
 * Document versions are snapshots of document state on a specific branch.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocumentVersionSource } from '../../src/types';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 3.3: Document Version Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Mock document version row type (database format)
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
    patch?: unknown[] | null;
    action_type?: string | null;
    action_metadata?: Record<string, unknown> | null;
  }

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

  describe('createDocumentVersion', () => {
    it('should create a document version with auto-incremented version number', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const mockRow = createMockVersionRow({ version_number: 1 });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

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
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const sources: DocumentVersionSource[] = ['edit', 'merge', 'revert', 'checkpoint'];

      for (const source of sources) {
        const mockRow = createMockVersionRow({ source });
        vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

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
      const { createDocumentVersion, DocumentNotFoundError } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const error = new Error('violates foreign key constraint');
      (error as NodeJS.ErrnoException).code = '23503';

      // First call is getLatestDocumentVersion (returns null - no existing version)
      // Second call is getLatestDocumentVersion again (for diff computation, returns null)
      // Third call is the INSERT which fails with FK error
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(error);

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
      const { createDocumentVersion, InvalidDocumentVersionParamsError } = await import('../../src/services/document-version-service');

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
      const { createDocumentVersion, InvalidDocumentVersionParamsError } = await import('../../src/services/document-version-service');

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
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const existingSnapshot = { title: 'Same Title', content: [{ id: 'item1' }] };
      const mockExistingVersion = createMockVersionRow({
        version_number: 5,
        snapshot: existingSnapshot,
      });

      // First call: getLatestDocumentVersion returns existing version with same snapshot
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockExistingVersion] });

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
      // query should only be called once (for getLatestDocumentVersion)
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('should update action_metadata on existing version when snapshot unchanged but puckActions provided', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const existingSnapshot = { title: 'Same', content: [{ type: 'A', props: { id: 'a1' } }] };
      const mockExistingVersion = createMockVersionRow({
        version_number: 5,
        snapshot: existingSnapshot,
        action_type: null,
        action_metadata: null,
      });

      // First call: getLatestDocumentVersion returns existing version with same snapshot
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockExistingVersion] });
      // Second call: UPDATE action_type/action_metadata on existing version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 });

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
      expect(db.query).toHaveBeenCalledTimes(2);
      const updateCall = vi.mocked(db.query).mock.calls[1];
      const updateSql = updateCall[0] as string;
      expect(updateSql).toContain('UPDATE');
      expect(updateSql).toContain('action_type');
      expect(updateSql).toContain('action_metadata');
      // Should return with actionType set
      expect(result.actionType).toBe('structural');
    });

    it('should NOT update action_metadata when snapshot unchanged and no puckActions', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const existingSnapshot = { title: 'Same', content: [] };
      const mockExistingVersion = createMockVersionRow({
        version_number: 5,
        snapshot: existingSnapshot,
      });

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockExistingVersion] });

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
      // Only one query (getLatestDocumentVersion), no UPDATE
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('should create new version when snapshot differs from latest', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

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

      // First call: getLatestDocumentVersion returns existing version with different snapshot
      // Second call: CTE with UPDATE (null previous snapshot) + INSERT (new baseline)
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockExistingVersion] })
        .mockResolvedValueOnce({ rows: [mockNewVersion] });

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
      // query should be called twice (check latest + CTE insert with nullify)
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it('should skip deduplication check when skipDuplicateCheck is true', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const sameSnapshot = { title: 'Same Title' };
      const mockNewVersion = createMockVersionRow({
        version_number: 6,
        snapshot: sameSnapshot,
      });

      // Only INSERT call (no getLatestDocumentVersion check)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockNewVersion] });

      const result = await createDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        snapshot: sameSnapshot,
        source: 'revert',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        skipDuplicateCheck: true,
      });

      // Should create new version despite same snapshot
      expect(result.versionNumber).toBe(6);
      // query should be called once (insert only, no check)
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('should persist sourceVersionId in the INSERT when provided', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const snapshot = { title: 'Restored Content' };
      const sourceVersionId = 'source-version-uuid-111';
      const mockRow = createMockVersionRow({
        version_number: 3,
        snapshot,
        source: 'revert',
      });

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockRow] });

      await createDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        snapshot,
        source: 'revert',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        skipDuplicateCheck: true,
        sourceVersionId,
      });

      const insertCall = vi.mocked(db.query).mock.calls[0];
      expect(insertCall[0]).toContain('source_version_id');
      expect(insertCall[1]).toContain(sourceVersionId);
    });

    it('should leave source_version_id as null when sourceVersionId is omitted', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const snapshot = { title: 'Normal Edit' };
      const mockRow = createMockVersionRow({ version_number: 2, snapshot });

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockRow] });

      await createDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        snapshot,
        source: 'edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        skipDuplicateCheck: true,
      });

      const insertCall = vi.mocked(db.query).mock.calls[0];
      const params = insertCall[1];
      // source_version_id is the last param ($13); confirm it is null when omitted
      const sourceVersionIdParam = params[params.length - 1];
      expect(sourceVersionIdParam).toBeNull();
    });
  });

  describe('getDocumentVersion', () => {
    it('should return a document version by ID', async () => {
      const { getDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const mockRow = createMockVersionRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getDocumentVersion('version-uuid-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('version-uuid-123');
      expect(result?.documentId).toBe('doc-uuid-456');
      expect(result?.branchId).toBe('branch-uuid-789');
    });

    it('should return null when version does not exist', async () => {
      const { getDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getDocumentVersion('nonexistent-version');

      expect(result).toBeNull();
    });
  });

  describe('getLatestDocumentVersion', () => {
    it('should return the latest version for a document on a branch', async () => {
      const { getLatestDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const mockRow = createMockVersionRow({ version_number: 5 });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getLatestDocumentVersion('doc-uuid-456', 'branch-uuid-789');

      expect(result).toBeDefined();
      expect(result?.versionNumber).toBe(5);
    });

    it('should return null when no versions exist for document on branch', async () => {
      const { getLatestDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getLatestDocumentVersion('doc-uuid-456', 'branch-uuid-789');

      expect(result).toBeNull();
    });
  });

  describe('getLatestVersionsForBranch', () => {
    it('should return latest versions for all documents on a branch', async () => {
      const { getLatestVersionsForBranch } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockVersionRow({ id: 'v1', document_id: 'doc-1', version_number: 3 }),
        createMockVersionRow({ id: 'v2', document_id: 'doc-2', version_number: 1 }),
        createMockVersionRow({ id: 'v3', document_id: 'doc-3', version_number: 7 }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await getLatestVersionsForBranch('branch-uuid-789');

      expect(result).toHaveLength(3);
      expect(result[0].documentId).toBe('doc-1');
      expect(result[0].versionNumber).toBe(3);
      expect(result[1].documentId).toBe('doc-2');
      expect(result[2].documentId).toBe('doc-3');
    });

    it('should return empty array when no documents on branch', async () => {
      const { getLatestVersionsForBranch } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getLatestVersionsForBranch('branch-uuid-789');

      expect(result).toEqual([]);
    });
  });

  describe('listDocumentVersions', () => {
    it('should list all versions for a document on a branch in descending order', async () => {
      const { listDocumentVersions } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockVersionRow({ version_number: 3 }),
        createMockVersionRow({ version_number: 2 }),
        createMockVersionRow({ version_number: 1 }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listDocumentVersions('doc-uuid-456', 'branch-uuid-789');

      expect(result).toHaveLength(3);
      expect(result[0].versionNumber).toBe(3);
      expect(result[1].versionNumber).toBe(2);
      expect(result[2].versionNumber).toBe(1);
    });

    it('should support pagination with limit', async () => {
      const { listDocumentVersions } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockVersionRow({ version_number: 3 }),
        createMockVersionRow({ version_number: 2 }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listDocumentVersions('doc-uuid-456', 'branch-uuid-789', { limit: 2 });

      expect(result).toHaveLength(2);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.any(Array),
      );
    });

    it('should support pagination with offset', async () => {
      const { listDocumentVersions } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const mockRows = [createMockVersionRow({ version_number: 1 })];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listDocumentVersions('doc-uuid-456', 'branch-uuid-789', { limit: 1, offset: 2 });

      expect(result).toHaveLength(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET'),
        expect.any(Array),
      );
    });

    it('should return empty array when no versions exist', async () => {
      const { listDocumentVersions } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listDocumentVersions('doc-uuid-456', 'branch-uuid-789');

      expect(result).toEqual([]);
    });
  });

  describe('getDocumentVersionByNumber', () => {
    it('should return a specific version by version number', async () => {
      const { getDocumentVersionByNumber } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const mockRow = createMockVersionRow({ version_number: 3 });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getDocumentVersionByNumber('doc-uuid-456', 'branch-uuid-789', 3);

      expect(result).toBeDefined();
      expect(result?.versionNumber).toBe(3);
    });

    it('should return null when version number does not exist', async () => {
      const { getDocumentVersionByNumber } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getDocumentVersionByNumber('doc-uuid-456', 'branch-uuid-789', 999);

      expect(result).toBeNull();
    });
  });

  describe('getLatestDocumentVersionWithFallback', () => {
    it('should return branch version with inherited=false when version exists on branch', async () => {
      const { getLatestDocumentVersionWithFallback } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const mockRow = createMockVersionRow({
        id: 'branch-version-1',
        document_id: 'doc-uuid-456',
        branch_id: 'branch-feature-uuid',
        version_number: 3,
      });
      // First query: getLatestDocumentVersion on the branch — returns a version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockRow] });

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
      const { getLatestDocumentVersionWithFallback } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const mockMainPublishedRow = createMockVersionRow({
        id: 'main-published-version',
        document_id: 'doc-uuid-456',
        branch_id: 'branch-main-uuid',
        version_number: 10,
        source: 'checkpoint',
      });
      // First query: getLatestDocumentVersion on branch — no version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Second query: getLatestPublishedDocumentVersion on main — returns published version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockMainPublishedRow] });

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
      const { getLatestDocumentVersionWithFallback } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      // First query: getLatestDocumentVersion on branch — no version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Second query: getLatestPublishedDocumentVersion on main — no version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const result = await getLatestDocumentVersionWithFallback(
        'doc-uuid-456',
        'branch-feature-uuid',
        'branch-main-uuid',
      );

      expect(result).toBeNull();
    });

    it('should return branch version (not main) when both exist (branch takes priority)', async () => {
      const { getLatestDocumentVersionWithFallback } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const mockBranchRow = createMockVersionRow({
        id: 'branch-version-local',
        document_id: 'doc-uuid-456',
        branch_id: 'branch-feature-uuid',
        version_number: 2,
      });
      // First query: getLatestDocumentVersion on the branch — returns a version
      // (should NOT proceed to second query)
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockBranchRow] });

      const result = await getLatestDocumentVersionWithFallback(
        'doc-uuid-456',
        'branch-feature-uuid',
        'branch-main-uuid',
      );

      expect(result).not.toBeNull();
      expect(result?.version.id).toBe('branch-version-local');
      expect(result?.inherited).toBe(false);
      // Should only query once — no fallback needed
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('should NOT fall back when branchId === mainBranchId (main branch, no fallback)', async () => {
      const { getLatestDocumentVersionWithFallback } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      // No version on main branch
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const result = await getLatestDocumentVersionWithFallback(
        'doc-uuid-456',
        'branch-main-uuid',
        'branch-main-uuid',
      );

      // Should return null, not attempt fallback
      expect(result).toBeNull();
      // Should only query once — no fallback for main branch
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('should return inherited=true with main tombstone if main has tombstone and no branch version', async () => {
      const { getLatestDocumentVersionWithFallback } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const mockMainTombstoneRow = createMockVersionRow({
        id: 'main-tombstone-version',
        document_id: 'doc-uuid-456',
        branch_id: 'branch-main-uuid',
        version_number: 15,
        snapshot: { _deleted: true },
        source: 'edit',
      });
      // First query: getLatestDocumentVersion on branch — no version
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      // Second query: getLatestPublishedDocumentVersion on main — returns tombstone
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [mockMainTombstoneRow] });

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
