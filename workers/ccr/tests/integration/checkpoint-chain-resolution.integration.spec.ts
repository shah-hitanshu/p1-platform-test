import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import {
  createCheckpoint,
  resolveCheckpointDeletions,
  resolveCheckpointDocuments,
  revertToCheckpoint,
} from '../../src/services';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

let sql: ReturnType<typeof postgres>;
let siteId: string;
let branchId: string;

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
const SITE_KEY = 'test-checkpoint-chain';

async function purgeSite(): Promise<void> {
  const target = sql`SELECT id FROM app.sites WHERE pantheon_site_id = ${SITE_KEY}`;
  const branches = sql`SELECT id FROM app.branches WHERE site_id IN (${target})`;
  const checkpoints = sql`SELECT id FROM app.checkpoints WHERE branch_id IN (${branches})`;
  const docs = sql`SELECT id FROM app.documents WHERE site_id IN (${target})`;
  await sql`DELETE FROM app.checkpoint_document_metadata WHERE checkpoint_id IN (${checkpoints})`;
  await sql`DELETE FROM app.checkpoint_structures WHERE checkpoint_id IN (${checkpoints})`;
  await sql`DELETE FROM app.checkpoint_documents WHERE checkpoint_id IN (${checkpoints})`;
  await sql`UPDATE app.branches SET source_checkpoint_id = NULL WHERE site_id IN (${target})`;
  await sql`UPDATE app.checkpoints SET parent_checkpoint_id = NULL WHERE branch_id IN (${branches})`;
  await sql`DELETE FROM app.checkpoints WHERE branch_id IN (${branches})`;
  await sql`DELETE FROM app.branch_document_paths WHERE document_id IN (${docs})`;
  await sql`DELETE FROM app.document_versions WHERE document_id IN (${docs})`;
  await sql`DELETE FROM app.documents WHERE site_id IN (${target})`;
  await sql`DELETE FROM app.branches WHERE site_id IN (${target})`;
  await sql`DELETE FROM app.sites WHERE pantheon_site_id = ${SITE_KEY}`;
}

/** Writes a new version of `path`, creating the document on first use. */
async function writeVersion(
  path: string,
  title: string,
  options: { isTombstone?: boolean } = {},
): Promise<string> {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM app.documents WHERE site_id = ${siteId} AND path = ${path}`;
  const docId = existing[0]?.id ?? (await sql<{ id: string }[]>`
    INSERT INTO app.documents (site_id, path) VALUES (${siteId}, ${path}) RETURNING id`)[0].id;

  await sql`
    INSERT INTO app.document_versions
      (document_id, branch_id, version_number, snapshot, created_by_id, created_by_type, is_tombstone)
    SELECT ${docId}, ${branchId}, COALESCE(MAX(version_number), 0) + 1,
           ${sql.json({ title })}, ${SYSTEM_ACTOR}, 'system', ${options.isTombstone ?? false}
    FROM app.document_versions WHERE document_id = ${docId} AND branch_id = ${branchId}`;

  return docId;
}

async function titlesAtCheckpoint(checkpointId: string): Promise<Record<string, string>> {
  const docs = await resolveCheckpointDocuments(checkpointId);
  return Object.fromEntries(
    docs.map((doc) => [doc.documentPath, (doc.snapshot as { title?: string }).title ?? '']),
  );
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
});

afterAll(async () => {
  await purgeSite();
  await sql.end();
});

beforeEach(async () => {
  await purgeSite();

  const site = await sql<{ id: string }[]>`
    INSERT INTO app.sites (pantheon_site_id, name)
    VALUES (${SITE_KEY}, 'Checkpoint Chain Test') RETURNING id`;
  siteId = site[0].id;

  const branch = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
    VALUES (${siteId}, 'main', true, ${SYSTEM_ACTOR}, 'system') RETURNING id`;
  branchId = branch[0].id;
});

function checkpointArgs(forceFullSnapshot = false) {
  return {
    branchId,
    checkpointType: 'session_pre_edit' as const,
    createdById: SYSTEM_ACTOR,
    createdByType: 'system' as const,
    forceFullSnapshot,
  };
}

describe('checkpoint chain resolution', () => {
  it('resolves a full snapshot to its own manifest', async () => {
    await writeVersion('pages/home', 'Home v1');
    await writeVersion('pages/about', 'About v1');

    const { checkpoint } = await createCheckpoint(checkpointArgs(true));

    expect(await titlesAtCheckpoint(checkpoint.id)).toEqual({
      'pages/home': 'Home v1',
      'pages/about': 'About v1',
    });
  });

  it('merges an incremental delta over its parent, nearest version winning', async () => {
    await writeVersion('pages/home', 'Home v1');
    await writeVersion('pages/about', 'About v1');
    await createCheckpoint(checkpointArgs(true));

    await writeVersion('pages/home', 'Home v2');
    await writeVersion('pages/contact', 'Contact v1');
    const { checkpoint, documentCount } = await createCheckpoint(checkpointArgs());

    // The manifest itself holds only the delta.
    expect(documentCount).toBe(2);

    expect(await titlesAtCheckpoint(checkpoint.id)).toEqual({
      'pages/home': 'Home v2',
      'pages/about': 'About v1',
      'pages/contact': 'Contact v1',
    });
  });

  it('walks a multi-level chain and stops at the nearest full snapshot', async () => {
    await writeVersion('pages/home', 'Home v1');
    await writeVersion('pages/about', 'About v1');
    await createCheckpoint(checkpointArgs(true));

    await writeVersion('pages/home', 'Home v2');
    await createCheckpoint(checkpointArgs());

    await writeVersion('pages/contact', 'Contact v1');
    const { checkpoint } = await createCheckpoint(checkpointArgs());

    expect(await titlesAtCheckpoint(checkpoint.id)).toEqual({
      'pages/home': 'Home v2',
      'pages/about': 'About v1',
      'pages/contact': 'Contact v1',
    });

    // A later full snapshot terminates the walk: documents that predate it
    // are represented by that snapshot, not by the older chain.
    await writeVersion('pages/home', 'Home v3');
    const { checkpoint: fresh } = await createCheckpoint(checkpointArgs(true));

    expect(await titlesAtCheckpoint(fresh.id)).toEqual({
      'pages/home': 'Home v3',
      'pages/about': 'About v1',
      'pages/contact': 'Contact v1',
    });
  });

  it('treats a document deleted mid-chain as deleted, not as its parent version', async () => {
    await writeVersion('pages/home', 'Home v1');
    await writeVersion('pages/gone', 'Gone v1');
    await createCheckpoint(checkpointArgs(true));

    await writeVersion('pages/gone', 'Gone v1', { isTombstone: true });
    const { checkpoint } = await createCheckpoint(checkpointArgs());

    // The tombstone is in the delta, so the parent's live version cannot win.
    expect(await titlesAtCheckpoint(checkpoint.id)).toEqual({ 'pages/home': 'Home v1' });
    expect((await resolveCheckpointDeletions(checkpoint.id)).map((d) => d.documentPath)).toEqual([
      'pages/gone',
    ]);
  });

  it('a later full snapshot needs no tombstone — absence is the deletion', async () => {
    await writeVersion('pages/home', 'Home v1');
    await writeVersion('pages/gone', 'Gone v1');
    await createCheckpoint(checkpointArgs(true));

    await writeVersion('pages/gone', 'Gone v1', { isTombstone: true });
    const { checkpoint } = await createCheckpoint(checkpointArgs(true));

    expect(await titlesAtCheckpoint(checkpoint.id)).toEqual({ 'pages/home': 'Home v1' });
    expect(await resolveCheckpointDeletions(checkpoint.id)).toEqual([]);
  });

  it('re-deletes a document that was deleted at the checkpoint and recreated since', async () => {
    await writeVersion('pages/home', 'Home v1');
    await writeVersion('pages/gone', 'Gone v1');
    await createCheckpoint(checkpointArgs(true));

    await writeVersion('pages/gone', 'Gone v1', { isTombstone: true });
    const { checkpoint: target } = await createCheckpoint(checkpointArgs());

    // Recreated after the checkpoint — a revert has to take it away again.
    await writeVersion('pages/gone', 'Gone resurrected');

    const result = await revertToCheckpoint({
      checkpointId: target.id,
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    expect(result.documentsDeleted).toBe(1);

    const latest = await sql<{ path: string; is_tombstone: boolean; source: string }[]>`
      SELECT DISTINCT ON (d.path) d.path, dv.is_tombstone, dv.source
      FROM app.document_versions dv
      JOIN app.documents d ON d.id = dv.document_id
      WHERE dv.branch_id = ${branchId}
      ORDER BY d.path, dv.version_number DESC`;

    const gone = latest.find((row) => row.path === 'pages/gone');
    expect(gone?.is_tombstone).toBe(true);
    expect(gone?.source).toBe('revert');
    expect(latest.find((row) => row.path === 'pages/home')?.is_tombstone).toBe(false);
  });

  it('writes no redundant tombstone when the document is still deleted', async () => {
    await writeVersion('pages/home', 'Home v1');
    await writeVersion('pages/gone', 'Gone v1');
    await createCheckpoint(checkpointArgs(true));

    await writeVersion('pages/gone', 'Gone v1', { isTombstone: true });
    const { checkpoint: target } = await createCheckpoint(checkpointArgs());

    const before = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM app.document_versions dv
      JOIN app.documents d ON d.id = dv.document_id
      WHERE dv.branch_id = ${branchId} AND d.path = 'pages/gone'`;

    const result = await revertToCheckpoint({
      checkpointId: target.id,
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    const after = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM app.document_versions dv
      JOIN app.documents d ON d.id = dv.document_id
      WHERE dv.branch_id = ${branchId} AND d.path = 'pages/gone'`;

    // Reported as described by the chain, but no version row added for it.
    expect(result.documentsDeleted).toBe(1);
    expect(after[0].count).toBe(before[0].count);
  });

  it('stays complete when the chain terminates on a merge checkpoint', async () => {
    // A merge checkpoint captures only merge-touched documents and gets a NULL
    // parent by design, so it terminates a chain walk without describing the
    // whole branch. The delta is defined against what the chain records, so the
    // next session manifest re-captures what the merge left out rather than
    // resolving to an incomplete branch.
    const homeId = await writeVersion('pages/home', 'Home v1');
    await writeVersion('pages/about', 'About v1');
    await writeVersion('pages/contact', 'Contact v1');
    await createCheckpoint(checkpointArgs(true));

    const homeVersion = await sql<{ id: string }[]>`
      SELECT id FROM app.document_versions
      WHERE document_id = ${homeId} AND branch_id = ${branchId}
      ORDER BY version_number DESC LIMIT 1`;

    await createCheckpoint({
      branchId,
      checkpointType: 'post_merge',
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
      documentVersionIds: [{ documentId: homeId, documentVersionId: homeVersion[0].id }],
    });

    await writeVersion('pages/home', 'Home v2');
    const { checkpoint, documentCount } = await createCheckpoint(checkpointArgs());

    expect(await titlesAtCheckpoint(checkpoint.id)).toEqual({
      'pages/home': 'Home v2',
      'pages/about': 'About v1',
      'pages/contact': 'Contact v1',
    });

    // The cost of that completeness: this manifest re-establishes the baseline
    // the merge checkpoint does not carry, so it is branch-sized rather than
    // edit-sized. Subsequent sessions go back to deltas.
    expect(documentCount).toBe(3);
  });

  it('writes a manifest sized by the edit, not by the branch', async () => {
    for (let i = 0; i < 40; i++) {
      await writeVersion(`pages/page-${String(i)}`, `Page ${String(i)} v1`);
    }
    await createCheckpoint(checkpointArgs(true));

    // One document edited: the session manifest should hold one row, and the
    // checkpoint should still resolve to the whole branch.
    await writeVersion('pages/page-7', 'Page 7 v2');
    const { checkpoint, documentCount } = await createCheckpoint(checkpointArgs());

    expect(documentCount).toBe(1);

    const manifestRows = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM app.checkpoint_documents WHERE checkpoint_id = ${checkpoint.id}`;
    expect(manifestRows[0].count).toBe('1');

    const resolved = await titlesAtCheckpoint(checkpoint.id);
    expect(Object.keys(resolved)).toHaveLength(40);
    expect(resolved['pages/page-7']).toBe('Page 7 v2');
    expect(resolved['pages/page-0']).toBe('Page 0 v1');
  });

  it('restores every document on the branch when reverting an incremental checkpoint', async () => {
    await writeVersion('pages/home', 'Home v1');
    await writeVersion('pages/about', 'About v1');
    await createCheckpoint(checkpointArgs(true));

    await writeVersion('pages/home', 'Home v2');
    const { checkpoint: target } = await createCheckpoint(checkpointArgs());

    // Edits after the checkpoint, on both a document the incremental manifest
    // holds and one only its parent holds.
    await writeVersion('pages/home', 'Home v3');
    await writeVersion('pages/about', 'About v2');

    const result = await revertToCheckpoint({
      checkpointId: target.id,
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    expect(result.documentsReverted).toBe(2);

    const latest = await sql<{ path: string; snapshot: { title: string }; source: string }[]>`
      SELECT DISTINCT ON (d.path) d.path, dv.snapshot, dv.source
      FROM app.document_versions dv
      JOIN app.documents d ON d.id = dv.document_id
      WHERE dv.branch_id = ${branchId}
      ORDER BY d.path, dv.version_number DESC`;

    expect(
      Object.fromEntries(latest.map((row) => [row.path, row.snapshot.title])),
    ).toEqual({
      'pages/home': 'Home v2',
      'pages/about': 'About v1',
    });
    expect(latest.every((row) => row.source === 'revert')).toBe(true);
  });
});
