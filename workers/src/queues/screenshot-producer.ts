/**
 * Screenshot producer
 *
 * Single entry point for "we want a fresh screenshot of this site." Callers
 * (route handlers, publish flows, the cron handler) invoke this and forget
 * about it. The helper handles the "site has no URL" no-op and swallows
 * enqueue errors so it can be safely called from inside transactions.
 */

import type { Env } from '../index';
import type { ScreenshotQueueMessage } from '../types/queue-messages';

export type ScreenshotRequestReason = ScreenshotQueueMessage['reason'];

export interface ScreenshotProducerEnv {
  SCREENSHOT_QUEUE?: Env['SCREENSHOT_QUEUE'];
}

interface SiteForScreenshot {
  id: string;
  url?: string | null;
}

/**
 * Request a fresh screenshot for a site. No-ops when the site has no url
 * or when the queue binding is unavailable (e.g., local dev without
 * Cloudflare).
 */
export async function requestSiteScreenshot(
  env: ScreenshotProducerEnv,
  site: SiteForScreenshot,
  reason: ScreenshotRequestReason,
): Promise<void> {
  if (env.SCREENSHOT_QUEUE === undefined) {
    return;
  }
  if (site.url === undefined || site.url === null || site.url === '') {
    return;
  }

  const message: ScreenshotQueueMessage = {
    siteId: site.id,
    url: site.url,
    enqueuedAt: Date.now(),
    reason,
  };

  try {
    await env.SCREENSHOT_QUEUE.send(message);
  } catch (error) {
    console.error(
      `Screenshot enqueue failed for site ${site.id} (${reason}):`,
      error instanceof Error ? error.message : String(error),
    );
  }
}
