/**
 * Shared GCP Authentication
 *
 * Provides cached access tokens and identity tokens for GCP API calls.
 * Uses jose for JWT construction instead of hand-rolled base64url encoding.
 * Replaces duplicated auth code in gcp-kms-client.ts and mas-client.ts.
 */

import { SignJWT, importPKCS8 } from 'jose';

const TOKEN_ENDPOINT = 'https://www.googleapis.com/oauth2/v4/token';
const CACHE_BUFFER_MS = 120_000;

interface GCPServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export function _resetGcpAuthCache(): void {
  tokenCache.clear();
}

async function exchangeJwtForToken(
  saKey: GCPServiceAccountKey,
  claims: Record<string, unknown>,
  responseField: 'access_token' | 'id_token',
): Promise<string> {
  const scopeOrAudience = (claims.scope ?? claims.target_audience ?? '') as string;
  const cacheKey = `${saKey.client_email}:${scopeOrAudience}`;

  const cached = tokenCache.get(cacheKey);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const privateKey = await importPKCS8(saKey.private_key, 'RS256');

  const jwt = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(saKey.client_email)
    .setSubject(saKey.client_email)
    .setAudience(TOKEN_ENDPOINT)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    throw new Error(`GCP token exchange failed (HTTP ${String(response.status)})`);
  }

  const data: Record<string, unknown> = await response.json();
  const token = data[responseField];
  if (typeof token !== 'string' || token === '') {
    throw new Error(`GCP token exchange: missing ${responseField} in response`);
  }

  tokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + 3600_000 - CACHE_BUFFER_MS,
  });

  return token;
}

export async function getGcpAccessToken(
  serviceAccountKeyJson: string,
  scope: string,
): Promise<string> {
  const saKey = JSON.parse(serviceAccountKeyJson) as GCPServiceAccountKey;
  return exchangeJwtForToken(saKey, { scope }, 'access_token');
}

export async function getGcpIdentityToken(
  serviceAccountKeyJson: string,
  targetAudience: string,
): Promise<string> {
  const saKey = JSON.parse(serviceAccountKeyJson) as GCPServiceAccountKey;
  return exchangeJwtForToken(saKey, { target_audience: targetAudience }, 'id_token');
}
