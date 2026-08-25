/**
 * Template Migration Copy-on-Write — Integration Tests
 *
 * A migration run on a non-main branch resolves the template it compares against
 * from main when the branch has not edited it, and migrates pages inherited from
 * main by writing new branch-local versions while leaving main untouched.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';
import { createSite } from '../../src/services/site-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import {
  createDocumentVersion,
  getLatestDocumentVersion,
} from '../../src/services/document-version-service';
import { publishDocument } from '../../src/services/checkpoint-publish';
import {
  triggerMigration,
  processMigration,
  previewMigration,
  getMigrationStatus,
} from '../../src/services/migration-service';

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';
const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'migration-cow-test';

const HEADING = { type: 'HeadingBlock', props: { id: 'heading-1', title: 'Hello', level: 'h1' } };
const IMAGE = { type: 'ImageBlock', props: { id: 'image-1', src: '/photo.jpg', alt: 'A photo' } };
const BUTTON = { type: 'ButtonBlock', props: { id: 'button-1', label: 'Click me', href: '/go', variant: 'primary' } };

function makeSnapshot(components: unknown[]): Record<string, unknown> {
  return { content: components, root: { props: { title: 'Test' } }, zones: {} };
}

function createRealDatabaseConnection(connectionString: string): {
  connection: DatabaseConnection;
  sql: postgres.Sql;
} {
  const sql = postgres(connectionString, { transform: { undefined: null }, max: 1 });
  const connection: DatabaseConnection = {
    async query<T = Record<string, unknown>>(
      sqlQuery: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await sql.unsafe<T[]>(
        sqlQuery,
        params as unknown as postgres.ParameterOrJSON<never>[],
      );
      const rows = [...result] as T[];
      const resultWithCount = result as unknown as { count?: number };
      return { rows, rowCount: resultWithCount.count ?? rows.length };
    },
  };
  return { connection, sql };
}

describe('Template Migration — Copy-on-Write on a non-main branch', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let mainBranchId: string;
  let featureBranchId: string;
  let templateId: string;
  let pageId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection(CONNECTION_STRING);
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'migration-cow@example.com', 'Migration COW User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Migration COW Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const mainRows = await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    mainBranchId = mainRows[0].id as string;

    await sql`
      INSERT INTO app.user_site_roles (user_id, site_id, role)
      VALUES (${TEST_USER_ID}, ${siteId}, 'admin')
      ON CONFLICT DO NOTHING
    `;

    // On main: template v1, a page derived from it (published so branches inherit
    // it), then template v2 that inserts a ButtonBlock.
    const template = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: '_registry/templates/cow-blog',
      snapshot: makeSnapshot([HEADING, IMAGE]),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    templateId = template.document.id;

    const page = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: 'cow-post',
      snapshot: makeSnapshot([HEADING, IMAGE]),
      templateId,
      templateVersion: 1,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    pageId = page.document.id;

    await publishDocument({
      siteId,
      branchId: mainBranchId,
      documentId: pageId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    await createDocumentVersion({
      documentId: templateId,
      branchId: mainBranchId,
      snapshot: makeSnapshot([HEADING, IMAGE, BUTTON]),
      source: 'edit',
      createdById: TEST_USER_ID,
      createdByType: 'user',
      puckActions: [{ type: 'insert', componentType: 'ButtonBlock', destinationIndex: 2 }],
    });

    // Feature branch off main; copy-on-write copies no document versions.
    const featureRows = await sql<{ id: string }[]>`
      INSERT INTO app.branches (site_id, name, is_main, source_branch_id, created_by_id, created_by_type)
      VALUES (${siteId}, 'feature', false, ${mainBranchId}, ${TEST_USER_ID}, 'user')
      RETURNING id
    `;
    featureBranchId = featureRows[0].id;
  });

  afterAll(async () => {
    try {
      await sql`DELETE FROM app.migration_conflicts
        WHERE template_id IN (SELECT id FROM app.documents WHERE site_id = ${siteId})`;
      await sql`DELETE FROM app.migration_jobs WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.checkpoint_documents WHERE checkpoint_id IN (
        SELECT id FROM app.checkpoints WHERE branch_id IN (
          SELECT id FROM app.branches WHERE site_id = ${siteId}))`;
      await sql`UPDATE app.branches SET source_checkpoint_id = NULL WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.checkpoints
        WHERE branch_id IN (SELECT id FROM app.branches WHERE site_id = ${siteId})`;
      await sql`DELETE FROM app.document_relations WHERE source_document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${siteId}
      ) OR target_document_id IN (SELECT id FROM app.documents WHERE site_id = ${siteId})`;
      await sql`DELETE FROM app.document_versions
        WHERE document_id IN (SELECT id FROM app.documents WHERE site_id = ${siteId})`;
      await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.user_site_roles WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
      await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    } catch {
      // Ignore cleanup errors
    }
    await sql.end();
    setDatabaseInstance(null);
  });

  it('reports the inherited template current version in migration status', async () => {
    const status = await getMigrationStatus(templateId, featureBranchId, mainBranchId);
    expect(status.currentVersion).toBe(2);
    expect(status.staleDocumentCount).toBeGreaterThanOrEqual(1);
    expect(status.migrationAvailable).toBe(true);
  });

  it('previews a migration against the inherited template, counting the inherited page', async () => {
    const preview = await previewMigration(siteId, featureBranchId, templateId, 1, 2, true, mainBranchId);
    expect(preview.affectedDocuments).toBe(1);
    expect(preview.documents?.[0].path).toBe('cow-post');
  });

  it('migrates the inherited page into a branch-local version, leaving main untouched', async () => {
    const job = await triggerMigration(
      siteId, featureBranchId, templateId, 1, 2,
      { id: TEST_USER_ID, type: 'user' },
    );
    const result = await processMigration(job.id, undefined, mainBranchId);
    expect(result.processedDocuments).toBe(1);
    expect(result.conflictedDocuments).toBe(0);

    // Feature branch now has a local migrated version with the ButtonBlock.
    const featureVersion = await getLatestDocumentVersion(pageId, featureBranchId);
    if (featureVersion?.snapshot === undefined) {
      throw new Error('expected a migrated version on the feature branch');
    }
    expect(featureVersion.source).toBe('migration');
    const featureContent = featureVersion.snapshot.content as { type: string }[];
    expect(featureContent.map((c) => c.type)).toEqual(['HeadingBlock', 'ImageBlock', 'ButtonBlock']);

    // Main still has only the original two components.
    const mainVersion = await getLatestDocumentVersion(pageId, mainBranchId);
    if (mainVersion?.snapshot === undefined) {
      throw new Error('expected the original version on main');
    }
    const mainContent = mainVersion.snapshot.content as { type: string }[];
    expect(mainContent.map((c) => c.type)).toEqual(['HeadingBlock', 'ImageBlock']);
  });
});
