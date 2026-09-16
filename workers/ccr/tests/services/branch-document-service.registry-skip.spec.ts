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

import { describe, it, expect, beforeEach } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documents, documentVersions } from '../../src/db/schema';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';

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

describe('createDocumentOnBranch registry write deduplication', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    stub = stubDatabase();
  });

  it('writes no version when a component descriptor matches what is stored', async () => {
    const path = '_registry/components/heroblock';
    stub.on(documents).insert.returnsRaw([]);
    stub.on(documents).select.returnsRaw([docRow(path)]);
    stub.on(documentVersions).select.returnsRaw([versionRow(DESCRIPTOR)]);

    const result = await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path,
      snapshot: { ...DESCRIPTOR },
      createdById: 'user-1',
      createdByType: 'system',
    });

    expect(result.version.versionNumber).toBe(42);
    expect(stub.calls(documentVersions).insert).toEqual([]);
  });

  it('skips when only the per-run stamps on the descriptor moved', async () => {
    const path = '_registry/components/heroblock';
    // extractDescriptors stamps a fresh registeredAt on every run, so a
    // whole-snapshot compare would never match and nothing would ever skip.
    // descriptorHash is built with exactly these fields excluded.
    const restamped = {
      ...DESCRIPTOR,
      registeredAt: '2026-08-21T09:00:00.000Z',
      provenance: 'site',
    };

    stub.on(documents).insert.returnsRaw([]);
    stub.on(documents).select.returnsRaw([docRow(path)]);
    stub.on(documentVersions).select.returnsRaw([versionRow(DESCRIPTOR)]);

    await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path,
      snapshot: restamped,
      createdById: 'user-1',
      createdByType: 'system',
    });

    expect(stub.calls(documentVersions).insert).toEqual([]);
  });

  it('compares content independently of key order', async () => {
    const path = '_registry/components/heroblock';
    // jsonb does not preserve key order, so the stored row comes back shuffled
    stub.on(documents).insert.returnsRaw([]);
    stub.on(documents).select.returnsRaw([docRow(path)]);
    stub.on(documentVersions).select.returnsRaw([
      versionRow({ fields: DESCRIPTOR.fields, name: DESCRIPTOR.name }),
    ]);

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

    expect(stub.calls(documentVersions).insert).toEqual([]);
  });

  it('appends a version when the descriptor actually changed', async () => {
    const path = '_registry/components/heroblock';
    const changed = { ...DESCRIPTOR, descriptorHash: 'def456' };
    stub.on(documents).insert.returnsRaw([]);
    stub.on(documents).select.returnsRaw([docRow(path)]);
    stub.on(documentVersions).select.returnsRaw([versionRow(DESCRIPTOR)]);
    stub.on(documentVersions).insert.returnsRaw([versionRow(changed)]);

    await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path,
      snapshot: changed,
      createdById: 'user-1',
      createdByType: 'system',
    });

    expect(stub.calls(documentVersions).insert).not.toEqual([]);
  });

  it('refreshes the index stamps in place rather than versioning an unchanged index', async () => {
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

    stub.on(documents).insert.returnsRaw([]);
    stub.on(documents).select.returnsRaw([docRow(path)]);
    stub.on(documentVersions).select.returnsRaw([versionRow(stored)]);
    stub.on(documentVersions).update.returnsRaw([versionRow(incoming)]);

    const result = await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path,
      snapshot: incoming,
      createdById: 'user-1',
      createdByType: 'system',
    });

    expect(stub.calls(documentVersions).insert).toEqual([]);
    const [update] = stub.calls(documentVersions).update;
    expect(update).toBeDefined();
    // The refreshed snapshot reaches the statement as JSON text, so it is read
    // back the same way.
    expect(JSON.parse(update.params[0] as string)).toMatchObject({
      verifiedAt: '2026-08-21T00:00:00.000Z',
    });
    expect(result.version.versionNumber).toBe(42);
  });

  it('versions the index when its component set changed', async () => {
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

    stub.on(documents).insert.returnsRaw([]);
    stub.on(documents).select.returnsRaw([docRow(path)]);
    stub.on(documentVersions).select.returnsRaw([versionRow(stored)]);
    stub.on(documentVersions).insert.returnsRaw([versionRow(incoming)]);

    await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path,
      snapshot: incoming,
      createdById: 'user-1',
      createdByType: 'system',
    });

    expect(stub.calls(documentVersions).insert).not.toEqual([]);
  });

  it('versions rather than skipping when the stored row holds a patch instead of a snapshot', async () => {
    const path = '_registry/components/heroblock';
    stub.on(documents).insert.returnsRaw([]);
    stub.on(documents).select.returnsRaw([docRow(path)]);
    stub.on(documentVersions).select.returnsRaw([{ ...versionRow(DESCRIPTOR), snapshot: null }]);
    stub.on(documentVersions).insert.returnsRaw([versionRow(DESCRIPTOR)]);

    await createDocumentOnBranch({
      siteId: 'site-1',
      branchId: 'branch-1',
      path,
      snapshot: { ...DESCRIPTOR },
      createdById: 'user-1',
      createdByType: 'system',
    });

    expect(stub.calls(documentVersions).insert).not.toEqual([]);
  });

  it('recomputes the version number rather than failing when the insert loses the race', async () => {
    const collision = new Error('duplicate key value violates unique constraint');
    (collision as NodeJS.ErrnoException).code = '23505';

    stub.on(documents).insert.returnsRaw([docRow('pages/new')]);
    stub.on(documentVersions).insert.rejects(collision);

    await expect(
      createDocumentOnBranch({
        siteId: 'site-1',
        branchId: 'branch-1',
        path: 'pages/new',
        createdById: 'user-1',
        createdByType: 'system',
      }),
    ).rejects.toBeInstanceOf(DrizzleQueryError);

    // A losing insert rolls back to its savepoint and recomputes the number
    // against the winner's row; only a writer that keeps losing gives up, and
    // the count is what says the collision was retried rather than surfaced.
    expect(stub.calls(documentVersions).insert).toHaveLength(4);
  });
});
