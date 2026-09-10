/**
 * Upstream-resolution routes - Integration Tests
 *
 * Drives the HTTP upstream-resolution routes through handleDocumentRoutes against a
 * real PostgreSQL database and real authorization, so a route records the canonical
 * value behind the version it was given and an agent's service token reaches the
 * same writes an editor does.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { createRealDatabaseConnection, deleteSiteCascade } from '../helpers/database';
import { readJson } from '../helpers/http';
import type { AuthenticatedPrincipal } from '../../src/types';

import { createSite } from '../../src/services/site-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import { createDocumentVersion } from '../../src/services/document-version-service';
import { createTranslation } from '../../src/services/create-translation-service';
import { createBranch } from '../../src/services/branch-service';
import { publishDocument } from '../../src/services/checkpoint-publish';
import { handleDocumentRoutes } from '../../src/routes/document-api';
import type { DocumentRouteContext } from '../../src/routes/document-api';

const EDITOR_USER_ID = '79797979-7979-7979-7979-797979797979';
const SITE_PREFIX = 'resolution-route-test';

const HEADING = {
  type: 'HeadingBlock',
  props: { id: 'HeadingBlock-1', title: 'Hello', subtitle: 'Hi' },
};

function makeSnapshot(title: string, subtitle: string): Record<string, unknown> {
  return {
    content: [{ type: 'HeadingBlock', props: { ...HEADING.props, title, subtitle } }],
    root: { props: { title: 'Test' } },
    zones: {},
  };
}

describe('Upstream-resolution routes - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let branchId: string;
  let canonicalId: string;
  let translationId: string;
  let plainDocumentId: string;
  let editor: AuthenticatedPrincipal;

  const url = (documentId: string, on = branchId): string =>
    `https://api.example.com/api/sites/${siteId}/branches/${on}/documents/${documentId}/upstream-resolutions`;

  const routeContext = (
    documentId: string,
    principal: AuthenticatedPrincipal = editor,
    on = branchId,
  ): DocumentRouteContext => ({
    siteId,
    branchId: on,
    documentId,
    action: 'upstream-resolutions' as const,
    principal,
  });

  const request = async (
    documentId: string,
    method: 'GET' | 'PUT' | 'DELETE' | 'POST',
    body?: Record<string, unknown>,
    principal?: AuthenticatedPrincipal,
    on = branchId,
  ): Promise<Response> =>
    handleDocumentRoutes(
      new Request(url(documentId, on), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      routeContext(documentId, principal, on),
    );

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${EDITOR_USER_ID}, 'resolution-route-editor@example.com', 'Resolution Route Editor')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Resolution Route Test Site',
      creatorId: EDITOR_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
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
      email: 'resolution-route-editor@example.com',
      pantheonSiteRoles: { [siteId]: 'developer' },
      tokenExpiry: '2026-12-31T23:59:59.000Z',
    };

    const canonical = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'pages/home',
      snapshot: makeSnapshot('Hello', 'Hi'),
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

    const plain = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'pages/plain',
      snapshot: makeSnapshot('Hello', 'Hi'),
      createdById: EDITOR_USER_ID,
      createdByType: 'user',
    });
    plainDocumentId = plain.document.id;
  });

  afterAll(async () => {
    await deleteSiteCascade(sql, siteId);
    await sql`DELETE FROM app.users WHERE id = ${EDITOR_USER_ID}`;
    await sql.end();
    setDatabaseInstance(null);
  });

  /** The id of the canonical's current version on this branch. */
  const canonicalVersionId = async (): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM app.document_versions
       WHERE document_id = ${canonicalId} AND branch_id = ${branchId}
       ORDER BY version_number DESC
       LIMIT 1
    `;
    return rows[0].id;
  };

  /** A PUT body settling one change against the version the caller was shown. */
  const settle = async (
    slotId: string,
    propPath: string,
  ): Promise<Record<string, unknown>> => ({
    targets: [{ slotId, propPath }],
    upstreamVersionId: await canonicalVersionId(),
  });

  /** A settled change, whose fingerprint these tests treat as opaque. */
  const mark = { hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), at: expect.any(String) };

  const clear = (slotId: string, propPath: string): Record<string, unknown> => ({
    targets: [{ slotId, propPath }],
  });

  const readStoredResolutions = async (): Promise<Record<string, unknown> | undefined> => {
    const rows = await sql`
      SELECT resolutions FROM app.document_relation_branch_resolutions
       WHERE source_document_id = ${translationId}
         AND relation_type = 'localization' AND branch_id = ${branchId}
    `;
    return rows[0]?.resolutions as Record<string, unknown> | undefined;
  };

  beforeEach(async () => {
    await sql`
      UPDATE app.document_relations SET metadata = '{}'::jsonb
       WHERE source_document_id = ${translationId} AND relation_type = 'localization'
    `;
    await sql`
      DELETE FROM app.document_relation_branch_resolutions
       WHERE source_document_id = ${translationId}
    `;
  });

  it('round-trips a resolution through PUT, GET, and the stored row', async () => {
    const before = await request(translationId, 'GET');
    expect(before.status).toBe(200);
    expect((await readJson(before)).upstreamResolutions).toEqual({});

    const put = await request(translationId, 'PUT', await settle('HeadingBlock-1', '/title'));
    expect(put.status).toBe(200);
    expect((await readJson(put)).upstreamResolutions).toEqual({
      'HeadingBlock-1': { '/title': mark },
    });

    const get = await request(translationId, 'GET');
    expect((await readJson(get)).upstreamResolutions).toEqual({
      'HeadingBlock-1': { '/title': mark },
    });

    expect(await readStoredResolutions()).toEqual({
      'HeadingBlock-1': { '/title': mark },
    });
  });

  it('records the value at the version the caller names, not the canonical latest', async () => {
    const shown = await canonicalVersionId();
    const settledAgainst = await request(translationId, 'PUT', {
      targets: [{ slotId: 'HeadingBlock-1', propPath: '/title' }],
      upstreamVersionId: shown,
    });
    const recorded = (await readJson(settledAgainst)).upstreamResolutions as Record<
      string,
      Record<string, { hash: string }>
    >;

    await sql`
      DELETE FROM app.document_relation_branch_resolutions
       WHERE source_document_id = ${translationId}
    `;
    await createDocumentVersion({
      documentId: canonicalId,
      branchId,
      snapshot: makeSnapshot('Hello again', 'Hi'),
      source: 'edit',
      createdById: EDITOR_USER_ID,
      createdByType: 'user',
    });

    const put = await request(translationId, 'PUT', {
      targets: [{ slotId: 'HeadingBlock-1', propPath: '/title' }],
      upstreamVersionId: shown,
    });
    const after = (await readJson(put)).upstreamResolutions as Record<
      string,
      Record<string, { hash: string }>
    >;

    // The canonical moved that prop on after the caller was shown it; settling
    // records the value they saw, so the newer change stays outstanding.
    expect(after['HeadingBlock-1']['/title'].hash).toBe(
      recorded['HeadingBlock-1']['/title'].hash,
    );
  });

  it('refuses a version of some other document', async () => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM app.document_versions
       WHERE document_id = ${plainDocumentId}
       ORDER BY version_number DESC
       LIMIT 1
    `;

    const response = await request(translationId, 'PUT', {
      targets: [{ slotId: 'HeadingBlock-1', propPath: '/title' }],
      upstreamVersionId: rows[0].id,
    });

    expect(response.status).toBe(400);
  });

  it('refuses a version id naming nothing', async () => {
    const response = await request(translationId, 'PUT', {
      targets: [{ slotId: 'HeadingBlock-1', propPath: '/title' }],
      upstreamVersionId: '11111111-1111-1111-1111-111111111111',
    });

    expect(response.status).toBe(400);
  });

  it('settles every target named in one request', async () => {
    const put = await request(translationId, 'PUT', {
      targets: [
        { slotId: 'HeadingBlock-1', propPath: '/title' },
        { slotId: '__root__', propPath: '/title' },
      ],
      upstreamVersionId: await canonicalVersionId(),
    });

    expect(put.status).toBe(200);
    expect((await readJson(put)).upstreamResolutions).toEqual({
      'HeadingBlock-1': { '/title': mark },
      __root__: { '/title': mark },
    });
  });

  it('settles nothing when one named slot is not on the canonical', async () => {
    const response = await request(translationId, 'PUT', {
      targets: [
        { slotId: 'HeadingBlock-1', propPath: '/title' },
        { slotId: 'HeadingBlock-gone', propPath: '/title' },
      ],
      upstreamVersionId: await canonicalVersionId(),
    });

    expect(response.status).toBe(400);
    expect(await readStoredResolutions()).toBeUndefined();
  });

  it('clears a resolution via DELETE and prunes the emptied slot', async () => {
    await request(translationId, 'PUT', await settle('HeadingBlock-1', '/title'));

    const deleted = await request(translationId, 'DELETE', clear('HeadingBlock-1', '/title'));

    expect(deleted.status).toBe(200);
    expect((await readJson(deleted)).upstreamResolutions).toEqual({});
  });

  it('takes a resolution from a service token', async () => {
    const agent: AuthenticatedPrincipal = {
      id: '99999999-9999-9999-9999-999999999999',
      type: 'service',
      pantheonSiteRoles: {},
      tokenExpiry: '2026-12-31T23:59:59.000Z',
      scopes: ['write:content'],
      siteId,
      authProvider: 'site_token',
    };

    const put = await request(
      translationId,
      'PUT',
      await settle('HeadingBlock-1', '/subtitle'),
      agent,
    );

    expect(put.status).toBe(200);
    expect((await readJson(put)).upstreamResolutions).toEqual({
      'HeadingBlock-1': { '/subtitle': mark },
    });
  });

  it('settles one change without settling its siblings on the same field', async () => {
    await request(translationId, 'PUT', await settle('HeadingBlock-1', '/badge/label'));

    const put = await request(translationId, 'PUT', await settle('HeadingBlock-1', '/badge/color'));

    const stored = (await readJson(put)).upstreamResolutions as Record<
      string,
      Record<string, unknown>
    >;
    // jsonb does not keep insertion order, so compare the set of settled changes.
    expect(Object.keys(stored['HeadingBlock-1']).sort()).toEqual([
      '/badge/color',
      '/badge/label',
    ]);
  });

  it('refuses a slot the canonical no longer holds', async () => {
    const response = await request(translationId, 'PUT', await settle('HeadingBlock-gone', '/title'));

    expect(response.status).toBe(400);
  });

  it('clears a resolution left behind by a slot the canonical no longer holds', async () => {
    await sql`
      INSERT INTO app.document_relation_branch_resolutions
        (source_document_id, relation_type, branch_id, resolutions)
      VALUES (${translationId}, 'localization', ${branchId},
        ${sql.json({
    'HeadingBlock-gone': { '/title': { hash: 'sha256:gone', at: '2026-01-01T00:00:00.000Z' } },
  })})
    `;

    const response = await request(translationId, 'DELETE', clear('HeadingBlock-gone', '/title'));

    expect(response.status).toBe(200);
    expect((await readJson(response)).upstreamResolutions).toEqual({});
  });

  it('records a page prop against the reserved root slot', async () => {
    const put = await request(translationId, 'PUT', await settle('__root__', '/title'));

    expect(put.status).toBe(200);
    expect((await readJson(put)).upstreamResolutions).toEqual({
      __root__: { '/title': mark },
    });
  });

  it('serves a branch holding no version of the translation', async () => {
    await publishDocument({
      siteId,
      branchId,
      documentId: canonicalId,
      createdById: EDITOR_USER_ID,
      createdByType: 'user',
    });
    const other = await createBranch({
      siteId,
      name: `cow-${String(Date.now())}`,
      sourceBranchId: branchId,
      createdById: EDITOR_USER_ID,
      createdByType: 'user',
    });

    const read = await request(translationId, 'GET', undefined, undefined, other.id);
    expect(read.status).toBe(200);

    const rows = await sql<{ id: string }[]>`
      SELECT id FROM app.document_versions
       WHERE document_id = ${canonicalId} AND branch_id = ${branchId}
       ORDER BY version_number DESC
       LIMIT 1
    `;
    const put = await request(
      translationId,
      'PUT',
      {
        targets: [{ slotId: 'HeadingBlock-1', propPath: '/title' }],
        upstreamVersionId: rows[0].id,
      },
      undefined,
      other.id,
    );

    expect(put.status).toBe(200);
    expect((await readJson(put)).upstreamResolutions).toEqual({
      'HeadingBlock-1': { '/title': mark },
    });
  });

  it('rejects a document belonging to another site', async () => {
    const otherSite = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-other-${String(Date.now())}`,
      name: 'Other Site',
      creatorId: EDITOR_USER_ID,
    });
    const foreign = await createDocumentOnBranch({
      siteId: otherSite.id,
      branchId: (
        await sql`SELECT id FROM app.branches WHERE site_id = ${otherSite.id} AND is_main = true`
      )[0].id as string,
      path: 'pages/foreign',
      snapshot: makeSnapshot('Hello', 'Hi'),
      createdById: EDITOR_USER_ID,
      createdByType: 'user',
    });

    const response = await request(foreign.document.id, 'GET');

    expect(response.status).toBe(404);
    await deleteSiteCascade(sql, otherSite.id);
  });

  it('rejects a document that is not a translation', async () => {
    const response = await request(plainDocumentId, 'GET');
    expect(response.status).toBe(404);
  });

  it('rejects a method the route does not serve', async () => {
    const response = await request(translationId, 'POST', clear('HeadingBlock-1', '/title'));
    expect(response.status).toBe(405);
  });

  it('rejects a body that names no prop', async () => {
    const response = await request(translationId, 'PUT', {
      targets: [{ slotId: 'HeadingBlock-1' }],
      upstreamVersionId: await canonicalVersionId(),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a body naming no version', async () => {
    const response = await request(translationId, 'PUT', {
      targets: [{ slotId: 'HeadingBlock-1', propPath: '/title' }],
    });
    expect(response.status).toBe(400);
  });
});
