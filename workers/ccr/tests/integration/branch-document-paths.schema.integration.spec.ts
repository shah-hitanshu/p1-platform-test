/**
 * Migration 056 — app.branch_document_paths.
 * Pins the constraint name that PATCH's 409 mapping depends on, and that
 * site deletion cascades rather than failing on the FK.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

let sql: ReturnType<typeof postgres>;
let siteId: string;
let branchId: string;
let docA: string;
let docB: string;

beforeAll(async () => {
  sql = postgres(TEST_DATABASE_URL, { max: 1 });
  await sql`DELETE FROM app.sites WHERE pantheon_site_id = 'test-bdp-schema-site'`;

  const site = await sql<{ id: string }[]>`
    INSERT INTO app.sites (pantheon_site_id, name)
    VALUES ('test-bdp-schema-site', 'BDP Schema Site') RETURNING id`;
  siteId = site[0].id;

  const branch = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
    VALUES (${siteId}, 'main', true, '00000000-0000-0000-0000-000000000000', 'system')
    RETURNING id`;
  branchId = branch[0].id;

  const docs = await sql<{ id: string }[]>`
    INSERT INTO app.documents (site_id, path)
    VALUES (${siteId}, 'a'), (${siteId}, 'b') RETURNING id`;
  docA = docs[0].id;
  docB = docs[1].id;
});

afterAll(async () => {
  if (siteId) {
    await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
    await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
    await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
  }
  await sql.end();
});

describe('app.branch_document_paths', () => {
  it('rejects two documents at one path on one branch, under the expected constraint name', async () => {
    await sql`INSERT INTO app.branch_document_paths (branch_id, document_id, path)
              VALUES (${branchId}, ${docA}, 'shared')`;
    await expect(
      sql`INSERT INTO app.branch_document_paths (branch_id, document_id, path)
          VALUES (${branchId}, ${docB}, 'shared')`,
    ).rejects.toThrow('branch_document_paths_branch_id_path_key');
  });

  it('upserts on (branch_id, document_id)', async () => {
    await sql`INSERT INTO app.branch_document_paths (branch_id, document_id, path)
              VALUES (${branchId}, ${docA}, 'moved-once')
              ON CONFLICT (branch_id, document_id) DO UPDATE SET path = EXCLUDED.path`;
    const rows = await sql<{ path: string }[]>`
      SELECT path FROM app.branch_document_paths
      WHERE branch_id = ${branchId} AND document_id = ${docA}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('moved-once');
  });

  it('cascades when the branch is deleted', async () => {
    const b = await sql<{ id: string }[]>`
      INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
      VALUES (${siteId}, 'doomed', false, '00000000-0000-0000-0000-000000000000', 'system')
      RETURNING id`;
    await sql`INSERT INTO app.branch_document_paths (branch_id, document_id, path)
              VALUES (${b[0].id}, ${docB}, 'doomed-path')`;
    await sql`DELETE FROM app.branches WHERE id = ${b[0].id}`;
    const left = await sql`SELECT 1 FROM app.branch_document_paths WHERE branch_id = ${b[0].id}`;
    expect(left).toHaveLength(0);
  });
});
