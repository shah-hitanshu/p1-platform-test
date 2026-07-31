/**
 * Document Last-Modified Metadata Tests
 *
 * Tests that listDocumentsOnBranch returns last-modified metadata
 * (updatedAt, lastModifiedById, lastModifiedByType) derived from
 * the latest document_versions row for each document.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Document Last-Modified Metadata in Branch Listings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('listDocumentsOnBranch with mainBranchId (COW mode)', () => {
    it('should include updatedAt, lastModifiedById, lastModifiedByType from latest version', async () => {
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
            published_version_id: null,
            published_at: null,
            snapshot_title: 'Home Page',
            latest_version_at: '2026-03-15T14:30:00.000Z',
            last_modified_by_id: 'user-42',
            last_modified_by_type: 'user',
          },
        ],
      });

      const result = await listDocumentsOnBranch('branch-feature', {
        mainBranchId: 'branch-main',
      });

      expect(result).toHaveLength(1);
      expect(result[0].updatedAt).toBe('2026-03-15T14:30:00.000Z');
      expect(result[0].lastModifiedById).toBe('user-42');
      expect(result[0].lastModifiedByType).toBe('user');
    });

    it('should omit last-modified fields when values are null', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-1',
            site_id: 'site-1',
            path: 'pages/orphan',
            created_at: '2026-01-01T00:00:00.000Z',
            archived_at: null,
            inherited: false,
            published_version_id: null,
            published_at: null,
            snapshot_title: null,
            latest_version_at: null,
            last_modified_by_id: null,
            last_modified_by_type: null,
          },
        ],
      });

      const result = await listDocumentsOnBranch('branch-feature', {
        mainBranchId: 'branch-main',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('updatedAt');
      expect(result[0]).not.toHaveProperty('lastModifiedById');
      expect(result[0]).not.toHaveProperty('lastModifiedByType');
    });

    it('should include last-modified columns in the COW UNION query SQL', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await listDocumentsOnBranch('branch-feature', {
        mainBranchId: 'branch-main',
      });

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('latest_version_at');
      expect(sql).toContain('last_modified_by_id');
      expect(sql).toContain('last_modified_by_type');
    });
  });

  describe('listDocumentsOnBranch without mainBranchId (main branch)', () => {
    it('should include last-modified metadata using branchId as main', async () => {
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
            published_version_id: null,
            published_at: null,
            snapshot_title: 'Home',
            latest_version_at: '2026-02-20T09:00:00.000Z',
            last_modified_by_id: 'agent-7',
            last_modified_by_type: 'agent',
          },
        ],
      });

      const result = await listDocumentsOnBranch('branch-main');

      expect(result).toHaveLength(1);
      expect(result[0].updatedAt).toBe('2026-02-20T09:00:00.000Z');
      expect(result[0].lastModifiedById).toBe('agent-7');
      expect(result[0].lastModifiedByType).toBe('agent');
    });

    it('should include last-modified columns in main branch query SQL', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await listDocumentsOnBranch('branch-main');

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('latest_version_at');
      expect(sql).toContain('last_modified_by_id');
      expect(sql).toContain('last_modified_by_type');
    });
  });

  describe('DocumentOnBranch last-modified mapping', () => {
    it('should map null last-modified fields to absent properties', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-1',
            site_id: 'site-1',
            path: 'pages/no-versions',
            created_at: '2026-01-01T00:00:00.000Z',
            archived_at: null,
            inherited: false,
            published_version_id: null,
            published_at: null,
            snapshot_title: null,
            latest_version_at: null,
            last_modified_by_id: null,
            last_modified_by_type: null,
          },
        ],
      });

      const result = await listDocumentsOnBranch('branch-main');
      const doc = result[0];

      expect(doc).not.toHaveProperty('updatedAt');
      expect(doc).not.toHaveProperty('lastModifiedById');
      expect(doc).not.toHaveProperty('lastModifiedByType');
    });

    it('should map non-null last-modified fields to present properties', async () => {
      const { listDocumentsOnBranch } = await import('../../src/services/document-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'doc-1',
            site_id: 'site-1',
            path: 'pages/edited',
            created_at: '2026-01-01T00:00:00.000Z',
            archived_at: null,
            inherited: true,
            published_version_id: 'ver-pub-1',
            published_at: '2026-02-01T12:00:00.000Z',
            snapshot_title: 'Edited Page',
            latest_version_at: '2026-04-01T16:45:00.000Z',
            last_modified_by_id: 'service-deploy',
            last_modified_by_type: 'service',
          },
        ],
      });

      const result = await listDocumentsOnBranch('branch-feature', {
        mainBranchId: 'branch-main',
      });
      const doc = result[0];

      expect(doc.updatedAt).toBe('2026-04-01T16:45:00.000Z');
      expect(doc.lastModifiedById).toBe('service-deploy');
      expect(doc.lastModifiedByType).toBe('service');
      expect(doc.inherited).toBe(true);
      expect(doc.isPublished).toBe(true);
    });
  });
});
