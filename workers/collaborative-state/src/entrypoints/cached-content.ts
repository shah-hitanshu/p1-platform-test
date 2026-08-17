/**
 * Cacheable content reads.
 *
 * Declared with cache.enabled in wrangler.jsonc, so Cloudflare may serve a hit
 * without invoking this Worker at all. That is only safe because the default
 * entrypoint authenticates and authorizes every request before forwarding
 * here, and because a content response is determined entirely by its URL —
 * handleContentRoutes reads siteId, path and ?branch, never the principal.
 *
 * Nothing else may be routed here, and this must never be reachable directly.
 */

import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from '../env';
import type { AuthenticatedPrincipal } from '../types';
import { runWithConnection } from '../db';
import { resolveConnection } from '../db/resolve-connection';
import { parseRoute } from '../routes/route-parser';
import { handleContentRoutes } from '../routes/content-api';
import { ensureLogger } from '../telemetry';

/**
 * The content handler requires a principal but never reads it. Authorization
 * already happened upstream; this records what was proven rather than
 * re-deriving it.
 */
function authorizedReader(siteId: string): AuthenticatedPrincipal {
  return {
    id: 'cached-content',
    type: 'service',
    pantheonSiteRoles: {},
    tokenExpiry: new Date(Date.now() + 60_000).toISOString(),
    scopes: ['read:published'],
    siteId,
    authProvider: 'site_token',
  };
}

export class CachedContent extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = parseRoute(url.pathname);

    if (route?.handler !== 'content' || request.method !== 'GET') {
      // Nothing but the forward should ever reach this entrypoint, so this
      // firing at all means the forwarding contract broke somewhere.
      ensureLogger(this.env).warn('non-content request reached cached entrypoint', {
        method: request.method,
        path: url.pathname,
        outcome: 'rejected',
      });
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const siteId = route.params.siteId ?? '';
    const { connectionString, isHyperdrive } = resolveConnection(this.env, url.pathname);
    const logger = ensureLogger(this.env);
    const startedAt = Date.now();

    const response = await runWithConnection(connectionString, { isHyperdrive }, async () =>
      handleContentRoutes(request, {
        siteId,
        documentPath: route.params.documentPath,
        action: route.params.action as 'content' | 'content-pages',
        principal: authorizedReader(siteId),
      }));

    // Reaching this Worker at all means the edge had no entry, so every line
    // here is a miss; hits are only visible in Cloudflare's request-vs-
    // invocation counts. doc_path is logged for misses that found nothing —
    // the dead-path long tail is the thing worth naming, and it ran to
    // thousands of distinct values per hour during the August spike.
    if (response.status === 404) {
      logger.info('content miss not found', {
        site_id: siteId,
        doc_path: route.params.documentPath,
        duration_ms: Date.now() - startedAt,
        outcome: 'not_found',
      });
    }

    return response;
  }
}
