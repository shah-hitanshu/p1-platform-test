import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Document Version isPublished flag', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getLatestDocumentVersion', () => {
    it('should return isPublished: true when version is in a checkpoint', async () => {
      const { getLatestDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{
          id: 'ver-1',
          document_id: 'doc-1',
          branch_id: 'branch-1',
          version_number: 3,
          snapshot: { title: 'Hello' },

          source: 'edit',
          created_by_id: 'user-1',
          created_by_type: 'user',
          created_at: '2026-01-01T00:00:00.000Z',
          is_published: true,
        }],
      });

      const result = await getLatestDocumentVersion('doc-1', 'branch-1');

      expect(result).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(result!.isPublished).toBe(true);
    });

    it('should return isPublished: false when version is not in any checkpoint', async () => {
      const { getLatestDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{
          id: 'ver-2',
          document_id: 'doc-1',
          branch_id: 'branch-1',
          version_number: 4,
          snapshot: { title: 'Draft' },

          source: 'edit',
          created_by_id: 'user-1',
          created_by_type: 'user',
          created_at: '2026-01-02T00:00:00.000Z',
          is_published: false,
        }],
      });

      const result = await getLatestDocumentVersion('doc-1', 'branch-1');

      expect(result).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(result!.isPublished).toBe(false);
    });
  });

  describe('listDocumentVersions', () => {
    it('should include isPublished flag on each version', async () => {
      const { listDocumentVersions } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'ver-3',
            document_id: 'doc-1',
            branch_id: 'branch-1',
            version_number: 3,
            snapshot: { title: 'v3' },

            source: 'edit',
            created_by_id: 'user-1',
            created_by_type: 'user',
            created_at: '2026-01-03T00:00:00.000Z',
            is_published: false,
          },
          {
            id: 'ver-2',
            document_id: 'doc-1',
            branch_id: 'branch-1',
            version_number: 2,
            snapshot: { title: 'v2' },

            source: 'edit',
            created_by_id: 'user-1',
            created_by_type: 'user',
            created_at: '2026-01-02T00:00:00.000Z',
            is_published: true,
          },
          {
            id: 'ver-1',
            document_id: 'doc-1',
            branch_id: 'branch-1',
            version_number: 1,
            snapshot: { title: 'v1' },

            source: 'edit',
            created_by_id: 'user-1',
            created_by_type: 'user',
            created_at: '2026-01-01T00:00:00.000Z',
            is_published: true,
          },
        ],
      });

      const result = await listDocumentVersions('doc-1', 'branch-1');

      expect(result).toHaveLength(3);
      expect(result[0].isPublished).toBe(false); // v3 - not published
      expect(result[1].isPublished).toBe(true);  // v2 - published
      expect(result[2].isPublished).toBe(true);  // v1 - published
    });
  });

  describe('getDocumentVersion', () => {
    it('should include isPublished flag when retrieving by ID', async () => {
      const { getDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{
          id: 'ver-1',
          document_id: 'doc-1',
          branch_id: 'branch-1',
          version_number: 1,
          snapshot: { title: 'Hello' },

          source: 'edit',
          created_by_id: 'user-1',
          created_by_type: 'user',
          created_at: '2026-01-01T00:00:00.000Z',
          is_published: true,
        }],
      });

      const result = await getDocumentVersion('ver-1');

      expect(result).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(result!.isPublished).toBe(true);
    });
  });

  describe('SQL queries include isPublished', () => {
    it('getLatestDocumentVersion query should join checkpoint_documents', async () => {
      const { getLatestDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await getLatestDocumentVersion('doc-1', 'branch-1');

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('checkpoint_documents');
      expect(sql).toContain('is_published');
    });

    it('listDocumentVersions query should join checkpoint_documents', async () => {
      const { listDocumentVersions } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await listDocumentVersions('doc-1', 'branch-1');

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('checkpoint_documents');
      expect(sql).toContain('is_published');
    });
  });

  describe('isPublished only reflects publish checkpoints, not agent checkpoints', () => {
    it('getDocumentVersion SQL should filter isPublished by checkpoint_type = publish', async () => {
      const { getDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await getDocumentVersion('ver-1');

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('checkpoint_type');
      expect(sql).toContain("'publish'");
    });

    it('getLatestDocumentVersion SQL should filter isPublished by checkpoint_type = publish', async () => {
      const { getLatestDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await getLatestDocumentVersion('doc-1', 'branch-1');

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('checkpoint_type');
      expect(sql).toContain("'publish'");
    });

    it('listDocumentVersions SQL should filter isPublished by checkpoint_type = publish', async () => {
      const { listDocumentVersions } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await listDocumentVersions('doc-1', 'branch-1');

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('checkpoint_type');
      expect(sql).toContain("'publish'");
    });

    it('getLatestPublishedDocumentVersion SQL should filter by checkpoint_type = publish', async () => {
      const { getLatestPublishedDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await getLatestPublishedDocumentVersion('doc-1', 'branch-1');

      const sql = vi.mocked(db.query).mock.calls[0][0];
      expect(sql).toContain('checkpoint_type');
      expect(sql).toContain("'publish'");
    });
  });
});
