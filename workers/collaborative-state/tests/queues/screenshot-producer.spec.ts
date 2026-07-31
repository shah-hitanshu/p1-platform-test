/**
 * Screenshot producer tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScreenshotQueueMessage } from '../../src/types/queue-messages';

interface MockQueue {
  send: ReturnType<typeof vi.fn>;
}

function createEnv(queue?: MockQueue): { SCREENSHOT_QUEUE?: MockQueue } {
  return queue ? { SCREENSHOT_QUEUE: queue } : {};
}

describe('Screenshot producer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('does nothing when SCREENSHOT_QUEUE binding is absent', async () => {
    const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');

    await expect(
      requestSiteScreenshot({}, { id: 'site-1', url: 'https://example.com' }, 'url_changed'),
    ).resolves.toBeUndefined();
  });

  it('does nothing when site has no url', async () => {
    const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');
    const queue: MockQueue = { send: vi.fn() };

    await requestSiteScreenshot(createEnv(queue) as unknown as Parameters<typeof requestSiteScreenshot>[0], { id: 'site-1' }, 'url_changed');
    await requestSiteScreenshot(createEnv(queue) as unknown as Parameters<typeof requestSiteScreenshot>[0], { id: 'site-2', url: null }, 'url_changed');
    await requestSiteScreenshot(createEnv(queue) as unknown as Parameters<typeof requestSiteScreenshot>[0], { id: 'site-3', url: '' }, 'url_changed');

    expect(queue.send).not.toHaveBeenCalled();
  });

  it('sends a message with the expected shape when site has a url', async () => {
    const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');
    const queue: MockQueue = { send: vi.fn().mockResolvedValue(undefined) };

    const before = Date.now();
    await requestSiteScreenshot(
      createEnv(queue) as unknown as Parameters<typeof requestSiteScreenshot>[0],
      { id: 'site-1', url: 'https://example.com' },
      'published',
    );
    const after = Date.now();

    expect(queue.send).toHaveBeenCalledTimes(1);
    const message = queue.send.mock.calls[0][0] as ScreenshotQueueMessage;
    expect(message.siteId).toBe('site-1');
    expect(message.url).toBe('https://example.com');
    expect(message.reason).toBe('published');
    expect(message.enqueuedAt).toBeGreaterThanOrEqual(before);
    expect(message.enqueuedAt).toBeLessThanOrEqual(after);
  });

  it('swallows enqueue errors and never throws', async () => {
    const { requestSiteScreenshot } = await import('../../src/queues/screenshot-producer');
    const queue: MockQueue = { send: vi.fn().mockRejectedValue(new Error('queue down')) };

    await expect(
      requestSiteScreenshot(
        createEnv(queue) as unknown as Parameters<typeof requestSiteScreenshot>[0],
        { id: 'site-1', url: 'https://example.com' },
        'cron',
      ),
    ).resolves.toBeUndefined();
  });
});
