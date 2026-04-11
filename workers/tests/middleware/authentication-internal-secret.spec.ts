/**
 * Authentication Middleware — INTERNAL_SECRET Guard Tests
 *
 * Tests that getIdentityProvider() skips registering CSSAuthIdentityProvider
 * when CSS_AUTH_SERVER is configured but INTERNAL_SECRET is empty or absent.
 * An empty secret would cause the auth server's /internal/token/validate to
 * reject every request with 403 (header present but wrong value), so the
 * provider must not be registered in that case.
 */

import { describe, it, expect, vi } from 'vitest';
import { getIdentityProvider } from '../../src/middleware/authentication';
import type { Env } from '../../src/index';

/** Minimal Env stub — only the fields relevant to this test are populated. */
function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'production',
    ...overrides,
  } as unknown as Env;
}

/** A minimal stub Fetcher that satisfies the Cloudflare Workers type. */
function makeFetcher(): Fetcher {
  return {
    fetch: vi.fn(),
  } as unknown as Fetcher;
}

describe('getIdentityProvider — INTERNAL_SECRET guard', () => {
  it('does not register CSSAuthIdentityProvider when INTERNAL_SECRET is missing', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const env = makeEnv({
      CSS_AUTH_SERVER: makeFetcher(),
      // INTERNAL_SECRET intentionally absent
    });

    const provider = getIdentityProvider(env);
    const providers = (provider as unknown as { providers: { name: string }[] }).providers;

    const cssAuthProvider = providers.find((p) => p.name === 'css_auth');
    expect(cssAuthProvider).toBeUndefined();

    consoleSpy.mockRestore();
  });

  it('does not register CSSAuthIdentityProvider when INTERNAL_SECRET is an empty string', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const env = makeEnv({
      CSS_AUTH_SERVER: makeFetcher(),
      INTERNAL_SECRET: '',
    });

    const provider = getIdentityProvider(env);
    const providers = (provider as unknown as { providers: { name: string }[] }).providers;

    const cssAuthProvider = providers.find((p) => p.name === 'css_auth');
    expect(cssAuthProvider).toBeUndefined();

    consoleSpy.mockRestore();
  });

  it('emits a console.warn when skipping CSSAuthIdentityProvider due to missing INTERNAL_SECRET', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const env = makeEnv({
      CSS_AUTH_SERVER: makeFetcher(),
      // INTERNAL_SECRET absent
    });

    getIdentityProvider(env);

    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls[0][0]).toContain('INTERNAL_SECRET');

    consoleSpy.mockRestore();
  });

  it('registers CSSAuthIdentityProvider when both CSS_AUTH_SERVER and INTERNAL_SECRET are set', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const env = makeEnv({
      CSS_AUTH_SERVER: makeFetcher(),
      INTERNAL_SECRET: 'super-secret-value',
    });

    const provider = getIdentityProvider(env);
    const providers = (provider as unknown as { providers: { name: string }[] }).providers;

    const cssAuthProvider = providers.find((p) => p.name === 'css_auth');
    expect(cssAuthProvider).toBeDefined();

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('does not register CSSAuthIdentityProvider when CSS_AUTH_SERVER is not configured', () => {
    const env = makeEnv({
      INTERNAL_SECRET: 'super-secret-value',
      // CSS_AUTH_SERVER absent
    });

    const provider = getIdentityProvider(env);
    const providers = (provider as unknown as { providers: { name: string }[] }).providers;

    const cssAuthProvider = providers.find((p) => p.name === 'css_auth');
    expect(cssAuthProvider).toBeUndefined();
  });
});
