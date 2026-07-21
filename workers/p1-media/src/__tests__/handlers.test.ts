import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleImage } from '../handlers/image';
import { handlePresignUpload, handlePresignVersion } from '../handlers/presign';
import { handleFinalizeUpload, handleFinalizeVersion } from '../handlers/finalize';
import { handleGetAsset } from '../handlers/get';
import { handlePatch } from '../handlers/patch';
import { handleDelete } from '../handlers/delete';
import { Env, MediaAsset } from '../types';

// The store's composite R2+D1 operations are mocked here on purpose: these are
// HANDLER tests. They verify request parsing, validation, status codes and that
// the handler returns exactly what the store produced — NOT the SQL, which is
// covered by the pure buildListQuery/rowToAsset unit tests plus a real-SQLite
// smoke. `...actual` keeps the pure helpers (sanitizeFilename, etc.) and the real
// NotFoundError class so `instanceof` checks still fire.
vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>();
  return {
    ...actual,
    finalizeAssetCreation: vi.fn(),
    finalizeVersionAdd: vi.fn(),
    assertOwnedAsset: vi.fn(),
    getAsset: vi.fn(),
    listAssets: vi.fn(),
    updateAssetMetadata: vi.fn(),
    softDeleteAsset: vi.fn(),
  };
});

import {
  finalizeAssetCreation,
  finalizeVersionAdd,
  assertOwnedAsset,
  getAsset,
  updateAssetMetadata,
  softDeleteAsset,
  NotFoundError,
} from '../store';

// handlePresignUpload calls the R2 signing helper directly (not through the store) —
// mocked so these tests never need real R2 credentials.
vi.mock('../r2-presign', () => ({ createPresignedPutUrl: vi.fn() }));
import { createPresignedPutUrl } from '../r2-presign';

// ---------------------------------------------------------------------------
// handleImage helpers (this handler talks to R2 + Images directly, not the store)
// ---------------------------------------------------------------------------

function createMockR2Bucket(
  objects: Record<
    string,
    { body: ReadableStream | string; httpMetadata?: { contentType: string }; size: number; uploaded: Date }
  > = {},
) {
  return {
    get: vi.fn(async (key: string) => {
      const obj = objects[key];
      if (!obj) return null;
      return { body: obj.body, httpMetadata: obj.httpMetadata, size: obj.size };
    }),
    head: vi.fn(async (key: string) => {
      const obj = objects[key];
      if (!obj) return null;
      return { key, size: obj.size, httpMetadata: obj.httpMetadata };
    }),
    put: vi.fn(),
    delete: vi.fn(),
  } as unknown as R2Bucket;
}

function createImagesMock(outputOverrides?: { contentType?: string; body?: string }) {
  const output = vi.fn().mockReturnValue({
    contentType: () => outputOverrides?.contentType ?? 'image/webp',
    image: () =>
      new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(new TextEncoder().encode(outputOverrides?.body ?? 'transformed-bytes'));
          ctrl.close();
        },
      }),
  });
  const transform = vi.fn().mockReturnThis();
  const input = vi.fn().mockReturnValue({ transform, output });
  return { input, transform, output } as unknown as ImagesBinding;
}

function createEnv(bucket: R2Bucket, images?: ImagesBinding): Env {
  return {
    MEDIA_BUCKET: bucket,
    MEDIA_DB: {} as D1Database, // handleImage never touches D1
    CSS_BASE_URL: 'https://css.example.com',
    CDN_BASE_URL: 'https://cdn.example.com/p1',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_ACCOUNT_ID: 'test-account',
    R2_BUCKET_NAME: 'test-bucket',
    IMAGES: images ?? createImagesMock(),
  };
}

function createRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

// ---------------------------------------------------------------------------
// handleImage
// ---------------------------------------------------------------------------

describe('handleImage', () => {
  it('returns object body with correct Content-Type and cache headers', async () => {
    const bucket = createMockR2Bucket({
      'site1/assets/a/12345-photo.jpg': {
        body: 'image-bytes',
        httpMetadata: { contentType: 'image/jpeg' },
        size: 1024,
        uploaded: new Date('2025-01-01'),
      },
    });
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/image/site1/assets/a/12345-photo.jpg');

    const response = await handleImage(request, env, 'site1', 'site1/assets/a/12345-photo.jpg');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('sets X-Content-Type-Options: nosniff on image responses', async () => {
    const bucket = createMockR2Bucket({
      'site1/assets/a/12345-photo.jpg': {
        body: 'image-data',
        httpMetadata: { contentType: 'image/jpeg' },
        size: 512,
        uploaded: new Date(),
      },
    });
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/image/site1/assets/a/12345-photo.jpg');

    const response = await handleImage(request, env, 'site1', 'site1/assets/a/12345-photo.jpg');

    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('returns 404 when object does not exist', async () => {
    const env = createEnv(createMockR2Bucket());
    const request = createRequest('https://worker.example.com/image/site1/assets/a/missing.jpg');

    const response = await handleImage(request, env, 'site1', 'site1/assets/a/missing.jpg');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('returns 403 when key does not belong to the requested site (path traversal)', async () => {
    const env = createEnv(createMockR2Bucket());
    const request = createRequest('https://worker.example.com/image/site1/../../other/secret.jpg');

    // key resolves outside site1's prefix — must be refused before any R2 read.
    const response = await handleImage(request, env, 'site1', 'other/secret.jpg');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(env.MEDIA_BUCKET.get).not.toHaveBeenCalled();
  });

  it('serves raw R2 object (no Images call) when no transform params are present', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/assets/a/photo.jpg': {
        body: 'raw-bytes',
        httpMetadata: { contentType: 'image/jpeg' },
        size: 1024,
        uploaded: new Date(),
      },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest('https://worker.example.com/image/site1/assets/a/photo.jpg');

    const response = await handleImage(request, env, 'site1', 'site1/assets/a/photo.jpg');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    // Untransformed requests must NOT hit the (billed) Images pipeline.
    expect(imagesMock.input).not.toHaveBeenCalled();
  });

  it('calls Images binding with width and height params', async () => {
    const imagesMock = createImagesMock({ contentType: 'image/jpeg' });
    const bucket = createMockR2Bucket({
      'site1/assets/a/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest('https://worker.example.com/image/site1/assets/a/photo.jpg?width=400&height=300');

    await handleImage(request, env, 'site1', 'site1/assets/a/photo.jpg');

    const transformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(transformer.transform).toHaveBeenCalledWith(expect.objectContaining({ width: 400, height: 300 }));
  });

  it('clamps an out-of-range width to the maximum dimension (R9 — bounds unauthenticated compute)', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/assets/a/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    // A caller cannot drive a 999999px transform to burn compute/billing.
    const request = createRequest('https://worker.example.com/image/site1/assets/a/photo.jpg?width=999999');

    await handleImage(request, env, 'site1', 'site1/assets/a/photo.jpg');

    const transformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(transformer.transform).toHaveBeenCalledWith(expect.objectContaining({ width: 5000 }));
  });

  it('clamps quality above 100 down to 100 (R9)', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/assets/a/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest('https://worker.example.com/image/site1/assets/a/photo.jpg?width=400&quality=150');

    await handleImage(request, env, 'site1', 'site1/assets/a/photo.jpg');

    const transformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(transformer.output).toHaveBeenCalledWith(expect.objectContaining({ quality: 100 }));
  });

  it('resolves format=auto to webp when Accept advertises image/webp', async () => {
    const imagesMock = createImagesMock({ contentType: 'image/webp' });
    const bucket = createMockR2Bucket({
      'site1/assets/a/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest('https://worker.example.com/image/site1/assets/a/photo.jpg?width=400&format=auto', {
      headers: { Accept: 'image/webp,image/jpeg' },
    });

    const response = await handleImage(request, env, 'site1', 'site1/assets/a/photo.jpg');

    const transformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(transformer.output).toHaveBeenCalledWith(expect.objectContaining({ format: 'image/webp' }));
    expect(response.headers.get('Content-Type')).toBe('image/webp');
  });

  it('fit=cover and gravity=auto enables smart crop', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/assets/a/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest(
      'https://worker.example.com/image/site1/assets/a/photo.jpg?width=400&height=400&fit=cover&gravity=auto',
    );

    await handleImage(request, env, 'site1', 'site1/assets/a/photo.jpg');

    const transformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(transformer.transform).toHaveBeenCalledWith(expect.objectContaining({ fit: 'cover', gravity: 'auto' }));
  });

  it('gravity=face enables face-aware crop', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/assets/a/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest(
      'https://worker.example.com/image/site1/assets/a/photo.jpg?width=400&height=400&fit=cover&gravity=face',
    );

    await handleImage(request, env, 'site1', 'site1/assets/a/photo.jpg');

    const transformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(transformer.transform).toHaveBeenCalledWith(expect.objectContaining({ fit: 'cover', gravity: 'face' }));
  });

  it('resolves format=auto to avif when Accept advertises image/avif (avif arm of resolveFormat)', async () => {
    const imagesMock = createImagesMock({ contentType: 'image/avif' });
    const bucket = createMockR2Bucket({
      'site1/assets/a/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest('https://worker.example.com/image/site1/assets/a/photo.jpg?width=400&format=auto', {
      headers: { Accept: 'image/avif,image/webp' },
    });

    await handleImage(request, env, 'site1', 'site1/assets/a/photo.jpg');

    const transformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(transformer.output).toHaveBeenCalledWith(expect.objectContaining({ format: 'image/avif' }));
  });

  it('passes quality through to output options', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/assets/a/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest('https://worker.example.com/image/site1/assets/a/photo.jpg?width=400&quality=70');

    await handleImage(request, env, 'site1', 'site1/assets/a/photo.jpg');

    const transformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(transformer.output).toHaveBeenCalledWith(expect.objectContaining({ quality: 70 }));
  });

  it('passes trim region params for manual crop (hasTrim branch of buildTransform)', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/assets/a/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest(
      'https://worker.example.com/image/site1/assets/a/photo.jpg?trim.top=10&trim.left=20&trim.height=300&trim.width=400',
    );

    await handleImage(request, env, 'site1', 'site1/assets/a/photo.jpg');

    const transformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(transformer.transform).toHaveBeenCalledWith(
      expect.objectContaining({ trim: { top: 10, left: 20, height: 300, width: 400 } }),
    );
  });

  it('passes image filter params (blur, brightness, contrast, saturation) through per-filter clamps', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/assets/a/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest(
      'https://worker.example.com/image/site1/assets/a/photo.jpg?blur=5&brightness=1.2&contrast=0.9&saturation=0',
    );

    await handleImage(request, env, 'site1', 'site1/assets/a/photo.jpg');

    const transformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(transformer.transform).toHaveBeenCalledWith(
      expect.objectContaining({ blur: 5, brightness: 1.2, contrast: 0.9, saturation: 0 }),
    );
  });
});

// ---------------------------------------------------------------------------
// Mocked-store handler tests
// ---------------------------------------------------------------------------

const SAMPLE_ASSET: MediaAsset = {
  assetId: 'asset-1',
  versionId: 'ver-1',
  url: 'https://cdn.example.com/p1/site1/assets/asset-1/ver-1-photo.jpg',
  filename: 'photo.jpg',
  contentType: 'image/jpeg',
  size: 5,
  metadata: { alt: 'a cat' },
  metaSchemaVersion: 1,
  createdAt: '2025-01-01T00:00:00Z',
};

// The finalize handlers run IMAGES.info() for best-effort dimension capture. Default
// mock returns real dimensions; tests that care about the outage path override it.
function createStoreEnv(images?: ImagesBinding): Env {
  return {
    MEDIA_BUCKET: {} as R2Bucket, // never reached: the store is mocked
    MEDIA_DB: {} as D1Database,
    CSS_BASE_URL: 'https://css.example.com',
    CDN_BASE_URL: 'https://cdn.example.com/p1',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_ACCOUNT_ID: 'test-account',
    R2_BUCKET_NAME: 'test-bucket',
    IMAGES: images ?? ({ info: vi.fn().mockResolvedValue({ width: 100, height: 50 }) } as unknown as ImagesBinding),
  };
}

// ---- handlePresignUpload (POST /media/presign) ----

function presignRequest(body: unknown): Request {
  return new Request('https://worker.example.com/media/presign?siteId=site1', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('handlePresignUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createPresignedPutUrl).mockResolvedValue({
      uploadUrl: 'https://example.r2.cloudflarestorage.com/signed',
      expiresAt: '2026-01-01T00:05:00Z',
    });
  });

  it('returns 400 for invalid JSON', async () => {
    const response = await handlePresignUpload(
      new Request('https://worker.example.com/media/presign', { method: 'POST', body: 'not json' }),
      createStoreEnv(),
      'site1',
    );
    expect(response.status).toBe(400);
    expect(createPresignedPutUrl).not.toHaveBeenCalled();
  });

  it('returns 415 for a disallowed contentType', async () => {
    const response = await handlePresignUpload(
      presignRequest({ filename: 'doc.pdf', contentType: 'application/pdf', size: 5 }),
      createStoreEnv(),
      'site1',
    );
    expect(response.status).toBe(415);
    expect(createPresignedPutUrl).not.toHaveBeenCalled();
  });

  it('returns 415 for SVG — it can carry <script> that executes when served on *.pantheon.io', async () => {
    const response = await handlePresignUpload(
      presignRequest({ filename: 'evil.svg', contentType: 'image/svg+xml', size: 5 }),
      createStoreEnv(),
      'site1',
    );
    expect(response.status).toBe(415);
    expect(createPresignedPutUrl).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing/non-positive size', async () => {
    const response = await handlePresignUpload(
      presignRequest({ filename: 'p.png', contentType: 'image/png', size: 0 }),
      createStoreEnv(),
      'site1',
    );
    expect(response.status).toBe(400);
    expect(createPresignedPutUrl).not.toHaveBeenCalled();
  });

  it('returns 413 when the declared size exceeds MAX_UPLOAD_BYTES', async () => {
    const response = await handlePresignUpload(
      presignRequest({ filename: 'p.png', contentType: 'image/png', size: 10 * 1024 * 1024 + 1 }),
      createStoreEnv(),
      'site1',
    );
    expect(response.status).toBe(413);
    expect(createPresignedPutUrl).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing filename', async () => {
    const response = await handlePresignUpload(
      presignRequest({ contentType: 'image/png', size: 5 }),
      createStoreEnv(),
      'site1',
    );
    expect(response.status).toBe(400);
    expect(createPresignedPutUrl).not.toHaveBeenCalled();
  });

  it('rejects an unknown metadata field with 400 before signing anything (R13)', async () => {
    const response = await handlePresignUpload(
      presignRequest({ filename: 'p.png', contentType: 'image/png', size: 5, metadata: { notAField: 'x' } }),
      createStoreEnv(),
      'site1',
    );
    expect(response.status).toBe(400);
    expect(createPresignedPutUrl).not.toHaveBeenCalled();
  });

  it('mints assetId/versionId, signs the key for the authenticated site, and returns 200', async () => {
    const response = await handlePresignUpload(
      presignRequest({ filename: 'photo.png', contentType: 'image/png', size: 5, metadata: { alt: 'hi' } }),
      createStoreEnv(),
      'site1',
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      assetId: string;
      versionId: string;
      filename: string;
      uploadUrl: string;
      expiresAt: string;
    };
    expect(body.filename).toBe('photo.png');
    expect(body.uploadUrl).toBe('https://example.r2.cloudflarestorage.com/signed');
    expect(createPresignedPutUrl).toHaveBeenCalledWith(
      expect.anything(),
      `site1/assets/${body.assetId}/${body.versionId}-photo.png`,
      'image/png',
    );
  });
});

// ---- handleFinalizeUpload (POST /media/finalize) ----

function finalizeRequest(body: unknown): Request {
  return new Request('https://worker.example.com/media/finalize?siteId=site1', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const FINALIZE_KEY = 'site1/assets/asset-1/version-1-photo.png';

describe('handleFinalizeUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 for invalid JSON', async () => {
    const response = await handleFinalizeUpload(
      new Request('https://worker.example.com/media/finalize', { method: 'POST', body: 'not json' }),
      createStoreEnv(),
      'site1',
    );
    expect(response.status).toBe(400);
    expect(finalizeAssetCreation).not.toHaveBeenCalled();
  });

  it('returns 400 when assetId/versionId/filename are missing', async () => {
    const response = await handleFinalizeUpload(finalizeRequest({}), createStoreEnv(), 'site1');
    expect(response.status).toBe(400);
    expect(finalizeAssetCreation).not.toHaveBeenCalled();
  });

  it('returns 404 when no object exists at the reconstructed key (expired presign, or PUT never completed)', async () => {
    const env = { ...createStoreEnv(), MEDIA_BUCKET: createMockR2Bucket({}) };
    const response = await handleFinalizeUpload(
      finalizeRequest({ assetId: 'asset-1', versionId: 'version-1', filename: 'photo.png' }),
      env,
      'site1',
    );
    expect(response.status).toBe(404);
    expect(finalizeAssetCreation).not.toHaveBeenCalled();
  });

  it('deletes an oversized object and returns 413 without writing to D1', async () => {
    const bucket = createMockR2Bucket({
      [FINALIZE_KEY]: {
        body: 'x', httpMetadata: { contentType: 'image/png' },
        size: 10 * 1024 * 1024 + 1, uploaded: new Date(),
      },
    });
    const env = { ...createStoreEnv(), MEDIA_BUCKET: bucket };
    const response = await handleFinalizeUpload(
      finalizeRequest({ assetId: 'asset-1', versionId: 'version-1', filename: 'photo.png' }),
      env,
      'site1',
    );
    expect(response.status).toBe(413);
    expect(bucket.delete).toHaveBeenCalledWith(FINALIZE_KEY);
    expect(finalizeAssetCreation).not.toHaveBeenCalled();
  });

  it('returns 201 with the store asset, using head()-derived size/contentType and captured dimensions', async () => {
    const bucket = createMockR2Bucket({
      [FINALIZE_KEY]: {
        body: 'bytes', httpMetadata: { contentType: 'image/png' }, size: 1234, uploaded: new Date(),
      },
    });
    const env = { ...createStoreEnv(), MEDIA_BUCKET: bucket };
    vi.mocked(finalizeAssetCreation).mockResolvedValue(SAMPLE_ASSET);

    const response = await handleFinalizeUpload(
      finalizeRequest({ assetId: 'asset-1', versionId: 'version-1', filename: 'photo.png', metadata: { alt: 'hi' } }),
      env,
      'site1',
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(SAMPLE_ASSET);
    expect(finalizeAssetCreation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        siteId: 'site1',
        assetId: 'asset-1',
        versionId: 'version-1',
        filename: 'photo.png',
        contentType: 'image/png', // from head(), never client-supplied
        size: 1234,
        width: 100, // captured from IMAGES.info() via createStoreEnv()'s default mock
        height: 50,
        metadata: { alt: 'hi' },
      }),
    );
  });

  it('still finalizes when dimension capture fails — Images outage must never be fatal (R3)', async () => {
    const bucket = createMockR2Bucket({
      [FINALIZE_KEY]: {
        body: 'bytes', httpMetadata: { contentType: 'image/png' }, size: 1234, uploaded: new Date(),
      },
    });
    const failingImages = { info: vi.fn().mockRejectedValue(new Error('images down')) } as unknown as ImagesBinding;
    const env = { ...createStoreEnv(failingImages), MEDIA_BUCKET: bucket };
    vi.mocked(finalizeAssetCreation).mockResolvedValue(SAMPLE_ASSET);

    const response = await handleFinalizeUpload(
      finalizeRequest({ assetId: 'asset-1', versionId: 'version-1', filename: 'photo.png' }),
      env,
      'site1',
    );

    expect(response.status).toBe(201);
    const arg = vi.mocked(finalizeAssetCreation).mock.calls[0][1];
    expect(arg.width).toBeUndefined();
    expect(arg.height).toBeUndefined();
  });
});

// ---- handlePresignVersion (POST /media/:assetId/versions/presign) ----

describe('handlePresignVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks() resets call history but NOT a configured resolved/rejected
    // value — reset both defaults explicitly so one test's override can't leak into
    // the next (assertOwnedAsset defaults to "owned": resolves, doesn't throw).
    vi.mocked(assertOwnedAsset).mockResolvedValue(undefined);
    vi.mocked(createPresignedPutUrl).mockResolvedValue({
      uploadUrl: 'https://example.r2.cloudflarestorage.com/signed',
      expiresAt: '2026-01-01T00:05:00Z',
    });
  });

  it('returns 404 without signing anything when the asset is not owned by this site', async () => {
    vi.mocked(assertOwnedAsset).mockRejectedValue(new NotFoundError('nope'));
    const response = await handlePresignVersion(
      presignRequest({ filename: 'photo.png', contentType: 'image/png', size: 5 }),
      createStoreEnv(),
      'site1',
      'asset-1',
    );
    expect(response.status).toBe(404);
    expect(createPresignedPutUrl).not.toHaveBeenCalled();
  });

  it('applies the same request validation as new-asset presign (415 for bad type)', async () => {
    const response = await handlePresignVersion(
      presignRequest({ filename: 'doc.pdf', contentType: 'application/pdf', size: 5 }),
      createStoreEnv(),
      'site1',
      'asset-1',
    );
    expect(response.status).toBe(415);
    expect(assertOwnedAsset).not.toHaveBeenCalled();
    expect(createPresignedPutUrl).not.toHaveBeenCalled();
  });

  it('signs a key under the existing assetId with a fresh versionId, and returns 200', async () => {
    const response = await handlePresignVersion(
      presignRequest({ filename: 'v2.png', contentType: 'image/png', size: 5 }),
      createStoreEnv(),
      'site1',
      'asset-1',
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { assetId: string; versionId: string };
    expect(body.assetId).toBe('asset-1');
    expect(createPresignedPutUrl).toHaveBeenCalledWith(
      expect.anything(),
      `site1/assets/asset-1/${body.versionId}-v2.png`,
      'image/png',
    );
  });
});

// ---- handleFinalizeVersion (POST /media/:assetId/versions/finalize) ----

const VERSION_FINALIZE_KEY = 'site1/assets/asset-1/version-2-v2.png';

describe('handleFinalizeVersion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when no object exists at the reconstructed key', async () => {
    const env = { ...createStoreEnv(), MEDIA_BUCKET: createMockR2Bucket({}) };
    const response = await handleFinalizeVersion(
      finalizeRequest({ versionId: 'version-2', filename: 'v2.png' }),
      env,
      'site1',
      'asset-1',
    );
    expect(response.status).toBe(404);
    expect(finalizeVersionAdd).not.toHaveBeenCalled();
  });

  it('maps a store NotFoundError (foreign/missing asset) to 404, not 500', async () => {
    const bucket = createMockR2Bucket({
      [VERSION_FINALIZE_KEY]: {
        body: 'bytes', httpMetadata: { contentType: 'image/png' }, size: 5, uploaded: new Date(),
      },
    });
    const env = { ...createStoreEnv(), MEDIA_BUCKET: bucket };
    vi.mocked(finalizeVersionAdd).mockRejectedValue(new NotFoundError('nope'));

    const response = await handleFinalizeVersion(
      finalizeRequest({ versionId: 'version-2', filename: 'v2.png' }),
      env,
      'site1',
      'asset-1',
    );
    expect(response.status).toBe(404);
  });

  it('returns 201 with the store asset, using head()-derived size/contentType', async () => {
    const bucket = createMockR2Bucket({
      [VERSION_FINALIZE_KEY]: {
        body: 'bytes', httpMetadata: { contentType: 'image/jpeg' }, size: 42, uploaded: new Date(),
      },
    });
    const env = { ...createStoreEnv(), MEDIA_BUCKET: bucket };
    vi.mocked(finalizeVersionAdd).mockResolvedValue(SAMPLE_ASSET);

    const response = await handleFinalizeVersion(
      finalizeRequest({ versionId: 'version-2', filename: 'v2.png' }),
      env,
      'site1',
      'asset-1',
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(SAMPLE_ASSET);
    expect(finalizeVersionAdd).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        siteId: 'site1',
        assetId: 'asset-1',
        versionId: 'version-2',
        filename: 'v2.png',
        contentType: 'image/jpeg',
        size: 42,
      }),
    );
  });
});

// ---- handleGetAsset (GET /media/:assetId) ----

describe('handleGetAsset', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when the store finds nothing for this site (R0)', async () => {
    vi.mocked(getAsset).mockResolvedValue(null);
    const response = await handleGetAsset(createStoreEnv(), 'site1', 'asset-1');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('returns 200 with the asset, scoped by the authenticated siteId', async () => {
    vi.mocked(getAsset).mockResolvedValue(SAMPLE_ASSET);
    const response = await handleGetAsset(createStoreEnv(), 'site1', 'asset-1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SAMPLE_ASSET);
    expect(getAsset).toHaveBeenCalledWith(expect.anything(), 'site1', 'asset-1');
  });
});

// ---- handleDelete (DELETE /media/:assetId) ----

describe('handleDelete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when the store deleted nothing (not owned / already gone) (R0)', async () => {
    vi.mocked(softDeleteAsset).mockResolvedValue(false);
    const response = await handleDelete(createStoreEnv(), 'site1', 'asset-1');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('returns 200 { success: true } on a successful soft delete', async () => {
    vi.mocked(softDeleteAsset).mockResolvedValue(true);
    const response = await handleDelete(createStoreEnv(), 'site1', 'asset-1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(softDeleteAsset).toHaveBeenCalledWith(expect.anything(), 'site1', 'asset-1');
  });
});

// ---- handlePatch (PATCH /media/:assetId) ----

function patchRequest(body: string): Request {
  return new Request('https://worker.example.com/media/asset-1?siteId=site1', {
    method: 'PATCH',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('handlePatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 on an invalid JSON body without touching the store', async () => {
    const response = await handlePatch(patchRequest('not json{'), createStoreEnv(), 'site1', 'asset-1');
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain('Invalid JSON');
    expect(updateAssetMetadata).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is a JSON array, not an object', async () => {
    const response = await handlePatch(patchRequest('["alt"]'), createStoreEnv(), 'site1', 'asset-1');
    expect(response.status).toBe(400);
    expect(updateAssetMetadata).not.toHaveBeenCalled();
  });

  it('returns 400 for an unknown field (R13) without touching the store', async () => {
    const response = await handlePatch(patchRequest('{"notAField":"x"}'), createStoreEnv(), 'site1', 'asset-1');
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain('Unknown metadata field');
    expect(updateAssetMetadata).not.toHaveBeenCalled();
  });

  it('returns 400 for an over-length field (R6) without touching the store', async () => {
    const response = await handlePatch(
      patchRequest(JSON.stringify({ alt: 'a'.repeat(2001) })),
      createStoreEnv(),
      'site1',
      'asset-1',
    );
    expect(response.status).toBe(400);
    expect(updateAssetMetadata).not.toHaveBeenCalled();
  });

  it('returns 404 when the store reports the asset is not owned by this site (R0)', async () => {
    vi.mocked(updateAssetMetadata).mockResolvedValue(null);
    const response = await handlePatch(patchRequest('{"alt":"x"}'), createStoreEnv(), 'site1', 'asset-1');
    expect(response.status).toBe(404);
  });

  it('allows null to clear a field and returns 200 with the updated asset', async () => {
    vi.mocked(updateAssetMetadata).mockResolvedValue(SAMPLE_ASSET);
    // null is a "clear", not a violation — validation must let it through.
    const response = await handlePatch(patchRequest('{"alt":"x","caption":null}'), createStoreEnv(), 'site1', 'asset-1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SAMPLE_ASSET);
    expect(updateAssetMetadata).toHaveBeenCalledWith(expect.anything(), 'site1', 'asset-1', { alt: 'x', caption: null });
  });
});
