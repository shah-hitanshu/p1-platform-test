import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configuredCredentials, isAuthorized } from './basic-auth';

const expected = { user: 'catalog', password: 'open:sesame' };
const encode = (raw: string) => `Basic ${Buffer.from(raw).toString('base64')}`;

describe('configuredCredentials', () => {
  it('returns null when either variable is missing, so the gate stays off', () => {
    expect(configuredCredentials({})).toBeNull();
    expect(configuredCredentials({ CATALOG_AUTH_USER: 'catalog' })).toBeNull();
    expect(configuredCredentials({ CATALOG_AUTH_PASSWORD: 'secret' })).toBeNull();
  });

  it('treats blank and whitespace-only values as unset', () => {
    expect(configuredCredentials({ CATALOG_AUTH_USER: '  ', CATALOG_AUTH_PASSWORD: 'secret' })).toBeNull();
  });

  it('returns both values when configured', () => {
    expect(configuredCredentials({ CATALOG_AUTH_USER: ' catalog ', CATALOG_AUTH_PASSWORD: ' secret ' })).toEqual({
      user: 'catalog',
      password: 'secret',
    });
  });
});

describe('isAuthorized', () => {
  it('accepts the configured pair', () => {
    expect(isAuthorized(encode('catalog:open:sesame'), expected)).toBe(true);
  });

  it('rejects a wrong password, a wrong user, and a swapped pair', () => {
    expect(isAuthorized(encode('catalog:wrong'), expected)).toBe(false);
    expect(isAuthorized(encode('someone:open:sesame'), expected)).toBe(false);
    expect(isAuthorized(encode('open:sesame:catalog'), expected)).toBe(false);
  });

  it('rejects a missing, non-Basic, malformed or colonless header', () => {
    expect(isAuthorized(null, expected)).toBe(false);
    expect(isAuthorized(`Bearer ${Buffer.from('catalog:open:sesame').toString('base64')}`, expected)).toBe(false);
    expect(isAuthorized('Basic !!!not base64!!!', expected)).toBe(false);
    expect(isAuthorized(encode('catalog'), expected)).toBe(false);
  });
});

describe('the proxy matcher', () => {
  // Read from source: the point is to catch someone widening the real matcher,
  // which would make every `shadcn add` demand credentials.
  const source = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf-8');
  const pattern = source.match(/matcher: \['([^']+)'\]/)?.[1];
  const matches = (path: string) => new RegExp(`^${pattern}$`).test(path);

  it('is still a single literal matcher in proxy.ts', () => {
    expect(pattern).toBeTruthy();
  });

  it('never gates the registry JSON that shadcn installs from', () => {
    expect(matches('/r/registry.json')).toBe(false);
    expect(matches('/r/base.json')).toBe(false);
    expect(matches('/r/pricing.json')).toBe(false);
  });

  it('gates the catalog pages', () => {
    expect(matches('/')).toBe(true);
    expect(matches('/theme')).toBe(true);
    expect(matches('/preview/hero')).toBe(true);
  });
});
