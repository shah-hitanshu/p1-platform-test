import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  getStoredTokens,
  storeTokens,
  clearTokens,
  getUserInfo,
  isTokenExpired,
  type AuthTokens,
} from '../../data/auth';

function makeTokens(overrides: Partial<AuthTokens> = {}): AuthTokens {
  const header = btoa(JSON.stringify({ alg: 'RS256' }));
  const payload = btoa(JSON.stringify({
    email: 'test@example.com',
    name: 'Test User',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = 'signature';
  const jwt = `${header}.${payload}.${sig}`;
  return {
    id_token: jwt,
    refresh_token: 'refresh-abc',
    access_token: jwt,
    scope: 'openid',
    token_type: 'Bearer',
    ...overrides,
  };
}

describe('auth token management', () => {
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
      removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
    });
    vi.stubGlobal('dispatchEvent', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getStoredTokens returns null when no tokens stored', () => {
    expect(getStoredTokens()).toBeNull();
  });

  it('storeTokens + getStoredTokens round-trips', () => {
    const tokens = makeTokens();
    storeTokens(tokens);
    const retrieved = getStoredTokens();
    expect(retrieved?.id_token).toBe(tokens.id_token);
  });

  it('clearTokens removes stored tokens', () => {
    const tokens = makeTokens();
    storeTokens(tokens);
    clearTokens();
    expect(getStoredTokens()).toBeNull();
  });

  it('getUserInfo extracts email and name from JWT', () => {
    const tokens = makeTokens();
    const info = getUserInfo(tokens);
    expect(info.email).toBe('test@example.com');
    expect(info.name).toBe('Test User');
  });

  it('getUserInfo returns empty for invalid JWT', () => {
    const tokens = makeTokens({ id_token: 'invalid' });
    const info = getUserInfo(tokens);
    expect(info).toEqual({});
  });

  it('isTokenExpired returns false for future exp', () => {
    const tokens = makeTokens();
    expect(isTokenExpired(tokens)).toBe(false);
  });

  it('isTokenExpired returns true for past exp', () => {
    const header = btoa(JSON.stringify({ alg: 'RS256' }));
    const payload = btoa(JSON.stringify({ exp: 1 }));
    const jwt = `${header}.${payload}.sig`;
    const tokens = makeTokens({ access_token: jwt });
    expect(isTokenExpired(tokens)).toBe(true);
  });
});
