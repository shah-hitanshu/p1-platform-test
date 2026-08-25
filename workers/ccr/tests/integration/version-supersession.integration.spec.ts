/**
 * Superseded version marking — Integration Tests
 *
 * Registry documents accumulated ~89,881 versions from a write-only CI sync,
 * and every query that wants a document's newest version was reading that
 * history to find it. Superseded rows are now marked and skipped by exactly
 * those queries; nothing is deleted, and every history path still sees them.
 *
 * The marking is a database trigger and the predicates are SQL, so only a real
 * database proves either. The invariant that matters most is one-directional:
 * a row is marked only when a strictly newer version already exists, so no
 * state of this column can hide a live document.
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
import { createCheckpoint } from '../../src/services/checkpoint-service';
import {
  createDocumentOnBranch,
  countDocumentsOnBranch,
  listDocumentsOnBranch,
} from '../../src/services/branch-document-service';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'version-supersession-test';

/** Deep enough that reading the whole history would be unmistakable. */
const VERSION_DEPTH = 10;

describe('Superseded version marking - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let mainBranchId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);
    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'version-supersession@example.com', 'Supersession User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Version Supersession Site',
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

  function liveVersions(documentId: string, branchId: string) {
    return sql<{ version_number: number }[]>`
      SELECT version_number FROM app.document_versions
      WHERE document_id = ${documentId} AND branch_id = ${branchId}
        AND superseded_at IS NULL
      ORDER BY version_number`;
  }

  describe('the trigger', () => {
    it('leaves exactly the newest version live as history accumulates', async () => {
      const documentId = await createWithHistory('pages/marked', mainBranchId);

      const live = await liveVersions(documentId, mainBranchId);
      expect(live).toHaveLength(1);
      expect(live[0].version_number).toBe(VERSION_DEPTH);
    });

    it('preserves the full history — marking is not deletion', async () => {
      const documentId = await createWithHistory('pages/history-intact', mainBranchId);

      const all = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM app.document_versions
        WHERE document_id = ${documentId} AND branch_id = ${mainBranchId}`;
      expect(all[0].count).toBe(String(VERSION_DEPTH));

      // Every row stays reconstructable — a snapshot, or a patch onto its
      // predecessor (migration 049's invariant). Marking touches neither.
      const content = await sql<{ snapshot: unknown; patch: unknown }[]>`
        SELECT snapshot, patch FROM app.document_versions
        WHERE document_id = ${documentId} AND branch_id = ${mainBranchId}
        ORDER BY version_number`;
      expect(content).toHaveLength(VERSION_DEPTH);
      expect(content.every((r) => r.snapshot !== null || r.patch !== null)).toBe(true);
    });

    it('never marks a row unless a strictly newer version exists', async () => {
      // The whole safety argument rests on this: a marked row always has a
      // live successor, so the predicate cannot hide a document.
      //
      // Creates its own history so the table-wide scan below is guaranteed to
      // have marked rows to check — without it, running this test in
      // isolation would pass vacuously over an empty table.
      const documentId = await createWithHistory('pages/invariant-fixture', mainBranchId);
      const marked = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM app.document_versions
        WHERE document_id = ${documentId} AND branch_id = ${mainBranchId}
          AND superseded_at IS NOT NULL`;
      expect(marked[0].count).toBe(String(VERSION_DEPTH - 1));

      const orphaned = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM app.document_versions v
        WHERE v.superseded_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM app.document_versions newer
            WHERE newer.document_id = v.document_id
              AND newer.branch_id = v.branch_id
              AND newer.version_number > v.version_number)`;
      expect(orphaned[0].count).toBe('0');
    });

    it('marks the older version when a branch scopes its own history', async () => {
      const featureBranch = await createBranch({
        name: `feature-${String(Date.now())}`,
        siteId,
        sourceBranchId: mainBranchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      const documentId = await createWithHistory('pages/branch-scoped', featureBranch.id);

      const onFeature = await liveVersions(documentId, featureBranch.id);
      expect(onFeature).toHaveLength(1);
      expect(onFeature[0].version_number).toBe(VERSION_DEPTH);
    });
  });

  describe('counts', () => {
    it('counts a deep-history document once, agreeing with the listing', async () => {
      await createWithHistory('pages/counted-once', mainBranchId);

      const documents = await listDocumentsOnBranch(mainBranchId);
      const count = await countDocumentsOnBranch(mainBranchId);

      expect(count).toBe(documents.length);
    });

    it('still counts an inherited document whose published version is not the newest', async () => {
      // The published arm of the inheriting count deliberately carries no
      // superseded_at filter: a publish pins a version that later edits move
      // past, and filtering would drop the document out of the count entirely.
      const documentId = await createWithHistory('pages/published-then-edited', mainBranchId);
      await publishDocument({
        siteId,
        branchId: mainBranchId,
        documentId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      await createDocumentVersion({
        documentId,
        branchId: mainBranchId,
        snapshot: { root: { props: { title: 'edited past the publish' } } },
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const published = await sql<{ superseded_at: string | null }[]>`
        SELECT dv.superseded_at
        FROM app.checkpoint_documents cd
        JOIN app.document_versions dv ON dv.id = cd.document_version_id
        WHERE dv.document_id = ${documentId}`;
      expect(published.length).toBeGreaterThan(0);
      expect(published.every((r) => r.superseded_at !== null)).toBe(true);

      const inheriting = await createBranch({
        name: `inherits-${String(Date.now())}`,
        siteId,
        sourceBranchId: mainBranchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const count = await countDocumentsOnBranch(inheriting.id, { mainBranchId });
      const documents = await listDocumentsOnBranch(inheriting.id, { mainBranchId });
      expect(count).toBe(documents.length);
      expect(documents.some((d) => d.id === documentId)).toBe(true);
    });
  });

  describe('checkpoint capture', () => {
    it('captures the newest version of a deep-history document, exactly once', async () => {
      const documentId = await createWithHistory('pages/captured', mainBranchId);

      const { checkpoint } = await createCheckpoint({
        branchId: mainBranchId,
        checkpointType: 'manual',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const captured = await sql<{ version_number: number }[]>`
        SELECT dv.version_number
        FROM app.checkpoint_documents cd
        JOIN app.document_versions dv ON dv.id = cd.document_version_id
        WHERE cd.checkpoint_id = ${checkpoint.id} AND dv.document_id = ${documentId}`;

      expect(captured).toHaveLength(1);
      expect(captured[0].version_number).toBe(VERSION_DEPTH);
    });
  });
});
