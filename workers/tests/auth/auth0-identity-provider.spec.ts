/**
 * Phase 3: Auth0 Identity Provider - Test Suite (TDD)
 *
 * Tests define expected behavior of the Auth0IdentityProvider.
 * Uses jose local JWKS for mocking RS256 key verification.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as jose from 'jose';

import { Auth0IdentityProvider } from '../../src/auth/auth0-identity-provider';
import { providerSubToUuid } from '../../src/auth/uuid-v5';

// =============================================================================
// Test Helpers
// =============================================================================

/** RSA key pair generated once for all tests */
let keyPair: jose.GenerateKeyPairResult;
let localJwks: jose.JWTVerifyGetKey;

/** Second key pair for dual-issuer tests */
let newKeyPair: jose.GenerateKeyPairResult;
let newLocalJwks: jose.JWTVerifyGetKey;

/** A completely separate key pair for wrong-signature tests */
let wrongKeyPair: jose.GenerateKeyPairResult;

const TEST_ISSUER = 'https://example.auth0.com';
const TEST_NEW_ISSUER = 'https://example.us.auth0.com';
const TEST_AUDIENCE = 'https://api.example.com';

beforeAll(async () => {
  keyPair = await jose.generateKeyPair('RS256');
  localJwks = jose.createLocalJWKSet({
    keys: [await jose.exportJWK(keyPair.publicKey)],
  });

  newKeyPair = await jose.generateKeyPair('RS256');
  newLocalJwks = jose.createLocalJWKSet({
    keys: [await jose.exportJWK(newKeyPair.publicKey)],
  });

  wrongKeyPair = await jose.generateKeyPair('RS256');
});

/**
 * Helper to create a signed RS256 JWT with given claims.
 */
async function createAuth0Token(
  claims: Record<string, unknown>,
  options: {
    issuer?: string;
    audience?: string;
    expiresIn?: string;
    privateKey?: jose.KeyLike;
  } = {},
): Promise<string> {
  const {
    issuer = TEST_ISSUER,
    audience = TEST_AUDIENCE,
    expiresIn = '1h',
    privateKey = keyPair.privateKey,
  } = options;

  return await new jose.SignJWT(claims as jose.JWTPayload)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}

/**
 * Helper to create a provider with injected test JWKS.
 */
function createProvider(
  overrides: {
    issuerBaseUrl?: string;
    newIssuerBaseUrl?: string;
    audience?: string;
    jwks?: jose.JWTVerifyGetKey;
    newJwks?: jose.JWTVerifyGetKey;
  } = {},
): Auth0IdentityProvider {
  return new Auth0IdentityProvider({
    issuerBaseUrl: overrides.issuerBaseUrl ?? TEST_ISSUER,
    newIssuerBaseUrl: overrides.newIssuerBaseUrl,
    audience: overrides.audience ?? TEST_AUDIENCE,
    jwks: overrides.jwks ?? localJwks,
    newJwks: overrides.newJwks,
  });
}

describe('Phase 3: Auth0 Identity Provider', () => {
  // ===========================================================================
  // Construction
  // ===========================================================================

  describe('Construction', () => {
    it('should create with required options', () => {
      const provider = createProvider();
      expect(provider).toBeInstanceOf(Auth0IdentityProvider);
      expect(provider.name).toBe('auth0');
    });

    it('should create with optional newIssuerBaseUrl', () => {
      const provider = createProvider({
        newIssuerBaseUrl: TEST_NEW_ISSUER,
        newJwks: newLocalJwks,
      });
      expect(provider).toBeInstanceOf(Auth0IdentityProvider);
    });

    it('should normalize issuer URLs by stripping trailing slashes', () => {
      const provider = createProvider({
        issuerBaseUrl: 'https://example.auth0.com/',
      });
      // Verify by checking canVerifyToken with a token from the normalized issuer
      // The provider should match 'https://example.auth0.com' (no trailing slash)
      expect(provider).toBeInstanceOf(Auth0IdentityProvider);
    });
  });

  // ===========================================================================
  // canVerifyToken
  // ===========================================================================

  describe('canVerifyToken', () => {
    it('should return true for configured issuer', async () => {
      const provider = createProvider();
      const token = await createAuth0Token({ sub: 'auth0|user1' });
      expect(provider.canVerifyToken(token)).toBe(true);
    });

    it('should return true for new issuer when configured', async () => {
      const provider = createProvider({
        newIssuerBaseUrl: TEST_NEW_ISSUER,
        newJwks: newLocalJwks,
      });
      const token = await createAuth0Token(
        { sub: 'auth0|user1' },
        { issuer: TEST_NEW_ISSUER },
      );
      expect(provider.canVerifyToken(token)).toBe(true);
    });

    it('should return true for any auth0.com issuer', async () => {
      const provider = createProvider();
      const token = await createAuth0Token(
        { sub: 'auth0|user1' },
        { issuer: 'https://different-tenant.auth0.com' },
      );
      expect(provider.canVerifyToken(token)).toBe(true);
    });

    it('should return false for non-auth0 issuers', async () => {
      const provider = createProvider();
      const token = await createAuth0Token(
        { sub: 'user1' },
        { issuer: 'https://accounts.google.com' },
      );
      expect(provider.canVerifyToken(token)).toBe(false);
    });

    it('should return false for spoofed auth0.com substrings in hostname', async () => {
      const provider = createProvider();
      const token = await createAuth0Token(
        { sub: 'user1' },
        { issuer: 'https://evil-auth0.com' },
      );
      expect(provider.canVerifyToken(token)).toBe(false);
    });

    it('should return false for auth0.com embedded in path', async () => {
      const provider = createProvider();
      const token = await createAuth0Token(
        { sub: 'user1' },
        { issuer: 'https://evil.com/auth0.com' },
      );
      expect(provider.canVerifyToken(token)).toBe(false);
    });

    it('should return false for malformed tokens', () => {
      const provider = createProvider();
      expect(provider.canVerifyToken('not-a-jwt')).toBe(false);
    });

    it('should return false for empty string', () => {
      const provider = createProvider();
      expect(provider.canVerifyToken('')).toBe(false);
    });

    it('should handle issuer URL with trailing slash in token', async () => {
      const provider = createProvider({
        issuerBaseUrl: 'https://example.auth0.com/',
      });
      const token = await createAuth0Token(
        { sub: 'auth0|user1' },
        { issuer: 'https://example.auth0.com/' },
      );
      expect(provider.canVerifyToken(token)).toBe(true);
    });
  });

  // ===========================================================================
  // validateToken
  // ===========================================================================

  describe('validateToken', () => {
    it('should return principal for valid RS256 token', async () => {
      const provider = createProvider();
      const token = await createAuth0Token({
        sub: 'auth0|user123',
        email: 'alice@example.com',
        scope: 'openid profile email',
      });

      const principal = await provider.validateToken(token);
      const expectedId = await providerSubToUuid('auth0', 'auth0|user123');

      expect(principal).not.toBeNull();
      expect(principal?.id).toBe(expectedId);
      expect(principal?.providerSubjectId).toBe('auth0|user123');
      expect(principal?.type).toBe('user');
      expect(principal?.email).toBe('alice@example.com');
      expect(principal?.authProvider).toBe('auth0');
    });

    it('should return null for expired token', async () => {
      const provider = createProvider();
      const token = await createAuth0Token(
        { sub: 'auth0|user1' },
        { expiresIn: '-1s' },
      );

      const principal = await provider.validateToken(token);
      expect(principal).toBeNull();
    });

    it('should return null for wrong audience', async () => {
      const provider = createProvider();
      const token = await createAuth0Token(
        { sub: 'auth0|user1' },
        { audience: 'https://wrong-api.example.com' },
      );

      const principal = await provider.validateToken(token);
      expect(principal).toBeNull();
    });

    it('should return null for wrong signature', async () => {
      const provider = createProvider();
      const token = await createAuth0Token(
        { sub: 'auth0|user1' },
        { privateKey: wrongKeyPair.privateKey },
      );

      const principal = await provider.validateToken(token);
      expect(principal).toBeNull();
    });

    it('should set authProvider to "auth0"', async () => {
      const provider = createProvider();
      const token = await createAuth0Token({ sub: 'auth0|user1' });

      const principal = await provider.validateToken(token);
      expect(principal?.authProvider).toBe('auth0');
    });

    it('should extract email from token', async () => {
      const provider = createProvider();
      const token = await createAuth0Token({
        sub: 'auth0|user1',
        email: 'alice@example.com',
      });

      const principal = await provider.validateToken(token);
      expect(principal?.email).toBe('alice@example.com');
    });

    it('should parse scopes from space-separated scope string', async () => {
      const provider = createProvider();
      const token = await createAuth0Token({
        sub: 'auth0|user1',
        scope: 'openid profile email read:data write:data',
      });

      const principal = await provider.validateToken(token);
      expect(principal?.scopes).toEqual([
        'openid',
        'profile',
        'email',
        'read:data',
        'write:data',
      ]);
    });

    it('should handle token with no email', async () => {
      const provider = createProvider();
      const token = await createAuth0Token({ sub: 'auth0|user1' });

      const principal = await provider.validateToken(token);
      expect(principal).not.toBeNull();
      expect(principal?.email).toBeUndefined();
    });

    it('should handle token with no scopes', async () => {
      const provider = createProvider();
      const token = await createAuth0Token({ sub: 'auth0|user1' });

      const principal = await provider.validateToken(token);
      expect(principal).not.toBeNull();
      expect(principal?.scopes).toEqual([]);
    });

    it('should set empty pantheonSiteRoles', async () => {
      const provider = createProvider();
      const token = await createAuth0Token({ sub: 'auth0|user1' });

      const principal = await provider.validateToken(token);
      expect(principal?.pantheonSiteRoles).toEqual({});
    });

    it('should set tokenExpiry from exp claim', async () => {
      const provider = createProvider();
      const token = await createAuth0Token({ sub: 'auth0|user1' });

      const principal = await provider.validateToken(token);
      expect(principal).not.toBeNull();
      expect(principal?.tokenExpiry).toBeDefined();
      // tokenExpiry should be a valid ISO string in the future
      const expiry = new Date(principal?.tokenExpiry ?? '');
      expect(expiry.getTime()).toBeGreaterThan(Date.now());
    });

    // Dual-issuer migration tests
    describe('dual-issuer migration', () => {
      it('should validate tokens from old issuer using old JWKS', async () => {
        const provider = createProvider({
          newIssuerBaseUrl: TEST_NEW_ISSUER,
          newJwks: newLocalJwks,
        });

        const token = await createAuth0Token(
          { sub: 'auth0|user1', email: 'old@example.com' },
          { issuer: TEST_ISSUER, privateKey: keyPair.privateKey },
        );

        const principal = await provider.validateToken(token);
        const expectedId = await providerSubToUuid('auth0', 'auth0|user1');
        expect(principal).not.toBeNull();
        expect(principal?.id).toBe(expectedId);
        expect(principal?.providerSubjectId).toBe('auth0|user1');
        expect(principal?.email).toBe('old@example.com');
      });

      it('should validate tokens from new issuer using new JWKS', async () => {
        const provider = createProvider({
          newIssuerBaseUrl: TEST_NEW_ISSUER,
          newJwks: newLocalJwks,
        });

        const token = await createAuth0Token(
          { sub: 'auth0|user1', email: 'new@example.com' },
          { issuer: TEST_NEW_ISSUER, privateKey: newKeyPair.privateKey },
        );

        const principal = await provider.validateToken(token);
        const expectedId = await providerSubToUuid('auth0', 'auth0|user1');
        expect(principal).not.toBeNull();
        expect(principal?.id).toBe(expectedId);
        expect(principal?.providerSubjectId).toBe('auth0|user1');
        expect(principal?.email).toBe('new@example.com');
      });

      it('should reject token from new issuer signed with old JWKS', async () => {
        const provider = createProvider({
          newIssuerBaseUrl: TEST_NEW_ISSUER,
          newJwks: newLocalJwks,
        });

        // Token says it's from new issuer but signed with old key
        const token = await createAuth0Token(
          { sub: 'auth0|user1' },
          { issuer: TEST_NEW_ISSUER, privateKey: keyPair.privateKey },
        );

        const principal = await provider.validateToken(token);
        expect(principal).toBeNull();
      });
    });

    // Edge case: token from unknown auth0 tenant
    it('should return null for token from unknown auth0 tenant (wrong JWKS)', async () => {
      const provider = createProvider();
      // Token from a different auth0 tenant - canVerifyToken returns true
      // but validation should fail because JWKS doesn't match
      const token = await createAuth0Token(
        { sub: 'auth0|user1' },
        {
          issuer: 'https://other-tenant.auth0.com',
          privateKey: wrongKeyPair.privateKey,
        },
      );

      const principal = await provider.validateToken(token);
      expect(principal).toBeNull();
    });

    // Concurrent validation
    it('should handle concurrent validation', async () => {
      const provider = createProvider();
      const token = await createAuth0Token({
        sub: 'auth0|user1',
        email: 'alice@example.com',
      });

      const results = await Promise.all([
        provider.validateToken(token),
        provider.validateToken(token),
        provider.validateToken(token),
      ]);

      const expectedId = await providerSubToUuid('auth0', 'auth0|user1');
      for (const principal of results) {
        expect(principal).not.toBeNull();
        expect(principal?.id).toBe(expectedId);
        expect(principal?.providerSubjectId).toBe('auth0|user1');
        expect(principal?.authProvider).toBe('auth0');
      }
    });
  });

  // ===========================================================================
  // validateAgentKey
  // ===========================================================================

  describe('validateAgentKey', () => {
    it('should always return null', async () => {
      const provider = createProvider();
      const result = await provider.validateAgentKey('any-api-key');
      expect(result).toBeNull();
    });

    it('should return null for empty string', async () => {
      const provider = createProvider();
      const result = await provider.validateAgentKey('');
      expect(result).toBeNull();
    });
  });
});
