/**
 * Branch-scoped template sync — Integration Tests
 *
 * A template edge (app.document_relations) carries one shared synced_version.
 * A migration on a non-main branch records its progress in a per-branch override
 * (app.document_relation_branch_sync) instead of the shared base, so migrating a page on
 * a feature branch never marks that page migrated on main or on sibling branches.
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
  getMigrationStatus,
  rollbackMigration,
} from '../../src/services/migration-service';

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';
const TEST_USER_ID = '66666666-6666-6666-6666-666666666666';
const SITE_PREFIX = 'branch-sync-test';

const HEADING = { type: 'HeadingBlock', props: { id: 'heading-1', title: 'Hello', level: 'h1' } };
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

describe('Template sync — branch-scoped synced_version', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let mainBranchId: string;
  let featureBranchId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection(CONNECTION_STRING);
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'branch-sync@example.com', 'Branch Sync User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Branch Sync Site',
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

    const featureRows = await sql<{ id: string }[]>`
      INSERT INTO app.branches (site_id, name, is_main, source_branch_id, created_by_id, created_by_type)
      VALUES (${siteId}, 'feature', false, ${mainBranchId}, ${TEST_USER_ID}, 'user')
      RETURNING id
    `;
    featureBranchId = featureRows[0].id;
  });

  afterAll(async () => {
    try {
      await sql`DELETE FROM app.document_relation_branch_sync WHERE source_document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${siteId})`;
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
        SELECT id FROM app.documents WHERE site_id = ${siteId})`;
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

  /**
   * A template (v1 heading, v2 heading+button) on main and a page derived from
   * it at v1, published so a feature branch inherits it. Each scenario uses its
   * own template so a template-scoped migration touches only its own page.
   */
  async function seedTemplateAndInheritedPage(
    suffix: string,
  ): Promise<{ templateId: string; pageId: string }> {
    const template = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: `_registry/templates/sync-${suffix}`,
      snapshot: makeSnapshot([HEADING]),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    const templateId = template.document.id;

    const page = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: `sync-page-${suffix}`,
      snapshot: makeSnapshot([HEADING]),
      templateId,
      templateVersion: 1,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    const pageId = page.document.id;

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
      snapshot: makeSnapshot([HEADING, BUTTON]),
      source: 'edit',
      createdById: TEST_USER_ID,
      createdByType: 'user',
      puckActions: [{ type: 'insert', componentType: 'ButtonBlock', destinationIndex: 1 }],
    });

    return { templateId, pageId };
  }

  async function baseSync(pageId: string): Promise<number | null> {
    const rows = await sql<{ synced_version: number | null }[]>`
      SELECT synced_version FROM app.document_relations
      WHERE source_document_id = ${pageId} AND relation_type = 'template'
    `;
    return rows[0]?.synced_version ?? null;
  }

  async function overrideSync(pageId: string, branchId: string): Promise<number | null> {
    const rows = await sql<{ synced_version: number }[]>`
      SELECT synced_version FROM app.document_relation_branch_sync
      WHERE source_document_id = ${pageId} AND relation_type = 'template' AND branch_id = ${branchId}
    `;
    return rows[0]?.synced_version ?? null;
  }

  it('records a branch migration in a per-branch override, leaving the shared base and main untouched', async () => {
    const { templateId, pageId } = await seedTemplateAndInheritedPage('isolate');

    const job = await triggerMigration(
      siteId, featureBranchId, templateId, 1, 2,
      { id: TEST_USER_ID, type: 'user' },
      mainBranchId,
    );
    const result = await processMigration(job.id, undefined, mainBranchId);
    expect(result.processedDocuments).toBe(1);

    // The feature branch advanced its own override; the shared edge base still
    // reflects main at v1.
    expect(await baseSync(pageId)).toBe(1);
    expect(await overrideSync(pageId, featureBranchId)).toBe(2);

    // The feature branch sees the page as synced.
    const featureStatus = await getMigrationStatus(templateId, featureBranchId, mainBranchId);
    expect(featureStatus.migrationAvailable).toBe(false);

    // Main still sees the page as stale and can migrate it independently.
    const mainStatus = await getMigrationStatus(templateId, mainBranchId);
    expect(mainStatus.migrationAvailable).toBe(true);
    expect(mainStatus.staleDocumentCount).toBeGreaterThanOrEqual(1);

    const mainJob = await triggerMigration(
      siteId, mainBranchId, templateId, 1, 2,
      { id: TEST_USER_ID, type: 'user' },
    );
    const mainResult = await processMigration(mainJob.id);
    expect(mainResult.processedDocuments).toBe(1);

    // Main advanced the shared base; the feature override is unchanged.
    expect(await baseSync(pageId)).toBe(2);
    expect(await overrideSync(pageId, featureBranchId)).toBe(2);
  });

  it('rolling back a branch migration clears the branch override and leaves the shared base untouched', async () => {
    const { templateId, pageId } = await seedTemplateAndInheritedPage('rollback');

    const job = await triggerMigration(
      siteId, featureBranchId, templateId, 1, 2,
      { id: TEST_USER_ID, type: 'user' },
      mainBranchId,
    );
    await processMigration(job.id, undefined, mainBranchId);
    expect(await overrideSync(pageId, featureBranchId)).toBe(2);
    expect(await baseSync(pageId)).toBe(1);

    await rollbackMigration(
      job.id,
      { id: TEST_USER_ID, type: 'user' },
      { siteId, branchId: featureBranchId, templateId },
      mainBranchId,
    );

    // The override is reset to the pre-migration version; the shared base never moved.
    expect(await overrideSync(pageId, featureBranchId)).toBe(1);
    expect(await baseSync(pageId)).toBe(1);

    // The migration version is gone; the branch is back to inheriting main.
    const featureVersion = await getLatestDocumentVersion(pageId, featureBranchId);
    expect(featureVersion?.source).not.toBe('migration');
  });
});
