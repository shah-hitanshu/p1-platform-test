/**
 * Template Migration E2E Integration Test
 *
 * Exercises the full template migration CUJ through the API:
 * 1. Create a template
 * 2. Create a page referencing that template
 * 3. Update the template (with puckActions)
 * 4. Check migration status → stale docs detected
 * 5. Preview migration → shows affected doc and proposed changes
 * 6. Run migration → documents updated
 * 7. Verify page picks up new template version
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

  it('Step 1: Create a template with HeroBlock and BodyBlock', async () => {
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
          components: [
            { type: 'HeroBlock', required: true, pinned: true, defaultProps: { title: 'Hero' } },
            { type: 'BodyBlock', required: true, pinned: false, defaultProps: { text: '' } },
          ],
        }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: adminPrincipal,
    });

    expect(response.status).toBe(201);
    const body: { id: string } = await response.json();
    templateId = body.id;
    expect(templateId).toBeDefined();
  });

  it('Step 2: Create a page document referencing that template', async () => {
    const { createDocumentOnBranch } = await import('../../src/services');

    const result = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: 'blog/my-first-post',
      snapshot: {
        content: [
          { type: 'HeroBlock', props: { title: 'My First Post' } },
          { type: 'BodyBlock', props: { text: 'Hello world' } },
        ],
      },
      templateId,
      templateVersion: 1,
      createdById: adminUserId,
      createdByType: 'user',
    });

    pageDocId = result.document.id;
    expect(pageDocId).toBeDefined();

    // Verify the document references the template
    const doc = await sql<{ template_id: string; template_version: number }[]>`
      SELECT template_id, template_version FROM app.documents WHERE id = ${pageDocId}
    `;
    expect(doc[0].template_id).toBe(templateId);
    expect(doc[0].template_version).toBe(1);
  });

  it('Step 3: Update the template — add CTABlock with puckActions', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          components: [
            { type: 'HeroBlock', required: true, pinned: true, defaultProps: { title: 'Hero' } },
            { type: 'BodyBlock', required: true, pinned: false, defaultProps: { text: '' } },
            { type: 'CTABlock', required: false, pinned: false, defaultProps: { label: 'Click me' } },
          ],
          puckActions: [
            { type: 'insert', componentType: 'CTABlock', destinationIndex: 2, destinationZone: 'root' },
          ],
        }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId,
      principal: adminPrincipal,
    });

    expect(response.status).toBe(200);

    // Template should now be at version 2
    const versions = await sql<{ version_number: number }[]>`
      SELECT version_number FROM app.document_versions
      WHERE document_id = ${templateId} AND branch_id = ${mainBranchId}
      ORDER BY version_number DESC
    `;
    expect(versions.length).toBe(2);
    expect(versions[0].version_number).toBe(2);
  });

  it('Step 4: Check migration status — page is stale', async () => {
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
    expect(status.currentVersion).toBe(2);
    expect(status.staleDocumentCount).toBe(1);
    expect(status.oldestDocumentVersion).toBe(1);
    expect(status.migrationAvailable).toBe(true);
  });

  it('Step 5: Preview migration — shows affected doc, no conflicts', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateId}/migrate/preview?detail=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromVersion: 1, toVersion: 2 }),
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
    expect(preview.fromVersion).toBe(1);
    expect(preview.toVersion).toBe(2);
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

  it('Step 6: Run migration', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateId}/migrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromVersion: 1, toVersion: 2 }),
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

  it('Step 7: Verify page picked up the new template version', async () => {
    // Check template_version was updated on the document
    const doc = await sql<{ template_version: number }[]>`
      SELECT template_version FROM app.documents WHERE id = ${pageDocId}
    `;
    expect(doc[0].template_version).toBe(2);

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
