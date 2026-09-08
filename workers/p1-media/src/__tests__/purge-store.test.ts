import { describe, it, expect } from 'vitest';
import {
  getAssetSiteId,
  listAssetR2Keys,
  hardDeleteAssetRows,
  insertPurgeIntent,
  completePurgeAudit,
  findCompletedPurge,
} from '../purge-store';
import { finalizeVersionAdd, softDeleteAsset } from '../store';
import { createTestHarness, countRows, seedAsset } from './d1-test-harness';

// Purge store ops against real SQLite (see d1-test-harness.ts for why): purge must
// see soft-deleted rows and superseded versions — behaviors a hand-mock would just
// parrot back — and the CHECK constraints in migration 0002 only exist in the real
// schema.

function makeIntent(assetId: string, overrides: Record<string, unknown> = {}) {
  return {
    purgeId: crypto.randomUUID(),
    assetId,
    siteId: 's1',
    requestedById: 'nick@example.com',
    requestedByType: 'user' as const,
    reason: 'DMCA takedown',
    r2Keys: ['s1/assets/a/v1-x.png'],
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('getAssetSiteId', () => {
  it('resolves a soft-deleted asset — a takedown after DELETE is the expected sequence', async () => {
    const { env, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'p.png' });
    expect(await softDeleteAsset(env, 's1', asset.assetId)).toBe(true);

    expect(await getAssetSiteId(env, asset.assetId)).toBe('s1');
  });

  it('returns null for an unknown asset', async () => {
    const { env } = createTestHarness();
    expect(await getAssetSiteId(env, 'nope')).toBeNull();
  });
});

describe('listAssetR2Keys', () => {
  it('returns every version including superseded ones, not just current_version', async () => {
    const { env, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'v1.png' });
    await finalizeVersionAdd(env, {
      siteId: 's1', assetId: asset.assetId, versionId: 'v2',
      filename: 'v2.png', contentType: 'image/png', size: 2,
    });

    const keys = await listAssetR2Keys(env, asset.assetId);
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.versionId)).toEqual(
      expect.arrayContaining([asset.versionId, 'v2']),
    );
  });

  it('returns an empty list for an unknown asset', async () => {
    const { env } = createTestHarness();
    expect(await listAssetR2Keys(env, 'nope')).toEqual([]);
  });
});

describe('hardDeleteAssetRows', () => {
  it('removes the asset row and every version row, and only the target asset', async () => {
    const { env, db, bucket } = createTestHarness();
    const target = await seedAsset(env, bucket, { siteId: 's1', filename: 'a.png' });
    await finalizeVersionAdd(env, {
      siteId: 's1', assetId: target.assetId, versionId: 'v2',
      filename: 'a2.png', contentType: 'image/png', size: 2,
    });
    const bystander = await seedAsset(env, bucket, { siteId: 's1', filename: 'b.png' });

    const removed = await hardDeleteAssetRows(env, target.assetId);
    expect(removed).toBe(2);
    expect(countRows(db, 'assets')).toBe(1);
    expect(countRows(db, 'asset_versions')).toBe(1);
    expect(await getAssetSiteId(env, bystander.assetId)).toBe('s1');
  });

  it('is idempotent: a second call reports 0 rows and changes nothing', async () => {
    const { env, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'a.png' });

    expect(await hardDeleteAssetRows(env, asset.assetId)).toBe(1);
    expect(await hardDeleteAssetRows(env, asset.assetId)).toBe(0);
  });

  it('deletes an already-soft-deleted asset', async () => {
    const { env, db, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'a.png' });
    await softDeleteAsset(env, 's1', asset.assetId);

    expect(await hardDeleteAssetRows(env, asset.assetId)).toBe(1);
    expect(countRows(db, 'assets')).toBe(0);
  });
});

describe('purge_audit round-trip', () => {
  it('writes an intent row that outlives the asset, then completes it', async () => {
    const { env, db, bucket } = createTestHarness();
    const asset = await seedAsset(env, bucket, { siteId: 's1', filename: 'a.png' });
    const intent = makeIntent(asset.assetId, { r2Keys: ['k1', 'k2'] });

    await insertPurgeIntent(env, intent);
    await hardDeleteAssetRows(env, asset.assetId);
    await completePurgeAudit(env, intent.purgeId, {
      status: 'completed',
      r2Deleted: 2,
      r2Failed: 0,
      versionsDeleted: 1,
      cachePurgeOutcome: 'success',
      error: null,
    });

    const row = db
      .prepare('SELECT * FROM purge_audit WHERE purge_id = ?')
      .get(intent.purgeId) as Record<string, unknown>;
    expect(row.asset_id).toBe(asset.assetId);
    expect(row.status).toBe('completed');
    expect(row.r2_deleted).toBe(2);
    expect(row.versions_deleted).toBe(1);
    expect(row.cache_purge_outcome).toBe('success');
    expect(JSON.parse(row.r2_keys as string)).toEqual(['k1', 'k2']);
    expect(row.completed_at).not.toBeNull();
  });

  it('rejects an invalid requested_by_type via the CHECK constraint', async () => {
    const { env } = createTestHarness();
    await expect(
      insertPurgeIntent(env, makeIntent('a', { requestedByType: 'robot' as never })),
    ).rejects.toThrow();
  });

  it('rejects an invalid status via the CHECK constraint', async () => {
    const { env } = createTestHarness();
    const intent = makeIntent('a');
    await insertPurgeIntent(env, intent);
    await expect(
      completePurgeAudit(env, intent.purgeId, {
        status: 'done' as never,
        r2Deleted: 0,
        r2Failed: 0,
        versionsDeleted: 0,
        cachePurgeOutcome: null,
        error: null,
      }),
    ).rejects.toThrow();
  });
});

describe('findCompletedPurge', () => {
  it('ignores intent and partial rows — a stale intent must not short-circuit a retry', async () => {
    const { env } = createTestHarness();
    const intent = makeIntent('asset-x');
    await insertPurgeIntent(env, intent);
    expect(await findCompletedPurge(env, 'asset-x')).toBeNull();

    await completePurgeAudit(env, intent.purgeId, {
      status: 'partial',
      r2Deleted: 1,
      r2Failed: 1,
      versionsDeleted: 0,
      cachePurgeOutcome: null,
      error: '1 R2 deletes failed',
    });
    expect(await findCompletedPurge(env, 'asset-x')).toBeNull();
  });

  it('returns the completed purge for an asset whose rows are gone', async () => {
    const { env } = createTestHarness();
    const intent = makeIntent('asset-x');
    await insertPurgeIntent(env, intent);
    await completePurgeAudit(env, intent.purgeId, {
      status: 'completed',
      r2Deleted: 1,
      r2Failed: 0,
      versionsDeleted: 1,
      cachePurgeOutcome: 'skipped',
      error: null,
    });

    expect(await findCompletedPurge(env, 'asset-x')).toEqual({
      purgeId: intent.purgeId,
      siteId: 's1',
    });
  });
});
