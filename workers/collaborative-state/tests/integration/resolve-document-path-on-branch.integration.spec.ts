import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { moveDocumentOnBranch, getDocumentByPath } from '../../src/services';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

let sql: ReturnType<typeof postgres>;
let siteId: string;
let mainBranchId: string;
let workstreamId: string;
let aug13Id: string;

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

// documents/branches do not cascade from sites, so drop them in FK order.
async function purgeSite(): Promise<void> {
  const target = sql`SELECT id FROM app.sites WHERE pantheon_site_id = 'test-resolve-branch-path'`;
  await sql`DELETE FROM app.document_versions WHERE document_id IN (
    SELECT id FROM app.documents WHERE site_id IN (${target}))`;
  await sql`DELETE FROM app.documents WHERE site_id IN (${target})`;
  await sql`DELETE FROM app.branches WHERE site_id IN (${target})`;
  await sql`DELETE FROM app.sites WHERE pantheon_site_id = 'test-resolve-branch-path'`;
}

async function seedDoc(path: string): Promise<string> {
  const doc = await sql<{ id: string }[]>`
    INSERT INTO app.documents (site_id, path) VALUES (${siteId}, ${path}) RETURNING id`;
  const docId = doc[0].id;
  await sql`
    INSERT INTO app.document_versions
      (document_id, branch_id, version_number, snapshot, created_by_id, created_by_type)
    VALUES (${docId}, ${mainBranchId}, 1, '{}', ${SYSTEM_ACTOR}, 'system')`;
  return docId;
}

beforeAll(async () => {
  sql = postgres(TEST_DATABASE_URL, { max: 1 });
  setDatabaseInstance({
    async query(sqlQuery: string, params?: unknown[]) {
      const result = await sql.unsafe(
        sqlQuery,
        params as unknown as postgres.ParameterOrJSON<never>[],
      );
      const rows = [...result];
      return { rows, rowCount: (result as unknown as { count?: number }).count ?? rows.length };
    },
  } as never);

  await purgeSite();

  const site = await sql<{ id: string }[]>`
    INSERT INTO app.sites (pantheon_site_id, name)
    VALUES ('test-resolve-branch-path', 'Resolve Branch Path Test') RETURNING id`;
  siteId = site[0].id;

  const main = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
    VALUES (${siteId}, 'main', true, ${SYSTEM_ACTOR}, 'system') RETURNING id`;
  mainBranchId = main[0].id;

  const ws = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
    VALUES (${siteId}, 'workstream', false, ${SYSTEM_ACTOR}, 'system') RETURNING id`;
  workstreamId = ws[0].id;

  aug13Id = await seedDoc('aug13');
  await seedDoc('august');

  // Reparent aug13 under august on the workstream branch only.
  await moveDocumentOnBranch(workstreamId, aug13Id, 'august/aug13');
});

afterAll(async () => {
  await purgeSite();
  await sql.end();
});

describe('path resolution honours branch overrides', () => {
  it('resolves the new path on the branch that moved the document', async () => {
    const doc = await getDocumentByPath(siteId, 'august/aug13', workstreamId);
    expect(doc?.id).toBe(aug13Id);
  });

  it('stops resolving the old path on that branch', async () => {
    const doc = await getDocumentByPath(siteId, 'aug13', workstreamId);
    expect(doc).toBeNull();
  });

  it('leaves main resolving the original global path', async () => {
    const doc = await getDocumentByPath(siteId, 'aug13', mainBranchId);
    expect(doc?.id).toBe(aug13Id);
  });

  it('does not leak the branch path onto main', async () => {
    const doc = await getDocumentByPath(siteId, 'august/aug13', mainBranchId);
    expect(doc).toBeNull();
  });

  it('falls back to global paths when no branch is supplied', async () => {
    const doc = await getDocumentByPath(siteId, 'aug13');
    expect(doc?.id).toBe(aug13Id);
  });
});
