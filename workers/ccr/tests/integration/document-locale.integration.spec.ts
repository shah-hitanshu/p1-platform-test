/**
 * Document locale - Integration Tests
 *
 * A document's locale records the language it holds, and a source document may name
 * one: what makes a document a translation is the localization edge it sources, not
 * the presence of a locale. So a source page tagged `en` still reads as the
 * canonical of its variants, and tagging it does not give it an authority map.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { createRealDatabaseConnection, deleteSiteCascade } from '../helpers/database';

import { createSite } from '../../src/services/site-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import { updateDocumentFields } from '../../src/services/document-service';
import { InvalidLocaleError } from '../../src/services/errors';
import {
  createTranslation,
  listLocaleVariants,
} from '../../src/services/create-translation-service';
import { getLocalizationEdgeBySource } from '../../src/services/relations-service';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'document-locale-test';

function makeSnapshot(): Record<string, unknown> {
  return {
    content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title: 'Hello' } }],
    root: { props: { title: 'Test' } },
    zones: {},
  };
}

describe('Document locale - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let mainBranchId: string;
  let sourceId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'document-locale-test@example.com', 'Document Locale User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Document Locale Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    mainBranchId = branches[0].id as string;

    const source = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: 'pages/home',
      snapshot: makeSnapshot(),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    sourceId = source.document.id;
  });

  afterAll(async () => {
    await deleteSiteCascade(sql, siteId);
    await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    await sql.end();
    setDatabaseInstance(null);
  });

  it('creates a document with no locale', async () => {
    const rows = await sql`SELECT locale FROM app.documents WHERE id = ${sourceId}`;
    expect(rows[0].locale).toBeNull();
  });

  it('records the language a source document was authored in', async () => {
    const updated = await updateDocumentFields(sourceId, { locale: 'en' });
    expect(updated?.locale).toBe('en');

    const rows = await sql`SELECT locale FROM app.documents WHERE id = ${sourceId}`;
    expect(rows[0].locale).toBe('en');
  });

  it('leaves a tagged source document the canonical of its variants', async () => {
    const translation = await createTranslation({
      canonicalDocumentId: sourceId,
      branchId: mainBranchId,
      locale: 'fr-FR',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const listing = await listLocaleVariants(sourceId, mainBranchId);
    expect(listing.canonical.id).toBe(sourceId);
    expect(listing.canonical.locale).toBe('en');
    expect(listing.variants.map((variant) => variant.document.id)).toContain(
      translation.document.id,
    );

    // The edge, not the locale, is what makes a document a translation.
    expect(await getLocalizationEdgeBySource(sourceId)).toBeNull();
    expect(await getLocalizationEdgeBySource(translation.document.id)).not.toBeNull();
  });

  it('clears a locale when null is written', async () => {
    const cleared = await updateDocumentFields(sourceId, { locale: null });
    expect(cleared?.locale).toBeUndefined();

    const rows = await sql`SELECT locale FROM app.documents WHERE id = ${sourceId}`;
    expect(rows[0].locale).toBeNull();

    await updateDocumentFields(sourceId, { locale: 'en' });
  });

  it('rejects a malformed language tag', async () => {
    await expect(updateDocumentFields(sourceId, { locale: 'not a locale' })).rejects.toThrow(
      InvalidLocaleError,
    );

    const rows = await sql`SELECT locale FROM app.documents WHERE id = ${sourceId}`;
    expect(rows[0].locale).toBe('en');
  });

  it('updates a path and a locale in one write', async () => {
    const updated = await updateDocumentFields(sourceId, { path: 'pages/accueil', locale: 'fr-FR' });
    expect(updated?.path).toBe('pages/accueil');
    expect(updated?.locale).toBe('fr-FR');
  });

  it('returns null for a document that does not exist', async () => {
    const missing = await updateDocumentFields('00000000-0000-0000-0000-000000000000', {
      locale: 'en',
    });
    expect(missing).toBeNull();
  });
});
