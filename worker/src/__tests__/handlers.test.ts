import { describe, it, expect, vi } from 'vitest';
import { handleImage } from '../handlers/image';
import { handleList } from '../handlers/list';
import { handleUpload } from '../handlers/upload';
import { handleDelete } from '../handlers/delete';
import { Env } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockR2Bucket(
  objects: Record<
    string,
    {
      body: ReadableStream | string;
      httpMetadata?: { contentType: string };
      size: number;
      uploaded: Date;
    }
  > = {},
) {
  return {
    get: vi.fn(async (key: string) => {
      const obj = objects[key];
      if (!obj) return null;
      return {
        body: obj.body,
        httpMetadata: obj.httpMetadata,
        size: obj.size,
      };
    }),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({
      objects: Object.entries(objects)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, val]) => ({
          key,
          size: val.size,
          uploaded: val.uploaded,
        })),
    })),
  } as unknown as R2Bucket;
}

const TEST_WORKSTREAM = 'wkst1';

// ---------------------------------------------------------------------------
// Images binding mock
// ---------------------------------------------------------------------------

function createImagesMock(outputOverrides?: { contentType?: string; body?: string }) {
  const output = vi.fn().mockReturnValue({
    contentType: () => outputOverrides?.contentType ?? 'image/webp',
    image: () => new ReadableStream({
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
    CSS_BASE_URL: 'https://css.example.com',
    CDN_BASE_URL: 'https://cdn.example.com/p1',
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
      'site1/media/12345-photo.jpg': {
        body: 'image-bytes',
        httpMetadata: { contentType: 'image/jpeg' },
        size: 1024,
        uploaded: new Date('2025-01-01'),
      },
    });
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/image/site1/media/12345-photo.jpg');

    const response = await handleImage(request, env, 'site1', 'site1/media/12345-photo.jpg');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('sets X-Content-Type-Options: nosniff on image responses', async () => {
    const bucket = createMockR2Bucket({
      'site1/media/12345-photo.jpg': {
        body: 'image-data',
        httpMetadata: { contentType: 'image/jpeg' },
        size: 512,
        uploaded: new Date(),
      },
    });
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/image/site1/media/12345-photo.jpg');

    const response = await handleImage(request, env, 'site1', 'site1/media/12345-photo.jpg');

    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('returns 404 when object does not exist', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/image/site1/media/missing.jpg');

    const response = await handleImage(request, env, 'site1', 'site1/media/missing.jpg');

    expect(response.status).toBe(404);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ error: 'Not found' });
  });

  it('returns 403 when key does not match siteId (path traversal)', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/image/site1/../../other/secret.jpg');

    const response = await handleImage(request, env, 'site1', 'other/secret.jpg');

    expect(response.status).toBe(403);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('serves raw R2 object when no transform params are present', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/media/photo.jpg': {
        body: 'raw-bytes',
        httpMetadata: { contentType: 'image/jpeg' },
        size: 1024,
        uploaded: new Date(),
      },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest('https://worker.example.com/image/site1/media/photo.jpg');

    const response = await handleImage(request, env, 'site1', 'site1/media/photo.jpg');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    // Images binding must NOT be called for untransformed requests
    expect(imagesMock.input).not.toHaveBeenCalled();
  });

  it('calls Images binding with width and height params', async () => {
    const imagesMock = createImagesMock({ contentType: 'image/jpeg' });
    const bucket = createMockR2Bucket({
      'site1/media/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest('https://worker.example.com/image/site1/media/photo.jpg?width=400&height=300');

    await handleImage(request, env, 'site1', 'site1/media/photo.jpg');

    expect(imagesMock.input).toHaveBeenCalledTimes(1);
    // transform called with width/height
    const mockTransformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockTransformer.transform).toHaveBeenCalledWith(
      expect.objectContaining({ width: 400, height: 300 }),
    );
  });

  it('fit=cover and gravity=auto enables smart crop', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/media/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest('https://worker.example.com/image/site1/media/photo.jpg?width=400&height=400&fit=cover&gravity=auto');

    await handleImage(request, env, 'site1', 'site1/media/photo.jpg');

    const mockTransformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockTransformer.transform).toHaveBeenCalledWith(
      expect.objectContaining({ fit: 'cover', gravity: 'auto' }),
    );
  });

  it('gravity=face enables face-aware crop', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/media/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest('https://worker.example.com/image/site1/media/photo.jpg?width=400&height=400&fit=cover&gravity=face');

    await handleImage(request, env, 'site1', 'site1/media/photo.jpg');

    const mockTransformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockTransformer.transform).toHaveBeenCalledWith(
      expect.objectContaining({ fit: 'cover', gravity: 'face' }),
    );
  });

  it('resolves format=auto to webp when Accept header contains image/webp', async () => {
    const imagesMock = createImagesMock({ contentType: 'image/webp' });
    const bucket = createMockR2Bucket({
      'site1/media/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest(
      'https://worker.example.com/image/site1/media/photo.jpg?width=400&format=auto',
      { headers: { Accept: 'image/webp,image/jpeg' } },
    );

    const response = await handleImage(request, env, 'site1', 'site1/media/photo.jpg');

    const mockTransformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockTransformer.output).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'image/webp' }),
    );
    expect(response.headers.get('Content-Type')).toBe('image/webp');
  });

  it('resolves format=auto to avif when Accept header contains image/avif', async () => {
    const imagesMock = createImagesMock({ contentType: 'image/avif' });
    const bucket = createMockR2Bucket({
      'site1/media/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest(
      'https://worker.example.com/image/site1/media/photo.jpg?width=400&format=auto',
      { headers: { Accept: 'image/avif,image/webp' } },
    );

    await handleImage(request, env, 'site1', 'site1/media/photo.jpg');

    const mockTransformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockTransformer.output).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'image/avif' }),
    );
  });

  it('passes quality to output options', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/media/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest('https://worker.example.com/image/site1/media/photo.jpg?width=400&quality=70');

    await handleImage(request, env, 'site1', 'site1/media/photo.jpg');

    const mockTransformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockTransformer.output).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 70 }),
    );
  });

  it('passes trim region params for manual crop', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/media/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest(
      'https://worker.example.com/image/site1/media/photo.jpg?trim.top=10&trim.left=20&trim.height=300&trim.width=400',
    );

    await handleImage(request, env, 'site1', 'site1/media/photo.jpg');

    const mockTransformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockTransformer.transform).toHaveBeenCalledWith(
      expect.objectContaining({ trim: { top: 10, left: 20, height: 300, width: 400 } }),
    );
  });

  it('passes image filter params (blur, brightness, contrast, saturation)', async () => {
    const imagesMock = createImagesMock();
    const bucket = createMockR2Bucket({
      'site1/media/photo.jpg': { body: 'raw', httpMetadata: { contentType: 'image/jpeg' }, size: 1024, uploaded: new Date() },
    });
    const env = createEnv(bucket, imagesMock);
    const request = createRequest(
      'https://worker.example.com/image/site1/media/photo.jpg?blur=5&brightness=1.2&contrast=0.9&saturation=0',
    );

    await handleImage(request, env, 'site1', 'site1/media/photo.jpg');

    const mockTransformer = (imagesMock.input as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockTransformer.transform).toHaveBeenCalledWith(
      expect.objectContaining({ blur: 5, brightness: 1.2, contrast: 0.9, saturation: 0 }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleList
// ---------------------------------------------------------------------------

describe('handleList', () => {
  it('returns MediaItem array with correct URLs', async () => {
    const bucket = createMockR2Bucket({
      'site1/wkst1/media/1700000000000-photo.jpg': {
        body: '',
        httpMetadata: { contentType: 'image/jpeg' },
        size: 2048,
        uploaded: new Date('2025-06-15T12:00:00Z'),
      },
      'site1/wkst1/media/1700000000001-doc.pdf': {
        body: '',
        httpMetadata: { contentType: 'application/pdf' },
        size: 4096,
        uploaded: new Date('2025-06-16T12:00:00Z'),
      },
    });
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/media?siteId=site1&workstreamId=wkst1');

    const response = await handleList(request, env, 'site1', TEST_WORKSTREAM, env.CDN_BASE_URL);

    expect(response.status).toBe(200);
    const items = await response.json() as any[];
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      key: 'site1/wkst1/media/1700000000000-photo.jpg',
      url: 'https://cdn.example.com/p1/site1/wkst1/media/1700000000000-photo.jpg',
      filename: 'photo.jpg',
      size: 2048,
      lastModified: '2025-06-15T12:00:00.000Z',
    });
  });

  it('filters by search query', async () => {
    const bucket = createMockR2Bucket({
      'site1/wkst1/media/100-alpha.png': {
        body: '',
        size: 100,
        uploaded: new Date(),
      },
      'site1/wkst1/media/200-beta.png': {
        body: '',
        size: 200,
        uploaded: new Date(),
      },
    });
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/media?siteId=site1&workstreamId=wkst1&search=alpha');

    const response = await handleList(request, env, 'site1', TEST_WORKSTREAM, env.CDN_BASE_URL);
    const items = await response.json() as any[];

    expect(items).toHaveLength(1);
    expect(items[0].filename).toBe('alpha.png');
  });

  it('returns empty array when no objects match', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/media?siteId=site1&workstreamId=wkst1');

    const response = await handleList(request, env, 'site1', TEST_WORKSTREAM, env.CDN_BASE_URL);
    const items = await response.json() as any[];

    expect(items).toEqual([]);
  });

  it('strips timestamp prefix from filenames correctly', async () => {
    const bucket = createMockR2Bucket({
      'site1/wkst1/media/1700000000000-my-file-name.jpg': {
        body: '',
        size: 512,
        uploaded: new Date(),
      },
    });
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/media?siteId=site1&workstreamId=wkst1');

    const response = await handleList(request, env, 'site1', TEST_WORKSTREAM, env.CDN_BASE_URL);
    const items = await response.json() as any[];

    expect(items[0].filename).toBe('my-file-name.jpg');
  });
});

// ---------------------------------------------------------------------------
// handleUpload
// ---------------------------------------------------------------------------

describe('handleUpload', () => {
  it('stores file in R2 with sanitized filename', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);

    const formData = new FormData();
    const file = new File(['hello'], 'my photo (1).jpg', { type: 'image/jpeg' });
    formData.append('file', file);

    const request = createRequest('https://worker.example.com/media?siteId=site1', {
      method: 'POST',
      body: formData,
    });

    await handleUpload(request, env, 'site1', TEST_WORKSTREAM, 'https://worker.example.com');

    expect(bucket.put).toHaveBeenCalledTimes(1);
    const putCall = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[0];
    const key = putCall[0] as string;
    expect(key).toMatch(/^site1\/wkst1\/media\/\d+-my-photo--1-.jpg$/);
    expect(putCall[2]).toEqual({ httpMetadata: { contentType: 'image/jpeg' } });
  });

  it('returns 400 when no file in FormData', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);

    const formData = new FormData();
    const request = createRequest('https://worker.example.com/media?siteId=site1', {
      method: 'POST',
      body: formData,
    });

    const response = await handleUpload(request, env, 'site1', TEST_WORKSTREAM, 'https://worker.example.com');

    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ error: 'No file provided' });
  });

  it('returns 201 with metadata', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);

    const formData = new FormData();
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    formData.append('file', file);

    const request = createRequest('https://worker.example.com/media?siteId=site1', {
      method: 'POST',
      body: formData,
    });

    const response = await handleUpload(request, env, 'site1', TEST_WORKSTREAM, env.CDN_BASE_URL);

    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body.key).toMatch(/^site1\/wkst1\/media\/\d+-photo.jpg$/);
    expect(body.url).toMatch(/^https:\/\/cdn\.example\.com\/p1\/site1\/wkst1\/media\/\d+-photo.jpg$/);
    expect(body.filename).toBe('photo.jpg');
    expect(body.size).toBe(4); // "data" is 4 bytes
    expect(body.contentType).toBe('image/jpeg');
  });

  it('returns 415 for non-image file types', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);

    const formData = new FormData();
    formData.append('file', new File(['data'], 'doc.pdf', { type: 'application/pdf' }));

    const request = createRequest('https://worker.example.com/media?siteId=site1', {
      method: 'POST',
      body: formData,
    });

    const response = await handleUpload(request, env, 'site1', TEST_WORKSTREAM, env.CDN_BASE_URL);

    expect(response.status).toBe(415);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('truncates filenames longer than 200 characters', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);

    const longName = 'a'.repeat(300) + '.jpg';
    const formData = new FormData();
    formData.append('file', new File(['data'], longName, { type: 'image/jpeg' }));

    const request = createRequest('https://worker.example.com/media?siteId=site1', {
      method: 'POST',
      body: formData,
    });

    await handleUpload(request, env, 'site1', TEST_WORKSTREAM, env.CDN_BASE_URL);

    const putCall = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[0];
    const key = putCall[0] as string;
    const filename = key.split('/').pop()!.replace(/^\d+-/, '');
    expect(filename.length).toBeLessThanOrEqual(200);
  });

  it('returns 415 for SVG files', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);

    const formData = new FormData();
    formData.append('file', new File(['<svg><script>alert(1)</script></svg>'], 'evil.svg', { type: 'image/svg+xml' }));

    const request = createRequest('https://worker.example.com/media?siteId=site1', {
      method: 'POST',
      body: formData,
    });

    const response = await handleUpload(request, env, 'site1', TEST_WORKSTREAM, env.CDN_BASE_URL);

    expect(response.status).toBe(415);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('returns 400 for empty files', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);

    const formData = new FormData();
    formData.append('file', new File([], 'empty.png', { type: 'image/png' }));

    const request = createRequest('https://worker.example.com/media?siteId=site1', {
      method: 'POST',
      body: formData,
    });

    const response = await handleUpload(request, env, 'site1', TEST_WORKSTREAM, env.CDN_BASE_URL);

    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toContain('empty');
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('returns 413 for files exceeding 10 MB (authoritative file.size check)', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);

    const formData = new FormData();
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    formData.append('file', oversized);

    const request = createRequest('https://worker.example.com/media?siteId=site1', {
      method: 'POST',
      body: formData,
    });

    const response = await handleUpload(request, env, 'site1', TEST_WORKSTREAM, env.CDN_BASE_URL);

    expect(response.status).toBe(413);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('returns 413 via Content-Length pre-check before body is buffered', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);

    const request = createRequest('https://worker.example.com/media?siteId=site1', {
      method: 'POST',
      headers: { 'Content-Length': String(10 * 1024 * 1024 + 1) },
      body: new Uint8Array(0), // body doesn't matter — check fires before formData()
    });

    const response = await handleUpload(request, env, 'site1', TEST_WORKSTREAM, env.CDN_BASE_URL);

    expect(response.status).toBe(413);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('respects MAX_UPLOAD_BYTES env override', async () => {
    const bucket = createMockR2Bucket();
    const env: Env = { ...createEnv(bucket), MAX_UPLOAD_BYTES: String(1 * 1024 * 1024) }; // 1 MB limit

    const formData = new FormData();
    const oversized = new File([new Uint8Array(1 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    formData.append('file', oversized);

    const request = createRequest('https://worker.example.com/media?siteId=site1', {
      method: 'POST',
      body: formData,
    });

    const response = await handleUpload(request, env, 'site1', TEST_WORKSTREAM, env.CDN_BASE_URL);

    expect(response.status).toBe(413);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toContain('1 MB');
    expect(bucket.put).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleDelete
// ---------------------------------------------------------------------------

describe('handleDelete', () => {
  it('deletes object from R2', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/media/site1/media/12345-photo.jpg?siteId=site1', {
      method: 'DELETE',
    });

    const response = await handleDelete(request, env, 'site1', TEST_WORKSTREAM, 'site1/wkst1/media/12345-photo.jpg');

    expect(response.status).toBe(200);
    expect(bucket.delete).toHaveBeenCalledWith('site1/wkst1/media/12345-photo.jpg');
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ success: true });
  });

  it('returns 403 when key does not match siteId', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/media/other/media/file.jpg?siteId=site1', {
      method: 'DELETE',
    });

    const response = await handleDelete(request, env, 'site1', TEST_WORKSTREAM, 'other/media/file.jpg');

    expect(response.status).toBe(403);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ error: 'Forbidden' });
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it('returns 403 when key belongs to a different workstream (correct siteId)', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/media/site1/other-wkst/media/file.jpg?siteId=site1&workstreamId=wkst1', {
      method: 'DELETE',
    });

    const response = await handleDelete(request, env, 'site1', 'wkst1', 'site1/other-wkst/media/file.jpg');

    expect(response.status).toBe(403);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ error: 'Forbidden' });
    expect(bucket.delete).not.toHaveBeenCalled();
  });
});
