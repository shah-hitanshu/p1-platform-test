/**
 * Recreating a document whose tombstoned version is checkpoint-pinned
 * [PCC-3938].
 *
 * `createDocumentOnBranch` used to recreate over a tombstone by deleting
 * every `app.document_versions` row for the (document, branch) pair before
 * inserting the fresh version. `app.checkpoint_documents.document_version_id`
 * has a plain (NO ACTION) foreign key to `document_versions`, so that DELETE
 * throws a foreign key violation — and the whole transaction rolls back —
 * whenever a checkpoint (for example, one written by a prior publish) still
 * references one of the rows being deleted. The recreate then 500s instead
 * of succeeding.
 *
 * The fix stops deleting that history. This test reproduces the exact
 * sequence from the report — create, publish (which pins the version in a
 * checkpoint), delete, recreate at the same path — and expects success
 * rather than a 500.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type postgres from 'postgres';
import { createRealDatabaseConnection } from '../helpers/database';
import {
  createDocumentOnBranch,
  deleteDocumentOnBranch,
  publishDocument,
  createCheckpoint,
  createBranch,
  resolveCheckpointDocuments,
} from '../../src/services';

const PANTHEON_SITE_ID = 'test-recreate-checkpoint-pin-site';
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

let sql: postgres.Sql;
let close: () => Promise<void>;
let testSiteId: string;
let mainBranchId: string;

async function purgeSite(siteId: string): Promise<void> {
  // A branch created off a checkpoint (the branch-creation test case below)
  // holds source_checkpoint_id, a NO ACTION FK to app.checkpoints — null it
  // out first or deleting checkpoints below fails the same way this whole
  // suite is about.
  await sql`UPDATE app.branches SET source_checkpoint_id = NULL WHERE site_id = ${siteId}`;
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
  const handles = createRealDatabaseConnection();
  sql = handles.sql;
  close = handles.close;

  const stale = await sql<{ id: string }[]>`
    SELECT id FROM app.sites WHERE pantheon_site_id = ${PANTHEON_SITE_ID}
  `;
  if (stale.length > 0) {
    await purgeSite(stale[0].id);
  }

  const site = await sql<{ id: string }[]>`
    INSERT INTO app.sites (pantheon_site_id, name)
    VALUES (${PANTHEON_SITE_ID}, 'Test Recreate Checkpoint Pin Site')
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
  await close();
});

/** The document_version_id a specific checkpoint pinned for a document. */
async function pinnedVersionId(checkpointId: string, documentId: string): Promise<string> {
  const rows = await sql<{ document_version_id: string }[]>`
    SELECT document_version_id FROM app.checkpoint_documents
    WHERE checkpoint_id = ${checkpointId} AND document_id = ${documentId}
  `;
  expect(rows).toHaveLength(1);
  return rows[0]!.document_version_id;
}

/**
 * AC3 asks for more than "the row still exists": the pinned version must
 * stay resolvable from its checkpoint. Asserting only presence in
 * document_versions would miss a chain that stops returning it even though
 * the row itself survives, so this resolves through resolveCheckpointDocuments
 * (the same chain-walk the checkpoint API and revert use) and checks the
 * document still comes back with its pre-deletion snapshot.
 */
async function expectStillPinnedAndResolvable(
  checkpointId: string,
  documentId: string,
  versionId: string,
  documentPath: string,
  expectedSnapshot: Record<string, unknown>,
): Promise<void> {
  const stillPinned = await sql<{ id: string }[]>`
    SELECT id FROM app.document_versions WHERE id = ${versionId}
  `;
  expect(stillPinned).toHaveLength(1);

  const resolved = await resolveCheckpointDocuments(checkpointId);
  const entry = resolved.find((d) => d.documentId === documentId);
  expect(entry).toBeDefined();
  expect(entry?.documentPath).toBe(documentPath);
  expect(entry?.snapshot).toEqual(expectedSnapshot);
}

describe('Recreating over a checkpoint-pinned tombstone [PCC-3938]', () => {
  // Three routes write a checkpoint_documents row that can pin a version:
  // publishing (checkpoint-publish.ts), branch creation (branch-api.ts, every
  // branch checkpoints its source), and a full-mode checkpoint
  // (checkpoint-service.ts, which pins every non-tombstoned version on the
  // branch). All three reach the same DELETE, so all three are covered here.

  it('succeeds instead of 500ing when a checkpoint pins a version being recreated over (publish)', async () => {
    const path = 'pages/recreate-over-pinned-checkpoint';

    const created = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path,
      snapshot: { title: 'original content' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    const documentId = created.document.id;

    // Publishing writes a checkpoint (`app.checkpoints`/`checkpoint_documents`)
    // whose document_version_id pins this document's published version.
    const { checkpoint } = await publishDocument({
      siteId: testSiteId,
      branchId: mainBranchId,
      documentId,
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    const versionId = await pinnedVersionId(checkpoint.id, documentId);
    const pinnedVersionRow = await sql<{ id: string }[]>`
      SELECT id FROM app.document_versions WHERE id = ${versionId}
    `;
    // Sanity check: the pinned row genuinely exists among this branch's
    // history at the moment we delete-then-recreate below.
    expect(pinnedVersionRow).toHaveLength(1);

    await deleteDocumentOnBranch({
      documentId,
      branchId: mainBranchId,
      deletedById: SYSTEM_ACTOR,
      deletedByType: 'service',
    });

    // Before the fix, this threw a foreign key violation (23503) on the
    // DELETE FROM app.document_versions the recreate path used to run,
    // because the checkpoint above still references one of those rows.
    const recreated = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path,
      snapshot: { title: 'recreated content' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    expect(recreated.document.id).toBe(documentId);
    expect(recreated.version.source).toBe('recreate');
    expect(recreated.version.snapshot).toEqual({ title: 'recreated content' });

    // The checkpoint-pinned row survives, and the published checkpoint still
    // resolves this document to its pre-deletion snapshot — the recreate must
    // not disturb what the publish checkpoint serves.
    await expectStillPinnedAndResolvable(
      checkpoint.id,
      documentId,
      versionId,
      path,
      { title: 'original content' },
    );

    // The new version continues the branch's version sequence rather than
    // resetting to 1 — insertNextDocumentVersion scopes MAX(version_number)
    // to (document_id, branch_id), independent of what was deleted.
    const allVersions = await sql<{ version_number: number }[]>`
      SELECT version_number FROM app.document_versions
      WHERE document_id = ${documentId} AND branch_id = ${mainBranchId}
      ORDER BY version_number ASC
    `;
    expect(allVersions.map((v) => v.version_number)).toEqual([1, 2, 3]);
    expect(recreated.version.versionNumber).toBe(3);
  });

  it('succeeds when a version is pinned by the checkpoint every branch creation writes', async () => {
    const path = 'pages/recreate-over-pinned-branch-checkpoint';

    const created = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path,
      snapshot: { title: 'original content' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    const documentId = created.document.id;

    // Mirrors routes/branch-api.ts:166 — every branch creation checkpoints
    // its source branch first, unconditionally, with no forceFullSnapshot.
    // A page that was never published still gets pinned this way the moment
    // anyone branches, which is the broader latent surface behind this bug.
    const { checkpoint } = await createCheckpoint({
      branchId: mainBranchId,
      name: 'Auto-created for branching',
      checkpointType: 'auto',
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    await createBranch({
      siteId: testSiteId,
      name: `branch-off-${documentId}`,
      sourceBranchId: mainBranchId,
      sourceCheckpointId: checkpoint.id,
      createdById: SYSTEM_ACTOR,
      createdByType: 'agent',
    });

    const versionId = await pinnedVersionId(checkpoint.id, documentId);

    await deleteDocumentOnBranch({
      documentId,
      branchId: mainBranchId,
      deletedById: SYSTEM_ACTOR,
      deletedByType: 'service',
    });

    const recreated = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path,
      snapshot: { title: 'recreated content' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    expect(recreated.document.id).toBe(documentId);
    expect(recreated.version.source).toBe('recreate');

    await expectStillPinnedAndResolvable(
      checkpoint.id,
      documentId,
      versionId,
      path,
      { title: 'original content' },
    );
  });

  it('succeeds when a version is pinned by a full-mode checkpoint', async () => {
    const path = 'pages/recreate-over-pinned-full-checkpoint';

    const created = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path,
      snapshot: { title: 'original content' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    const documentId = created.document.id;

    // Mirrors checkpoint-service.ts's full-mode path: pins every
    // non-tombstoned version on the branch, not just a delta.
    const { checkpoint } = await createCheckpoint({
      branchId: mainBranchId,
      name: 'Full snapshot',
      checkpointType: 'manual',
      forceFullSnapshot: true,
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    const versionId = await pinnedVersionId(checkpoint.id, documentId);

    await deleteDocumentOnBranch({
      documentId,
      branchId: mainBranchId,
      deletedById: SYSTEM_ACTOR,
      deletedByType: 'service',
    });

    const recreated = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path,
      snapshot: { title: 'recreated content' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    expect(recreated.document.id).toBe(documentId);
    expect(recreated.version.source).toBe('recreate');

    await expectStillPinnedAndResolvable(
      checkpoint.id,
      documentId,
      versionId,
      path,
      { title: 'original content' },
    );
  });
});
