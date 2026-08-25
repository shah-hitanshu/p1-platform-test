/**
 * Authority-override routes - Integration Tests
 *
 * Drives the HTTP authority-override routes through handleDocumentRoutes against a
 * real PostgreSQL database and real authorization, so a route reads and writes the
 * per-prop authority map an editor actually stores.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { createRealDatabaseConnection } from '../helpers/database';
import { readJson } from '../helpers/http';
import type { AuthenticatedPrincipal } from '../../src/types';

import { createSite } from '../../src/services/site-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import { createTranslation } from '../../src/services/create-translation-service';
import { handleDocumentRoutes } from '../../src/routes/document-api';
import type { DocumentRouteContext } from '../../src/routes/document-api';

const EDITOR_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'authority-route-test';

const HEADING = { type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title: 'Hello', level: 'h1' } };
const IMAGE = { type: 'ImageBlock', props: { id: 'ImageBlock-1', src: '/a.jpg', alt: 'A' } };

function makeSnapshot(components: unknown[]): Record<string, unknown> {
  return { content: components, root: { props: { title: 'Test' } }, zones: {} };
}

function baseUrl(siteId: string, branchId: string, documentId: string): string {
  return `https://api.example.com/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/authority-overrides`;
}

describe('Authority-override routes - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let branchId: string;
  let canonicalId: string;
  let translationId: string;
  let editor: AuthenticatedPrincipal;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${EDITOR_USER_ID}, 'authority-route-editor@example.com', 'Authority Route Editor')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Authority Route Test Site',
      creatorId: EDITOR_USER_ID,
    });
    siteId = site.id;

    const branches = await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    branchId = branches[0].id as string;

    await sql`
      INSERT INTO app.user_site_roles (user_id, site_id, role, source)
      VALUES (${EDITOR_USER_ID}, ${siteId}, 'developer', 'local')
      ON CONFLICT DO NOTHING
    `;

    editor = {
      id: EDITOR_USER_ID,
      type: 'user',
      dbUserId: EDITOR_USER_ID,
      email: 'authority-route-editor@example.com',
      pantheonSiteRoles: { [siteId]: 'developer' },
      tokenExpiry: '2026-12-31T23:59:59.000Z',
    };

    const canonical = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'pages/home',
      snapshot: makeSnapshot([HEADING, IMAGE]),
      createdById: EDITOR_USER_ID,
      createdByType: 'user',
    });
    canonicalId = canonical.document.id;

    const translation = await createTranslation({
      canonicalDocumentId: canonicalId,
      branchId,
      locale: 'fr-FR',
      createdById: EDITOR_USER_ID,
      createdByType: 'user',
    });
    translationId = translation.document.id;
  });

  afterAll(async () => {
    try {
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
      await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
      await sql`DELETE FROM app.users WHERE id = ${EDITOR_USER_ID}`;
    } catch {
      // Ignore cleanup errors
    }
    await sql.end();
    setDatabaseInstance(null);
  });

  function routeContext(documentId: string): DocumentRouteContext {
    return {
      siteId,
      branchId,
      documentId,
      action: 'authority-overrides' as const,
      principal: editor,
    };
  }

  it('round-trips an override through PUT, GET, and the stored edge', async () => {
    const before = await handleDocumentRoutes(
      new Request(baseUrl(siteId, branchId, translationId), { method: 'GET' }),
      routeContext(translationId),
    );
    expect(before.status).toBe(200);
    expect((await readJson(before)).authorityOverrides).toEqual({});

    const putResponse = await handleDocumentRoutes(
      new Request(baseUrl(siteId, branchId, translationId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 'HeadingBlock-1', propName: 'title', authority: 'locale' }),
      }),
      routeContext(translationId),
    );

    expect(putResponse.status).toBe(200);
    const putBody = await readJson(putResponse);
    expect(putBody.authorityOverrides).toEqual({ 'HeadingBlock-1': { title: 'locale' } });

    const getResponse = await handleDocumentRoutes(
      new Request(baseUrl(siteId, branchId, translationId), { method: 'GET' }),
      routeContext(translationId),
    );
    const getBody = await readJson(getResponse);
    expect(getBody.authorityOverrides).toEqual({ 'HeadingBlock-1': { title: 'locale' } });

    const rows = await sql<{ metadata: Record<string, unknown> }[]>`
      SELECT metadata FROM app.document_relations
      WHERE source_document_id = ${translationId} AND relation_type = 'localization'
    `;
    expect(rows[0].metadata).toEqual({
      authorityOverrides: { 'HeadingBlock-1': { title: 'locale' } },
    });
  });

  it('clears an override via DELETE and prunes the emptied slot', async () => {
    await handleDocumentRoutes(
      new Request(baseUrl(siteId, branchId, translationId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 'ImageBlock-1', propName: 'alt', authority: 'canonical' }),
      }),
      routeContext(translationId),
    );

    const deleteResponse = await handleDocumentRoutes(
      new Request(baseUrl(siteId, branchId, translationId), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 'ImageBlock-1', propName: 'alt' }),
      }),
      routeContext(translationId),
    );

    expect(deleteResponse.status).toBe(200);
    const deleteBody = await readJson(deleteResponse);
    expect(deleteBody.authorityOverrides).not.toHaveProperty('ImageBlock-1');
    expect(deleteBody.authorityOverrides).toEqual({ 'HeadingBlock-1': { title: 'locale' } });
  });
});
