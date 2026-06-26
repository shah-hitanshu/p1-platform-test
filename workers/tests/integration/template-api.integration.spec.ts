/**
 * Template API Routes Tests
 *
 * Tests for PROPOSAL-010 template CRUD operations with admin-only access control.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

let sql: ReturnType<typeof postgres>;
let testSiteId: string;
let mainBranchId: string;
let adminUserId: string;
let editorUserId: string;
let viewerUserId: string;

beforeAll(async () => {
  sql = postgres(TEST_DATABASE_URL, { max: 1 });

  // Set database instance for services
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

  // Clean up stale data from previous failed runs
  const staleData = await sql<{ id: string }[]>`SELECT id FROM app.sites WHERE pantheon_site_id = 'test-template-api-site'`;
  if (staleData.length > 0) {
    const staleSiteId = staleData[0].id;
    await sql`DELETE FROM app.migration_conflicts WHERE template_id IN (SELECT id FROM app.documents WHERE site_id = ${staleSiteId})`;
    await sql`DELETE FROM app.migration_jobs WHERE site_id = ${staleSiteId}`;
    await sql`DELETE FROM app.checkpoint_documents WHERE checkpoint_id IN (SELECT id FROM app.checkpoints WHERE branch_id IN (SELECT id FROM app.branches WHERE site_id = ${staleSiteId}))`;
    await sql`UPDATE app.branches SET source_checkpoint_id = NULL WHERE site_id = ${staleSiteId}`;
    await sql`DELETE FROM app.checkpoints WHERE branch_id IN (SELECT id FROM app.branches WHERE site_id = ${staleSiteId})`;
    await sql`DELETE FROM app.document_versions WHERE document_id IN (SELECT id FROM app.documents WHERE site_id = ${staleSiteId})`;
    await sql`DELETE FROM app.documents WHERE site_id = ${staleSiteId}`;
    await sql`DELETE FROM app.user_site_roles WHERE site_id = ${staleSiteId}`;
    await sql`DELETE FROM app.branches WHERE site_id = ${staleSiteId}`;
    await sql`DELETE FROM app.sites WHERE id = ${staleSiteId}`;
  }
  await sql`DELETE FROM app.users WHERE email IN ('admin@example.com', 'editor@example.com', 'viewer@example.com')`;

  // Create test site
  const site = await sql<{ id: string }[]>`
    INSERT INTO app.sites (pantheon_site_id, name)
    VALUES ('test-template-api-site', 'Test Template API Site')
    RETURNING id
  `;
  testSiteId = site[0].id;

  // Create main branch
  const mainBranch = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
    VALUES (${testSiteId}, 'main', true, '00000000-0000-0000-0000-000000000000', 'system')
    RETURNING id
  `;
  mainBranchId = mainBranch[0].id;

  // Create test users with different roles
  const adminUser = await sql<{ id: string }[]>`
    INSERT INTO app.users (email, name)
    VALUES ('admin@example.com', 'Admin User')
    RETURNING id
  `;
  adminUserId = adminUser[0].id;

  const editorUser = await sql<{ id: string }[]>`
    INSERT INTO app.users (email, name)
    VALUES ('editor@example.com', 'Editor User')
    RETURNING id
  `;
  editorUserId = editorUser[0].id;

  const viewerUser = await sql<{ id: string }[]>`
    INSERT INTO app.users (email, name)
    VALUES ('viewer@example.com', 'Viewer User')
    RETURNING id
  `;
  viewerUserId = viewerUser[0].id;

  // Assign roles
  await sql`
    INSERT INTO app.user_site_roles (user_id, site_id, role, source)
    VALUES
      (${adminUserId}, ${testSiteId}, 'admin', 'local'),
      (${editorUserId}, ${testSiteId}, 'developer', 'local'),
      (${viewerUserId}, ${testSiteId}, 'team_member', 'local')
  `;
});

afterAll(async () => {
  try {
    if (testSiteId) {
      await sql`DELETE FROM app.migration_conflicts WHERE template_id IN (SELECT id FROM app.documents WHERE site_id = ${testSiteId})`;
      await sql`DELETE FROM app.migration_jobs WHERE site_id = ${testSiteId}`;
      await sql`DELETE FROM app.checkpoint_documents WHERE checkpoint_id IN (SELECT id FROM app.checkpoints WHERE branch_id IN (SELECT id FROM app.branches WHERE site_id = ${testSiteId}))`;
      await sql`UPDATE app.branches SET source_checkpoint_id = NULL WHERE site_id = ${testSiteId}`;
      await sql`DELETE FROM app.checkpoints WHERE branch_id IN (SELECT id FROM app.branches WHERE site_id = ${testSiteId})`;
      await sql`DELETE FROM app.document_versions WHERE document_id IN (SELECT id FROM app.documents WHERE site_id = ${testSiteId})`;
      await sql`DELETE FROM app.documents WHERE site_id = ${testSiteId}`;
      await sql`DELETE FROM app.user_site_roles WHERE site_id = ${testSiteId}`;
      await sql`DELETE FROM app.branches WHERE site_id = ${testSiteId}`;
      await sql`DELETE FROM app.sites WHERE id = ${testSiteId}`;
    }
    await sql`DELETE FROM app.users WHERE email IN ('admin@example.com', 'editor@example.com', 'viewer@example.com')`;
  } catch {
    // Ignore cleanup errors
  }

  setDatabaseInstance(null);
  await sql.end();
});

describe('Template API - Access Control', () => {
  it('should allow admin to list templates', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      { method: 'GET' },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('templates');
    expect(Array.isArray(body.templates)).toBe(true);
  });

  it('should allow editor to list templates', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      { method: 'GET' },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: editorUserId,
        type: 'user',
        dbUserId: editorUserId,
        email: 'editor@example.com',
        pantheonSiteRoles: { [testSiteId]: 'developer' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('templates');
  });

  it('should allow viewer to list templates', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      { method: 'GET' },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: viewerUserId,
        type: 'user',
        dbUserId: viewerUserId,
        email: 'viewer@example.com',
        pantheonSiteRoles: { [testSiteId]: 'team_member' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('templates');
  });

  it('should allow admin to create template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'admin-created-template',
          label: 'Admin Created Template',
          components: [
            { type: 'Hero', pinned: false, defaultProps: { title: 'Welcome' } },
          ],
        }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.name).toBe('admin-created-template');
    expect(body.label).toBe('Admin Created Template');
    expect(body.id).toBeDefined();

    // Verify in database
    const doc = await sql<{ id: string; path: string }[]>`
      SELECT id, path FROM app.documents
      WHERE site_id = ${testSiteId} AND path = '_registry/templates/admin-created-template'
    `;
    expect(doc.length).toBe(1);
    expect(doc[0].path).toBe('_registry/templates/admin-created-template');
  });

  it('should deny editor from creating template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'editor-attempted-template',
          label: 'Editor Attempted Template',
          components: [],
        }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: editorUserId,
        type: 'user',
        dbUserId: editorUserId,
        email: 'editor@example.com',
        pantheonSiteRoles: { [testSiteId]: 'developer' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('ADMIN');
  });

  it('should deny viewer from creating template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'viewer-attempted-template',
          label: 'Viewer Attempted Template',
          components: [],
        }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: viewerUserId,
        type: 'user',
        dbUserId: viewerUserId,
        email: 'viewer@example.com',
        pantheonSiteRoles: { [testSiteId]: 'team_member' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(403);
  });

  it('should allow admin to update template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // First create a template to update
    const createRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'template-to-update',
          label: 'Original Label',
          components: [],
        }),
      },
    );

    const createResponse = await handleTemplateRequest(createRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    const createBody = await createResponse.json();
    const templateId = createBody.id as string;

    // Now update it
    const updateRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Updated Label',
        }),
      },
    );

    const updateResponse = await handleTemplateRequest(updateRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(updateResponse.status).toBe(200);
    const updateBody = await updateResponse.json();
    expect(updateBody.label).toBe('Updated Label');
  });

  it('should deny editor from updating template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // Create a template as admin first
    const createReq = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'editor-update-deny-test', label: 'Test', components: [] }),
      },
    );
    const createRes = await handleTemplateRequest(createReq, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId, type: 'user', dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });
    const tplId = ((await createRes.json()) as { id: string }).id;

    const updateRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${tplId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Editor Update Attempt',
        }),
      },
    );

    const updateResponse = await handleTemplateRequest(updateRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: tplId,
      principal: {
        id: editorUserId,
        type: 'user',
        dbUserId: editorUserId,
        email: 'editor@example.com',
        pantheonSiteRoles: { [testSiteId]: 'developer' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(updateResponse.status).toBe(403);
  });

  it('should allow admin to delete template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // Create a template to delete
    const createRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'template-to-delete',
          label: 'Template to Delete',
          components: [],
        }),
      },
    );

    const createResponse = await handleTemplateRequest(createRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    const createBody = await createResponse.json();
    const templateId = createBody.id as string;

    // Delete it
    const deleteRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateId}`,
      { method: 'DELETE' },
    );

    const deleteResponse = await handleTemplateRequest(deleteRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(deleteResponse.status).toBe(204);
  });

  it('should deny editor from deleting template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // Create a template as admin first
    const createReq = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'editor-delete-deny-test', label: 'Test', components: [] }),
      },
    );
    const createRes = await handleTemplateRequest(createReq, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId, type: 'user', dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });
    const tplId = ((await createRes.json()) as { id: string }).id;

    const deleteRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${tplId}`,
      { method: 'DELETE' },
    );

    const deleteResponse = await handleTemplateRequest(deleteRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: tplId,
      principal: {
        id: editorUserId,
        type: 'user',
        dbUserId: editorUserId,
        email: 'editor@example.com',
        pantheonSiteRoles: { [testSiteId]: 'developer' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(deleteResponse.status).toBe(403);
  });

  it('should allow admin to trigger migration', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');
    const { createDocumentOnBranch } = await import('../../src/services');

    // Create a template with version 1
    const createReq = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'migration-access-test',
          label: 'Migration Access Test',
          components: [
            { type: 'Hero', required: true, pinned: true, defaultProps: {} },
          ],
        }),
      },
    );

    const createRes = await handleTemplateRequest(createReq, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });
    const tmpl = await createRes.json();
    const tmplId = tmpl.id as string;

    // Create a page referencing template at version 1
    await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: 'pages/migration-access-page',
      snapshot: { content: [{ type: 'Hero', props: {} }] },
      templateId: tmplId,
      templateVersion: 1,
      createdById: adminUserId,
      createdByType: 'user',
    });

    // Update template to version 2 with puckActions
    const updateReq = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${tmplId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          components: [
            { type: 'Hero', required: true, pinned: true, defaultProps: {} },
            { type: 'CTA', required: false, pinned: false, defaultProps: {} },
          ],
          puckActions: [
            { type: 'insert', componentType: 'CTA', destinationIndex: 1 },
          ],
        }),
      },
    );

    await handleTemplateRequest(updateReq, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: tmplId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    // Trigger migration
    const migrateReq = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${tmplId}/migrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromVersion: 1, toVersion: 2 }),
      },
    );

    const response = await handleTemplateRequest(migrateReq, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: tmplId,
      action: 'migrate',
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.job).toBeDefined();
    expect(body.job.totalDocuments).toBe(1);
    expect(body.processedDocuments).toBe(1);
  });
});

describe('Template API - CRUD Operations', () => {
  let templateDocId = '';

  beforeEach(async () => {
    // Create a test template document
    const doc = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path)
      VALUES (${testSiteId}, '_registry/templates/test-template')
      RETURNING id
    `;
    templateDocId = doc[0].id;

    // Create initial version
    const templateSnapshot = {
      name: 'test-template',
      label: 'Test Template',
      components: [
        { type: 'Hero', pinned: true, defaultProps: { title: 'Hello' } },
      ],
    };

    await sql`
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type
      )
      VALUES (
        ${templateDocId}, ${mainBranchId}, 1,
        ${sql.json(templateSnapshot)},
        'edit', ${adminUserId}, 'user'
      )
    `;
  });

  afterEach(async () => {
    if (templateDocId) {
      await sql`DELETE FROM app.document_versions WHERE document_id = ${templateDocId}`;
      await sql`DELETE FROM app.documents WHERE id = ${templateDocId}`;
      templateDocId = '';
    }
  });

  afterAll(async () => {
    try {
      // Clean up checkpoint references first
      await sql`
        DELETE FROM app.checkpoint_documents
        WHERE document_version_id IN (
          SELECT dv.id FROM app.document_versions dv
          JOIN app.documents d ON d.id = dv.document_id
          WHERE d.site_id = ${testSiteId}
          AND d.path LIKE '_registry/templates/%'
        )
      `;
      await sql`
        DELETE FROM app.document_versions
        WHERE document_id IN (
          SELECT id FROM app.documents
          WHERE site_id = ${testSiteId}
          AND path LIKE '_registry/templates/%'
        )
      `;
      await sql`
        DELETE FROM app.documents
        WHERE site_id = ${testSiteId}
        AND path LIKE '_registry/templates/%'
      `;
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should list templates on a branch', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      { method: 'GET' },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.templates).toBeDefined();
    expect(Array.isArray(body.templates)).toBe(true);
    expect(body.templates.length).toBeGreaterThan(0);

    const template = body.templates.find((t: { name: string }) => t.name === 'test-template');
    expect(template).toBeDefined();
    expect(template.label).toBe('Test Template');
    expect(template.version).toBe(1);
    expect(template.updatedAt).toBeDefined();
    expect(typeof template.updatedAt).toBe('string');
  });

  it('should get template detail by ID', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateDocId}`,
      { method: 'GET' },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: templateDocId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(templateDocId);
    expect(body.name).toBe('test-template');
    expect(body.label).toBe('Test Template');
    expect(body.components).toBeDefined();
    expect(Array.isArray(body.components)).toBe(true);
    expect(body.version).toBe(1);
    expect(body.updatedAt).toBeDefined();
    expect(typeof body.updatedAt).toBe('string');
  });

  it('should create new template with valid structure', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'new-valid-template',
          label: 'New Valid Template',
          description: 'A test template',
          defaultUrlPattern: '/pages/:slug',
          components: [
            { type: 'Header', pinned: true, defaultProps: { logo: 'logo.png' } },
            { type: 'Content', pinned: false, defaultProps: {} },
          ],
        }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('new-valid-template');
    expect(body.label).toBe('New Valid Template');
    expect(body.description).toBe('A test template');
    expect(body.defaultUrlPattern).toBe('/pages/:slug');
    expect(body.components.length).toBe(2);

    // Verify in database
    const docs = await sql<{ id: string; path: string }[]>`
      SELECT id, path FROM app.documents
      WHERE site_id = ${testSiteId} AND path = '_registry/templates/new-valid-template'
    `;
    expect(docs.length).toBe(1);

    const versions = await sql<{ snapshot: unknown }[]>`
      SELECT snapshot FROM app.document_versions
      WHERE document_id = ${docs[0].id} AND branch_id = ${mainBranchId}
    `;
    expect(versions.length).toBe(1);
    expect(versions[0].snapshot).toMatchObject({
      name: 'new-valid-template',
      label: 'New Valid Template',
    });
  });

  it('should update existing template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const updateRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateDocId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Updated Test Template',
          components: [
            { type: 'Hero', pinned: true, defaultProps: { title: 'Updated Title' } },
            { type: 'Footer', pinned: false, defaultProps: {} },
          ],
        }),
      },
    );

    const response = await handleTemplateRequest(updateRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: templateDocId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.label).toBe('Updated Test Template');
    expect(body.components.length).toBe(2);

    // Verify new version created in database
    const versions = await sql<{ version_number: number; snapshot: unknown }[]>`
      SELECT version_number, snapshot FROM app.document_versions
      WHERE document_id = ${templateDocId} AND branch_id = ${mainBranchId}
      ORDER BY version_number DESC
    `;
    expect(versions.length).toBe(2);
    expect(versions[0].version_number).toBe(2);
  });

  it('should forward puckActions to document version when updating template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const updateRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateDocId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          components: [
            { type: 'Hero', pinned: true, defaultProps: { title: 'Hello' } },
            { type: 'CTABlock', pinned: false, defaultProps: { label: 'Learn more' } },
          ],
          puckActions: [
            { type: 'insert', componentType: 'CTABlock', destinationIndex: 1, zone: 'content' },
          ],
        }),
      },
    );

    const response = await handleTemplateRequest(updateRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: templateDocId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(200);

    const latestVersion = await sql<{ action_type: string | null; action_metadata: Record<string, unknown> | null }[]>`
      SELECT action_type, action_metadata FROM app.document_versions
      WHERE document_id = ${templateDocId} AND branch_id = ${mainBranchId}
      ORDER BY version_number DESC
      LIMIT 1
    `;
    expect(latestVersion[0].action_type).toBe('structural');
    expect(latestVersion[0].action_metadata).toBeDefined();
    const rawMetadata = latestVersion[0].action_metadata;
    const metadata = (typeof rawMetadata === 'string' ? JSON.parse(rawMetadata) : rawMetadata) as { puckActions?: unknown[] };
    expect(metadata.puckActions).toBeDefined();
    expect(Array.isArray(metadata.puckActions)).toBe(true);
    expect(metadata.puckActions?.length).toBe(1);
    expect((metadata.puckActions?.[0] as { type: string } | undefined)?.type).toBe('insert');
  });

  it('should delete template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // Create a template to delete
    const createRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'template-to-be-deleted',
          label: 'Template to be deleted',
          components: [],
        }),
      },
    );

    const createResponse = await handleTemplateRequest(createRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    const createBody = await createResponse.json();
    const tempTemplateId = createBody.id as string;

    // Delete it
    const deleteRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${tempTemplateId}`,
      { method: 'DELETE' },
    );

    const deleteResponse = await handleTemplateRequest(deleteRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: tempTemplateId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(deleteResponse.status).toBe(204);

    // Verify tombstone created in database
    const versions = await sql<{ source: string }[]>`
      SELECT source FROM app.document_versions
      WHERE document_id = ${tempTemplateId} AND branch_id = ${mainBranchId}
      ORDER BY version_number DESC
      LIMIT 1
    `;
    expect(versions[0].source).toBe('edit');
  });

  it('should prevent template deletion when documents reference it', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // Create a template
    const createRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'referenced-template',
          label: 'Referenced Template',
          components: [],
        }),
      },
    );

    const createResponse = await handleTemplateRequest(createRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    const createBody = await createResponse.json();
    const referencedTemplateId = createBody.id as string;

    // Create documents referencing this template
    const doc1 = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path, template_id)
      VALUES (${testSiteId}, '/pages/test-page-1', ${referencedTemplateId})
      RETURNING id
    `;

    const doc2 = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path, template_id)
      VALUES (${testSiteId}, '/pages/test-page-2', ${referencedTemplateId})
      RETURNING id
    `;

    try {
      // Attempt to delete the template
      const deleteRequest = new Request(
        `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${referencedTemplateId}`,
        { method: 'DELETE' },
      );

      const deleteResponse = await handleTemplateRequest(deleteRequest, {
        siteId: testSiteId,
        branchId: mainBranchId,
        templateId: referencedTemplateId,
        principal: {
          id: adminUserId,
          type: 'user',
          dbUserId: adminUserId,
          email: 'admin@example.com',
          pantheonSiteRoles: { [testSiteId]: 'admin' },
          tokenExpiry: '2026-12-31T23:59:59.000Z',
        },
      });

      // Should return 409 Conflict
      expect(deleteResponse.status).toBe(409);
      const deleteBody = await deleteResponse.json();
      expect(deleteBody.error).toContain('Cannot delete template');
      expect(deleteBody.error).toContain('2');
      expect(deleteBody.error).toContain('document(s) still reference it');
    } finally {
      // Cleanup documents
      await sql`DELETE FROM app.documents WHERE id IN (${doc1[0].id}, ${doc2[0].id})`;
    }
  });

  it('should reject template creation with invalid structure', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // Missing name
    const requestNoName = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Missing Name Template',
          components: [],
        }),
      },
    );

    const responseNoName = await handleTemplateRequest(requestNoName, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(responseNoName.status).toBe(400);
    const bodyNoName = await responseNoName.json();
    expect(bodyNoName.error).toContain('name');

    // Missing label
    const requestNoLabel = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'missing-label',
          components: [],
        }),
      },
    );

    const responseNoLabel = await handleTemplateRequest(requestNoLabel, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(responseNoLabel.status).toBe(400);
    const bodyNoLabel = await responseNoLabel.json();
    expect(bodyNoLabel.error).toContain('label');

    // Invalid components (not an array)
    const requestInvalidComponents = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'invalid-components',
          label: 'Invalid Components',
          components: 'not-an-array',
        }),
      },
    );

    const responseInvalidComponents = await handleTemplateRequest(
      requestInvalidComponents,
      {
        siteId: testSiteId,
        branchId: mainBranchId,
        principal: {
          id: adminUserId,
          type: 'user',
          dbUserId: adminUserId,
          email: 'admin@example.com',
          pantheonSiteRoles: { [testSiteId]: 'admin' },
          tokenExpiry: '2026-12-31T23:59:59.000Z',
        },
      },
    );

    expect(responseInvalidComponents.status).toBe(400);
    const bodyInvalidComponents = await responseInvalidComponents.json();
    expect(bodyInvalidComponents.error).toContain('array');
  });

  it('should prevent duplicate template names', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // Try to create a template with the same name as the existing one
    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-template', // Already exists from beforeEach
          label: 'Duplicate Template',
          components: [],
        }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(409);
  });
});

describe('Template API - Migration Operations', () => {
  let migrationTemplateId: string;
  let migrationPageId: string;

  beforeAll(async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');
    const { createDocumentOnBranch } = await import('../../src/services');

    const adminPrincipal = {
      id: adminUserId,
      type: 'user' as const,
      dbUserId: adminUserId,
      email: 'admin@example.com',
      pantheonSiteRoles: { [testSiteId]: 'admin' },
      tokenExpiry: '2026-12-31T23:59:59.000Z',
    };

    // Create template v1
    const createRes = await handleTemplateRequest(
      new Request(
        `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'migration-ops-template',
            label: 'Migration Ops Template',
            components: [
              { type: 'Hero', required: true, pinned: true, defaultProps: {} },
            ],
          }),
        },
      ),
      { siteId: testSiteId, branchId: mainBranchId, principal: adminPrincipal },
    );
    const tmpl = await createRes.json();
    migrationTemplateId = tmpl.id as string;

    // Create page referencing template v1
    const pageResult = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: 'pages/migration-ops-page',
      snapshot: { content: [{ type: 'Hero', props: {} }] },
      templateId: migrationTemplateId,
      templateVersion: 1,
      createdById: adminUserId,
      createdByType: 'user',
    });
    migrationPageId = pageResult.document.id;

    // Update template to v2
    await handleTemplateRequest(
      new Request(
        `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${migrationTemplateId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            components: [
              { type: 'Hero', required: true, pinned: true, defaultProps: {} },
              { type: 'CTA', required: false, pinned: false, defaultProps: {} },
            ],
            puckActions: [
              { type: 'insert', componentType: 'CTA', destinationIndex: 1 },
            ],
          }),
        },
      ),
      {
        siteId: testSiteId,
        branchId: mainBranchId,
        templateId: migrationTemplateId,
        principal: adminPrincipal,
      },
    );
  });

  it('should trigger template migration and process documents', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${migrationTemplateId}/migrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromVersion: 1, toVersion: 2 }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: migrationTemplateId,
      action: 'migrate',
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.job).toBeDefined();
    expect(body.job.totalDocuments).toBe(1);
    expect(body.processedDocuments).toBe(1);
    expect(body.conflictedDocuments).toBe(0);

    // Verify the page's template_version was updated
    const doc = await sql<{ template_version: number }[]>`
      SELECT template_version FROM app.documents WHERE id = ${migrationPageId}
    `;
    expect(doc[0].template_version).toBe(2);
  });

  it('should rollback a completed migration', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // Get the migration job ID from the latest job
    const jobs = await sql<{ id: string }[]>`
      SELECT id FROM app.migration_jobs
      WHERE template_id = ${migrationTemplateId}
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(jobs.length).toBeGreaterThan(0);
    const jobId = jobs[0].id;

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${migrationTemplateId}/rollback`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: migrationTemplateId,
      action: 'rollback',
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rolledBackDocuments).toBeGreaterThanOrEqual(0);

    // Verify the page's template_version was reverted
    const doc = await sql<{ template_version: number }[]>`
      SELECT template_version FROM app.documents WHERE id = ${migrationPageId}
    `;
    expect(doc[0].template_version).toBe(1);
  });

  it('should return migration status for template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${migrationTemplateId}/migration-status`,
      { method: 'GET' },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: migrationTemplateId,
      action: 'migration-status',
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.templateId).toBe(migrationTemplateId);
    expect(body.currentVersion).toBeGreaterThanOrEqual(2);
    expect(typeof body.staleDocumentCount).toBe('number');
    expect(typeof body.migrationAvailable).toBe('boolean');
  });

  it('should preview migration for template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${migrationTemplateId}/migrate/preview`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromVersion: 1, toVersion: 2 }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: migrationTemplateId,
      action: 'migrate-preview',
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.templateId).toBe(migrationTemplateId);
    expect(body.fromVersion).toBe(1);
    expect(body.toVersion).toBe(2);
    expect(typeof body.affectedDocuments).toBe('number');
    expect(typeof body.estimatedConflicts).toBe('number');
    expect(typeof body.cleanDocuments).toBe('number');
  });

  it('should return 404 for non-existent template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const fakeTemplateId = '00000000-0000-0000-0000-000000000000';

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${fakeTemplateId}`,
      { method: 'GET' },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: fakeTemplateId,
      principal: {
        id: adminUserId,
        type: 'user',
        dbUserId: adminUserId,
        email: 'admin@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' },
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain('not found');
  });
});

describe('Template API - Authorization Edge Cases', () => {
  it('should allow EDITOR to create template via branch grant elevation', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // Insert branch grant giving EDITOR user ADMIN role on this specific branch
    const branchGrant = await sql<{ id: string }[]>`
      INSERT INTO app.branch_grants (branch_id, actor_id, actor_type, role, granted_by_id, granted_by_type)
      VALUES (${mainBranchId}, ${editorUserId}, 'user', 'ADMIN', ${adminUserId}, 'user')
      RETURNING id
    `;
    const grantId = branchGrant[0].id;

    try {
      const request = new Request(
        `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'editor-branch-grant-template',
            label: 'Editor Branch Grant Template',
            components: [],
          }),
        },
      );

      const response = await handleTemplateRequest(request, {
        siteId: testSiteId,
        branchId: mainBranchId,
        principal: {
          id: editorUserId,
          type: 'user',
          dbUserId: editorUserId,
          email: 'editor@example.com',
          pantheonSiteRoles: { [testSiteId]: 'developer' }, // EDITOR role
          tokenExpiry: '2026-12-31T23:59:59.000Z',
        },
      });

      // Should succeed because branch grant elevates to ADMIN
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.name).toBe('editor-branch-grant-template');
    } finally {
      // Clean up grant
      await sql`DELETE FROM app.branch_grants WHERE id = ${grantId}`;
    }
  });

  it.skip('should restrict agent acting as user to minimum permission intersection', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // Create agent principal with ADMIN role
    // Set actingUserEmail to VIEWER user's email
    // Expected behavior: min(ADMIN, VIEWER) = VIEWER, so create should fail
    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'agent-acting-template',
          label: 'Agent Acting Template',
          components: [],
        }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: 'agent-123',
        type: 'agent',
        dbUserId: 'agent-123',
        email: 'agent@example.com',
        pantheonSiteRoles: { [testSiteId]: 'admin' }, // Agent has ADMIN
        actingUserEmail: 'viewer@example.com', // Acting as VIEWER user
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    // Should fail with 403 because effective permission is min(ADMIN, VIEWER) = VIEWER
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('ADMIN');
  });

  it('should allow service principal bound to site to create template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // Service principals pass assertPermission via hasServicePermission
    // when their siteId matches the request's siteId
    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'service-principal-template',
          label: 'Service Principal Template',
          components: [],
        }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: {
        id: '083f5df3-16e2-4a26-a195-93dc61aaedf4',
        type: 'service',
        siteId: testSiteId,
        pantheonSiteRoles: {},
        tokenExpiry: '2026-12-31T23:59:59.000Z',
      },
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.name).toBe('service-principal-template');
  });

  it.skip('should reject template creation on archived branch', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // Create an archived branch
    const archivedBranch = await sql<{ id: string }[]>`
      INSERT INTO app.branches (site_id, name, status, is_main, created_by_id, created_by_type)
      VALUES (${testSiteId}, 'archived-branch', 'archived', false, ${adminUserId}, 'user')
      RETURNING id
    `;
    const archivedBranchId = archivedBranch[0].id;

    try {
      const request = new Request(
        `https://api.example.com/api/sites/${testSiteId}/branches/${archivedBranchId}/templates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'archived-branch-template',
            label: 'Archived Branch Template',
            components: [],
          }),
        },
      );

      const response = await handleTemplateRequest(request, {
        siteId: testSiteId,
        branchId: archivedBranchId,
        principal: {
          id: adminUserId,
          type: 'user',
          dbUserId: adminUserId,
          email: 'admin@example.com',
          pantheonSiteRoles: { [testSiteId]: 'admin' },
          tokenExpiry: '2026-12-31T23:59:59.000Z',
        },
      });

      // Should fail - archived branches should not allow template creation
      expect(response.status).toBeGreaterThanOrEqual(400);
      const body = await response.json();
      expect(body.error).toBeDefined();
    } finally {
      // Clean up archived branch and any data created on it
      await sql`DELETE FROM app.document_versions WHERE branch_id = ${archivedBranchId}`;
      await sql`DELETE FROM app.documents WHERE site_id = ${testSiteId} AND path = '_registry/templates/archived-branch-template'`;
      await sql`DELETE FROM app.branches WHERE id = ${archivedBranchId}`;
    }
  });
});
