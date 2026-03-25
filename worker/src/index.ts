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
    const workerUrl = url.origin;

    let response: Response;

    try {
      // GET /image/* — public, no auth required
      if (request.method === 'GET' && path.startsWith('/image/')) {
        const fullKey = path.slice('/image/'.length);
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
        if (!(await validateAuth(request, env))) {
          response = jsonResponse({ error: 'Unauthorized' }, 401);
          return addCorsHeaders(response);
        }
        const siteId = url.searchParams.get('siteId');
        if (!siteId) {
          response = jsonResponse({ error: 'siteId query param required' }, 400);
          return addCorsHeaders(response);
        }
        response = await handleList(request, env, siteId, workerUrl);
        return addCorsHeaders(response);
      }

      // POST /media — upload media (auth required)
      if (request.method === 'POST' && path === '/media') {
        if (!(await validateAuth(request, env))) {
          response = jsonResponse({ error: 'Unauthorized' }, 401);
          return addCorsHeaders(response);
        }
        const siteId = url.searchParams.get('siteId');
        if (!siteId) {
          response = jsonResponse({ error: 'siteId query param required' }, 400);
          return addCorsHeaders(response);
        }
        response = await handleUpload(request, env, siteId, workerUrl);
        return addCorsHeaders(response);
      }

      // DELETE /media/* — delete media (auth required)
      if (request.method === 'DELETE' && path.startsWith('/media/')) {
        if (!(await validateAuth(request, env))) {
          response = jsonResponse({ error: 'Unauthorized' }, 401);
          return addCorsHeaders(response);
        }
        const siteId = url.searchParams.get('siteId');
        if (!siteId) {
          response = jsonResponse({ error: 'siteId query param required' }, 400);
          return addCorsHeaders(response);
        }
        const key = path.slice('/media/'.length);
        response = await handleDelete(request, env, siteId, key);
        return addCorsHeaders(response);
      }

      // Fallback — 404
      response = jsonResponse({ error: 'Not found' }, 404);
      return addCorsHeaders(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      response = jsonResponse({ error: message }, 500);
      return addCorsHeaders(response);
    }
  },
} satisfies ExportedHandler<Env>;
