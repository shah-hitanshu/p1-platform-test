import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseJwtPayload,
  getTokenExpiry,
  isTokenExpiredOrExpiring,
  extractUserInfo,
  TOKEN_REFRESH_BUFFER_SECONDS,
} from '../src/jwt-utils.js';

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}

describe('parseJwtPayload', () => {
  it('decodes a valid JWT payload', () => {
    const token = makeJwt({ sub: 'user-1', role: 'admin' });
    expect(parseJwtPayload(token)).toEqual({ sub: 'user-1', role: 'admin' });
  });

  it('handles base64url characters (- and _)', () => {
    const payload = { data: 'a+b/c' };
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_');
    const token = `${header}.${body}.sig`;
    expect(parseJwtPayload(token)).toEqual(payload);
  });

  it('returns null for a token with no payload segment', () => {
    expect(parseJwtPayload('headeronly')).toBeNull();
  });

  it('returns null for invalid base64', () => {
    expect(parseJwtPayload('a.!!!.b')).toBeNull();
  });

  it('returns null for non-JSON payload', () => {
    const header = btoa('{}');
    const body = btoa('not json{');
    expect(parseJwtPayload(`${header}.${body}.sig`)).toBeNull();
  });
});

describe('getTokenExpiry', () => {
  it('returns exp from the payload', () => {
    const token = makeJwt({ exp: 1700000000 });
    expect(getTokenExpiry(token)).toBe(1700000000);
  });

  it('returns null when exp is missing', () => {
    const token = makeJwt({ sub: 'user-1' });
    expect(getTokenExpiry(token)).toBeNull();
  });

  it('returns null when exp is not a number', () => {
    const token = makeJwt({ exp: 'not-a-number' });
    expect(getTokenExpiry(token)).toBeNull();
  });

  it('returns null for an unparseable token', () => {
    expect(getTokenExpiry('garbage')).toBeNull();
  });
});

describe('isTokenExpiredOrExpiring', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when token is already expired', () => {
    const token = makeJwt({ exp: 1000000000 });
    expect(isTokenExpiredOrExpiring(token)).toBe(true);
  });

  it('returns true when token expires within the buffer window', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = makeJwt({ exp: nowSeconds + TOKEN_REFRESH_BUFFER_SECONDS - 10 });
    expect(isTokenExpiredOrExpiring(token)).toBe(true);
  });

  it('returns false when token has plenty of time left', () => {
    const token = makeJwt({ exp: 9999999999 });
    expect(isTokenExpiredOrExpiring(token)).toBe(false);
  });

  it('returns false when token has no exp claim', () => {
    const token = makeJwt({ sub: 'user-1' });
    expect(isTokenExpiredOrExpiring(token)).toBe(false);
  });
});

describe('extractUserInfo', () => {
  it('extracts all user fields from the JWT', () => {
    const token = makeJwt({
      sub: 'user-42',
      email: 'alice@example.com',
      name: 'Alice',
      picture: 'https://example.com/avatar.png',
    });
    expect(extractUserInfo(token)).toEqual({
      id: 'user-42',
      email: 'alice@example.com',
      name: 'Alice',
      picture: 'https://example.com/avatar.png',
    });
  });

  it('returns partial info when optional fields are missing', () => {
    const token = makeJwt({ sub: 'user-1' });
    expect(extractUserInfo(token)).toEqual({
      id: 'user-1',
      email: undefined,
      name: undefined,
      picture: undefined,
    });
  });

  it('returns null when sub is missing', () => {
    const token = makeJwt({ email: 'bob@example.com' });
    expect(extractUserInfo(token)).toBeNull();
  });

  it('returns null for an unparseable token', () => {
    expect(extractUserInfo('garbage')).toBeNull();
  });
});
