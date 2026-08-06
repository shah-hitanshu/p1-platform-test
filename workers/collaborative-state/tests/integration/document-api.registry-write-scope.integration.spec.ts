/**
 * Document API — write:registry Scope Path Guard Tests (§0)
 *
 * A `sat_` site token scoped to `write:registry` may create documents and
 * document versions under `_registry/components/*` (and the registry index)
 * on any branch, and nothing else: not other paths, not publish, not
 * site-scoped restore, not site-scoped create. Mirrors the shape of
 * document-api.template-path-guard.integration.spec.ts, but exercises a
 * service principal instead of role-based users.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import type { AuthenticatedPrincipal } from '../../src/types';
import { readJson } from '../helpers/http';

const TEST_DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

let sql: ReturnType<typeof postgres>;
let testSiteId: string;
let mainBranchId: string;

function registryServicePrincipal(scopes: string[] = ['write:registry']): AuthenticatedPrincipal {
  return {
    id: '99999999-9999-9999-9999-999999999999',
    type: 'service',
    pantheonSiteRoles: {},
    tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
    scopes,
    siteId: testSiteId,
    authProvider: 'site_token',
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

  // Clean up stale data from previous failed runs
  const staleData = await sql<{ id: string }[]>`
    SELECT id FROM app.sites WHERE pantheon_site_id = 'test-registry-write-scope-site'
  `;
  if (staleData.length > 0) {
    const staleSiteId = staleData[0].id;
    await sql`DELETE FROM app.checkpoint_documents WHERE document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${staleSiteId}
    )`;
    await sql`DELETE FROM app.checkpoints WHERE branch_id IN (
      SELECT id FROM app.branches WHERE site_id = ${staleSiteId}
    )`;
    await sql`DELETE FROM app.document_relations WHERE source_document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${staleSiteId}
    ) OR target_document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${staleSiteId}
    )`;
    await sql`DELETE FROM app.document_versions WHERE document_id IN (
      SELECT id FROM app.documents WHERE site_id = ${staleSiteId}
    )`;
    await sql`DELETE FROM app.documents WHERE site_id = ${staleSiteId}`;
    await sql`DELETE FROM app.branches WHERE site_id = ${staleSiteId}`;
    await sql`DELETE FROM app.sites WHERE id = ${staleSiteId}`;
  }

  const site = await sql<{ id: string }[]>`
    INSERT INTO app.sites (pantheon_site_id, name)
    VALUES ('test-registry-write-scope-site', 'Test Registry Write Scope Site')
    RETURNING id
  `;
  testSiteId = site[0].id;

  const mainBranch = await sql<{ id: string }[]>`
    INSERT INTO app.branches (site_id, name, is_main, created_by_id, created_by_type)
    VALUES (${testSiteId}, 'main', true, '00000000-0000-0000-0000-000000000000', 'system')
    RETURNING id
  `;
  mainBranchId = mainBranch[0].id;
});

afterAll(async () => {
  try {
    if (testSiteId) {
      await sql`DELETE FROM app.checkpoint_documents WHERE document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${testSiteId}
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
      await sql`DELETE FROM app.branches WHERE site_id = ${testSiteId}`;
      await sql`DELETE FROM app.sites WHERE id = ${testSiteId}`;
    }
  } catch {
    // Ignore cleanup errors
  }

  setDatabaseInstance(null);
  await sql.end();
});

describe('Document API - write:registry Scope Path Guard', () => {
  it('allows a write:registry service principal to create a document under _registry/components/', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '_registry/components/hero',
          snapshot: { name: 'Hero', defaultProps: {} },
        }),
      },
    );

    const response = await handleDocumentRoutes(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: registryServicePrincipal(),
    });

    expect(response.status).toBe(201);
    const body = await readJson(response);
    expect(body.document.path).toBe('_registry/components/hero');

    const versions = await sql<{ created_by_type: string; created_by_id: string }[]>`
      SELECT created_by_type, created_by_id FROM app.document_versions
      WHERE document_id = ${body.document.id as string}
    `;
    expect(versions.length).toBe(1);
    expect(versions[0].created_by_type).toBe('system');
  });

  it('allows a write:registry service principal to create the registry index document', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '_registry/index',
          snapshot: { components: [] },
        }),
      },
    );

    const response = await handleDocumentRoutes(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: registryServicePrincipal(),
    });

    expect(response.status).toBe(201);
    const body = await readJson(response);
    expect(body.document.path).toBe('_registry/index');
  });

  it('allows a write:registry service principal to create a version on an existing registry component', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const createRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '_registry/components/footer',
          snapshot: { name: 'Footer', defaultProps: {} },
        }),
      },
    );
    const createResponse = await handleDocumentRoutes(createRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: registryServicePrincipal(),
    });
    const createBody = await createResponse.json();
    const documentId = createBody.document.id as string;

    const versionRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents/${documentId}/versions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot: { name: 'Footer', defaultProps: { columns: 3 } },
        }),
      },
    );

    const response = await handleDocumentRoutes(versionRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      documentId,
      versionsPath: true,
      principal: registryServicePrincipal(),
    });

    expect(response.status).toBe(201);

    const versions = await sql<{ created_by_type: string; version_number: number }[]>`
      SELECT created_by_type, version_number FROM app.document_versions
      WHERE document_id = ${documentId}
      ORDER BY version_number DESC
    `;
    expect(versions.length).toBe(2);
    expect(versions[0].created_by_type).toBe('system');
  });

  it('denies a write:registry service principal from creating a document outside _registry/components/', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'pages/home',
          snapshot: { title: 'Home' },
        }),
      },
    );

    const response = await handleDocumentRoutes(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: registryServicePrincipal(),
    });

    expect(response.status).toBe(403);
    const body = await readJson(response);
    expect(body.error).toContain('write:registry');

    const docs = await sql<{ path: string }[]>`
      SELECT path FROM app.documents WHERE site_id = ${testSiteId} AND path = 'pages/home'
    `;
    expect(docs.length).toBe(0);
  });

  it('denies a write:registry service principal from creating a document at _registry/templates/* (privilege escalation boundary)', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '_registry/templates/sneaky-template',
          snapshot: { name: 'sneaky-template', label: 'Sneaky', components: [] },
        }),
      },
    );

    const response = await handleDocumentRoutes(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: registryServicePrincipal(),
    });

    expect(response.status).toBe(403);
    const body = await readJson(response);
    // Must be denied by the write:registry path guard specifically, not by
    // getEffectiveRole's generic service-principal refusal — those two
    // failure modes are indistinguishable by status code alone.
    expect(body.error).toContain('write:registry');

    const docs = await sql<{ path: string }[]>`
      SELECT path FROM app.documents WHERE site_id = ${testSiteId} AND path = '_registry/templates/sneaky-template'
    `;
    expect(docs.length).toBe(0);
  });

  it('denies a write:registry service principal from creating a version outside _registry/components/', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const seedDoc = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path)
      VALUES (${testSiteId}, 'pages/other')
      RETURNING id
    `;
    const documentId = seedDoc[0].id;
    await sql`
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot, source, created_by_id, created_by_type
      )
      VALUES (
        ${documentId}, ${mainBranchId}, 1, ${JSON.stringify({ title: 'Other' })},
        'edit', '00000000-0000-0000-0000-000000000000', 'user'
      )
    `;

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents/${documentId}/versions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: { title: 'Other v2' } }),
      },
    );

    const response = await handleDocumentRoutes(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      documentId,
      versionsPath: true,
      principal: registryServicePrincipal(),
    });

    expect(response.status).toBe(403);
    const body = await readJson(response);
    expect(body.error).toContain('write:registry');

    const versions = await sql<{ id: string }[]>`
      SELECT id FROM app.document_versions WHERE document_id = ${documentId}
    `;
    expect(versions.length).toBe(1);
  });

  it('denies a write:registry service principal from publishing any document', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const createRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '_registry/components/publish-target',
          snapshot: { name: 'PublishTarget', defaultProps: {} },
        }),
      },
    );
    const createResponse = await handleDocumentRoutes(createRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      principal: registryServicePrincipal(),
    });
    const createBody = await createResponse.json();
    const documentId = createBody.document.id as string;

    const publishRequest = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents/${documentId}/publish`,
      { method: 'POST' },
    );

    const response = await handleDocumentRoutes(publishRequest, {
      siteId: testSiteId,
      branchId: mainBranchId,
      documentId,
      action: 'publish',
      principal: registryServicePrincipal(),
    });

    expect(response.status).toBe(403);
    const body = await readJson(response);
    expect(body.error).toContain('write:registry');
  });

  it('denies a write:registry service principal from restoring a document (site-scoped)', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const seedDoc = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path, archived_at)
      VALUES (${testSiteId}, '_registry/components/to-restore', NOW())
      RETURNING id
    `;
    const documentId = seedDoc[0].id;

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/documents/${documentId}/restore`,
      { method: 'POST' },
    );

    const response = await handleDocumentRoutes(request, {
      siteId: testSiteId,
      documentId,
      action: 'restore',
      principal: registryServicePrincipal(),
    });

    expect(response.status).toBe(403);
    const body = await readJson(response);
    expect(body.error).toContain('write:registry');

    const docs = await sql<{ archived_at: string | null }[]>`
      SELECT archived_at FROM app.documents WHERE id = ${documentId}
    `;
    expect(docs[0].archived_at).not.toBeNull();
  });

  it('denies a write:registry service principal from using the site-scoped (no branch) create endpoint', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '_registry/components/site-scoped-attempt' }),
      },
    );

    const response = await handleDocumentRoutes(request, {
      siteId: testSiteId,
      principal: registryServicePrincipal(),
    });

    expect(response.status).toBe(403);
    const body = await readJson(response);
    expect(body.error).toContain('write:registry');

    const docs = await sql<{ path: string }[]>`
      SELECT path FROM app.documents WHERE site_id = ${testSiteId} AND path = '_registry/components/site-scoped-attempt'
    `;
    expect(docs.length).toBe(0);
  });

  it('does not block GET requests for a service principal that also holds a read scope', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');

    const seedDoc = await sql<{ id: string }[]>`
      INSERT INTO app.documents (site_id, path)
      VALUES (${testSiteId}, '_registry/components/read-check')
      RETURNING id
    `;
    const documentId = seedDoc[0].id;
    await sql`
      INSERT INTO app.document_versions (
        document_id, branch_id, version_number, snapshot, source, created_by_id, created_by_type
      )
      VALUES (
        ${documentId}, ${mainBranchId}, 1, ${JSON.stringify({ name: 'ReadCheck' })},
        'edit', '00000000-0000-0000-0000-000000000000', 'system'
      )
    `;

    const request = new Request(
      `https://api.example.com/api/sites/${testSiteId}/branches/${mainBranchId}/documents/${documentId}`,
      { method: 'GET' },
    );

    // The deny-by-default registry guard only governs POST — a token that also
    // carries a read scope must not have its GETs swallowed by it.
    const response = await handleDocumentRoutes(request, {
      siteId: testSiteId,
      branchId: mainBranchId,
      documentId,
      principal: registryServicePrincipal(['write:registry', 'read:draft']),
    });

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.path).toBe('_registry/components/read-check');
  });
});
