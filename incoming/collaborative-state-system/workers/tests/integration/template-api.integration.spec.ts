/**
 * Template API Routes Tests
 *
 * Tests for template CRUD operations with admin-only access control.
 * Template snapshots are Puck content-shaped ({ content, root, zones });
 * metadata lives at root.props._template and pin state at root.props._pinMap.
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

/**
 * Build a content-shaped template snapshot as the canvas save path writes it.
 */
function templateSnapshot(
  content: { type: string; props: Record<string, unknown> }[],
  metadata: Record<string, unknown>,
  pinMap: Record<string, boolean> = {},
): Record<string, unknown> {
  return {
    content,
    root: {
      props: {
        _template: { deprecated: false, ...metadata },
        _pinMap: pinMap,
      },
    },
    zones: {},
  };
}

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
    await sql`DELETE FROM app.document_relations WHERE source_document_id IN (SELECT id FROM app.documents WHERE site_id = ${staleSiteId}) OR target_document_id IN (SELECT id FROM app.documents WHERE site_id = ${staleSiteId})`;
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
      await sql`DELETE FROM app.document_relations WHERE source_document_id IN (SELECT id FROM app.documents WHERE site_id = ${testSiteId}) OR target_document_id IN (SELECT id FROM app.documents WHERE site_id = ${testSiteId})`;
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
    expect(body.root.props._template.label).toBe('Admin Created Template');
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
    expect(updateBody.root.props._template.label).toBe('Updated Label');
  });

  it('should deny editor from updating template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    // Create a template as admin first
    const createReq = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'editor-update-deny-test', label: 'Test' }),
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
    const createResBody = await createRes.json();
    const tplId = createResBody.id as string;

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
        body: JSON.stringify({ name: 'editor-delete-deny-test', label: 'Test' }),
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
    const createResBody = await createRes.json();
    const tplId = createResBody.id as string;

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
    const storedSnapshot = templateSnapshot(
      [{ type: 'Hero', props: { id: 'hero-1', title: 'Hello' } }],
      { label: 'Test Template' },
      { 'hero-1': true },
    );

    await sql`
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type
      )
      VALUES (
        ${templateDocId}, ${mainBranchId}, 1,
        ${sql.json(storedSnapshot as never)},
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

  it('should list templates as metadata summaries without component data', async () => {
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
    expect(template.id).toBe(templateDocId);
    expect(template.label).toBe('Test Template');
    expect(template.deprecated).toBe(false);
    expect(template.version).toBe(1);
    expect(template.updatedAt).toBeDefined();
    expect(typeof template.updatedAt).toBe('string');
    expect(template.content).toBeUndefined();
    expect(template.root).toBeUndefined();
  });

  it('should get template detail as the stored snapshot', async () => {
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
    expect(body.version).toBe(1);
    expect(body.updatedAt).toBeDefined();
    expect(typeof body.updatedAt).toBe('string');
    expect(body.content).toEqual([
      { type: 'Hero', props: { id: 'hero-1', title: 'Hello' } },
    ]);
    expect(body.root.props._template).toEqual({
      label: 'Test Template',
      deprecated: false,
    });
    expect(body.root.props._pinMap).toEqual({ 'hero-1': true });
    expect(body.zones).toEqual({});
  });

  it('should create new template seeded with an empty content snapshot', async () => {
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
    expect(body.content).toEqual([]);
    expect(body.root.props._template).toEqual({
      label: 'New Valid Template',
      description: 'A test template',
      defaultUrlPattern: '/pages/:slug',
      deprecated: false,
    });
    expect(body.root.props._pinMap).toEqual({});
    expect(body.zones).toEqual({});

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
    expect(versions[0].snapshot).toEqual({
      content: [],
      root: {
        props: {
          _template: {
            label: 'New Valid Template',
            description: 'A test template',
            defaultUrlPattern: '/pages/:slug',
            deprecated: false,
          },
          _pinMap: {},
        },
      },
      zones: {},
    });
  });

  it('should update template metadata without touching layout', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const updateRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateDocId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Updated Test Template',
          description: 'Updated description',
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
    expect(body.name).toBe('test-template');
    expect(body.root.props._template.label).toBe('Updated Test Template');
    expect(body.root.props._template.description).toBe('Updated description');
    expect(body.content).toEqual([
      { type: 'Hero', props: { id: 'hero-1', title: 'Hello' } },
    ]);

    // Verify new version created in database with layout intact
    const versions = await sql<{ version_number: number; snapshot: Record<string, unknown> }[]>`
      SELECT version_number, snapshot FROM app.document_versions
      WHERE document_id = ${templateDocId} AND branch_id = ${mainBranchId}
      ORDER BY version_number DESC
    `;
    expect(versions.length).toBe(2);
    expect(versions[0].version_number).toBe(2);
    expect(versions[0].snapshot).toEqual({
      content: [{ type: 'Hero', props: { id: 'hero-1', title: 'Hello' } }],
      root: {
        props: {
          _template: {
            label: 'Updated Test Template',
            description: 'Updated description',
            deprecated: false,
          },
          _pinMap: { 'hero-1': true },
        },
      },
      zones: {},
    });
  });

  it('should ignore layout fields sent to a metadata update', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const updateRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateDocId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Metadata Only',
          content: [{ type: 'Rogue', props: { id: 'rogue-1' } }],
          zones: { rogue: [] },
          components: [{ type: 'Rogue', pinned: true, defaultProps: {} }],
          puckActions: [{ type: 'insert', componentType: 'Rogue', destinationIndex: 0 }],
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

    const versions = await sql<{ snapshot: Record<string, unknown> }[]>`
      SELECT snapshot FROM app.document_versions
      WHERE document_id = ${templateDocId} AND branch_id = ${mainBranchId}
      ORDER BY version_number DESC
      LIMIT 1
    `;
    expect(versions[0].snapshot).toEqual({
      content: [{ type: 'Hero', props: { id: 'hero-1', title: 'Hello' } }],
      root: {
        props: {
          _template: { label: 'Metadata Only', deprecated: false },
          _pinMap: { 'hero-1': true },
        },
      },
      zones: {},
    });
  });

  it('should block document creation from a deprecated template', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const adminPrincipal = {
      id: adminUserId,
      type: 'user' as const,
      dbUserId: adminUserId,
      email: 'admin@example.com',
      pantheonSiteRoles: { [testSiteId]: 'admin' },
      tokenExpiry: '2026-12-31T23:59:59.000Z',
    };

    const deprecateRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${templateDocId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deprecated: true }),
      },
    );

    const deprecateResponse = await handleTemplateRequest(deprecateRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: templateDocId,
      principal: adminPrincipal,
    });

    expect(deprecateResponse.status).toBe(200);
    const deprecateBody = await deprecateResponse.json();
    expect(deprecateBody.root.props._template.deprecated).toBe(true);

    const createDocRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'pages/from-deprecated-template',
          templateId: templateDocId,
          snapshot: { content: [] },
        }),
      },
    );

    const createDocResponse = await handleDocumentRoutes(createDocRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: adminPrincipal,
    });

    expect(createDocResponse.status).toBe(400);
    const createDocBody = await createDocResponse.json();
    expect(createDocBody.error).toContain('deprecated');
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
      INSERT INTO app.documents (site_id, path)
      VALUES (${testSiteId}, '/pages/test-page-1')
      RETURNING id
    `;

    const doc2 = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path)
      VALUES (${testSiteId}, '/pages/test-page-2')
      RETURNING id
    `;

    await sql`
      INSERT INTO app.document_relations (source_document_id, target_document_id, relation_type)
      VALUES (${doc1[0].id}, ${referencedTemplateId}, 'template'),
             (${doc2[0].id}, ${referencedTemplateId}, 'template')
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
      await sql`DELETE FROM app.document_relations WHERE source_document_id IN (${doc1[0].id}, ${doc2[0].id})`;
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
    const { createDocumentOnBranch, createDocumentVersion } = await import('../../src/services');

    const adminPrincipal = {
      id: adminUserId,
      type: 'user' as const,
      dbUserId: adminUserId,
      email: 'admin@example.com',
      pantheonSiteRoles: { [testSiteId]: 'admin' },
      tokenExpiry: '2026-12-31T23:59:59.000Z',
    };

    // Create template (v1: empty content seed)
    const createRes = await handleTemplateRequest(
      new Request(
        `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'migration-ops-template',
            label: 'Migration Ops Template',
          }),
        },
      ),
      { siteId: testSiteId, branchId: mainBranchId, principal: adminPrincipal },
    );
    const tmpl = await createRes.json();
    migrationTemplateId = tmpl.id as string;

    // Canvas save writes the layout (v2)
    await createDocumentVersion({
      documentId: migrationTemplateId,
      branchId: mainBranchId,
      snapshot: templateSnapshot(
        [{ type: 'Hero', props: { id: 'hero-1' } }],
        { label: 'Migration Ops Template' },
        { 'hero-1': true },
      ),
      source: 'edit',
      createdById: adminUserId,
      createdByType: 'user',
    });

    // Create page referencing template v2
    const pageResult = await createDocumentOnBranch({
      siteId: testSiteId,
      branchId: mainBranchId,
      path: 'pages/migration-ops-page',
      snapshot: { content: [{ type: 'Hero', props: { id: 'hero-1' } }] },
      templateId: migrationTemplateId,
      templateVersion: 2,
      createdById: adminUserId,
      createdByType: 'user',
    });
    migrationPageId = pageResult.document.id;

    // Canvas save adds CTA with structural intent (v3)
    await createDocumentVersion({
      documentId: migrationTemplateId,
      branchId: mainBranchId,
      snapshot: templateSnapshot(
        [
          { type: 'Hero', props: { id: 'hero-1' } },
          { type: 'CTA', props: { id: 'cta-1', label: 'Learn more' } },
        ],
        { label: 'Migration Ops Template' },
        { 'hero-1': true },
      ),
      source: 'edit',
      createdById: adminUserId,
      createdByType: 'user',
      puckActions: [
        { type: 'insert', componentType: 'CTA', destinationIndex: 1 },
      ],
    });
  });

  it('should trigger template migration and process documents', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${migrationTemplateId}/migrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromVersion: 2, toVersion: 3 }),
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

    // Verify the page's synced template version was updated
    const rel = await sql<{ synced_version: number }[]>`
      SELECT synced_version FROM app.document_relations
      WHERE source_document_id = ${migrationPageId} AND relation_type = 'template'
    `;
    expect(rel[0].synced_version).toBe(3);
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

    // Verify the page's synced template version was reverted
    const rel = await sql<{ synced_version: number }[]>`
      SELECT synced_version FROM app.document_relations
      WHERE source_document_id = ${migrationPageId} AND relation_type = 'template'
    `;
    expect(rel[0].synced_version).toBe(2);
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
    expect(body.currentVersion).toBeGreaterThanOrEqual(3);
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
        body: JSON.stringify({ fromVersion: 2, toVersion: 3 }),
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
    expect(body.fromVersion).toBe(2);
    expect(body.toVersion).toBe(3);
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
});

describe('Template API - Legacy manifest snapshots', () => {
  const createdDocIds: string[] = [];

  interface TestPrincipal {
    id: string;
    type: 'user';
    dbUserId: string;
    email: string;
    pantheonSiteRoles: Record<string, string>;
    tokenExpiry: string;
  }

  function adminPrincipal(): TestPrincipal {
    return {
      id: adminUserId,
      type: 'user',
      dbUserId: adminUserId,
      email: 'admin@example.com',
      pantheonSiteRoles: { [testSiteId]: 'admin' },
      tokenExpiry: '2026-12-31T23:59:59.000Z',
    };
  }

  async function seedTemplateDocument(
    name: string,
    snapshot: Record<string, unknown>,
  ): Promise<string> {
    const doc = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path)
      VALUES (${testSiteId}, ${'_registry/templates/' + name})
      RETURNING id
    `;
    const docId = doc[0].id;
    createdDocIds.push(docId);

    await sql`
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type
      )
      VALUES (
        ${docId}, ${mainBranchId}, 1,
        ${sql.json(snapshot as never)},
        'edit', ${adminUserId}, 'user'
      )
    `;
    return docId;
  }

  afterEach(async () => {
    for (const docId of createdDocIds.splice(0)) {
      await sql`DELETE FROM app.document_versions WHERE document_id = ${docId}`;
      await sql`DELETE FROM app.documents WHERE id = ${docId}`;
    }
  });

  it('converts a manifest-shaped snapshot to the content shape on metadata PATCH', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');
    const { backfillTemplateContentShape } = await import('../../src/services/template-content-backfill');

    const docId = await seedTemplateDocument('legacy-manifest-patch', {
      name: 'legacy-manifest-patch',
      label: 'Legacy Blog',
      description: 'Legacy blog layout',
      components: [
        { type: 'HeroBlock', pinned: true, defaultProps: { title: 'Hero' } },
      ],
    });

    const patchRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${docId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deprecated: true }),
      },
    );

    const response = await handleTemplateRequest(patchRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: docId,
      principal: adminPrincipal(),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.content).toHaveLength(1);
    expect(body.content[0].type).toBe('HeroBlock');
    expect(body.content[0].props.title).toBe('Hero');
    expect(body.root.props._template).toEqual({
      label: 'Legacy Blog',
      description: 'Legacy blog layout',
      deprecated: true,
    });
    const heroId = body.content[0].props.id as string;
    expect(body.root.props._pinMap).toEqual({ [heroId]: true });

    // The conversion is a representation change: written as non-structural
    const versions = await sql<{ version_number: number; action_type: string | null }[]>`
      SELECT version_number, action_type FROM app.document_versions
      WHERE document_id = ${docId} AND branch_id = ${mainBranchId}
      ORDER BY version_number DESC
    `;
    expect(versions[0].version_number).toBe(2);
    expect(versions[0].action_type).toBeNull();

    // The backfill then skips the already-converted snapshot
    const backfill = await backfillTemplateContentShape();
    expect(backfill.converted.some((e) => e.documentId === docId)).toBe(false);
    expect(backfill.skipped.some((e) => e.documentId === docId)).toBe(true);
  });

  it('lists a legacy manifest row with its top-level metadata', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    await seedTemplateDocument('legacy-manifest-list', {
      name: 'legacy-manifest-list',
      label: 'Legacy List Template',
      deprecated: true,
      components: [],
    });

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      { method: 'GET' },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: adminPrincipal(),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const entry = body.templates.find(
      (t: { name: string }) => t.name === 'legacy-manifest-list',
    );
    expect(entry).toBeDefined();
    expect(entry.label).toBe('Legacy List Template');
    expect(entry.deprecated).toBe(true);
  });

  it('blocks page creation from a legacy deprecated manifest template', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const docId = await seedTemplateDocument('legacy-manifest-deprecated', {
      name: 'legacy-manifest-deprecated',
      label: 'Legacy Deprecated Template',
      deprecated: true,
      components: [],
    });

    const createDocRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'pages/from-legacy-deprecated-template',
          templateId: docId,
          snapshot: { content: [] },
        }),
      },
    );

    const response = await handleDocumentRoutes(createDocRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: adminPrincipal(),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('deprecated');
  });

  it('preserves unknown _template keys across an unrelated PATCH', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const docId = await seedTemplateDocument('extra-metadata-key', {
      content: [],
      root: {
        props: {
          _template: { label: 'Extra Key Template', deprecated: false, icon: 'star' },
          _pinMap: {},
        },
      },
      zones: {},
    });

    const patchRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${docId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Now with a description' }),
      },
    );

    const response = await handleTemplateRequest(patchRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: docId,
      principal: adminPrincipal(),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.root.props._template).toEqual({
      label: 'Extra Key Template',
      deprecated: false,
      icon: 'star',
      description: 'Now with a description',
    });
  });
});

describe('Template API - Legacy client compatibility window', () => {
  const createdDocIds: string[] = [];

  interface TestPrincipal {
    id: string;
    type: 'user';
    dbUserId: string;
    email: string;
    pantheonSiteRoles: Record<string, string>;
    tokenExpiry: string;
  }

  function adminPrincipal(): TestPrincipal {
    return {
      id: adminUserId,
      type: 'user',
      dbUserId: adminUserId,
      email: 'admin@example.com',
      pantheonSiteRoles: { [testSiteId]: 'admin' },
      tokenExpiry: '2026-12-31T23:59:59.000Z',
    };
  }

  async function seedTemplateDocument(
    name: string,
    snapshot: Record<string, unknown>,
  ): Promise<string> {
    const doc = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path)
      VALUES (${testSiteId}, ${'_registry/templates/' + name})
      RETURNING id
    `;
    const docId = doc[0].id;
    createdDocIds.push(docId);

    await sql`
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot,
        source, created_by_id, created_by_type
      )
      VALUES (
        ${docId}, ${mainBranchId}, 1,
        ${sql.json(snapshot as never)},
        'edit', ${adminUserId}, 'user'
      )
    `;
    return docId;
  }

  afterEach(async () => {
    for (const docId of createdDocIds.splice(0)) {
      await sql`DELETE FROM app.document_versions WHERE document_id = ${docId}`;
      await sql`DELETE FROM app.documents WHERE id = ${docId}`;
    }
  });

  it('persists a content-shaped snapshot from a legacy manifest create body and returns both shapes', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'manifest-create',
          label: 'Manifest Create',
          description: 'From a legacy client',
          components: [
            { type: 'Hero', pinned: true, defaultProps: { title: 'Hello' } },
            { type: 'CTA', pinned: false, defaultProps: { label: 'Go' } },
          ],
        }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: adminPrincipal(),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    const docId = body.id as string;
    createdDocIds.push(docId);

    // Response carries the canonical content shape with generated ids
    expect(body.content).toHaveLength(2);
    expect(body.content[0].type).toBe('Hero');
    expect(body.content[0].props.title).toBe('Hello');
    expect(typeof body.content[0].props.id).toBe('string');
    const heroId = body.content[0].props.id as string;
    const ctaId = body.content[1].props.id as string;
    expect(body.root.props._template).toEqual({
      label: 'Manifest Create',
      description: 'From a legacy client',
      deprecated: false,
    });
    expect(body.root.props._pinMap).toEqual({ [heroId]: true });

    // Response also carries the legacy manifest projection
    expect(body.label).toBe('Manifest Create');
    expect(body.deprecated).toBe(false);
    expect(body.components).toEqual([
      { type: 'Hero', pinned: true, defaultProps: { title: 'Hello' } },
      { type: 'CTA', pinned: false, defaultProps: { label: 'Go' } },
    ]);

    // Storage is single-shape canonical: no manifest fields persisted
    const versions = await sql<{ snapshot: Record<string, unknown> }[]>`
      SELECT snapshot FROM app.document_versions
      WHERE document_id = ${docId} AND branch_id = ${mainBranchId}
    `;
    expect(versions).toHaveLength(1);
    expect(versions[0].snapshot).toEqual({
      content: [
        { type: 'Hero', props: { title: 'Hello', id: heroId } },
        { type: 'CTA', props: { label: 'Go', id: ctaId } },
      ],
      root: {
        props: {
          _template: {
            label: 'Manifest Create',
            description: 'From a legacy client',
            deprecated: false,
          },
          _pinMap: { [heroId]: true },
        },
      },
      zones: {},
    });
  });

  it('returns canonical content plus legacy fields for a manifest-shaped stored snapshot', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const docId = await seedTemplateDocument('manifest-get', {
      name: 'manifest-get',
      label: 'Manifest Get',
      description: 'Legacy layout',
      components: [
        { type: 'Hero', pinned: true, defaultProps: { title: 'Hi' } },
      ],
    });

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${docId}`,
      { method: 'GET' },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: docId,
      principal: adminPrincipal(),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    // Canonical content shape derived in memory
    expect(body.content).toHaveLength(1);
    expect(body.content[0].type).toBe('Hero');
    expect(body.content[0].props.title).toBe('Hi');
    const heroId = body.content[0].props.id as string;
    expect(typeof heroId).toBe('string');
    expect(body.root.props._template).toEqual({
      label: 'Manifest Get',
      description: 'Legacy layout',
      deprecated: false,
    });
    expect(body.root.props._pinMap).toEqual({ [heroId]: true });

    // Legacy fields present alongside the content shape
    expect(body.label).toBe('Manifest Get');
    expect(body.components).toEqual([
      { type: 'Hero', pinned: true, defaultProps: { title: 'Hi' } },
    ]);

    // Read path persists nothing
    const versions = await sql<{ version_number: number }[]>`
      SELECT version_number FROM app.document_versions
      WHERE document_id = ${docId} AND branch_id = ${mainBranchId}
    `;
    expect(versions).toHaveLength(1);
    expect(versions[0].version_number).toBe(1);
  });

  it('derives legacy components from a content-shaped stored snapshot in content order', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const docId = await seedTemplateDocument('content-get', {
      content: [
        { type: 'Hero', props: { id: 'hero-1', title: 'Hello' } },
        { type: 'CTA', props: { id: 'cta-1', label: 'Go' } },
      ],
      root: {
        props: {
          _template: { label: 'Content Get', deprecated: false },
          _pinMap: { 'hero-1': true },
        },
      },
      zones: {},
    });

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${docId}`,
      { method: 'GET' },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: docId,
      principal: adminPrincipal(),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.content).toEqual([
      { type: 'Hero', props: { id: 'hero-1', title: 'Hello' } },
      { type: 'CTA', props: { id: 'cta-1', label: 'Go' } },
    ]);

    // pinned strictly from _pinMap === true, defaultProps = props minus id
    expect(body.components).toEqual([
      { type: 'Hero', pinned: true, defaultProps: { title: 'Hello' } },
      { type: 'CTA', pinned: false, defaultProps: { label: 'Go' } },
    ]);
  });

  it('adds a components projection to list entries and keeps the templates wrapper', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const docId = await seedTemplateDocument('content-list', {
      content: [{ type: 'Hero', props: { id: 'hero-1', title: 'Hello' } }],
      root: {
        props: {
          _template: { label: 'Content List', deprecated: false },
          _pinMap: { 'hero-1': true },
        },
      },
      zones: {},
    });

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates`,
      { method: 'GET' },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: adminPrincipal(),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('templates');
    expect(Array.isArray(body.templates)).toBe(true);

    const entry = body.templates.find((t: { id: string }) => t.id === docId);
    expect(entry).toBeDefined();
    expect(entry.label).toBe('Content List');
    expect(entry.components).toEqual([
      { type: 'Hero', pinned: true, defaultProps: { title: 'Hello' } },
    ]);
    expect(entry.content).toBeUndefined();
    expect(entry.root).toBeUndefined();
  });

  it('folds legacy pin flags type-keyed into _pinMap while leaving content and unflagged types alone', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const docId = await seedTemplateDocument('content-pin-patch', {
      content: [
        { type: 'Hero', props: { id: 'hero-1', title: 'Hello' } },
        { type: 'CTA', props: { id: 'cta-1', label: 'Go' } },
      ],
      root: {
        props: {
          _template: { label: 'Pin Patch', deprecated: false },
          _pinMap: { 'cta-1': true },
        },
      },
      zones: {},
    });

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${docId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Pinned Hero',
          components: [
            { type: 'Hero', pinned: true, defaultProps: { title: 'Ignored' } },
            { type: 'CTA' },
          ],
        }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: docId,
      principal: adminPrincipal(),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    // Metadata applied and combined shape returned
    expect(body.root.props._template.label).toBe('Pinned Hero');
    expect(body.label).toBe('Pinned Hero');

    // Content untouched: defaultProps not applied
    expect(body.content).toEqual([
      { type: 'Hero', props: { id: 'hero-1', title: 'Hello' } },
      { type: 'CTA', props: { id: 'cta-1', label: 'Go' } },
    ]);

    // Hero pinned by type; CTA carries no pin flag so keeps its existing pin
    expect(body.root.props._pinMap).toEqual({ 'hero-1': true, 'cta-1': true });

    const versions = await sql<{
      snapshot: { content: unknown[]; root: { props: { _pinMap: Record<string, boolean> } } };
    }[]>`
      SELECT snapshot FROM app.document_versions
      WHERE document_id = ${docId} AND branch_id = ${mainBranchId}
      ORDER BY version_number DESC
      LIMIT 1
    `;
    expect(versions[0].snapshot.content).toEqual([
      { type: 'Hero', props: { id: 'hero-1', title: 'Hello' } },
      { type: 'CTA', props: { id: 'cta-1', label: 'Go' } },
    ]);
    expect(versions[0].snapshot.root.props._pinMap).toEqual({ 'hero-1': true, 'cta-1': true });
  });

  it('leaves _pinMap unchanged on a metadata PATCH without components', async () => {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');

    const docId = await seedTemplateDocument('content-no-components-patch', {
      content: [{ type: 'Hero', props: { id: 'hero-1', title: 'Hello' } }],
      root: {
        props: {
          _template: { label: 'No Components', deprecated: false },
          _pinMap: { 'hero-1': true },
        },
      },
      zones: {},
    });

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/templates/${docId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Added' }),
      },
    );

    const response = await handleTemplateRequest(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      templateId: docId,
      principal: adminPrincipal(),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.root.props._pinMap).toEqual({ 'hero-1': true });

    const versions = await sql<{ snapshot: { root: { props: { _pinMap: Record<string, boolean> } } } }[]>`
      SELECT snapshot FROM app.document_versions
      WHERE document_id = ${docId} AND branch_id = ${mainBranchId}
      ORDER BY version_number DESC
      LIMIT 1
    `;
    expect(versions[0].snapshot.root.props._pinMap).toEqual({ 'hero-1': true });
  });
});
