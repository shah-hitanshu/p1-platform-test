/**
 * Screenshot consumer
 *
 * Reads ScreenshotQueueMessage batches, captures each site's URL via the
 * Cloudflare Browser Rendering REST API, uploads the PNG to R2, and
 * UPSERTs the result into app.site_screenshots.
 */

import pLimit from 'p-limit';
import type { ScreenshotQueueMessage } from '../types/queue-messages';
import { runWithConnection } from '../db';
import { upsertSiteScreenshot } from '../services/site-screenshot-service';
import { bypassCookies } from '../utils/interstitial-bypass';

interface ConsumerEnv {
  HYPERDRIVE?: Hyperdrive;
  POSTGRES_CONNECTION_STRING?: string;
  R2_SCREENSHOTS?: R2Bucket;
  CF_ACCOUNT_ID?: string;
  CF_BROWSER_API_TOKEN?: string;
}

const SCREENSHOT_API_TIMEOUT_MS = 30_000;

/**
 * Browser Rendering goto() timeout. Slightly less than the outer fetch
 * abort so the API can return a structured error before we cancel.
 */
const GOTO_TIMEOUT_MS = 25_000;

/** Fixed viewport for visually consistent captures across runs. */
const VIEWPORT = { width: 1280, height: 720 } as const;

/**
 * Concurrent captures per consumer invocation. Bounded below the
 * Browser Rendering account concurrency cap so multiple invocations can
 * run in parallel without saturating it.
 */
const CAPTURE_CONCURRENCY = 10;

/**
 * Build the deterministic R2 key for a site's current screenshot.
 */
export function r2KeyForSite(siteId: string): string {
  return `screenshots/${siteId}.png`;
}

export async function handleScreenshotQueue(
  batch: MessageBatch<ScreenshotQueueMessage>,
  env: ConsumerEnv,
): Promise<void> {
  if (batch.messages.length === 0) {
    batch.ackAll();
    return;
  }

  const connectionString = env.HYPERDRIVE?.connectionString ?? env.POSTGRES_CONNECTION_STRING;
  const isHyperdrive = env.HYPERDRIVE?.connectionString !== undefined;

  if (connectionString === undefined) {
    console.error('Screenshot queue: no database connection string available');
    batch.retryAll();
    return;
  }

  const r2 = env.R2_SCREENSHOTS;
  const accountId = env.CF_ACCOUNT_ID;
  const apiToken = env.CF_BROWSER_API_TOKEN;

  if (r2 === undefined || accountId === undefined || accountId === '' || apiToken === undefined || apiToken === '') {
    console.error(
      'Screenshot queue: missing required bindings/secrets'
      + ` (R2_SCREENSHOTS=${String(r2 !== undefined)},`
      + ` CF_ACCOUNT_ID=${String(accountId !== undefined && accountId !== '')},`
      + ` CF_BROWSER_API_TOKEN=${String(apiToken !== undefined && apiToken !== '')})`,
    );
    batch.retryAll();
    return;
  }

  const deduplicated = deduplicateMessages(batch.messages);

  await runWithConnection(connectionString, { isHyperdrive }, async () => {
    const limit = pLimit(CAPTURE_CONCURRENCY);
    await Promise.all(
      deduplicated.map((message) =>
        limit(async () => {
          try {
            await processOne(message, { r2, accountId, apiToken });
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            try {
              await upsertSiteScreenshot({
                siteId: message.siteId,
                r2Key: r2KeyForSite(message.siteId),
                status: 'failed',
                capturedAt: new Date(),
                error: reason.slice(0, 500),
              });
            } catch (upsertError) {
              console.error(
                `Screenshot queue: failed to record failure for site ${message.siteId}:`,
                upsertError instanceof Error ? upsertError.message : String(upsertError),
              );
            }
          }
        }),
      ),
    );
  });

  batch.ackAll();
}

interface ProcessContext {
  r2: R2Bucket;
  accountId: string;
  apiToken: string;
}

async function processOne(
  message: ScreenshotQueueMessage,
  ctx: ProcessContext,
): Promise<void> {
  const r2Key = r2KeyForSite(message.siteId);
  const captured = await captureScreenshot(message.url, ctx);

  if (captured.ok) {
    await ctx.r2.put(r2Key, captured.bytes, {
      httpMetadata: { contentType: 'image/png' },
    });
    await upsertSiteScreenshot({
      siteId: message.siteId,
      r2Key,
      status: 'ok',
      capturedAt: new Date(),
    });
    return;
  }

  await upsertSiteScreenshot({
    siteId: message.siteId,
    r2Key,
    status: 'failed',
    capturedAt: new Date(),
    error: captured.error,
  });
}

interface CaptureSuccess { ok: true; bytes: ArrayBuffer }
interface CaptureFailure { ok: false; error: string }
type CaptureResult = CaptureSuccess | CaptureFailure;

async function captureScreenshot(
  url: string,
  ctx: ProcessContext,
): Promise<CaptureResult> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${ctx.accountId}/browser-rendering/screenshot`;

  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, SCREENSHOT_API_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ctx.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        viewport: VIEWPORT,
        gotoOptions: { waitUntil: 'networkidle0', timeout: GOTO_TIMEOUT_MS },
        cookies: bypassCookies(url),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return {
        ok: false,
        error: `Browser Rendering ${String(response.status)}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      };
    }

    const bytes = await response.arrayBuffer();
    return { ok: true, bytes };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: `Browser Rendering timeout after ${String(SCREENSHOT_API_TIMEOUT_MS)}ms` };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keep only the latest enqueuedAt per siteId.
 */
function deduplicateMessages(
  messages: readonly Message<ScreenshotQueueMessage>[],
): ScreenshotQueueMessage[] {
  const latest = new Map<string, ScreenshotQueueMessage>();
  for (const msg of messages) {
    const existing = latest.get(msg.body.siteId);
    if (existing === undefined || msg.body.enqueuedAt > existing.enqueuedAt) {
      latest.set(msg.body.siteId, msg.body);
    }
  }
  return [...latest.values()];
}
