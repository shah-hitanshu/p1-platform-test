/**
 * Locale-variant listing scope - Integration Tests
 *
 * Documents and localization edges are site-scoped, so the listing is filtered to
 * the branch it was asked about: a variant authored on another branch, and an
 * archived one, are both left out.
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
import { createBranch } from '../../src/services/branch-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import { createDocumentVersion } from '../../src/services/document-version-service';
import {
  createTranslation,
  listLocaleVariants,
} from '../../src/services/create-translation-service';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'variant-scope-test';

const HEADING = {
  type: 'HeadingBlock',
  props: { id: 'HeadingBlock-1', title: 'Hello', level: 'h1' },
};

function makeSnapshot(): Record<string, unknown> {
  return { content: [HEADING], root: { props: { title: 'Test' } }, zones: {} };
}

describe('Locale-variant listing scope - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let mainBranchId: string;
  let featureBranchId: string;
  let canonicalId: string;
  let mainVariantId: string;
  let featureVariantId: string;
  let archivedVariantId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'variant-scope-test@example.com', 'Variant Scope User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Variant Scope Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    mainBranchId = branches[0].id as string;

    const canonical = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: 'pages/home',
      snapshot: makeSnapshot(),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    canonicalId = canonical.document.id;

    const mainVariant = await createTranslation({
      canonicalDocumentId: canonicalId,
      branchId: mainBranchId,
      locale: 'fr-FR',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    mainVariantId = mainVariant.document.id;

    const archivedVariant = await createTranslation({
      canonicalDocumentId: canonicalId,
      branchId: mainBranchId,
      locale: 'es-ES',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    archivedVariantId = archivedVariant.document.id;
    await sql`UPDATE app.documents SET archived_at = NOW() WHERE id = ${archivedVariantId}`;

    const featureBranch = await createBranch({
      siteId,
      name: 'feature',
      sourceBranchId: mainBranchId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    featureBranchId = featureBranch.id;

    // A translation can only be cloned from a canonical version the branch holds,
    // so the feature branch edits the canonical before translating it there.
    await createDocumentVersion({
      documentId: canonicalId,
      branchId: featureBranchId,
      snapshot: makeSnapshot(),
      source: 'edit',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const featureVariant = await createTranslation({
      canonicalDocumentId: canonicalId,
      branchId: featureBranchId,
      locale: 'de-DE',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    featureVariantId = featureVariant.document.id;
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

  it('lists only the variants living on the branch it was asked about', async () => {
    const { variants } = await listLocaleVariants(canonicalId, mainBranchId);

    const ids = variants.map((variant) => variant.document.id);
    expect(ids).toContain(mainVariantId);
    expect(ids).not.toContain(featureVariantId);
  });

  it('lists a variant authored on a branch when asked about that branch', async () => {
    const { variants } = await listLocaleVariants(canonicalId, featureBranchId);

    const ids = variants.map((variant) => variant.document.id);
    expect(ids).toContain(featureVariantId);
  });

  it('leaves out an archived variant', async () => {
    const { variants } = await listLocaleVariants(canonicalId, mainBranchId);

    expect(variants.map((variant) => variant.document.id)).not.toContain(archivedVariantId);
  });

  it('returns the canonical alongside its variants', async () => {
    const { canonical } = await listLocaleVariants(canonicalId, mainBranchId);

    expect(canonical.id).toBe(canonicalId);
  });

  it('carries the localization edge for each listed variant', async () => {
    const { variants } = await listLocaleVariants(canonicalId, mainBranchId);

    const listed = variants.find((variant) => variant.document.id === mainVariantId);
    expect(listed?.localization.targetDocumentId).toBe(canonicalId);
    expect(listed?.localization.relationType).toBe('localization');
  });
});
