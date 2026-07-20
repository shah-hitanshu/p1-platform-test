/**
 * Branch Document Service — Registry Path Upsert-on-Conflict (§0 Phase 2)
 *
 * createDocumentOnBranch already reuses-and-versions on 3 of 4 conflict
 * cases (new path, COW-inherited-with-no-branch-version, tombstoned). The
 * 4th case — a live version already exists on this exact branch — throws
 * DuplicateDocumentPathError for every path except _registry/*, where the
 * CI registry sync script (a write:registry-only token, with no read
 * access at all) needs repeated POSTs to the same path to succeed as a
 * version bump rather than fail: it has no read call available to
 * discover an existing document's ID up front. Gated on path, not caller,
 * so every other document path keeps today's conflict-is-an-error
 * behavior unchanged — a user re-creating a page at a path that's already
 * live should still see a clear conflict, not a silent merge.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { createDocumentOnBranch, DuplicateDocumentPathError } from '../../src/services';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

let sql: ReturnType<typeof postgres>;
let testSiteId: string;
let mainBranchId: string;

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

beforeAll(async () => {
  sql = postgres(TEST_DATABASE_URL, { max: 1 });

  const connection = {
    async query(sqlQuery: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
      const result = await sql.unsafe(sqlQuery, params as unknown as postgres.ParameterOrJSON<never>[]);
      const rows = [...result];
      const resultWithCount = result as unknown as { count?: number };
      const rowCount = resultWithCount.count ?? rows.length;
      return { rows, rowCount };
    },
  };
  setDatabaseInstance(connection);

  // Clean up stale data from previous failed runs
  const staleData = await sql<{ id: string }[]>`
    SELECT id FROM app.sites WHERE pantheon_site_id = 'test-registry-upsert-service-site'
  `;
  if (staleData.length > 0) {
    const staleSiteId = staleData[0].id;
    await sql`DELETE FROM app.checkpoint_documents WHERE document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${staleSiteId}
    )`;
    await sql`DELETE FROM app.checkpoints WHERE branch_id IN (
      SELECT id FROM app.branches WHERE site_id = ${staleSiteId}
    )`;
    await sql`DELETE FROM app.document_relations WHERE source_document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${staleSiteId}
    ) OR target_document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${staleSiteId}
    )`;
    await sql`DELETE FROM app.document_versions WHERE document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${staleSiteId}
    )`;
    await sql`DELETE FROM app.documents WHERE site_id = ${staleSiteId}`;
    await sql`DELETE FROM app.branches WHERE site_id = ${staleSiteId}`;
    await sql`DELETE FROM app.sites WHERE id = ${staleSiteId}`;
  }

  const site = await sql<{ id: string }[]>`
    INSERT INTO app.sites (pantheon_site_id, name)
    VALUES ('test-registry-upsert-service-site', 'Test Registry Upsert Service Site')
    RETURNING id
  `;
  testSiteId = site[0].id;

  const mainBranch = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
    VALUES (${testSiteId}, 'main', true, '00000000-0000-0000-0000-000000000000', 'system')
    RETURNING id
  `;
  mainBranchId = mainBranch[0].id;
});

afterAll(async () => {
  try {
    if (testSiteId) {
      await sql`DELETE FROM app.checkpoint_documents WHERE document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${testSiteId}
      )`;
      await sql`DELETE FROM app.checkpoints WHERE branch_id IN (
        SELECT id FROM app.branches WHERE site_id = ${testSiteId}
      )`;
      await sql`DELETE FROM app.document_relations WHERE source_document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${testSiteId}
      ) OR target_document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${testSiteId}
      )`;
      await sql`DELETE FROM app.document_versions WHERE document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${testSiteId}
      )`;
      await sql`DELETE FROM app.documents WHERE site_id = ${testSiteId}`;
      await sql`DELETE FROM app.branches WHERE site_id = ${testSiteId}`;
      await sql`DELETE FROM app.sites WHERE id = ${testSiteId}`;
    }
  } catch {
    // Ignore cleanup errors
  }

  setDatabaseInstance(null);
  await sql.end();
});

describe('Branch Document Service — Registry Path Upsert-on-Conflict', () => {
  it('creates a document + version 1 at a registry component path when none exists yet', async () => {
    const result = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: '_registry/components/hero',
      snapshot: { name: 'Hero', descriptorHash: 'hash-v1' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    expect(result.version.versionNumber).toBe(1);
    expect(result.version.snapshot).toEqual({ name: 'Hero', descriptorHash: 'hash-v1' });
  });

  it('creates a new version instead of throwing on repeat POST to the same registry component path', async () => {
    const first = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: '_registry/components/footer',
      snapshot: { name: 'Footer', descriptorHash: 'hash-v1' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    expect(first.version.versionNumber).toBe(1);

    const second = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: '_registry/components/footer',
      snapshot: { name: 'Footer', descriptorHash: 'hash-v2' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    expect(second.document.id).toBe(first.document.id);
    expect(second.version.versionNumber).toBe(2);
    expect(second.version.snapshot).toEqual({ name: 'Footer', descriptorHash: 'hash-v2' });
  });

  it('creates a new version instead of throwing on repeat POST to the registry index path', async () => {
    const first = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: '_registry/index',
      snapshot: { hashes: { hero: 'hash-v1' } },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    expect(first.version.versionNumber).toBe(1);

    const second = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: '_registry/index',
      snapshot: { hashes: { hero: 'hash-v1', footer: 'hash-v1' } },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    expect(second.document.id).toBe(first.document.id);
    expect(second.version.versionNumber).toBe(2);
  });

  it('still throws DuplicateDocumentPathError on repeat POST to a non-registry path (unchanged behavior)', async () => {
    await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: 'home',
      snapshot: { content: [] },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    await expect(
      createDocumentOnBranch({
        siteId: testSiteId,
        branchId: mainBranchId,
        path: 'home',
        snapshot: { content: ['changed'] },
        createdById: SYSTEM_ACTOR,
        createdByType: 'system',
      }),
    ).rejects.toThrow(DuplicateDocumentPathError);
  });

  it('still throws DuplicateDocumentPathError for a path that merely contains "_registry" as a substring, not a real match', async () => {
    // Guards against a sloppy path.includes('_registry')-style implementation —
    // only an actual _registry/components/* or _registry/index path should
    // get upsert-on-conflict behavior.
    await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: 'not_registry/components/hero',
      snapshot: { name: 'Hero' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    await expect(
      createDocumentOnBranch({
        siteId: testSiteId,
        branchId: mainBranchId,
        path: 'not_registry/components/hero',
        snapshot: { name: 'Hero v2' },
        createdById: SYSTEM_ACTOR,
        createdByType: 'system',
      }),
    ).rejects.toThrow(DuplicateDocumentPathError);
  });
});
