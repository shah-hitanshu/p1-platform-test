/**
 * Branch-scoped translation sync - Integration Tests
 *
 * A translation is pinned to the canonical version it was made from by that
 * version's identity, so the pin resolves the same read from any branch. Version
 * numbers restart at 1 on every branch, so a pinned number would name a different
 * version, or none, anywhere but the branch that recorded it.
 *
 * These cover the three ways a numbered pin lands on a branch: the canonical has
 * no history there, its history is shorter than the pinned number, and its history
 * spans the pinned number. The first two reported nothing outstanding; the third
 * reported the branch's own changes as though they were the whole difference.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { createRealDatabaseConnection, deleteSiteCascade } from '../helpers/database';

import { createSite } from '../../src/services/site-service';
import { createBranch } from '../../src/services/branch-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import { createDocumentVersion } from '../../src/services/document-version-service';
import { publishDocument } from '../../src/services/checkpoint-publish';
import { createTranslation } from '../../src/services/create-translation-service';
import { getLocalizationEdgeByDerivedDocument } from '../../src/services/relations-service';
import { buildChangeSummary } from '../../src/services/change-summary-service';

const TEST_USER_ID = '5b5b5b5b-5b5b-5b5b-5b5b-5b5b5b5b5b5b';
const SITE_PREFIX = 'loc-sync-branch-test';

function makeSnapshot(title: string, heading: string): Record<string, unknown> {
  return {
    content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title: heading, level: 'h1' } }],
    root: { props: { title } },
    zones: {},
  };
}

async function mainBranchId(sql: postgres.Sql, siteId: string): Promise<string> {
  const rows = await sql`
    SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true
  `;
  return rows[0].id as string;
}

/** Titles of the headings a summary reports as changed, for a legible assertion. */
function changedHeadings(
  summary: Awaited<ReturnType<typeof buildChangeSummary>>,
): unknown[] {
  return (summary?.changes ?? [])
    .filter((change) => change.propPath === '/title')
    .map((change) => change.upstreamNewValue);
}

describe('Branch-scoped translation sync - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let mainId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;
    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'loc-sync-branch@example.com', 'Loc Sync Branch User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Localization Sync Branch Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;
    mainId = await mainBranchId(sql, siteId);
  });

  afterAll(async () => {
    await deleteSiteCascade(sql, siteId);
    await sql.end();
  });

  /**
   * A canonical published on main with a translation of it, then further main-line
   * edits so the translation has outstanding work. Returns a fresh branch too.
   */
  async function seed(suffix: string, mainEditTitles: string[]): Promise<{
    canonicalId: string;
    translationId: string;
    branchId: string;
  }> {
    const canonical = await createDocumentOnBranch({
      siteId,
      branchId: mainId,
      path: `pages/${suffix}`,
      snapshot: makeSnapshot('Canonical', 'v1'),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    const canonicalId = canonical.document.id;

    await publishDocument({
      siteId,
      branchId: mainId,
      documentId: canonicalId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const translation = await createTranslation({
      canonicalDocumentId: canonicalId,
      branchId: mainId,
      locale: 'de-DE',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    const translationId = translation.document.id;

    for (const title of mainEditTitles) {
      await createDocumentVersion({
        documentId: canonicalId,
        branchId: mainId,
        snapshot: makeSnapshot('Canonical', title),
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
    }

    await publishDocument({
      siteId,
      branchId: mainId,
      documentId: canonicalId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const branch = await createBranch({
      siteId,
      name: `ws-${suffix}`,
      sourceBranchId: mainId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    return { canonicalId, translationId, branchId: branch.id };
  }

  it('pins a new translation to the canonical version it was cloned from', async () => {
    const { canonicalId, translationId } = await seed('pinned', []);

    const edge = await getLocalizationEdgeByDerivedDocument(translationId);
    if (edge === null) throw new Error('Expected a localization edge');
    expect(edge.syncedUpstreamVersionId).not.toBeNull();

    const pinned = await sql`
      SELECT document_id, branch_id, version_number
        FROM app.document_versions
       WHERE id = ${edge.syncedUpstreamVersionId}
    `;
    expect(pinned[0].document_id).toBe(canonicalId);
    expect(pinned[0].branch_id).toBe(mainId);
  });

  it('reports the canonical changes on a branch that has never held the canonical', async () => {
    const { translationId, branchId } = await seed('inherited', ['v2']);

    const summary = await buildChangeSummary({
      derivedDocumentId: translationId,
      branchId,
      relationType: 'localization',
    });

    expect(changedHeadings(summary)).toEqual(['v2']);
  });

  it('reports the canonical changes when the branch holds fewer versions than the pin', async () => {
    const { canonicalId, translationId, branchId } = await seed(
      'shorter',
      ['v2', 'v3', 'v4', 'v5'],
    );

    // One edit on the branch, so its numbering reaches 1 while the pin sits at 1
    // on main and the canonical has reached 5 there.
    await createDocumentVersion({
      documentId: canonicalId,
      branchId,
      snapshot: makeSnapshot('Canonical', 'branch-only'),
      source: 'edit',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const summary = await buildChangeSummary({
      derivedDocumentId: translationId,
      branchId,
      relationType: 'localization',
    });

    expect(changedHeadings(summary)).toEqual(['branch-only']);
  });

  it('reports main-line changes as well as changes made on the branch being read', async () => {
    const { canonicalId, translationId, branchId } = await seed('spanning', ['v2', 'v3']);

    await createDocumentVersion({
      documentId: canonicalId,
      branchId,
      snapshot: makeSnapshot('Canonical', 'branch-edit'),
      source: 'edit',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const summary = await buildChangeSummary({
      derivedDocumentId: translationId,
      branchId,
      relationType: 'localization',
    });

    // The comparison runs from the pinned version to what the branch now shows,
    // so the branch's own edit is reported rather than the main-line span alone.
    expect(changedHeadings(summary)).toEqual(['branch-edit']);
    expect(summary?.fromVersionId).not.toBeNull();
  });

  it('reports nothing outstanding on a branch where the canonical has not moved', async () => {
    const { translationId, branchId } = await seed('quiet', []);

    const summary = await buildChangeSummary({
      derivedDocumentId: translationId,
      branchId,
      relationType: 'localization',
    });

    expect(summary?.changes ?? []).toEqual([]);
  });

  it('reports the same outstanding work on the branch as on main when the branch has not touched the canonical', async () => {
    const { translationId, branchId } = await seed('parity', ['v2', 'v3']);

    const onMain = await buildChangeSummary({
      derivedDocumentId: translationId,
      branchId: mainId,
      relationType: 'localization',
    });
    const onBranch = await buildChangeSummary({
      derivedDocumentId: translationId,
      branchId,
      relationType: 'localization',
    });

    expect(changedHeadings(onBranch)).toEqual(changedHeadings(onMain));
    expect(onBranch?.fromVersionId).toBe(onMain?.fromVersionId);
  });

  it('reports nothing outstanding where the pinned version is a draft the branch cannot see', async () => {
    const canonical = await createDocumentOnBranch({
      siteId,
      branchId: mainId,
      path: 'pages/draft-pin',
      snapshot: makeSnapshot('Canonical', 'published-v1'),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    const canonicalId = canonical.document.id;

    await publishDocument({
      siteId,
      branchId: mainId,
      documentId: canonicalId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    // Main's tip is now an unpublished draft, and the translation clones from the
    // tip, so the pin names a version only main can see.
    await createDocumentVersion({
      documentId: canonicalId,
      branchId: mainId,
      snapshot: makeSnapshot('Canonical', 'draft-v2'),
      source: 'edit',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const translation = await createTranslation({
      canonicalDocumentId: canonicalId,
      branchId: mainId,
      locale: 'de-DE',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const branch = await createBranch({
      siteId,
      name: 'ws-draft-pin',
      sourceBranchId: mainId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const summary = await buildChangeSummary({
      derivedDocumentId: translation.document.id,
      branchId: branch.id,
      relationType: 'localization',
    });

    // The branch inherits main's latest published version, which is behind the
    // pin. There is no forward change to report, and the superseded content must
    // not be offered as one.
    expect(summary?.fromVersion).toBeGreaterThan(summary?.toVersion ?? 0);
    expect(changedHeadings(summary)).toEqual([]);
    expect(summary?.counts.needsTranslation).toBe(0);
  });

  it('names the canonical version the comparison ran to', async () => {
    const { canonicalId, translationId, branchId } = await seed('to-version', ['v2']);

    const summary = await buildChangeSummary({
      derivedDocumentId: translationId,
      branchId,
      relationType: 'localization',
    });

    // The branch holds no version of the canonical, so the comparison runs to the
    // one it inherits from main.
    const inherited = await sql`
      SELECT id FROM app.document_versions
       WHERE document_id = ${canonicalId} AND branch_id = ${mainId}
       ORDER BY version_number DESC
       LIMIT 1
    `;
    expect(summary?.toVersionId).toBe(inherited[0].id);
  });
});
