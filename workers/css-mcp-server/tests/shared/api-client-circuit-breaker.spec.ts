/**
 * McpApiClient × CircuitBreaker integration tests (PCC-3192 / Finding 4)
 *
 * These tests are isolated from api-client.spec.ts because they need to
 * exercise the circuit-breaker module-scoped state, which the existing
 * api-client tests don't care about. Keeping them separate avoids cross-test
 * coupling on the shared breaker singleton.
 *
 * Behaviour locked in:
 *   - doFetch consults the per-isolate circuit breaker for the upstream
 *   - Successful fetches keep the breaker closed
 *   - Repeated 5xx responses trip the breaker
 *   - Once tripped, doFetch fast-fails with a clear error (no upstream call)
 *   - The error message is informative enough for the LLM-facing handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const defaultConfig = {
  baseUrl: 'http://localhost:8787',
  agentId: 'agent-uuid-1',
  agentApiKey: 'aak_test-key',
};

function createMockResponse(status: number, data: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response;
}

describe('McpApiClient × CircuitBreaker', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    // Reset module-scoped breaker state between tests so failure counters
    // don't leak across describe blocks.
    const mod = await import('../../src/circuit-breaker.js');
    mod.resetAllBreakersForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the breaker closed on successful fetches', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { getBackendBreakerStateForTesting } = await import('../../src/circuit-breaker.js');

    const client = new McpApiClient(defaultConfig);
    mockFetch.mockResolvedValue(createMockResponse(200, { sites: [], total: 0 }));

    await client.listSites();
    await client.listSites();
    await client.listSites();

    expect(getBackendBreakerStateForTesting()).toBe('closed');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('opens the breaker after enough consecutive 5xx and then fast-fails', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { getBackendBreakerStateForTesting } = await import('../../src/circuit-breaker.js');

    const client = new McpApiClient(defaultConfig);

    // Simulate sustained backend failure
    mockFetch.mockResolvedValue(createMockResponse(503, { error: 'unavailable' }));

    // Default failureThreshold is 5 (matches the production config). Five
    // tool calls of 5xx should trip the breaker.
    for (let i = 0; i < 5; i++) {
      await expect(client.listSites()).rejects.toThrow();
    }

    expect(getBackendBreakerStateForTesting()).toBe('open');
    expect(mockFetch).toHaveBeenCalledTimes(5);

    // Next call must fast-fail without invoking fetch
    await expect(client.listSites()).rejects.toThrow(/backend|unavailable|circuit/i);
    expect(mockFetch).toHaveBeenCalledTimes(5); // unchanged
  });

  it('surfaces a clear error message when the circuit is open', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');

    const client = new McpApiClient(defaultConfig);
    mockFetch.mockResolvedValue(createMockResponse(500, { error: 'oops' }));

    for (let i = 0; i < 5; i++) {
      await expect(client.listSites()).rejects.toThrow();
    }

    // The fast-fail error needs enough signal that the tool handler can
    // turn it into a useful "backend unavailable" message for the LLM —
    // not a raw "fetch failed" or "undefined".
    try {
      await client.listSites();
      throw new Error('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message.length).toBeGreaterThan(0);
      // Must mention the upstream or the backpressure concept; we accept any
      // of these so the wording can evolve without forcing a test edit.
      expect(message).toMatch(/backend|circuit|unavailable|upstream/i);
    }
  });
});
