/**
 * Session checkpoint manifests now record tombstones, and merge-base resolution
 * reads session manifests on its source side (unlike every other
 * checkpoint_documents reader, which is scoped to publish checkpoints). These
 * cover that interaction: a deletion a session recorded on main before a
 * workstream forked must not read back as a change the workstream is making.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import {
  createBranch,
  createCheckpoint,
  deleteDocumentOnBranch,
  detectConflicts,
  findMergeBase,
  getModifiedDocumentsSince,
} from '../../src/services';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

let sql: ReturnType<typeof postgres>;
let siteId: string;
let mainBranchId: string;

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
const SITE_KEY = 'test-merge-base-tombstones';

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
  await sql`DELETE FROM app.branch_document_metadata WHERE branch_id IN (${branches})`;
  await sql`DELETE FROM app.branch_structure_state WHERE branch_id IN (${branches})`;
  await sql`DELETE FROM app.branch_document_paths WHERE document_id IN (${docs})`;
  await sql`DELETE FROM app.document_versions WHERE document_id IN (${docs})`;
  await sql`DELETE FROM app.documents WHERE site_id IN (${target})`;
  await sql`DELETE FROM app.branches WHERE site_id IN (${target})`;
  await sql`DELETE FROM app.sites WHERE pantheon_site_id = ${SITE_KEY}`;
}

async function writeVersion(path: string, title: string, branchId: string): Promise<string> {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM app.documents WHERE site_id = ${siteId} AND path = ${path}`;
  const docId = existing[0]?.id ?? (await sql<{ id: string }[]>`
    INSERT INTO app.documents (site_id, path) VALUES (${siteId}, ${path}) RETURNING id`)[0].id;

  await sql`
    INSERT INTO app.document_versions
      (document_id, branch_id, version_number, snapshot, created_by_id, created_by_type)
    SELECT ${docId}, ${branchId}, COALESCE(MAX(version_number), 0) + 1,
           ${sql.json({ title })}, ${SYSTEM_ACTOR}, 'system'
    FROM app.document_versions WHERE document_id = ${docId} AND branch_id = ${branchId}`;

  return docId;
}

/** A session checkpoint on main, captured the way edit sessions now capture. */
function sessionCheckpoint(branchId: string) {
  return {
    branchId,
    checkpointType: 'session_pre_edit' as const,
    createdById: SYSTEM_ACTOR,
    createdByType: 'system' as const,
  };
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
    VALUES (${SITE_KEY}, 'Merge Base Tombstones') RETURNING id`;
  siteId = site[0].id;

  const main = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
    VALUES (${siteId}, 'main', true, ${SYSTEM_ACTOR}, 'system') RETURNING id`;
  mainBranchId = main[0].id;
});

/**
 * Deletes `path` on main and captures it in a session checkpoint, then forks a
 * workstream whose merge base is that checkpoint.
 */
async function deleteOnMainThenFork(
  path: string,
): Promise<{ deletedId: string; workstreamId: string; baseCheckpointId: string }> {
  const deletedId = await writeVersion(path, 'Doomed v1', mainBranchId);
  await writeVersion('pages/home', 'Home v1', mainBranchId);
  await createCheckpoint({ ...sessionCheckpoint(mainBranchId), forceFullSnapshot: true });

  await deleteDocumentOnBranch({
    documentId: deletedId,
    branchId: mainBranchId,
    deletedById: SYSTEM_ACTOR,
    deletedByType: 'user',
  });

  // The session checkpoint that records the deletion — a delta, so the
  // tombstone is what lands in its manifest.
  const { checkpoint } = await createCheckpoint(sessionCheckpoint(mainBranchId));

  const workstream = await createBranch({
    name: 'workstream',
    siteId,
    sourceBranchId: mainBranchId,
    createdById: SYSTEM_ACTOR,
    createdByType: 'user',
  });

  await sql`
    UPDATE app.branches SET source_checkpoint_id = ${checkpoint.id} WHERE id = ${workstream.id}`;

  return { deletedId, workstreamId: workstream.id, baseCheckpointId: checkpoint.id };
}

describe('merge base with session-recorded tombstones', () => {
  it('resolves the merge base to the session checkpoint that recorded the deletion', async () => {
    const { workstreamId, baseCheckpointId } = await deleteOnMainThenFork('pages/doomed');

    const mergeBase = await findMergeBase(workstreamId, mainBranchId);

    expect(mergeBase?.checkpointId).toBe(baseCheckpointId);

    // The tombstone really is the manifest entry the base carries.
    const manifest = await sql<{ path: string; is_tombstone: boolean }[]>`
      SELECT d.path, dv.is_tombstone
      FROM app.checkpoint_documents cd
      JOIN app.document_versions dv ON dv.id = cd.document_version_id
      JOIN app.documents d ON d.id = cd.document_id
      WHERE cd.checkpoint_id = ${baseCheckpointId}`;
    expect(manifest).toEqual([{ path: 'pages/doomed', is_tombstone: true }]);
  });

  it('does not report a deletion that predates the fork as a workstream change', async () => {
    const { deletedId, workstreamId } = await deleteOnMainThenFork('pages/doomed');

    const mergeBase = await findMergeBase(workstreamId, mainBranchId);
    const sourceChanges = await getModifiedDocumentsSince(workstreamId, mergeBase!.checkpointId);

    expect(sourceChanges.map((doc) => doc.documentId)).not.toContain(deletedId);
  });

  it('does not turn that deletion into a conflict', async () => {
    const { deletedId, workstreamId } = await deleteOnMainThenFork('pages/doomed');

    // Real work on the workstream, so the merge has something to compare.
    await writeVersion('pages/home', 'Home v2 from workstream', workstreamId);

    const result = await detectConflicts(workstreamId, mainBranchId);

    expect(
      result.conflicts.documentConflicts.map((conflict) => conflict.documentId),
    ).not.toContain(deletedId);
    expect(result.sourceChanges.map((doc) => doc.documentId)).not.toContain(deletedId);
  });

  it('still reports a document the workstream actually edited', async () => {
    const { workstreamId } = await deleteOnMainThenFork('pages/doomed');

    const editedId = await writeVersion('pages/home', 'Home v2 from workstream', workstreamId);

    const mergeBase = await findMergeBase(workstreamId, mainBranchId);
    const sourceChanges = await getModifiedDocumentsSince(workstreamId, mergeBase!.checkpointId);

    expect(sourceChanges.map((doc) => doc.documentId)).toContain(editedId);
  });
});
