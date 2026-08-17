/**
 * Edge cache purging. Split from content-cache.ts because importing
 * cloudflare:workers is viral in tests, and the tag/TTL contract is needed by
 * modules that never purge.
 */

import { cache } from 'cloudflare:workers';
import { getLogger } from '@pantheon-systems/p1-telemetry';
import { contentCacheTags, type ContentCacheTagParams } from './content-cache';

/**
 * Takes the same params as the serve side rather than pre-built tags, so the
 * two cannot drift, and so a failure names the site it left stale.
 *
 * The purge is **site-wide, deliberately**. It has to be: a publish also
 * changes the page list on every branch that inherits the document (tagged
 * site: + branch:, never doc:) and can reveal a page whose 404 was cached
 * under the site tag alone. branchId/documentId are accepted for the log
 * fields, not to narrow the purge — cache.purge() evicts anything matching
 * *any* tag, so a narrower tag alongside site: would never have narrowed it.
 *
 * The cost is real and accepted: publishing one document evicts the whole
 * site's cached content, so a large site takes a cold-cache traffic wave per
 * publish. Correct staleness beats partial invalidation here.
 *
 * purge() reports failure in its result instead of rejecting, so a silent
 * failure here is indefinitely stale published content — this log is the only
 * signal it happened. The publish itself already succeeded, so it never throws.
 *
 * Known coverage limits: only publish paths purge. Draft-branch version writes
 * and site-settings updates leave their bounded TTL windows (5s + 25s
 * stale-while-revalidate by default for branches) — tracked separately.
 */
export async function purgeContentCache(params: ContentCacheTagParams): Promise<void> {
  const logger = getLogger();

  // Every tag set is anchored on the site, so without one there is nothing
  // meaningful to purge and "site:" would go to the edge as a real tag.
  if (params.siteId === '') {
    logger.warn('content cache purge skipped', { outcome: 'skipped', reason: 'no_site_id' });
    return;
  }

  const tags = contentCacheTags({ siteId: params.siteId });
  const fields = {
    site_id: params.siteId,
    branch_id: params.branchId,
    document_id: params.documentId,
    count: tags.length,
  };
  const startedAt = Date.now();

  try {
    const result = await cache.purge({ tags });
    const duration_ms = Date.now() - startedAt;

    if (result.success) {
      logger.info('content cache purged', { ...fields, duration_ms, outcome: 'success' });
      return;
    }

    logger.error('content cache purge rejected', undefined, {
      ...fields,
      duration_ms,
      outcome: 'rejected',
      reason: result.errors.map((e) => `${String(e.code)}:${e.message}`).join(','),
    });
  } catch (error) {
    logger.error('content cache purge threw', error, {
      ...fields,
      duration_ms: Date.now() - startedAt,
      outcome: 'error',
    });
  }
}
