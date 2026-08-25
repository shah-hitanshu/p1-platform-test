/**
 * Forwarding to the cacheable content entrypoint.
 *
 * The Workers Caching key is the URL and excludes headers, so the forwarded
 * request carries nothing but its URL. Dropping headers is load-bearing twice
 * over: the sat_ token must not reach a cacheable response, and a conditional
 * request must not turn into a 304 cached under a bare URL key and then served
 * to clients that sent no matching ETag. Revalidation is left to the edge,
 * which has the ETag from the cached 200.
 *
 * The URL itself is not passed through untouched either — see cacheKeyUrl.
 */

import { exports as workerExports } from 'cloudflare:workers';
import { getLogger } from '@pantheon-systems/p1-telemetry';

interface CachedContentBinding {
  fetch(request: Request): Promise<Response>;
}

/**
 * The exports map is typed from a generated Cloudflare.MainModule declaration
 * this project does not use, so the entrypoint is named structurally instead.
 * Partial because the map is only populated under the enable_ctx_exports
 * compatibility flag [PCC-3666] — the missing-binding case is real, not
 * hypothetical, and must degrade to uncached serving rather than a 500.
 */
interface WorkerExports {
  CachedContent?: CachedContentBinding;
}

export function isCacheableContentRequest(
  route: { handler: string },
  method: string,
): boolean {
  return route.handler === 'content' && method === 'GET';
}

/**
 * Authentication also accepts `?apiKey=` for clients that cannot set headers,
 * so a token can arrive in the URL — which, unlike a header, *is* the cache
 * key. Stripping it keeps the token out of shared cache infrastructure, and
 * lets those clients share cache entries instead of each getting its own.
 */
function cacheKeyUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  url.searchParams.delete('apiKey');
  return url.toString();
}

/**
 * Forwards to the cacheable entrypoint, or returns null when the loopback
 * binding is unavailable so the caller serves the request uncached. A missing
 * binding means the enable_ctx_exports compatibility flag (or the exports
 * config) was lost — that regression must cost cache hits, not take down
 * content serving for every site [PCC-3666]. The log is the only signal.
 */
export async function forwardToCachedContent(request: Request): Promise<Response | null> {
  const entrypoints = workerExports as unknown as WorkerExports | undefined;
  const cachedContent = entrypoints?.CachedContent;
  if (cachedContent === undefined) {
    getLogger().error(
      'CachedContent loopback binding unavailable (enable_ctx_exports missing?) — serving uncached',
      undefined,
      { outcome: 'fail_open' },
    );
    return null;
  }
  return cachedContent.fetch(
    new Request(cacheKeyUrl(request.url), { method: 'GET' }),
  );
}
