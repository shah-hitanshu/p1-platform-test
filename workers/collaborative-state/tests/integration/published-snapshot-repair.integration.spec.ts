/**
 * Published snapshot repair [PCC-3652].
 *
 * Before the compaction guard shipped, an edit following a publish stripped
 * the published version's snapshot. The repair rebuilds those rows through the
 * production replay logic; rows whose chain is already broken are reported,
 * not modified, because their content is unrecoverable from this database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance, type DatabaseConnection } from '../../src/db';
import {
  createDocumentOnBranch,
  createDocumentVersion,
  publishDocument,
} from '../../src/services';
import { repairPublishedSnapshots } from '../../src/services/published-snapshot-repair';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

const PANTHEON_SITE_ID = 'test-published-snapshot-repair-site';
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

/** Publishes the tip, then strips its snapshot the way pre-guard compaction did. */
async function publishThenStrip(path: string, versions: string[]): Promise<string> {
  const first = await createDocumentOnBranch({
    siteId: testSiteId,
    branchId: mainBranchId,
    path,
    snapshot: { title: versions[0] },
    createdById: SYSTEM_ACTOR,
    createdByType: 'system',
  });
  const documentId = first.document.id;
  for (const title of versions.slice(1)) {
    await createDocumentVersion({
      documentId,
      branchId: mainBranchId,
      snapshot: { title },
      source: 'edit',
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
  }
  await publishDocument({
    siteId: testSiteId,
    branchId: mainBranchId,
    documentId,
    createdById: SYSTEM_ACTOR,
    createdByType: 'system',
  });
  await sql`
    UPDATE app.document_versions SET snapshot = NULL
    WHERE document_id = ${documentId} AND branch_id = ${mainBranchId}
      AND version_number = ${versions.length}
  `;
  return documentId;
}

async function getSnapshot(documentId: string, versionNumber: number): Promise<unknown> {
  const rows = await sql<{ snapshot: unknown }[]>`
    SELECT snapshot FROM app.document_versions
    WHERE document_id = ${documentId} AND branch_id = ${mainBranchId}
      AND version_number = ${versionNumber}
  `;
  return rows[0]?.snapshot;
}

beforeAll(async () => {
  sql = postgres(TEST_DATABASE_URL, { max: 1 });

  const connection: DatabaseConnection = {
    async query(sqlQuery, params) {
      const result = await sql.unsafe(sqlQuery, params as postgres.ParameterOrJSON<never>[]);
      const rows = [...result] as never[];
      const resultWithCount = result as unknown as { count?: number };
      return { rows, rowCount: resultWithCount.count ?? rows.length };
    },
    async close() {
      // The suite owns the client's lifecycle; afterAll ends it.
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
    VALUES (${PANTHEON_SITE_ID}, 'Test Published Snapshot Repair Site')
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

describe('Published snapshot repair [PCC-3652]', () => {
  it('rebuilds a stripped published version and reports the unrecoverable one', async () => {
    const healthyId = await publishThenStrip('pages/repairable', ['v1', 'v2', 'v3']);

    const brokenId = await publishThenStrip('pages/unrecoverable', ['v1', 'v2', 'v3']);
    // Break the chain below the published version, the way legacy pre-049
    // corruption did (backdated past the content-constraint fence).
    await sql`
      UPDATE app.document_versions
      SET snapshot = NULL, patch = NULL, created_at = '2020-01-01T00:00:00Z'
      WHERE document_id = ${brokenId} AND branch_id = ${mainBranchId} AND version_number = 2
    `;

    // Scoped to this suite's site so leftovers in the shared local database
    // can neither be rewritten by this test nor fail it.
    const site = { siteId: testSiteId };

    // Dry run reports both without writing anything.
    const dry = await repairPublishedSnapshots({ dryRun: true, ...site });
    expect(dry.repaired.map((e) => e.documentId)).toContain(healthyId);
    expect(dry.unrecoverable.map((e) => e.documentId)).toContain(brokenId);
    expect(await getSnapshot(healthyId, 3)).toBeNull();

    // Execute writes the rebuild for the healthy row only.
    const result = await repairPublishedSnapshots({ dryRun: false, ...site });
    expect(result.repaired.map((e) => e.documentId)).toContain(healthyId);
    expect(result.unrecoverable.map((e) => e.documentId)).toContain(brokenId);

    expect(await getSnapshot(healthyId, 3)).toEqual({ title: 'v3' });
    expect(await getSnapshot(brokenId, 3)).toBeNull();

    // Re-running finds nothing left to repair for the healthy document.
    const again = await repairPublishedSnapshots({ dryRun: false, ...site });
    expect(again.repaired.map((e) => e.documentId)).not.toContain(healthyId);
  });

  it('counts a corrupt stored patch as unrecoverable and keeps going', async () => {
    const patchBrokenId = await publishThenStrip('pages/bad-patch', ['v1', 'v2', 'v3']);
    // A stored patch targeting a path absent from the baseline — the
    // corrupt-patch shape of legacy damage, distinct from a missing patch.
    // (With validation off, fast-json-patch surfaces this as a raw TypeError;
    // reconstructVersionSnapshot types it as VersionReconstructionError.)
    await sql`
      UPDATE app.document_versions
      SET patch = '[{"op":"remove","path":"/no/such/path"}]'::jsonb
      WHERE document_id = ${patchBrokenId} AND branch_id = ${mainBranchId} AND version_number = 2
    `;
    const repairableId = await publishThenStrip('pages/after-bad-patch', ['v1', 'v2']);

    // The bad patch must not abort the run — later rows still get repaired.
    const result = await repairPublishedSnapshots({ dryRun: false, siteId: testSiteId });
    expect(result.unrecoverable.map((e) => e.documentId)).toContain(patchBrokenId);
    expect(result.repaired.map((e) => e.documentId)).toContain(repairableId);
    expect(await getSnapshot(repairableId, 2)).toEqual({ title: 'v2' });
  });

  it('ignores versions referenced only by non-publish checkpoints', async () => {
    const first = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: 'pages/session-checkpoint-only',
      snapshot: { title: 'v1' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    await createDocumentVersion({
      documentId: first.document.id,
      branchId: mainBranchId,
      snapshot: { title: 'v2' },
      source: 'edit',
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    // A session checkpoint referencing v2, then strip v2 — "needs a fresh
    // publish" would be wrong advice here, so repair must not report it.
    const checkpoint = await sql<{ id: string }[]>`
      INSERT INTO app.checkpoints (branch_id, name, checkpoint_type, created_by_id, created_by_type, status)
      VALUES (${mainBranchId}, 'session', 'session_pre_edit', ${SYSTEM_ACTOR}, 'system', 'completed')
      RETURNING id
    `;
    const version = await sql<{ id: string }[]>`
      SELECT id FROM app.document_versions
      WHERE document_id = ${first.document.id} AND branch_id = ${mainBranchId} AND version_number = 2
    `;
    await sql`
      INSERT INTO app.checkpoint_documents (checkpoint_id, document_id, document_version_id)
      VALUES (${checkpoint[0].id}, ${first.document.id}, ${version[0].id})
    `;
    await sql`
      UPDATE app.document_versions SET snapshot = NULL WHERE id = ${version[0].id}
    `;

    const result = await repairPublishedSnapshots({ dryRun: true, siteId: testSiteId });
    expect(result.repaired.map((e) => e.documentId)).not.toContain(first.document.id);
    expect(result.unrecoverable.map((e) => e.documentId)).not.toContain(first.document.id);
  });
});
