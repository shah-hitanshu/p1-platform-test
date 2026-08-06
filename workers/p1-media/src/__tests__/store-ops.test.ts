import type { DatabaseSync } from 'node:sqlite';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  finalizeAssetCreation,
  finalizeVersionAdd,
  getAsset,
  listAssets,
  updateAssetMetadata,
  softDeleteAsset,
  buildKey,
  NotFoundError,
} from '../store';
import { createTestHarness, countRows, seedAsset } from './d1-test-harness';

// ===========================================================================
// Store composite operations — the R2+D1 writes that store.test.ts deliberately
// defers ("covered by a separate real-SQLite smoke"). This IS that smoke suite.
//
// These run against a REAL SQLite engine (node:sqlite) with the SHIPPED migration
// applied, so the guarantees under test are the SQL's, not a mock's:
//   R0 — every op is scoped to the owning site (no cross-site read/write/delete)
//   R3 — the two D1 rows in a batch() commit atomically, or neither does
//  R11 — search matches filename/alt with user wildcards treated literally
//  R12 — metadata: alt is promoted to its own column, the rest is a JSON blob,
//        null clears, and the schema version is stamped
// R3's atomicity assertion requires forcing a genuine SQL failure and observing a
// real rollback, which a hand-mock cannot prove — hence the real engine.
//
// R2 (immutable, no-clobber version writes) has nothing left to test here: the
// Worker never writes bytes to R2 itself anymore (clients PUT directly via a
// presigned URL), so the store's only remaining R2 interaction is a caller-confirmed
// head() before finalize — the no-clobber guarantee now lives entirely in a fresh
// server-minted UUID key, not in any conditional-put logic this file could exercise.
// ===========================================================================

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Read the persisted asset row directly, to assert column-level placement
// (e.g. alt lives in its own column, not the JSON blob) rather than only the
// composed API shape.
function rawAsset(db: DatabaseSync, assetId: string) {
  const row = db
    .prepare('SELECT alt, metadata, meta_schema_version, current_version, filename, deleted_at FROM assets WHERE asset_id = ?')
    .get(assetId) as {
      alt: string | null;
      metadata: string | null;
      meta_schema_version: number | null;
      current_version: string;
      filename: string;
      deleted_at: string | null;
    } | undefined;
  return row ?? null; // node:sqlite get() returns undefined for no row; normalize to null
}

// ---------------------------------------------------------------------------
// finalizeAssetCreation (presigned-upload completion — no R2 write, D1 only)
// ---------------------------------------------------------------------------

describe('finalizeAssetCreation', () => {
  it('writes the asset + version rows for a pre-minted assetId/versionId, without touching R2', async () => {
    const { env, db, bucket } = createTestHarness();

    const asset = await finalizeAssetCreation(env, {
      siteId: 's1',
      assetId: 'asset-1',
      versionId: 'version-1',
      filename: 'photo.png',
      contentType: 'image/png',
      size: 1234,
      width: 800,
      height: 600,
      createdBy: 'user-1',
      metadata: { alt: 'a cat', caption: 'nice' },
    });

    expect(countRows(db, 'assets')).toBe(1);
    expect(countRows(db, 'asset_versions')).toBe(1);
    expect(asset.assetId).toBe('asset-1');
    expect(asset.versionId).toBe('version-1');
    expect(asset.metadata).toEqual({ alt: 'a cat', caption: 'nice' });
    expect(asset.url).toContain(buildKey('s1', 'asset-1', 'version-1', 'photo.png'));

    // Bytes were never written here — the caller (finalize handler) already confirmed
    // them via head() before calling this. Nothing should have landed via .put().
    expect(bucket._keys.size).toBe(0);
  });

  it('stores no alt column and null metadata blob when no metadata is supplied', async () => {
    const { env, db } = createTestHarness();
    const asset = await finalizeAssetCreation(env, {
      siteId: 's1', assetId: 'asset-1', versionId: 'version-1',
      filename: 'p.png', contentType: 'image/png', size: 1,
    });
    const row = rawAsset(db, asset.assetId)!;
    expect(row.alt).toBeNull();
    expect(row.metadata).toBeNull();
    expect(asset.metadata).toEqual({});
  });

  it('is idempotent: finalizing the same assetId twice returns the existing asset, no duplicate insert', async () => {
    const { env, db } = createTestHarness();

    const first = await finalizeAssetCreation(env, {
      siteId: 's1', assetId: 'asset-1', versionId: 'version-1',
      filename: 'photo.png', contentType: 'image/png', size: 1,
    });
    const second = await finalizeAssetCreation(env, {
      siteId: 's1', assetId: 'asset-1', versionId: 'version-1',
      filename: 'photo.png', contentType: 'image/png', size: 1,
    });

    expect(second).toEqual(first);
    expect(countRows(db, 'assets')).toBe(1);
    expect(countRows(db, 'asset_versions')).toBe(1);
  });

  it('is idempotent under a CONCURRENT double-finalize, not just sequential retries', async () => {
    // The getAsset() pre-check alone only catches a retry that arrives after the first
    // call has fully committed. Two calls racing past that check before either writes
    // must not throw a PRIMARY KEY violation on the loser — INSERT OR IGNORE is what
    // makes that true; this test would fail without it (or a caught constraint error).
    const { env, db } = createTestHarness();
    const args = {
      siteId: 's1', assetId: 'asset-1', versionId: 'version-1',
      filename: 'photo.png', contentType: 'image/png', size: 1,
    };

    const [first, second] = await Promise.all([
      finalizeAssetCreation(env, args),
      finalizeAssetCreation(env, args),
    ]);

    expect(second).toEqual(first);
    expect(countRows(db, 'assets')).toBe(1);
    expect(countRows(db, 'asset_versions')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// finalizeVersionAdd (presigned replace-version completion — no R2 write, D1 only)
// ---------------------------------------------------------------------------

describe('finalizeVersionAdd', () => {
  it('R0: a wrong siteId throws NotFoundError and writes nothing', async () => {
    const { env, db, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'p.png' });

    await expect(
      finalizeVersionAdd(env, {
        siteId: 'ATTACKER', assetId: asset.assetId, versionId: 'v2',
        filename: 'p2.png', contentType: 'image/png', size: 2,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(countRows(db, 'asset_versions')).toBe(1);
    expect(rawAsset(db, asset.assetId)!.current_version).toBe(asset.versionId);
  });

  it('appends an immutable version and repoints current_version at it', async () => {
    const { env, db, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'v1.png' });

    const updated = await finalizeVersionAdd(env, {
      siteId: 's1', assetId: asset.assetId, versionId: 'v2',
      filename: 'v2.png', contentType: 'image/jpeg', size: 2, width: 10, height: 20,
    });

    expect(updated.assetId).toBe(asset.assetId);
    expect(updated.versionId).toBe('v2');
    expect(countRows(db, 'asset_versions')).toBe(2);
    expect(rawAsset(db, asset.assetId)!.current_version).toBe('v2');

    // No R2 write happens here — bytes already landed via the presigned PUT, which
    // the finalize handler already confirmed via head() before calling this. Only the
    // v1 key exists, written by the setup's seedAsset call above.
    expect(bucket._keys.size).toBe(1);
  });

  it('is idempotent: finalizing the same versionId twice returns the existing asset, no duplicate insert', async () => {
    const { env, db, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'v1.png' });

    const first = await finalizeVersionAdd(env, {
      siteId: 's1', assetId: asset.assetId, versionId: 'v2',
      filename: 'v2.png', contentType: 'image/png', size: 2,
    });
    const second = await finalizeVersionAdd(env, {
      siteId: 's1', assetId: asset.assetId, versionId: 'v2',
      filename: 'v2.png', contentType: 'image/png', size: 2,
    });

    expect(second).toEqual(first);
    expect(countRows(db, 'asset_versions')).toBe(2); // v1 (initial create) + v2 — not 3
  });

  it('is idempotent under a CONCURRENT double-finalize, not just sequential retries', async () => {
    const { env, db, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'v1.png' });
    const args = {
      siteId: 's1', assetId: asset.assetId, versionId: 'v2',
      filename: 'v2.png', contentType: 'image/png', size: 2,
    };

    const [first, second] = await Promise.all([
      finalizeVersionAdd(env, args),
      finalizeVersionAdd(env, args),
    ]);

    expect(second).toEqual(first);
    expect(countRows(db, 'asset_versions')).toBe(2); // v1 + v2 — not 3
  });
});

// ---------------------------------------------------------------------------
// D1 batch atomicity — the invariant finalizeAssetCreation/finalizeVersionAdd both
// depend on: env.MEDIA_DB.batch() commits all statements or none. Exercised directly
// (not through either finalize* function) because both now use INSERT OR IGNORE,
// which neutralizes the PRIMARY KEY collision this test used to force a genuine
// throw with — SQLite's ON CONFLICT resolution does NOT apply to FOREIGN KEY
// constraints, so an FK violation is the failure mode that still reliably throws.
// ---------------------------------------------------------------------------

describe('D1 batch atomicity', () => {
  it('rolls back a statement that would have succeeded when a later statement in the same batch violates a constraint', async () => {
    const { env, db } = createTestHarness();
    const now = new Date().toISOString();

    await expect(
      env.MEDIA_DB.batch([
        env.MEDIA_DB.prepare(
          'INSERT INTO assets (asset_id, site_id, filename, meta_schema_version, current_version, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind('would-succeed', 's1', 'p.png', 1, 'v1', now),
        // References an asset_id that will never exist — a genuine FOREIGN KEY
        // violation, which (unlike a PRIMARY KEY/UNIQUE collision) SQLite's OR
        // IGNORE conflict resolution cannot swallow.
        env.MEDIA_DB.prepare(
          'INSERT INTO asset_versions (version_id, asset_id, r2_key) VALUES (?, ?, ?)',
        ).bind('v1', 'does-not-exist', 'planted-key'),
      ]),
    ).rejects.toThrow();

    // The first statement, which would have succeeded in isolation, must not have
    // persisted either — batch() is one transaction, not two independent writes.
    expect(countRows(db, 'assets')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getAsset
// ---------------------------------------------------------------------------

describe('getAsset', () => {
  it('R0: returns null for an asset owned by a different site', async () => {
    const { env, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'p.png' });
    expect(await getAsset(env, 'OTHER', asset.assetId)).toBeNull();
    expect(await getAsset(env, 's1', asset.assetId)).not.toBeNull();
  });

  it('returns null for an absent or soft-deleted asset', async () => {
    const { env, bucket } = createTestHarness();
    expect(await getAsset(env, 's1', 'does-not-exist')).toBeNull();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'p.png' });
    await softDeleteAsset(env, 's1', asset.assetId);
    expect(await getAsset(env, 's1', asset.assetId)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listAssets
// ---------------------------------------------------------------------------

describe('listAssets', () => {
  // A controlled clock gives each asset a distinct created_at so newest-first is
  // deterministic (same-millisecond inserts would tie and order arbitrarily).
  async function seed(env: ReturnType<typeof createTestHarness>['env'], bucket: ReturnType<typeof createTestHarness>['bucket']) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await seedAsset(env, bucket, { siteId: 's1', filename: 'hero-banner.png', metadata: { alt: 'a hero' } });
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
    await seedAsset(env, bucket, {
      siteId: 's1', filename: 'about-us.jpg', contentType: 'image/jpeg',
      metadata: { alt: 'the team', caption: 'Quarterly offsite group photo', byline: 'J. Photographer' },
    });
    vi.setSystemTime(new Date('2026-01-03T00:00:00Z'));
    await seedAsset(env, bucket, { siteId: 's1', filename: '50%_off.png' });
    vi.useRealTimers();
  }

  it('returns a site\'s assets newest-first', async () => {
    const { env, bucket } = createTestHarness();
    await seed(env, bucket);
    const all = await listAssets(env, 's1');
    expect(all.map((a) => a.filename)).toEqual(['50%_off.png', 'about-us.jpg', 'hero-banner.png']);
  });

  it('R0: never returns another site\'s assets', async () => {
    const { env, bucket } = createTestHarness();
    await seed(env, bucket);
    await seedAsset(env, bucket, { siteId: 's2', filename: 'other.png' });
    const s1 = await listAssets(env, 's1');
    expect(s1.every((a) => a.filename !== 'other.png')).toBe(true);
    expect(await listAssets(env, 's2')).toHaveLength(1);
  });

  it('excludes soft-deleted assets', async () => {
    const { env, bucket } = createTestHarness();
    await seed(env, bucket);
    const before = await listAssets(env, 's1');
    const target = before.find((a) => a.filename === 'about-us.jpg')!;
    await softDeleteAsset(env, 's1', target.assetId);
    const after = await listAssets(env, 's1');
    expect(after.map((a) => a.filename)).toEqual(['50%_off.png', 'hero-banner.png']);
  });

  it('search matches on filename (case-insensitive)', async () => {
    const { env, bucket } = createTestHarness();
    await seed(env, bucket);
    const hits = await listAssets(env, 's1', { search: 'HERO' });
    expect(hits.map((a) => a.filename)).toEqual(['hero-banner.png']);
  });

  it('search matches on the alt text, not just the filename', async () => {
    const { env, bucket } = createTestHarness();
    await seed(env, bucket);
    // "the team" is alt on about-us.jpg; the filename does not contain "team".
    const hits = await listAssets(env, 's1', { search: 'team' });
    expect(hits.map((a) => a.filename)).toEqual(['about-us.jpg']);
  });

  it('search matches non-alt metadata values (caption, byline, ...)', async () => {
    const { env, bucket } = createTestHarness();
    await seed(env, bucket);
    // "offsite" appears only in about-us.jpg's caption — not its filename or alt.
    expect((await listAssets(env, 's1', { search: 'OFFSITE' })).map((a) => a.filename)).toEqual([
      'about-us.jpg',
    ]);
    expect((await listAssets(env, 's1', { search: 'photographer' })).map((a) => a.filename)).toEqual([
      'about-us.jpg',
    ]);
  });

  it('search matches metadata VALUES only — a field name is not a hit', async () => {
    const { env, bucket } = createTestHarness();
    await seed(env, bucket);
    // about-us.jpg HAS a caption field, but no seeded value contains "caption".
    expect(await listAssets(env, 's1', { search: 'caption' })).toHaveLength(0);
  });

  it('a corrupt metadata blob on one asset does not break search for the others', async () => {
    const { env, bucket } = createTestHarness();
    await seed(env, bucket);
    const corrupt = (await listAssets(env, 's1')).find((a) => a.filename === 'hero-banner.png')!;
    await env.MEDIA_DB.prepare('UPDATE assets SET metadata = ? WHERE asset_id = ?')
      .bind('not json {', corrupt.assetId)
      .run();
    // The metadata scan skips the invalid blob instead of erroring the query...
    expect((await listAssets(env, 's1', { search: 'offsite' })).map((a) => a.filename)).toEqual([
      'about-us.jpg',
    ]);
    // ...and the corrupt asset is still findable by filename.
    expect((await listAssets(env, 's1', { search: 'hero' })).map((a) => a.filename)).toEqual([
      'hero-banner.png',
    ]);
  });

  it('R11: wildcard chars in the search term are matched literally, not as SQL wildcards', async () => {
    const { env, bucket } = createTestHarness();
    await seed(env, bucket);
    // A bare "%" must NOT behave like LIKE-any (which would return all 3 seeded
    // assets); escaped, it matches only the one filename that literally contains "%".
    const pct = await listAssets(env, 's1', { search: '%' });
    expect(pct.map((a) => a.filename)).toEqual(['50%_off.png']);
    // The literal "50%_off" is found when its exact characters are typed.
    const literal = await listAssets(env, 's1', { search: '50%_off' });
    expect(literal.map((a) => a.filename)).toEqual(['50%_off.png']);
    // "_" must not act as a single-char wildcard: "50Xoff" (X in place of _) matches nothing.
    expect(await listAssets(env, 's1', { search: '50Xoff' })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// updateAssetMetadata
// ---------------------------------------------------------------------------

describe('updateAssetMetadata', () => {
  it('R12: alt maps to its column, other fields merge into the JSON blob, and the schema version is stamped', async () => {
    const { env, db, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, {
      siteId: 's1', filename: 'p.png', metadata: { caption: 'original' },
    });

    const updated = await updateAssetMetadata(env, 's1', asset.assetId, {
      alt: 'new alt',
      credit: 'a photographer',
    });

    // Composed view folds everything into one flat map.
    expect(updated!.metadata).toEqual({ alt: 'new alt', caption: 'original', credit: 'a photographer' });
    expect(updated!.metaSchemaVersion).toBe(1);

    // Storage: alt in its own column; the blob holds the non-alt fields only.
    const row = rawAsset(db, asset.assetId)!;
    expect(row.alt).toBe('new alt');
    expect(JSON.parse(row.metadata!)).toEqual({ caption: 'original', credit: 'a photographer' });
    expect(row.meta_schema_version).toBe(1);
  });

  it('a null value clears that field (alt column and blob key alike)', async () => {
    const { env, db, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, {
      siteId: 's1', filename: 'p.png', metadata: { alt: 'has alt', caption: 'has caption' },
    });

    const updated = await updateAssetMetadata(env, 's1', asset.assetId, {
      alt: null,
      caption: null,
    });

    expect(updated!.metadata).toEqual({});
    const row = rawAsset(db, asset.assetId)!;
    expect(row.alt).toBeNull();
    expect(row.metadata).toBeNull(); // empty blob is stored as NULL, not "{}"
  });

  it('R0: returns null (and writes nothing) for an asset owned by another site', async () => {
    const { env, db, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, {
      siteId: 's1', filename: 'p.png', metadata: { alt: 'keep me' },
    });

    expect(await updateAssetMetadata(env, 'OTHER', asset.assetId, { alt: 'hijacked' })).toBeNull();
    // The real owner's data is unchanged.
    expect(rawAsset(db, asset.assetId)!.alt).toBe('keep me');
  });
});

// ---------------------------------------------------------------------------
// softDeleteAsset
// ---------------------------------------------------------------------------

describe('softDeleteAsset', () => {
  it('stamps deleted_at, hides the asset from listings, and returns true', async () => {
    const { env, db, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'p.png' });

    expect(await softDeleteAsset(env, 's1', asset.assetId)).toBe(true);
    expect(rawAsset(db, asset.assetId)!.deleted_at).not.toBeNull();
    expect(await listAssets(env, 's1')).toHaveLength(0);
  });

  it('R0: returns false for a foreign or absent asset and leaves it intact', async () => {
    const { env, db, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'p.png' });

    expect(await softDeleteAsset(env, 'OTHER', asset.assetId)).toBe(false);
    expect(await softDeleteAsset(env, 's1', 'no-such-asset')).toBe(false);
    // The foreign delete attempt did not soft-delete the real asset.
    expect(rawAsset(db, asset.assetId)!.deleted_at).toBeNull();
  });

  it('returns false when the asset is already soft-deleted (idempotent, no double count)', async () => {
    const { env, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'p.png' });
    expect(await softDeleteAsset(env, 's1', asset.assetId)).toBe(true);
    expect(await softDeleteAsset(env, 's1', asset.assetId)).toBe(false);
  });
});
