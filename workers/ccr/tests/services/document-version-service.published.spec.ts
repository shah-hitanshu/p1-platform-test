import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documentVersions } from '../../src/db/schema';

// getLatestDocumentVersion and getLatestPublishedDocumentVersion still read
// through the legacy query() connection (see the comments on those functions
// in document-version-service.ts); getDocumentVersion and listDocumentVersions
// read through db() (Drizzle), stubbed below.
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Document Version isPublished flag', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    database = stubDatabase();
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

      expect(result!.isPublished).toBe(false);
    });
  });

  describe('listDocumentVersions', () => {
    it('should include isPublished flag on each version', async () => {
      const { listDocumentVersions } = await import('../../src/services/document-version-service');

      database.on(documentVersions).select.returnsRaw([
        {
          id: 'ver-3',
          documentId: 'doc-1',
          branchId: 'branch-1',
          versionNumber: 3,
          snapshot: { title: 'v3' },
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: new Date('2026-01-03T00:00:00.000Z'),
          isPublished: false,
        },
        {
          id: 'ver-2',
          documentId: 'doc-1',
          branchId: 'branch-1',
          versionNumber: 2,
          snapshot: { title: 'v2' },
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          isPublished: true,
        },
        {
          id: 'ver-1',
          documentId: 'doc-1',
          branchId: 'branch-1',
          versionNumber: 1,
          snapshot: { title: 'v1' },
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          isPublished: true,
        },
      ]);

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

      database.on(documentVersions).select.returnsRaw([{
        id: 'ver-1',
        documentId: 'doc-1',
        branchId: 'branch-1',
        versionNumber: 1,
        snapshot: { title: 'Hello' },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        isPublished: true,
      }]);

      const result = await getDocumentVersion('ver-1');

      expect(result).not.toBeNull();

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

      await listDocumentVersions('doc-1', 'branch-1');

      const call = database.calls(documentVersions).select[0];
      expect(call.sql).toContain('checkpoint_documents');
      // isPublished is a computed EXISTS column mapped in JS, not inline SQL
      // text; its presence on the mapped row is covered above.
      expect(call.params).toContain('publish');
    });
  });

  describe('isPublished only reflects publish checkpoints, not agent checkpoints', () => {
    it('getDocumentVersion SQL should filter isPublished by checkpoint_type = publish', async () => {
      const { getDocumentVersion } = await import('../../src/services/document-version-service');

      await getDocumentVersion('ver-1');

      const call = database.calls(documentVersions).select[0];
      expect(call.sql).toContain('checkpoint_type');
      expect(call.params).toContain('publish');
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

      await listDocumentVersions('doc-1', 'branch-1');

      const call = database.calls(documentVersions).select[0];
      expect(call.sql).toContain('checkpoint_type');
      expect(call.params).toContain('publish');
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
