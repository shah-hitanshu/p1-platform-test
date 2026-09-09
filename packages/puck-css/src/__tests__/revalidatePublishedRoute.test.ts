/**
 * Tests for revalidatePublishedRoute.
 *
 * Publishing reaches the backend directly, so the app serving the public pages
 * is only told a route changed by this call. It follows a publish that has
 * already committed, so it reports failure rather than raising it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { revalidatePublishedRoute } from '../editor/utils/revalidatePublishedRoute.js';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const token = async () => 'tok-123';

describe('revalidatePublishedRoute', () => {
  it('posts the path to the SDK revalidate action', async () => {
    await expect(revalidatePublishedRoute('/about', token)).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/p1/api/revalidate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ path: '/about' });
  });

  it('authenticates the request', async () => {
    await revalidatePublishedRoute('/about', token);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-123');
  });

  it('sends no Authorization header when there is no token', async () => {
    await revalidatePublishedRoute('/about', async () => null);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty('Authorization');
  });

  it('reports a rejected request instead of throwing', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    await expect(revalidatePublishedRoute('/about', token)).resolves.toBe(false);
  });

  // The publish this follows has already committed. Raising here would report a
  // successful publish as a failed one.
  it('reports a network failure instead of throwing', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(revalidatePublishedRoute('/about', token)).resolves.toBe(false);
  });

  it('reports a failure to obtain a token instead of throwing', async () => {
    await expect(
      revalidatePublishedRoute('/about', async () => {
        throw new Error('token endpoint down');
      }),
    ).resolves.toBe(false);
  });

  // try/catch covers a rejection, not a promise that never settles. The publish
  // flow waits on this call, so an unbounded await would hold up everything the
  // caller does after a publish — including reporting the publish as done.
  it('gives up on a request that never settles', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );

      const result = revalidatePublishedRoute('/about', token);
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a getToken that never settles', async () => {
    vi.useFakeTimers();
    try {
      const result = revalidatePublishedRoute('/about', () => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // Aborting has to cancel the request, not just abandon the await, so a stalled
  // connection is not left open behind a publish that has moved on.
  it('passes an abort signal to the request', async () => {
    await revalidatePublishedRoute('/about', token);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });
});
