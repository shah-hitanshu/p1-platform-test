/**
 * Local smoke-test seed for the merge job runner [PCC-3737].
 *
 * Creates mock-Alice (the local mock-identity user), a site she owns, a
 * feature branch with a few documents, and an approved merge request — then
 * prints the ids so the runner can be exercised end-to-end through the live
 * wrangler-dev worker with curl.
 *
 * Usage (local only):
 *   POSTGRES_CONNECTION_STRING=postgresql://cssuser:csspass@localhost:5432/cssdb \
 *     npx tsx scripts/seed-merge-smoke.ts [docCount]
 */

// Registers the loader hooks before anything in the services graph resolves
// (same pattern as src/db/repair-published-snapshots.ts).
import '../src/db/node-esm-compat';

const { runWithConnection } = await import('../src/db');
const { createSite } = await import('../src/services/site-service');
const { createBranch } = await import('../src/services/branch-service');
const { createDocumentOnBranch } = await import('../src/services/branch-document-service');
const { createMergeRequest, updateMergeRequestStatus } = await import('../src/services/merge-request-service');
const { query } = await import('../src/db');

// Mock-identity Alice (DEFAULT_MOCK_CONFIG) — principal.id falls back to
// dbUserId, so seeding a users row with her exact id lines auth up.
const ALICE_ID = '11111111-1111-1111-1111-111111111111';

const DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

const docCount = Number.parseInt(process.argv[2] ?? '3', 10);

async function main(): Promise<void> {
  await runWithConnection(DATABASE_URL, { isHyperdrive: false }, async () => {
    await query(
      `INSERT INTO app.users (id, email, name)
       VALUES ($1, 'alice@example.com', 'Alice Developer')
       ON CONFLICT (id) DO NOTHING`,
      [ALICE_ID],
    );

    const site = await createSite({
      pantheonSiteId: `merge-smoke-${String(Date.now())}`,
      name: 'Merge Runner Smoke Site',
      creatorId: ALICE_ID,
    });

    const mainRows = await query<{ id: string }>(
      'SELECT id FROM app.branches WHERE site_id = $1 AND is_main = true',
      [site.id],
    );
    const mainBranchId = mainRows.rows[0]?.id;
    if (mainBranchId === undefined) throw new Error('no main branch');

    const feature = await createBranch({
      name: 'smoke-feature',
      siteId: site.id,
      sourceBranchId: mainBranchId,
      createdById: ALICE_ID,
      createdByType: 'user',
    });

    for (let n = 1; n <= docCount; n++) {
      await createDocumentOnBranch({
        siteId: site.id,
        branchId: feature.id,
        path: `pages/smoke/doc-${String(n).padStart(3, '0')}`,
        snapshot: { root: { props: { title: `Smoke doc ${String(n)}` } } },
        createdById: ALICE_ID,
        createdByType: 'user',
      });
    }

    const mergeRequest = await createMergeRequest({
      siteId: site.id,
      sourceBranchId: feature.id,
      targetBranchId: mainBranchId,
      title: `Merge runner smoke (${String(docCount)} docs)`,
      createdById: ALICE_ID,
      createdByType: 'user',
    });
    await updateMergeRequestStatus(mergeRequest.id, 'approved');

    console.log(JSON.stringify({
      siteId: site.id,
      mainBranchId,
      featureBranchId: feature.id,
      mergeRequestId: mergeRequest.id,
      docCount,
    }, null, 2));
  });
}

await main();
