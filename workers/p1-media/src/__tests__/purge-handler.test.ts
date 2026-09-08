import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePurge } from '../handlers/purge';
import type { Env } from '../types';

// Handler tests: request parsing, the auth gate, ordering, and status mapping. The
// SQL behind the store helpers is covered against real SQLite in store-ops.test.ts;
// the cache purge module is covered in edge-cache.test.ts.
vi.mock('../purge-store', () => ({
  getAssetSiteId: vi.fn(),
  listAssetR2Keys: vi.fn(),
  hardDeleteAssetRows: vi.fn(),
  insertPurgeIntent: vi.fn(),
  completePurgeAudit: vi.fn(),
  findCompletedPurge: vi.fn(),
}));
vi.mock('../cache/purge', () => ({ purgeAssetCache: vi.fn() }));

import {
  getAssetSiteId,
  listAssetR2Keys,
  hardDeleteAssetRows,
  insertPurgeIntent,
  completePurgeAudit,
  findCompletedPurge,
} from '../purge-store';
import { purgeAssetCache } from '../cache/purge';

const TOKEN = 'operator-secret';
const ASSET = 'asset-1';
const KEYS = [
  { versionId: 'v1', r2Key: 'site1/assets/asset-1/v1-a.png' },
  { versionId: 'v2', r2Key: 'site1/assets/asset-1/v2-b.png' },
];

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    MEDIA_BUCKET: { delete: vi.fn(async () => undefined) } as unknown as R2Bucket,
    MEDIA_DB: {} as D1Database,
    CCR_BASE_URL: 'https://ccr.example.com',
    CDN_BASE_URL: 'https://cdn.example.com/image',
    IMAGES: {} as ImagesBinding,
    R2_ACCESS_KEY_ID: 'k',
    R2_SECRET_ACCESS_KEY: 's',
    R2_ACCOUNT_ID: 'a',
    R2_BUCKET_NAME: 'b',
    PURGE_ADMIN_TOKEN: TOKEN,
    ...overrides,
  };
}

const GOOD_BODY = {
  requestedBy: 'nick@example.com',
  requestedByType: 'user',
  reason: 'DMCA takedown LEGAL-1234',
};

function purgeReq(opts: { token?: string | null; body?: unknown } = {}): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = opts.token === undefined ? TOKEN : opts.token;
  if (token !== null) headers.set('X-Purge-Token', token);
  return new Request(`https://w.example.com/media/${ASSET}/purge`, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body === undefined ? GOOD_BODY : opts.body),
  });
}

function nothingDestroyed(env: Env): void {
  expect(env.MEDIA_BUCKET.delete).not.toHaveBeenCalled();
  expect(hardDeleteAssetRows).not.toHaveBeenCalled();
  expect(insertPurgeIntent).not.toHaveBeenCalled();
  expect(purgeAssetCache).not.toHaveBeenCalled();
}

describe('handlePurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAssetSiteId).mockResolvedValue('site1');
    vi.mocked(listAssetR2Keys).mockResolvedValue(KEYS);
    vi.mocked(hardDeleteAssetRows).mockResolvedValue(KEYS.length);
    vi.mocked(insertPurgeIntent).mockResolvedValue(undefined);
    vi.mocked(completePurgeAudit).mockResolvedValue(undefined);
    vi.mocked(findCompletedPurge).mockResolvedValue(null);
    vi.mocked(purgeAssetCache).mockResolvedValue('success');
  });

  // ---- the token gate: fail closed ----

  it('returns 503 and destroys nothing when PURGE_ADMIN_TOKEN is unset', async () => {
    const env = createEnv({ PURGE_ADMIN_TOKEN: undefined });
    const response = await handlePurge(purgeReq(), env, ASSET);
    expect(response.status).toBe(503);
    nothingDestroyed(env);
  });

  it('returns 503 when the configured secret is empty — never "empty matches empty"', async () => {
    const env = createEnv({ PURGE_ADMIN_TOKEN: '' });
    const response = await handlePurge(purgeReq({ token: '' }), env, ASSET);
    expect(response.status).toBe(503);
    nothingDestroyed(env);
  });

  it('returns 401 with no token header, before anything is read', async () => {
    const env = createEnv();
    const response = await handlePurge(purgeReq({ token: null }), env, ASSET);
    expect(response.status).toBe(401);
    expect(getAssetSiteId).not.toHaveBeenCalled();
    nothingDestroyed(env);
  });

  it('returns 401 for a wrong token and for a prefix of the real token', async () => {
    const env = createEnv();
    expect((await handlePurge(purgeReq({ token: 'wrong' }), env, ASSET)).status).toBe(401);
    expect((await handlePurge(purgeReq({ token: TOKEN.slice(0, -1) }), env, ASSET)).status).toBe(401);
    nothingDestroyed(env);
  });

  // ---- body validation: reject before any write ----

  it.each([
    ['non-JSON body', 'not json'],
    ['array body', []],
    ['missing requestedBy', { reason: 'r' }],
    ['blank requestedBy', { ...GOOD_BODY, requestedBy: '   ' }],
    ['bad requestedByType', { ...GOOD_BODY, requestedByType: 'robot' }],
    ['missing reason', { requestedBy: 'nick@example.com' }],
    ['overlong reason', { ...GOOD_BODY, reason: 'x'.repeat(1001) }],
    ['unknown field', { ...GOOD_BODY, siteId: 'site1' }],
  ])('returns 400 for %s without destroying anything', async (_label, body) => {
    const env = createEnv();
    const request =
      body === 'not json'
        ? new Request(`https://w.example.com/media/${ASSET}/purge`, {
            method: 'POST',
            headers: { 'X-Purge-Token': TOKEN },
            body: 'not json',
          })
        : purgeReq({ body });
    const response = await handlePurge(request, env, ASSET);
    expect(response.status).toBe(400);
    nothingDestroyed(env);
  });

  it('bundles every validation problem into one 400 response', async () => {
    const env = createEnv();
    const response = await handlePurge(
      purgeReq({ body: { requestedByType: 'robot', extra: 'nope' } }),
      env,
      ASSET,
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { errors: string[] };
    // One round trip reports all four problems, not just the first.
    expect(payload.errors).toHaveLength(4);
    expect(payload.errors.join(' ')).toContain('unknown field: extra');
    expect(payload.errors.join(' ')).toContain('requestedBy is required');
    expect(payload.errors.join(' ')).toContain('requestedByType');
    expect(payload.errors.join(' ')).toContain('reason is required');
    nothingDestroyed(env);
  });

  // ---- the happy path, and its ordering ----

  it('purges every version, then rows, then cache, and completes the audit', async () => {
    const env = createEnv();
    const response = await handlePurge(purgeReq(), env, ASSET);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.status).toBe('completed');
    expect(payload.r2Deleted).toBe(2);
    expect(payload.versionsDeleted).toBe(2);
    expect(payload.cachePurge).toBe('success');
    expect(payload.siteId).toBe('site1');

    // Every version's key — including superseded ones — in one chunked call.
    expect(env.MEDIA_BUCKET.delete).toHaveBeenCalledWith(KEYS.map((k) => k.r2Key));
    expect(hardDeleteAssetRows).toHaveBeenCalledWith(env, ASSET);
    expect(purgeAssetCache).toHaveBeenCalledWith('site1', ASSET);

    // Intent row precedes destruction; completion records the outcome.
    expect(insertPurgeIntent).toHaveBeenCalledBefore(vi.mocked(env.MEDIA_BUCKET.delete));
    expect(vi.mocked(insertPurgeIntent).mock.calls[0][1]).toMatchObject({
      assetId: ASSET,
      siteId: 'site1',
      requestedById: 'nick@example.com',
      requestedByType: 'user',
      reason: 'DMCA takedown LEGAL-1234',
      r2Keys: KEYS.map((k) => k.r2Key),
    });
    expect(vi.mocked(completePurgeAudit).mock.calls[0][2]).toMatchObject({
      status: 'completed',
      r2Deleted: 2,
      versionsDeleted: 2,
      cachePurgeOutcome: 'success',
    });
  });

  it('aborts with 500 and destroys nothing when the audit intent row cannot be written', async () => {
    const env = createEnv();
    vi.mocked(insertPurgeIntent).mockRejectedValue(new Error('D1 down'));
    const response = await handlePurge(purgeReq(), env, ASSET);
    expect(response.status).toBe(500);
    expect(env.MEDIA_BUCKET.delete).not.toHaveBeenCalled();
    expect(hardDeleteAssetRows).not.toHaveBeenCalled();
  });

  // ---- partial failures ----

  it('returns 500 partial and KEEPS the D1 rows when an R2 delete fails', async () => {
    const env = createEnv({
      MEDIA_BUCKET: {
        delete: vi.fn(async () => {
          throw new Error('R2 down');
        }),
      } as unknown as R2Bucket,
    });
    const response = await handlePurge(purgeReq(), env, ASSET);
    expect(response.status).toBe(500);
    expect(((await response.json()) as Record<string, unknown>).status).toBe('partial');
    // The version rows are the index of the surviving keys — they must survive too.
    expect(hardDeleteAssetRows).not.toHaveBeenCalled();
    expect(purgeAssetCache).not.toHaveBeenCalled();
    expect(vi.mocked(completePurgeAudit).mock.calls[0][2]).toMatchObject({
      status: 'partial',
      r2Failed: 2,
    });
  });

  it('returns 500 partial when the D1 row delete fails after bytes are gone', async () => {
    const env = createEnv();
    vi.mocked(hardDeleteAssetRows).mockRejectedValue(new Error('D1 down'));
    const response = await handlePurge(purgeReq(), env, ASSET);
    expect(response.status).toBe(500);
    expect(((await response.json()) as Record<string, unknown>).status).toBe('partial');
    expect(vi.mocked(completePurgeAudit).mock.calls[0][2]).toMatchObject({ status: 'partial' });
  });

  it('still returns 200 when the cache purge fails — destruction already committed', async () => {
    const env = createEnv();
    vi.mocked(purgeAssetCache).mockResolvedValue('failed');
    const response = await handlePurge(purgeReq(), env, ASSET);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.status).toBe('completed');
    expect(payload.cachePurge).toBe('failed');
  });

  it('does not fail the purge when the audit completion update fails', async () => {
    const env = createEnv();
    vi.mocked(completePurgeAudit).mockRejectedValue(new Error('D1 blip'));
    const response = await handlePurge(purgeReq(), env, ASSET);
    expect(response.status).toBe(200);
  });

  // ---- idempotency and unknown assets ----

  it('answers 200 alreadyPurged for a re-purge: no destructive calls, but the cache purge re-runs', async () => {
    const env = createEnv();
    vi.mocked(getAssetSiteId).mockResolvedValue(null);
    vi.mocked(listAssetR2Keys).mockResolvedValue([]);
    vi.mocked(findCompletedPurge).mockResolvedValue({ purgeId: 'prior-purge', siteId: 'site1' });

    const response = await handlePurge(purgeReq(), env, ASSET);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.alreadyPurged).toBe(true);
    expect(payload.purgeId).toBe('prior-purge');
    expect(payload.cachePurge).toBe('success');
    // Nothing destructive re-runs...
    expect(env.MEDIA_BUCKET.delete).not.toHaveBeenCalled();
    expect(hardDeleteAssetRows).not.toHaveBeenCalled();
    expect(insertPurgeIntent).not.toHaveBeenCalled();
    // ...but the tag purge does: a completed purge whose cache step failed must not
    // be unrecoverable — re-running has to be able to finish evicting.
    expect(purgeAssetCache).toHaveBeenCalledWith('site1', ASSET);
  });

  it('returns 404 for an unknown asset with no purge history, writing no audit row', async () => {
    const env = createEnv();
    vi.mocked(getAssetSiteId).mockResolvedValue(null);
    vi.mocked(listAssetR2Keys).mockResolvedValue([]);

    const response = await handlePurge(purgeReq(), env, ASSET);
    expect(response.status).toBe(404);
    nothingDestroyed(env);
  });
});
