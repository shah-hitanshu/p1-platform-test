/**
 * Localization enforcement - Integration Tests
 *
 * Composes the pure validator checks with real database reads: a translation's
 * localization edge, its per-prop authority overrides, its current snapshot, and
 * the per-slot defaults its canonical's template declares.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { createRealDatabaseConnection } from '../helpers/database';

import { createSite } from '../../src/services/site-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import { createTranslation } from '../../src/services/create-translation-service';
import { setAuthorityOverride } from '../../src/services/relations-service';
import { evaluateTranslationAuthority } from '../../src/services/localization-enforcement-service';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'enforcement-test';

const HEADING = { type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title: 'Hello', level: 'h1' } };
const IMAGE = { type: 'ImageBlock', props: { id: 'ImageBlock-1', src: '/a.jpg', alt: 'A' } };

function makeSnapshot(components: unknown[]): Record<string, unknown> {
  return { content: components, root: { props: { title: 'Test' } }, zones: {} };
}

function makeAuthorityTemplate(
  authority: Record<string, 'canonical' | 'locale'>,
): Record<string, unknown> {
  return {
    content: [HEADING, IMAGE],
    root: { props: { title: 'Template', _localeAuthority: authority } },
    zones: {},
  };
}

describe('Localization enforcement - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let branchId: string;
  let templatedCanonicalId: string;
  let templatedTranslationId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'enforcement-test@example.com', 'Enforcement Test User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Enforcement Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches = await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    branchId = branches[0].id as string;

    // A template declaring HeadingBlock-1 locale-owned and saying nothing about
    // ImageBlock-1, a canonical bound to it, and a translation of that canonical.
    const template = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'templates/authority',
      snapshot: makeAuthorityTemplate({ 'HeadingBlock-1': 'locale' }),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const templatedCanonical = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'pages/templated',
      snapshot: makeSnapshot([HEADING, IMAGE]),
      templateId: template.document.id,
      templateVersion: 1,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    templatedCanonicalId = templatedCanonical.document.id;

    const templatedTranslation = await createTranslation({
      canonicalDocumentId: templatedCanonicalId,
      branchId,
      locale: 'de-DE',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    templatedTranslationId = templatedTranslation.document.id;
  });

  afterAll(async () => {
    try {
      await sql`DELETE FROM app.document_relations WHERE source_document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${siteId}
      )`;
      await sql`DELETE FROM app.document_versions WHERE document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${siteId}
      )`;
      await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
      await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    } catch {
      // Ignore cleanup errors
    }
    await sql.end();
    setDatabaseInstance(null);
  });

  it('leaves a write alone on a slot the template declares locale-owned', async () => {
    const { diagnostics } = await evaluateTranslationAuthority({
      translationDocumentId: templatedTranslationId,
      branchId,
      operations: [{ type: 'replace', path: 'content.0.props.title', content: 'Hallo' }],
    });

    expect(diagnostics).toEqual([]);
  });

  it('flags a write on a slot the template leaves undeclared', async () => {
    const { diagnostics } = await evaluateTranslationAuthority({
      translationDocumentId: templatedTranslationId,
      branchId,
      operations: [{ type: 'replace', path: 'content.1.props.alt', content: 'Ein Bild' }],
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('canonical_authority_write');
    expect(diagnostics[0].severity).toBe('warning');
    expect(diagnostics[0].slotId).toBe('ImageBlock-1');
    expect(diagnostics[0].propName).toBe('alt');
    expect(diagnostics[0].authority).toBe('canonical');
  });

  it('lets a per-prop override on the edge win over the template default', async () => {
    await setAuthorityOverride(templatedTranslationId, 'ImageBlock-1', 'alt', 'locale');

    const { diagnostics } = await evaluateTranslationAuthority({
      translationDocumentId: templatedTranslationId,
      branchId,
      operations: [{ type: 'replace', path: 'content.1.props.alt', content: 'Ein Bild' }],
    });

    expect(diagnostics).toEqual([]);
  });

  it('returns no diagnostics for a document that is not a translation', async () => {
    const { diagnostics } = await evaluateTranslationAuthority({
      translationDocumentId: templatedCanonicalId,
      branchId,
      operations: [{ type: 'replace', path: 'content.0.props.title', content: 'Hi' }],
    });

    expect(diagnostics).toEqual([]);
  });
});
