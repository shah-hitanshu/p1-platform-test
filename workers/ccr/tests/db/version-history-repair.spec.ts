/**
 * Database tests for the version-history snapshot repair.
 *
 * Seeds each damage shape the repair has to tell apart, then asserts what it
 * rebuilds, what it refuses, and that a second run changes nothing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { runWithConnection } from '../../src/db';
import { repairVersionHistorySnapshots } from '../../src/services/version-history-repair';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

const SITE_NAME = 'version-history-repair-fixture';

// The content-present constraint carries a created_at fence that grandfathers
// rows predating it, which is the only way to seed a snapshot/patch-less row.
const FENCED_AT = '2020-01-01T00:00:00Z';

const ACTOR = '00000000-0000-0000-0000-0000000000ff';

// Above the repair's 250-row batch size, so a run covers a full batch and a
// partial one.
const BATCH_FIXTURE_ROWS = 300;

let sql: ReturnType<typeof postgres>;
let siteId: string;
let branchId: string;

async function createDocument(path: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO app.documents (site_id, path) VALUES (${siteId}, ${path})
    RETURNING id`;
  return row!.id;
}

async function insertVersion(params: {
  documentId: string;
  versionNumber: number;
  snapshot: Record<string, unknown> | null;
  patch: unknown[] | string | null;
}): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO app.document_versions
      (document_id, branch_id, version_number, snapshot, patch,
       created_by_id, created_by_type, created_at)
    VALUES (
      ${params.documentId}, ${branchId}, ${params.versionNumber},
      ${params.snapshot === null ? null : sql.json(params.snapshot as never)},
      ${params.patch === null ? null : sql.json(params.patch as never)},
      ${ACTOR}, 'user', ${FENCED_AT})
    RETURNING id`;
  return row!.id;
}

async function snapshotOf(versionId: string): Promise<Record<string, unknown> | null> {
  const [row] = await sql<{ snapshot: Record<string, unknown> | null }[]>`
    SELECT snapshot FROM app.document_versions WHERE id = ${versionId}`;
  return row!.snapshot;
}

function repair(options: { dryRun: boolean } = { dryRun: false }) {
  return runWithConnection(
    TEST_DATABASE_URL,
    { isHyperdrive: false },
    () => repairVersionHistorySnapshots({ ...options, siteId }),
  );
}

beforeAll(async () => {
  sql = postgres(TEST_DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 10 });

  const [site] = await sql<{ id: string }[]>`
    INSERT INTO app.sites (name) VALUES (${SITE_NAME}) RETURNING id`;
  siteId = site!.id;

  const [branch] = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, created_by_id, created_by_type)
    VALUES (${siteId}, 'main', ${ACTOR}, 'user') RETURNING id`;
  branchId = branch!.id;
});

afterAll(async () => {
  if (siteId) {
    await sql`DELETE FROM app.document_versions WHERE branch_id = ${branchId}`;
    await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
    await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
    await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
  }
  await sql.end();
});

beforeEach(async () => {
  await sql`DELETE FROM app.document_versions WHERE branch_id = ${branchId}`;
  await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
});

describe('version history snapshot repair', () => {
  it('rebuilds a damaged version from an add-only successor diff', async () => {
    const documentId = await createDocument('add-only');
    const damaged = await insertVersion({
      documentId, versionNumber: 1, snapshot: null, patch: null,
    });
    await insertVersion({
      documentId,
      versionNumber: 2,
      snapshot: { root: { props: { title: 'Page' } }, zones: {} },
      patch: [{ op: 'add', path: '/zones', value: {} }],
    });

    const result = await repair();

    expect(result.repaired).toHaveLength(1);
    expect(await snapshotOf(damaged)).toEqual({ root: { props: { title: 'Page' } } });
  });

  it('reports without writing on a dry run', async () => {
    const documentId = await createDocument('dry-run');
    const damaged = await insertVersion({
      documentId, versionNumber: 1, snapshot: null, patch: null,
    });
    await insertVersion({
      documentId,
      versionNumber: 2,
      snapshot: { a: 1, b: 2 },
      patch: [{ op: 'add', path: '/b', value: 2 }],
    });

    const result = await repair({ dryRun: true });

    expect(result.repaired).toHaveLength(1);
    expect(await snapshotOf(damaged)).toBeNull();
  });

  it('refuses a successor diff that removes or replaces values', async () => {
    const documentId = await createDocument('lossy-diff');
    const damaged = await insertVersion({
      documentId, versionNumber: 1, snapshot: null, patch: null,
    });
    await insertVersion({
      documentId,
      versionNumber: 2,
      snapshot: { title: 'after' },
      patch: [{ op: 'replace', path: '/title', value: 'after' }],
    });

    const result = await repair();

    expect(result.repaired).toHaveLength(0);
    expect(result.nonInvertible).toHaveLength(1);
    expect(await snapshotOf(damaged)).toBeNull();
  });

  it('reports a successor that carries no snapshot as blocked', async () => {
    const documentId = await createDocument('blocked');
    const damaged = await insertVersion({
      documentId, versionNumber: 1, snapshot: null, patch: null,
    });
    await insertVersion({
      documentId,
      versionNumber: 2,
      snapshot: null,
      patch: [{ op: 'add', path: '/a', value: 1 }],
    });

    const result = await repair();

    expect(result.repaired).toHaveLength(0);
    expect(result.chainBlocked).toHaveLength(1);
    expect(await snapshotOf(damaged)).toBeNull();
  });

  it('unwraps a double-encoded successor diff', async () => {
    const documentId = await createDocument('double-encoded');
    const damaged = await insertVersion({
      documentId, versionNumber: 1, snapshot: null, patch: null,
    });
    await insertVersion({
      documentId,
      versionNumber: 2,
      snapshot: { a: 1, added: true },
      patch: JSON.stringify([{ op: 'add', path: '/added', value: true }]),
    });

    const result = await repair();

    expect(result.repaired).toHaveLength(1);
    expect(await snapshotOf(damaged)).toEqual({ a: 1 });
  });

  it('leaves a version that already carries a snapshot alone', async () => {
    const documentId = await createDocument('already-intact');
    const intact = await insertVersion({
      documentId, versionNumber: 1, snapshot: { original: true }, patch: null,
    });
    await insertVersion({
      documentId,
      versionNumber: 2,
      snapshot: { original: true, extra: 1 },
      patch: [{ op: 'add', path: '/extra', value: 1 }],
    });

    const result = await repair();

    expect(result.repaired).toHaveLength(0);
    expect(await snapshotOf(intact)).toEqual({ original: true });
  });

  it('writes more rows than one batch holds, and a second run is a no-op', async () => {
    const documentId = await createDocument('batched');
    const damagedIds: string[] = [];
    for (let i = 0; i < BATCH_FIXTURE_ROWS; i += 1) {
      damagedIds.push(await insertVersion({
        documentId, versionNumber: i * 2 + 1, snapshot: null, patch: null,
      }));
      await insertVersion({
        documentId,
        versionNumber: i * 2 + 2,
        snapshot: { index: i, filled: true },
        patch: [{ op: 'add', path: '/filled', value: true }],
      });
    }

    const first = await repair();
    expect(first.repaired).toHaveLength(BATCH_FIXTURE_ROWS);
    expect(first.writeFailed).toHaveLength(0);
    // Batched writes carry the run; degrading to a statement per row would
    // still repair everything, just far slower.
    expect(first.fallbackRows).toBe(0);
    expect(await snapshotOf(damagedIds[0]!)).toEqual({ index: 0 });
    expect(await snapshotOf(damagedIds[BATCH_FIXTURE_ROWS - 1]!))
      .toEqual({ index: BATCH_FIXTURE_ROWS - 1 });

    const second = await repair();
    expect(second.repaired).toHaveLength(0);
  });
});
