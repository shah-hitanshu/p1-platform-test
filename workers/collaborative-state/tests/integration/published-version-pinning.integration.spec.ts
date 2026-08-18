/**
 * Published version snapshot pinning [PCC-3652].
 *
 * Publishing a document on main only records a checkpoint pointer at the tip
 * version row — it writes no new row. Before this fix, the next edit's
 * compaction legally nulled that row's snapshot, leaving published content
 * dependent on replaying the entire patch chain, where a single broken link
 * anywhere in history silently takes the live page down (the Webhook Wombat
 * homepage outage).
 *
 * The contract under test: a checkpoint-referenced version keeps its full
 * snapshot forever, so published content stays servable no matter what happens
 * to the rest of the chain — and publish refuses to checkpoint content it
 * cannot materialize.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance, type DatabaseConnection } from '../../src/db';
import {
  createDocumentOnBranch,
  createDocumentVersion,
  publishDocument,
  reconstructVersionSnapshot,
  VersionReconstructionError,
} from '../../src/services';
import { batchSyncToPostgres } from '../../src/services/document-version-service';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

const PANTHEON_SITE_ID = 'test-published-version-pinning-site';
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

/**
 * Rewrites a row into the shape of legacy pre-constraint corruption: neither
 * snapshot nor patch (like Webhook Wombat's v6). Backdating created_at slips
 * it past migration 049's fence, which deliberately leaves such legacy rows
 * writable.
 */
async function corruptVersionRow(documentId: string, versionNumber: number): Promise<void> {
  await sql`
    UPDATE app.document_versions
    SET snapshot = NULL, patch = NULL, created_at = '2020-01-01T00:00:00Z'
    WHERE document_id = ${documentId} AND branch_id = ${mainBranchId}
      AND version_number = ${versionNumber}
  `;
}

async function getVersionRow(
  documentId: string,
  versionNumber: number,
): Promise<{ snapshot: unknown; patch: unknown }> {
  const rows = await sql<{ snapshot: unknown; patch: unknown }[]>`
    SELECT snapshot, patch FROM app.document_versions
    WHERE document_id = ${documentId} AND branch_id = ${mainBranchId}
      AND version_number = ${versionNumber}
  `;
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function createPage(path: string, versions: string[]): Promise<string> {
  const first = await createDocumentOnBranch({
    siteId: testSiteId,
    branchId: mainBranchId,
    path,
    snapshot: { title: versions[0] },
    createdById: SYSTEM_ACTOR,
    createdByType: 'system',
  });
  for (const title of versions.slice(1)) {
    await createDocumentVersion({
      documentId: first.document.id,
      branchId: mainBranchId,
      snapshot: { title },
      source: 'edit',
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
  }
  return first.document.id;
}

async function publish(documentId: string): Promise<void> {
  await publishDocument({
    siteId: testSiteId,
    branchId: mainBranchId,
    documentId,
    createdById: SYSTEM_ACTOR,
    createdByType: 'system',
  });
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
    VALUES (${PANTHEON_SITE_ID}, 'Test Published Version Pinning Site')
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

describe('Published version snapshot pinning [PCC-3652]', () => {
  it('keeps a published version snapshot when a later edit compacts', async () => {
    const documentId = await createPage('pages/pinned-survives-edit', ['v1', 'v2', 'v3']);
    await publish(documentId); // checkpoints v3, the tip
    await createDocumentVersion({
      documentId,
      branchId: mainBranchId,
      snapshot: { title: 'v4' },
      source: 'edit',
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    // The published v3 kept its snapshot despite carrying a patch of its own…
    const v3 = await getVersionRow(documentId, 3);
    expect(v3.snapshot).not.toBeNull();
    expect(v3.patch).not.toBeNull();

    // …while the unpublished v2 was compacted normally — the guard protects
    // exactly the checkpoint-referenced rows, nothing more.
    const v2 = await getVersionRow(documentId, 2);
    expect(v2.snapshot).toBeNull();

    expect(await reconstructVersionSnapshot(documentId, mainBranchId, 3)).toEqual({ title: 'v3' });
  });

  it('serves a published version even when the chain below it is broken', async () => {
    const documentId = await createPage('pages/pinned-survives-corruption', ['v1', 'v2', 'v3']);
    await publish(documentId);
    await createDocumentVersion({
      documentId,
      branchId: mainBranchId,
      snapshot: { title: 'v4' },
      source: 'edit',
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    // Wombat scenario: legacy corruption below the published version.
    await corruptVersionRow(documentId, 2);

    // The corrupt row itself is unreconstructable — that damage is real…
    await expect(
      reconstructVersionSnapshot(documentId, mainBranchId, 2),
    ).rejects.toThrow(VersionReconstructionError);

    // …but the published version no longer depends on the chain.
    expect(await reconstructVersionSnapshot(documentId, mainBranchId, 3)).toEqual({ title: 'v3' });
  });

  it('batch sync also skips checkpoint-referenced rows', async () => {
    const documentId = await createPage('pages/pinned-survives-batch-sync', ['v1', 'v2']);
    await publish(documentId); // checkpoints v2

    const result = await batchSyncToPostgres([
      {
        documentId,
        branchId: mainBranchId,
        snapshot: { title: 'v3' },
        actorId: SYSTEM_ACTOR,
        actorType: 'user',
      },
    ]);
    expect(result.inserted).toHaveLength(1);

    const v2 = await getVersionRow(documentId, 2);
    expect(v2.snapshot).not.toBeNull();
    expect(await reconstructVersionSnapshot(documentId, mainBranchId, 2)).toEqual({ title: 'v2' });
  });

  it('publish repairs a tip whose snapshot is missing', async () => {
    const documentId = await createPage('pages/publish-repairs-tip', ['v1', 'v2', 'v3']);
    // A tip should always hold its snapshot; strip it (patch stays, so the
    // content constraint allows it) to model historical damage or the
    // publish/compaction race remnant.
    await sql`
      UPDATE app.document_versions SET snapshot = NULL
      WHERE document_id = ${documentId} AND branch_id = ${mainBranchId} AND version_number = 3
    `;

    await publish(documentId);

    // Publish rebuilt the content from the healthy chain and pinned it.
    const v3 = await getVersionRow(documentId, 3);
    expect(v3.snapshot).toEqual({ title: 'v3' });

    const checkpointed = await sql<{ document_version_id: string }[]>`
      SELECT cd.document_version_id FROM app.checkpoint_documents cd
      JOIN app.document_versions dv ON dv.id = cd.document_version_id
      WHERE cd.document_id = ${documentId} AND dv.version_number = 3
    `;
    expect(checkpointed).toHaveLength(1);
  });

  it('compacts a session-checkpointed row normally', async () => {
    // The guard is scoped to publish checkpoints on purpose: session
    // checkpoints reference every document's tip on every editing session,
    // and exempting them would stop compaction reclaiming anything on the
    // common editing path. Snapshot retention for non-publish checkpoint
    // reverts is PCC-3662/PCC-3663.
    const documentId = await createPage('pages/session-checkpoint-compacts', ['v1', 'v2']);
    const version = await sql<{ id: string }[]>`
      SELECT id FROM app.document_versions
      WHERE document_id = ${documentId} AND branch_id = ${mainBranchId} AND version_number = 2
    `;
    const checkpoint = await sql<{ id: string }[]>`
      INSERT INTO app.checkpoints (branch_id, name, checkpoint_type, created_by_id, created_by_type, status)
      VALUES (${mainBranchId}, 'pre-edit', 'session_pre_edit', ${SYSTEM_ACTOR}, 'system', 'completed')
      RETURNING id
    `;
    await sql`
      INSERT INTO app.checkpoint_documents (checkpoint_id, document_id, document_version_id)
      VALUES (${checkpoint[0].id}, ${documentId}, ${version[0].id})
    `;

    await createDocumentVersion({
      documentId,
      branchId: mainBranchId,
      snapshot: { title: 'v3' },
      source: 'edit',
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    const v2 = await getVersionRow(documentId, 2);
    expect(v2.snapshot).toBeNull();
    expect(v2.patch).not.toBeNull();
  });

  it('publish stamps pinned_at on the version it checkpoints', async () => {
    const documentId = await createPage('pages/publish-stamps-pin', ['v1', 'v2']);
    await publish(documentId);

    const rows = await sql<{ pinned_at: Date | null }[]>`
      SELECT pinned_at FROM app.document_versions
      WHERE document_id = ${documentId} AND branch_id = ${mainBranchId} AND version_number = 2
    `;
    expect(rows[0].pinned_at).not.toBeNull();
  });

  it('compaction skips a pinned row even without a checkpoint reference', async () => {
    // Isolates the pinned_at predicate — the half of the guard that closes
    // the publish-moment race, where a compaction statement's NOT EXISTS is
    // checked against a snapshot that predates the checkpoint insert.
    const documentId = await createPage('pages/pin-without-checkpoint', ['v1', 'v2']);
    await sql`
      UPDATE app.document_versions SET pinned_at = NOW()
      WHERE document_id = ${documentId} AND branch_id = ${mainBranchId} AND version_number = 2
    `;

    await createDocumentVersion({
      documentId,
      branchId: mainBranchId,
      snapshot: { title: 'v3' },
      source: 'edit',
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    const v2 = await getVersionRow(documentId, 2);
    expect(v2.snapshot).not.toBeNull();
  });

  it('refuses to publish a tip that cannot be reconstructed', async () => {
    const documentId = await createPage('pages/publish-refuses-broken', ['v1', 'v2', 'v3']);
    await sql`
      UPDATE app.document_versions SET snapshot = NULL
      WHERE document_id = ${documentId} AND branch_id = ${mainBranchId} AND version_number = 3
    `;
    await corruptVersionRow(documentId, 2);

    // Publishing must fail loudly rather than checkpoint a version that would
    // render as nothing.
    await expect(publish(documentId)).rejects.toThrow(VersionReconstructionError);

    // And the failure rolled back cleanly: no checkpoint, no partial write.
    const checkpointed = await sql<{ document_version_id: string }[]>`
      SELECT document_version_id FROM app.checkpoint_documents WHERE document_id = ${documentId}
    `;
    expect(checkpointed).toHaveLength(0);
    const v3 = await getVersionRow(documentId, 3);
    expect(v3.snapshot).toBeNull();
  });
});
