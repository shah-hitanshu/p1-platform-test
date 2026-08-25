/**
 * Edge cache purging. Split from content-cache.ts because importing
 * cloudflare:workers is viral in tests, and the tag/TTL contract is needed by
 * modules that never purge.
 *
 * Purge granularity [PCC-3709]: delete-class events (document archive,
 * branch-scoped delete, delete-with-redirect) purge narrowly — the document's
 * tag plus the listings tag — because deletion creates 404s, it does not
 * reveal them. Reveal-class events (publish, merge, document restore) still
 * purge site-wide: a cached 404 carries only the site tag, so until
 * miss:<siteId>:<path> tags exist (coordinated with PCC-3705) nothing narrower
 * can make a newly revealed path reachable immediately. Site import is
 * legitimately whole-site and stays site-wide by design.
 *
 * purge() reports failure in its result instead of rejecting, so a silent
 * failure here is indefinitely stale published content — these logs are the
 * only signal it happened. Purges never throw: the publish/delete that
 * triggered them has already committed.
 *
 * Success logs at warn, deliberately: production runs LOG_LEVEL=warn, and
 * info-level success made purges forensically invisible during the 2026-08-19
 * incident investigation. A purge is rare, load-bearing, and worth a line.
 *
 * Known coverage limits: publish, delete, archive, and restore paths purge.
 * Draft-branch version writes and site-settings updates leave their bounded
 * TTL windows (5s + 25s stale-while-revalidate by default for branches) —
 * tracked separately (PCC-3646).
 */

import { exports as workerExports } from 'cloudflare:workers';
import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { CachedContent } from '../entrypoints/cached-content';
import {
  contentCacheTags,
  docTag,
  listTag,
  type ContentCacheTagParams,
} from './content-cache';

/**
 * Workers Caching scopes purge() to the entrypoint that calls it, and every
 * cached content response belongs to the CachedContent entrypoint — so the
 * purge must run over there, via this loopback RPC [PCC-3715]. Calling
 * cache.purge() from here (the default entrypoint, cache-disabled) reports
 * success while evicting nothing; that no-op shipped and was only caught by
 * a live staging smoke. Same structural caveat as cached-content-forward.ts:
 * the exports map is only populated under the enable_ctx_exports
 * compatibility flag [PCC-3666]. The method type is picked off the real
 * class (type-only, erased at runtime) so the two sides cannot drift.
 */
interface WorkerExports {
  CachedContent?: Pick<CachedContent, 'purgeTags'>;
}

async function executePurge(
  tags: string[],
  fields: Record<string, unknown>,
): Promise<void> {
  const logger = getLogger();
  // cache_tags, not tags: the field name must be in p1-telemetry's redaction
  // allowlist or production drops it silently (found live on staging — the
  // first deploy logged `tags` and shipped `"_dropped": ["tags"]` instead).
  const logFields = { ...fields, cache_tags: tags.join(','), count: tags.length };
  const startedAt = Date.now();

  try {
    const cachedContent = (workerExports as unknown as WorkerExports | undefined)
      ?.CachedContent;
    if (cachedContent === undefined) {
      // Fail open, consistent with cached-content-forward.ts: a missing
      // binding also means serving is uncached, so skipping the purge strands
      // only entries cached before the binding was lost, until their TTL.
      logger.error(
        'CachedContent loopback binding unavailable (enable_ctx_exports missing?) — purge skipped',
        undefined,
        { ...logFields, outcome: 'fail_open' },
      );
      return;
    }

    const result = await cachedContent.purgeTags(tags);
    const duration_ms = Date.now() - startedAt;

    if (result.success) {
      logger.warn('content cache purged', { ...logFields, duration_ms, outcome: 'success' });
      return;
    }

    logger.error('content cache purge rejected', undefined, {
      ...logFields,
      duration_ms,
      outcome: 'rejected',
      reason: result.errors.map((e) => `${String(e.code)}:${e.message}`).join(','),
    });
  } catch (error) {
    logger.error('content cache purge threw', error, {
      ...logFields,
      duration_ms: Date.now() - startedAt,
      outcome: 'error',
    });
  }
}

/**
 * Site-wide purge — the umbrella for reveal-class events and bulk operations
 * (see module header for why those cannot narrow yet).
 *
 * Takes the same params as the serve side rather than pre-built tags, so the
 * two cannot drift, and so a failure names the site it left stale.
 * branchId/documentId are accepted for the log fields, not to narrow the
 * purge — cache.purge() evicts anything matching *any* tag, so a narrower tag
 * alongside site: would never have narrowed it.
 *
 * The cost is real: purging one site: tag evicts the whole site's cached
 * content, so a large site takes a cold-cache traffic wave per publish.
 * Correct staleness beats partial invalidation until narrower tags can give
 * both.
 */
export async function purgeContentCache(params: ContentCacheTagParams): Promise<void> {
  // Every tag set is anchored on the site, so without one there is nothing
  // meaningful to purge and "site:" would go to the edge as a real tag.
  if (params.siteId === '') {
    getLogger().warn('content cache purge skipped', { outcome: 'skipped', reason: 'no_site_id' });
    return;
  }

  await executePurge(contentCacheTags({ siteId: params.siteId }), {
    site_id: params.siteId,
    branch_id: params.branchId,
    document_id: params.documentId,
  });
}

/**
 * Narrow purge for delete-class events: evicts the deleted document's cached
 * responses on every branch (doc tag is branch-agnostic) and the site's
 * listings, and nothing else. Deletion creates 404s rather than revealing
 * them, so the site-wide umbrella is not needed — this is what stops one
 * delete from evicting the whole site [PCC-3709].
 *
 * branchId is a log field only, same as purgeContentCache.
 */
export async function purgeDeletedDocument(params: {
  siteId: string;
  documentId: string;
  branchId?: string;
}): Promise<void> {
  if (params.siteId === '' || params.documentId === '') {
    getLogger().warn('content cache purge skipped', {
      outcome: 'skipped',
      reason: params.siteId === '' ? 'no_site_id' : 'no_document_id',
    });
    return;
  }

  await executePurge([docTag(params.documentId), listTag(params.siteId)], {
    site_id: params.siteId,
    branch_id: params.branchId,
    document_id: params.documentId,
  });
}
