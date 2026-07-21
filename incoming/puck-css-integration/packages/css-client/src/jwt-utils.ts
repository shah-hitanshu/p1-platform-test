/**
 * JWT Utility Functions
 *
 * Shared helpers for parsing JWT payloads and checking expiry.
 * These decode JWTs for display/routing only — no cryptographic verification.
 */

import type { OAuthUserInfo } from './oauth.js';

export const TOKEN_REFRESH_BUFFER_SECONDS = 300;

export function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    const payload = parts[1];
    if (!payload) return null;
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getTokenExpiry(token: string): number | null {
  const payload = parseJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return null;
  return payload.exp;
}

export function isTokenExpiredOrExpiring(token: string): boolean {
  const exp = getTokenExpiry(token);
  if (exp === null) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return nowSeconds >= exp - TOKEN_REFRESH_BUFFER_SECONDS;
}

export function extractUserInfo(token: string): OAuthUserInfo | null {
  const payload = parseJwtPayload(token);
  if (!payload || typeof payload.sub !== 'string') return null;
  return {
    id: payload.sub,
    email: payload.email as string | undefined,
    name: payload.name as string | undefined,
    picture: payload.picture as string | undefined,
  };
}
