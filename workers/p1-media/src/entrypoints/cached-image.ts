/**
 * Cacheable image serving.
 *
 * Declared with cache.enabled in wrangler.jsonc, so Cloudflare may serve a hit without
 * invoking this Worker at all. That is only safe because an image response is determined
 * entirely by its URL: the default entrypoint resolves Accept-based format negotiation
 * into the URL before forwarding (see cacheKeyImageUrl), and /image/* is public — there
 * is no principal to leak.
 *
 * Nothing else may be routed here, and this must never be reachable directly.
 */

import { cache, WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from '../types';
import { handleImage, parseImagePath } from '../handlers/image';
import { ensureLogger } from '../telemetry';

export class CachedImage extends WorkerEntrypoint<Env> {
  /**
   * Purges tags from THIS entrypoint's cache. Workers Caching scopes purge() to the
   * entrypoint that calls it, and every cached image response lives here — a purge
   * issued from the default entrypoint "succeeds" against its own cache-disabled
   * (empty) cache and evicts nothing (the CCR worker shipped exactly that no-op,
   * PCC-3715). RPC methods bypass the cache layer, so this always executes. Logging
   * stays with the caller (src/cache/purge.ts); this is a thin scope-crossing shim.
   */
  purgeTags(
    tags: string[],
  ): Promise<{ success: boolean; errors: { code: number; message: string }[] }> {
    return cache.purge({ tags });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parsed = request.method === 'GET' ? parseImagePath(url.pathname) : null;

    if (parsed === null) {
      // Nothing but the /image/* forward should ever reach this entrypoint, so this
      // firing at all means the forwarding contract broke somewhere.
      ensureLogger(this.env).warn('non-image request reached cached entrypoint', {
        'http.request.method': request.method,
        outcome: 'rejected',
      });
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    ensureLogger(this.env);
    return handleImage(request, this.env, parsed.siteId, parsed.key);
  }
}
