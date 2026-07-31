/**
 * Broker JWT Identity Provider
 *
 * Verifies HS256 JWTs signed by the auth broker using GCP Cloud KMS macVerify.
 * Tokens are signed by the broker with HMAC-SHA256 and verified here by calling
 * KMS's macVerify API, avoiding the need to fetch and cache public keys.
 *
 * The kid header (e.g., "broker-v3") identifies which KMS key version to use.
 * Claims are validated before calling macVerify to avoid unnecessary KMS calls
 * for obviously invalid tokens. Successfully verified tokens are cached for 5
 * minutes to reduce KMS API usage.
 */

import { base64url } from 'jose';

import type { AuthenticatedPrincipal, AuthProvider } from '../types';
import type { IdentityProvider } from './identity-provider';
import { macVerify } from './broker/gcp-kms-client.js';

export interface BrokerJwtIdentityProviderOptions {
  issuer: string;
  audience: string;
  serviceAccountKeyJson: string;
  keyResource: string;
}

interface BrokerJwtClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  jti?: string;
  site_id?: string;
  email?: string;
  name?: string;
  provider?: string;
}

interface JwtHeader {
  alg?: string;
  typ?: string;
  kid?: string;
}

interface CachedPrincipal {
  principal: AuthenticatedPrincipal;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 10_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class BrokerJwtIdentityProvider implements IdentityProvider {
  readonly name: AuthProvider = 'broker';

  private readonly issuer: string;
  private readonly audience: string;
  private readonly serviceAccountKeyJson: string;
  private readonly keyResource: string;
  private verifyCache = new Map<string, CachedPrincipal>();

  constructor(options: BrokerJwtIdentityProviderOptions) {
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.serviceAccountKeyJson = options.serviceAccountKeyJson;
    this.keyResource = options.keyResource;
  }

  canVerifyToken(token: string): boolean {
    if (token === '' || !token.includes('.')) {
      return false;
    }
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return false;
      }
      const payloadPart = parts[1];
      if (payloadPart === undefined || payloadPart === '') return false;
      const payloadJson = decoder.decode(base64url.decode(payloadPart));
      const payload = JSON.parse(payloadJson) as { iss?: string };
      return payload.iss === this.issuer;
    } catch {
      return false;
    }
  }

  async validateToken(token: string): Promise<AuthenticatedPrincipal | null> {
    try {
      // Parse JWT into parts
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }

      const headerPart = parts[0];
      const payloadPart = parts[1];
      const signaturePart = parts[2];
      if (headerPart === undefined || headerPart === '' || payloadPart === undefined || payloadPart === '' || signaturePart === undefined || signaturePart === '') {
        return null;
      }

      // Decode header to get kid and validate alg
      const headerJson = decoder.decode(base64url.decode(headerPart));
      const header = JSON.parse(headerJson) as JwtHeader;
      if (header.alg !== 'HS256') {
        return null;
      }
      const kid = header.kid;
      if (kid === undefined || kid === '') {
        return null;
      }

      // Decode payload to get claims
      const payloadJson = decoder.decode(base64url.decode(payloadPart));
      const claims = JSON.parse(payloadJson) as BrokerJwtClaims;

      // Validate claims BEFORE calling macVerify (saves a KMS call)
      if (claims.iss !== this.issuer) {
        return null;
      }
      if (claims.aud !== this.audience) {
        return null;
      }
      if (claims.sub === undefined || claims.sub === '') {
        return null;
      }
      if (claims.exp === undefined) {
        return null;
      }
      const now = Math.floor(Date.now() / 1000);
      if (claims.exp <= now) {
        return null;
      }

      // Check cache (keyed by SHA-256 hash of token, not raw token)
      const cacheKey = await this.hashToken(token);
      const cached = this.verifyCache.get(cacheKey);
      if (cached !== undefined && cached.expiresAt > Date.now()) {
        return cached.principal;
      }

      // Derive key version resource from kid
      // kid format: "broker-v{N}" -> extract N
      const kidMatch = /^broker-v(\d+)$/.exec(kid);
      if (kidMatch?.[1] === undefined) {
        return null;
      }
      const versionNumber = kidMatch[1];
      const keyVersionResource =
        `${this.keyResource}/cryptoKeyVersions/${versionNumber}`;

      // Reconstruct signing input
      const signingInput = `${headerPart}.${payloadPart}`;
      const signingInputBytes = encoder.encode(signingInput);

      // Decode signature
      const signatureBytes = base64url.decode(signaturePart);

      // Call macVerify
      const verified = await macVerify(
        this.serviceAccountKeyJson,
        keyVersionResource,
        signingInputBytes,
        signatureBytes,
      );

      if (!verified) {
        return null;
      }

      // Build principal
      const principal: AuthenticatedPrincipal = {
        id: claims.sub,
        type: 'user',
        email: claims.email,
        name: claims.name,
        authProvider: 'broker',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(claims.exp * 1000).toISOString(),
        siteId: claims.site_id,
      };

      // Cache the verified token (evict oldest entries if at capacity)
      if (this.verifyCache.size >= MAX_CACHE_SIZE) {
        this.pruneCache();
      }
      if (this.verifyCache.size >= MAX_CACHE_SIZE) {
        const oldest = this.verifyCache.keys().next().value;
        if (oldest !== undefined) {
          this.verifyCache.delete(oldest);
        }
      }
      this.verifyCache.set(cacheKey, {
        principal,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      return principal;
    } catch {
      return null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async validateAgentKey(_apiKey: string): Promise<AuthenticatedPrincipal | null> {
    return null;
  }

  private async hashToken(token: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  private pruneCache(): void {
    const now = Date.now();
    for (const [key, value] of this.verifyCache.entries()) {
      if (value.expiresAt <= now) {
        this.verifyCache.delete(key);
      }
    }
  }
}
