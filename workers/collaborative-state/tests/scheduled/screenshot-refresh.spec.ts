/**
 * Weekly screenshot refresh tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  runWithConnection: vi.fn().mockImplementation(
    async (_connStr: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
  ),
}));

vi.mock('../../src/services/site-screenshot-service', () => ({
  listSitesNeedingScreenshotRefresh: vi.fn(),
}));

interface MockQueue {
  send: ReturnType<typeof vi.fn>;
}

function createEnv(overrides: { SCREENSHOT_QUEUE?: MockQueue; POSTGRES_CONNECTION_STRING?: string } = {}): {
  SCREENSHOT_QUEUE?: MockQueue;
  POSTGRES_CONNECTION_STRING?: string;
} {
  return {
    SCREENSHOT_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
    POSTGRES_CONNECTION_STRING: 'postgres://test',
    ...overrides,
  };
}

describe('runWeeklyScreenshotRefresh', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { runWithConnection } = await import('../../src/db');
    vi.mocked(runWithConnection).mockImplementation(
      async (_connStr: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
    );
  });

  it('returns early when SCREENSHOT_QUEUE binding is missing', async () => {
    const { runWeeklyScreenshotRefresh } = await import('../../src/scheduled/screenshot-refresh');
    const { listSitesNeedingScreenshotRefresh } = await import('../../src/services/site-screenshot-service');

    await runWeeklyScreenshotRefresh(createEnv({ SCREENSHOT_QUEUE: undefined }));

    expect(listSitesNeedingScreenshotRefresh).not.toHaveBeenCalled();
  });

  it('returns early when no database connection string is available', async () => {
    const { runWeeklyScreenshotRefresh } = await import('../../src/scheduled/screenshot-refresh');
    const { listSitesNeedingScreenshotRefresh } = await import('../../src/services/site-screenshot-service');

    await runWeeklyScreenshotRefresh(createEnv({ POSTGRES_CONNECTION_STRING: undefined }));

    expect(listSitesNeedingScreenshotRefresh).not.toHaveBeenCalled();
  });

  it('does nothing when no sites are stale', async () => {
    const { runWeeklyScreenshotRefresh } = await import('../../src/scheduled/screenshot-refresh');
    const { listSitesNeedingScreenshotRefresh } = await import('../../src/services/site-screenshot-service');

    vi.mocked(listSitesNeedingScreenshotRefresh).mockResolvedValue([]);

    const env = createEnv();
    await runWeeklyScreenshotRefresh(env);

    const queue = env.SCREENSHOT_QUEUE;
    if (queue === undefined) throw new Error('test setup: queue missing');
    expect(queue.send).not.toHaveBeenCalled();
  });

  it('enqueues a cron-reason message for each stale site', async () => {
    const { runWeeklyScreenshotRefresh } = await import('../../src/scheduled/screenshot-refresh');
    const { listSitesNeedingScreenshotRefresh } = await import('../../src/services/site-screenshot-service');

    vi.mocked(listSitesNeedingScreenshotRefresh).mockResolvedValue([
      { siteId: 'site-a', url: 'https://a.example.com' },
      { siteId: 'site-b', url: 'https://b.example.com' },
    ]);

    const env = createEnv();
    await runWeeklyScreenshotRefresh(env);

    const queue = env.SCREENSHOT_QUEUE;
    if (queue === undefined) throw new Error('test setup: queue missing');
    expect(queue.send).toHaveBeenCalledTimes(2);
    const messages = queue.send.mock.calls.map(
      (call) => call[0] as { siteId: string; url: string; reason: string },
    );
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ siteId: 'site-a', url: 'https://a.example.com', reason: 'cron' }),
      expect.objectContaining({ siteId: 'site-b', url: 'https://b.example.com', reason: 'cron' }),
    ]));
  });

  it('queries with a 7-day staleness window and a sensible per-run cap', async () => {
    const { runWeeklyScreenshotRefresh } = await import('../../src/scheduled/screenshot-refresh');
    const { listSitesNeedingScreenshotRefresh } = await import('../../src/services/site-screenshot-service');

    vi.mocked(listSitesNeedingScreenshotRefresh).mockResolvedValue([]);

    await runWeeklyScreenshotRefresh(createEnv());

    expect(listSitesNeedingScreenshotRefresh).toHaveBeenCalledWith({
      staleAfterDays: 7,
      limit: 500,
    });
  });
});
