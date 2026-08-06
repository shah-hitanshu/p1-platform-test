import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../types';

// Router tests mock the auth check AND every handler so we test ONLY index.ts's
// job: method/path dispatch, the auth gate, CORS, and error mapping. The handlers'
// own behavior is covered in handlers.test.ts. The key discipline (Rule 9) is that
// every reject path also asserts NON-dispatch — a 401/403/404 that still called the
// handler would be a security hole a status-only assertion cannot catch.
vi.mock('../auth', () => ({ validateAuth: vi.fn() }));
vi.mock('../handlers/image', () => ({ handleImage: vi.fn() }));
vi.mock('../handlers/list', () => ({ handleList: vi.fn() }));
vi.mock('../handlers/presign', () => ({ handlePresignUpload: vi.fn(), handlePresignVersion: vi.fn() }));
vi.mock('../handlers/finalize', () => ({ handleFinalizeUpload: vi.fn(), handleFinalizeVersion: vi.fn() }));
vi.mock('../handlers/get', () => ({ handleGetAsset: vi.fn() }));
vi.mock('../handlers/patch', () => ({ handlePatch: vi.fn() }));
vi.mock('../handlers/delete', () => ({ handleDelete: vi.fn() }));
vi.mock('../handlers/reconcile', () => ({ handleReconcile: vi.fn() }));

import worker from '../index';
import { validateAuth } from '../auth';
import { handleImage } from '../handlers/image';
import { handleList } from '../handlers/list';
import { handlePresignUpload, handlePresignVersion } from '../handlers/presign';
import { handleFinalizeUpload, handleFinalizeVersion } from '../handlers/finalize';
import { handleGetAsset } from '../handlers/get';
import { handlePatch } from '../handlers/patch';
import { handleDelete } from '../handlers/delete';
import { handleReconcile } from '../handlers/reconcile';
import { METADATA_SCHEMA } from '../schema';

function createEnv(): Env {
  return {
    MEDIA_BUCKET: {} as R2Bucket,
    MEDIA_DB: {} as D1Database,
    CSS_BASE_URL: 'https://css.example.com',
    CDN_BASE_URL: 'https://cdn.example.com/p1',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_ACCOUNT_ID: 'test-account',
    R2_BUCKET_NAME: 'test-bucket',
    IMAGES: {} as ImagesBinding,
  };
}

function req(url: string, init: RequestInit = {}, withAuth = true): Request {
  const headers = new Headers(init.headers);
  if (withAuth) headers.set('Authorization', 'Bearer test-token');
  return new Request(url, { ...init, headers });
}

const anyHandlerCalled = () =>
  [
    handleImage, handleList, handlePresignUpload,
    handleFinalizeUpload, handlePresignVersion, handleFinalizeVersion, handleGetAsset,
    handlePatch, handleDelete,
  ].some((h) => vi.mocked(h).mock.calls.length > 0);

describe('Worker router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAuth).mockResolvedValue(true); // default: authorized
    vi.mocked(handleImage).mockResolvedValue(new Response('image', { status: 200 }));
    vi.mocked(handleList).mockResolvedValue(new Response('list', { status: 200 }));
    vi.mocked(handlePresignUpload).mockResolvedValue(new Response('presign', { status: 200 }));
    vi.mocked(handleFinalizeUpload).mockResolvedValue(new Response('finalize', { status: 201 }));
    vi.mocked(handlePresignVersion).mockResolvedValue(new Response('presign-version', { status: 200 }));
    vi.mocked(handleFinalizeVersion).mockResolvedValue(new Response('finalize-version', { status: 201 }));
    vi.mocked(handleGetAsset).mockResolvedValue(new Response('get', { status: 200 }));
    vi.mocked(handlePatch).mockResolvedValue(new Response('patch', { status: 200 }));
    vi.mocked(handleDelete).mockResolvedValue(new Response('delete', { status: 200 }));
  });

  // ---- CORS / OPTIONS ----

  it('OPTIONS returns 204 with CORS headers and no handler dispatch', async () => {
    const response = await worker.fetch(req('https://w.example.com/media', { method: 'OPTIONS' }, false), createEnv());
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(anyHandlerCalled()).toBe(false);
  });

  it('advertises PATCH in Access-Control-Allow-Methods (the picker edits metadata via PATCH)', async () => {
    const response = await worker.fetch(req('https://w.example.com/media', { method: 'OPTIONS' }, false), createEnv());
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
  });

  it('adds CORS headers even to a 404', async () => {
    const response = await worker.fetch(req('https://w.example.com/nope', {}, false), createEnv());
    expect(response.status).toBe(404);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  // ---- public routes (no auth) ----

  it('GET /image/* dispatches to handleImage WITHOUT calling auth', async () => {
    const request = req('https://w.example.com/image/site1/assets/a/x.jpg', {}, false);
    const response = await worker.fetch(request, createEnv());
    expect(response.status).toBe(200);
    // siteId is derived from the key prefix and passed with the full key.
    expect(handleImage).toHaveBeenCalledWith(request, expect.anything(), 'site1', 'site1/assets/a/x.jpg');
    expect(validateAuth).not.toHaveBeenCalled();
  });

  it('GET /image/<no-slash> returns 400 Invalid image path', async () => {
    const response = await worker.fetch(req('https://w.example.com/image/justkey', {}, false), createEnv());
    expect(response.status).toBe(400);
    expect(handleImage).not.toHaveBeenCalled();
  });

  it('GET /media/schema returns the field list WITHOUT auth', async () => {
    const response = await worker.fetch(req('https://w.example.com/media/schema', {}, false), createEnv());
    expect(response.status).toBe(200);
    // The picker fetches the schema before the user is scoped to any site.
    expect(await response.json()).toEqual(METADATA_SCHEMA);
    expect(validateAuth).not.toHaveBeenCalled();
  });

  it('GET /docs serves the Swagger UI page WITHOUT auth', async () => {
    const response = await worker.fetch(req('https://w.example.com/docs', {}, false), createEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(await response.text()).toContain('SwaggerUIBundle');
    expect(validateAuth).not.toHaveBeenCalled();
    expect(anyHandlerCalled()).toBe(false);
  });

  it('GET /docs/ (trailing slash) also serves the Swagger UI page', async () => {
    const response = await worker.fetch(req('https://w.example.com/docs/', {}, false), createEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  it('GET /docs/openapi.yaml serves the raw spec WITHOUT auth', async () => {
    const response = await worker.fetch(req('https://w.example.com/docs/openapi.yaml', {}, false), createEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('yaml');
    const body = await response.text();
    expect(body).toContain('openapi:');
    expect(body).toContain('/media/{assetId}');
    expect(validateAuth).not.toHaveBeenCalled();
    expect(anyHandlerCalled()).toBe(false);
  });

  // ---- auth gate on /media ----

  it('returns 401 with no bearer token, before auth or handler runs', async () => {
    const response = await worker.fetch(req('https://w.example.com/media?siteId=site1', {}, false), createEnv());
    expect(response.status).toBe(401);
    expect(validateAuth).not.toHaveBeenCalled(); // short-circuits on the missing header
    expect(handleList).not.toHaveBeenCalled();
  });

  it('returns 400 when siteId query param is missing, before auth runs', async () => {
    const response = await worker.fetch(req('https://w.example.com/media'), createEnv());
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain('siteId');
    expect(validateAuth).not.toHaveBeenCalled();
    expect(handleList).not.toHaveBeenCalled();
  });

  it('returns 403 without dispatching when validateAuth denies access', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false); // valid token, no access to this site
    const response = await worker.fetch(req('https://w.example.com/media?siteId=site1'), createEnv());
    expect(response.status).toBe(403);
    expect(handleList).not.toHaveBeenCalled();
  });

  it('returns 401 without dispatching when validateAuth rejects the token', async () => {
    vi.mocked(validateAuth).mockResolvedValue(null); // invalid token
    const response = await worker.fetch(req('https://w.example.com/media?siteId=site1'), createEnv());
    expect(response.status).toBe(401);
    expect(handleList).not.toHaveBeenCalled();
  });

  // ---- auth gate on the mutating /media/:assetId routes (R0-sensitive) ----
  // These share one authenticate() call (GET/PATCH/DELETE) and the versions POST has
  // its OWN — a regression dropping the gate on any of them must fail loudly here.

  it('GET /media/:id returns 401 with no bearer, without dispatching', async () => {
    const response = await worker.fetch(
      req('https://w.example.com/media/asset-1?siteId=site1', {}, false),
      createEnv(),
    );
    expect(response.status).toBe(401);
    expect(validateAuth).not.toHaveBeenCalled();
    expect(handleGetAsset).not.toHaveBeenCalled();
  });

  it('PATCH /media/:id returns 403 when validateAuth denies, without dispatching', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false);
    const response = await worker.fetch(
      req('https://w.example.com/media/asset-1?siteId=site1', { method: 'PATCH' }),
      createEnv(),
    );
    expect(response.status).toBe(403);
    expect(handlePatch).not.toHaveBeenCalled();
  });

  it('DELETE /media/:id returns 401 when validateAuth rejects the token, without dispatching', async () => {
    vi.mocked(validateAuth).mockResolvedValue(null);
    const response = await worker.fetch(
      req('https://w.example.com/media/asset-1?siteId=site1', { method: 'DELETE' }),
      createEnv(),
    );
    expect(response.status).toBe(401);
    expect(handleDelete).not.toHaveBeenCalled();
  });

  it('POST /media/presign returns 401 with no bearer, without dispatching', async () => {
    const response = await worker.fetch(
      req('https://w.example.com/media/presign?siteId=site1', { method: 'POST' }, false),
      createEnv(),
    );
    expect(response.status).toBe(401);
    expect(validateAuth).not.toHaveBeenCalled();
    expect(handlePresignUpload).not.toHaveBeenCalled();
  });

  it('POST /media/finalize returns 403 when validateAuth denies, without dispatching', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false);
    const response = await worker.fetch(
      req('https://w.example.com/media/finalize?siteId=site1', { method: 'POST' }),
      createEnv(),
    );
    expect(response.status).toBe(403);
    expect(handleFinalizeUpload).not.toHaveBeenCalled();
  });

  it('POST /media/:id/versions/presign returns 401 with no bearer, without dispatching', async () => {
    const response = await worker.fetch(
      req('https://w.example.com/media/asset-1/versions/presign?siteId=site1', { method: 'POST' }, false),
      createEnv(),
    );
    expect(response.status).toBe(401);
    expect(validateAuth).not.toHaveBeenCalled();
    expect(handlePresignVersion).not.toHaveBeenCalled();
  });

  it('POST /media/:id/versions/finalize returns 403 when validateAuth denies, without dispatching', async () => {
    vi.mocked(validateAuth).mockResolvedValue(false);
    const response = await worker.fetch(
      req('https://w.example.com/media/asset-1/versions/finalize?siteId=site1', { method: 'POST' }),
      createEnv(),
    );
    expect(response.status).toBe(403);
    expect(handleFinalizeVersion).not.toHaveBeenCalled();
  });

  // ---- /media dispatch (authorized) ----

  it('GET /media dispatches to handleList with the authenticated siteId', async () => {
    const request = req('https://w.example.com/media?siteId=site1');
    await worker.fetch(request, createEnv());
    expect(handleList).toHaveBeenCalledWith(request, expect.anything(), 'site1');
  });

  it('POST /media (old multipart upload route) returns 405 — removed in favor of /media/presign + /media/finalize', async () => {
    const request = req('https://w.example.com/media?siteId=site1', { method: 'POST' });
    const response = await worker.fetch(request, createEnv());
    expect(response.status).toBe(405);
    expect(validateAuth).not.toHaveBeenCalled();
    expect(anyHandlerCalled()).toBe(false);
  });

  // ---- /media/:assetId dispatch (authorized) ----

  it('POST /media/:id/versions (old multipart add-version route) returns 404 — removed in favor of /versions/presign + /versions/finalize', async () => {
    const request = req('https://w.example.com/media/asset-1/versions?siteId=site1', { method: 'POST' });
    const response = await worker.fetch(request, createEnv());
    expect(response.status).toBe(404);
    expect(validateAuth).not.toHaveBeenCalled();
    expect(anyHandlerCalled()).toBe(false);
  });

  it('POST /media/presign dispatches to handlePresignUpload with the authenticated siteId', async () => {
    const request = req('https://w.example.com/media/presign?siteId=site1', { method: 'POST' });
    const response = await worker.fetch(request, createEnv());
    expect(response.status).toBe(200);
    expect(handlePresignUpload).toHaveBeenCalledWith(request, expect.anything(), 'site1');
    // Regression guard for the routing hazard: "presign" is a syntactically valid
    // assetId (no slash), so it must be special-cased ahead of the generic
    // /media/:assetId fallback, not swallowed by it.
    expect(handleGetAsset).not.toHaveBeenCalled();
  });

  it('POST /media/finalize dispatches to handleFinalizeUpload with the authenticated siteId', async () => {
    const request = req('https://w.example.com/media/finalize?siteId=site1', { method: 'POST' });
    const response = await worker.fetch(request, createEnv());
    expect(response.status).toBe(201);
    expect(handleFinalizeUpload).toHaveBeenCalledWith(request, expect.anything(), 'site1');
    expect(handleGetAsset).not.toHaveBeenCalled();
  });

  it('POST /media/:id/versions/presign dispatches to handlePresignVersion', async () => {
    const request = req('https://w.example.com/media/asset-1/versions/presign?siteId=site1', { method: 'POST' });
    const response = await worker.fetch(request, createEnv());
    expect(response.status).toBe(200);
    expect(handlePresignVersion).toHaveBeenCalledWith(request, expect.anything(), 'site1', 'asset-1');
  });

  it('POST /media/:id/versions/finalize dispatches to handleFinalizeVersion', async () => {
    const request = req('https://w.example.com/media/asset-1/versions/finalize?siteId=site1', { method: 'POST' });
    const response = await worker.fetch(request, createEnv());
    expect(response.status).toBe(201);
    expect(handleFinalizeVersion).toHaveBeenCalledWith(request, expect.anything(), 'site1', 'asset-1');
  });

  it('GET /media/:assetId dispatches to handleGetAsset with (env, siteId, assetId)', async () => {
    await worker.fetch(req('https://w.example.com/media/asset-1?siteId=site1'), createEnv());
    expect(handleGetAsset).toHaveBeenCalledWith(expect.anything(), 'site1', 'asset-1');
  });

  it('PATCH /media/:assetId dispatches to handlePatch', async () => {
    const request = req('https://w.example.com/media/asset-1?siteId=site1', { method: 'PATCH' });
    await worker.fetch(request, createEnv());
    expect(handlePatch).toHaveBeenCalledWith(request, expect.anything(), 'site1', 'asset-1');
  });

  it('DELETE /media/:assetId dispatches to handleDelete with (env, siteId, assetId)', async () => {
    await worker.fetch(req('https://w.example.com/media/asset-1?siteId=site1', { method: 'DELETE' }), createEnv());
    expect(handleDelete).toHaveBeenCalledWith(expect.anything(), 'site1', 'asset-1');
  });

  it('an assetId containing a slash is rejected with 404, before auth or dispatch', async () => {
    // A path-traversal-shaped id must never reach the store; UUIDs never contain "/".
    const response = await worker.fetch(req('https://w.example.com/media/foo/bar?siteId=site1'), createEnv());
    expect(response.status).toBe(404);
    expect(validateAuth).not.toHaveBeenCalled();
    expect(handleGetAsset).not.toHaveBeenCalled();
  });

  // ---- error mapping ----

  it('maps an unexpected handler error to 500', async () => {
    vi.mocked(handleList).mockRejectedValue(new Error('boom'));
    const response = await worker.fetch(req('https://w.example.com/media?siteId=site1'), createEnv());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });

  it('unknown routes return 404', async () => {
    const response = await worker.fetch(req('https://w.example.com/nonexistent', {}, false), createEnv());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  // ---- scheduled (Cron Trigger) ----

  it('scheduled() dispatches to handleReconcile with the env', async () => {
    const env = createEnv();
    const controller = { scheduledTime: Date.now(), cron: '0 * * * *', noRetry: vi.fn() };
    await worker.scheduled!(controller as unknown as ScheduledController, env);
    expect(handleReconcile).toHaveBeenCalledWith(env);
  });
});
