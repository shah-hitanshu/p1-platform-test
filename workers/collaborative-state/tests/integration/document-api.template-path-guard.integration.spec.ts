/**
 * Document API Template Path Guard Tests
 *
 * Tests for PROPOSAL-010 enforcement that prevents non-admin users from
 * creating documents at _registry/templates/* via the document API.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  const staleData = await sql<{ id: string }[]>`SELECT id FROM app.sites WHERE pantheon_site_id = 'test-doc-template-guard-site'`;
  if (staleData.length > 0) {
    const staleSiteId = staleData[0].id;
    await sql`DELETE FROM app.document_relations WHERE source_document_id IN (SELECT id FROM app.documents WHERE site_id = ${staleSiteId}) OR target_document_id IN (SELECT id FROM app.documents WHERE site_id = ${staleSiteId})`;
    await sql`DELETE FROM app.document_versions WHERE document_id IN (SELECT id FROM app.documents WHERE site_id = ${staleSiteId})`;
    await sql`DELETE FROM app.documents WHERE site_id = ${staleSiteId}`;
    await sql`DELETE FROM app.user_site_roles WHERE site_id = ${staleSiteId}`;
    await sql`DELETE FROM app.branches WHERE site_id = ${staleSiteId}`;
    await sql`DELETE FROM app.sites WHERE id = ${staleSiteId}`;
  }
  await sql`DELETE FROM app.users WHERE email IN ('tpg-admin@example.com', 'tpg-editor@example.com', 'tpg-viewer@example.com')`;

  // Create test site
  const site = await sql<{ id: string }[]>`
    INSERT INTO app.sites (pantheon_site_id, name)
    VALUES ('test-doc-template-guard-site', 'Test Document Template Guard Site')
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

  // Create test users with unique emails to avoid collisions
  const adminUser = await sql<{ id: string }[]>`
    INSERT INTO app.users (email, name)
    VALUES ('tpg-admin@example.com', 'Admin User')
    RETURNING id
  `;
  adminUserId = adminUser[0].id;

  const editorUser = await sql<{ id: string }[]>`
    INSERT INTO app.users (email, name)
    VALUES ('tpg-editor@example.com', 'Editor User')
    RETURNING id
  `;
  editorUserId = editorUser[0].id;

  const viewerUser = await sql<{ id: string }[]>`
    INSERT INTO app.users (email, name)
    VALUES ('tpg-viewer@example.com', 'Viewer User')
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
      await sql`DELETE FROM app.sites WHERE id = ${testSiteId}`;
    }
    await sql`DELETE FROM app.users WHERE email IN ('tpg-admin@example.com', 'tpg-editor@example.com', 'tpg-viewer@example.com')`;
  } catch {
    // Ignore cleanup errors
  }

  setDatabaseInstance(null);
  await sql.end();
});

describe('Document API - Template Path Guard', () => {
  it('should allow admin to create documents at _registry/templates/*', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '_registry/templates/admin-doc-template',
          snapshot: {
            name: 'admin-doc-template',
            label: 'Admin Doc Template',
            components: [],
          },
        }),
      },
    );

    const response = await handleDocumentRoutes(request, {
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
    expect(body.document.path).toBe('_registry/templates/admin-doc-template');

    // Verify in database
    const docs = await sql<{ path: string }[]>`
      SELECT path FROM app.documents
      WHERE site_id = ${testSiteId} AND path = '_registry/templates/admin-doc-template'
    `;
    expect(docs.length).toBe(1);
  });

  it('should deny editor from creating documents at _registry/templates/*', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '_registry/templates/editor-attempt',
          snapshot: {
            name: 'editor-attempt',
            label: 'Editor Attempt',
            components: [],
          },
        }),
      },
    );

    const response = await handleDocumentRoutes(request, {
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
    expect(body.error).toContain('template API');
    expect(body.error).toContain('admin');

    // Verify NOT in database
    const docs = await sql<{ path: string }[]>`
      SELECT path FROM app.documents
      WHERE site_id = ${testSiteId} AND path = '_registry/templates/editor-attempt'
    `;
    expect(docs.length).toBe(0);
  });

  it('should deny viewer from creating documents at _registry/templates/*', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '_registry/templates/viewer-attempt',
          snapshot: {
            name: 'viewer-attempt',
            label: 'Viewer Attempt',
            components: [],
          },
        }),
      },
    );

    const response = await handleDocumentRoutes(request, {
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
    const body = await response.json();
    expect(body.error).toContain('template API');

    // Verify NOT in database
    const docs = await sql<{ path: string }[]>`
      SELECT path FROM app.documents
      WHERE site_id = ${testSiteId} AND path = '_registry/templates/viewer-attempt'
    `;
    expect(docs.length).toBe(0);
  });

  it('should allow regular document creation unaffected by guard', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    // Editor can create regular documents (not templates)
    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/pages/homepage',
          snapshot: {
            title: 'Homepage',
            content: 'Welcome to our site',
          },
        }),
      },
    );

    const response = await handleDocumentRoutes(request, {
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

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.document.path).toBe('pages/homepage');

    // Verify in database
    const docs = await sql<{ path: string }[]>`
      SELECT path FROM app.documents
      WHERE site_id = ${testSiteId} AND path = 'pages/homepage'
    `;
    expect(docs.length).toBe(1);
  });

  it('should check templateId parameter and record a template edge', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    // First create a template to reference
    const templateDoc = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path)
      VALUES (${testSiteId}, '_registry/templates/reference-template')
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
        ${JSON.stringify({ name: 'reference-template', label: 'Reference Template', components: [] })},
        'edit', ${adminUserId}, 'user'
      )
    `;

    // Create a document with templateId
    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/pages/templated-page',
          snapshot: {
            title: 'Templated Page',
          },
          templateId: templateId,
          templateVersion: 1,
        }),
      },
    );

    const response = await handleDocumentRoutes(request, {
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

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.document.path).toBe('pages/templated-page');

    // Verify the template edge was recorded in document_relations
    const rels = await sql<{ target_document_id: string; synced_version: number | null }[]>`
      SELECT dr.target_document_id, dr.synced_version
      FROM app.document_relations dr
      JOIN app.documents d ON d.id = dr.source_document_id
      WHERE d.site_id = ${testSiteId}
        AND d.path = 'pages/templated-page'
        AND dr.relation_type = 'template'
    `;
    expect(rels.length).toBe(1);
    expect(rels[0].target_document_id).toBe(templateId);
    expect(rels[0].synced_version).toBe(1);
  });
});
