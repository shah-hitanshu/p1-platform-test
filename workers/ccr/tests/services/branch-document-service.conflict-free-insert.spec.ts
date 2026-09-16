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

import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documents, documentVersions } from '../../src/db/schema';
import {
  createDocumentOnBranch,
  deleteDocumentWithRedirect,
} from '../../src/services/branch-document-service';

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

describe('conflict-free document inserts', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    stub = stubDatabase();
  });

  describe('createDocumentOnBranch', () => {
    it('inserts with ON CONFLICT DO NOTHING against the active-path index', async () => {
      stub.on(documents).insert.returnsRaw([docRow()]);
      stub.on(documentVersions).insert.returnsRaw([versionRow()]);

      await createDocumentOnBranch({
        siteId: 'site-uuid-123',
        branchId: 'branch-uuid-789',
        path: 'pages/new',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      expect(stub.calls(documents).insert[0].sql).toContain(
        'ON CONFLICT (site_id, path) WHERE archived_at IS NULL DO NOTHING',
      );
    });

    it('needs no SAVEPOINT around the document insert, which can no longer abort the transaction', async () => {
      stub.on(documents).insert.returnsRaw([docRow()]);
      stub.on(documentVersions).insert.returnsRaw([versionRow()]);

      await createDocumentOnBranch({
        siteId: 'site-uuid-123',
        branchId: 'branch-uuid-789',
        path: 'pages/new',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });

      // The version insert opens a savepoint for the version-number race, and
      // the transaction scope issues that one; no statement of the service's
      // own does, which is what the document insert used to need to recover
      // from its own aborted statement.
      expect(stub.statements.some((statement) => /savepoint/i.test(statement.sql))).toBe(false);
    });

    it('reuses the existing document when the insert returns no row', async () => {
      stub.on(documents).insert.returnsRaw([]);
      stub.on(documents).select.returnsRaw([docRow({ id: 'existing-doc-id' })]);
      stub.on(documentVersions).insert.returnsRaw([
        versionRow({ document_id: 'existing-doc-id' }),
      ]);

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
      stub.on(documents).insert.returnsRaw([docRow({ id: 'redirect-doc-id' })]);
      stub.on(documentVersions).insert.returnsRaw([
        versionRow({ document_id: 'redirect-doc-id' }),
      ]);

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

      expect(stub.calls(documents).insert[0].sql).toContain(
        'ON CONFLICT (site_id, path) WHERE archived_at IS NULL DO NOTHING',
      );
    });
  });
});
