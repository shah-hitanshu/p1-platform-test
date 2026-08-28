/**
 * Drift candidate selection - Integration Tests
 *
 * The drift listing pages its candidates in the database, so the query itself
 * decides which documents a branch can see: the ones it holds a live version of,
 * plus the ones it inherits from main because they were published there. An
 * archived document, one deleted on the branch, and an unpublished document on main
 * are all out of scope, and the page walks candidates in path order.
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
  upsertBranchDocumentPaths,
} from '../../src/services/branch-document-service';
import { createDocumentVersion } from '../../src/services/document-version-service';
import { publishDocument } from '../../src/services/checkpoint-service';
import { createTranslation } from '../../src/services/create-translation-service';
import { listDriftCandidates } from '../../src/services/relations-service';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'drift-candidates-test';

const HEADING = {
  type: 'HeadingBlock',
  props: { id: 'HeadingBlock-1', title: 'Hello', level: 'h1' },
};

function makeSnapshot(title: string): Record<string, unknown> {
  return { content: [HEADING], root: { props: { title } }, zones: {} };
}

/**
 * Creates a canonical with a translation of it, then advances the canonical so the
 * translation's pin falls behind and it qualifies as a candidate.
 */
async function makeDriftedTranslation(
  siteId: string,
  branchId: string,
  path: string,
  locale: string,
): Promise<{ canonicalId: string; translationId: string }> {
  const canonical = await createDocumentOnBranch({
    siteId,
    branchId,
    path,
    snapshot: makeSnapshot('canonical v1'),
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
    snapshot: makeSnapshot('canonical v2'),
    source: 'edit',
    createdById: TEST_USER_ID,
    createdByType: 'user',
  });

  return { canonicalId: canonical.document.id, translationId: translation.document.id };
}

describe('Drift candidate selection - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let mainBranchId: string;
  let featureBranchId: string;
  let plainTranslationId: string;
  let archivedTranslationId: string;
  let deletedTranslationId: string;
  let unpublishedTranslationId: string;
  let inheritedPageId: string;
  let unpublishedPageId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'drift-candidates@example.com', 'Drift Candidates User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Drift Candidates Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    mainBranchId = branches[0].id as string;

    const plain = await makeDriftedTranslation(siteId, mainBranchId, 'pages/a-plain', 'fr-FR');
    plainTranslationId = plain.translationId;

    const archived = await makeDriftedTranslation(siteId, mainBranchId, 'pages/b-archived', 'es-ES');
    archivedTranslationId = archived.translationId;
    await sql`UPDATE app.documents SET archived_at = NOW() WHERE id = ${archivedTranslationId}`;

    const deleted = await makeDriftedTranslation(siteId, mainBranchId, 'pages/c-deleted', 'it-IT');
    deletedTranslationId = deleted.translationId;

    // A template-bound page carries a template edge, whose candidacy does not depend
    // on a target version on the request branch — the case where inheriting from
    // main is observable.
    const template = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: 'templates/page',
      snapshot: makeSnapshot('template v1'),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const inheritedPage = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: 'pages/d-inherited',
      snapshot: makeSnapshot('page on main'),
      templateId: template.document.id,
      templateVersion: 1,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    inheritedPageId = inheritedPage.document.id;
    await publishDocument({
      siteId,
      branchId: mainBranchId,
      documentId: inheritedPageId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const unpublishedPage = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: 'pages/f-unpublished-page',
      snapshot: makeSnapshot('unpublished page on main'),
      templateId: template.document.id,
      templateVersion: 1,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    unpublishedPageId = unpublishedPage.document.id;

    // Never published, so a branch holding no version of it does not inherit it.
    const unpublished = await makeDriftedTranslation(
      siteId,
      mainBranchId,
      'pages/e-unpublished',
      'pt-BR',
    );
    unpublishedTranslationId = unpublished.translationId;

    const featureBranch = await createBranch({
      siteId,
      name: 'candidates-feature',
      sourceBranchId: mainBranchId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    featureBranchId = featureBranch.id;

    // Deleting on main writes a tombstone as the newest version there.
    await deleteDocumentOnBranch({
      documentId: deletedTranslationId,
      branchId: mainBranchId,
      deletedById: TEST_USER_ID,
      deletedByType: 'user',
    });
  });

  afterAll(async () => {
    await deleteSiteCascade(sql, siteId);
    await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    await sql.end();
    setDatabaseInstance(null);
  });

  async function candidateIds(branchId: string, mainId: string | undefined): Promise<string[]> {
    const { candidates } = await listDriftCandidates('localization', branchId, mainId, {
      limit: 50,
      offset: 0,
    });
    return candidates.map((candidate) => candidate.documentId);
  }

  it('lists a drifted translation the branch holds', async () => {
    expect(await candidateIds(mainBranchId, undefined)).toContain(plainTranslationId);
  });

  it('leaves out an archived translation', async () => {
    expect(await candidateIds(mainBranchId, undefined)).not.toContain(archivedTranslationId);
  });

  it('leaves out a translation deleted on the branch', async () => {
    expect(await candidateIds(mainBranchId, undefined)).not.toContain(deletedTranslationId);
  });

  it('leaves out an unpublished translation the branch never held', async () => {
    expect(await candidateIds(featureBranchId, mainBranchId)).not.toContain(
      unpublishedTranslationId,
    );
  });

  it('includes a published template-bound page the branch inherits from main', async () => {
    const { candidates } = await listDriftCandidates('template', featureBranchId, mainBranchId, {
      limit: 50,
      offset: 0,
    });

    expect(candidates.map((candidate) => candidate.documentId)).toContain(inheritedPageId);
  });

  it('leaves out an unpublished page the branch never held', async () => {
    const { candidates } = await listDriftCandidates('template', featureBranchId, mainBranchId, {
      limit: 50,
      offset: 0,
    });

    expect(candidates.map((candidate) => candidate.documentId)).not.toContain(unpublishedPageId);
  });

  it('reports no localization candidates on a branch holding none of the canonicals', async () => {
    expect(await candidateIds(featureBranchId, mainBranchId)).toEqual([]);
  });

  it('orders candidates by path', async () => {
    const { candidates } = await listDriftCandidates('localization', mainBranchId, undefined, {
      limit: 50,
      offset: 0,
    });

    const paths = candidates.map((candidate) => candidate.path);
    expect(paths).toEqual([...paths].sort());
  });

  it('carries the locale of each candidate', async () => {
    const { candidates } = await listDriftCandidates('localization', mainBranchId, undefined, {
      limit: 50,
      offset: 0,
    });

    const plain = candidates.find((candidate) => candidate.documentId === plainTranslationId);
    expect(plain?.locale).toBe('fr-FR');
  });

  it('reports the candidate path the branch sees, not the global one', async () => {
    await upsertBranchDocumentPaths(mainBranchId, [
      { documentId: plainTranslationId, newPath: 'moved/a-plain.fr-fr' },
    ]);
    try {
      const { candidates } = await listDriftCandidates('localization', mainBranchId, undefined, {
        limit: 50,
        offset: 0,
      });

      const plain = candidates.find((candidate) => candidate.documentId === plainTranslationId);
      expect(plain?.path).toBe('moved/a-plain.fr-fr');
      // Ordering follows the path the branch sees, so the moved candidate sorts
      // where its new path puts it.
      const paths = candidates.map((candidate) => candidate.path);
      expect(paths).toEqual([...paths].sort());
    } finally {
      await sql`DELETE FROM app.branch_document_paths
                 WHERE branch_id = ${mainBranchId} AND document_id = ${plainTranslationId}`;
    }
  });

  it('reports more remaining when the page does not reach the end', async () => {
    const { candidates, hasMore } = await listDriftCandidates(
      'localization',
      mainBranchId,
      undefined,
      { limit: 1, offset: 0 },
    );

    expect(candidates).toHaveLength(1);
    expect(hasMore).toBe(true);
  });

  it('reports nothing remaining once the page covers the last candidate', async () => {
    const { hasMore } = await listDriftCandidates('localization', mainBranchId, undefined, {
      limit: 50,
      offset: 0,
    });

    expect(hasMore).toBe(false);
  });

  it('walks candidates across pages without repeating one', async () => {
    const first = await listDriftCandidates('localization', mainBranchId, undefined, {
      limit: 1,
      offset: 0,
    });
    const second = await listDriftCandidates('localization', mainBranchId, undefined, {
      limit: 1,
      offset: 1,
    });

    expect(second.candidates[0]?.documentId).not.toBe(first.candidates[0]?.documentId);
  });

  it('yields an empty page past the last candidate', async () => {
    const { candidates, hasMore } = await listDriftCandidates(
      'localization',
      mainBranchId,
      undefined,
      { limit: 10, offset: 500 },
    );

    expect(candidates).toEqual([]);
    expect(hasMore).toBe(false);
  });
});
