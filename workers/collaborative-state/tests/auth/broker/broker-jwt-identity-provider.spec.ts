/**
 * Broker JWT Identity Provider Tests (HS256 / KMS macVerify)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { base64url } from 'jose';

vi.mock('../../../src/auth/broker/gcp-kms-client.js', () => ({
  macVerify: vi.fn(),
  deriveKid(versionResource: string): string {
    const parts = versionResource.split('/');
    return `broker-v${parts[parts.length - 1] ?? '0'}`;
  },
}));

const KEY_RESOURCE = 'projects/p/locations/l/keyRings/r/cryptoKeys/k';
const ISSUER = 'https://css.example.com';
const AUDIENCE = 'css-api';

const encoder = new TextEncoder();

function buildJwt(
  headerOverrides: Record<string, unknown> = {},
  claimsOverrides: Record<string, unknown> = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'HS256',
    typ: 'JWT',
    kid: 'broker-v1',
    ...headerOverrides,
  };
  const payload = {
    iss: ISSUER,
    sub: 'user-uuid-123',
    aud: AUDIENCE,
    iat: now,
    exp: now + 3600,
    jti: 'test-jti',
    site_id: 'site-123',
    email: 'user@example.com',
    name: 'Test User',
    provider: 'auth0',
    ...claimsOverrides,
  };
  const headerB64 = base64url.encode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64url.encode(encoder.encode(JSON.stringify(payload)));
  const fakeSignature = base64url.encode(new Uint8Array([1, 2, 3, 4]));
  return `${headerB64}.${payloadB64}.${fakeSignature}`;
}

describe('BrokerJwtIdentityProvider', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('canVerifyToken', () => {
    it('returns true for JWTs with matching issuer', async () => {
      const { BrokerJwtIdentityProvider } = await import('../../../src/auth/broker-jwt-identity-provider.js');

      const provider = new BrokerJwtIdentityProvider({
        issuer: ISSUER,
        audience: AUDIENCE,
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
      });

      const token = buildJwt();
      expect(provider.canVerifyToken(token)).toBe(true);
    });

    it('returns false for JWTs with different issuer', async () => {
      const { BrokerJwtIdentityProvider } = await import('../../../src/auth/broker-jwt-identity-provider.js');

      const provider = new BrokerJwtIdentityProvider({
        issuer: ISSUER,
        audience: AUDIENCE,
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
      });

      const token = buildJwt({}, { iss: 'https://other.example.com' });
      expect(provider.canVerifyToken(token)).toBe(false);
    });

    it('returns false for non-JWT strings', async () => {
      const { BrokerJwtIdentityProvider } = await import('../../../src/auth/broker-jwt-identity-provider.js');

      const provider = new BrokerJwtIdentityProvider({
        issuer: ISSUER,
        audience: AUDIENCE,
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
      });

      expect(provider.canVerifyToken('')).toBe(false);
      expect(provider.canVerifyToken('not-a-jwt')).toBe(false);
      expect(provider.canVerifyToken('sat_abc123')).toBe(false);
    });
  });

  describe('validateToken', () => {
    it('returns an AuthenticatedPrincipal for a valid broker JWT', async () => {
      const { macVerify } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { BrokerJwtIdentityProvider } = await import('../../../src/auth/broker-jwt-identity-provider.js');

      vi.mocked(macVerify).mockResolvedValue(true);

      const provider = new BrokerJwtIdentityProvider({
        issuer: ISSUER,
        audience: AUDIENCE,
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
      });

      const token = buildJwt();
      const principal = await provider.validateToken(token);

      expect(principal).not.toBeNull();
      expect(principal?.id).toBe('user-uuid-123');
      expect(principal?.type).toBe('user');
      expect(principal?.email).toBe('user@example.com');
      expect(principal?.name).toBe('Test User');
      expect(principal?.authProvider).toBe('broker');
      expect(principal?.siteId).toBe('site-123');
    });

    it('calls macVerify with correct key version derived from kid', async () => {
      const { macVerify } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { BrokerJwtIdentityProvider } = await import('../../../src/auth/broker-jwt-identity-provider.js');

      vi.mocked(macVerify).mockResolvedValue(true);

      const provider = new BrokerJwtIdentityProvider({
        issuer: ISSUER,
        audience: AUDIENCE,
        serviceAccountKeyJson: '{"sa": true}',
        keyResource: KEY_RESOURCE,
      });

      const token = buildJwt({ kid: 'broker-v3' });
      await provider.validateToken(token);

      expect(macVerify).toHaveBeenCalledTimes(1);
      const [saKey, keyVersion] = vi.mocked(macVerify).mock.calls[0];
      expect(saKey).toBe('{"sa": true}');
      expect(keyVersion).toBe(`${KEY_RESOURCE}/cryptoKeyVersions/3`);
    });

    it('returns null when macVerify returns false', async () => {
      const { macVerify } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { BrokerJwtIdentityProvider } = await import('../../../src/auth/broker-jwt-identity-provider.js');

      vi.mocked(macVerify).mockResolvedValue(false);

      const provider = new BrokerJwtIdentityProvider({
        issuer: ISSUER,
        audience: AUDIENCE,
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
      });

      const token = buildJwt();
      const principal = await provider.validateToken(token);
      expect(principal).toBeNull();
    });

    it('returns null for an expired JWT without calling macVerify', async () => {
      const { macVerify } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { BrokerJwtIdentityProvider } = await import('../../../src/auth/broker-jwt-identity-provider.js');

      const provider = new BrokerJwtIdentityProvider({
        issuer: ISSUER,
        audience: AUDIENCE,
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
      });

      const now = Math.floor(Date.now() / 1000);
      const token = buildJwt({}, { iat: now - 7200, exp: now - 3600 });
      const principal = await provider.validateToken(token);

      expect(principal).toBeNull();
      expect(macVerify).not.toHaveBeenCalled();
    });

    it('returns null for JWT with wrong audience without calling macVerify', async () => {
      const { macVerify } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { BrokerJwtIdentityProvider } = await import('../../../src/auth/broker-jwt-identity-provider.js');

      const provider = new BrokerJwtIdentityProvider({
        issuer: ISSUER,
        audience: AUDIENCE,
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
      });

      const token = buildJwt({}, { aud: 'wrong-audience' });
      const principal = await provider.validateToken(token);

      expect(principal).toBeNull();
      expect(macVerify).not.toHaveBeenCalled();
    });

    it('returns null for JWT with wrong issuer without calling macVerify', async () => {
      const { macVerify } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { BrokerJwtIdentityProvider } = await import('../../../src/auth/broker-jwt-identity-provider.js');

      const provider = new BrokerJwtIdentityProvider({
        issuer: ISSUER,
        audience: AUDIENCE,
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
      });

      const token = buildJwt({}, { iss: 'https://evil.example.com' });
      const principal = await provider.validateToken(token);

      expect(principal).toBeNull();
      expect(macVerify).not.toHaveBeenCalled();
    });

    it('returns null for JWT with missing sub claim', async () => {
      const { macVerify } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { BrokerJwtIdentityProvider } = await import('../../../src/auth/broker-jwt-identity-provider.js');

      vi.mocked(macVerify).mockResolvedValue(true);

      const provider = new BrokerJwtIdentityProvider({
        issuer: ISSUER,
        audience: AUDIENCE,
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
      });

      const token = buildJwt({}, { sub: undefined });
      const principal = await provider.validateToken(token);
      expect(principal).toBeNull();
    });

    it('caches verified tokens to avoid redundant macVerify calls', async () => {
      const { macVerify } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { BrokerJwtIdentityProvider } = await import('../../../src/auth/broker-jwt-identity-provider.js');

      vi.mocked(macVerify).mockResolvedValue(true);

      const provider = new BrokerJwtIdentityProvider({
        issuer: ISSUER,
        audience: AUDIENCE,
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
      });

      const token = buildJwt();
      await provider.validateToken(token);
      await provider.validateToken(token);

      expect(macVerify).toHaveBeenCalledTimes(1);
    });

    it('does not support agent API keys', async () => {
      const { BrokerJwtIdentityProvider } = await import('../../../src/auth/broker-jwt-identity-provider.js');

      const provider = new BrokerJwtIdentityProvider({
        issuer: ISSUER,
        audience: AUDIENCE,
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
      });

      const result = await provider.validateAgentKey('some-key');
      expect(result).toBeNull();
    });
  });
});
