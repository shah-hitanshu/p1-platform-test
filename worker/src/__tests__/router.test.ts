import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Env } from '../types';

// We import the default export (the Worker object with fetch method)
import worker from '../index';

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

function createEnv(bucket?: R2Bucket): Env {
  return {
    MEDIA_BUCKET: bucket ?? createMockR2Bucket(),
    CSS_BASE_URL: 'https://css.example.com',
    CDN_BASE_URL: 'https://cdn.example.com/p1',
    IMAGES: {} as ImagesBinding,
  };
}

function createRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

const CORS_HEADER_NAMES = [
  'Access-Control-Allow-Origin',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Headers',
];

// CSS GET /api/sites/{siteId} returns 200 when the caller has canView access
function authOkResponse(): Response {
  return new Response(JSON.stringify({ id: 'site1', name: 'Test Site' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// CSS returns 403 when the caller has no access to the site
function authForbiddenResponse(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

// CSS returns 401 when the token is invalid
function authUnauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Authentication required' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Worker router', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---- OPTIONS / CORS ----

  it('OPTIONS returns 204 with CORS headers', async () => {
    const env = createEnv();
    const request = createRequest('https://worker.example.com/media', {
      method: 'OPTIONS',
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(204);
    for (const header of CORS_HEADER_NAMES) {
      expect(response.headers.has(header)).toBe(true);
    }
  });

  it('all responses include CORS headers', async () => {
    const env = createEnv();

    // A 404 response for an unknown route should still have CORS
    const request = createRequest('https://worker.example.com/unknown-path');
    const response = await worker.fetch(request, env);

    expect(response.status).toBe(404);
    for (const header of CORS_HEADER_NAMES) {
      expect(response.headers.has(header)).toBe(true);
    }
  });

  // ---- GET /image/* ----

  it('GET /image/* routes to handleImage without auth', async () => {
    const bucket = createMockR2Bucket({
      'site1/media/12345-photo.jpg': {
        body: 'image-data',
        httpMetadata: { contentType: 'image/jpeg' },
        size: 512,
        uploaded: new Date(),
      },
    });
    const env = createEnv(bucket);
    // No Authorization header — image route does not require auth
    const request = createRequest('https://worker.example.com/image/site1/media/12345-photo.jpg');

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    // Verify no fetch to auth backend was made
    // (globalThis.fetch was not replaced, and the handler doesn't call validateAuth)
  });

  // ---- GET /media ----

  it('GET /media routes to handleList with auth', async () => {
    const bucket = createMockR2Bucket({
      'site1/wkst1/media/100-file.png': {
        body: '',
        size: 100,
        uploaded: new Date('2025-01-01'),
      },
    });
    const env = createEnv(bucket);

    globalThis.fetch = vi.fn().mockResolvedValue(authOkResponse());

    const token = 'list-token-' + Math.random();
    const request = createRequest('https://worker.example.com/media?siteId=site1&workstreamId=wkst1', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    const items = await response.json() as any[];
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(1);
    expect(items[0].filename).toBe('file.png');
  });

  // ---- POST /media ----

  it('POST /media routes to handleUpload with auth', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);

    globalThis.fetch = vi.fn().mockResolvedValue(authOkResponse());

    const formData = new FormData();
    formData.append('file', new File(['x'], 'test.png', { type: 'image/png' }));

    const token = 'upload-token-' + Math.random();
    const request = createRequest('https://worker.example.com/media?siteId=site1&workstreamId=wkst1', {
      method: 'POST',
      body: formData,
      headers: { Authorization: `Bearer ${token}` },
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(201);
    expect(bucket.put).toHaveBeenCalledTimes(1);
  });

  // ---- DELETE /media/* ----

  it('DELETE /media/* routes to handleDelete with auth', async () => {
    const bucket = createMockR2Bucket();
    const env = createEnv(bucket);

    globalThis.fetch = vi.fn().mockResolvedValue(authOkResponse());

    const token = 'delete-token-' + Math.random();
    const request = createRequest(
      'https://worker.example.com/media/site1/wkst1/media/12345-photo.jpg?siteId=site1&workstreamId=wkst1',
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ success: true });
    expect(bucket.delete).toHaveBeenCalledWith('site1/wkst1/media/12345-photo.jpg');
  });

  // ---- Auth-required routes return 401 ----

  it('auth-required routes return 401 without valid token', async () => {
    const env = createEnv();

    // GET /media without auth
    const getResponse = await worker.fetch(
      createRequest('https://worker.example.com/media?siteId=site1'),
      env,
    );
    expect(getResponse.status).toBe(401);

    // POST /media without auth
    const formData = new FormData();
    formData.append('file', new File(['x'], 'f.png', { type: 'image/png' }));
    const postResponse = await worker.fetch(
      createRequest('https://worker.example.com/media?siteId=site1', {
        method: 'POST',
        body: formData,
      }),
      env,
    );
    expect(postResponse.status).toBe(401);

    // DELETE /media/* without auth
    const deleteResponse = await worker.fetch(
      createRequest('https://worker.example.com/media/site1/media/file.jpg?siteId=site1', {
        method: 'DELETE',
      }),
      env,
    );
    expect(deleteResponse.status).toBe(401);
  });

  // ---- Missing siteId ----

  it('missing siteId returns 400', async () => {
    const env = createEnv();
    const authFetch = () => vi.fn().mockResolvedValue(authOkResponse());
    const headers = (t: string) => ({ Authorization: `Bearer ${t}` });

    globalThis.fetch = authFetch();
    const getResponse = await worker.fetch(
      createRequest('https://worker.example.com/media?workstreamId=wkst1', { headers: headers('t1') }),
      env,
    );
    expect(getResponse.status).toBe(400);
    expect((await getResponse.json() as { error: string }).error).toContain('siteId');

    const formData = new FormData();
    formData.append('file', new File(['x'], 'f.png', { type: 'image/png' }));
    globalThis.fetch = authFetch();
    const postResponse = await worker.fetch(
      createRequest('https://worker.example.com/media?workstreamId=wkst1', {
        method: 'POST', body: formData, headers: headers('t2'),
      }),
      env,
    );
    expect(postResponse.status).toBe(400);

    globalThis.fetch = authFetch();
    const deleteResponse = await worker.fetch(
      createRequest('https://worker.example.com/media/site1/wkst1/media/file.jpg?workstreamId=wkst1', {
        method: 'DELETE', headers: headers('t3'),
      }),
      env,
    );
    expect(deleteResponse.status).toBe(400);
  });

  it('missing workstreamId returns 400', async () => {
    const env = createEnv();
    const authFetch = () => vi.fn().mockResolvedValue(authOkResponse());
    const headers = (t: string) => ({ Authorization: `Bearer ${t}` });

    globalThis.fetch = authFetch();
    const getResponse = await worker.fetch(
      createRequest('https://worker.example.com/media?siteId=site1', { headers: headers('t4') }),
      env,
    );
    expect(getResponse.status).toBe(400);
    expect((await getResponse.json() as { error: string }).error).toContain('workstreamId');

    const formData = new FormData();
    formData.append('file', new File(['x'], 'f.png', { type: 'image/png' }));
    globalThis.fetch = authFetch();
    const postResponse = await worker.fetch(
      createRequest('https://worker.example.com/media?siteId=site1', {
        method: 'POST', body: formData, headers: headers('t5'),
      }),
      env,
    );
    expect(postResponse.status).toBe(400);

    globalThis.fetch = authFetch();
    const deleteResponse = await worker.fetch(
      createRequest('https://worker.example.com/media/site1/wkst1/media/file.jpg?siteId=site1', {
        method: 'DELETE', headers: headers('t6'),
      }),
      env,
    );
    expect(deleteResponse.status).toBe(400);
  });

  // ---- Invalid id characters ----

  it('siteId or workstreamId containing / or .. returns 400', async () => {
    const env = createEnv();
    const authFetch = () => vi.fn().mockResolvedValue(authOkResponse());
    const headers = (t: string) => ({ Authorization: `Bearer ${t}` });

    globalThis.fetch = authFetch();
    const slashResponse = await worker.fetch(
      createRequest('https://worker.example.com/media?siteId=site1/evil&workstreamId=wkst1', {
        headers: headers('t7'),
      }),
      env,
    );
    expect(slashResponse.status).toBe(400);
    expect((await slashResponse.json() as { error: string }).error).toContain('Invalid');

    globalThis.fetch = authFetch();
    const dotResponse = await worker.fetch(
      createRequest('https://worker.example.com/media?siteId=site1&workstreamId=..%2Fevil', {
        headers: headers('t8'),
      }),
      env,
    );
    expect(dotResponse.status).toBe(400);
  });

  // ---- siteId not in user's siteRoles ----

  it('auth-required routes return 403 when siteId is not in user siteRoles', async () => {
    const env = createEnv();
    const headers = (t: string) => ({ Authorization: `Bearer ${t}` });

    // GET /media — valid token, but siteId not in siteRoles
    globalThis.fetch = vi.fn().mockResolvedValue(authForbiddenResponse());
    const getResponse = await worker.fetch(
      createRequest('https://worker.example.com/media?siteId=site1&workstreamId=wkst1', {
        headers: headers('t-forbidden-get-' + Math.random()),
      }),
      env,
    );
    expect(getResponse.status).toBe(403);
    expect((await getResponse.json() as { error: string }).error).toBe('Forbidden');

    // POST /media — valid token, but siteId not in siteRoles
    const formData = new FormData();
    formData.append('file', new File(['x'], 'f.png', { type: 'image/png' }));
    globalThis.fetch = vi.fn().mockResolvedValue(authForbiddenResponse());
    const postResponse = await worker.fetch(
      createRequest('https://worker.example.com/media?siteId=site1&workstreamId=wkst1', {
        method: 'POST', body: formData, headers: headers('t-forbidden-post-' + Math.random()),
      }),
      env,
    );
    expect(postResponse.status).toBe(403);

    // DELETE /media/* — valid token, but siteId not in siteRoles
    globalThis.fetch = vi.fn().mockResolvedValue(authForbiddenResponse());
    const deleteResponse = await worker.fetch(
      createRequest('https://worker.example.com/media/site1/wkst1/media/file.jpg?siteId=site1&workstreamId=wkst1', {
        method: 'DELETE', headers: headers('t-forbidden-del-' + Math.random()),
      }),
      env,
    );
    expect(deleteResponse.status).toBe(403);
  });

  // ---- Unknown routes ----

  it('unknown routes return 404', async () => {
    const env = createEnv();

    const response = await worker.fetch(
      createRequest('https://worker.example.com/nonexistent'),
      env,
    );

    expect(response.status).toBe(404);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ error: 'Not found' });
  });
});
