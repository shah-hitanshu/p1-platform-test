/**
 * Authority-override ceiling - Integration Tests
 *
 * A translation's authority map holds at most MAX_OVERRIDE_ENTRIES entries. A new
 * entry beyond the ceiling is refused and stores nothing, while replacing an entry
 * already in the map, and clearing one to make room, both stay available.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { createRealDatabaseConnection } from '../helpers/database';

import { createSite } from '../../src/services/site-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import { createTranslation } from '../../src/services/create-translation-service';
import {
  MAX_OVERRIDE_ENTRIES,
  clearAuthorityOverride,
  getAuthorityOverride,
  getAuthorityOverrides,
  setAuthorityOverride,
} from '../../src/services/relations-service';
import { AuthorityOverrideLimitError } from '../../src/services/errors';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'override-cap-test';

const HEADING = {
  type: 'HeadingBlock',
  props: { id: 'HeadingBlock-1', title: 'Hello', level: 'h1' },
};

function makeSnapshot(): Record<string, unknown> {
  return { content: [HEADING], root: { props: { title: 'Test' } }, zones: {} };
}

describe('Authority-override ceiling - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let translationId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'override-cap@example.com', 'Override Cap User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Override Cap Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    const branchId = branches[0].id as string;

    const canonical = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'pages/cap',
      snapshot: makeSnapshot(),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const translation = await createTranslation({
      canonicalDocumentId: canonical.document.id,
      branchId,
      locale: 'fr-FR',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    translationId = translation.document.id;
  });

  afterAll(async () => {
    try {
      await sql`DELETE FROM app.document_relations WHERE source_document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${siteId})`;
      await sql`DELETE FROM app.document_versions WHERE document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${siteId})`;
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

  /** Fills the map to exactly the ceiling, one prop per slot. */
  async function fillToCeiling(): Promise<void> {
    await sql`
      UPDATE app.document_relations
         SET metadata = jsonb_build_object(
           'authorityOverrides',
           (
             SELECT jsonb_object_agg('Slot-' || i, jsonb_build_object('title', 'locale'))
               FROM generate_series(1, ${MAX_OVERRIDE_ENTRIES}) i
           )
         )
       WHERE source_document_id = ${translationId} AND relation_type = 'localization'
    `;
  }

  beforeEach(async () => {
    await sql`
      UPDATE app.document_relations SET metadata = '{}'::jsonb
       WHERE source_document_id = ${translationId} AND relation_type = 'localization'
    `;
  });

  it('accepts a new override while the map is below the ceiling', async () => {
    await setAuthorityOverride(translationId, 'Hero-1', 'title', 'locale');

    expect(await getAuthorityOverride(translationId, 'Hero-1', 'title')).toBe('locale');
  });

  it('refuses a new override once the map is at the ceiling', async () => {
    await fillToCeiling();

    await expect(
      setAuthorityOverride(translationId, 'Beyond-1', 'title', 'locale'),
    ).rejects.toThrow(AuthorityOverrideLimitError);
  });

  it('stores nothing when it refuses', async () => {
    await fillToCeiling();

    await expect(
      setAuthorityOverride(translationId, 'Beyond-1', 'title', 'locale'),
    ).rejects.toThrow();

    const overrides = await getAuthorityOverrides(translationId);
    expect(overrides.has('Beyond-1')).toBe(false);
    let entries = 0;
    for (const props of overrides.values()) {
      entries += props.size;
    }
    expect(entries).toBe(MAX_OVERRIDE_ENTRIES);
  });

  it('replaces an entry already in a full map', async () => {
    await fillToCeiling();

    await setAuthorityOverride(translationId, 'Slot-1', 'title', 'canonical');

    expect(await getAuthorityOverride(translationId, 'Slot-1', 'title')).toBe('canonical');
  });

  it('accepts a new override again once one is cleared', async () => {
    await fillToCeiling();

    await clearAuthorityOverride(translationId, 'Slot-1', 'title');
    await setAuthorityOverride(translationId, 'Beyond-1', 'title', 'locale');

    expect(await getAuthorityOverride(translationId, 'Beyond-1', 'title')).toBe('locale');
  });

  it('counts entries across slots rather than slots alone', async () => {
    // One slot carrying the whole ceiling is just as full as many carrying one each.
    await sql`
      UPDATE app.document_relations
         SET metadata = jsonb_build_object(
           'authorityOverrides',
           jsonb_build_object(
             'Crowded-1',
             (
               SELECT jsonb_object_agg('prop' || i, 'locale')
                 FROM generate_series(1, ${MAX_OVERRIDE_ENTRIES}) i
             )
           )
         )
       WHERE source_document_id = ${translationId} AND relation_type = 'localization'
    `;

    await expect(
      setAuthorityOverride(translationId, 'Crowded-1', 'another', 'locale'),
    ).rejects.toThrow(AuthorityOverrideLimitError);
  });
});
