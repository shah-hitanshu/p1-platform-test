/**
 * Template API Copy-on-Write Inheritance — Integration Tests
 *
 * A non-main branch inherits templates from main until it edits them locally.
 * These tests cover reading, listing, editing, and deleting a template that
 * lives only on main from a feature branch, and confirm main is unaffected.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';
import { createSite } from '../../src/services/site-service';
import {
  createDocumentOnBranch,
  deleteDocumentOnBranch,
} from '../../src/services/branch-document-service';
import { createDocumentVersion } from '../../src/services/document-version-service';
import type { AuthenticatedPrincipal } from '../../src/types';
import { readJson } from '../helpers/http';

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';
const TEST_USER_ID = '88888888-8888-8888-8888-888888888888';
const SITE_PREFIX = 'template-cow-test';

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

/** A content-shaped template snapshot with the label carried at root.props._template. */
function templateSnapshot(
  label: string,
  content: { type: string; props: Record<string, unknown> }[] = [
    { type: 'HeadingBlock', props: { id: 'heading-1', title: 'Hi', level: 'h1' } },
  ],
): Record<string, unknown> {
  return {
    content,
    root: { props: { _template: { label, deprecated: false }, _pinMap: {} } },
    zones: {},
  };
}

function adminPrincipal(siteId: string): AuthenticatedPrincipal {
  return {
    id: TEST_USER_ID,
    type: 'user',
    dbUserId: TEST_USER_ID,
    email: 'template-cow@example.com',
    pantheonSiteRoles: { [siteId]: 'admin' },
    tokenExpiry: '2026-12-31T23:59:59.000Z',
  };
}

describe('Template API — Copy-on-Write inheritance', () => {
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
      VALUES (${TEST_USER_ID}, 'template-cow@example.com', 'Template COW User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Template COW Site',
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

    // Feature branch off main. Copy-on-write copies no document versions.
    const featureRows = await sql<{ id: string }[]>`
      INSERT INTO app.branches (site_id, name, is_main, source_branch_id, created_by_id, created_by_type)
      VALUES (${siteId}, 'feature', false, ${mainBranchId}, ${TEST_USER_ID}, 'user')
      RETURNING id
    `;
    featureBranchId = featureRows[0].id;
  });

  afterAll(async () => {
    try {
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

  /** Author a template on main only (no version on the feature branch). */
  async function authorTemplateOnMain(name: string, label: string): Promise<string> {
    const result = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: `_registry/templates/${name}`,
      snapshot: templateSnapshot(label),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    return result.document.id;
  }

  async function getTemplate(templateId: string, branchId: string): Promise<Response> {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');
    const request = new Request(
      `https://api.example.com/api/sites/${siteId}/branches/${branchId}/templates/${templateId}`,
      { method: 'GET' },
    );
    return handleTemplateRequest(request, {
      siteId,
      branchId,
      templateId,
      principal: adminPrincipal(siteId),
    });
  }

  async function listTemplates(branchId: string): Promise<Response> {
    const { handleTemplateRequest } = await import('../../src/routes/template-api');
    const request = new Request(
      `https://api.example.com/api/sites/${siteId}/branches/${branchId}/templates`,
      { method: 'GET' },
    );
    return handleTemplateRequest(request, { siteId, branchId, principal: adminPrincipal(siteId) });
  }

  // Component A — read a single inherited template
  describe('GET a single template', () => {
    it('returns an inherited template on a non-main branch', async () => {
      const templateId = await authorTemplateOnMain('inherited-get', 'Inherited Get');

      const response = await getTemplate(templateId, featureBranchId);

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.id).toBe(templateId);
      expect(body.name).toBe('inherited-get');
      expect(body.root.props._template.label).toBe('Inherited Get');
    });

    it('returns the local version when the branch has edited the template', async () => {
      const templateId = await authorTemplateOnMain('locally-edited-get', 'Main Label');
      await createDocumentVersion({
        documentId: templateId,
        branchId: featureBranchId,
        snapshot: templateSnapshot('Branch Label'),
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const response = await getTemplate(templateId, featureBranchId);

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.root.props._template.label).toBe('Branch Label');
    });

    it('still returns 404 for a template that exists on neither branch nor main', async () => {
      const response = await getTemplate('00000000-0000-0000-0000-0000000000ff', featureBranchId);
      expect(response.status).toBe(404);
    });

    it('serves the template on the main branch (behaviour unchanged)', async () => {
      const templateId = await authorTemplateOnMain('main-get', 'Main Get');
      const response = await getTemplate(templateId, mainBranchId);
      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.root.props._template.label).toBe('Main Get');
    });
  });

  // Component B — list inherited templates
  describe('LIST templates', () => {
    it('includes templates authored on main when listing a non-main branch', async () => {
      const templateId = await authorTemplateOnMain('inherited-list', 'Inherited List');

      const response = await listTemplates(featureBranchId);

      expect(response.status).toBe(200);
      const body = await readJson(response);
      const names = (body.templates as { id: string; name: string }[]).map((t) => t.name);
      expect(names).toContain('inherited-list');
      const entry = (body.templates as { id: string; label?: string }[]).find((t) => t.id === templateId);
      expect(entry?.label).toBe('Inherited List');
    });

    it('shows the local version for a template edited on the branch', async () => {
      const templateId = await authorTemplateOnMain('locally-edited-list', 'Main Label');
      await createDocumentVersion({
        documentId: templateId,
        branchId: featureBranchId,
        snapshot: templateSnapshot('Branch Label'),
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const response = await listTemplates(featureBranchId);
      const body = await readJson(response);
      const entry = (body.templates as { id: string; label?: string }[]).find((t) => t.id === templateId);
      expect(entry?.label).toBe('Branch Label');
    });

    it('excludes a template the branch has deleted while main keeps it', async () => {
      const templateId = await authorTemplateOnMain('locally-deleted-list', 'Deleted List');
      await deleteDocumentOnBranch({
        documentId: templateId,
        branchId: featureBranchId,
        deletedById: TEST_USER_ID,
        deletedByType: 'user',
      });

      const featureBody = await (await listTemplates(featureBranchId)).json();
      const featureNames = (featureBody.templates as { name: string }[]).map((t) => t.name);
      expect(featureNames).not.toContain('locally-deleted-list');

      const mainBody = await (await listTemplates(mainBranchId)).json();
      const mainNames = (mainBody.templates as { name: string }[]).map((t) => t.name);
      expect(mainNames).toContain('locally-deleted-list');
    });
  });

  // Component D — edit / delete an inherited template (first copy-on-write write)
  describe('PATCH / DELETE an inherited template', () => {
    async function patchTemplate(
      templateId: string,
      branchId: string,
      body: Record<string, unknown>,
    ): Promise<Response> {
      const { handleTemplateRequest } = await import('../../src/routes/template-api');
      const request = new Request(
        `https://api.example.com/api/sites/${siteId}/branches/${branchId}/templates/${templateId}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      return handleTemplateRequest(request, {
        siteId,
        branchId,
        templateId,
        principal: adminPrincipal(siteId),
      });
    }

    async function deleteTemplate(templateId: string, branchId: string): Promise<Response> {
      const { handleTemplateRequest } = await import('../../src/routes/template-api');
      const request = new Request(
        `https://api.example.com/api/sites/${siteId}/branches/${branchId}/templates/${templateId}`,
        { method: 'DELETE' },
      );
      return handleTemplateRequest(request, {
        siteId,
        branchId,
        templateId,
        principal: adminPrincipal(siteId),
      });
    }

    it('materializes a branch-local version when editing an inherited template', async () => {
      const templateId = await authorTemplateOnMain('inherited-patch', 'Original');

      const response = await patchTemplate(templateId, featureBranchId, { label: 'Edited On Branch' });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.root.props._template.label).toBe('Edited On Branch');

      // A local version now exists on the feature branch.
      const localVersions = await sql`
        SELECT id FROM app.document_versions
        WHERE document_id = ${templateId} AND branch_id = ${featureBranchId}
      `;
      expect(localVersions.length).toBeGreaterThan(0);

      // Main is untouched: still the original label at its latest version.
      const mainResponse = await getTemplate(templateId, mainBranchId);
      const mainBody = await mainResponse.json();
      expect(mainBody.root.props._template.label).toBe('Original');
    });

    it('tombstones an inherited template locally on delete while main keeps it', async () => {
      const templateId = await authorTemplateOnMain('inherited-delete', 'Delete Me');

      const deleteResponse = await deleteTemplate(templateId, featureBranchId);
      expect(deleteResponse.status).toBe(204);

      // Gone on the branch.
      const featureResponse = await getTemplate(templateId, featureBranchId);
      expect(featureResponse.status).toBe(404);

      // Still present on main.
      const mainResponse = await getTemplate(templateId, mainBranchId);
      expect(mainResponse.status).toBe(200);
    });

    it('rejects a migration preview for a template deleted on the branch', async () => {
      const { handleTemplateRequest } = await import('../../src/routes/template-api');
      const templateId = await authorTemplateOnMain('inherited-migrate-deleted', 'Gone');
      await deleteDocumentOnBranch({
        documentId: templateId,
        branchId: featureBranchId,
        deletedById: TEST_USER_ID,
        deletedByType: 'user',
      });

      const request = new Request(
        `https://api.example.com/api/sites/${siteId}/branches/${featureBranchId}/templates/${templateId}/migrate/preview`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      const response = await handleTemplateRequest(request, {
        siteId,
        branchId: featureBranchId,
        templateId,
        action: 'migrate-preview',
        principal: adminPrincipal(siteId),
      });

      expect(response.status).toBe(404);
    });
  });
});
