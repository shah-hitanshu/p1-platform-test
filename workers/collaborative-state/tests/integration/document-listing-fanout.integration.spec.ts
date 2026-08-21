/**
 * Document listing row multiplicity - Integration Tests
 *
 * listDocumentsOnBranch resolves each document's latest version and its publish
 * state through joins onto one-to-many tables. Row multiplicity is a property of
 * the SQL, so only a real database proves it: every assertion here counts rows
 * for a document whose version and publish history is deep enough that a join
 * emitting one row per version, or per publish checkpoint, would show up.
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
import { createDocumentVersion } from '../../src/services/document-version-service';
import { publishDocument } from '../../src/services/checkpoint-publish';
import {
  createDocumentOnBranch,
  countDocumentsOnBranch,
  deleteDocumentOnBranch,
  listDocumentsOnBranch,
} from '../../src/services/branch-document-service';

const TEST_USER_ID = '66666666-6666-6666-6666-666666666666';
const SITE_PREFIX = 'listing-fanout-test';

/** Deep enough that a per-version fan-out is unmistakable in a row count. */
const VERSION_DEPTH = 12;

describe('Document listing row multiplicity - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let mainBranchId: string;
  let featureBranchId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'listing-fanout@example.com', 'Listing Fanout User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Listing Fanout Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    const mainBranch = branches[0];
    if (mainBranch === undefined) {
      throw new Error('site created without a main branch');
    }
    mainBranchId = mainBranch.id as string;

    const feature = await createBranch({
      name: 'feature',
      siteId,
      sourceBranchId: mainBranchId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    featureBranchId = feature.id;
  });

  afterAll(async () => {
    try {
      await deleteSiteCascade(sql, siteId);
      await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    } finally {
      await sql.end();
      setDatabaseInstance(null);
    }
  });

  /** Creates a document on `branchId` and edits it up to VERSION_DEPTH versions. */
  async function createWithHistory(path: string, branchId: string): Promise<string> {
    const { document } = await createDocumentOnBranch({
      siteId,
      branchId,
      path,
      snapshot: { root: { props: { title: `${path} v1` } } },
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    for (let n = 2; n <= VERSION_DEPTH; n++) {
      await createDocumentVersion({
        documentId: document.id,
        branchId,
        snapshot: { root: { props: { title: `${path} v${String(n)}` } } },
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
    }

    return document.id;
  }

  function occurrencesOf(documentId: string, documents: { id: string }[]): number {
    return documents.filter((d) => d.id === documentId).length;
  }

  it('returns one row per document regardless of version-history depth', async () => {
    const documentId = await createWithHistory('pages/deep-history', mainBranchId);

    const documents = await listDocumentsOnBranch(mainBranchId);

    expect(occurrencesOf(documentId, documents)).toBe(1);
  });

  it('reports the latest version as the document title and modification time', async () => {
    const documentId = await createWithHistory('pages/latest-wins', mainBranchId);

    const documents = await listDocumentsOnBranch(mainBranchId);
    const listed = documents.find((d) => d.id === documentId);

    expect(listed?.snapshotTitle).toBe(`pages/latest-wins v${String(VERSION_DEPTH)}`);
  });

  it('returns one row per document across repeated publishes', async () => {
    const documentId = await createWithHistory('pages/republished', mainBranchId);

    for (let n = 0; n < 3; n++) {
      await publishDocument({
        siteId,
        documentId,
        branchId: mainBranchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
    }

    const documents = await listDocumentsOnBranch(mainBranchId);
    const listed = documents.find((d) => d.id === documentId);

    expect(occurrencesOf(documentId, documents)).toBe(1);
    expect(listed?.isPublished).toBe(true);
  });

  it('excludes a document whose latest version on the branch is a tombstone', async () => {
    const documentId = await createWithHistory('pages/deleted-here', mainBranchId);

    await deleteDocumentOnBranch({
      documentId,
      branchId: mainBranchId,
      deletedById: TEST_USER_ID,
      deletedByType: 'user',
    });

    const documents = await listDocumentsOnBranch(mainBranchId);

    expect(occurrencesOf(documentId, documents)).toBe(0);
  });

  describe('on a branch inheriting from main', () => {
    it('returns one inherited row for a document published on main', async () => {
      const documentId = await createWithHistory('pages/inherited-deep', mainBranchId);
      await publishDocument({
        siteId,
        documentId,
        branchId: mainBranchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const documents = await listDocumentsOnBranch(featureBranchId, { mainBranchId });
      const listed = documents.find((d) => d.id === documentId);

      expect(occurrencesOf(documentId, documents)).toBe(1);
      expect(listed?.inherited).toBe(true);
    });

    it('omits a document on main that has never been published', async () => {
      const documentId = await createWithHistory('pages/unpublished-on-main', mainBranchId);

      const documents = await listDocumentsOnBranch(featureBranchId, { mainBranchId });

      expect(occurrencesOf(documentId, documents)).toBe(0);
    });

    it('omits a published document whose latest version on main is a tombstone', async () => {
      const documentId = await createWithHistory('pages/deleted-on-main', mainBranchId);
      await publishDocument({
        siteId,
        documentId,
        branchId: mainBranchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      await deleteDocumentOnBranch({
        documentId,
        branchId: mainBranchId,
        deletedById: TEST_USER_ID,
        deletedByType: 'user',
      });

      const documents = await listDocumentsOnBranch(featureBranchId, { mainBranchId });

      expect(occurrencesOf(documentId, documents)).toBe(0);
    });

    it('prefers the branch version over main once the document is edited locally', async () => {
      const documentId = await createWithHistory('pages/overridden', mainBranchId);
      await publishDocument({
        siteId,
        documentId,
        branchId: mainBranchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      await createDocumentVersion({
        documentId,
        branchId: featureBranchId,
        snapshot: { root: { props: { title: 'edited on feature' } } },
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const documents = await listDocumentsOnBranch(featureBranchId, { mainBranchId });
      const listed = documents.find((d) => d.id === documentId);

      expect(occurrencesOf(documentId, documents)).toBe(1);
      expect(listed?.inherited).toBe(false);
      expect(listed?.snapshotTitle).toBe('edited on feature');
    });
  });

  // PCC-3661: the count is the pagination total for the listing, and the two
  // are computed by different SQL in the same Promise.all — so any divergence
  // shows up to users as a wrong page count.
  describe('countDocumentsOnBranch pagination totals (PCC-3661)', () => {
    it('counts a deep-history document once, agreeing with the listing', async () => {
      await createWithHistory('pages/count-deep-history', mainBranchId);

      const documents = await listDocumentsOnBranch(mainBranchId);
      const count = await countDocumentsOnBranch(mainBranchId);

      // VERSION_DEPTH versions must contribute exactly one to the total; the
      // pre-fix count returned one per version.
      expect(count).toBe(documents.length);
    });

    it('keeps inherited pages in the total when a path prefix and template filter are combined', async () => {
      const { document: template } = await createDocumentOnBranch({
        siteId,
        branchId: mainBranchId,
        path: 'pages/count-template-definition',
        snapshot: { root: { props: { title: 'template def' } } },
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const pageId = await createWithHistory(
        'pages/counted/inherited-templated',
        mainBranchId,
      );
      await sql`
        INSERT INTO app.document_relations (source_document_id, target_document_id, relation_type)
        VALUES (${pageId}, ${template.id}, 'template')
      `;
      await publishDocument({
        siteId,
        documentId: pageId,
        branchId: mainBranchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const options = {
        mainBranchId,
        pathPrefix: 'pages/counted/',
        templateId: template.id,
      };
      const documents = await listDocumentsOnBranch(featureBranchId, options);
      const count = await countDocumentsOnBranch(featureBranchId, options);

      // The listing returns the inherited templated page; the pre-fix count
      // compared its path against the template ID and dropped it.
      expect(documents.length).toBeGreaterThan(0);
      expect(count).toBe(documents.length);
    });
  });
});
