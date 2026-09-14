/**
 * Path override promotion - Integration Tests
 *
 * Both halves of the promotion pair an id array with a path array through
 * `unnest`, and an array parameter only survives that if it reaches Postgres as
 * one array rather than as its elements. The unit tier cannot see the
 * difference: its database stub never parses the statement it is handed. These
 * run the statements against Postgres so the binding itself is under test.
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
import {
  createDocumentOnBranch,
  upsertBranchDocumentPaths,
} from '../../src/services/branch-document-service';
import { applyPathOverridePromotion } from '../../src/services/merge-execution-service';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'path-override-promotion-test';

function makeSnapshot(title: string): Record<string, unknown> {
  return {
    root: { props: { title } },
    content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title, level: 'h1' } }],
    zones: {},
  };
}

describe('path override promotion', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let mainBranchId: string;

  async function createPage(path: string): Promise<string> {
    const created = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path,
      snapshot: makeSnapshot(path),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    return created.document.id;
  }

  async function pathOf(documentId: string): Promise<string> {
    const rows = await sql`SELECT path FROM app.documents WHERE id = ${documentId}`;
    return rows[0].path as string;
  }

  async function overrideOn(branchId: string, documentId: string): Promise<string | undefined> {
    const rows = await sql`
      SELECT path FROM app.branch_document_paths
      WHERE branch_id = ${branchId} AND document_id = ${documentId}`;
    return rows[0]?.path as string | undefined;
  }

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'path-override-promotion@example.com', 'Path Override User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Path Override Promotion Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    mainBranchId = branches[0].id as string;
  });

  afterAll(async () => {
    if (siteId) {
      await deleteSiteCascade(sql, siteId);
    }
    setDatabaseInstance(null);
    await sql.end();
  });

  it('writes every promoted path onto the document when the target is main', async () => {
    const first = await createPage('pages/promote-many-first');
    const second = await createPage('pages/promote-many-second');

    await applyPathOverridePromotion({
      targetIsMain: true,
      targetBranchId: mainBranchId,
      moves: [
        { documentId: first, newPath: 'pages/promoted-first' },
        { documentId: second, newPath: 'pages/promoted-second' },
      ],
    });

    expect(await pathOf(first)).toBe('pages/promoted-first');
    expect(await pathOf(second)).toBe('pages/promoted-second');
  });

  it('writes a single promoted path onto the document when the target is main', async () => {
    const only = await createPage('pages/promote-one');

    await applyPathOverridePromotion({
      targetIsMain: true,
      targetBranchId: mainBranchId,
      moves: [{ documentId: only, newPath: 'pages/promoted-one' }],
    });

    expect(await pathOf(only)).toBe('pages/promoted-one');
  });

  it('records every promoted path as a branch override when the target is not main', async () => {
    const first = await createPage('pages/override-many-first');
    const second = await createPage('pages/override-many-second');

    await upsertBranchDocumentPaths(mainBranchId, [
      { documentId: first, newPath: 'pages/overridden-first' },
      { documentId: second, newPath: 'pages/overridden-second' },
    ]);

    expect(await overrideOn(mainBranchId, first)).toBe('pages/overridden-first');
    expect(await overrideOn(mainBranchId, second)).toBe('pages/overridden-second');
  });
});
