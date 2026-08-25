/**
 * Authority-override writes - Integration Tests
 *
 * Setting or clearing one (slotId, propName) is a single statement against the
 * localization edge, so a write never depends on a map read earlier in the same
 * request: two writers touching different props of the same translation both
 * survive, and neither disturbs the rest of the edge's metadata.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { createRealDatabaseConnection, asConcurrentRequests } from '../helpers/database';

import { createSite } from '../../src/services/site-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import { createTranslation } from '../../src/services/create-translation-service';
import {
  getAuthorityOverrides,
  getAuthorityOverride,
  setAuthorityOverride,
  clearAuthorityOverride,
} from '../../src/services/relations-service';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'override-writes-test';

const HEADING = {
  type: 'HeadingBlock',
  props: { id: 'HeadingBlock-1', title: 'Hello', subtitle: 'Hi' },
};

function makeSnapshot(): Record<string, unknown> {
  return { content: [HEADING], root: { props: { title: 'Test' } }, zones: {} };
}

describe('Authority-override writes - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let branchId: string;
  let translationId: string;
  let plainDocumentId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'override-writes-test@example.com', 'Override Writes User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Override Writes Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches =
      await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    branchId = branches[0].id as string;

    const canonical = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'pages/home',
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

    const plain = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'pages/plain',
      snapshot: makeSnapshot(),
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    plainDocumentId = plain.document.id;
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

  beforeEach(async () => {
    await sql`
      UPDATE app.document_relations SET metadata = '{}'::jsonb
       WHERE source_document_id = ${translationId} AND relation_type = 'localization'
    `;
  });

  it('keeps both props when two writers set different props at once', async () => {
    await asConcurrentRequests(
      () => setAuthorityOverride(translationId, 'HeadingBlock-1', 'title', 'locale'),
      () => setAuthorityOverride(translationId, 'HeadingBlock-1', 'subtitle', 'locale'),
    );

    const overrides = await getAuthorityOverrides(translationId);
    expect(overrides.get('HeadingBlock-1')?.get('title')).toBe('locale');
    expect(overrides.get('HeadingBlock-1')?.get('subtitle')).toBe('locale');
  });

  it('keeps both slots when two writers set different slots at once', async () => {
    await asConcurrentRequests(
      () => setAuthorityOverride(translationId, 'HeadingBlock-1', 'title', 'locale'),
      () => setAuthorityOverride(translationId, 'ImageBlock-1', 'alt', 'canonical'),
    );

    const overrides = await getAuthorityOverrides(translationId);
    expect(overrides.get('HeadingBlock-1')?.get('title')).toBe('locale');
    expect(overrides.get('ImageBlock-1')?.get('alt')).toBe('canonical');
  });

  it('clears one prop while a concurrent write sets another', async () => {
    await setAuthorityOverride(translationId, 'HeadingBlock-1', 'title', 'locale');

    await asConcurrentRequests(
      () => clearAuthorityOverride(translationId, 'HeadingBlock-1', 'title'),
      () => setAuthorityOverride(translationId, 'HeadingBlock-1', 'subtitle', 'canonical'),
    );

    expect(await getAuthorityOverride(translationId, 'HeadingBlock-1', 'title')).toBeNull();
    expect(await getAuthorityOverride(translationId, 'HeadingBlock-1', 'subtitle')).toBe(
      'canonical',
    );
  });

  it('overwrites an existing override for the same prop', async () => {
    await setAuthorityOverride(translationId, 'HeadingBlock-1', 'title', 'locale');
    await setAuthorityOverride(translationId, 'HeadingBlock-1', 'title', 'canonical');

    expect(await getAuthorityOverride(translationId, 'HeadingBlock-1', 'title')).toBe('canonical');
  });

  it('prunes the slot once its last prop override is cleared', async () => {
    await setAuthorityOverride(translationId, 'HeadingBlock-1', 'title', 'locale');
    await clearAuthorityOverride(translationId, 'HeadingBlock-1', 'title');

    const rows = await sql`
      SELECT metadata FROM app.document_relations
       WHERE source_document_id = ${translationId} AND relation_type = 'localization'
    `;
    const metadata = rows[0].metadata as { authorityOverrides?: Record<string, unknown> };
    expect(metadata.authorityOverrides).toEqual({});
  });

  it('leaves a sibling prop in place when one is cleared', async () => {
    await setAuthorityOverride(translationId, 'HeadingBlock-1', 'title', 'locale');
    await setAuthorityOverride(translationId, 'HeadingBlock-1', 'subtitle', 'locale');
    await clearAuthorityOverride(translationId, 'HeadingBlock-1', 'title');

    const overrides = await getAuthorityOverrides(translationId);
    expect(overrides.get('HeadingBlock-1')?.has('title')).toBe(false);
    expect(overrides.get('HeadingBlock-1')?.get('subtitle')).toBe('locale');
  });

  it('preserves metadata keys it does not own', async () => {
    await sql`
      UPDATE app.document_relations
         SET metadata = '{"syncNote":"keep me"}'::jsonb
       WHERE source_document_id = ${translationId} AND relation_type = 'localization'
    `;

    await setAuthorityOverride(translationId, 'HeadingBlock-1', 'title', 'locale');
    await clearAuthorityOverride(translationId, 'HeadingBlock-1', 'title');

    const rows = await sql`
      SELECT metadata FROM app.document_relations
       WHERE source_document_id = ${translationId} AND relation_type = 'localization'
    `;
    expect((rows[0].metadata as { syncNote?: string }).syncNote).toBe('keep me');
  });

  it('replaces a stored authorityOverrides that is not an object', async () => {
    await sql`
      UPDATE app.document_relations
         SET metadata = '{"authorityOverrides":"nonsense"}'::jsonb
       WHERE source_document_id = ${translationId} AND relation_type = 'localization'
    `;

    await setAuthorityOverride(translationId, 'HeadingBlock-1', 'title', 'locale');

    expect(await getAuthorityOverride(translationId, 'HeadingBlock-1', 'title')).toBe('locale');
  });

  it('is a no-op for a document with no localization edge', async () => {
    await setAuthorityOverride(plainDocumentId, 'HeadingBlock-1', 'title', 'locale');
    await clearAuthorityOverride(plainDocumentId, 'HeadingBlock-1', 'title');

    expect(await getAuthorityOverrides(plainDocumentId)).toEqual(new Map());
  });

  it('clearing an override that was never set changes nothing', async () => {
    await setAuthorityOverride(translationId, 'HeadingBlock-1', 'title', 'locale');
    await clearAuthorityOverride(translationId, 'HeadingBlock-1', 'absent');

    expect(await getAuthorityOverride(translationId, 'HeadingBlock-1', 'title')).toBe('locale');
  });

  it('round-trips a slot named after an Object.prototype member', async () => {
    expect(await getAuthorityOverride(translationId, '__proto__', 'title')).toBeNull();

    await setAuthorityOverride(translationId, '__proto__', 'title', 'locale');

    expect(await getAuthorityOverride(translationId, '__proto__', 'title')).toBe('locale');
    expect(await getAuthorityOverrides(translationId)).toEqual(
      new Map([['__proto__', new Map([['title', 'locale']])]]),
    );
  });
});
