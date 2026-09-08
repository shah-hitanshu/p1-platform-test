import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Resolves to the stub in stubs/cloudflare-workers.ts (vitest.config.ts alias). The
// stub's `exports` map is mutable, which is how these tests install and remove the
// CachedImage loopback binding. The cast matches: tsc sees the real (opaque) Exports
// declaration while the runtime object here is the stub's plain record.
import { exports as cfExports } from 'cloudflare:workers';

const workerExports = cfExports as unknown as Record<string, unknown>;
import { siteTag, assetTag, imageCacheTags, assetIdFromKey } from '../cache/image-cache';
import { cacheKeyImageUrl, parseImagePath, handleImage } from '../handlers/image';
import { forwardToCachedImage } from '../cache/forward';
import { purgeAssetCache } from '../cache/purge';
import { CachedImage } from '../entrypoints/cached-image';
import type { Env } from '../types';

function createEnv(bucket?: R2Bucket): Env {
  return {
    MEDIA_BUCKET: bucket ?? ({ get: vi.fn(async () => null) } as unknown as R2Bucket),
    MEDIA_DB: {} as D1Database,
    CCR_BASE_URL: 'http://localhost:8787',
    CDN_BASE_URL: 'http://localhost:8788/image',
    IMAGES: {} as ImagesBinding,
    R2_ACCESS_KEY_ID: 'k',
    R2_SECRET_ACCESS_KEY: 's',
    R2_ACCOUNT_ID: 'a',
    R2_BUCKET_NAME: 'b',
  };
}

function bucketWith(key: string): R2Bucket {
  return {
    get: vi.fn(async (k: string) =>
      k === key
        ? { body: 'raw-bytes', httpMetadata: { contentType: 'image/png' }, size: 3 }
        : null,
    ),
  } as unknown as R2Bucket;
}

const KEY = 'site1/assets/asset-1/v1-photo.png';

// ---------------------------------------------------------------------------
// Tag taxonomy — the literal format is load-bearing: serving stamps these on
// responses and purge targets them, so a silent format change breaks every purge.
// ---------------------------------------------------------------------------

describe('image cache tags', () => {
  it('produces stable tag formats', () => {
    expect(siteTag('site1')).toBe('site:site1');
    expect(assetTag('asset-1')).toBe('asset:asset-1');
    expect(imageCacheTags('site1', 'asset-1')).toEqual(['site:site1', 'asset:asset-1']);
  });

  it('extracts the assetId from a canonical key', () => {
    expect(assetIdFromKey('site1/assets/asset-1/v1-photo.png')).toBe('asset-1');
  });

  it('returns null for keys that do not match the canonical shape', () => {
    expect(assetIdFromKey('site1/other/asset-1/v1-photo.png')).toBeNull();
    expect(assetIdFromKey('site1/assets/x')).toBeNull();
    expect(assetIdFromKey('site1/assets//v1-photo.png')).toBeNull();
    expect(assetIdFromKey('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseImagePath / cacheKeyImageUrl
// ---------------------------------------------------------------------------

describe('parseImagePath', () => {
  it('splits an /image/* path into siteId and full key', () => {
    expect(parseImagePath(`/image/${KEY}`)).toEqual({ siteId: 'site1', key: KEY });
  });

  it('returns null for a keyless path or a non-image path', () => {
    expect(parseImagePath('/image/justkey')).toBeNull();
    expect(parseImagePath('/media/abc')).toBeNull();
  });
});

describe('cacheKeyImageUrl', () => {
  it('resolves format=auto from the Accept header into the URL', () => {
    const request = new Request(`https://w.example.com/image/${KEY}?width=100&format=auto`, {
      headers: { Accept: 'image/avif,image/webp,*/*' },
    });
    expect(new URL(cacheKeyImageUrl(request)).searchParams.get('format')).toBe('avif');
  });

  it('resolves a missing format on a transform request from Accept', () => {
    const request = new Request(`https://w.example.com/image/${KEY}?width=100`, {
      headers: { Accept: 'image/webp' },
    });
    expect(new URL(cacheKeyImageUrl(request)).searchParams.get('format')).toBe('webp');
  });

  it('falls back to jpeg when Accept offers neither avif nor webp', () => {
    const request = new Request(`https://w.example.com/image/${KEY}?width=100`);
    expect(new URL(cacheKeyImageUrl(request)).searchParams.get('format')).toBe('jpeg');
  });

  it('leaves an explicit format untouched', () => {
    const request = new Request(`https://w.example.com/image/${KEY}?width=100&format=png`, {
      headers: { Accept: 'image/avif' },
    });
    expect(new URL(cacheKeyImageUrl(request)).searchParams.get('format')).toBe('png');
  });

  it('does not add a format to a raw (no-transform) request', () => {
    const request = new Request(`https://w.example.com/image/${KEY}`, {
      headers: { Accept: 'image/avif' },
    });
    expect(new URL(cacheKeyImageUrl(request)).searchParams.has('format')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleImage cache headers added by this layer
// ---------------------------------------------------------------------------

describe('handleImage cache tagging', () => {
  it('stamps Cache-Tag with the site and asset tags for a canonical key', async () => {
    const env = createEnv(bucketWith(KEY));
    const response = await handleImage(
      new Request(`https://w.example.com/image/${KEY}`),
      env,
      'site1',
      KEY,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Tag')).toBe('site:site1,asset:asset-1');
  });

  it('omits Cache-Tag for a key that is not asset-shaped', async () => {
    const key = 'site1/legacy/photo.png';
    const env = createEnv(bucketWith(key));
    const response = await handleImage(
      new Request(`https://w.example.com/image/${key}`),
      env,
      'site1',
      key,
    );
    expect(response.status).toBe(200);
    expect(response.headers.has('Cache-Tag')).toBe(false);
  });

  it('marks 404 responses no-store so a pre-upload miss is never cached', async () => {
    const env = createEnv();
    const response = await handleImage(
      new Request(`https://w.example.com/image/${KEY}`),
      env,
      'site1',
      KEY,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('marks 403 responses no-store', async () => {
    const env = createEnv();
    const response = await handleImage(
      new Request('https://w.example.com/image/other/x.png'),
      env,
      'site1',
      'other/x.png',
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

// ---------------------------------------------------------------------------
// CachedImage entrypoint
// ---------------------------------------------------------------------------

describe('CachedImage entrypoint', () => {
  function makeEntrypoint(env: Env): CachedImage {
    return new CachedImage({} as ExecutionContext, env);
  }

  it('serves an image request through handleImage', async () => {
    const entrypoint = makeEntrypoint(createEnv(bucketWith(KEY)));
    const response = await entrypoint.fetch(new Request(`https://w.example.com/image/${KEY}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Tag')).toBe('site:site1,asset:asset-1');
  });

  it('rejects anything that is not a GET /image/* request, uncacheably', async () => {
    const entrypoint = makeEntrypoint(createEnv());
    for (const request of [
      new Request(`https://w.example.com/image/${KEY}`, { method: 'POST' }),
      new Request('https://w.example.com/media/abc'),
      new Request('https://w.example.com/image/justkey'),
    ]) {
      const response = await entrypoint.fetch(request);
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });
});

// ---------------------------------------------------------------------------
// Loopback forward + purge — both must fail open when the exports map is empty
// (enable_ctx_exports missing), and both read the mutable stub map installed here.
// ---------------------------------------------------------------------------

describe('forwardToCachedImage', () => {
  afterEach(() => {
    delete workerExports.CachedImage;
  });

  it('returns null when the loopback binding is unavailable', async () => {
    expect(await forwardToCachedImage(new Request(`https://w.example.com/image/${KEY}`))).toBeNull();
  });

  it('forwards a bare GET with the Accept format resolved into the URL', async () => {
    const seen: Request[] = [];
    workerExports.CachedImage = {
      fetch: vi.fn(async (request: Request) => {
        seen.push(request);
        return new Response('hit');
      }),
    };

    const response = await forwardToCachedImage(
      new Request(`https://w.example.com/image/${KEY}?width=100&format=auto`, {
        headers: { Accept: 'image/avif', Authorization: 'Bearer nope' },
      }),
    );

    expect(await response!.text()).toBe('hit');
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0].url).searchParams.get('format')).toBe('avif');
    // Headers must not reach the cacheable entrypoint: the cache key is URL-only.
    expect(seen[0].headers.get('Accept')).toBeNull();
    expect(seen[0].headers.get('Authorization')).toBeNull();
  });
});

describe('purgeAssetCache', () => {
  beforeEach(() => {
    delete workerExports.CachedImage;
  });
  afterEach(() => {
    delete workerExports.CachedImage;
  });

  it('returns skipped when the loopback binding is unavailable', async () => {
    expect(await purgeAssetCache('site1', 'asset-1')).toBe('skipped');
  });

  it('purges by asset tag through the entrypoint RPC', async () => {
    const purgeTags = vi.fn(async () => ({ success: true, errors: [] }));
    workerExports.CachedImage = { purgeTags };

    expect(await purgeAssetCache('site1', 'asset-1')).toBe('success');
    expect(purgeTags).toHaveBeenCalledWith(['asset:asset-1']);
  });

  it('returns failed when purge reports failure in its result', async () => {
    workerExports.CachedImage = {
      purgeTags: vi.fn(async () => ({
        success: false,
        errors: [{ code: 10000, message: 'nope' }],
      })),
    };
    expect(await purgeAssetCache('site1', 'asset-1')).toBe('failed');
  });

  it('returns failed instead of throwing when the RPC throws', async () => {
    workerExports.CachedImage = {
      purgeTags: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    expect(await purgeAssetCache('site1', 'asset-1')).toBe('failed');
  });
});
