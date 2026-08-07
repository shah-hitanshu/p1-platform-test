/**
 * Dead upstream - Integration Tests
 *
 * An edge target that is gone is not something to reconcile against. A target that
 * is archived, or whose newest version on the branch it is read from is a tombstone,
 * yields no summary and no candidate, so nothing is asked to take a delta computed
 * from a deleted document. This holds for both relation types: a page's template and
 * a translation's canonical.
 *
 * The rules follow the ones template migration already applies to its target:
 * archived refuses the operation (`triggerMigration`), and a tombstoned newest
 * version reads as absent rather than falling back to main
 * (`getLatestTemplateVersionWithFallback`).
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
import {
  createDocumentOnBranch,
  deleteDocumentOnBranch,
} from '../../src/services/branch-document-service';
import { createDocumentVersion } from '../../src/services/document-version-service';
import { createTranslation } from '../../src/services/create-translation-service';
import { buildChangeSummary } from '../../src/services/change-summary-service';
import { listDriftCandidates } from '../../src/services/relations-service';
import { listBranchDrift } from '../../src/services/branch-drift-service';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'dead-upstream-test';

const HEADING = { type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title: 'Hello' } };
const IMAGE = { type: 'ImageBlock', props: { id: 'ImageBlock-1', src: '/a.jpg' } };

function snap(components: unknown[], title: string): Record<string, unknown> {
  return { content: components, root: { props: { title, _pinMap: {} } }, zones: {} };
}

describe('Dead upstream - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let branchId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;
    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'dead-upstream@example.com', 'Dead Upstream User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Dead Upstream Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    branchId = branches[0].id as string;
  });

  afterAll(async () => {
    await deleteSiteCascade(sql, siteId);
    await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    await sql.end();
    setDatabaseInstance(null);
  });

  /** A canonical that has moved on, and a translation pinned behind it. */
  async function makeDriftedTranslation(path: string, locale: string): Promise<{
    canonicalId: string;
    translationId: string;
  }> {
    const canonical = await createDocumentOnBranch({
      siteId,
      branchId,
      path,
      snapshot: snap([HEADING], 'canonical v1'),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    const translation = await createTranslation({
      canonicalDocumentId: canonical.document.id,
      branchId,
      locale,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    await createDocumentVersion({
      documentId: canonical.document.id,
      branchId,
      snapshot: snap([HEADING, IMAGE], 'canonical v2'),
      source: 'edit',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    return { canonicalId: canonical.document.id, translationId: translation.document.id };
  }

  /** A template that has moved on, and a page pinned behind it. */
  async function makeDriftedPage(templatePath: string, pagePath: string): Promise<{
    templateId: string;
    pageId: string;
  }> {
    const template = await createDocumentOnBranch({
      siteId,
      branchId,
      path: templatePath,
      snapshot: snap([HEADING], 'template v1'),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    const page = await createDocumentOnBranch({
      siteId,
      branchId,
      path: pagePath,
      snapshot: snap([HEADING], 'page'),
      templateId: template.document.id,
      templateVersion: 1,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    await createDocumentVersion({
      documentId: template.document.id,
      branchId,
      snapshot: snap([HEADING, IMAGE], 'template v2'),
      source: 'edit',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    return { templateId: template.document.id, pageId: page.document.id };
  }

  async function summaryFor(
    sourceDocumentId: string,
    relationType: 'template' | 'localization',
    readFromBranchId: string = branchId,
  ): Promise<unknown> {
    return buildChangeSummary({ sourceDocumentId, branchId: readFromBranchId, relationType });
  }

  async function candidateIds(relationType: 'template' | 'localization'): Promise<string[]> {
    const { candidates } = await listDriftCandidates(relationType, branchId, undefined, {
      limit: 50,
      offset: 0,
    });
    return candidates.map((candidate) => candidate.documentId);
  }

  describe('a live upstream still reports drift', () => {
    it('summarises a translation against its canonical', async () => {
      const { translationId } = await makeDriftedTranslation('pages/live-loc', 'fr-FR');

      expect(await summaryFor(translationId, 'localization')).not.toBeNull();
      expect(await candidateIds('localization')).toContain(translationId);
    });

    it('summarises a page against its template', async () => {
      const { pageId } = await makeDriftedPage('templates/live', 'pages/live-tpl');

      expect(await summaryFor(pageId, 'template')).not.toBeNull();
      expect(await candidateIds('template')).toContain(pageId);
    });
  });

  describe('an archived upstream', () => {
    it('yields no summary for a translation whose canonical is archived', async () => {
      const { canonicalId, translationId } = await makeDriftedTranslation(
        'pages/archived-loc',
        'es-ES',
      );
      await sql`UPDATE app.documents SET archived_at = NOW() WHERE id = ${canonicalId}`;

      expect(await summaryFor(translationId, 'localization')).toBeNull();
    });

    it('drops that translation from the candidates', async () => {
      const { canonicalId, translationId } = await makeDriftedTranslation(
        'pages/archived-loc-2',
        'it-IT',
      );
      await sql`UPDATE app.documents SET archived_at = NOW() WHERE id = ${canonicalId}`;

      expect(await candidateIds('localization')).not.toContain(translationId);
    });

    it('yields no summary for a page whose template is archived', async () => {
      const { templateId, pageId } = await makeDriftedPage(
        'templates/archived',
        'pages/archived-tpl',
      );
      await sql`UPDATE app.documents SET archived_at = NOW() WHERE id = ${templateId}`;

      expect(await summaryFor(pageId, 'template')).toBeNull();
    });

    it('drops that page from the candidates', async () => {
      const { templateId, pageId } = await makeDriftedPage(
        'templates/archived-2',
        'pages/archived-tpl-2',
      );
      await sql`UPDATE app.documents SET archived_at = NOW() WHERE id = ${templateId}`;

      expect(await candidateIds('template')).not.toContain(pageId);
    });
  });

  describe('an upstream deleted on the branch', () => {
    it('yields no summary for a translation whose canonical was deleted', async () => {
      const { canonicalId, translationId } = await makeDriftedTranslation(
        'pages/deleted-loc',
        'pt-BR',
      );
      await deleteDocumentOnBranch({
        documentId: canonicalId,
        branchId,
        deletedById: TEST_USER_ID,
        deletedByType: 'user',
      });

      expect(await summaryFor(translationId, 'localization')).toBeNull();
    });

    it('yields no summary for a page whose template was deleted', async () => {
      const { templateId, pageId } = await makeDriftedPage(
        'templates/deleted',
        'pages/deleted-tpl',
      );
      await deleteDocumentOnBranch({
        documentId: templateId,
        branchId,
        deletedById: TEST_USER_ID,
        deletedByType: 'user',
      });

      expect(await summaryFor(pageId, 'template')).toBeNull();
    });

    it('keeps a deleted upstream out of the branch drift listing', async () => {
      const { canonicalId, translationId } = await makeDriftedTranslation(
        'pages/deleted-loc-2',
        'nl-NL',
      );
      await deleteDocumentOnBranch({
        documentId: canonicalId,
        branchId,
        deletedById: TEST_USER_ID,
        deletedByType: 'user',
      });

      const page = await listBranchDrift(branchId, 'localization', { limit: 50, offset: 0 });
      expect(page.drift.map((entry) => entry.documentId)).not.toContain(translationId);
    });
  });

  describe('an upstream deleted on one branch only', () => {
    it('reads the deletion on that branch without falling back to main', async () => {
      const { canonicalId, translationId } = await makeDriftedTranslation(
        'pages/branch-deleted-loc',
        'da-DK',
      );
      const featureBranch = await createBranch({
        siteId,
        name: `feature-${String(Date.now())}`,
        sourceBranchId: branchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      await deleteDocumentOnBranch({
        documentId: canonicalId,
        branchId: featureBranch.id,
        deletedById: TEST_USER_ID,
        deletedByType: 'user',
      });

      expect(await summaryFor(translationId, 'localization', featureBranch.id)).toBeNull();
      expect(await summaryFor(translationId, 'localization', branchId)).not.toBeNull();
    });
  });
});
