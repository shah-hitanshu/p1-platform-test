import { context as otelContext } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `setGlobalContextManager` returns false when a manager is already registered — which
 * a Next.js app with its own OpenTelemetry setup will have done before we load.
 *
 * The bug this pins: keying the "already installed" guard on that return value meant the
 * guard never latched in exactly that case, so every request allocated a fresh
 * `AsyncLocalStorageContextManager`, enabled it, and drew an OTel diagnostic. Registration
 * has to be attempted once and only once, whatever the answer.
 *
 * The spy counts calls but lets them through: a mock that swallowed the registration
 * would leave no context manager at all, which is not the situation being tested.
 */
describe('installContextManager', () => {
  let setGlobal: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    otelContext.disable();
  });

  afterEach(() => {
    setGlobal.mockRestore();
    otelContext.disable();
  });

  async function driveRequests(count: number): Promise<string | undefined> {
    const { contextFromRequest, currentContext, withRequestContext } = await import(
      '../src/context.js'
    );
    let seen: string | undefined;
    for (let i = 0; i < count; i += 1) {
      const request = contextFromRequest(new Request('https://example.com/'));
      seen = withRequestContext(request, () =>
        currentContext()?.traceId === request.traceId ? request.traceId : undefined,
      );
    }
    return seen;
  }

  it('attempts registration once when a host already owns the context manager', async () => {
    // The host — a Next.js app with its own OpenTelemetry — gets there first.
    otelContext.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    setGlobal = vi.spyOn(otelContext, 'setGlobalContextManager');

    const seen = await driveRequests(25);

    expect(setGlobal).toHaveBeenCalledTimes(1);
    // Losing the race is survivable: the host's manager is AsyncLocalStorage-backed too,
    // so our context still propagates through it.
    expect(seen).toBeDefined();
  });

  it('attempts registration once when it succeeds', async () => {
    setGlobal = vi.spyOn(otelContext, 'setGlobalContextManager');

    const seen = await driveRequests(25);

    expect(setGlobal).toHaveBeenCalledTimes(1);
    expect(seen).toBeDefined();
  });
});
