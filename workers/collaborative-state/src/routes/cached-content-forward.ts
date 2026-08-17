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

interface CachedContentBinding {
  fetch(request: Request): Promise<Response>;
}

/**
 * The exports map is typed from a generated Cloudflare.MainModule declaration
 * this project does not use, so the entrypoint is named structurally instead.
 */
interface WorkerExports {
  CachedContent: CachedContentBinding;
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

export async function forwardToCachedContent(request: Request): Promise<Response> {
  const entrypoints = workerExports as unknown as WorkerExports;
  return entrypoints.CachedContent.fetch(
    new Request(cacheKeyUrl(request.url), { method: 'GET' }),
  );
}
