/**
 * Version compaction against a live schema.
 *
 * createDocumentOnBranch writes a full snapshot with no patch at the next
 * version number, which for a repeat write is above 1. A following edit
 * compacts, and must leave that row readable: it has no patch to rebuild from.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import {
  createDocumentOnBranch,
  createDocumentVersion,
  reconstructVersionSnapshot,
} from '../../src/services';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

const PANTHEON_SITE_ID = 'test-version-compaction-site';
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

let sql: ReturnType<typeof postgres>;
let testSiteId: string;
let mainBranchId: string;

async function purgeSite(siteId: string): Promise<void> {
  await sql`DELETE FROM app.checkpoint_documents WHERE document_id IN (
    SELECT id FROM app.documents WHERE site_id = ${siteId}
  )`;
  await sql`DELETE FROM app.checkpoints WHERE branch_id IN (
    SELECT id FROM app.branches WHERE site_id = ${siteId}
  )`;
  await sql`DELETE FROM app.document_versions WHERE document_id IN (
    SELECT id FROM app.documents WHERE site_id = ${siteId}
  )`;
  await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
  await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
  await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
}

beforeAll(async () => {
  sql = postgres(TEST_DATABASE_URL, { max: 1 });

  const connection = {
    async query(sqlQuery: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
      const result = await sql.unsafe(sqlQuery, params as unknown as postgres.ParameterOrJSON<never>[]);
      const rows = [...result];
      const resultWithCount = result as unknown as { count?: number };
      return { rows, rowCount: resultWithCount.count ?? rows.length };
    },
  };
  setDatabaseInstance(connection);

  const stale = await sql<{ id: string }[]>`
    SELECT id FROM app.sites WHERE pantheon_site_id = ${PANTHEON_SITE_ID}
  `;
  if (stale.length > 0) {
    await purgeSite(stale[0].id);
  }

  const site = await sql<{ id: string }[]>`
    INSERT INTO app.sites (pantheon_site_id, name)
    VALUES (${PANTHEON_SITE_ID}, 'Test Version Compaction Site')
    RETURNING id
  `;
  testSiteId = site[0].id;

  const mainBranch = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
    VALUES (${testSiteId}, 'main', true, ${SYSTEM_ACTOR}, 'system')
    RETURNING id
  `;
  mainBranchId = mainBranch[0].id;
});

afterAll(async () => {
  try {
    if (testSiteId) await purgeSite(testSiteId);
  } catch {
    // Ignore cleanup errors
  }
  setDatabaseInstance(null);
  await sql.end();
});

describe('Version compaction against a live schema', () => {
  it('keeps a create-path version readable after a following edit compacts', async () => {
    const path = '_registry/components/buttonblock';

    // v1 and v2 both arrive through the create path: snapshot, no patch.
    const first = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path,
      snapshot: { name: 'ButtonBlock', descriptorHash: 'hash-v1' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    const documentId = first.document.id;

    await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path,
      snapshot: { name: 'ButtonBlock', descriptorHash: 'hash-v2' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    // An editor save lands on top and compacts.
    await createDocumentVersion({
      documentId,
      branchId: mainBranchId,
      snapshot: { name: 'ButtonBlock', descriptorHash: 'hash-v3' },
      source: 'edit',
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    const rows = await sql<{ version_number: number; snapshot: unknown; patch: unknown }[]>`
      SELECT version_number, snapshot, patch
      FROM app.document_versions
      WHERE document_id = ${documentId} AND branch_id = ${mainBranchId}
      ORDER BY version_number
    `;

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.snapshot === null && row.patch === null).toBe(false);
    }

    const v2 = await reconstructVersionSnapshot(documentId, mainBranchId, 2);
    expect(v2).toEqual({ name: 'ButtonBlock', descriptorHash: 'hash-v2' });
  });

  it('compacts a version that carries a patch of its own', async () => {
    const path = 'pages/compaction-chain';

    const first = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path,
      snapshot: { title: 'v1' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    const documentId = first.document.id;

    // v2 gets a patch, then v3 compacts v2.
    for (const title of ['v2', 'v3']) {
      await createDocumentVersion({
        documentId,
        branchId: mainBranchId,
        snapshot: { title },
        source: 'edit',
        createdById: SYSTEM_ACTOR,
        createdByType: 'system',
      });
    }

    const v2Row = await sql<{ snapshot: unknown; patch: unknown }[]>`
      SELECT snapshot, patch FROM app.document_versions
      WHERE document_id = ${documentId} AND branch_id = ${mainBranchId} AND version_number = 2
    `;

    expect(v2Row[0].snapshot).toBeNull();
    expect(v2Row[0].patch).not.toBeNull();
    expect(await reconstructVersionSnapshot(documentId, mainBranchId, 2)).toEqual({ title: 'v2' });
  });

  it('rejects a row holding neither snapshot nor patch', async () => {
    const first = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: 'pages/constraint-check',
      snapshot: { title: 'v1' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    await expect(
      sql`
        INSERT INTO app.document_versions
          (document_id, branch_id, version_number, snapshot, patch, source, created_by_id, created_by_type)
        VALUES (${first.document.id}, ${mainBranchId}, 99, NULL, NULL, 'edit', ${SYSTEM_ACTOR}, 'system')
      `,
    ).rejects.toThrow(/document_versions_content_present/);
  });
});
