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

    it('should throw InvalidDocumentPathError for empty path', async () => {
      const { createDocument, InvalidDocumentPathError } = await import('../../src/services/document-service');

      await expect(
        createDocument({
          siteId: 'site-1',
          path: '',
        }),
      ).rejects.toThrow(InvalidDocumentPathError);
    });

    it('should throw InvalidDocumentPathError for path with leading slash', async () => {
      const { createDocument, InvalidDocumentPathError } = await import('../../src/services/document-service');

      await expect(
        createDocument({
          siteId: 'site-1',
          path: '/pages/home',
        }),
      ).rejects.toThrow(InvalidDocumentPathError);
    });

    it('should throw InvalidDocumentPathError for path with trailing slash', async () => {
      const { createDocument, InvalidDocumentPathError } = await import('../../src/services/document-service');

      await expect(
        createDocument({
          siteId: 'site-1',
          path: 'pages/home/',
        }),
      ).rejects.toThrow(InvalidDocumentPathError);
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

    it('should validate new path format', async () => {
      const { updateDocumentPath, InvalidDocumentPathError } = await import('../../src/services/document-service');

      await expect(
        updateDocumentPath('doc-123', '/invalid/path'),
      ).rejects.toThrow(InvalidDocumentPathError);
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

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('LIKE'),
        expect.arrayContaining(['pages/%']),
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
});
