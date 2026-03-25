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

function createEnv(bucket: R2Bucket): Env {
  return {
    MEDIA_BUCKET: bucket,
    CSS_BASE_URL: 'https://css.example.com',
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

  it('returns 404 when object does not exist', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/image/site1/media/missing.jpg');

    const response = await handleImage(request, env, 'site1', 'site1/media/missing.jpg');

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: 'Not found' });
  });

  it('returns 403 when key does not match siteId (path traversal)', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/image/site1/../../other/secret.jpg');

    const response = await handleImage(request, env, 'site1', 'other/secret.jpg');

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: 'Forbidden' });
  });
});

// ---------------------------------------------------------------------------
// handleList
// ---------------------------------------------------------------------------

describe('handleList', () => {
  it('returns MediaItem array with correct URLs', async () => {
    const bucket = createMockR2Bucket({
      'site1/media/1700000000000-photo.jpg': {
        body: '',
        httpMetadata: { contentType: 'image/jpeg' },
        size: 2048,
        uploaded: new Date('2025-06-15T12:00:00Z'),
      },
      'site1/media/1700000000001-doc.pdf': {
        body: '',
        httpMetadata: { contentType: 'application/pdf' },
        size: 4096,
        uploaded: new Date('2025-06-16T12:00:00Z'),
      },
    });
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/media?siteId=site1');

    const response = await handleList(request, env, 'site1', 'https://worker.example.com');

    expect(response.status).toBe(200);
    const items = await response.json();
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      key: 'site1/media/1700000000000-photo.jpg',
      url: 'https://worker.example.com/image/site1/media/1700000000000-photo.jpg',
      filename: 'photo.jpg',
      size: 2048,
      lastModified: '2025-06-15T12:00:00.000Z',
    });
  });

  it('filters by search query', async () => {
    const bucket = createMockR2Bucket({
      'site1/media/100-alpha.png': {
        body: '',
        size: 100,
        uploaded: new Date(),
      },
      'site1/media/200-beta.png': {
        body: '',
        size: 200,
        uploaded: new Date(),
      },
    });
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/media?siteId=site1&search=alpha');

    const response = await handleList(request, env, 'site1', 'https://worker.example.com');
    const items = await response.json();

    expect(items).toHaveLength(1);
    expect(items[0].filename).toBe('alpha.png');
  });

  it('returns empty array when no objects match', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/media?siteId=site1');

    const response = await handleList(request, env, 'site1', 'https://worker.example.com');
    const items = await response.json();

    expect(items).toEqual([]);
  });

  it('strips timestamp prefix from filenames correctly', async () => {
    const bucket = createMockR2Bucket({
      'site1/media/1700000000000-my-file-name.jpg': {
        body: '',
        size: 512,
        uploaded: new Date(),
      },
    });
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/media?siteId=site1');

    const response = await handleList(request, env, 'site1', 'https://worker.example.com');
    const items = await response.json();

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

    await handleUpload(request, env, 'site1', 'https://worker.example.com');

    expect(bucket.put).toHaveBeenCalledTimes(1);
    const putCall = (bucket.put as ReturnType<typeof vi.fn>).mock.calls[0];
    const key = putCall[0] as string;
    // Key should be site1/media/{timestamp}-my-photo--1-.jpg
    expect(key).toMatch(/^site1\/media\/\d+-my-photo--1-.jpg$/);
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

    const response = await handleUpload(request, env, 'site1', 'https://worker.example.com');

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: 'No file provided' });
  });

  it('returns 201 with metadata', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);

    const formData = new FormData();
    const file = new File(['data'], 'report.pdf', { type: 'application/pdf' });
    formData.append('file', file);

    const request = createRequest('https://worker.example.com/media?siteId=site1', {
      method: 'POST',
      body: formData,
    });

    const response = await handleUpload(request, env, 'site1', 'https://worker.example.com');

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.key).toMatch(/^site1\/media\/\d+-report.pdf$/);
    expect(body.url).toMatch(/^https:\/\/worker\.example\.com\/image\/site1\/media\/\d+-report.pdf$/);
    expect(body.filename).toBe('report.pdf');
    expect(body.size).toBe(4); // "data" is 4 bytes
    expect(body.contentType).toBe('application/pdf');
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

    const response = await handleDelete(request, env, 'site1', 'site1/media/12345-photo.jpg');

    expect(response.status).toBe(200);
    expect(bucket.delete).toHaveBeenCalledWith('site1/media/12345-photo.jpg');
    const body = await response.json();
    expect(body).toEqual({ success: true });
  });

  it('returns 403 when key does not match siteId', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);
    const request = createRequest('https://worker.example.com/media/other/media/file.jpg?siteId=site1', {
      method: 'DELETE',
    });

    const response = await handleDelete(request, env, 'site1', 'other/media/file.jpg');

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: 'Forbidden' });
    expect(bucket.delete).not.toHaveBeenCalled();
  });
});
