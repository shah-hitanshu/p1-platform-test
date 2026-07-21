import { describe, it, expect, vi, afterEach } from 'vitest';
import { sleep, trimTrailingSlash } from '../src/utils.js';

describe('sleep', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves after the specified delay', async () => {
    vi.useFakeTimers();
    const p = sleep(100);
    vi.advanceTimersByTime(100);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it('rejects immediately if the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1000, controller.signal)).rejects.toThrow('Aborted');
  });

  it('rejects when the signal is aborted during the wait', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const p = sleep(5000, controller.signal);
    controller.abort();
    await expect(p).rejects.toThrow('Aborted');
    vi.useRealTimers();
  });

  it('clears the timer on abort so it does not resolve later', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const p = sleep(5000, controller.signal);
    controller.abort();
    await expect(p).rejects.toThrow('Aborted');
    vi.advanceTimersByTime(10000);
    vi.useRealTimers();
  });
});

describe('trimTrailingSlash', () => {
  it('removes a trailing slash', () => {
    expect(trimTrailingSlash('https://example.com/')).toBe('https://example.com');
  });

  it('leaves a URL without trailing slash unchanged', () => {
    expect(trimTrailingSlash('https://example.com')).toBe('https://example.com');
  });

  it('only removes the last slash', () => {
    expect(trimTrailingSlash('https://example.com/path/')).toBe('https://example.com/path');
  });

  it('handles an empty string', () => {
    expect(trimTrailingSlash('')).toBe('');
  });

  it('handles a bare slash', () => {
    expect(trimTrailingSlash('/')).toBe('');
  });
});
