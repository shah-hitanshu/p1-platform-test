/**
 * CircuitBreaker (PCC-3192 / red-team Finding 4)
 *
 * Wraps an upstream fetch so that, after enough consecutive 5xx within a
 * sliding window, further calls fast-fail without touching the upstream.
 * Without this, a backend incident (e.g. Hyperdrive connection exhaustion
 * per docs/handoff-sbx1-500-errors.md) would cascade to every MCP tool
 * call: each one waits the full timeout, holds resources, and amplifies
 * the upstream load just as it tries to recover.
 *
 * State machine:
 *   closed     normal traffic. Track consecutive failures within the window.
 *   open       fast-fail. Reject every call with CircuitOpenError until the
 *              cooldown elapses, then transition to half-open.
 *   half-open  allow exactly one probe. Success → closed (counter reset).
 *              Failure → back to open with a fresh cooldown.
 *
 * Failure semantics:
 *   - HTTP 5xx counts as a failure.
 *   - Network errors (the wrapped fn throws) count as failures.
 *   - HTTP 4xx is NOT a failure (client error, not upstream incident); it
 *     neither increments nor resets the streak.
 *   - HTTP 2xx/3xx resets the consecutive counter.
 *   - A streak older than failureWindowMs resets to a fresh streak of one
 *     when the next failure arrives — matches the ticket's "consecutive 5xx
 *     in 30s" wording without latching forever on a slow leak.
 *
 * Per-isolate state. Cloudflare Workers load-balances across isolates, so
 * each isolate keeps its own breaker view. We document this rather than
 * paying the latency cost of a Durable Object on every request.
 */

export interface CircuitBreakerOptions {
  /** Consecutive 5xx (or thrown) responses needed to open. */
  failureThreshold?: number;
  /**
   * Bound on how stale a streak can get. If the gap between the first
   * failure in the streak and a new failure exceeds this, we reset the
   * streak to one. Without it, a slow drip of 5xx over hours would
   * eventually open the breaker on what is really just sporadic flakiness.
   */
  failureWindowMs?: number;
  /** How long the breaker stays open before allowing a probe. */
  cooldownMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

type State = 'closed' | 'open' | 'half-open';

interface InternalState {
  state: State;
  consecutiveFailures: number;
  // Timestamp of the FIRST failure in the current streak. Used to enforce
  // failureWindowMs.
  streakStartedAt: number | null;
  // When the breaker most recently opened — drives cooldown end.
  openedAt: number | null;
}

export class CircuitOpenError extends Error {
  readonly retryAfterMs: number;

  constructor(name: string, retryAfterMs: number) {
    super(
      `Backend "${name}" temporarily unavailable (circuit open) — ` +
      `retry in ${String(Math.ceil(retryAfterMs / 1000))}s`,
    );
    this.name = 'CircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

const DEFAULTS = {
  failureThreshold: 5,
  failureWindowMs: 30_000,
  cooldownMs: 30_000,
};

export class CircuitBreaker {
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly failureWindowMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly s: InternalState;

  constructor(name: string, opts: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = opts.failureThreshold ?? DEFAULTS.failureThreshold;
    this.failureWindowMs = opts.failureWindowMs ?? DEFAULTS.failureWindowMs;
    this.cooldownMs = opts.cooldownMs ?? DEFAULTS.cooldownMs;
    this.now = opts.now ?? ((): number => Date.now());
    this.s = {
      state: 'closed',
      consecutiveFailures: 0,
      streakStartedAt: null,
      openedAt: null,
    };
  }

  getState(): State {
    return this.s.state;
  }

  /**
   * Run fn through the breaker. If the breaker is open and the cooldown
   * has not elapsed, throws CircuitOpenError without invoking fn.
   * Otherwise invokes fn and updates breaker state based on the outcome.
   */
  async execute(fn: () => Promise<Response>): Promise<Response> {
    const t = this.now();

    if (this.s.state === 'open') {
      if (this.s.openedAt !== null && t - this.s.openedAt < this.cooldownMs) {
        const retryAfterMs = this.cooldownMs - (t - this.s.openedAt);
        throw new CircuitOpenError(this.name, retryAfterMs);
      }
      // Cooldown elapsed → allow a probe.
      this.s.state = 'half-open';
    }

    try {
      const response = await fn();
      this.recordResponse(response.status, t);
      return response;
    } catch (err) {
      // Network error / fetch threw → count as failure.
      this.recordFailure(t);
      throw err;
    }
  }

  private recordResponse(status: number, t: number): void {
    if (status >= 500) {
      this.recordFailure(t);
      return;
    }

    // In half-open we are PROBING liveness. Any non-5xx response — even a
    // 4xx — proves the upstream is responsive, so the probe succeeded and
    // the breaker can close. Without this, a 4xx in half-open would be a
    // no-op and the breaker would stay half-open indefinitely waiting for
    // a 2xx that may never come (e.g. if the only paths the client tries
    // happen to return 4xx). Caught in pre-push review.
    if (this.s.state === 'half-open') {
      this.recordSuccess();
      return;
    }

    if (status >= 400) {
      // Closed-state 4xx is a no-op: client error, not an upstream incident.
      // We deliberately do NOT reset the consecutive 5xx streak on a 4xx
      // (since the upstream isn't necessarily healthier just because the
      // CALLER made a malformed request).
      return;
    }

    // 2xx / 3xx in closed state — resets the streak.
    this.recordSuccess();
  }

  private recordSuccess(): void {
    this.s.consecutiveFailures = 0;
    this.s.streakStartedAt = null;
    if (this.s.state === 'half-open') {
      this.s.state = 'closed';
      this.s.openedAt = null;
    }
  }

  private recordFailure(t: number): void {
    if (this.s.state === 'half-open') {
      // Probe failed → straight back to open with fresh cooldown.
      this.s.state = 'open';
      this.s.openedAt = t;
      this.s.consecutiveFailures = 1;
      this.s.streakStartedAt = t;
      return;
    }

    // closed-state bookkeeping
    if (
      this.s.streakStartedAt !== null &&
      t - this.s.streakStartedAt > this.failureWindowMs
    ) {
      // Stale streak — restart counting from this failure.
      this.s.consecutiveFailures = 1;
      this.s.streakStartedAt = t;
    } else {
      if (this.s.consecutiveFailures === 0) {
        this.s.streakStartedAt = t;
      }
      this.s.consecutiveFailures++;
    }

    if (this.s.consecutiveFailures >= this.failureThreshold) {
      this.s.state = 'open';
      this.s.openedAt = t;
    }
  }
}

// =============================================================================
// Module-scoped per-isolate breaker for the CCR_BACKEND upstream.
//
// One process-wide instance, shared by every doFetch call in api-client.ts
// for the lifetime of the isolate. Documenting here rather than at the
// call-site so future maintainers don't expect cross-isolate consensus.
// =============================================================================

const BACKEND_BREAKER_KEY = 'CCR_BACKEND';
const breakers = new Map<string, CircuitBreaker>();

export function getBackendBreaker(): CircuitBreaker {
  let breaker = breakers.get(BACKEND_BREAKER_KEY);
  if (!breaker) {
    breaker = new CircuitBreaker(BACKEND_BREAKER_KEY);
    breakers.set(BACKEND_BREAKER_KEY, breaker);
  }
  return breaker;
}

// Test-only helpers. Exported so the api-client integration tests can
// reset state between tests without exposing the Map directly.
export function resetAllBreakersForTesting(): void {
  breakers.clear();
}

export function getBackendBreakerStateForTesting(): State {
  return getBackendBreaker().getState();
}
