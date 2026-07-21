import { describe, it, expect } from 'vitest';
import { createTestHarness, seedAsset } from './d1-test-harness';
import { buildKey, finalizeVersionAdd, softDeleteAsset } from '../store';
import { handleReconcile } from '../handlers/reconcile';

const HOUR_MS = 60 * 60 * 1000;
const OLD = new Date(Date.now() - 25 * HOUR_MS); // past the 24h cutoff
const RECENT = new Date(Date.now() - 1 * HOUR_MS); // within the cutoff

describe('handleReconcile', () => {
  it('defaults to dry-run: logs an old orphan as a candidate but does not delete it', async () => {
    const { env, bucket } = createTestHarness();
    await bucket.put('s1/assets/orphan/v1-photo.png', 'x');
    bucket._backdate('s1/assets/orphan/v1-photo.png', OLD);

    const result = await handleReconcile(env);

    expect(result).toEqual({ candidates: 1, deleted: 0, dryRun: true });
    expect(bucket._keys.has('s1/assets/orphan/v1-photo.png')).toBe(true);
  });

  it('treats any RECONCILE_DRY_RUN value other than the literal string "false" as dry-run (fail safe)', async () => {
    const { env, bucket } = createTestHarness();
    await bucket.put('s1/assets/orphan/v1-photo.png', 'x');
    bucket._backdate('s1/assets/orphan/v1-photo.png', OLD);

    for (const value of [undefined, 'true', 'yes', '1', 'False', '']) {
      const result = await handleReconcile({ ...env, RECONCILE_DRY_RUN: value });
      expect(result.dryRun).toBe(true);
      expect(result.deleted).toBe(0);
    }
  });

  it('deletes an orphan older than the cutoff when RECONCILE_DRY_RUN=false', async () => {
    const { env, bucket } = createTestHarness();
    await bucket.put('s1/assets/orphan/v1-photo.png', 'x');
    bucket._backdate('s1/assets/orphan/v1-photo.png', OLD);

    const result = await handleReconcile({ ...env, RECONCILE_DRY_RUN: 'false' });

    expect(result).toEqual({ candidates: 1, deleted: 1, dryRun: false });
    expect(bucket._keys.has('s1/assets/orphan/v1-photo.png')).toBe(false);
  });

  it('never touches an object referenced by asset_versions, no matter how old', async () => {
    const { env, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'p.png' });
    const key = buildKey('s1', asset.assetId, asset.versionId, 'p.png');
    bucket._backdate(key, OLD); // as old as an orphan would be — must still survive

    const result = await handleReconcile({ ...env, RECONCILE_DRY_RUN: 'false' });

    expect(result).toEqual({ candidates: 0, deleted: 0, dryRun: false });
    expect(bucket._keys.has(key)).toBe(true);
  });

  it('never touches a superseded (non-current) version, referenced only by an older asset_versions row', async () => {
    const { env, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'v1.png' });
    const oldKey = buildKey('s1', asset.assetId, asset.versionId, 'v1.png');
    // Replace with a new current version — the old row (and its R2 key) is retained,
    // per the immutable-history design (a document that pinned it keeps serving).
    const newKey = buildKey('s1', asset.assetId, 'v2', 'v2.png');
    await bucket.put(newKey, 'y');
    await finalizeVersionAdd(env, {
      siteId: 's1', assetId: asset.assetId, versionId: 'v2', filename: 'v2.png', contentType: 'image/png', size: 1,
    });
    bucket._backdate(oldKey, OLD);

    const result = await handleReconcile({ ...env, RECONCILE_DRY_RUN: 'false' });

    expect(result.deleted).toBe(0);
    expect(bucket._keys.has(oldKey)).toBe(true);
  });

  it('never touches a version belonging to a soft-deleted asset', async () => {
    const { env, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'p.png' });
    const key = buildKey('s1', asset.assetId, asset.versionId, 'p.png');
    bucket._backdate(key, OLD);
    await softDeleteAsset(env, 's1', asset.assetId);

    const result = await handleReconcile({ ...env, RECONCILE_DRY_RUN: 'false' });

    expect(result.deleted).toBe(0);
    expect(bucket._keys.has(key)).toBe(true);
  });

  it('does not touch an unreferenced object younger than the cutoff — it might still be finalizing', async () => {
    const { env, bucket } = createTestHarness();
    await bucket.put('s1/assets/in-flight/v1-photo.png', 'x');
    bucket._backdate('s1/assets/in-flight/v1-photo.png', RECENT);

    const result = await handleReconcile({ ...env, RECONCILE_DRY_RUN: 'false' });

    expect(result).toEqual({ candidates: 0, deleted: 0, dryRun: false });
    expect(bucket._keys.has('s1/assets/in-flight/v1-photo.png')).toBe(true);
  });

  it('walks every page of a paginated bucket listing', async () => {
    const { env, bucket } = createTestHarness({ bucketPageSize: 1 });
    await bucket.put('a-orphan', 'x');
    await bucket.put('b-orphan', 'x');
    await bucket.put('c-orphan', 'x');
    bucket._backdate('a-orphan', OLD);
    bucket._backdate('b-orphan', OLD);
    bucket._backdate('c-orphan', OLD);

    const result = await handleReconcile({ ...env, RECONCILE_DRY_RUN: 'false' });

    // 3 keys over a 1-object-per-page bucket forces 3 list() calls via the cursor loop.
    expect(result).toEqual({ candidates: 3, deleted: 3, dryRun: false });
    expect(bucket._keys.size).toBe(0);
  });

  it('re-checks D1 fresh immediately before deleting, so a finalize that commits after the initial snapshot survives', async () => {
    const { env, bucket } = createTestHarness();
    const key = 's1/assets/late-asset/late-version-photo.png';
    await bucket.put(key, 'x');
    bucket._backdate(key, OLD);

    const realPrepare = env.MEDIA_DB.prepare.bind(env.MEDIA_DB);
    const patchedDb = {
      prepare(sql: string) {
        const stmt = realPrepare(sql);
        // Only the initial bulk snapshot query is patched — the per-candidate recheck
        // this test exists to prove uses a different (parameterized) SQL string, so it
        // always sees the database as it stands at the moment it actually runs.
        if (sql !== 'SELECT r2_key FROM asset_versions') return stmt;
        const originalAll = stmt.all.bind(stmt);
        stmt.all = (async (...args: unknown[]) => {
          const staleSnapshot = await originalAll(...(args as []));
          // Simulate a finalize committing its D1 row for this exact key concurrently:
          // logically "after" the snapshot above already captured its (stale) result,
          // but before reconcile's R2 traversal reaches this key.
          await realPrepare(
            'INSERT INTO assets (asset_id, site_id, filename, meta_schema_version, current_version, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          ).bind('late-asset', 's1', 'photo.png', 1, 'late-version', new Date().toISOString()).run();
          await realPrepare(
            'INSERT INTO asset_versions (version_id, asset_id, r2_key, content_type, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)',
          ).bind('late-version', 'late-asset', key, 'image/png', 1, new Date().toISOString()).run();
          return staleSnapshot;
        }) as typeof stmt.all;
        return stmt;
      },
    } as unknown as D1Database;

    const result = await handleReconcile({ ...env, MEDIA_DB: patchedDb, RECONCILE_DRY_RUN: 'false' });

    expect(result.deleted).toBe(0);
    expect(bucket._keys.has(key)).toBe(true);
  });
});
