/**
 * Screenshot refresh
 *
 * Invoked by the worker's scheduled() handler on the configured cron.
 * Lists sites with a URL whose screenshot is missing or stale, and
 * enqueues a capture for each. Cadence is set in wrangler.jsonc triggers.crons.
 */

import { runWithConnection } from '../db';
import { listSitesNeedingScreenshotRefresh } from '../services/site-screenshot-service';
import { requestSiteScreenshot, type ScreenshotProducerEnv } from '../queues/screenshot-producer';

interface ScheduledEnv extends ScreenshotProducerEnv {
  HYPERDRIVE?: Hyperdrive;
  POSTGRES_CONNECTION_STRING?: string;
}

const STALE_AFTER_DAYS = 7;
const MAX_PER_RUN = 500;

export async function runWeeklyScreenshotRefresh(env: ScheduledEnv): Promise<void> {
  if (!env.SCREENSHOT_QUEUE) {
    console.error('Screenshot refresh: SCREENSHOT_QUEUE binding missing');
    return;
  }

  const connectionString = env.HYPERDRIVE?.connectionString ?? env.POSTGRES_CONNECTION_STRING;
  const isHyperdrive = env.HYPERDRIVE?.connectionString !== undefined;

  if (connectionString === undefined) {
    console.error('Screenshot refresh: no database connection string available');
    return;
  }

  await runWithConnection(connectionString, { isHyperdrive }, async () => {
    const stale = await listSitesNeedingScreenshotRefresh({
      staleAfterDays: STALE_AFTER_DAYS,
      limit: MAX_PER_RUN,
    });

    if (stale.length === 0) {
      console.log('Screenshot refresh: no stale sites');
      return;
    }

    for (const site of stale) {
      await requestSiteScreenshot(env, { id: site.siteId, url: site.url }, 'cron');
    }

    console.log(`Screenshot refresh: enqueued ${String(stale.length)} sites`);
  });
}
