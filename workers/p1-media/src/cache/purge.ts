/**
 * Edge cache purging for image responses.
 *
 * purge() reports failure in its result instead of rejecting, so a silent failure here
 * is a takedown that keeps serving from cache — these logs are the only signal it
 * happened. Purges never throw: the hard delete that triggered them has already
 * committed, and the caller records the returned outcome in the purge audit row.
 *
 * Success logs at warn, deliberately: production runs LOG_LEVEL=warn, and info-level
 * success made CCR's purges forensically invisible during the 2026-08-19 incident. A
 * purge is rare, load-bearing, and worth a line.
 */

import { exports as workerExports } from 'cloudflare:workers';
import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { CachedImage } from '../entrypoints/cached-image';
import { assetTag } from './image-cache';

/**
 * Workers Caching scopes purge() to the entrypoint that calls it, and every cached
 * image response belongs to the CachedImage entrypoint — so the purge must run over
 * there, via this loopback RPC. Calling cache.purge() from here (the default
 * entrypoint, cache-disabled) reports success while evicting nothing. The method type
 * is picked off the real class (type-only, erased at runtime) so the two sides cannot
 * drift.
 */
interface WorkerExports {
  CachedImage?: Pick<CachedImage, 'purgeTags'>;
}

export type CachePurgeOutcome = 'success' | 'skipped' | 'failed';

/**
 * Evicts every cached variant of every version of an asset, by tag. Returns the
 * outcome instead of throwing; 'skipped' means the loopback binding was unavailable,
 * which also means serving is uncached — only entries cached before the binding was
 * lost are stranded, until their TTL.
 */
export async function purgeAssetCache(siteId: string, assetId: string): Promise<CachePurgeOutcome> {
  const logger = getLogger();
  const cacheTags = [assetTag(assetId)];
  const logFields = {
    site_id: siteId,
    asset_id: assetId,
    cache_tags: cacheTags.join(','),
    count: cacheTags.length,
  };
  const startedAt = Date.now();

  try {
    const cachedImage = (workerExports as unknown as WorkerExports | undefined)?.CachedImage;
    if (cachedImage === undefined) {
      logger.error(
        'CachedImage loopback binding unavailable (enable_ctx_exports missing?) — purge skipped',
        undefined,
        { ...logFields, outcome: 'fail_open' },
      );
      return 'skipped';
    }

    const result = await cachedImage.purgeTags(cacheTags);
    const duration_ms = Date.now() - startedAt;

    if (result.success) {
      logger.warn('image cache purged', { ...logFields, duration_ms, outcome: 'success' });
      return 'success';
    }

    logger.error('image cache purge rejected', undefined, {
      ...logFields,
      duration_ms,
      outcome: 'rejected',
      reason: result.errors.map((e) => `${String(e.code)}:${e.message}`).join(','),
    });
    return 'failed';
  } catch (error) {
    logger.error('image cache purge threw', error, {
      ...logFields,
      duration_ms: Date.now() - startedAt,
      outcome: 'error',
    });
    return 'failed';
  }
}
