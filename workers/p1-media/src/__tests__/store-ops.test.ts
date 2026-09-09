import type { DatabaseSync } from 'node:sqlite';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  finalizeAssetCreation,
  finalizeVersionAdd,
  getAsset,
  getStoredAsset,
  listAssets,
  updateAssetMetadata,
  softDeleteAsset,
  softDeleteChatAsset,
  promoteAsset,
  findExpiredChatAssets,
  hardDeleteChatAsset,
  buildKey,
  NotFoundError,
} from '../store';
import { sweepExpiredChatAssets } from '../handlers/reconcile';
import { handlePromote } from '../handlers/promote';
import type { Env } from '../types';
import { createTestHarness, countRows, seedAsset, type MockBucket } from './d1-test-harness';

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

describe('getStoredAsset', () => {
  // Deleting removes an asset from the library. The conversation that uploaded it holds
  // its own reference and goes on reading it — that is what the content route serves.
  it('still returns an asset the library has deleted, flagged as such', async () => {
    const { env, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'p.png' });
    await softDeleteAsset(env, 's1', asset.assetId);

    const stored = await getStoredAsset(env, 's1', asset.assetId);

    expect(stored?.deleted).toBe(true);
    expect(stored?.r2Key).toBeTruthy();
    // While every library-facing read still treats it as gone.
    expect(await getAsset(env, 's1', asset.assetId)).toBeNull();
    expect(await listAssets(env, 's1')).toHaveLength(0);
  });

  it('R0: will not hand a soft-deleted asset to another site', async () => {
    const { env, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'p.png' });
    await softDeleteAsset(env, 's1', asset.assetId);

    expect(await getStoredAsset(env, 'OTHER', asset.assetId)).toBeNull();
  });
});

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

// Origin and retention against the real engine with both migrations
// applied: the backfill and the default are the migration's behaviour, not ours,
// and a mock would just return whatever we told it to.

describe('asset origin', () => {
  it('backfills a row written without an origin to library', async () => {
    const { env, db } = createTestHarness();

    // Deliberately the pre-origin INSERT, column-for-column: this is what a
    // rolled-back Worker would emit against a migrated database.
    db.prepare(
      'INSERT INTO assets (asset_id, site_id, filename, current_version, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('legacy-1', 'site-1', 'old.png', 'v1', '2025-01-01T00:00:00Z');
    db.prepare(
      'INSERT INTO asset_versions (version_id, asset_id, r2_key, content_type) VALUES (?, ?, ?, ?)',
    ).run('v1', 'legacy-1', 'site-1/assets/legacy-1/v1-old.png', 'image/png');

    const row = db.prepare('SELECT origin, expires_at FROM assets WHERE asset_id = ?').get('legacy-1');
    expect(row).toEqual({ origin: 'library', expires_at: null });

    // And it lists, which is the property that actually matters: the new filter
    // must not hide assets that predate the column.
    const listed = await listAssets(env, 'site-1');
    expect(listed.map((a) => a.assetId)).toContain('legacy-1');
  });

  it('excludes chat uploads from the library listing but keeps them addressable by id', async () => {
    const { env, bucket } = createTestHarness();
    const libraryAsset = await seedAsset(env, bucket, { siteId: 'site-1', filename: 'photo.png' });
    const chatAsset = await seedAsset(env, bucket, {
      siteId: 'site-1', filename: 'brief.md', contentType: 'text/markdown', origin: 'chat',
    });

    const listed = await listAssets(env, 'site-1');
    expect(listed.map((a) => a.assetId)).toEqual([libraryAsset.assetId]);

    // Not hidden, just not in the library — the content route reads it this way.
    expect(await getAsset(env, 'site-1', chatAsset.assetId)).not.toBeNull();
  });

  it('omits origin from a library asset and reports it on a chat one', async () => {
    const { env, bucket } = createTestHarness();
    const libraryAsset = await seedAsset(env, bucket, { siteId: 'site-1', filename: 'photo.png' });
    const chatAsset = await seedAsset(env, bucket, {
      siteId: 'site-1', filename: 'brief.md', contentType: 'text/markdown', origin: 'chat',
    });

    // A library response must be byte-identical to what it was before origins: pinned
    // npm picker versions parse this, and list_media hands it verbatim to a model.
    expect('origin' in libraryAsset).toBe(false);
    expect(chatAsset.origin).toBe('chat');
  });

  it('stamps a chat upload with a 30-day expiry and leaves library assets unexpiring', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
    const { env, bucket, db } = createTestHarness();

    const libraryAsset = await seedAsset(env, bucket, { siteId: 'site-1', filename: 'photo.png' });
    const chatAsset = await seedAsset(env, bucket, {
      siteId: 'site-1', filename: 'brief.md', contentType: 'text/markdown', origin: 'chat',
    });

    const read = (id: string) =>
      db.prepare('SELECT expires_at FROM assets WHERE asset_id = ?').get(id) as { expires_at: string | null };

    expect(read(chatAsset.assetId).expires_at).toBe('2026-03-31T00:00:00.000Z');
    expect(read(libraryAsset.assetId).expires_at).toBeNull();
  });
});

// Promotion and retention. Both turn on SQL guards (origin, expiry) that a
// mock cannot exercise, and the sweep is the only path that deletes user bytes.

// Clearing a conversation purges what it uploaded. An image the user has since added to
// their media library is no longer that, and losing it to an unrelated action is not a
// deletion they asked for.
describe('softDeleteChatAsset', () => {
  it('drops a chat upload', async () => {
    const { env, bucket } = createTestHarness();
    const chat = await seedAsset(env, bucket, { siteId: 'site-1', filename: 'a.png', origin: 'chat' });

    expect(await softDeleteChatAsset(env, 'site-1', chat.assetId)).toBe(true);
  });

  it('leaves an image the user added to the library exactly where it is', async () => {
    const { env, bucket } = createTestHarness();
    const chat = await seedAsset(env, bucket, {
      siteId: 'site-1', filename: 'shot.png', origin: 'chat', contentType: 'image/png',
    });
    await promoteAsset(env, 'site-1', chat.assetId, { alt: 'A pink shoe' });

    expect(await softDeleteChatAsset(env, 'site-1', chat.assetId)).toBe(false);
    expect((await listAssets(env, 'site-1')).map((a) => a.assetId)).toContain(chat.assetId);
  });

  it('will not reach another site\'s asset', async () => {
    const { env, bucket } = createTestHarness();
    const chat = await seedAsset(env, bucket, { siteId: 'site-1', filename: 'a.png', origin: 'chat' });

    expect(await softDeleteChatAsset(env, 'site-2', chat.assetId)).toBe(false);
  });
});

describe('promoteAsset', () => {
  it('flips origin and clears the expiry without moving bytes', async () => {
    const { env, bucket, db } = createTestHarness();
    const chat = await seedAsset(env, bucket, {
      siteId: 'site-1', filename: 'shot.png', origin: 'chat',
    });
    const keysBefore = [...bucket._keys];

    const promoted = await promoteAsset(env, 'site-1', chat.assetId);

    expect(promoted?.origin).toBeUndefined();
    expect([...bucket._keys]).toEqual(keysBefore);
    const row = db.prepare('SELECT origin, expires_at FROM assets WHERE asset_id = ?').get(chat.assetId);
    expect(row).toEqual({ origin: 'library', expires_at: null });

    // And it is now in the library listing, which is the point of promoting.
    expect((await listAssets(env, 'site-1')).map((a) => a.assetId)).toContain(chat.assetId);
  });

  // A chat transcript keeps its reference after the library drops the asset, so adding it
  // back is the one write that must reach a soft-deleted row.
  it('adds back an asset the library deleted, clearing the deletion', async () => {
    const { env, bucket, db } = createTestHarness();
    const chat = await seedAsset(env, bucket, {
      siteId: 'site-1', filename: 'shot.png', origin: 'chat',
    });
    await promoteAsset(env, 'site-1', chat.assetId);
    await softDeleteAsset(env, 'site-1', chat.assetId);

    const restored = await promoteAsset(env, 'site-1', chat.assetId, { alt: 'Back again' });

    expect(restored).not.toBeNull();
    const row = db.prepare('SELECT deleted_at, alt FROM assets WHERE asset_id = ?').get(chat.assetId);
    expect(row).toEqual({ deleted_at: null, alt: 'Back again' });
    expect((await listAssets(env, 'site-1')).map((a) => a.assetId)).toContain(chat.assetId);
  });

  // Promote is the only route that clears deleted_at, and it takes any asset id the site
  // token can name. Without the from_chat guard this call is an undelete for the whole
  // library — a takedown could be reversed by anyone who kept the id.
  it('will not raise a deleted library asset that never came from chat', async () => {
    const { env, bucket, db } = createTestHarness();
    const library = await seedAsset(env, bucket, {
      siteId: 'site-1', filename: 'shot.png', contentType: 'image/png',
    });
    await softDeleteAsset(env, 'site-1', library.assetId);

    expect(await promoteAsset(env, 'site-1', library.assetId)).toBeNull();

    const row = db.prepare('SELECT deleted_at FROM assets WHERE asset_id = ?').get(library.assetId);
    expect((row as { deleted_at: string | null }).deleted_at).not.toBeNull();
    expect((await listAssets(env, 'site-1')).map((a) => a.assetId)).not.toContain(library.assetId);
  });

  // End-to-end through the real SQL, because the wipe this guards against was invisible at
  // the store layer: promoteAsset was handed {} and did exactly what it was told.
  it('keeps the details of an image re-added through the handler with a blank form', async () => {
    const { env, bucket, db } = createTestHarness();
    const chat = await seedAsset(env, bucket, {
      siteId: 'site-1', filename: 'shot.png', origin: 'chat', contentType: 'image/png',
    });
    const promote = (metadata: Record<string, string>) =>
      handlePromote(
        new Request(`https://w.test/media/${chat.assetId}/promote?siteId=site-1`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metadata }),
        }),
        env, 'site-1', chat.assetId,
      );

    await promote({ alt: 'A pink shoe', caption: 'Puzzle' });
    await softDeleteAsset(env, 'site-1', chat.assetId);
    await promote({ alt: '', caption: '' });

    const row = db.prepare('SELECT alt, metadata FROM assets WHERE asset_id = ?').get(chat.assetId);
    expect(row).toEqual({ alt: 'A pink shoe', metadata: '{"caption":"Puzzle"}' });
  });

  it('will not promote another site\'s asset', async () => {
    const { env, bucket } = createTestHarness();
    const chat = await seedAsset(env, bucket, { siteId: 'site-1', filename: 'a.png', origin: 'chat' });
    expect(await promoteAsset(env, 'site-2', chat.assetId)).toBeNull();
  });
});

describe('chat retention sweep', () => {
  async function seedExpired(env: Env, bucket: MockBucket, siteId = 'site-1') {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const asset = await seedAsset(env, bucket, { siteId, filename: 'old.md', contentType: 'text/markdown', origin: 'chat' });
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z')); // well past 30 days
    return asset;
  }

  it('finds an aged-out chat upload and a cleared one, but not a live one', async () => {
    const { env, bucket } = createTestHarness();
    const expired = await seedExpired(env, bucket);
    const live = await seedAsset(env, bucket, { siteId: 'site-1', filename: 'new.md', contentType: 'text/markdown', origin: 'chat' });
    const cleared = await seedAsset(env, bucket, { siteId: 'site-1', filename: 'gone.md', contentType: 'text/markdown', origin: 'chat' });
    await softDeleteAsset(env, 'site-1', cleared.assetId);

    const found = (await findExpiredChatAssets(env, new Date().toISOString(), 100)).assets.map((a) => a.assetId);

    expect(found).toContain(expired.assetId);
    expect(found).toContain(cleared.assetId); // clearing a conversation needs no new endpoint
    expect(found).not.toContain(live.assetId);
  });

  it('never collects a library asset, even one carrying a stray expiry', async () => {
    const { env, bucket, db } = createTestHarness();
    const library = await seedAsset(env, bucket, { siteId: 'site-1', filename: 'keep.png' });
    db.prepare('UPDATE assets SET expires_at = ? WHERE asset_id = ?').run('2020-01-01T00:00:00.000Z', library.assetId);

    const found = await findExpiredChatAssets(env, new Date().toISOString(), 100);
    expect(found).toEqual({ assets: [], total: 0 });
  });

  it('deletes nothing while RECONCILE_DRY_RUN is unset', async () => {
    const { env, bucket } = createTestHarness();
    const expired = await seedExpired(env, bucket);

    const result = await sweepExpiredChatAssets(env);

    expect(result).toEqual({ candidates: 1, deleted: 0, deferred: 0, failed: 0, dryRun: true });
    expect(await getAsset(env, 'site-1', expired.assetId)).not.toBeNull();
    expect(bucket._keys.size).toBe(1);
  });

  it('removes both D1 rows and the R2 object when armed', async () => {
    const { env, bucket, db } = createTestHarness();
    const expired = await seedExpired(env, bucket);

    const result = await sweepExpiredChatAssets({ ...env, RECONCILE_DRY_RUN: 'false' });

    expect(result).toEqual({ candidates: 1, deleted: 1, deferred: 0, failed: 0, dryRun: false });
    expect(countRows(db, 'assets')).toBe(0);
    expect(countRows(db, 'asset_versions')).toBe(0);
    expect(bucket._keys.size).toBe(0);
    expect(expired.assetId).toBeTruthy();
  });

  it('caps deletions per run and reports what it deferred', async () => {
    const { env, bucket, db } = createTestHarness();
    const total = 201; // one past MAX_CHAT_DELETIONS_PER_RUN
    for (let i = 0; i < total; i++) {
      const key = `site-1/assets/a${i}/v1-old.md`;
      await bucket.put(key, 'x', { httpMetadata: { contentType: 'text/markdown' } });
      db.prepare(
        'INSERT INTO assets (asset_id, site_id, filename, current_version, created_at, origin, expires_at) ' +
          "VALUES (?, 'site-1', 'old.md', 'v1', '2026-01-01T00:00:00Z', 'chat', '2026-01-31T00:00:00Z')",
      ).run(`a${i}`);
      db.prepare('INSERT INTO asset_versions (version_id, asset_id, r2_key, content_type) VALUES (?, ?, ?, ?)')
        .run('v1', `a${i}`, key, 'text/markdown');
    }

    const result = await sweepExpiredChatAssets({ ...env, RECONCILE_DRY_RUN: 'false' });

    expect(result.candidates).toBe(total);
    expect(result.deleted).toBe(200);
    expect(result.deferred).toBe(1);
    // The remainder is still there for the next run, not silently dropped.
    expect(countRows(db, 'assets')).toBe(1);
  });

  // One unreachable object used to abort the invocation, taking the orphan reconcile job
  // down with it. The cron is hourly, so a persistent fault retired both jobs silently.
  it('keeps going when one asset fails to delete, and reports it', async () => {
    const { env, bucket, db } = createTestHarness();
    await seedExpired(env, bucket);
    const second = await seedExpired(env, bucket);
    const realDelete = bucket.delete.bind(bucket);
    let calls = 0;
    bucket.delete = async (key: string) => {
      calls += 1;
      if (calls === 1) throw new Error('R2 unavailable');
      return realDelete(key);
    };

    const result = await sweepExpiredChatAssets({ ...env, RECONCILE_DRY_RUN: 'false' });

    expect(result.candidates).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(1);
    expect(second.assetId).toBeTruthy();
    // Its row is already gone, so this sweep never sees it again; the bytes are left for
    // handleReconcile to collect as an orphan.
    expect(countRows(db, 'assets')).toBe(0);
    expect(bucket._keys.size).toBe(1);
  });

  // The sweep selects, then deletes. A promote landing in between must win: the
  // asset is now a library asset and its bytes are load-bearing.
  it('leaves an asset promoted between select and delete completely intact', async () => {
    const { env, bucket, db } = createTestHarness();
    const expired = await seedExpired(env, bucket);

    const candidates = await findExpiredChatAssets(env, new Date().toISOString(), 100);
    expect(candidates.assets).toHaveLength(1);

    await promoteAsset(env, 'site-1', expired.assetId);

    expect(await hardDeleteChatAsset(env, expired.assetId)).toBe(false);
    expect(countRows(db, 'assets')).toBe(1);
    // The guard has to hold on BOTH statements — losing the versions row would leave
    // an asset that getAsset can no longer join, i.e. silently unreadable.
    expect(countRows(db, 'asset_versions')).toBe(1);
    expect(await getAsset(env, 'site-1', expired.assetId)).not.toBeNull();
  });
});
