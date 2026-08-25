/**
 * Tombstone-aware serving [PCC-3669].
 *
 * Deleting a document writes an unpublished tombstone version at the branch
 * tip, but the publish pointer keeps referencing the pre-deletion version and
 * nothing can publish a tombstone (publishDocument refuses; checkpoints
 * exclude tombstoned documents). Serving therefore applies the rule: a
 * deletion supersedes every earlier publish. A deleted page leaves the live
 * site immediately, and a deleted-then-recreated page stays off the live
 * site until a fresh publish postdates the deletion — the old published
 * content never silently resurrects.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance, type DatabaseConnection } from '../../src/db';
import {
  createDocumentOnBranch,
  createDocumentVersion,
  publishDocument,
  getLatestPublishedDocumentVersion,
  hasTombstoneAfterVersion,
  listDocumentsOnBranch,
} from '../../src/services';
import { deleteDocumentOnBranch } from '../../src/services/branch-document-service';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

const PANTHEON_SITE_ID = 'test-tombstone-aware-serving-site';
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
    VALUES (${PANTHEON_SITE_ID}, 'Test Tombstone Aware Serving Site')
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

describe('Tombstone-aware serving [PCC-3669]', () => {
  it('marks a published-then-deleted document as tombstoned while the publish pointer survives', async () => {
    const page = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: 'pages/published-then-deleted',
      snapshot: { title: 'live content' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    const documentId = page.document.id;
    await publishDocument({
      siteId: testSiteId,
      branchId: mainBranchId,
      documentId,
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });

    const publishedBefore = await getLatestPublishedDocumentVersion(documentId, mainBranchId);
    expect(publishedBefore).not.toBeNull();
    expect(
      await hasTombstoneAfterVersion(documentId, mainBranchId, publishedBefore!.versionNumber),
    ).toBe(false);

    await deleteDocumentOnBranch({
      documentId,
      branchId: mainBranchId,
      deletedById: SYSTEM_ACTOR,
      deletedByType: 'service',
    });

    // The deletion is visible through the rule serving now applies…
    expect(
      await hasTombstoneAfterVersion(documentId, mainBranchId, publishedBefore!.versionNumber),
    ).toBe(true);

    // …and the listing already agreed (the pre-existing convention).
    const docs = await listDocumentsOnBranch(mainBranchId, {});
    expect(docs.map((d) => d.id)).not.toContain(documentId);

    // The publish pointer deliberately survives deletion — this is exactly why
    // serving cannot rely on it and must check the tip [PCC-3669].
    const published = await getLatestPublishedDocumentVersion(documentId, mainBranchId);
    expect(published).not.toBeNull();
    expect(published?.isTombstone).toBe(false);
  });

  it('treats a never-published deleted document the same way', async () => {
    const page = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: 'pages/never-published-deleted',
      snapshot: { title: 'draft only' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    await deleteDocumentOnBranch({
      documentId: page.document.id,
      branchId: mainBranchId,
      deletedById: SYSTEM_ACTOR,
      deletedByType: 'service',
    });

    // Never published: serving already 404s on the null publish pointer.
    expect(await getLatestPublishedDocumentVersion(page.document.id, mainBranchId)).toBeNull();
  });

  it('keeps a deleted-then-recreated document off the live site until a fresh publish', async () => {
    const page = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: 'pages/deleted-then-recreated',
      snapshot: { title: 'original published content' },
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    const documentId = page.document.id;
    await publishDocument({
      siteId: testSiteId,
      branchId: mainBranchId,
      documentId,
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    const originalPublished = await getLatestPublishedDocumentVersion(documentId, mainBranchId);
    await deleteDocumentOnBranch({
      documentId,
      branchId: mainBranchId,
      deletedById: SYSTEM_ACTOR,
      deletedByType: 'service',
    });

    // Recreate: a new non-tombstone tip. The tombstone still postdates the
    // original publish, so serving keeps the page off the live site — the
    // pre-deletion published content must not silently resurrect.
    await createDocumentVersion({
      documentId,
      branchId: mainBranchId,
      snapshot: { title: 'recreated draft' },
      source: 'edit',
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    expect(
      await hasTombstoneAfterVersion(documentId, mainBranchId, originalPublished!.versionNumber),
    ).toBe(true);

    // Only a fresh publish that postdates the deletion brings it back — and it
    // serves the recreated content, never the pre-deletion version.
    await publishDocument({
      siteId: testSiteId,
      branchId: mainBranchId,
      documentId,
      createdById: SYSTEM_ACTOR,
      createdByType: 'system',
    });
    const republished = await getLatestPublishedDocumentVersion(documentId, mainBranchId);
    expect(republished?.snapshot).toEqual({ title: 'recreated draft' });
    expect(
      await hasTombstoneAfterVersion(documentId, mainBranchId, republished!.versionNumber),
    ).toBe(false);
  });
});
