import { Env } from './types';
import { validateAuth } from './auth';
import { METADATA_SCHEMA } from './schema';
import { handleImage } from './handlers/image';
import { handleList } from './handlers/list';
import { handlePresignUpload, handlePresignVersion } from './handlers/presign';
import { handleFinalizeUpload, handleFinalizeVersion } from './handlers/finalize';
import { handleGetAsset } from './handlers/get';
import { handlePatch } from './handlers/patch';
import { handleDelete } from './handlers/delete';
import { handleReconcile } from './handlers/reconcile';
import { handleDocsRoute, handleDocsSpecRoute } from './routes/docs-handler';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function addCorsHeaders(response: Response): Response {
  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newResponse.headers.set(key, value);
  }
  return newResponse;
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Reject ids that contain path-traversal characters or whitespace.
// siteId and assetId are UUIDs from CCR / server-generated and must never contain these.
function isValidId(id: string): boolean {
  return !!id && !id.includes('/') && !id.includes('..') && !/\s/.test(id);
}

function hasBearerToken(request: Request): boolean {
  const auth = request.headers.get('Authorization');
  return !!auth && auth.startsWith('Bearer ');
}

/**
 * Authenticates the request against the `siteId` query param and returns that
 * (authenticated) siteId, or an error Response. The returned siteId is what the store
 * scopes every query by, so R0 (per-asset ownership) holds by construction — callers
 * must never pass a siteId that didn't come back from here.
 *
 * TODO(PCC-3278) — R7: this proves canView only, not a write-capable role. Deliberately
 * shipped without that check: no Pantheon human user ever maps to VIEWER (owner/admin/
 * developer/team_member all resolve to EDITOR or ADMIN in CSS), and a site API token
 * (service principal) can't reach this CSS endpoint at all regardless of role — CSS's
 * own scope gate has no rule permitting the `sites` route handler for any token scope,
 * so it 403s before canView is ever evaluated. The real gap is narrower than "any
 * read-only user": it requires a site admin to deliberately grant VIEWER to a human via
 * CSS's branch-grants API (no UI for this) or to an agent via the Agent Access UI. See
 * PCC-3278 for the CSS-side fix (surfacing the effective role on this endpoint) and
 * docs/media-metadata-design.md's R7 section for the full analysis.
 */
async function authenticate(request: Request, env: Env, url: URL): Promise<string | Response> {
  if (!hasBearerToken(request)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const siteId = url.searchParams.get('siteId');
  if (!siteId) return jsonResponse({ error: 'siteId query param required' }, 400);
  if (!isValidId(siteId)) return jsonResponse({ error: 'Invalid siteId' }, 400);

  const authResult = await validateAuth(request, env, siteId);
  if (authResult === null) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (authResult === false) return jsonResponse({ error: 'Forbidden' }, 403);
  return siteId;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ----- GET /docs, /docs/openapi.yaml — public API reference (Swagger UI) -----
      if (method === 'GET' && (path === '/docs' || path === '/docs/')) {
        return addCorsHeaders(handleDocsRoute(request));
      }
      if (method === 'GET' && path === '/docs/openapi.yaml') {
        return addCorsHeaders(handleDocsSpecRoute(request));
      }

      // ----- GET /image/* — public, no auth -----
      if (method === 'GET' && path.startsWith('/image/')) {
        const fullKey = decodeURIComponent(path.slice('/image/'.length));
        const slashIndex = fullKey.indexOf('/');
        if (slashIndex === -1) {
          return addCorsHeaders(jsonResponse({ error: 'Invalid image path' }, 400));
        }
        const siteId = fullKey.slice(0, slashIndex);
        return addCorsHeaders(await handleImage(request, env, siteId, fullKey));
      }

      // ----- GET /media/schema — public field definitions (Pantheon-defined, global) -----
      if (method === 'GET' && path === '/media/schema') {
        return addCorsHeaders(
          new Response(JSON.stringify(METADATA_SCHEMA), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      // ----- /media — list (GET); uploads go through /media/presign+finalize -----
      if (path === '/media') {
        if (method === 'GET') {
          const auth = await authenticate(request, env, url);
          if (auth instanceof Response) return addCorsHeaders(auth);
          return addCorsHeaders(await handleList(request, env, auth));
        }
        return addCorsHeaders(jsonResponse({ error: 'Method not allowed' }, 405));
      }

      // ----- /media/:assetId (+ /versions/presign, /versions/finalize) -----
      if (path.startsWith('/media/')) {
        const rest = decodeURIComponent(path.slice('/media/'.length));

        // POST /media/presign, POST /media/finalize — exact-match literal routes.
        // Handled before the generic /media/:assetId fallback below: single-segment
        // names like "presign"/"finalize" would otherwise pass isValidId and be
        // treated as an assetId.
        if (method === 'POST' && rest === 'presign') {
          const auth = await authenticate(request, env, url);
          if (auth instanceof Response) return addCorsHeaders(auth);
          return addCorsHeaders(await handlePresignUpload(request, env, auth));
        }
        if (method === 'POST' && rest === 'finalize') {
          const auth = await authenticate(request, env, url);
          if (auth instanceof Response) return addCorsHeaders(auth);
          return addCorsHeaders(await handleFinalizeUpload(request, env, auth));
        }

        // POST /media/:assetId/versions/presign, /versions/finalize
        if (method === 'POST' && rest.endsWith('/versions/presign')) {
          const assetId = rest.slice(0, -'/versions/presign'.length);
          if (!isValidId(assetId)) return addCorsHeaders(jsonResponse({ error: 'Not found' }, 404));
          const auth = await authenticate(request, env, url);
          if (auth instanceof Response) return addCorsHeaders(auth);
          return addCorsHeaders(await handlePresignVersion(request, env, auth, assetId));
        }
        if (method === 'POST' && rest.endsWith('/versions/finalize')) {
          const assetId = rest.slice(0, -'/versions/finalize'.length);
          if (!isValidId(assetId)) return addCorsHeaders(jsonResponse({ error: 'Not found' }, 404));
          const auth = await authenticate(request, env, url);
          if (auth instanceof Response) return addCorsHeaders(auth);
          return addCorsHeaders(await handleFinalizeVersion(request, env, auth, assetId));
        }

        const assetId = rest;
        if (!isValidId(assetId)) return addCorsHeaders(jsonResponse({ error: 'Not found' }, 404));

        const auth = await authenticate(request, env, url);
        if (auth instanceof Response) return addCorsHeaders(auth);

        if (method === 'GET') return addCorsHeaders(await handleGetAsset(env, auth, assetId));
        if (method === 'PATCH') return addCorsHeaders(await handlePatch(request, env, auth, assetId));
        if (method === 'DELETE') return addCorsHeaders(await handleDelete(env, auth, assetId));
        return addCorsHeaders(jsonResponse({ error: 'Method not allowed' }, 405));
      }

      return addCorsHeaders(jsonResponse({ error: 'Not found' }, 404));
    } catch (err) {
      console.error(`fetch: unhandled error on ${method} ${path}`, err);
      return addCorsHeaders(jsonResponse({ error: 'Internal server error' }, 500));
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await handleReconcile(env);
  },
} satisfies ExportedHandler<Env>;
