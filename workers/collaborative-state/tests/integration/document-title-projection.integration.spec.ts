/**
 * Page title in dashboard listings - Integration Tests
 *
 * The listing projection is SQL, so only a real database proves it. Titles are
 * canonically at `root.props.title`; documents created before that carry the
 * title at the snapshot's top level and are not rewritten until the backfill
 * runs, so the projection has to read both.
 *
 * This is the bug template-created pages hit: the skeleton writes
 * `root.props.title`, and the listing used to read only the top level, so they
 * appeared untitled in the dashboard.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';

import { createSite } from '../../src/services/site-service';
import {
  createDocumentOnBranch,
  listDocumentsOnBranch,
} from '../../src/services/branch-document-service';

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';
const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'title-projection-test';

function createRealDatabaseConnection(connectionString: string): {
  connection: DatabaseConnection;
  sql: postgres.Sql;
} {
  const sql = postgres(connectionString, {
    transform: { undefined: null },
    max: 1,
  });

  const connection: DatabaseConnection = {
    async query<T>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const result = await sql.unsafe(
        text,
        params as unknown as postgres.ParameterOrJSON<never>[],
      );
      const rows = [...result] as T[];
      const resultWithCount = result as unknown as { count?: number };
      const rowCount = resultWithCount.count ?? rows.length;
      return { rows, rowCount };
    },
    async close(): Promise<void> {
      await sql.end();
    },
  };

  return { connection, sql };
}

describe('Page title listing projection - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let branchId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection(CONNECTION_STRING);
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'title-projection@example.com', 'Title Projection User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Title Projection Site',
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

  async function titleFor(documentId: string): Promise<string | undefined> {
    const documents = await listDocumentsOnBranch(branchId);
    return documents.find((d) => d.id === documentId)?.snapshotTitle;
  }

  it('surfaces a title stored at root.props.title', async () => {
    // The shape the skeleton produces for a template-created page, and the one
    // the editor autosaves. Previously invisible in listings.
    const id = await create('pages/from-template', {
      content: [],
      zones: {},
      root: { props: { title: 'Quarterly Report' } },
    });

    expect(await titleFor(id)).toBe('Quarterly Report');
  });

  it('still surfaces a legacy top-level title', async () => {
    const id = await create('pages/legacy', { title: 'Legacy Page', content: [] });

    expect(await titleFor(id)).toBe('Legacy Page');
  });

  it('prefers the canonical location when a snapshot carries both', async () => {
    const id = await create('pages/both', {
      title: 'Stale top level',
      root: { props: { title: 'Authored' } },
    });

    expect(await titleFor(id)).toBe('Authored');
  });

  it('reports no title when the snapshot has neither', async () => {
    const id = await create('pages/untitled', { content: [], zones: {} });

    expect(await titleFor(id)).toBeUndefined();
  });
});
