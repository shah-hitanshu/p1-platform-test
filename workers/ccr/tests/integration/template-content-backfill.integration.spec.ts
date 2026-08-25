/**
 * PROPOSAL-014 §7: manifest-to-content backfill, run against Postgres.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { backfillTemplateContentShape } from '../../src/services/template-content-backfill';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

let sql: ReturnType<typeof postgres>;
let testSiteId: string;
let mainBranchId: string;
let adminUserId: string;

interface DocumentVersionRow {
  version_number: number;
  snapshot: Record<string, unknown> | null;
}

async function latestVersion(documentId: string, branchId: string): Promise<DocumentVersionRow> {
  const rows = await sql<DocumentVersionRow[]>`
    SELECT version_number, snapshot FROM app.document_versions
    WHERE document_id = ${documentId} AND branch_id = ${branchId}
    ORDER BY version_number DESC LIMIT 1
  `;
  return rows[0];
}

/** Remove all migration, checkpoint, document, and branch rows for a site. */
async function cleanupSiteArtifacts(siteId: string): Promise<void> {
  await sql`
    DELETE FROM app.migration_conflicts
    WHERE template_id IN (SELECT id FROM app.documents WHERE site_id = ${siteId})
  `;
  await sql`DELETE FROM app.migration_jobs WHERE site_id = ${siteId}`;
  await sql`
    DELETE FROM app.checkpoint_documents
    WHERE checkpoint_id IN (
      SELECT id FROM app.checkpoints
      WHERE branch_id IN (SELECT id FROM app.branches WHERE site_id = ${siteId})
    )
  `;
  await sql`UPDATE app.branches SET source_checkpoint_id = NULL WHERE site_id = ${siteId}`;
  await sql`
    DELETE FROM app.checkpoints
    WHERE branch_id IN (SELECT id FROM app.branches WHERE site_id = ${siteId})
  `;
  await sql`
    DELETE FROM app.document_versions
    WHERE document_id IN (SELECT id FROM app.documents WHERE site_id = ${siteId})
  `;
  await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
  await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
}

beforeAll(async () => {
  sql = postgres(TEST_DATABASE_URL, { max: 1 });

  const connection = {
    async query(sqlQuery: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
      const result = await sql.unsafe(sqlQuery, params as unknown as postgres.ParameterOrJSON<never>[]);
      const rows = [...result];
      const resultWithCount = result as unknown as { count?: number };
      const rowCount = resultWithCount.count ?? rows.length;
      return { rows, rowCount };
    },
  };
  setDatabaseInstance(connection);

  const staleData = await sql<{ id: string }[]>`
    SELECT id FROM app.sites WHERE pantheon_site_id = 'test-template-backfill-site'
  `;
  if (staleData.length > 0) {
    const staleSiteId = staleData[0].id;
    await cleanupSiteArtifacts(staleSiteId);
    await sql`DELETE FROM app.sites WHERE id = ${staleSiteId}`;
  }
  await sql`DELETE FROM app.users WHERE email = 'template-backfill@example.com'`;

  const site = await sql<{ id: string }[]>`
    INSERT INTO app.sites (pantheon_site_id, name)
    VALUES ('test-template-backfill-site', 'Test Template Backfill Site')
    RETURNING id
  `;
  testSiteId = site[0].id;

  const mainBranch = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
    VALUES (${testSiteId}, 'main', true, '00000000-0000-0000-0000-000000000000', 'system')
    RETURNING id
  `;
  mainBranchId = mainBranch[0].id;

  const adminUser = await sql<{ id: string }[]>`
    INSERT INTO app.users (email, name)
    VALUES ('template-backfill@example.com', 'Admin User')
    RETURNING id
  `;
  adminUserId = adminUser[0].id;
});

afterAll(async () => {
  try {
    if (testSiteId) {
      await cleanupSiteArtifacts(testSiteId);
      await sql`DELETE FROM app.sites WHERE id = ${testSiteId}`;
    }
    await sql`DELETE FROM app.users WHERE email = 'template-backfill@example.com'`;
  } catch {
    // Ignore cleanup errors
  }

  setDatabaseInstance(null);
  await sql.end();
});

describe('Template Content Shape Backfill', () => {
  it('converts a manifest-shaped latest version to content shape and leaves prior versions untouched', async () => {
    const templateDoc = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path)
      VALUES (${testSiteId}, '_registry/templates/blog-post')
      RETURNING id
    `;
    const templateId = templateDoc[0].id;

    const manifestSnapshot = {
      name: 'blog-post',
      label: 'Blog Post',
      description: 'Standard blog post layout',
      components: [
        { type: 'HeroBlock', pinned: true, defaultProps: { title: 'Hero' } },
        { type: 'BodyBlock', pinned: false, defaultProps: { text: '' } },
      ],
    };

    await sql`
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type
      )
      VALUES (
        ${templateId}, ${mainBranchId}, 1,
        ${sql.json(manifestSnapshot)},
        'edit', ${adminUserId}, 'user'
      )
    `;

    const result = await backfillTemplateContentShape();

    expect(result.converted).toContainEqual(
      { documentId: templateId, branchId: mainBranchId, path: '_registry/templates/blog-post' },
    );
    expect(result.skipped.some((e) => e.documentId === templateId)).toBe(false);

    const latest = await latestVersion(templateId, mainBranchId);
    expect(latest.version_number).toBe(2);

    const snapshot = latest.snapshot as {
      content: { type: string; props: Record<string, unknown> }[];
      root: { props: { _template: Record<string, unknown>; _pinMap: Record<string, boolean> } };
      zones: Record<string, unknown>;
    };
    expect(snapshot.content.map((c) => c.type)).toEqual(['HeroBlock', 'BodyBlock']);
    expect(snapshot.content[0].props).toMatchObject({ title: 'Hero' });
    expect(snapshot.content[1].props).toMatchObject({ text: '' });
    expect(snapshot.root.props._template).toEqual({
      label: 'Blog Post',
      description: 'Standard blog post layout',
      deprecated: false,
    });
    const heroId = snapshot.content[0].props.id as string;
    expect(snapshot.root.props._pinMap).toEqual({ [heroId]: true });
    expect(snapshot.zones).toEqual({});

    const priorVersion = await sql<{ snapshot: Record<string, unknown> | null }[]>`
      SELECT snapshot FROM app.document_versions
      WHERE document_id = ${templateId} AND branch_id = ${mainBranchId} AND version_number = 1
    `;
    expect(priorVersion[0].snapshot).toEqual(manifestSnapshot);
  });

  it('is a no-op on a second run', async () => {
    const templateDoc = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path)
      VALUES (${testSiteId}, '_registry/templates/landing-page')
      RETURNING id
    `;
    const templateId = templateDoc[0].id;

    await sql`
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type
      )
      VALUES (
        ${templateId}, ${mainBranchId}, 1,
        ${sql.json({ label: 'Landing Page', components: [{ type: 'HeroBlock', pinned: false, defaultProps: {} }] })},
        'edit', ${adminUserId}, 'user'
      )
    `;

    const first = await backfillTemplateContentShape();
    const converted = first.converted.find((e) => e.documentId === templateId);
    expect(converted).toBeDefined();

    const afterFirstRun = await latestVersion(templateId, mainBranchId);
    expect(afterFirstRun.version_number).toBe(2);

    const second = await backfillTemplateContentShape();
    expect(second.converted.some((e) => e.documentId === templateId)).toBe(false);
    expect(second.skipped.some((e) => e.documentId === templateId)).toBe(true);

    const afterSecondRun = await latestVersion(templateId, mainBranchId);
    expect(afterSecondRun.version_number).toBe(2);
    expect(afterSecondRun.snapshot).toEqual(afterFirstRun.snapshot);
  });

  it('skips a template whose latest snapshot is already content-shaped', async () => {
    const templateDoc = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path)
      VALUES (${testSiteId}, '_registry/templates/already-content-shaped')
      RETURNING id
    `;
    const templateId = templateDoc[0].id;

    const contentSnapshot = {
      content: [{ type: 'HeroBlock', props: { id: 'HeroBlock-existing' } }],
      root: { props: { _template: { label: 'Already Content Shaped', deprecated: false }, _pinMap: {} } },
      zones: {},
    };

    await sql`
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type
      )
      VALUES (
        ${templateId}, ${mainBranchId}, 1,
        ${sql.json(contentSnapshot)},
        'edit', ${adminUserId}, 'user'
      )
    `;

    const result = await backfillTemplateContentShape();

    expect(result.converted.some((e) => e.documentId === templateId)).toBe(false);
    expect(result.skipped.some((e) => e.documentId === templateId)).toBe(true);

    const latest = await latestVersion(templateId, mainBranchId);
    expect(latest.version_number).toBe(1);
    expect(latest.snapshot).toEqual(contentSnapshot);
  });

  it('dry run reports candidates without writing a new version', async () => {
    const templateDoc = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path)
      VALUES (${testSiteId}, '_registry/templates/dry-run-check')
      RETURNING id
    `;
    const templateId = templateDoc[0].id;

    await sql`
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type
      )
      VALUES (
        ${templateId}, ${mainBranchId}, 1,
        ${sql.json({ label: 'Dry Run Check', components: [] })},
        'edit', ${adminUserId}, 'user'
      )
    `;

    const result = await backfillTemplateContentShape({ dryRun: true });

    expect(result.converted.some((e) => e.documentId === templateId)).toBe(true);

    const latest = await latestVersion(templateId, mainBranchId);
    expect(latest.version_number).toBe(1);
  });

  it('leaves bound pages unchanged when a migration spans the backfill boundary', async () => {
    const { createDocumentOnBranch } = await import('../../src/services');
    const { triggerMigration, processMigration, listMigrationConflicts } =
      await import('../../src/services/migration-service');

    const templateDoc = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path)
      VALUES (${testSiteId}, '_registry/templates/boundary-template')
      RETURNING id
    `;
    const templateId = templateDoc[0].id;

    const manifestSnapshot = {
      name: 'boundary-template',
      label: 'Boundary Template',
      components: [
        { type: 'HeroBlock', pinned: true, defaultProps: { title: 'Template Hero' } },
        { type: 'BodyBlock', pinned: false, defaultProps: { text: 'Template Body' } },
      ],
    };

    await sql`
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type
      )
      VALUES (
        ${templateId}, ${mainBranchId}, 1,
        ${sql.json(manifestSnapshot)},
        'edit', ${adminUserId}, 'user'
      )
    `;

    const pageContent = [{ type: 'HeroBlock', props: { id: 'page-hero', title: 'Page Hero' } }];
    const page = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: 'pages/boundary-page',
      snapshot: { content: pageContent, root: { props: {} }, zones: {} },
      templateId,
      templateVersion: 1,
      createdById: adminUserId,
      createdByType: 'user',
    });
    const pageId = page.document.id;

    await backfillTemplateContentShape();
    const converted = await latestVersion(templateId, mainBranchId);
    expect(converted.version_number).toBe(2);

    const job = await triggerMigration(
      testSiteId, mainBranchId, templateId, 1, 2,
      { id: adminUserId, type: 'user' },
    );
    await processMigration(job.id);

    const pageLatest = await latestVersion(pageId, mainBranchId);
    expect(pageLatest.snapshot?.content).toEqual(pageContent);

    const conflicts = await listMigrationConflicts(job.id);
    expect(conflicts).toHaveLength(0);
  });
});
