/**
 * Template Migration E2E Integration Test
 *
 * Exercises the full template migration CUJ through the API:
 * 1. Create a template (metadata seed with empty content)
 * 2. Save the template layout as a content-shaped document version
 * 3. Create a page referencing that template
 * 4. Save a new layout version with structural puckActions
 * 5. Check migration status → stale docs detected
 * 6. Preview migration → shows affected doc and proposed changes
 * 7. Run migration → documents updated
 * 8. Verify page picks up new template version and inserted defaults
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

const SITE_KEY = 'test-migration-e2e-site';

let sql: ReturnType<typeof postgres>;
let testSiteId: string;
let mainBranchId: string;
let adminUserId: string;

/**
 * Build a content-shaped template snapshot as the canvas save path writes it.
 */
function templateLayout(
  content: { type: string; props: Record<string, unknown> }[],
  pinMap: Record<string, boolean>,
): Record<string, unknown> {
  return {
    content,
    root: {
      props: {
        _template: {
          label: 'Blog Post',
          description: 'Standard blog post layout',
          deprecated: false,
        },
        _pinMap: pinMap,
      },
    },
    zones: {},
  };
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

  // Clean up any stale data from prior runs
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM app.sites WHERE pantheon_site_id = ${SITE_KEY}
  `;
  if (existing.length > 0) {
    const siteId = existing[0].id;
    await sql`DELETE FROM app.migration_jobs WHERE site_id = ${siteId}`;
    await sql`DELETE FROM app.checkpoint_documents WHERE checkpoint_id IN (
      SELECT id FROM app.checkpoints WHERE branch_id IN (
        SELECT id FROM app.branches WHERE site_id = ${siteId}
      )
    )`;
    await sql`DELETE FROM app.checkpoints WHERE branch_id IN (
      SELECT id FROM app.branches WHERE site_id = ${siteId}
    )`;
    await sql`DELETE FROM app.document_relations WHERE source_document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${siteId}
    ) OR target_document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${siteId}
    )`;
    await sql`DELETE FROM app.document_versions WHERE document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${siteId}
    )`;
    await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
    await sql`DELETE FROM app.user_site_roles WHERE site_id = ${siteId}`;
    await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
    await sql`DELETE FROM app.users WHERE email = 'migration-e2e-admin@example.com'`;
    await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
  }

  const site = await sql<{ id: string }[]>`
    INSERT INTO app.sites (pantheon_site_id, name)
    VALUES (${SITE_KEY}, 'Migration E2E Test Site')
    RETURNING id
  `;
  testSiteId = site[0].id;

  const branch = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
    VALUES (${testSiteId}, 'main', true, '00000000-0000-0000-0000-000000000000', 'system')
    RETURNING id
  `;
  mainBranchId = branch[0].id;

  const user = await sql<{ id: string }[]>`
    INSERT INTO app.users (email, name)
    VALUES ('migration-e2e-admin@example.com', 'Migration E2E Admin')
    RETURNING id
  `;
  adminUserId = user[0].id;

  await sql`
    INSERT INTO app.user_site_roles (user_id, site_id, role, source)
    VALUES (${adminUserId}, ${testSiteId}, 'admin', 'local')
  `;
});

afterAll(async () => {
  try {
    await sql`DELETE FROM app.migration_jobs WHERE site_id = ${testSiteId}`;
    await sql`DELETE FROM app.checkpoint_documents WHERE checkpoint_id IN (
      SELECT id FROM app.checkpoints WHERE branch_id IN (
        SELECT id FROM app.branches WHERE site_id = ${testSiteId}
      )
    )`;
    await sql`DELETE FROM app.checkpoints WHERE branch_id IN (
      SELECT id FROM app.branches WHERE site_id = ${testSiteId}
    )`;
    await sql`DELETE FROM app.document_relations WHERE source_document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${testSiteId}
    ) OR target_document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${testSiteId}
    )`;
    await sql`DELETE FROM app.document_versions WHERE document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${testSiteId}
    )`;
    await sql`DELETE FROM app.documents WHERE site_id = ${testSiteId}`;
    await sql`DELETE FROM app.user_site_roles WHERE site_id = ${testSiteId}`;
    await sql`DELETE FROM app.branches WHERE site_id = ${testSiteId}`;
    await sql`DELETE FROM app.users WHERE id = ${adminUserId}`;
    await sql`DELETE FROM app.sites WHERE id = ${testSiteId}`;
  } finally {
    setDatabaseInstance(null);
    await sql.end();
  }
});

describe('Template Migration E2E', () => {
  let templateId: string;
  let pageDocId: string;

  const adminPrincipal = {
    id: 'migration-e2e-admin',
    type: 'user' as const,
    get dbUserId(): string { return adminUserId; },
    systemRole: null,
    scope: 'full' as const,
  };

  it('Step 1: Create a template (snapshot seeded with empty content)', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'blog-post',
          label: 'Blog Post',
          description: 'Standard blog post layout',
        }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: adminPrincipal,
    });

    expect(response.status).toBe(201);
    const body: { id: string; content: unknown[] } = await response.json();
    templateId = body.id;
    expect(templateId).toBeDefined();
    expect(body.content).toEqual([]);
  });

  it('Step 2: Save the template layout with HeroBlock and BodyBlock', async () => {
    const { createDocumentVersion } = await import('../../src/services');

    const version = await createDocumentVersion({
      documentId: templateId,
      branchId: mainBranchId,
      snapshot: templateLayout(
        [
          { type: 'HeroBlock', props: { id: 'hero-1', title: 'Hero' } },
          { type: 'BodyBlock', props: { id: 'body-1', text: '' } },
        ],
        { 'hero-1': true },
      ),
      source: 'edit',
      createdById: adminUserId,
      createdByType: 'user',
      puckActions: [
        { type: 'insert', componentType: 'HeroBlock', destinationIndex: 0 },
        { type: 'insert', componentType: 'BodyBlock', destinationIndex: 1 },
      ],
    });

    expect(version.versionNumber).toBe(2);
    expect(version.actionType).toBe('structural');
  });

  it('Step 3: Create a page document referencing that template', async () => {
    const { createDocumentOnBranch } = await import('../../src/services');

    const result = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: 'blog/my-first-post',
      snapshot: {
        content: [
          { type: 'HeroBlock', props: { id: 'hero-1', title: 'My First Post' } },
          { type: 'BodyBlock', props: { id: 'body-1', text: 'Hello world' } },
        ],
      },
      templateId,
      templateVersion: 2,
      createdById: adminUserId,
      createdByType: 'user',
    });

    pageDocId = result.document.id;
    expect(pageDocId).toBeDefined();

    // Verify the document references the template
    const rel = await sql<{ target_document_id: string; synced_version: number }[]>`
      SELECT target_document_id, synced_version FROM app.document_relations
      WHERE source_document_id = ${pageDocId} AND relation_type = 'template'
    `;
    expect(rel[0].target_document_id).toBe(templateId);
    expect(rel[0].synced_version).toBe(2);
  });

  it('Step 4: Save a new template layout, adding CTABlock with puckActions', async () => {
    const { createDocumentVersion } = await import('../../src/services');

    const version = await createDocumentVersion({
      documentId: templateId,
      branchId: mainBranchId,
      snapshot: templateLayout(
        [
          { type: 'HeroBlock', props: { id: 'hero-1', title: 'Hero' } },
          { type: 'BodyBlock', props: { id: 'body-1', text: '' } },
          { type: 'CTABlock', props: { id: 'cta-1', label: 'Click me' } },
        ],
        { 'hero-1': true },
      ),
      source: 'edit',
      createdById: adminUserId,
      createdByType: 'user',
      puckActions: [
        { type: 'insert', componentType: 'CTABlock', destinationIndex: 2 },
      ],
    });

    expect(version.versionNumber).toBe(3);
    expect(version.actionType).toBe('structural');
  });

  it('Step 5: Check migration status (page is stale)', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateId}/migration-status`,
      { method: 'GET' },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId,
      action: 'migration-status',
      principal: adminPrincipal,
    });

    expect(response.status).toBe(200);
    const status = await response.json();

    expect(status.templateId).toBe(templateId);
    expect(status.currentVersion).toBe(3);
    expect(status.staleDocumentCount).toBe(1);
    expect(status.oldestDocumentVersion).toBe(2);
    expect(status.migrationAvailable).toBe(true);
  });

  it('Step 6: Preview migration (shows affected doc, no conflicts)', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateId}/migrate/preview?detail=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromVersion: 2, toVersion: 3 }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId,
      action: 'migrate-preview',
      principal: adminPrincipal,
    });

    expect(response.status).toBe(200);
    const preview = await response.json();

    expect(preview.templateId).toBe(templateId);
    expect(preview.fromVersion).toBe(2);
    expect(preview.toVersion).toBe(3);
    expect(preview.affectedDocuments).toBe(1);
    expect(preview.cleanDocuments).toBe(1);
    expect(preview.estimatedConflicts).toBe(0);

    // Detail mode should include per-document info
    expect(preview.documents).toBeDefined();
    expect(preview.documents?.length).toBe(1);
    expect(preview.documents?.[0].documentId).toBe(pageDocId);
    expect(preview.documents?.[0].path).toBe('blog/my-first-post');
    expect(preview.documents?.[0].hasConflict).toBe(false);
  });

  it('Step 7: Run migration', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateId}/migrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromVersion: 2, toVersion: 3 }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId,
      action: 'migrate',
      principal: adminPrincipal,
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.job.totalDocuments).toBe(1);
    expect(result.processedDocuments).toBe(1);
    expect(result.conflictedDocuments).toBe(0);
  });

  it('Step 8: Verify page picked up the new version with inserted defaults', async () => {
    // Check the template edge's synced_version was advanced
    const rel = await sql<{ synced_version: number }[]>`
      SELECT synced_version FROM app.document_relations
      WHERE source_document_id = ${pageDocId} AND relation_type = 'template'
    `;
    expect(rel[0].synced_version).toBe(3);

    // The inserted component carries the template's default props,
    // and the page's own customizations are untouched
    const { getLatestDocumentVersion } = await import('../../src/services');
    const latest = await getLatestDocumentVersion(pageDocId, mainBranchId);
    expect(latest).not.toBeNull();
    expect(latest?.source).toBe('migration');

    const content = latest?.snapshot?.content as { type: string; props: Record<string, unknown> }[];
    expect(content).toHaveLength(3);
    expect(content[0].type).toBe('HeroBlock');
    expect(content[0].props.title).toBe('My First Post');
    expect(content[1].type).toBe('BodyBlock');
    expect(content[2].type).toBe('CTABlock');
    expect(content[2].props.id).toBe('cta-1');
    expect(content[2].props.label).toBe('Click me');

    // Check migration status now shows no stale documents
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateId}/migration-status`,
      { method: 'GET' },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId,
      action: 'migration-status',
      principal: adminPrincipal,
    });

    expect(response.status).toBe(200);
    const status = await response.json();
    expect(status.staleDocumentCount).toBe(0);
    expect(status.migrationAvailable).toBe(false);
  });
});
