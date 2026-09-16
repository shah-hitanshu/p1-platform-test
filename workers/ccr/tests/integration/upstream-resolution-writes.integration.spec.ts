/**
 * Upstream-resolution writes - Integration Tests
 *
 * Recording or clearing the resolutions for a batch of (slotId, propPath) targets is
 * a single statement, so two writers settling different changes on the same
 * translation both survive, and neither disturbs the authority map. Resolutions are
 * held per branch, and a branch with no row of its own reads main's, since it is
 * serving main's translation until it edits it.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type postgres from 'postgres';
import {
  createRealDatabaseConnection,
  asConcurrentRequests,
  deleteSiteCascade,
} from '../helpers/database';

import { createSite } from '../../src/services/site-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import { createTranslation } from '../../src/services/create-translation-service';
import {
  getUpstreamResolutions,
  setUpstreamResolutions,
  clearUpstreamResolutions,
  carryUpstreamResolutions,
  getAuthorityOverride,
  setAuthorityOverride,
  MAX_OVERRIDE_ENTRIES,
} from '../../src/services/relations-service';
import { createBranch } from '../../src/services/branch-service';
import { UpstreamResolutionLimitError } from '../../src/services/errors';

const TEST_USER_ID = '78787878-7878-7878-7878-787878787878';
const SITE_PREFIX = 'resolution-writes-test';

const HASH_A = 'sha256:aaaa';
const HASH_B = 'sha256:bbbb';

const HEADING = {
  type: 'HeadingBlock',
  props: { id: 'HeadingBlock-1', title: 'Hello', subtitle: 'Hi' },
};

type StoredMap = Record<string, Record<string, { hash: string; at: string } | undefined>>;
type StoredRow = { resolutions: StoredMap; inherited: StoredMap };

function makeSnapshot(): Record<string, unknown> {
  return { content: [HEADING], root: { props: { title: 'Test' } }, zones: {} };
}

describe('Upstream-resolution writes - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let branchId: string;
  let translationId: string;
  let plainDocumentId: string;

  /** Fills the resolutions map to exactly the ceiling, one prop per slot. */
  const fillResolutionsToCeiling = async (): Promise<void> => {
    await sql.unsafe(
      `INSERT INTO app.document_relation_branch_resolutions
         (source_document_id, relation_type, branch_id, resolutions)
       SELECT $1, 'localization', $2, (
         SELECT jsonb_object_agg('Slot-' || i, jsonb_build_object('/title', jsonb_build_object('hash', 'sha256:seed', 'at', '2026-01-01T00:00:00.000Z')))
           FROM generate_series(1, $3::int) i
       )
       ON CONFLICT (source_document_id, relation_type, branch_id)
       DO UPDATE SET resolutions = EXCLUDED.resolutions`,
      [translationId, branchId, MAX_OVERRIDE_ENTRIES],
    );
  };

  /** Fills the authority map, which still lives in the edge's metadata. */
  const fillAuthorityToCeiling = async (): Promise<void> => {
    await sql.unsafe(
      `UPDATE app.document_relations
          SET metadata = jsonb_build_object(
            'authorityOverrides',
            (
              SELECT jsonb_object_agg('Slot-' || i, jsonb_build_object('title', 'locale'))
                FROM generate_series(1, $2::int) i
            )
          )
        WHERE source_document_id = $1 AND relation_type = 'localization'`,
      [translationId, MAX_OVERRIDE_ENTRIES],
    );
  };

  const storeResolutions = async (raw: string): Promise<void> => {
    await sql.unsafe(
      `INSERT INTO app.document_relation_branch_resolutions
         (source_document_id, relation_type, branch_id, resolutions)
       VALUES ($1, 'localization', $2, ${raw})
       ON CONFLICT (source_document_id, relation_type, branch_id)
       DO UPDATE SET resolutions = EXCLUDED.resolutions`,
      [translationId, branchId],
    );
  };

  const readStoredResolutions = async (): Promise<Record<string, unknown> | undefined> => {
    const rows = await sql`
      SELECT resolutions FROM app.document_relation_branch_resolutions
       WHERE source_document_id = ${translationId}
         AND relation_type = 'localization' AND branch_id = ${branchId}
    `;
    return rows[0]?.resolutions as Record<string, unknown> | undefined;
  };

  /** One branch's row as stored, both maps nested by slot then prop. */
  const readRow = async (branch: string): Promise<StoredRow | undefined> => {
    const rows = await sql`
      SELECT resolutions, inherited FROM app.document_relation_branch_resolutions
       WHERE source_document_id = ${translationId}
         AND relation_type = 'localization' AND branch_id = ${branch}
    `;
    return rows[0] as StoredRow | undefined;
  };

  /**
   * A batch of one. The hash stands for the canonical value settled against, which
   * these tests treat as opaque: what is under test is how a resolution is stored,
   * not how a value is fingerprinted.
   */
  const one = (slotId: string, propPath: string, hash = HASH_A) => [{ slotId, propPath, hash }];

  beforeAll(async () => {
    const { sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'resolution-writes-test@example.com', 'Resolution Writes User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Resolution Writes Test Site',
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
    await deleteSiteCascade(sql, siteId);
    await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    await sql.end();
  });

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

  it('records the value a prop was reconciled against', async () => {
    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_A);
  });

  it('records an empty baseline on main, which inherits nothing', async () => {
    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'), branchId);
    await setUpstreamResolutions(
      translationId,
      branchId,
      one('HeadingBlock-1', '/subtitle', HASH_B),
      branchId,
    );

    expect((await readRow(branchId))?.inherited).toEqual({});
  });

  it('records when a prop was reconciled', async () => {
    const before = Date.now();
    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    const at = resolutions.get('HeadingBlock-1')?.get('/title')?.at ?? '';
    expect(Date.parse(at)).toBeGreaterThanOrEqual(before);
  });

  it('stores the fingerprint and the time together', async () => {
    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

    const stored = (await readStoredResolutions()) as Record<string, Record<string, unknown>>;
    expect(stored['HeadingBlock-1']['/title']).toEqual({
      hash: HASH_A,
      at: expect.any(String),
    });
  });

  it('settles the props of one batch at the same time', async () => {
    await setUpstreamResolutions(translationId, branchId, [
      { slotId: 'HeadingBlock-1', propPath: '/title', hash: HASH_A },
      { slotId: 'HeadingBlock-1', propPath: '/subtitle', hash: HASH_B },
    ]);

    const slot = (await getUpstreamResolutions(translationId, branchId)).get('HeadingBlock-1');
    expect(slot?.get('/title')?.at).toBe(slot?.get('/subtitle')?.at);
  });

  it('settles every target named in one call', async () => {
    await setUpstreamResolutions(
      translationId,
      branchId,
      [
        { slotId: 'HeadingBlock-1', propPath: '/title', hash: HASH_A },
        { slotId: 'HeadingBlock-1', propPath: '/subtitle', hash: HASH_A },
        { slotId: '__root__', propPath: '/title', hash: HASH_A },
      ],
    );

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_A);
    expect(resolutions.get('HeadingBlock-1')?.get('/subtitle')?.hash).toBe(HASH_A);
    expect(resolutions.get('__root__')?.get('/title')?.hash).toBe(HASH_A);
  });

  it('leaves a prop the batch does not name where it was', async () => {
    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/subtitle'));

    await setUpstreamResolutions(
      translationId,
      branchId,
      one('HeadingBlock-1', '/title', HASH_B),
    );

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('HeadingBlock-1')?.get('/subtitle')?.hash).toBe(HASH_A);
    expect(resolutions.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_B);
  });

  it('does not read a resolution recorded on another branch', async () => {
    const other = await createBranch({
      siteId,
      name: 'other-branch',
      sourceBranchId: branchId,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

    const there = await getUpstreamResolutions(translationId, other.id);
    expect(there.get('HeadingBlock-1')?.get('/title')).toBeUndefined();
  });

  it('re-points a resolution when a prop is reconciled again', async () => {
    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));
    await setUpstreamResolutions(
      translationId,
      branchId,
      one('HeadingBlock-1', '/title', HASH_B),
    );

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_B);
  });

  it('clearing a resolution leaves the prop unresolved', async () => {
    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));
    await clearUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('HeadingBlock-1')?.get('/title')).toBeUndefined();
  });

  it('keeps both props when two writers resolve different props at once', async () => {
    await asConcurrentRequests(
      () => setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title')),
      () => setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/subtitle')),
    );

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_A);
    expect(resolutions.get('HeadingBlock-1')?.get('/subtitle')?.hash).toBe(HASH_A);
  });

  it('clears one prop while a concurrent write resolves another', async () => {
    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

    await asConcurrentRequests(
      () => clearUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title')),
      () => setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/subtitle')),
    );

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('HeadingBlock-1')?.get('/title')).toBeUndefined();
    expect(resolutions.get('HeadingBlock-1')?.get('/subtitle')?.hash).toBe(HASH_A);
  });

  it('prunes the slot once its last resolution is cleared', async () => {
    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));
    await clearUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

    expect(await readStoredResolutions()).toEqual({});
  });

  it('leaves the authority map alone', async () => {
    await setAuthorityOverride(translationId, 'HeadingBlock-1', 'title', 'locale');

    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));
    await clearUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

    expect(await getAuthorityOverride(translationId, 'HeadingBlock-1', 'title')).toBe('locale');
  });

  it('is left alone by an authority write', async () => {
    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

    await setAuthorityOverride(translationId, 'HeadingBlock-1', 'title', 'locale');
    await setAuthorityOverride(translationId, 'HeadingBlock-1', 'subtitle', 'canonical');

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_A);
  });

  it.each([
    ['a string', "'\"junk\"'::jsonb"],
    ['a number', '7'],
    ['an array', "'[1]'::jsonb"],
  ])('records over a slot stored as %s rather than wedging the row', async (_label, slot) => {
    await storeResolutions(`jsonb_build_object('HeadingBlock-1', ${slot})`);

    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_A);
  });

  it('clears over a slot stored as a scalar rather than wedging the row', async () => {
    await storeResolutions(
      "jsonb_build_object('HeadingBlock-1', to_jsonb('junk'::text), 'Other-1', " +
        "jsonb_build_object('/title', jsonb_build_object(" +
        "'hash', 'sha256:aaaa', 'at', '2026-01-01T00:00:00.000Z')))",
    );

    await clearUpstreamResolutions(translationId, branchId, one('Other-1', '/title'));

    expect(await readStoredResolutions()).toEqual({});
  });

  it('replaces a stored map that is not an object', async () => {
    await storeResolutions("'\"nonsense\"'::jsonb");

    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_A);
  });

  it.each([
    ['a version number', '4'],
    ['a bare string', "'\"sha256:aaaa\"'::jsonb"],
    ['null', 'null'],
    ['a fingerprint with no time', "jsonb_build_object('hash', 'sha256:aaaa')"],
    ['a time with no fingerprint', "jsonb_build_object('at', '2026-01-01T00:00:00.000Z')"],
    ['an empty fingerprint', "jsonb_build_object('hash', '', 'at', '2026-01-01T00:00:00.000Z')"],
  ])('reads a resolution stored as %s as unresolved', async (_label, stored) => {
    await storeResolutions(
      `jsonb_build_object('HeadingBlock-1', jsonb_build_object('/title', ${stored}))`,
    );

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('HeadingBlock-1')?.get('/title')).toBeUndefined();
  });

  it('is a no-op for a document with no localization edge', async () => {
    await setUpstreamResolutions(plainDocumentId, branchId, one('HeadingBlock-1', '/title'));
    await clearUpstreamResolutions(plainDocumentId, branchId, one('HeadingBlock-1', '/title'));

    expect(await getUpstreamResolutions(plainDocumentId, branchId)).toEqual(new Map());
  });

  it('round-trips a slot named after an Object.prototype member', async () => {
    await setUpstreamResolutions(translationId, branchId, one('__proto__', '/title'));

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('__proto__')?.get('/title')?.hash).toBe(HASH_A);
  });

  it('refuses a new resolution once the map is full', async () => {
    await fillResolutionsToCeiling();

    await expect(
      setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title')),
    ).rejects.toThrow(UpstreamResolutionLimitError);
  });

  it('leaves the map untouched when a batch would carry it past the ceiling', async () => {
    await fillResolutionsToCeiling();

    await expect(
      setUpstreamResolutions(
        translationId,
        branchId,
        [
          { slotId: 'Slot-1', propPath: '/title', hash: HASH_B },
          { slotId: 'HeadingBlock-1', propPath: '/title', hash: HASH_B },
        ],
      ),
    ).rejects.toThrow(UpstreamResolutionLimitError);

    // Neither target landed: the whole batch is one statement.
    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('Slot-1')?.get('/title')?.hash).toBe('sha256:seed');
    expect(resolutions.get('HeadingBlock-1')?.get('/title')).toBeUndefined();
  });

  it('re-points a resolution even when the map is full', async () => {
    await fillResolutionsToCeiling();

    await setUpstreamResolutions(translationId, branchId, one('Slot-1', '/title', HASH_B));

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('Slot-1')?.get('/title')?.hash).toBe(HASH_B);
  });

  it('counts only its own map against the ceiling', async () => {
    await fillAuthorityToCeiling();

    await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

    const resolutions = await getUpstreamResolutions(translationId, branchId);
    expect(resolutions.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_A);
  });

  describe('a branch with no resolutions of its own', () => {
    let otherId: string;

    beforeEach(async () => {
      const other = await createBranch({
        siteId,
        name: `inherit-${String(Date.now())}`,
        sourceBranchId: branchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      otherId = other.id;
    });

    it("reads main's, since it is serving main's translation", async () => {
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

      const there = await getUpstreamResolutions(translationId, otherId, branchId);
      expect(there.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_A);
    });

    it("carries main's over when it settles its first change", async () => {
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/subtitle', HASH_B),
        branchId,
      );

      const there = await getUpstreamResolutions(translationId, otherId, branchId);
      expect(there.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_A);
      expect(there.get('HeadingBlock-1')?.get('/subtitle')?.hash).toBe(HASH_B);
    });

    it("records main's map as the baseline when it settles its first change", async () => {
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/subtitle', HASH_B),
        branchId,
      );

      const row = await readRow(otherId);
      expect(row?.inherited['HeadingBlock-1']['/title']?.hash).toBe(HASH_A);
      expect(row?.inherited['HeadingBlock-1']['/subtitle']).toBeUndefined();
    });

    it("records main's map as the baseline when its first write is a clear", async () => {
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

      await clearUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/title'),
        branchId,
      );

      const row = await readRow(otherId);
      expect(row?.inherited['HeadingBlock-1']['/title']?.hash).toBe(HASH_A);
      expect(row?.resolutions).toEqual({});
    });

    it('keeps the baseline it started from once main has settled more changes', async () => {
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));
      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/subtitle', HASH_B),
        branchId,
      );

      await setUpstreamResolutions(translationId, branchId, one('__root__', '/title'));
      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/title', HASH_B),
        branchId,
      );

      const row = await readRow(otherId);
      expect(Object.keys(row?.inherited ?? {})).toEqual(['HeadingBlock-1']);
      expect(row?.inherited['HeadingBlock-1']['/title']?.hash).toBe(HASH_A);
      expect(row?.inherited['HeadingBlock-1']['/subtitle']).toBeUndefined();
    });

    it('records an empty baseline when the ceiling holds its first write to the batch alone', async () => {
      await fillResolutionsToCeiling();

      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/title'),
        branchId,
      );

      const row = await readRow(otherId);
      expect(Object.keys(row?.resolutions ?? {})).toEqual(['HeadingBlock-1']);
      expect(row?.inherited).toEqual({});
    });

    it('settles a change on itself without settling it on main', async () => {
      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/title'),
        branchId,
      );

      const onMain = await getUpstreamResolutions(translationId, branchId);
      expect(onMain.get('HeadingBlock-1')?.get('/title')).toBeUndefined();
    });

    it("clears an inherited resolution on itself, leaving main's in place", async () => {
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

      await clearUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/title'),
        branchId,
      );

      const there = await getUpstreamResolutions(translationId, otherId, branchId);
      expect(there.get('HeadingBlock-1')?.get('/title')).toBeUndefined();
      const onMain = await getUpstreamResolutions(translationId, branchId);
      expect(onMain.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_A);
    });

    it("keeps main's other resolutions when it clears one", async () => {
      await setUpstreamResolutions(translationId, branchId, [
        { slotId: 'HeadingBlock-1', propPath: '/title', hash: HASH_A },
        { slotId: 'HeadingBlock-1', propPath: '/subtitle', hash: HASH_A },
      ]);

      await clearUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/title'),
        branchId,
      );

      const there = await getUpstreamResolutions(translationId, otherId, branchId);
      expect(there.get('HeadingBlock-1')?.get('/subtitle')?.hash).toBe(HASH_A);
    });

    it('goes on reading main\'s after clearing a resolution it never held', async () => {
      await clearUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/never-marked'),
        branchId,
      );

      // A clear that removes nothing leaves the branch with no map of its own, so
      // a resolution main records afterwards is still read here.
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

      const there = await getUpstreamResolutions(translationId, otherId, branchId);
      expect(there.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_A);
    });

    it('reports the resolutions in force when a clear removes nothing', async () => {
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

      const after = await clearUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/never-marked'),
        branchId,
      );

      expect(after.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_A);
    });

    it('carries nothing over once it has resolutions of its own', async () => {
      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/subtitle', HASH_B),
        branchId,
      );

      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

      const there = await getUpstreamResolutions(translationId, otherId, branchId);
      expect(there.get('HeadingBlock-1')?.get('/title')).toBeUndefined();
    });
  });

  describe('carrying what a branch settled onto another branch', () => {
    let otherId: string;

    const makeBranch = async (name: string): Promise<string> => {
      const branch = await createBranch({
        siteId,
        name: `${name}-${crypto.randomUUID()}`,
        sourceBranchId: branchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      return branch.id;
    };

    /**
     * Records main's map as what the branch's row started with. The service writes
     * `inherited` when it first inserts a branch's row; this stands in for that,
     * so it belongs right after the branch's first write and before main settles
     * anything else.
     */
    const recordWhatItStartedWith = async (branch: string): Promise<void> => {
      await sql.unsafe(
        `UPDATE app.document_relation_branch_resolutions own
            SET inherited = COALESCE((
                  SELECT main.resolutions
                    FROM app.document_relation_branch_resolutions main
                   WHERE main.source_document_id = own.source_document_id
                     AND main.relation_type = 'localization'
                     AND main.branch_id = $2
                ), '{}'::jsonb)
          WHERE own.source_document_id = $1 AND own.relation_type = 'localization'
            AND own.branch_id = $3`,
        [translationId, branchId, branch],
      );
    };

    const inheritedOn = async (branch: string): Promise<Record<string, unknown>> => {
      const rows = await sql`
        SELECT inherited FROM app.document_relation_branch_resolutions
         WHERE source_document_id = ${translationId}
           AND relation_type = 'localization' AND branch_id = ${branch}
      `;
      return rows[0]?.inherited as Record<string, unknown>;
    };

    beforeEach(async () => {
      otherId = await makeBranch('carry');
    });

    it('carries a mark made on a translation the branch never edited', async () => {
      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/subtitle', HASH_B),
        branchId,
      );
      await recordWhatItStartedWith(otherId);

      await carryUpstreamResolutions(otherId, branchId, []);

      const onMain = await getUpstreamResolutions(translationId, branchId);
      expect(onMain.get('HeadingBlock-1')?.get('/subtitle')?.hash).toBe(HASH_B);
    });

    it('leaves a mark main cleared cleared', async () => {
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));
      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/subtitle', HASH_B),
        branchId,
      );
      await recordWhatItStartedWith(otherId);
      await clearUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

      await carryUpstreamResolutions(otherId, branchId, []);

      const onMain = await getUpstreamResolutions(translationId, branchId);
      expect(onMain.get('HeadingBlock-1')?.get('/subtitle')?.hash).toBe(HASH_B);
      expect(onMain.get('HeadingBlock-1')?.get('/title')).toBeUndefined();
    });

    it('removes a mark the branch cleared from main', async () => {
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));
      await clearUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/title'),
        branchId,
      );
      await recordWhatItStartedWith(otherId);

      await carryUpstreamResolutions(otherId, branchId, []);

      const onMain = await getUpstreamResolutions(translationId, branchId);
      expect(onMain.get('HeadingBlock-1')?.get('/title')).toBeUndefined();
    });

    it('leaves a mark main settled after the branch started alone', async () => {
      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/subtitle', HASH_B),
        branchId,
      );
      await recordWhatItStartedWith(otherId);
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));

      await carryUpstreamResolutions(otherId, branchId, []);

      const onMain = await getUpstreamResolutions(translationId, branchId);
      expect(onMain.get('HeadingBlock-1')?.get('/title')?.hash).toBe(HASH_A);
      expect(onMain.get('HeadingBlock-1')?.get('/subtitle')?.hash).toBe(HASH_B);
    });

    it('leaves an excluded translation alone', async () => {
      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/subtitle', HASH_B),
        branchId,
      );
      await recordWhatItStartedWith(otherId);

      await carryUpstreamResolutions(otherId, branchId, [translationId]);

      const onMain = await getUpstreamResolutions(translationId, branchId);
      expect(onMain.get('HeadingBlock-1')?.get('/subtitle')).toBeUndefined();
    });

    it('seeds a workstream with no row of its own from main, with the carry applied', async () => {
      const thirdId = await makeBranch('carry-target');
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));
      await clearUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/title'),
        branchId,
      );
      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/subtitle', HASH_B),
        branchId,
      );
      await recordWhatItStartedWith(otherId);

      await carryUpstreamResolutions(otherId, thirdId, []);

      const onThird = await getUpstreamResolutions(translationId, thirdId);
      expect(onThird.get('HeadingBlock-1')?.get('/subtitle')?.hash).toBe(HASH_B);
      expect(onThird.get('HeadingBlock-1')?.get('/title')).toBeUndefined();
      expect(await inheritedOn(thirdId)).toEqual({
        'HeadingBlock-1': { '/title': { hash: HASH_A, at: expect.any(String) } },
      });
    });

    it('carries on what a workstream received, once that workstream merges', async () => {
      const thirdId = await makeBranch('carry-target');
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));
      await clearUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/title'),
        branchId,
      );
      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/subtitle', HASH_B),
        branchId,
      );
      await recordWhatItStartedWith(otherId);

      await carryUpstreamResolutions(otherId, thirdId, []);
      await carryUpstreamResolutions(thirdId, branchId, []);

      const onMain = await getUpstreamResolutions(translationId, branchId);
      expect(onMain.get('HeadingBlock-1')?.get('/subtitle')?.hash).toBe(HASH_B);
      expect(onMain.get('HeadingBlock-1')?.get('/title')).toBeUndefined();
    });

    it('applies the carry to a workstream that already has a row, leaving what it started with', async () => {
      const thirdId = await makeBranch('carry-target');
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));
      await setUpstreamResolutions(
        translationId,
        thirdId,
        one('HeadingBlock-1', '/subtitle', HASH_B),
        branchId,
      );
      await recordWhatItStartedWith(thirdId);
      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/tagline', HASH_B),
        branchId,
      );
      await recordWhatItStartedWith(otherId);

      await carryUpstreamResolutions(otherId, thirdId, []);

      const onThird = await getUpstreamResolutions(translationId, thirdId);
      expect([...onThird.get('HeadingBlock-1')?.keys() ?? []].sort()).toEqual([
        '/subtitle',
        '/tagline',
        '/title',
      ]);
      expect(await inheritedOn(thirdId)).toEqual({
        'HeadingBlock-1': { '/title': { hash: HASH_A, at: expect.any(String) } },
      });
    });

    it('reaches the same result run twice', async () => {
      await setUpstreamResolutions(translationId, branchId, one('HeadingBlock-1', '/title'));
      await clearUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/title'),
        branchId,
      );
      await setUpstreamResolutions(
        translationId,
        otherId,
        one('HeadingBlock-1', '/subtitle', HASH_B),
        branchId,
      );
      await recordWhatItStartedWith(otherId);

      await carryUpstreamResolutions(otherId, branchId, []);
      await carryUpstreamResolutions(otherId, branchId, []);

      const onMain = await getUpstreamResolutions(translationId, branchId);
      expect([...onMain.get('HeadingBlock-1')?.keys() ?? []]).toEqual(['/subtitle']);
      expect(onMain.get('HeadingBlock-1')?.get('/subtitle')?.hash).toBe(HASH_B);
    });
  });
});
