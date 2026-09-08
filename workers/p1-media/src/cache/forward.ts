/**
 * Forwarding to the cacheable image entrypoint.
 *
 * The Workers Caching key is the URL and excludes headers, so the forwarded request
 * carries nothing but its URL — with Accept-based format negotiation already resolved
 * into it (cacheKeyImageUrl), because two clients with different Accept headers must
 * not share one cached entry.
 *
 * Split from handlers/image.ts because importing cloudflare:workers is viral in tests.
 */

import { exports as workerExports } from 'cloudflare:workers';
import { getLogger } from '@pantheon-systems/p1-telemetry';
import { cacheKeyImageUrl } from '../handlers/image';

interface CachedImageBinding {
  fetch(request: Request): Promise<Response>;
}

/**
 * The exports map is typed from a generated Cloudflare.MainModule declaration this
 * project does not use, so the entrypoint is named structurally instead. Partial
 * because the map is only populated under the enable_ctx_exports compatibility flag —
 * the missing-binding case must degrade to uncached serving rather than a 500.
 */
interface WorkerExports {
  CachedImage?: CachedImageBinding;
}

/**
 * Forwards to the cacheable entrypoint, or returns null when the loopback binding is
 * unavailable so the caller serves the request uncached. A missing binding means the
 * enable_ctx_exports flag (or the exports config) was lost — that regression must cost
 * cache hits, not take down image serving. The log is the only signal.
 */
export async function forwardToCachedImage(request: Request): Promise<Response | null> {
  const entrypoints = workerExports as unknown as WorkerExports | undefined;
  const cachedImage = entrypoints?.CachedImage;
  if (cachedImage === undefined) {
    getLogger().error(
      'CachedImage loopback binding unavailable (enable_ctx_exports missing?) — serving uncached',
      undefined,
      { outcome: 'fail_open' },
    );
    return null;
  }
  return cachedImage.fetch(new Request(cacheKeyImageUrl(request), { method: 'GET' }));
}
