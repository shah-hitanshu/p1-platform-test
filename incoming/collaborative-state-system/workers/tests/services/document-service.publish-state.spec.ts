/**
 * Document Publish State Tests
 *
 * Tests that listDocumentsOnBranch and getDocumentOnBranch return
 * publish metadata (isPublished, publishedVersionId, publishedAt)
 * derived from checkpoint_documents on the main branch.
 *
 * Issue #31: Surface document publish state in API responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Document Publish State in Branch Listings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('listDocumentsOnBranch with mainBranchId (COW mode)', () => {
    it('should include isPublished=true for documents with checkpoint entries', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-1',
            site_id: 'site-1',
            path: 'pages/home',
            created_at: '2026-01-01T00:00:00.000Z',
            archived_at: null,
            inherited: false,
            published_version_id: 'ver-pub-1',
            published_at: '2026-01-15T00:00:00.000Z',
          },
        ],
      });

      const result = await listDocumentsOnBranch('branch-feature', {
        mainBranchId: 'branch-main',
      });

      expect(result).toHaveLength(1);
      expect(result[0].isPublished).toBe(true);
      expect(result[0].publishedVersionId).toBe('ver-pub-1');
      expect(result[0].publishedAt).toBe('2026-01-15T00:00:00.000Z');
    });

    it('should include isPublished=false for documents without checkpoint entries', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-2',
            site_id: 'site-1',
            path: 'pages/draft',
            created_at: '2026-01-01T00:00:00.000Z',
            archived_at: null,
            inherited: false,
            published_version_id: null,
            published_at: null,
          },
        ],
      });

      const result = await listDocumentsOnBranch('branch-feature', {
        mainBranchId: 'branch-main',
      });

      expect(result).toHaveLength(1);
      expect(result[0].isPublished).toBe(false);
      expect(result[0].publishedVersionId).toBeUndefined();
      expect(result[0].publishedAt).toBeUndefined();
    });

    it('should include publish state in the COW UNION query SQL', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await listDocumentsOnBranch('branch-feature', {
        mainBranchId: 'branch-main',
      });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      // Should join checkpoint_documents for publish state
      expect(sql).toContain('checkpoint_documents');
      expect(sql).toContain('published_version_id');
      expect(sql).toContain('published_at');
    });
  });

  describe('listDocumentsOnBranch without mainBranchId (main branch)', () => {
    it('should include publish state using branchId as main', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-1',
            site_id: 'site-1',
            path: 'pages/home',
            created_at: '2026-01-01T00:00:00.000Z',
            archived_at: null,
            inherited: false,
            published_version_id: 'ver-pub-1',
            published_at: '2026-01-10T00:00:00.000Z',
          },
        ],
      });

      const result = await listDocumentsOnBranch('branch-main');

      expect(result).toHaveLength(1);
      expect(result[0].isPublished).toBe(true);
      expect(result[0].publishedVersionId).toBe('ver-pub-1');
    });

    it('should include checkpoint_documents in main branch query SQL', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await listDocumentsOnBranch('branch-main');

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('checkpoint_documents');
      expect(sql).toContain('published_version_id');
    });
  });

  describe('isPublished and inherited visibility filter by checkpoint_type = publish', () => {
    it('COW mode query filters both LATERAL publish state and inherited visibility by checkpoint_type', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await listDocumentsOnBranch('branch-feature', { mainBranchId: 'branch-main' });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      // CoW query has 3 checkpoint_type = 'publish' filters:
      // 1. LATERAL for branch-side published_version_id
      // 2. outer WHERE for inherited document visibility
      // 3. LATERAL for inherited-side published_version_id
      const occurrences = sql.split("checkpoint_type = 'publish'").length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(3);
    });

    it('main branch query should filter publish state by checkpoint_type = publish', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await listDocumentsOnBranch('branch-main');

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('checkpoint_type');
      expect(sql).toContain("'publish'");
    });
  });

  describe('DocumentOnBranch publish state mapping', () => {
    it('should map null published_version_id to isPublished=false with no optional fields', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-1',
            site_id: 'site-1',
            path: 'pages/unpublished',
            created_at: '2026-01-01T00:00:00.000Z',
            archived_at: null,
            inherited: false,
            published_version_id: null,
            published_at: null,
          },
        ],
      });

      const result = await listDocumentsOnBranch('branch-main');
      const doc = result[0];

      expect(doc.isPublished).toBe(false);
      expect(doc).not.toHaveProperty('publishedVersionId');
      expect(doc).not.toHaveProperty('publishedAt');
    });

    it('should map non-null published_version_id to isPublished=true with fields present', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-1',
            site_id: 'site-1',
            path: 'pages/published',
            created_at: '2026-01-01T00:00:00.000Z',
            archived_at: null,
            inherited: true,
            published_version_id: 'ver-123',
            published_at: '2026-02-01T12:00:00.000Z',
          },
        ],
      });

      const result = await listDocumentsOnBranch('branch-feature', {
        mainBranchId: 'branch-main',
      });
      const doc = result[0];

      expect(doc.isPublished).toBe(true);
      expect(doc.publishedVersionId).toBe('ver-123');
      expect(doc.publishedAt).toBe('2026-02-01T12:00:00.000Z');
      expect(doc.inherited).toBe(true);
    });
  });
});
