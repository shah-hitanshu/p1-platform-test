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
    crdt_state: Buffer | null;
    source: DocumentVersionSource;
    created_by_id: string;
    created_by_type: 'user' | 'agent' | 'system';
    created_at: string;
  }

  // Helper to create a mock document version row
  function createMockVersionRow(overrides: Partial<MockDocumentVersionRow> = {}): MockDocumentVersionRow {
    return {
      id: 'version-uuid-123',
      document_id: 'doc-uuid-456',
      branch_id: 'branch-uuid-789',
      version_number: 1,
      snapshot: { title: 'Test Document', content: [] },
      crdt_state: null,
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

    it('should create a version with CRDT state', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const crdtBuffer = Buffer.from('mock-crdt-state');
      const mockRow = createMockVersionRow({ crdt_state: crdtBuffer });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        snapshot: { title: 'Test' },
        crdtState: 'bW9jay1jcmR0LXN0YXRl', // base64 encoded
        source: 'edit',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.crdtState).toBeDefined();
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
      vi.mocked(db.query).mockRejectedValue(error);

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

    it('should throw InvalidDocumentVersionParamsError when snapshot is missing', async () => {
      const { createDocumentVersion, InvalidDocumentVersionParamsError } = await import('../../src/services/document-version-service');

      await expect(
        createDocumentVersion({
          documentId: 'doc-uuid-456',
          branchId: 'branch-uuid-789',
          snapshot: null as unknown as Record<string, unknown>,
          source: 'edit',
          createdById: 'user-uuid-001',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidDocumentVersionParamsError);
    });

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
});
