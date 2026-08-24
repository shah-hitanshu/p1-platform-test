/**
 * Document inserts must not provoke a unique-constraint violation.
 *
 * Reusing an existing (site_id, path) is routine for these two writers —
 * branch copy-on-write, recreation after a tombstone, repeated registry
 * syncs, a page moved twice — so the insert has to yield a zero-row result
 * on conflict rather than an error. A plain INSERT works (both callers
 * recover and reuse the existing row) but makes Postgres log an
 * ERROR-severity `documents_site_id_path_active_key` line per attempt,
 * which drowned real signals in production logs.
 *
 * The `WHERE archived_at IS NULL` predicate is required, not decoration:
 * the unique index is partial, and Postgres only accepts an ON CONFLICT
 * target whose predicate matches the index's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

function docRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'doc-uuid-456',
    site_id: 'site-uuid-123',
    path: 'pages/new',
    created_at: '2026-07-07T10:00:00.000Z',
    ...overrides,
  };
}

function versionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'version-uuid-123',
    document_id: 'doc-uuid-456',
    branch_id: 'branch-uuid-789',
    version_number: 1,
    snapshot: {},
    source: 'edit',
    created_by_id: 'user-uuid-001',
    created_by_type: 'user',
    created_at: '2026-07-07T10:00:00.000Z',
    ...overrides,
  };
}

function documentInsertSql(calls: unknown[][]): string {
  const call = calls.find(
    (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO app.documents'),
  );
  if (call === undefined) {
    throw new Error('No INSERT INTO app.documents call was captured');
  }
  return call[0] as string;
}

describe('conflict-free document inserts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('createDocumentOnBranch', () => {
    it('inserts with ON CONFLICT DO NOTHING against the active-path index', async () => {
      const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
      const db = await import('../../src/db');
      const queryMock = vi.mocked(db.query);

      queryMock
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [docRow()] }) // INSERT document
        .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_version
        .mockResolvedValueOnce({ rows: [versionRow()] }) // INSERT version
        .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT insert_version
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await createDocumentOnBranch({
        siteId: 'site-uuid-123',
        branchId: 'branch-uuid-789',
        path: 'pages/new',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      const sql = documentInsertSql(queryMock.mock.calls);
      expect(sql).toContain('ON CONFLICT (site_id, path) WHERE archived_at IS NULL DO NOTHING');
    });

    it('needs no SAVEPOINT around the document insert, which can no longer abort the transaction', async () => {
      const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
      const db = await import('../../src/db');
      const queryMock = vi.mocked(db.query);

      queryMock
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [docRow()] }) // INSERT document
        .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_version
        .mockResolvedValueOnce({ rows: [versionRow()] }) // INSERT version
        .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT insert_version
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await createDocumentOnBranch({
        siteId: 'site-uuid-123',
        branchId: 'branch-uuid-789',
        path: 'pages/new',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      // insert_version keeps its own savepoint for the version-number race;
      // what must be gone is the one the document insert needed to recover
      // from its own aborted statement.
      const statements = queryMock.mock.calls.map((c) => c[0]);
      expect(statements).not.toContain('SAVEPOINT insert_doc');
    });

    it('reuses the existing document when the insert returns no row', async () => {
      const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
      const db = await import('../../src/db');
      const queryMock = vi.mocked(db.query);

      queryMock
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // INSERT document -> conflict, no row
        .mockResolvedValueOnce({ rows: [docRow({ id: 'existing-doc-id' })] }) // SELECT existing
        .mockResolvedValueOnce({ rows: [] }) // SELECT latest version on branch (none)
        .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_version
        .mockResolvedValueOnce({ rows: [versionRow({ document_id: 'existing-doc-id' })] })
        .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT insert_version
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await createDocumentOnBranch({
        siteId: 'site-uuid-123',
        branchId: 'branch-uuid-789',
        path: '_registry/components/heroblock',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(result.document.id).toBe('existing-doc-id');
    });
  });

  describe('deleteDocumentWithRedirect', () => {
    it('inserts the redirect document with ON CONFLICT DO NOTHING', async () => {
      const { deleteDocumentWithRedirect } = await import(
        '../../src/services/branch-document-service'
      );
      const db = await import('../../src/db');
      const queryMock = vi.mocked(db.query);

      queryMock
        .mockResolvedValueOnce({ rows: [versionRow({ snapshot: { _deleted: true } })] }) // tombstone
        .mockResolvedValueOnce({ rows: [docRow({ id: 'redirect-doc-id' })] }) // INSERT redirect doc
        .mockResolvedValueOnce({ rows: [versionRow({ document_id: 'redirect-doc-id' })] });

      await deleteDocumentWithRedirect({
        siteId: 'site-uuid-123',
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        deletedById: 'user-uuid-001',
        deletedByType: 'user',
        redirect: {
          fromPath: 'pages/old',
          destination: '/pages/new',
          redirectType: 'permanent',
          parenting: false,
        },
      });

      const sql = documentInsertSql(queryMock.mock.calls);
      expect(sql).toContain('ON CONFLICT (site_id, path) WHERE archived_at IS NULL DO NOTHING');
    });
  });
});
