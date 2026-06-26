/**
 * Phase 3.1: Document Service Tests (TDD)
 *
 * Tests for Document CRUD operations.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 3.1: Document Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Mock document row type (database format)
  interface MockDocumentRow {
    id: string;
    site_id: string;
    path: string;
    created_at: string;
  }

  // Helper to create a mock document row (database format)
  function createMockDocumentRow(overrides: Partial<MockDocumentRow> = {}): MockDocumentRow {
    return {
      id: 'doc-uuid-123',
      site_id: 'site-uuid-456',
      path: 'pages/home',
      created_at: '2026-01-23T10:00:00.000Z',
      ...overrides,
    };
  }

  describe('createDocument', () => {
    it('should create a document with generated ID', async () => {
      const { createDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const mockRow = createMockDocumentRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createDocument({
        siteId: 'site-uuid-456',
        path: 'pages/home',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('doc-uuid-123');
      expect(result.siteId).toBe('site-uuid-456');
      expect(result.path).toBe('pages/home');
      expect(result.createdAt).toBeDefined();
    });

    it('should throw SiteNotFoundError when site does not exist', async () => {
      const { createDocument, SiteNotFoundError } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      // Simulate foreign key violation
      const error = new Error('violates foreign key constraint');
      (error as NodeJS.ErrnoException).code = '23503';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(
        createDocument({
          siteId: 'non-existent-site',
          path: 'pages/test',
        }),
      ).rejects.toThrow(SiteNotFoundError);
    });

    it('should throw DuplicateDocumentPathError for duplicate path in same site', async () => {
      const { createDocument, DuplicateDocumentPathError } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      // Simulate unique constraint violation
      const error = new Error('duplicate key value violates unique constraint');
      (error as NodeJS.ErrnoException).code = '23505';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(
        createDocument({
          siteId: 'site-1',
          path: 'pages/existing',
        }),
      ).rejects.toThrow(DuplicateDocumentPathError);
    });

    it('should normalize empty path to root path', async () => {
      const { createDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const mockRow = createMockDocumentRow({ path: '/' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createDocument({
        siteId: 'site-1',
        path: '',
      });

      expect(result.path).toBe('/');
    });

    it('should normalize path with leading slash', async () => {
      const { createDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const mockDocRow = createMockDocumentRow({ path: 'pages/home' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockDocRow] });

      const result = await createDocument({
        siteId: 'site-1',
        path: '/pages/home',
      });

      expect(result.path).toBe('pages/home');
      expect(vi.mocked(db.query)).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO app.documents'),
        ['site-1', 'pages/home'],
      );
    });

    it('should normalize path with trailing slash', async () => {
      const { createDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const mockDocRow = createMockDocumentRow({ path: 'pages/home' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockDocRow] });

      const result = await createDocument({
        siteId: 'site-1',
        path: 'pages/home/',
      });

      expect(result.path).toBe('pages/home');
      expect(vi.mocked(db.query)).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO app.documents'),
        ['site-1', 'pages/home'],
      );
    });

    it('should throw InvalidDocumentPathError for path with traversal sequence', async () => {
      const { createDocument, InvalidDocumentPathError } = await import('../../src/services/document-service');

      await expect(
        createDocument({
          siteId: 'site-1',
          path: 'pages/../etc/passwd',
        }),
      ).rejects.toThrow(InvalidDocumentPathError);
    });

    it('should throw InvalidDocumentPathError for path with double dots as complete segment', async () => {
      const { createDocument, InvalidDocumentPathError } = await import('../../src/services/document-service');

      // ".." as a complete path segment should be rejected
      await expect(
        createDocument({
          siteId: 'site-1',
          path: '../pages',
        }),
      ).rejects.toThrow(InvalidDocumentPathError);

      await expect(
        createDocument({
          siteId: 'site-1',
          path: 'pages/../home',
        }),
      ).rejects.toThrow(InvalidDocumentPathError);
    });

    it('should allow filenames containing ".." that are not path traversal', async () => {
      const { createDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const mockRow = createMockDocumentRow({
        path: '..hidden',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createDocument({
        siteId: 'site-1',
        path: '..hidden',
      });

      expect(result.path).toBe('..hidden');
    });

    it('should return created document with timestamp', async () => {
      const { createDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const mockRow = createMockDocumentRow({
        created_at: '2026-01-23T15:30:00.000Z',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await createDocument({
        siteId: 'site-1',
        path: 'components/header',
      });

      expect(result.createdAt).toBe('2026-01-23T15:30:00.000Z');
    });

    it('should execute INSERT query with correct parameters', async () => {
      const { createDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const mockRow = createMockDocumentRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await createDocument({
        siteId: 'site-abc',
        path: 'templates/main',
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining(['site-abc', 'templates/main']),
      );
    });
  });

  describe('getDocument', () => {
    it('should return document when found', async () => {
      const { getDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const mockRow = createMockDocumentRow({ id: 'doc-123' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getDocument('doc-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('doc-123');
    });

    it('should return null when document not found', async () => {
      const { getDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getDocument('non-existent');

      expect(result).toBeNull();
    });

    it('should query by document ID', async () => {
      const { getDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getDocument('doc-xyz');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('id'),
        expect.arrayContaining(['doc-xyz']),
      );
    });

    it('should map database row to Document type', async () => {
      const { getDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const mockRow = createMockDocumentRow({
        id: 'doc-456',
        site_id: 'site-789',
        path: 'pages/about',
        created_at: '2026-01-20T08:00:00.000Z',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getDocument('doc-456');

      expect(result).toMatchObject({
        id: 'doc-456',
        siteId: 'site-789',
        path: 'pages/about',
        createdAt: '2026-01-20T08:00:00.000Z',
      });
    });
  });

  describe('getDocumentByPath', () => {
    it('should return document when found by path', async () => {
      const { getDocumentByPath } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const mockRow = createMockDocumentRow({ path: 'pages/contact' });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await getDocumentByPath('site-1', 'pages/contact');

      expect(result).not.toBeNull();
      expect(result?.path).toBe('pages/contact');
    });

    it('should return null when path not found', async () => {
      const { getDocumentByPath } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getDocumentByPath('site-1', 'pages/non-existent');

      expect(result).toBeNull();
    });

    it('should be case-sensitive for paths', async () => {
      const { getDocumentByPath } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getDocumentByPath('site-1', 'Pages/Home');

      // Should query with exact case
      expect(db.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['site-1', 'Pages/Home']),
      );
    });

    it('should query by site_id and path', async () => {
      const { getDocumentByPath } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getDocumentByPath('site-abc', 'components/footer');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/site_id.*path|path.*site_id/),
        expect.arrayContaining(['site-abc', 'components/footer']),
      );
    });

    it('should not return archived documents', async () => {
      const { getDocumentByPath } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      // Return empty result to simulate archived-only scenario
      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getDocumentByPath('site-1', 'pages/archived');

      expect(result).toBeNull();
      // Verify query includes archived_at IS NULL filter
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('archived_at IS NULL'),
        expect.any(Array),
      );
    });
  });

  describe('updateDocumentPath', () => {
    it('should update document path', async () => {
      const { updateDocumentPath } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const updatedRow = createMockDocumentRow({
        id: 'doc-123',
        path: 'pages/new-path',
      });
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      const result = await updateDocumentPath('doc-123', 'pages/new-path');

      expect(result).not.toBeNull();
      expect(result?.path).toBe('pages/new-path');
    });

    it('should throw DuplicateDocumentPathError when new path already exists', async () => {
      const { updateDocumentPath, DuplicateDocumentPathError } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      // Simulate unique constraint violation
      const error = new Error('duplicate key value violates unique constraint');
      (error as NodeJS.ErrnoException).code = '23505';
      vi.mocked(db.query).mockRejectedValue(error);

      await expect(
        updateDocumentPath('doc-123', 'pages/existing-path'),
      ).rejects.toThrow(DuplicateDocumentPathError);
    });

    it('should return null when document not found', async () => {
      const { updateDocumentPath } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await updateDocumentPath('non-existent', 'pages/new');

      expect(result).toBeNull();
    });

    it('should normalize new path format', async () => {
      const { updateDocumentPath } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const updatedRow = createMockDocumentRow({ path: 'pages/updated' });
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      await updateDocumentPath('doc-123', '/pages/updated/');

      expect(vi.mocked(db.query)).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE app.documents'),
        ['pages/updated', 'doc-123'],
      );
    });

    it('should execute UPDATE query', async () => {
      const { updateDocumentPath } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const updatedRow = createMockDocumentRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [updatedRow] });

      await updateDocumentPath('doc-123', 'pages/updated');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE'),
        expect.arrayContaining(['pages/updated', 'doc-123']),
      );
    });
  });

  describe('deleteDocument', () => {
    it('should delete document when found', async () => {
      const { deleteDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await deleteDocument('doc-123');

      expect(result).toBe(true);
    });

    it('should return false when document not found', async () => {
      const { deleteDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await deleteDocument('non-existent');

      expect(result).toBe(false);
    });

    it('should execute DELETE query', async () => {
      const { deleteDocument } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });

      await deleteDocument('doc-to-delete');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        expect.arrayContaining(['doc-to-delete']),
      );
    });
  });

  describe('listDocuments', () => {
    it('should return all documents for a site', async () => {
      const { listDocuments } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockDocumentRow({ id: 'doc-1', path: 'pages/home' }),
        createMockDocumentRow({ id: 'doc-2', path: 'pages/about' }),
        createMockDocumentRow({ id: 'doc-3', path: 'components/header' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listDocuments('site-1');

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('doc-1');
      expect(result[1].id).toBe('doc-2');
      expect(result[2].id).toBe('doc-3');
    });

    it('should support limit option', async () => {
      const { listDocuments } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listDocuments('site-1', { limit: 10 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([10]),
      );
    });

    it('should support offset option', async () => {
      const { listDocuments } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listDocuments('site-1', { offset: 20 });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET'),
        expect.arrayContaining([20]),
      );
    });

    it('should support pathPrefix filter', async () => {
      const { listDocuments } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockDocumentRow({ path: 'pages/home' }),
        createMockDocumentRow({ path: 'pages/about' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      await listDocuments('site-1', { pathPrefix: 'pages/' });

      // After normalization, 'pages/' becomes 'pages' (trailing slash removed)
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("ESCAPE '\\'"),
        expect.arrayContaining(['pages%']),
      );
    });

    it('should escape LIKE wildcards in pathPrefix', async () => {
      const { listDocuments } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      // User input with SQL LIKE wildcards that should be escaped
      await listDocuments('site-1', { pathPrefix: 'pages/100%_discount' });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("ESCAPE '\\'"),
        // % escaped to \%, _ escaped to \_
        expect.arrayContaining(['pages/100\\%\\_discount%']),
      );
    });

    it('should return empty array for empty site', async () => {
      const { listDocuments } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listDocuments('empty-site');

      expect(result).toEqual([]);
    });

    it('should return empty array when no documents match pathPrefix', async () => {
      const { listDocuments } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listDocuments('site-1', { pathPrefix: 'non-existent/' });

      expect(result).toEqual([]);
    });

    it('should filter by site_id', async () => {
      const { listDocuments } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listDocuments('specific-site-id');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('site_id'),
        expect.arrayContaining(['specific-site-id']),
      );
    });

    it('should map all rows to Document objects', async () => {
      const { listDocuments } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockDocumentRow({
          id: 'doc-1',
          site_id: 'site-abc',
          path: 'pages/test',
        }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listDocuments('site-abc');

      expect(result[0]).toMatchObject({
        id: 'doc-1',
        siteId: 'site-abc',
        path: 'pages/test',
      });
    });
  });

  describe('documentExists', () => {
    it('should return true when document exists', async () => {
      const { documentExists } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ exists: true }] });

      const result = await documentExists('site-1', 'pages/home');

      expect(result).toBe(true);
    });

    it('should return false when document does not exist', async () => {
      const { documentExists } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ exists: false }] });

      const result = await documentExists('site-1', 'pages/non-existent');

      expect(result).toBe(false);
    });

    it('should check by site_id and path', async () => {
      const { documentExists } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ exists: false }] });

      await documentExists('site-xyz', 'components/widget');

      expect(db.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['site-xyz', 'components/widget']),
      );
    });
  });

  describe('Error Classes', () => {
    it('SiteNotFoundError should be an instance of Error', async () => {
      const { SiteNotFoundError } = await import('../../src/services/document-service');

      const error = new SiteNotFoundError('site-123');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('SiteNotFoundError');
      expect(error.siteId).toBe('site-123');
    });

    it('DuplicateDocumentPathError should include path and siteId', async () => {
      const { DuplicateDocumentPathError } = await import('../../src/services/document-service');

      const error = new DuplicateDocumentPathError('pages/home', 'site-123');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('DuplicateDocumentPathError');
      expect(error.path).toBe('pages/home');
      expect(error.siteId).toBe('site-123');
    });

    it('InvalidDocumentPathError should include path and reason', async () => {
      const { InvalidDocumentPathError } = await import('../../src/services/document-service');

      const error = new InvalidDocumentPathError('path cannot be empty');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('InvalidDocumentPathError');
      expect(error.message).toContain('path cannot be empty');
    });
  });

  // =============================================================================
  // Branch-Scoped Document Operations (Phase 1)
  // =============================================================================

  describe('Branch-Scoped Document Operations', () => {
    // Mock document version row type (database format)
    interface MockDocumentVersionRow {
      id: string;
      document_id: string;
      branch_id: string;
      version_number: number;
      snapshot: Record<string, unknown>;
      source: string;
      created_by_id: string;
      created_by_type: 'user' | 'agent' | 'system';
      created_at: string;
      is_tombstone: boolean;
    }

    // Helper to create a mock document version row
    function createMockVersionRow(overrides: Partial<MockDocumentVersionRow> = {}): MockDocumentVersionRow {
      return {
        id: 'version-uuid-123',
        document_id: 'doc-uuid-123',
        branch_id: 'branch-uuid-456',
        version_number: 1,
        snapshot: {},
        source: 'edit',
        created_by_id: 'user-uuid-789',
        created_by_type: 'user',
        created_at: '2026-01-23T10:00:00.000Z',
        is_tombstone: false,
        ...overrides,
      };
    }

    describe('listDocumentsOnBranch', () => {
      it('should return documents that have versions on the branch', async () => {
        const { listDocumentsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const mockRows = [
          createMockDocumentRow({ id: 'doc-1', path: 'pages/home' }),
          createMockDocumentRow({ id: 'doc-2', path: 'pages/about' }),
        ];
        vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

        const result = await listDocumentsOnBranch('branch-uuid-456');

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('doc-1');
        expect(result[1].id).toBe('doc-2');
      });

      it('should filter by branchId in the query', async () => {
        const { listDocumentsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listDocumentsOnBranch('branch-abc-123');

        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('branch_id'),
          expect.arrayContaining(['branch-abc-123']),
        );
      });

      it('should join with document_versions table', async () => {
        const { listDocumentsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listDocumentsOnBranch('branch-uuid-456');

        expect(db.query).toHaveBeenCalledWith(
          expect.stringMatching(/JOIN.*document_versions|document_versions.*JOIN/i),
          expect.any(Array),
        );
      });

      it('should exclude tombstoned documents', async () => {
        const { listDocumentsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listDocumentsOnBranch('branch-uuid-456');

        // Query should filter out documents with _deleted tombstone
        expect(db.query).toHaveBeenCalledWith(
          expect.stringMatching(/_deleted|tombstone/i),
          expect.any(Array),
        );
      });

      it('should return empty array when no documents on branch', async () => {
        const { listDocumentsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        const result = await listDocumentsOnBranch('empty-branch');

        expect(result).toEqual([]);
      });

      it('should support pathPrefix option', async () => {
        const { listDocumentsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await listDocumentsOnBranch('branch-uuid-456', { pathPrefix: 'pages/' });

        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('LIKE'),
          expect.arrayContaining(['pages/%']),
        );
      });

      it('should include main branch published documents when mainBranchId is provided', async () => {
        const { listDocumentsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const mockRows = [
          createMockDocumentRow({ id: 'doc-branch-1', path: 'pages/local' }),
          createMockDocumentRow({ id: 'doc-main-1', path: 'pages/inherited' }),
        ];
        vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

        const result = await listDocumentsOnBranch('branch-feature-uuid', {
          mainBranchId: 'branch-main-uuid',
        });

        expect(result).toHaveLength(2);
        // Query should use UNION to include main branch published docs
        expect(db.query).toHaveBeenCalledWith(
          expect.stringMatching(/UNION/i),
          expect.arrayContaining(['branch-feature-uuid', 'branch-main-uuid']),
        );
      });

      it('should exclude documents tombstoned on branch even when published on main', async () => {
        const { listDocumentsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        // Only the non-tombstoned doc should be returned
        const mockRows = [
          createMockDocumentRow({ id: 'doc-main-1', path: 'pages/inherited' }),
        ];
        vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

        const result = await listDocumentsOnBranch('branch-feature-uuid', {
          mainBranchId: 'branch-main-uuid',
        });

        expect(result).toHaveLength(1);
        // Query should exclude tombstoned documents from the UNION
        expect(db.query).toHaveBeenCalledWith(
          expect.stringMatching(/_deleted|tombstone/i),
          expect.any(Array),
        );
      });

      it('should not duplicate documents that exist on both branch and main', async () => {
        const { listDocumentsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        // Document exists on both branch and main — should appear only once
        const mockRows = [
          createMockDocumentRow({ id: 'doc-shared-1', path: 'pages/home' }),
        ];
        vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

        const result = await listDocumentsOnBranch('branch-feature-uuid', {
          mainBranchId: 'branch-main-uuid',
        });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('doc-shared-1');
        // Query should handle deduplication (e.g., via UNION which deduplicates, or EXCEPT/NOT IN)
        expect(db.query).toHaveBeenCalledWith(
          expect.stringMatching(/UNION|EXCEPT|NOT IN|NOT EXISTS/i),
          expect.any(Array),
        );
      });

      it('should work without mainBranchId (backward compatible)', async () => {
        const { listDocumentsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const mockRows = [
          createMockDocumentRow({ id: 'doc-1', path: 'pages/home' }),
        ];
        vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

        const result = await listDocumentsOnBranch('branch-uuid-456');

        expect(result).toHaveLength(1);
        // Without mainBranchId, should NOT use UNION
        expect(db.query).toHaveBeenCalledWith(
          expect.not.stringMatching(/UNION/i),
          expect.any(Array),
        );
      });
    });

    describe('createDocumentOnBranch', () => {
      it('should create a document and its initial version', async () => {
        const { createDocumentOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const docRow = createMockDocumentRow({ id: 'new-doc-id', path: 'pages/new' });
        const versionRow = createMockVersionRow({ document_id: 'new-doc-id' });

        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_doc
          .mockResolvedValueOnce({ rows: [docRow] }) // INSERT document
          .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT insert_doc
          .mockResolvedValueOnce({ rows: [versionRow] }) // INSERT version
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await createDocumentOnBranch({
          siteId: 'site-uuid-456',
          branchId: 'branch-uuid-456',
          path: 'pages/new',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        });

        expect(result.document).toBeDefined();
        expect(result.document.id).toBe('new-doc-id');
        expect(result.version).toBeDefined();
      });

      it('should create version with empty snapshot by default', async () => {
        const { createDocumentOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const docRow = createMockDocumentRow();
        const versionRow = createMockVersionRow({ snapshot: {} });

        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_doc
          .mockResolvedValueOnce({ rows: [docRow] }) // INSERT document
          .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT insert_doc
          .mockResolvedValueOnce({ rows: [versionRow] }) // INSERT version
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await createDocumentOnBranch({
          siteId: 'site-uuid-456',
          branchId: 'branch-uuid-456',
          path: 'pages/test',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        });

        expect(result.version.snapshot).toEqual({});
      });

      it('should reuse existing document if path already exists but no version on this branch', async () => {
        const { createDocumentOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const existingDocRow = createMockDocumentRow({ id: 'existing-doc-id', path: 'pages/existing' });
        const versionRow = createMockVersionRow({ document_id: 'existing-doc-id' });

        // Simulate unique constraint violation on document insert, then find existing
        const uniqueError = new Error('duplicate key');
        (uniqueError as NodeJS.ErrnoException).code = '23505';

        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_doc
          .mockRejectedValueOnce(uniqueError) // INSERT document fails
          .mockResolvedValueOnce({ rows: [] }) // ROLLBACK TO SAVEPOINT insert_doc
          .mockResolvedValueOnce({ rows: [existingDocRow] }) // SELECT existing doc
          .mockResolvedValueOnce({ rows: [] }) // SELECT latest version on branch (none exists)
          .mockResolvedValueOnce({ rows: [versionRow] }) // INSERT version
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await createDocumentOnBranch({
          siteId: 'site-uuid-456',
          branchId: 'branch-uuid-456',
          path: 'pages/existing',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        });

        expect(result.document.id).toBe('existing-doc-id');
      });

      it('should throw DuplicateDocumentPathError if non-tombstoned version exists on branch', async () => {
        const { createDocumentOnBranch, DuplicateDocumentPathError } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const existingDocRow = createMockDocumentRow({ id: 'existing-doc-id', path: 'pages/existing' });
        const existingVersionRow = createMockVersionRow({
          document_id: 'existing-doc-id',
          snapshot: { content: 'existing content' },
        });

        // Simulate unique constraint violation on document insert, then find existing
        const uniqueError = new Error('duplicate key');
        (uniqueError as NodeJS.ErrnoException).code = '23505';

        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_doc
          .mockRejectedValueOnce(uniqueError) // INSERT document fails
          .mockResolvedValueOnce({ rows: [] }) // ROLLBACK TO SAVEPOINT insert_doc
          .mockResolvedValueOnce({ rows: [existingDocRow] }) // SELECT existing doc
          // SELECT latest version on branch (exists, not tombstoned)
          .mockResolvedValueOnce({ rows: [existingVersionRow] })
          .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

        await expect(
          createDocumentOnBranch({
            siteId: 'site-uuid-456',
            branchId: 'branch-uuid-456',
            path: 'pages/existing',
            createdById: 'user-uuid-789',
            createdByType: 'user',
          }),
        ).rejects.toThrow(DuplicateDocumentPathError);
      });

      it('should recreate document fresh if latest version on branch is tombstoned', async () => {
        const { createDocumentOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const existingDocRow = createMockDocumentRow({ id: 'existing-doc-id', path: 'pages/existing' });
        const tombstonedVersionRow = createMockVersionRow({
          document_id: 'existing-doc-id',
          snapshot: { _deleted: true },
          is_tombstone: true,
        });
        const newVersionRow = createMockVersionRow({
          document_id: 'existing-doc-id',
          version_number: 1,
          source: 'recreate',
        });

        // Simulate unique constraint violation on document insert, then find existing
        const uniqueError = new Error('duplicate key');
        (uniqueError as NodeJS.ErrnoException).code = '23505';

        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_doc
          .mockRejectedValueOnce(uniqueError) // INSERT document fails
          .mockResolvedValueOnce({ rows: [] }) // ROLLBACK TO SAVEPOINT insert_doc
          .mockResolvedValueOnce({ rows: [existingDocRow] }) // SELECT existing doc
          .mockResolvedValueOnce({ rows: [tombstonedVersionRow] }) // SELECT latest version (tombstoned)
          .mockResolvedValueOnce({ rows: [] }) // DELETE all versions on branch
          .mockResolvedValueOnce({ rows: [newVersionRow] }) // INSERT new version (version 1)
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await createDocumentOnBranch({
          siteId: 'site-uuid-456',
          branchId: 'branch-uuid-456',
          path: 'pages/existing',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        });

        expect(result.document.id).toBe('existing-doc-id');
        expect(result.version.source).toBe('recreate');
      });

      it('should throw SiteNotFoundError when site does not exist', async () => {
        const { createDocumentOnBranch, SiteNotFoundError } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        // Simulate foreign key violation on document insert
        const fkError = new Error('violates foreign key constraint');
        (fkError as NodeJS.ErrnoException).code = '23503';

        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_doc
          .mockRejectedValueOnce(fkError) // INSERT document fails
          .mockResolvedValueOnce({ rows: [] }) // ROLLBACK TO SAVEPOINT insert_doc
          .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

        await expect(
          createDocumentOnBranch({
            siteId: 'non-existent-site',
            branchId: 'branch-uuid-456',
            path: 'pages/test',
            createdById: 'user-uuid-789',
            createdByType: 'user',
          }),
        ).rejects.toThrow(SiteNotFoundError);
      });

      it('should normalize path with leading slash', async () => {
        const { createDocumentOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const mockDocRow = createMockDocumentRow({ path: 'pages/test' });
        const mockVersionRow = createMockVersionRow();

        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_doc
          .mockResolvedValueOnce({ rows: [mockDocRow] }) // INSERT document (normalized path)
          .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT insert_doc
          .mockResolvedValueOnce({ rows: [mockVersionRow] }) // INSERT version
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await createDocumentOnBranch({
          siteId: 'site-uuid-456',
          branchId: 'branch-uuid-456',
          path: '/pages/test/',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        });

        expect(result.document.path).toBe('pages/test');
      });

      it('should set version source to edit', async () => {
        const { createDocumentOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const docRow = createMockDocumentRow();
        const versionRow = createMockVersionRow({ source: 'edit' });

        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_doc
          .mockResolvedValueOnce({ rows: [docRow] }) // INSERT document
          .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT insert_doc
          .mockResolvedValueOnce({ rows: [versionRow] }) // INSERT version
          .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await createDocumentOnBranch({
          siteId: 'site-uuid-456',
          branchId: 'branch-uuid-456',
          path: 'pages/test',
          createdById: 'user-uuid-789',
          createdByType: 'user',
        });

        expect(result.version.source).toBe('edit');
      });
    });

    describe('documentExistsOnBranch', () => {
      it('should return true when document has version on branch', async () => {
        const { documentExistsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [{ exists: true }] });

        const result = await documentExistsOnBranch('doc-uuid-123', 'branch-uuid-456');

        expect(result).toBe(true);
      });

      it('should return false when document has no version on branch', async () => {
        const { documentExistsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [{ exists: false }] });

        const result = await documentExistsOnBranch('doc-uuid-123', 'branch-uuid-456');

        expect(result).toBe(false);
      });

      it('should return false when document is tombstoned on branch', async () => {
        const { documentExistsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        // Query should check for non-tombstoned versions
        vi.mocked(db.query).mockResolvedValue({ rows: [{ exists: false }] });

        const result = await documentExistsOnBranch('tombstoned-doc', 'branch-uuid-456');

        expect(result).toBe(false);
        expect(db.query).toHaveBeenCalledWith(
          expect.stringMatching(/is_tombstone/i),
          expect.any(Array),
        );
      });

      it('should check both documentId and branchId', async () => {
        const { documentExistsOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [{ exists: false }] });

        await documentExistsOnBranch('doc-xyz', 'branch-abc');

        expect(db.query).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining(['doc-xyz', 'branch-abc']),
        );
      });
    });

    describe('deleteDocumentOnBranch', () => {
      it('should create a tombstone version instead of deleting', async () => {
        const { deleteDocumentOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const tombstoneRow = createMockVersionRow({ snapshot: { _deleted: true } });
        vi.mocked(db.query).mockResolvedValue({ rows: [tombstoneRow] });

        await deleteDocumentOnBranch({
          documentId: 'doc-uuid-123',
          branchId: 'branch-uuid-456',
          deletedById: 'user-uuid-789',
          deletedByType: 'user',
        });

        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO app.document_versions'),
          expect.any(Array),
        );
      });

      it('should set snapshot to { _deleted: true }', async () => {
        const { deleteDocumentOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const tombstoneRow = createMockVersionRow({ snapshot: { _deleted: true } });
        vi.mocked(db.query).mockResolvedValue({ rows: [tombstoneRow] });

        await deleteDocumentOnBranch({
          documentId: 'doc-uuid-123',
          branchId: 'branch-uuid-456',
          deletedById: 'user-uuid-789',
          deletedByType: 'user',
        });

        // Check that the INSERT includes the tombstone marker
        const insertCall = vi.mocked(db.query).mock.calls.find(
          (call) =>
            typeof call[0] === 'string' &&
            call[0].includes('INSERT INTO app.document_versions'),
        );
        expect(insertCall).toBeDefined();
        if (insertCall && Array.isArray(insertCall[1])) {
          // One of the params should be the snapshot object with _deleted
          const hasDeletedSnapshot = insertCall[1].some(
            (param) =>
              typeof param === 'object' &&
              param !== null &&
              '_deleted' in param &&
              param._deleted === true,
          );
          expect(hasDeletedSnapshot).toBe(true);
        }
      });

      it('should return true when tombstone created successfully', async () => {
        const { deleteDocumentOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const tombstoneRow = createMockVersionRow({ snapshot: { _deleted: true } });
        vi.mocked(db.query).mockResolvedValue({ rows: [tombstoneRow] });

        const result = await deleteDocumentOnBranch({
          documentId: 'doc-uuid-123',
          branchId: 'branch-uuid-456',
          deletedById: 'user-uuid-789',
          deletedByType: 'user',
        });

        expect(result).toBe(true);
      });

      it('should throw DocumentNotFoundError when document does not exist', async () => {
        const { deleteDocumentOnBranch, DocumentNotFoundError } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        // Simulate foreign key violation (document doesn't exist)
        const fkError = new Error('violates foreign key constraint');
        (fkError as NodeJS.ErrnoException).code = '23503';
        vi.mocked(db.query).mockRejectedValue(fkError);

        await expect(
          deleteDocumentOnBranch({
            documentId: 'non-existent',
            branchId: 'branch-uuid-456',
            deletedById: 'user-uuid-789',
            deletedByType: 'user',
          }),
        ).rejects.toThrow(DocumentNotFoundError);
      });

      it('should set source to edit for the tombstone version', async () => {
        const { deleteDocumentOnBranch } = await import('../../src/services/document-service');
        const db = await import('../../src/db');

        const tombstoneRow = createMockVersionRow({ source: 'edit' });
        vi.mocked(db.query).mockResolvedValue({ rows: [tombstoneRow] });

        await deleteDocumentOnBranch({
          documentId: 'doc-uuid-123',
          branchId: 'branch-uuid-456',
          deletedById: 'user-uuid-789',
          deletedByType: 'user',
        });

        expect(db.query).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining(['edit']),
        );
      });
    });
  });
});
