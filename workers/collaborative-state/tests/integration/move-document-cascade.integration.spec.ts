import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import {
  moveDocumentOnBranch,
  moveDocumentGlobally,
  SelfNestingMoveError,
  ImmovableDocumentError,
  DuplicateDocumentPathError,
} from '../../src/services';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

let sql: ReturnType<typeof postgres>;
let siteId: string;
let mainBranchId: string;
let workstreamId: string;

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

// maps storage-form path → document id
const ids: Record<string, string> = {};

// Every statement the services issue, so a test can count round trips.
let statements: string[] = [];

async function override(docId: string): Promise<string | null> {
  const rows = await sql<{ path: string }[]>`
    SELECT path FROM app.branch_document_paths
    WHERE branch_id = ${workstreamId} AND document_id = ${docId}`;
  return rows[0]?.path ?? null;
}

// Nothing cascades from sites, so drop dependants in FK order.
async function purgeSite(): Promise<void> {
  const target = sql`SELECT id FROM app.sites WHERE pantheon_site_id = 'test-move-cascade'`;
  const docs = sql`SELECT id FROM app.documents WHERE site_id IN (${target})`;
  await sql`DELETE FROM app.branch_document_paths WHERE document_id IN (${docs})`;
  await sql`DELETE FROM app.document_relations
    WHERE source_document_id IN (${docs}) OR target_document_id IN (${docs})`;
  await sql`DELETE FROM app.document_versions WHERE document_id IN (${docs})`;
  await sql`DELETE FROM app.documents WHERE site_id IN (${target})`;
  await sql`DELETE FROM app.branches WHERE site_id IN (${target})`;
  await sql`DELETE FROM app.sites WHERE pantheon_site_id = 'test-move-cascade'`;
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
      statements.push(sqlQuery);
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
    VALUES ('test-move-cascade', 'Move Cascade Test') RETURNING id`;
  siteId = site[0].id;

  const main = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
    VALUES (${siteId}, 'main', true, ${SYSTEM_ACTOR}, 'system') RETURNING id`;
  mainBranchId = main[0].id;

  const ws = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
    VALUES (${siteId}, 'workstream', false, ${SYSTEM_ACTOR}, 'system') RETURNING id`;
  workstreamId = ws[0].id;

  for (const path of [
    '_registry/sections/blog',
    '_registry/sections/blog/deep',
    'blog',
    'blog/post',
    'blog/deep/nested',
    'blogger',
    'other/page',
    '/',
  ]) {
    ids[path] = await seedDoc(path);
  }
});

afterAll(async () => {
  await purgeSite();
  await sql.end();
});

beforeEach(async () => {
  await sql`DELETE FROM app.branch_document_paths WHERE branch_id = ${workstreamId}`;
  // Reset any global path changes made by moveDocumentGlobally tests
  for (const [path, docId] of Object.entries(ids)) {
    await sql`UPDATE app.documents SET path = ${path} WHERE id = ${docId}`;
  }
  statements = [];
});


async function seedLocaleVariant(): Promise<string> {
  const variantId = await seedDoc('blog/post.fr');
  await sql`
    INSERT INTO app.document_relations (source_document_id, target_document_id, relation_type)
    VALUES (${variantId}, ${ids['blog/post']}, 'localization')`;
  return variantId;
}

async function dropDoc(docId: string): Promise<void> {
  await sql`DELETE FROM app.branch_document_paths WHERE document_id = ${docId}`;
  await sql`DELETE FROM app.document_relations
    WHERE source_document_id = ${docId} OR target_document_id = ${docId}`;
  await sql`DELETE FROM app.document_versions WHERE document_id = ${docId}`;
  await sql`DELETE FROM app.documents WHERE id = ${docId}`;
}

describe('moveDocumentOnBranch', () => {
  it('moves a leaf page and reports one row', async () => {
    const result = await moveDocumentOnBranch(workstreamId, ids['other/page'], 'moved/page');
    expect(result.movedCount).toBe(1);
    expect(await override(ids['other/page'])).toBe('moved/page');
  });

  it('cascades to descendants by path', async () => {
    const result = await moveDocumentOnBranch(workstreamId, ids.blog, 'news');
    expect(await override(ids.blog)).toBe('news');
    expect(await override(ids['blog/post'])).toBe('news/post');
    expect(await override(ids['blog/deep/nested'])).toBe('news/deep/nested');
    expect(result.movedCount).toBe(3);
  });

  it('writes the whole cascade in a single statement', async () => {
    await moveDocumentOnBranch(workstreamId, ids.blog, 'news');
    const writes = statements.filter((s) => s.includes('INSERT INTO app.branch_document_paths'));
    expect(writes).toHaveLength(1);
  });

  it('counts a locale variant under the moved subtree once', async () => {
    const variantId = await seedLocaleVariant();
    try {
      const result = await moveDocumentOnBranch(workstreamId, ids.blog, 'news');
      expect(await override(variantId)).toBe('news/post.fr');
      expect(result.movedCount).toBe(4);
    } finally {
      await dropDoc(variantId);
    }
  });

  it('does not sweep a sibling whose name shares the prefix', async () => {
    await moveDocumentOnBranch(workstreamId, ids.blog, 'news');
    expect(await override(ids.blogger)).toBeNull();
  });

  it('moves a decorated section in both namespaces', async () => {
    const result = await moveDocumentOnBranch(
      workstreamId,
      ids['_registry/sections/blog'],
      '_registry/sections/news',
    );
    expect(await override(ids['_registry/sections/blog/deep'])).toBe(
      '_registry/sections/news/deep',
    );
    expect(await override(ids['blog/post'])).toBe('news/post');
    expect(await override(ids['blog/deep/nested'])).toBe('news/deep/nested');
    expect(result.movedCount).toBeGreaterThan(3);
  });

  it("rejects a move into the moved node's own subtree", async () => {
    await expect(
      moveDocumentOnBranch(workstreamId, ids.blog, 'blog/child'),
    ).rejects.toThrow(SelfNestingMoveError);
  });

  it('rejects a move of the homepage', async () => {
    await expect(
      moveDocumentOnBranch(workstreamId, ids['/'], 'somewhere'),
    ).rejects.toThrow(ImmovableDocumentError);
  });

  it('rejects a collision against a path held by an un-overridden document', async () => {
    await expect(
      moveDocumentOnBranch(workstreamId, ids['other/page'], 'blogger'),
    ).rejects.toThrow(DuplicateDocumentPathError);
  });

  it('rejects a collision on any descendant of a subtree move', async () => {
    await sql`INSERT INTO app.documents (site_id, path) VALUES (${siteId}, 'news/post')`;
    await expect(
      moveDocumentOnBranch(workstreamId, ids.blog, 'news'),
    ).rejects.toThrow(DuplicateDocumentPathError);
    await sql`DELETE FROM app.documents WHERE site_id = ${siteId} AND path = 'news/post'`;
  });

  it('leaves no partial state when a cascade is rejected', async () => {
    await sql`INSERT INTO app.documents (site_id, path) VALUES (${siteId}, 'news2/post')`;
    await expect(
      moveDocumentOnBranch(workstreamId, ids.blog, 'news2'),
    ).rejects.toThrow();
    expect(await override(ids.blog)).toBeNull();
    expect(await override(ids['blog/post'])).toBeNull();
    await sql`DELETE FROM app.documents WHERE site_id = ${siteId} AND path = 'news2/post'`;
  });
});

describe('moveDocumentGlobally', () => {
  it('writes app.documents.path and leaves no override row', async () => {
    const result = await moveDocumentGlobally(ids['other/page'], 'global/moved');
    expect(result.movedCount).toBe(1);
    const rows = (await sql`
      SELECT path FROM app.documents WHERE id = ${ids['other/page']}`) as { path: string }[];
    expect(rows[0].path).toBe('global/moved');
    const overrides = await sql`
      SELECT 1 FROM app.branch_document_paths WHERE document_id = ${ids['other/page']}`;
    expect(overrides).toHaveLength(0);
  });

  it('cascades descendants globally', async () => {
    await moveDocumentGlobally(ids.blog, 'news');
    const rows = (await sql`
      SELECT path FROM app.documents WHERE id = ${ids['blog/post']}`) as { path: string }[];
    expect(rows[0].path).toBe('news/post');
  });

  it('writes the whole cascade in a single statement', async () => {
    await moveDocumentGlobally(ids.blog, 'news');
    const writes = statements.filter((s) => s.includes('UPDATE app.documents'));
    expect(writes).toHaveLength(1);
  });
});
