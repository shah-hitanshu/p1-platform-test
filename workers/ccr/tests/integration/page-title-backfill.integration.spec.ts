/**
 * Page title backfill - Integration Tests
 *
 * Moves legacy top-level snapshot titles to root.props.title for the latest
 * version of each document, by writing a new version rather than rewriting rows.
 *
 * Prerequisites:
 * - PostgreSQL running (podman on this machine): podman start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';

import { createSite } from '../../src/services/site-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import {
  createDocumentVersion,
  getLatestDocumentVersion,
} from '../../src/services/document-version-service';
import { backfillPageTitles } from '../../src/services/page-title-backfill';
import { createRealDatabaseConnection } from '../helpers/database';

const TEST_USER_ID = '66666666-6666-6666-6666-666666666666';
const SITE_PREFIX = 'title-backfill-test';

describe('Page title backfill - Integration Tests', () => {
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
      VALUES (${TEST_USER_ID}, 'title-backfill@example.com', 'Title Backfill User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Title Backfill Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    const mainBranch = branches[0];
    if (mainBranch === undefined) {
      throw new Error('site created without a main branch');
    }
    branchId = mainBranch.id as string;
  });

  afterAll(async () => {
    try {
      await sql`DELETE FROM app.checkpoint_documents WHERE checkpoint_id IN (
        SELECT id FROM app.checkpoints WHERE branch_id = ${branchId}
      )`;
      await sql`DELETE FROM app.checkpoints WHERE branch_id = ${branchId}`;
      await sql`DELETE FROM app.document_versions WHERE document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${siteId}
      )`;
      await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
      await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    } finally {
      await sql.end();
      setDatabaseInstance(null);
    }
  });

  async function create(path: string, snapshot: Record<string, unknown>): Promise<string> {
    const { document } = await createDocumentOnBranch({
      siteId,
      branchId,
      path,
      snapshot,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    return document.id;
  }

  async function latestSnapshot(documentId: string): Promise<Record<string, unknown>> {
    const version = await getLatestDocumentVersion(documentId, branchId);
    return version?.snapshot ?? {};
  }

  it('reports what it would convert without writing, on a dry run', async () => {
    const id = await create('pages/dry-run', { title: 'Dry Run Page', content: [] });

    const result = await backfillPageTitles({ siteId, dryRun: true });

    expect(result.converted.map((e) => e.documentId)).toContain(id);
    // The version count is unchanged and the snapshot still carries the legacy key.
    const snapshot = await latestSnapshot(id);
    expect(snapshot).toHaveProperty('title', 'Dry Run Page');
  });

  it('moves a legacy title into root.props.title when executed', async () => {
    const id = await create('pages/legacy', { title: 'Legacy Page', content: [] });

    await backfillPageTitles({ siteId, dryRun: false });

    const snapshot = await latestSnapshot(id);
    expect(snapshot.root).toEqual({ props: { title: 'Legacy Page' } });
    expect(snapshot).not.toHaveProperty('title');
  });

  it('converts an edited page without rewriting its history', async () => {
    const id = await create('pages/edited', { title: 'First', content: [] });
    for (const title of ['Second', 'Third']) {
      await createDocumentVersion({
        documentId: id,
        branchId,
        snapshot: { title, content: [] },
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
    }

    await backfillPageTitles({ siteId, dryRun: false });

    const snapshot = await latestSnapshot(id);
    expect(snapshot.root).toEqual({ props: { title: 'Third' } });
    expect(snapshot).not.toHaveProperty('title');

    // Earlier versions keep the legacy shape. Rewriting them is not possible
    // anyway — most store a forward patch rather than a snapshot — so the
    // backfill must only ever append.
    const earlier = await sql`
      SELECT snapshot FROM app.document_versions
      WHERE document_id = ${id} AND branch_id = ${branchId} AND version_number = 1
    `;
    expect(earlier[0]?.snapshot).toMatchObject({ title: 'First' });
  });

  it('leaves an already-canonical document untouched', async () => {
    const id = await create('pages/canonical', {
      content: [],
      root: { props: { title: 'Canonical' } },
    });
    const before = await getLatestDocumentVersion(id, branchId);

    const result = await backfillPageTitles({ siteId, dryRun: false });

    const after = await getLatestDocumentVersion(id, branchId);
    expect(after?.versionNumber).toBe(before?.versionNumber);
    // The candidate query excludes it, so it is never reported either way.
    expect(result.converted.map((e) => e.documentId)).not.toContain(id);
  });

  it('is idempotent — a second run converts nothing', async () => {
    await create('pages/idempotent', { title: 'Once', content: [] });

    await backfillPageTitles({ siteId, dryRun: false });
    const second = await backfillPageTitles({ siteId, dryRun: false });

    expect(second.converted).toEqual([]);
  });
});
