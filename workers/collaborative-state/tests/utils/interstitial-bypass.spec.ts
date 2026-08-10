import { describe, it, expect } from 'vitest';
import { bypassCookies, INTERSTITIAL_BYPASS_COOKIES } from '../../src/utils/interstitial-bypass';

describe('bypassCookies', () => {
  it('stamps every configured cookie with the captured host', () => {
    const cookies = bypassCookies('https://dev-example.pantheonsite.io/landing?x=1');

    expect(cookies).toHaveLength(INTERSTITIAL_BYPASS_COOKIES.length);
    for (const cookie of cookies ?? []) {
      expect(cookie).toMatchObject({ domain: 'dev-example.pantheonsite.io', path: '/' });
    }
  });

  it('carries each configured name and value', () => {
    const cookies = bypassCookies('https://example.com');

    for (const { name, value } of INTERSTITIAL_BYPASS_COOKIES) {
      expect(cookies).toContainEqual(expect.objectContaining({ name, value }));
    }
  });

  it('scopes to the host alone, dropping port, path and query', () => {
    const cookies = bypassCookies('https://dev-example.pantheonsite.io:8443/a/b?q=1');

    // A cookie domain carrying a port is never sent by the browser.
    expect(cookies?.[0].domain).toBe('dev-example.pantheonsite.io');
  });

  it('lowercases the host and drops embedded credentials', () => {
    expect(bypassCookies('https://SUB.Example.COM/')?.[0].domain).toBe('sub.example.com');
    expect(bypassCookies('https://user:pw@example.com/x')?.[0].domain).toBe('example.com');
  });

  it('scopes each host independently', () => {
    expect(bypassCookies('https://one.example.com')?.[0].domain).toBe('one.example.com');
    expect(bypassCookies('https://two.example.com')?.[0].domain).toBe('two.example.com');
  });

  it('returns undefined when the URL cannot be parsed', () => {
    expect(bypassCookies('not-a-url')).toBeUndefined();
  });
});
