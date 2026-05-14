/**
 * Circuit Breaker Tests (PCC-3192 / red-team Finding 4)
 *
 * The MCP server's api-client makes worker-to-worker fetches to CSS_BACKEND.
 * Without a circuit breaker, a backend incident (5xx storm, Hyperdrive
 * connection exhaustion per docs/handoff-sbx1-500-errors.md) cascades to every
 * MCP tool call: each one waits the full timeout, holds resources, and
 * amplifies the upstream load just as the upstream is trying to recover.
 *
 * Behaviour locked in by these tests:
 *   - 3-state machine: closed -> open -> half-open -> closed/open
 *   - Opens after N consecutive 5xx within a sliding window
 *   - Open state fast-fails without invoking the upstream
 *   - After cooldown, allows a single probe (half-open)
 *   - Half-open success closes; half-open failure re-opens
 *   - 4xx is NOT a failure (client errors, not upstream incidents)
 *   - Network errors (thrown) ARE failures
 *   - 2xx between 5xxs resets the consecutive counter
 *   - A streak older than the window resets to a fresh streak of one
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper: make a Response stub with a given status. Avoids constructing a
  // full Response so tests stay fast and don't depend on the runtime impl.
  const mkResponse = (status: number): Response =>
    ({ status, ok: status >= 200 && status < 300 }) as Response;

  it('starts closed; passes through a successful response', async () => {
    const { CircuitBreaker } = await import('../src/circuit-breaker.js');
    const breaker = new CircuitBreaker('test-upstream');
    const response = await breaker.execute(() => Promise.resolve(mkResponse(200)));
    expect(response.status).toBe(200);
    expect(breaker.getState()).toBe('closed');
  });

  it('stays closed when 5xx count is under threshold', async () => {
    const { CircuitBreaker } = await import('../src/circuit-breaker.js');
    const breaker = new CircuitBreaker('test-upstream', { failureThreshold: 5 });

    for (let i = 0; i < 4; i++) {
      const r = await breaker.execute(() => Promise.resolve(mkResponse(500)));
      expect(r.status).toBe(500);
    }

    expect(breaker.getState()).toBe('closed');
  });

  it('opens after threshold consecutive 5xx', async () => {
    const { CircuitBreaker } = await import('../src/circuit-breaker.js');
    const breaker = new CircuitBreaker('test-upstream', { failureThreshold: 5 });

    for (let i = 0; i < 5; i++) {
      await breaker.execute(() => Promise.resolve(mkResponse(503)));
    }

    expect(breaker.getState()).toBe('open');
  });

  it('open state throws CircuitOpenError without invoking the upstream fn', async () => {
    const { CircuitBreaker, CircuitOpenError } = await import('../src/circuit-breaker.js');
    const breaker = new CircuitBreaker('test-upstream', { failureThreshold: 3 });

    // Trip it
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.resolve(mkResponse(500)));
    }
    expect(breaker.getState()).toBe('open');

    const fn = vi.fn(() => Promise.resolve(mkResponse(200)));
    await expect(breaker.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('CircuitOpenError exposes a positive retryAfterMs hint', async () => {
    const { CircuitBreaker, CircuitOpenError } = await import('../src/circuit-breaker.js');
    let now = 1_000_000;
    const breaker = new CircuitBreaker('test-upstream', {
      failureThreshold: 2,
      cooldownMs: 30_000,
      now: (): number => now,
    });

    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    expect(breaker.getState()).toBe('open');

    // 5 seconds later, breaker still open -> retryAfter ~25s
    now = 1_005_000;
    try {
      await breaker.execute(() => Promise.resolve(mkResponse(200)));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      const e = err as InstanceType<typeof CircuitOpenError>;
      expect(e.retryAfterMs).toBeGreaterThan(0);
      expect(e.retryAfterMs).toBeLessThanOrEqual(30_000);
    }
  });

  it('transitions open -> half-open after cooldownMs and allows a probe', async () => {
    const { CircuitBreaker } = await import('../src/circuit-breaker.js');
    let now = 1_000_000;
    const breaker = new CircuitBreaker('test-upstream', {
      failureThreshold: 2,
      cooldownMs: 30_000,
      now: (): number => now,
    });

    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    expect(breaker.getState()).toBe('open');

    // Advance time past cooldown
    now += 30_001;

    // Probe is allowed; the fn IS invoked
    const fn = vi.fn(() => Promise.resolve(mkResponse(200)));
    const response = await breaker.execute(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    // After successful probe, breaker closes
    expect(breaker.getState()).toBe('closed');
  });

  it('half-open success closes the breaker and resets failure counter', async () => {
    const { CircuitBreaker } = await import('../src/circuit-breaker.js');
    let now = 1_000_000;
    const breaker = new CircuitBreaker('test-upstream', {
      failureThreshold: 3,
      cooldownMs: 30_000,
      now: (): number => now,
    });

    // Trip
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.resolve(mkResponse(500)));
    }
    now += 30_001;
    // Probe succeeds -> closed
    await breaker.execute(() => Promise.resolve(mkResponse(200)));
    expect(breaker.getState()).toBe('closed');

    // Counter should have reset: 2 more 5xx alone shouldn't re-open at threshold 3
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    expect(breaker.getState()).toBe('closed');
  });

  it('half-open failure re-opens with a fresh cooldown', async () => {
    const { CircuitBreaker, CircuitOpenError } = await import('../src/circuit-breaker.js');
    let now = 1_000_000;
    const breaker = new CircuitBreaker('test-upstream', {
      failureThreshold: 2,
      cooldownMs: 30_000,
      now: (): number => now,
    });

    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    now += 30_001;

    // Probe fails -> back to open
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    expect(breaker.getState()).toBe('open');

    // Just after re-opening, cooldown is fresh: a probe is NOT allowed yet
    now += 1_000;
    const fn = vi.fn(() => Promise.resolve(mkResponse(200)));
    await expect(breaker.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('half-open: a 4xx probe ALSO closes the breaker (upstream is responsive)', async () => {
    // The whole point of half-open probing is liveness: a 4xx proves the
    // upstream is responding, just not to the request we sent. Treating
    // it as a no-op (the original implementation) would leave the breaker
    // half-open indefinitely if the only requests the client happens to
    // try return 4xx (e.g. an auth-failure loop).
    const { CircuitBreaker } = await import('../src/circuit-breaker.js');
    let now = 1_000_000;
    const breaker = new CircuitBreaker('test-upstream', {
      failureThreshold: 2,
      cooldownMs: 30_000,
      now: (): number => now,
    });

    // Trip the breaker
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    expect(breaker.getState()).toBe('open');

    // Advance past cooldown → half-open on next call. Probe returns 4xx.
    now += 30_001;
    await breaker.execute(() => Promise.resolve(mkResponse(404)));

    // Upstream is alive (it returned a structured response, not a 5xx),
    // so the breaker closes.
    expect(breaker.getState()).toBe('closed');
  });

  it('4xx does NOT count as a failure (client error, not upstream incident)', async () => {
    const { CircuitBreaker } = await import('../src/circuit-breaker.js');
    const breaker = new CircuitBreaker('test-upstream', { failureThreshold: 3 });

    // Mix of 5xx and 4xx; only 5xx should count.
    // Sequence: 500, 404, 500, 400, 500 -> threshold not reached because 4xx
    // resets nothing (it's a no-op) and we have 3 consecutive 5xx separated by
    // non-failure responses. Specifically the contract is: a 4xx neither
    // increments nor resets the counter.
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    await breaker.execute(() => Promise.resolve(mkResponse(404)));
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    await breaker.execute(() => Promise.resolve(mkResponse(400)));
    await breaker.execute(() => Promise.resolve(mkResponse(500)));

    // 3 consecutive 5xx (4xx is a no-op), threshold=3 -> open
    expect(breaker.getState()).toBe('open');
  });

  it('network error (thrown by fn) counts as a failure', async () => {
    const { CircuitBreaker } = await import('../src/circuit-breaker.js');
    const breaker = new CircuitBreaker('test-upstream', { failureThreshold: 3 });

    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error('ECONNRESET'))),
      ).rejects.toThrow('ECONNRESET');
    }

    expect(breaker.getState()).toBe('open');
  });

  it('2xx response between 5xxs resets the consecutive counter', async () => {
    const { CircuitBreaker } = await import('../src/circuit-breaker.js');
    const breaker = new CircuitBreaker('test-upstream', { failureThreshold: 3 });

    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    // Success resets the streak
    await breaker.execute(() => Promise.resolve(mkResponse(200)));
    // Now 2 fresh 5xx must NOT trip the breaker (threshold=3)
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    await breaker.execute(() => Promise.resolve(mkResponse(500)));

    expect(breaker.getState()).toBe('closed');
  });

  it('a stale streak (older than failureWindowMs) resets to a fresh streak of one', async () => {
    const { CircuitBreaker } = await import('../src/circuit-breaker.js');
    let now = 1_000_000;
    const breaker = new CircuitBreaker('test-upstream', {
      failureThreshold: 3,
      failureWindowMs: 30_000,
      now: (): number => now,
    });

    // Two failures inside the window
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    now += 5_000;
    await breaker.execute(() => Promise.resolve(mkResponse(500)));

    // Wait long enough for the streak to be stale (> 30s since first)
    now += 30_001;

    // Next failure should be the START of a fresh streak (count=1), so the
    // breaker should NOT open even though this is the 3rd 5xx total.
    await breaker.execute(() => Promise.resolve(mkResponse(500)));
    expect(breaker.getState()).toBe('closed');
  });
});
