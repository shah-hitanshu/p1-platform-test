/**
 * Registry writes that repeat content the branch already stores.
 *
 * The CI registry sync holds a write:registry token with no read access, so
 * it posts every component descriptor and the index on every run whether or
 * not anything changed. Left alone that appends a version per component per
 * run — the growth engine behind the document_versions fan-out. The
 * comparison happens here instead, on the side that can read, so the token
 * gains nothing and an unchanged run writes no history.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

const DESCRIPTOR = {
  name: 'HeroBlock',
  descriptorHash: 'abc123',
  registeredAt: '2026-08-01T00:00:00.000Z',
  fields: { title: { type: 'text' } },
};

function docRow(path: string): Record<string, unknown> {
  return {
    id: 'doc-registry-1',
    site_id: 'site-1',
    path,
    created_at: '2026-08-01T00:00:00.000Z',
  };
}

function versionRow(snapshot: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'version-registry-9',
    document_id: 'doc-registry-1',
    branch_id: 'branch-1',
    version_number: 42,
    snapshot,
    source: 'edit',
    created_by_id: 'user-1',
    created_by_type: 'system',
    created_at: '2026-08-01T00:00:00.000Z',
    is_tombstone: false,
  };
}

function sqlOf(call: unknown[]): string {
  return typeof call[0] === 'string' ? call[0] : '';
}

describe('createDocumentOnBranch registry write deduplication', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('writes no version when a component descriptor matches what is stored', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    const path = '_registry/components/heroblock';
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // INSERT document (path already taken)
      .mockResolvedValueOnce({ rows: [docRow(path)] }) // SELECT existing doc
      .mockResolvedValueOnce({ rows: [versionRow(DESCRIPTOR)] }) // SELECT latest version
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path,
      snapshot: { ...DESCRIPTOR },
      createdById: 'user-1',
      createdByType: 'system',
    });

    expect(result.version.versionNumber).toBe(42);
    const statements = queryMock.mock.calls.map(sqlOf);
    expect(statements.some((s) => s.includes('INSERT INTO app.document_versions'))).toBe(false);
    expect(statements).toContain('COMMIT');
  });

  it('skips when only the per-run stamps on the descriptor moved', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    const path = '_registry/components/heroblock';
    // extractDescriptors stamps a fresh registeredAt on every run, so a
    // whole-snapshot compare would never match and nothing would ever skip.
    // descriptorHash is built with exactly these fields excluded.
    const restamped = {
      ...DESCRIPTOR,
      registeredAt: '2026-08-21T09:00:00.000Z',
      provenance: 'site',
    };

    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [docRow(path)] })
      .mockResolvedValueOnce({ rows: [versionRow(DESCRIPTOR)] })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path,
      snapshot: restamped,
      createdById: 'user-1',
      createdByType: 'system',
    });

    expect(
      queryMock.mock.calls.map(sqlOf).some((s) => s.includes('INSERT INTO app.document_versions')),
    ).toBe(false);
  });

  it('compares content independently of key order', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    const path = '_registry/components/heroblock';
    // jsonb does not preserve key order, so the stored row comes back shuffled
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [docRow(path)] })
      .mockResolvedValueOnce({
        rows: [versionRow({ fields: DESCRIPTOR.fields, name: DESCRIPTOR.name })],
      })
      .mockResolvedValueOnce({ rows: [] });

    await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path,
      // No descriptorHash on either side, so this falls through to the full
      // canonical compare — which is the path key ordering matters on.
      snapshot: { name: DESCRIPTOR.name, fields: DESCRIPTOR.fields },
      createdById: 'user-1',
      createdByType: 'system',
    });

    expect(
      queryMock.mock.calls.map(sqlOf).some((s) => s.includes('INSERT INTO app.document_versions')),
    ).toBe(false);
  });

  it('appends a version when the descriptor actually changed', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    const path = '_registry/components/heroblock';
    const changed = { ...DESCRIPTOR, descriptorHash: 'def456' };
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // INSERT document
      .mockResolvedValueOnce({ rows: [docRow(path)] }) // SELECT existing doc
      .mockResolvedValueOnce({ rows: [versionRow(DESCRIPTOR)] }) // SELECT latest version
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_version
      .mockResolvedValueOnce({ rows: [versionRow(changed)] }) // INSERT version
      .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path,
      snapshot: changed,
      createdById: 'user-1',
      createdByType: 'system',
    });

    expect(
      queryMock.mock.calls.map(sqlOf).some((s) => s.includes('INSERT INTO app.document_versions')),
    ).toBe(true);
  });

  it('refreshes the index stamps in place rather than versioning an unchanged index', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    const path = '_registry/index';
    const stored = {
      siteId: 'site-1',
      branchId: 'branch-1',
      componentNames: ['HeroBlock'],
      hashes: { HeroBlock: 'abc123' },
      updatedAt: '2026-08-01T00:00:00.000Z',
      verifiedAt: '2026-08-01T00:00:00.000Z',
    };
    const incoming = {
      ...stored,
      updatedAt: '2026-08-21T00:00:00.000Z',
      verifiedAt: '2026-08-21T00:00:00.000Z',
    };

    queryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // INSERT document
      .mockResolvedValueOnce({ rows: [docRow(path)] }) // SELECT existing doc
      .mockResolvedValueOnce({ rows: [versionRow(stored)] }) // SELECT latest version
      .mockResolvedValueOnce({ rows: [versionRow(incoming)] }) // UPDATE stamps
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path,
      snapshot: incoming,
      createdById: 'user-1',
      createdByType: 'system',
    });

    const statements = queryMock.mock.calls.map(sqlOf);
    expect(statements.some((s) => s.includes('INSERT INTO app.document_versions'))).toBe(false);
    const update = queryMock.mock.calls.find((c) => sqlOf(c).includes('UPDATE app.document_versions'));
    expect(update).toBeDefined();
    expect(update![1]![1]).toMatchObject({ verifiedAt: '2026-08-21T00:00:00.000Z' });
    expect(result.version.versionNumber).toBe(42);
  });

  it('versions the index when its component set changed', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    const path = '_registry/index';
    const stored = {
      siteId: 'site-1',
      branchId: 'branch-1',
      componentNames: ['HeroBlock'],
      hashes: { HeroBlock: 'abc123' },
      updatedAt: '2026-08-01T00:00:00.000Z',
      verifiedAt: '2026-08-01T00:00:00.000Z',
    };
    const incoming = {
      ...stored,
      componentNames: ['HeroBlock', 'CardBlock'],
      hashes: { HeroBlock: 'abc123', CardBlock: 'zzz999' },
      updatedAt: '2026-08-21T00:00:00.000Z',
      verifiedAt: '2026-08-21T00:00:00.000Z',
    };

    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [docRow(path)] })
      .mockResolvedValueOnce({ rows: [versionRow(stored)] })
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_version
      .mockResolvedValueOnce({ rows: [versionRow(incoming)] }) // INSERT version
      .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path,
      snapshot: incoming,
      createdById: 'user-1',
      createdByType: 'system',
    });

    expect(
      queryMock.mock.calls.map(sqlOf).some((s) => s.includes('INSERT INTO app.document_versions')),
    ).toBe(true);
  });

  it('versions rather than skipping when the stored row holds a patch instead of a snapshot', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    const path = '_registry/components/heroblock';
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [docRow(path)] })
      .mockResolvedValueOnce({ rows: [{ ...versionRow(DESCRIPTOR), snapshot: null }] })
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_version
      .mockResolvedValueOnce({ rows: [versionRow(DESCRIPTOR)] }) // INSERT version
      .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path,
      snapshot: { ...DESCRIPTOR },
      createdById: 'user-1',
      createdByType: 'system',
    });

    expect(
      queryMock.mock.calls.map(sqlOf).some((s) => s.includes('INSERT INTO app.document_versions')),
    ).toBe(true);
  });

  it('retries the version insert when a concurrent run takes the same version number', async () => {
    const { createDocumentOnBranch } = await import('../../src/services/branch-document-service');
    const db = await import('../../src/db');
    const queryMock = vi.mocked(db.query);

    const collision = new Error('duplicate key value violates unique constraint');
    (collision as NodeJS.ErrnoException).code = '23505';

    queryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [docRow('pages/new')] }) // INSERT document
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_version
      .mockRejectedValueOnce(collision) // INSERT version loses the race
      .mockResolvedValueOnce({ rows: [] }) // ROLLBACK TO SAVEPOINT
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT insert_version
      .mockResolvedValueOnce({ rows: [versionRow({})] }) // INSERT version succeeds
      .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path: 'pages/new',
      createdById: 'user-1',
      createdByType: 'system',
    });

    expect(result.version.id).toBe('version-registry-9');
  });
});
