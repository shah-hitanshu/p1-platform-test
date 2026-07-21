/**
 * JWT Utility Tests (TDD - Red Phase)
 *
 * Tests for decoding JWT payloads without verification.
 * Used by AuthContext to extract user info from provider tokens.
 */

import { describe, it, expect } from 'vitest';
import { decodeJwtPayload, isTokenExpired } from '../../utils/jwt';

/**
 * Helper: encode a JWT payload into a valid JWT-shaped string.
 * Header and signature are filler — we only decode the payload segment.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const sig = 'fake-signature';
  return `${header}.${body}.${sig}`;
}

describe('decodeJwtPayload', () => {
  it('should decode a valid JWT payload', () => {
    const payload = { sub: '12345', email: 'alice@example.com', name: 'Alice' };
    const token = makeJwt(payload);

    const result = decodeJwtPayload(token);

    expect(result).toEqual(payload);
  });

  it('should handle payloads with special characters', () => {
    const payload = { name: 'José García', email: 'josé@example.com' };
    const token = makeJwt(payload);

    const result = decodeJwtPayload(token);

    expect(result).toEqual(payload);
  });

  it('should handle numeric and boolean claims', () => {
    const payload = { iat: 1700000000, exp: 1700003600, email_verified: true };
    const token = makeJwt(payload);

    const result = decodeJwtPayload(token);

    expect(result.iat).toBe(1700000000);
    expect(result.exp).toBe(1700003600);
    expect(result.email_verified).toBe(true);
  });

  it('should handle nested objects in payload', () => {
    const payload = {
      sub: '123',
      'https://example.com/roles': ['admin', 'user'],
    };
    const token = makeJwt(payload);

    const result = decodeJwtPayload(token);

    expect(result['https://example.com/roles']).toEqual(['admin', 'user']);
  });

  it('should return null for an invalid token format (no dots)', () => {
    const result = decodeJwtPayload('not-a-jwt');

    expect(result).toBeNull();
  });

  it('should return null for a token with only one segment', () => {
    const result = decodeJwtPayload('header.only');

    // Two segments means no payload (needs header.payload.signature)
    expect(result).toBeNull();
  });

  it('should return null for a token with an invalid base64 payload', () => {
    const result = decodeJwtPayload('header.!!!invalid-base64!!!.sig');

    expect(result).toBeNull();
  });

  it('should return null for a token with non-JSON payload', () => {
    const header = btoa('{"alg":"RS256"}');
    const body = btoa('not-json');
    const result = decodeJwtPayload(`${header}.${body}.sig`);

    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = decodeJwtPayload('');

    expect(result).toBeNull();
  });

  it('should handle base64url encoding (+ and / replaced)', () => {
    // Create a payload that when base64-encoded would use + or /
    const payload = { data: '>>>???<<<' };
    const jsonStr = JSON.stringify(payload);
    // Standard base64 -> base64url conversion
    const b64url = btoa(jsonStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `eyJhbGciOiJSUzI1NiJ9.${b64url}.sig`;

    const result = decodeJwtPayload(token);

    expect(result).toEqual(payload);
  });
});

describe('isTokenExpired', () => {
  it('should return false for a token expiring in the future', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const token = makeJwt({ exp: futureExp });

    expect(isTokenExpired(token)).toBe(false);
  });

  it('should return true for a token that has already expired', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const token = makeJwt({ exp: pastExp });

    expect(isTokenExpired(token)).toBe(true);
  });

  it('should return true for a token with no exp claim', () => {
    const token = makeJwt({ sub: '123' });

    // No exp means we can't verify it's valid — treat as expired
    expect(isTokenExpired(token)).toBe(true);
  });

  it('should return true for an invalid token', () => {
    expect(isTokenExpired('invalid-token')).toBe(true);
  });

  it('should account for clock skew buffer', () => {
    // Token expires exactly now — with no buffer it could go either way
    // We test that a token expiring 30 seconds from now is NOT expired
    // (our implementation should have a small buffer)
    const almostExp = Math.floor(Date.now() / 1000) + 30;
    const token = makeJwt({ exp: almostExp });

    expect(isTokenExpired(token)).toBe(false);
  });
});
