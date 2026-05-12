/**
 * Binding-mode startup log tests (PCC-3193 / red-team Finding 6 defense-in-depth)
 *
 * The MCP server's api-client falls back to global fetch() when the
 * CSS_BACKEND service binding is not wired up. In that fallback mode the
 * shared agent API key transits the public Internet — exactly the prod bug
 * the binding-config fix in this PR closes. The startup log makes future
 * regressions visible: any cold start without the binding emits a warn.
 *
 * Behaviour locked in by these tests:
 *   1. CSS_BACKEND present  → console.log "service-binding"
 *   2. CSS_BACKEND missing  → console.warn "public-fetch" AND "MISSING"
 *   3. one-shot per isolate → repeat calls do NOT re-log
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Binding-mode cold-start log', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs service-binding mode when CSS_BACKEND fetcher is present', async () => {
    vi.resetModules();
    const { logBindingModeOnce } = await import('../src/binding-mode.js');
    logBindingModeOnce({ CSS_BACKEND: {} as Fetcher });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('CSS_BACKEND');
    expect(logSpy.mock.calls[0][0]).toContain('service-binding');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns public-fetch + MISSING when CSS_BACKEND is undefined', async () => {
    vi.resetModules();
    const { logBindingModeOnce } = await import('../src/binding-mode.js');
    logBindingModeOnce({ CSS_BACKEND: undefined });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0][0]);
    expect(msg).toContain('CSS_BACKEND');
    expect(msg).toContain('public-fetch');
    expect(msg).toContain('MISSING');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('only logs once per isolate even on repeat invocations', async () => {
    vi.resetModules();
    const { logBindingModeOnce } = await import('../src/binding-mode.js');
    logBindingModeOnce({ CSS_BACKEND: undefined });
    logBindingModeOnce({ CSS_BACKEND: undefined });
    logBindingModeOnce({ CSS_BACKEND: undefined });

    // Three calls but only the first should log: this is the volume-bound
    // guarantee. Without it, a misconfigured prod env would spam logs on
    // every request.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
