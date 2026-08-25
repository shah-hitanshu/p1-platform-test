/**
 * Screenshot consumer tests.
 *
 * Mocks runWithConnection, the site-screenshot-service upsert, the R2 binding,
 * and global fetch (which the consumer calls to hit Browser Rendering REST).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ScreenshotQueueMessage } from '../../src/types/queue-messages';

vi.mock('../../src/db', () => ({
  runWithConnection: vi.fn().mockImplementation(
    async (_connStr: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
  ),
}));

vi.mock('../../src/services/site-screenshot-service', () => ({
  upsertSiteScreenshot: vi.fn().mockResolvedValue(undefined),
}));

interface MockMessage<T> {
  body: T;
  id: string;
  timestamp: Date;
  ack: () => void;
  retry: () => void;
}

interface MockBatch<T> {
  queue: string;
  messages: MockMessage<T>[];
  ackAll: () => void;
  retryAll: () => void;
}

function createMessage(body: ScreenshotQueueMessage): MockMessage<ScreenshotQueueMessage> {
  return {
    body,
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date(body.enqueuedAt),
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function createBatch(messages: MockMessage<ScreenshotQueueMessage>[]): MockBatch<ScreenshotQueueMessage> {
  return {
    queue: 'css-screenshot-queue',
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
}

interface MockR2 {
  put: ReturnType<typeof vi.fn>;
}

interface MockEnv {
  HYPERDRIVE?: { connectionString: string };
  POSTGRES_CONNECTION_STRING?: string;
  R2_SCREENSHOTS?: MockR2;
  CF_ACCOUNT_ID?: string;
  CF_BROWSER_API_TOKEN?: string;
}

function createEnv(overrides: Partial<MockEnv> = {}): MockEnv {
  return {
    POSTGRES_CONNECTION_STRING: 'postgres://test',
    R2_SCREENSHOTS: { put: vi.fn().mockResolvedValue(undefined) },
    CF_ACCOUNT_ID: 'acct-abc',
    CF_BROWSER_API_TOKEN: 'token-xyz',
    ...overrides,
  };
}

/** Every Browser Rendering request body sent this test, in call order. */
function capturedRequestBodies(): { cookies?: unknown; url: string }[] {
  return vi.mocked(globalThis.fetch).mock.calls.map(([, init]) => {
    const raw = init?.body;
    if (typeof raw !== 'string') throw new Error('test setup: expected a JSON string body');
    return JSON.parse(raw) as { cookies?: unknown; url: string };
  });
}

describe('Screenshot consumer', () => {
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { runWithConnection } = await import('../../src/db');
    vi.mocked(runWithConnection).mockImplementation(
      async (_connStr: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
    );
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('acks immediately on empty batch', async () => {
    const { handleScreenshotQueue } = await import('../../src/queues/screenshot-consumer');
    const batch = createBatch([]);

    await handleScreenshotQueue(batch as unknown as MessageBatch<ScreenshotQueueMessage>, createEnv());

    expect(batch.ackAll).toHaveBeenCalled();
  });

  it('retries when no database connection string is available', async () => {
    const { handleScreenshotQueue } = await import('../../src/queues/screenshot-consumer');
    const batch = createBatch([
      createMessage({ siteId: 's1', url: 'https://x', enqueuedAt: 1, reason: 'cron' }),
    ]);

    const env = createEnv({ POSTGRES_CONNECTION_STRING: undefined });
    await handleScreenshotQueue(batch as unknown as MessageBatch<ScreenshotQueueMessage>, env);

    expect(batch.retryAll).toHaveBeenCalled();
  });

  it('retries when R2 / account / token bindings are missing', async () => {
    const { handleScreenshotQueue } = await import('../../src/queues/screenshot-consumer');
    const batch = createBatch([
      createMessage({ siteId: 's1', url: 'https://x', enqueuedAt: 1, reason: 'cron' }),
    ]);

    const env = createEnv({ R2_SCREENSHOTS: undefined });
    await handleScreenshotQueue(batch as unknown as MessageBatch<ScreenshotQueueMessage>, env);
    expect(batch.retryAll).toHaveBeenCalled();
  });

  it('deduplicates by siteId, keeping the latest enqueuedAt', async () => {
    const { handleScreenshotQueue } = await import('../../src/queues/screenshot-consumer');
    const { upsertSiteScreenshot } = await import('../../src/services/site-screenshot-service');

    const png = new ArrayBuffer(8);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(png, { status: 200 }),
    ) as typeof fetch;

    const env = createEnv();
    const batch = createBatch([
      createMessage({ siteId: 'site-1', url: 'https://old.example.com', enqueuedAt: 1, reason: 'url_changed' }),
      createMessage({ siteId: 'site-1', url: 'https://new.example.com', enqueuedAt: 2, reason: 'cron' }),
    ]);

    await handleScreenshotQueue(batch as unknown as MessageBatch<ScreenshotQueueMessage>, env);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const fetchArgs = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(fetchArgs[1].body) as { url: string };
    expect(body.url).toBe('https://new.example.com');
    expect(upsertSiteScreenshot).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 'site-1',
      status: 'ok',
    }));
  });

  it('uploads to R2 and UPSERTs status=ok on a successful capture', async () => {
    const { handleScreenshotQueue } = await import('../../src/queues/screenshot-consumer');
    const { upsertSiteScreenshot } = await import('../../src/services/site-screenshot-service');

    const png = new ArrayBuffer(16);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(png, { status: 200 }),
    ) as typeof fetch;

    const env = createEnv();
    const batch = createBatch([
      createMessage({ siteId: 'site-42', url: 'https://example.com', enqueuedAt: 100, reason: 'published' }),
    ]);

    await handleScreenshotQueue(batch as unknown as MessageBatch<ScreenshotQueueMessage>, env);

    const r2 = env.R2_SCREENSHOTS;
    if (r2 === undefined) throw new Error('test setup: R2 missing');
    expect(r2.put).toHaveBeenCalledWith(
      'screenshots/site-42.png',
      png,
      expect.objectContaining({
        httpMetadata: expect.objectContaining({ contentType: 'image/png' }),
      }),
    );
    expect(upsertSiteScreenshot).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 'site-42',
      r2Key: 'screenshots/site-42.png',
      status: 'ok',
    }));
  });

  it('UPSERTs status=failed with HTTP code on non-200', async () => {
    const { handleScreenshotQueue } = await import('../../src/queues/screenshot-consumer');
    const { upsertSiteScreenshot } = await import('../../src/services/site-screenshot-service');

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('upstream gone', { status: 502 }),
    ) as typeof fetch;

    const env = createEnv();
    const batch = createBatch([
      createMessage({ siteId: 'site-x', url: 'https://example.com', enqueuedAt: 1, reason: 'cron' }),
    ]);

    await handleScreenshotQueue(batch as unknown as MessageBatch<ScreenshotQueueMessage>, env);

    const r2 = env.R2_SCREENSHOTS;
    if (r2 === undefined) throw new Error('test setup: R2 missing');
    expect(r2.put).not.toHaveBeenCalled();
    const upsertCall = vi.mocked(upsertSiteScreenshot).mock.calls[0][0];
    expect(upsertCall.status).toBe('failed');
    expect(upsertCall.error).toContain('502');
  });

  it('records a failed row when the capture call throws', async () => {
    const { handleScreenshotQueue } = await import('../../src/queues/screenshot-consumer');
    const { upsertSiteScreenshot } = await import('../../src/services/site-screenshot-service');

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network unreachable')) as typeof fetch;

    const env = createEnv();
    const batch = createBatch([
      createMessage({ siteId: 'site-y', url: 'https://example.com', enqueuedAt: 1, reason: 'cron' }),
    ]);

    await handleScreenshotQueue(batch as unknown as MessageBatch<ScreenshotQueueMessage>, env);

    const upsertCall = vi.mocked(upsertSiteScreenshot).mock.calls[0][0];
    expect(upsertCall.status).toBe('failed');
    expect(upsertCall.error).toContain('network unreachable');
  });

  it('sends bypass cookies scoped to each captured URL', async () => {
    const { handleScreenshotQueue } = await import('../../src/queues/screenshot-consumer');
    const { bypassCookies } = await import('../../src/utils/interstitial-bypass');

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new ArrayBuffer(8), { status: 200 }),
    ) as typeof fetch;

    const batch = createBatch([
      createMessage({ siteId: 'site-a', url: 'https://one.pantheonsite.io/', enqueuedAt: 1, reason: 'cron' }),
      createMessage({ siteId: 'site-b', url: 'https://two.pantheonsite.io/', enqueuedAt: 1, reason: 'cron' }),
    ]);

    await handleScreenshotQueue(
      batch as unknown as MessageBatch<ScreenshotQueueMessage>,
      createEnv() as unknown as Parameters<typeof handleScreenshotQueue>[1],
    );

    const bodies = capturedRequestBodies();
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.cookies).toEqual(bypassCookies(body.url));
    }
    expect(new Set(bodies.map((b) => b.url)).size).toBe(2);
  });
});
