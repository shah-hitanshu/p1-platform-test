/**
 * Locale coverage - Integration Tests
 *
 * The coverage listing decides in one query which locale variants a branch can
 * see: the ones it holds a live version of, plus the ones it inherits from main
 * because they were published there. A variant in sync with its canonical counts,
 * which is what separates this listing from the drift one. Archived documents on
 * either end of the edge, a variant deleted on the branch, and a variant with no
 * locale tag are all out of scope.
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
import { createBranch, getBranch } from '../../src/services/branch-service';
import {
  createDocumentOnBranch,
  deleteDocumentOnBranch,
} from '../../src/services/branch-document-service';
import { publishDocument } from '../../src/services/checkpoint-service';
import { createTranslation } from '../../src/services/create-translation-service';
import { upsertBranchDocumentPaths } from '../../src/services/branch-document-service';
import { getBranchLocaleCoverage } from '../../src/services/locale-coverage-service';
import type { LocaleCoverage } from '../../src/services/locale-coverage-service';

const TEST_USER_ID = '76767676-7676-7676-7676-767676767676';
const SITE_PREFIX = 'locale-coverage-test';

const HEADING = {
  type: 'HeadingBlock',
  props: { id: 'HeadingBlock-1', title: 'Hello', level: 'h1' },
};

function makeSnapshot(title: string): Record<string, unknown> {
  return { content: [HEADING], root: { props: { title } }, zones: {} };
}

describe('Locale coverage - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let mainBranchId: string;
  let featureBranchId: string;

  let publishedCanonicalId: string;
  let publishedFrenchId: string;
  let publishedGermanId: string;
  let unpublishedCanonicalId: string;
  let unpublishedSpanishId: string;
  let archivedCanonicalId: string;
  let archivedItalianId: string;
  let untaggedPortugueseId: string;
  let branchCanonicalId: string;
  let branchOnlyDutchId: string;

  async function makeCanonical(path: string, branchId: string = mainBranchId): Promise<string> {
    const created = await createDocumentOnBranch({
      siteId,
      branchId,
      path,
      snapshot: makeSnapshot(path),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    return created.document.id;
  }

  async function makeTranslation(
    canonicalDocumentId: string,
    locale: string,
    branchId: string = mainBranchId,
  ): Promise<string> {
    const created = await createTranslation({
      canonicalDocumentId,
      branchId,
      locale,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    return created.document.id;
  }

  async function publish(documentId: string, branchId: string = mainBranchId): Promise<void> {
    await publishDocument({
      siteId,
      branchId,
      documentId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
  }

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'locale-coverage@example.com', 'Locale Coverage User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Locale Coverage Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    mainBranchId = branches[0].id as string;

    // The canonical and both translations are published, so a branch holding no
    // version of them inherits all three.
    publishedCanonicalId = await makeCanonical('pages/a-published');
    publishedFrenchId = await makeTranslation(publishedCanonicalId, 'fr');
    publishedGermanId = await makeTranslation(publishedCanonicalId, 'de-DE');
    await publish(publishedCanonicalId);
    await publish(publishedFrenchId);
    await publish(publishedGermanId);

    // Never published, so an inheriting branch cannot see it.
    unpublishedCanonicalId = await makeCanonical('pages/b-unpublished');
    unpublishedSpanishId = await makeTranslation(unpublishedCanonicalId, 'es-ES');

    archivedCanonicalId = await makeCanonical('pages/c-archived-canonical');
    archivedItalianId = await makeTranslation(archivedCanonicalId, 'it-IT');

    untaggedPortugueseId = await makeTranslation(publishedCanonicalId, 'pt-BR');
    await sql`UPDATE app.documents SET locale = NULL WHERE id = ${untaggedPortugueseId}`;

    const featureBranch = await createBranch({
      siteId,
      name: 'coverage-feature',
      sourceBranchId: mainBranchId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    featureBranchId = featureBranch.id;

    // createTranslation clones the canonical's version on the request branch, so the
    // branch must hold one of its own.
    branchCanonicalId = await makeCanonical('pages/d-branch-only', featureBranchId);
    branchOnlyDutchId = await makeTranslation(branchCanonicalId, 'nl', featureBranchId);
  });

  afterAll(async () => {
    await deleteSiteCascade(sql, siteId);
    await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    await sql.end();
    setDatabaseInstance(null);
  });

  async function coverageOn(branchId: string): Promise<LocaleCoverage> {
    const branch = await getBranch(branchId);
    if (branch === null) {
      throw new Error(`branch ${branchId} not found`);
    }
    return await getBranchLocaleCoverage(branch);
  }

  function variantIds(coverage: LocaleCoverage): string[] {
    return coverage.coverage.flatMap((entry) => entry.variants.map((v) => v.documentId));
  }

  describe('on main', () => {
    it('groups every visible variant under its canonical, sorted by locale', async () => {
      const coverage = await coverageOn(mainBranchId);

      const entry = coverage.coverage.find(
        (candidate) => candidate.canonicalDocumentId === publishedCanonicalId,
      );
      // Paths are stored case-folded, so the locale tag is what carries the casing.
      expect(entry?.variants).toEqual([
        { locale: 'de-DE', documentId: publishedGermanId, path: 'pages/a-published.de-de' },
        { locale: 'fr', documentId: publishedFrenchId, path: 'pages/a-published.fr' },
      ]);
    });

    it('counts a translation that is in sync with its canonical', async () => {
      // Nothing has advanced the canonical, so the drift listing would exclude these.
      const coverage = await coverageOn(mainBranchId);

      expect(variantIds(coverage)).toContain(publishedFrenchId);
    });

    it('lists a variant of an unpublished canonical the branch itself holds', async () => {
      const coverage = await coverageOn(mainBranchId);

      expect(variantIds(coverage)).toContain(unpublishedSpanishId);
    });

    it('derives the locale list from the variants it returned', async () => {
      const coverage = await coverageOn(mainBranchId);

      expect(coverage.locales).toEqual(['de-DE', 'es-ES', 'fr', 'it-IT']);
    });

    it('omits a variant carrying no locale tag', async () => {
      const coverage = await coverageOn(mainBranchId);

      expect(variantIds(coverage)).not.toContain(untaggedPortugueseId);
    });

    it('omits a variant authored on another branch', async () => {
      const coverage = await coverageOn(mainBranchId);

      expect(variantIds(coverage)).not.toContain(branchOnlyDutchId);
    });
  });

  describe('on a branch inheriting from main', () => {
    it('lists the variants it inherits from main', async () => {
      const coverage = await coverageOn(featureBranchId);

      expect(variantIds(coverage)).toEqual(
        expect.arrayContaining([publishedFrenchId, publishedGermanId]),
      );
    });

    it('lists a variant authored on the branch itself', async () => {
      const coverage = await coverageOn(featureBranchId);

      expect(variantIds(coverage)).toContain(branchOnlyDutchId);
    });

    it('omits a variant that was never published on main', async () => {
      const coverage = await coverageOn(featureBranchId);

      expect(variantIds(coverage)).not.toContain(unpublishedSpanishId);
    });
  });

  describe('paths', () => {
    const pathOf = (coverage: LocaleCoverage, documentId: string): string | undefined =>
      coverage.coverage
        .flatMap((entry) => entry.variants)
        .find((variant) => variant.documentId === documentId)?.path;

    it('reports the variant path the branch sees, not the global one', async () => {
      await upsertBranchDocumentPaths(featureBranchId, [
        { documentId: publishedFrenchId, newPath: 'moved/about.fr' },
      ]);
      try {
        const onBranch = await coverageOn(featureBranchId);
        const onMain = await coverageOn(mainBranchId);

        expect(pathOf(onBranch, publishedFrenchId)).toBe('moved/about.fr');
        // The move is scoped to the branch that made it.
        expect(pathOf(onMain, publishedFrenchId)).toBe('pages/a-published.fr');
      } finally {
        await sql`DELETE FROM app.branch_document_paths
                   WHERE branch_id = ${featureBranchId} AND document_id = ${publishedFrenchId}`;
      }
    });
  });

  // Each case archives or deletes a document and asserts it drops out, so each
  // first asserts it was there: an exclusion test passes on a query that returns
  // nothing at all. Whatever a case mutates it restores, so the assertions above
  // that read the whole listing hold whichever order these run in.
  describe('exclusions', () => {
    it('omits an archived variant', async () => {
      expect(variantIds(await coverageOn(mainBranchId))).toContain(archivedItalianId);

      await sql`UPDATE app.documents SET archived_at = NOW() WHERE id = ${archivedItalianId}`;
      try {
        expect(variantIds(await coverageOn(mainBranchId))).not.toContain(archivedItalianId);
      } finally {
        await sql`UPDATE app.documents SET archived_at = NULL WHERE id = ${archivedItalianId}`;
      }
    });

    it('omits a variant whose canonical is archived', async () => {
      expect(variantIds(await coverageOn(mainBranchId))).toContain(archivedItalianId);

      await sql`UPDATE app.documents SET archived_at = NOW() WHERE id = ${archivedCanonicalId}`;
      try {
        expect(variantIds(await coverageOn(mainBranchId))).not.toContain(archivedItalianId);
      } finally {
        await sql`UPDATE app.documents SET archived_at = NULL WHERE id = ${archivedCanonicalId}`;
      }
    });

    it('omits a variant deleted on the branch', async () => {
      // Its own canonical and variant: deleting one of the shared fixtures would
      // leave a tombstone no later assertion could see past.
      const canonicalId = await makeCanonical('pages/e-deleted');
      const japaneseId = await makeTranslation(canonicalId, 'ja');

      expect(variantIds(await coverageOn(mainBranchId))).toContain(japaneseId);

      await deleteDocumentOnBranch({
        documentId: japaneseId,
        branchId: mainBranchId,
        deletedById: TEST_USER_ID,
        deletedByType: 'user',
      });

      expect(variantIds(await coverageOn(mainBranchId))).not.toContain(japaneseId);
    });
  });
});
