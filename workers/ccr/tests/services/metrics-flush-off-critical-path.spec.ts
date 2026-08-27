/**
 * Regression test for PCC-3733: the request `finally` block must not await
 * flushMetrics(). The flush is an outbound HTTP POST — awaiting it puts the
 * round-trip on the critical path of every response. It must be handed to
 * ctx.waitUntil (like the adjacent log flush) so the response returns
 * immediately while the isolate stays alive to deliver the metrics.
 */
import { describe, it, expect, vi } from 'vitest';

const flushState = vi.hoisted(() => ({
  pending: undefined as Promise<void> | undefined,
  resolve: undefined as (() => void) | undefined,
}));

vi.mock('../../src/services/metrics-service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/services/metrics-service')>();
  return {
    ...actual,
    // A flush that stays pending until the test resolves it. If the worker
    // awaits it, the response can never settle first.
    flushMetrics: vi.fn(() => {
      flushState.pending = new Promise<void>((resolve) => {
        flushState.resolve = resolve;
      });
      return flushState.pending;
    }),
  };
});

import worker from '../../src/index';
import type { Env } from '../../src/index';

describe('PCC-3733: metrics flush stays off the response critical path', () => {
  it('returns the response while flushMetrics() is still pending, keeping it alive via ctx.waitUntil', async () => {
    const env = {
      // Lazy postgres client: an OPTIONS preflight to a non-site path never
      // issues a query, so this connection string is never dialed.
      POSTGRES_CONNECTION_STRING: 'postgres://user:pass@localhost:5432/unused',
      METRICS_ENABLED: 'false',
      ENVIRONMENT: 'test',
    } as unknown as Env;
    const waitUntil = vi.fn();
    const ctx = {
      waitUntil,
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    const responsePromise = worker.fetch(
      new Request('https://css.example.com/api/health', { method: 'OPTIONS' }),
      env,
      ctx,
    );

    const timedOut = Symbol('timed out');
    const settled = await Promise.race([
      responsePromise,
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(timedOut);
        }, 5000);
      }),
    ]);

    // A regression back to `await flushMetrics()` makes the response wait on
    // the (still-pending) flush, so it times out here instead of settling.
    expect(
      settled,
      'response must settle while the metrics flush is still pending',
    ).not.toBe(timedOut);
    expect(settled).toBeInstanceOf(Response);

    // The pending flush must be handed to waitUntil — not dropped — or the
    // isolate can tear down before the metrics POST completes.
    expect(flushState.pending).toBeDefined();
    expect(waitUntil.mock.calls.some(([p]) => p === flushState.pending)).toBe(
      true,
    );

    flushState.resolve?.();
  });
});
