/**
 * Slot authority defaults - Integration Tests
 *
 * Resolves a translation's per-slot authority defaults from the template bound to
 * its canonical, read from whichever branch holds the template. A canonical with
 * no template declares no slots, and a slot storing a value that is not an
 * authority is not served as one.
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
import { resolveSlotAuthorityDefaults } from '../../src/services/localization-enforcement-service';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'authority-defaults-test';

const HEADING = {
  type: 'HeadingBlock',
  props: { id: 'HeadingBlock-1', title: 'Hello', level: 'h1' },
};
const IMAGE = { type: 'ImageBlock', props: { id: 'ImageBlock-1', src: '/a.jpg', alt: 'A' } };

function makeSnapshot(components: unknown[]): Record<string, unknown> {
  return { content: components, root: { props: { title: 'Test' } }, zones: {} };
}

function makeTemplateSnapshot(authority: Record<string, unknown>): Record<string, unknown> {
  return {
    content: [HEADING, IMAGE],
    root: { props: { title: 'Template', _pinMap: {}, _localeAuthority: authority } },
    zones: {},
  };
}

describe('Slot authority defaults - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let mainBranchId: string;
  let featureBranchId: string;
  let templatedCanonicalId: string;
  let untemplatedCanonicalId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'authority-defaults-test@example.com', 'Authority Defaults User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Authority Defaults Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    mainBranchId = branches[0].id as string;

    // A template on main declaring one locale-owned slot and one canonical-owned.
    const templateDoc = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: 'templates/page',
      snapshot: makeTemplateSnapshot({
        'HeadingBlock-1': 'locale',
        'ImageBlock-1': 'canonical',
      }),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const templatedCanonical = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: 'pages/templated',
      snapshot: makeSnapshot([HEADING, IMAGE]),
      templateId: templateDoc.document.id,
      templateVersion: 1,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    templatedCanonicalId = templatedCanonical.document.id;

    const untemplatedCanonical = await createDocumentOnBranch({
      siteId,
      branchId: mainBranchId,
      path: 'pages/untemplated',
      snapshot: makeSnapshot([HEADING, IMAGE]),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    untemplatedCanonicalId = untemplatedCanonical.document.id;

    const featureBranch = await createBranch({
      siteId,
      name: 'feature',
      sourceBranchId: mainBranchId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    featureBranchId = featureBranch.id;
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

  it("serves the per-slot authority the canonical's template declares", async () => {
    const { slotDefaults, defaultAuthority } = await resolveSlotAuthorityDefaults(
      templatedCanonicalId,
      mainBranchId,
    );

    expect(slotDefaults).toEqual({
      'HeadingBlock-1': 'locale',
      'ImageBlock-1': 'canonical',
    });
    expect(defaultAuthority).toBe('canonical');
  });

  it('reads the template inherited from main on a branch that has not edited it', async () => {
    const { slotDefaults } = await resolveSlotAuthorityDefaults(
      templatedCanonicalId,
      featureBranchId,
    );

    expect(slotDefaults).toEqual({
      'HeadingBlock-1': 'locale',
      'ImageBlock-1': 'canonical',
    });
  });

  it('declares no slots for a canonical with no template', async () => {
    const { slotDefaults, defaultAuthority } = await resolveSlotAuthorityDefaults(
      untemplatedCanonicalId,
      mainBranchId,
    );

    expect(slotDefaults).toEqual({});
    expect(defaultAuthority).toBe('canonical');
  });

});
