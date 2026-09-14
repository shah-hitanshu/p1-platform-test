/**
 * Merging a translation two workstreams hold - Integration Tests
 *
 * A locale is held once per site, as one document each branch reads through its own
 * versions, so two branches translating a page into the same language end up
 * editing one document along separate histories. Merging them is therefore an
 * ordinary same-document merge: clean while only one branch has changed it, and a
 * both-modified conflict once both have.
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
import {
  createMergeRequest,
  updateMergeRequestStatus,
} from '../../src/services/merge-request-service';
import { executeMerge, previewMerge } from '../../src/services/merge-execution-service';
import { getLatestDocumentVersion } from '../../src/services/document-version-service';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'shared-translation-merge';

const HEADING = {
  type: 'HeadingBlock',
  props: { id: 'HeadingBlock-1', title: 'Hello', level: 'h1' },
};

function snapshotTitled(title: string): Record<string, unknown> {
  return {
    content: [{ ...HEADING, props: { ...HEADING.props, title } }],
    root: { props: { title } },
    zones: {},
  };
}

describe('Merging a translation two workstreams hold - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let mainBranchId: string;
  let canonicalId: string;
  let translationId: string;
  let firstBranchId: string;
  let secondBranchId: string;

  async function newBranch(label: string): Promise<string> {
    const branch = await createBranch({
      siteId,
      name: `${label}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`,
      sourceBranchId: mainBranchId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    return branch.id;
  }

  async function mergeToMain(sourceBranchId: string): Promise<void> {
    const mergeRequest = await createMergeRequest({
      siteId,
      sourceBranchId,
      targetBranchId: mainBranchId,
      title: 'shared translation',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    await updateMergeRequestStatus(mergeRequest.id, 'approved');
    await executeMerge({
      mergeRequestId: mergeRequest.id,
      mergedById: TEST_USER_ID,
      mergedByType: 'user',
    });
  }

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'shared-translation-merge@example.com', 'Shared Translation User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Shared Translation Merge Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    mainBranchId = branches[0].id as string;

    const canonical = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: 'pages/home',
      snapshot: snapshotTitled('Hello'),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    canonicalId = canonical.document.id;
    await publishDocument({
      siteId,
      branchId: mainBranchId,
      documentId: canonicalId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    firstBranchId = await newBranch('first-translator');
    secondBranchId = await newBranch('second-translator');

    const first = await createTranslation({
      canonicalDocumentId: canonicalId,
      branchId: firstBranchId,
      locale: 'fr-FR',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    translationId = first.document.id;

    const second = await createTranslation({
      canonicalDocumentId: canonicalId,
      branchId: secondBranchId,
      locale: 'fr-FR',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    expect(second.document.id).toBe(translationId);

    for (const [branch, title] of [
      [firstBranchId, 'Bonjour'],
      [secondBranchId, 'Salut'],
    ] as const) {
      await createDocumentVersion({
        documentId: translationId,
        branchId: branch,
        snapshot: snapshotTitled(title),
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
    }
  });

  afterAll(async () => {
    await deleteSiteCascade(sql, siteId);
    await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    await sql.end();
    setDatabaseInstance(null);
  });

  it('merges the first branch cleanly, main holding no version of the translation', async () => {
    const preview = await previewMerge(firstBranchId, mainBranchId);

    expect(preview.canMerge).toBe(true);

    await mergeToMain(firstBranchId);

    const onMain = await getLatestDocumentVersion(translationId, mainBranchId);
    expect(onMain?.snapshot).toMatchObject({ root: { props: { title: 'Bonjour' } } });
  });

  it('reports the second branch as conflicting on the translation both changed', async () => {
    const preview = await previewMerge(secondBranchId, mainBranchId);

    expect(preview.canMerge).toBe(false);

    const conflicted = preview.conflicts.documentConflicts.find(
      (conflict) => conflict.documentId === translationId,
    );
    expect(conflicted?.conflictType).toBe('both-modified');
    // The canonical is untouched on both branches, so the translation is the whole
    // of the disagreement rather than one entry in a wider conflict.
    expect(preview.conflicts.documentConflicts.map((conflict) => conflict.documentId)).toEqual([
      translationId,
    ]);
  });

  it('leaves the content the first branch landed in place while the conflict stands', async () => {
    const onMain = await getLatestDocumentVersion(translationId, mainBranchId);

    expect(onMain?.snapshot).toMatchObject({ root: { props: { title: 'Bonjour' } } });
  });

  describe('A workstream that took the locale over and never translated it', () => {
    let untouchedCanonicalId: string;
    let untouchedTranslationId: string;
    let takingOverBranchId: string;

    beforeAll(async () => {
      const canonical = await createDocumentOnBranch({
        siteId,
        branchId: mainBranchId,
        path: 'pages/about',
        snapshot: snapshotTitled('Goodbye'),
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      untouchedCanonicalId = canonical.document.id;
      await publishDocument({
        siteId,
        branchId: mainBranchId,
        documentId: untouchedCanonicalId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const translatingBranchId = await newBranch('de-translator');
      takingOverBranchId = await newBranch('de-taker');

      const translating = await createTranslation({
        canonicalDocumentId: untouchedCanonicalId,
        branchId: translatingBranchId,
        locale: 'de-DE',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      untouchedTranslationId = translating.document.id;

      await createTranslation({
        canonicalDocumentId: untouchedCanonicalId,
        branchId: takingOverBranchId,
        locale: 'de-DE',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      await createDocumentVersion({
        documentId: untouchedTranslationId,
        branchId: translatingBranchId,
        snapshot: snapshotTitled('Auf Wiedersehen'),
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      await mergeToMain(translatingBranchId);
    });

    // Taking the locale over is itself a change to the document: the workstream holds
    // the canonical text to translate where the other holds a finished translation. A
    // clean merge would land untranslated text over it without anyone reading the diff.
    it('conflicts on the translation it seeded but never changed', async () => {
      const preview = await previewMerge(takingOverBranchId, mainBranchId);

      expect(preview.canMerge).toBe(false);

      const conflicted = preview.conflicts.documentConflicts.find(
        (conflict) => conflict.documentId === untouchedTranslationId,
      );
      expect(conflicted?.conflictType).toBe('both-modified');
    });

    it('leaves the finished translation on main while the conflict stands', async () => {
      const onMain = await getLatestDocumentVersion(untouchedTranslationId, mainBranchId);

      expect(onMain?.snapshot).toMatchObject({
        root: { props: { title: 'Auf Wiedersehen' } },
      });
    });
  });
});
