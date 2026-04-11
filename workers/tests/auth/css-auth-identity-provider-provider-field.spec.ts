/**
 * CSSAuthIdentityProvider — provider field validation tests
 *
 * Verifies that the `provider` field in token props is handled correctly:
 * - Known values ('google', 'auth0') produce a valid principal.
 * - Unrecognised values fall back to 'google' (backward compat) — no rejection.
 * - Absent field (tokens issued before provider tracking) also falls back safely.
 *
 * Note: each test uses a unique token string to avoid hitting the module-level
 * validation cache, which would prevent the mock fetcher from being called and
 * obscure whether the warning path was reached.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CSSAuthIdentityProvider } from '../../src/auth/css-auth-identity-provider.js';

function makeProvider(mockFetcher: Fetcher): CSSAuthIdentityProvider {
  return new CSSAuthIdentityProvider({
    authServerUrl: 'https://css-auth.example.com',
    internalSecret: 'test-secret',
    fetcher: mockFetcher,
  });
}

function makeMockFetcher(providerValue: string | undefined): Fetcher {
  const props: Record<string, string | undefined> = {
    userId: 'sub-12345',
    email: 'user@example.com',
    name: 'Test User',
  };
  if (providerValue !== undefined) {
    props.provider = providerValue;
  }
  return {
    fetch: vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          active: true,
          sub: 'sub-12345',
          exp: Math.floor(Date.now() / 1000) + 3600,
          props,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  } as unknown as Fetcher;
}

describe('CSSAuthIdentityProvider — provider field handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns a valid principal when provider is "google"', async () => {
    const fetcher = makeMockFetcher('google');
    const provider = makeProvider(fetcher);
    // Unique token per test — bypasses the module-level validation cache
    const principal = await provider.validateToken('provider-field-test-google:grantid:secret1');
    expect(principal).not.toBeNull();
    expect(principal?.authProvider).toBe('css_auth');
    expect(principal?.type).toBe('user');
    expect(principal?.email).toBe('user@example.com');
  });

  it('returns a valid principal when provider is "auth0"', async () => {
    const fetcher = makeMockFetcher('auth0');
    const provider = makeProvider(fetcher);
    const principal = await provider.validateToken('provider-field-test-auth0:grantid:secret2');
    expect(principal).not.toBeNull();
    expect(principal?.authProvider).toBe('css_auth');
    expect(principal?.type).toBe('user');
    expect(principal?.email).toBe('user@example.com');
  });

  it('returns a valid principal (defaults to google) when provider is an unrecognised value', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetcher = makeMockFetcher('unknown-idp');
    const provider = makeProvider(fetcher);
    const principal = await provider.validateToken('provider-field-test-unknown:grantid:secret3');
    expect(principal).not.toBeNull();
    expect(principal?.authProvider).toBe('css_auth');
    expect(principal?.type).toBe('user');
    // A warning must be logged for the unrecognised provider value
    expect(warnSpy).toHaveBeenCalledWith(
      '[CSSAuthIdentityProvider] unexpected provider value in token props:',
      'unknown-idp',
    );
    warnSpy.mockRestore();
  });

  it('returns a valid principal (defaults to google) when the provider field is absent', async () => {
    // Tokens issued before provider tracking was added have no provider field.
    const fetcher = makeMockFetcher(undefined);
    const provider = makeProvider(fetcher);
    const principal = await provider.validateToken('provider-field-test-absent:grantid:secret4');
    expect(principal).not.toBeNull();
    expect(principal?.authProvider).toBe('css_auth');
    expect(principal?.type).toBe('user');
  });

  it('does NOT log a warning when provider is absent (backward-compat case is expected)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetcher = makeMockFetcher(undefined);
    const provider = makeProvider(fetcher);
    await provider.validateToken('provider-field-test-absent-nowarn:grantid:secret5');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does NOT log a warning when provider is "google"', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetcher = makeMockFetcher('google');
    const provider = makeProvider(fetcher);
    await provider.validateToken('provider-field-test-google-nowarn:grantid:secret6');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does NOT log a warning when provider is "auth0"', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetcher = makeMockFetcher('auth0');
    const provider = makeProvider(fetcher);
    await provider.validateToken('provider-field-test-auth0-nowarn:grantid:secret7');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
