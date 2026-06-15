import { Env } from './types';
import { validateAuth } from './auth';
import { handleImage } from './handlers/image';
import { handleList } from './handlers/list';
import { handleUpload } from './handlers/upload';
import { handleDelete } from './handlers/delete';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function addCorsHeaders(response: Response): Response {
  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newResponse.headers.set(key, value);
  }
  return newResponse;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Reject ids that contain path-traversal characters or whitespace.
// siteId and workstreamId are UUIDs from CCR and must never contain these.
function isValidId(id: string): boolean {
  return !!id && !id.includes('/') && !id.includes('..') && !/\s/.test(id);
}

// Fast bearer-header check — no CSS call. Used to fail early before param
// validation on routes that require auth, so missing-token returns 401
// rather than 400 regardless of whether params are present.
function hasBearerToken(request: Request): boolean {
  const auth = request.headers.get('Authorization');
  return !!auth && auth.startsWith('Bearer ');
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const cdnBaseUrl = env.CDN_BASE_URL;

    let response: Response;

    try {
      // GET /image/* — public, no auth required
      if (request.method === 'GET' && path.startsWith('/image/')) {
        const fullKey = decodeURIComponent(path.slice('/image/'.length));
        // Extract siteId as the first path segment
        const slashIndex = fullKey.indexOf('/');
        if (slashIndex === -1) {
          response = jsonResponse({ error: 'Invalid image path' }, 400);
          return addCorsHeaders(response);
        }
        const siteId = fullKey.slice(0, slashIndex);
        response = await handleImage(request, env, siteId, fullKey);
        return addCorsHeaders(response);
      }

      // GET /media — list media (auth required)
      if (request.method === 'GET' && path === '/media') {
        if (!hasBearerToken(request)) {
          response = jsonResponse({ error: 'Unauthorized' }, 401);
          return addCorsHeaders(response);
        }
        const siteId = url.searchParams.get('siteId');
        const workstreamId = url.searchParams.get('workstreamId');
        if (!siteId) {
          response = jsonResponse({ error: 'siteId query param required' }, 400);
          return addCorsHeaders(response);
        }
        if (!workstreamId) {
          response = jsonResponse({ error: 'workstreamId query param required' }, 400);
          return addCorsHeaders(response);
        }
        if (!isValidId(siteId) || !isValidId(workstreamId)) {
          response = jsonResponse({ error: 'Invalid siteId or workstreamId' }, 400);
          return addCorsHeaders(response);
        }
        const authResult = await validateAuth(request, env, siteId);
        if (authResult === null) {
          response = jsonResponse({ error: 'Unauthorized' }, 401);
          return addCorsHeaders(response);
        }
        if (authResult === false) {
          response = jsonResponse({ error: 'Forbidden' }, 403);
          return addCorsHeaders(response);
        }
        response = await handleList(request, env, siteId, workstreamId, cdnBaseUrl);
        return addCorsHeaders(response);
      }

      // POST /media — upload media (auth required)
      if (request.method === 'POST' && path === '/media') {
        if (!hasBearerToken(request)) {
          response = jsonResponse({ error: 'Unauthorized' }, 401);
          return addCorsHeaders(response);
        }
        const siteId = url.searchParams.get('siteId');
        const workstreamId = url.searchParams.get('workstreamId');
        if (!siteId) {
          response = jsonResponse({ error: 'siteId query param required' }, 400);
          return addCorsHeaders(response);
        }
        if (!workstreamId) {
          response = jsonResponse({ error: 'workstreamId query param required' }, 400);
          return addCorsHeaders(response);
        }
        if (!isValidId(siteId) || !isValidId(workstreamId)) {
          response = jsonResponse({ error: 'Invalid siteId or workstreamId' }, 400);
          return addCorsHeaders(response);
        }
        const authResult = await validateAuth(request, env, siteId);
        if (authResult === null) {
          response = jsonResponse({ error: 'Unauthorized' }, 401);
          return addCorsHeaders(response);
        }
        if (authResult === false) {
          response = jsonResponse({ error: 'Forbidden' }, 403);
          return addCorsHeaders(response);
        }
        response = await handleUpload(request, env, siteId, workstreamId, cdnBaseUrl);
        return addCorsHeaders(response);
      }

      // DELETE /media/* — delete media (auth required)
      if (request.method === 'DELETE' && path.startsWith('/media/')) {
        if (!hasBearerToken(request)) {
          response = jsonResponse({ error: 'Unauthorized' }, 401);
          return addCorsHeaders(response);
        }
        const siteId = url.searchParams.get('siteId');
        const workstreamId = url.searchParams.get('workstreamId');
        if (!siteId) {
          response = jsonResponse({ error: 'siteId query param required' }, 400);
          return addCorsHeaders(response);
        }
        if (!workstreamId) {
          response = jsonResponse({ error: 'workstreamId query param required' }, 400);
          return addCorsHeaders(response);
        }
        if (!isValidId(siteId) || !isValidId(workstreamId)) {
          response = jsonResponse({ error: 'Invalid siteId or workstreamId' }, 400);
          return addCorsHeaders(response);
        }
        const authResult = await validateAuth(request, env, siteId);
        if (authResult === null) {
          response = jsonResponse({ error: 'Unauthorized' }, 401);
          return addCorsHeaders(response);
        }
        if (authResult === false) {
          response = jsonResponse({ error: 'Forbidden' }, 403);
          return addCorsHeaders(response);
        }
        const key = decodeURIComponent(path.slice('/media/'.length));
        response = await handleDelete(request, env, siteId, workstreamId, key);
        return addCorsHeaders(response);
      }

      // Fallback — 404
      response = jsonResponse({ error: 'Not found' }, 404);
      return addCorsHeaders(response);
    } catch {
      response = jsonResponse({ error: 'Internal server error' }, 500);
      return addCorsHeaders(response);
    }
  },
} satisfies ExportedHandler<Env>;
