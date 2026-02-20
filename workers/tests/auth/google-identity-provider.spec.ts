/**
 * Phase 2: Google Identity Provider - Test Suite (TDD)
 *
 * Tests define expected behavior of the GoogleIdentityProvider class
 * implementing the IdentityProvider interface for Google OAuth tokens.
 * Tests should FAIL initially until implementation is complete.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as jose from 'jose';

// Import types
import type { AuthenticatedPrincipal } from '../../src/types';

// Import the class under test - will fail until implemented
import { GoogleIdentityProvider } from '../../src/auth/google-identity-provider';

// Import IdentityProvider interface for structural checks
import type { IdentityProvider } from '../../src/auth/identity-provider';

// Import UUIDv5 for computing expected IDs
import { providerSubToUuid } from '../../src/auth/uuid-v5';

/**
 * Test constants
 */
const TEST_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';

/**
 * Shared test key pair and JWKS for all tests.
 * Generated once before all tests run.
 */
let testKeyPair: jose.GenerateKeyPairResult;
let testJwks: jose.JWTVerifyGetKey;
let wrongKeyPair: jose.GenerateKeyPairResult;

/**
 * Generate an RS256 key pair and local JWKS before all tests.
 */
beforeAll(async () => {
  testKeyPair = await jose.generateKeyPair('RS256');
  wrongKeyPair = await jose.generateKeyPair('RS256');

  // Create a local JWKS from the public key
  const publicJwk = await jose.exportJWK(testKeyPair.publicKey);
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  publicJwk.kid = 'test-key-1';
  testJwks = jose.createLocalJWKSet({ keys: [publicJwk] });
});

/**
 * Helper to create a Google-signed JWT with given claims.
 */
async function createGoogleToken(
  claims: Record<string, unknown> = {},
  options: {
    issuer?: string;
    audience?: string;
    expiresIn?: string;
    key?: jose.KeyLike;
    kid?: string;
  } = {},
): Promise<string> {
  const {
    issuer = 'https://accounts.google.com',
    audience = TEST_CLIENT_ID,
    expiresIn = '1h',
    key = testKeyPair.privateKey,
    kid = 'test-key-1',
  } = options;

  return await new jose.SignJWT({
    sub: 'google-user-123',
    email: 'user@gmail.com',
    email_verified: true,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

describe('Phase 2: Google Identity Provider', () => {
  // ===========================================================================
  // Construction
  // ===========================================================================

  describe('Construction', () => {
    it('should create with valid clientId', () => {
      const provider = new GoogleIdentityProvider({
        clientId: TEST_CLIENT_ID,
        jwks: testJwks,
      });
      expect(provider).toBeInstanceOf(GoogleIdentityProvider);
    });

    it('should implement IdentityProvider interface', () => {
      const provider: IdentityProvider = new GoogleIdentityProvider({
        clientId: TEST_CLIENT_ID,
        jwks: testJwks,
      });
      expect(provider.name).toBe('google');
      expect(typeof provider.canVerifyToken).toBe('function');
      expect(typeof provider.validateToken).toBe('function');
      expect(typeof provider.validateAgentKey).toBe('function');
    });

    it('should have name property set to "google"', () => {
      const provider = new GoogleIdentityProvider({
        clientId: TEST_CLIENT_ID,
        jwks: testJwks,
      });
      expect(provider.name).toBe('google');
    });
  });

  // ===========================================================================
  // canVerifyToken
  // ===========================================================================

  describe('canVerifyToken', () => {
    let provider: GoogleIdentityProvider;

    beforeEach(() => {
      provider = new GoogleIdentityProvider({
        clientId: TEST_CLIENT_ID,
        jwks: testJwks,
      });
    });

    it('should return true for tokens with iss https://accounts.google.com', async () => {
      const token = await createGoogleToken({}, { issuer: 'https://accounts.google.com' });
      expect(provider.canVerifyToken(token)).toBe(true);
    });

    it('should return true for tokens with iss accounts.google.com', async () => {
      const token = await createGoogleToken({}, { issuer: 'accounts.google.com' });
      expect(provider.canVerifyToken(token)).toBe(true);
    });

    it('should return false for tokens with other issuers', async () => {
      const token = await createGoogleToken({}, { issuer: 'https://example.auth0.com/' });
      expect(provider.canVerifyToken(token)).toBe(false);
    });

    it('should return false for tokens with mock issuer', async () => {
      const token = await createGoogleToken({}, { issuer: 'mock-identity-provider' });
      expect(provider.canVerifyToken(token)).toBe(false);
    });

    it('should return false for malformed tokens', () => {
      expect(provider.canVerifyToken('not-a-jwt')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(provider.canVerifyToken('')).toBe(false);
    });
  });

  // ===========================================================================
  // validateToken
  // ===========================================================================

  describe('validateToken', () => {
    let provider: GoogleIdentityProvider;

    beforeEach(() => {
      provider = new GoogleIdentityProvider({
        clientId: TEST_CLIENT_ID,
        jwks: testJwks,
      });
    });

    it('should return principal for valid RS256 token', async () => {
      const token = await createGoogleToken({
        sub: 'google-user-456',
        email: 'alice@gmail.com',
        email_verified: true,
      });

      const principal = await provider.validateToken(token);
      const expectedId = await providerSubToUuid('google', 'google-user-456');

      expect(principal).not.toBeNull();
      expect(principal?.id).toBe(expectedId);
      expect(principal?.providerSubjectId).toBe('google-user-456');
      expect(principal?.type).toBe('user');
      expect(principal?.email).toBe('alice@gmail.com');
    });

    it('should set authProvider to "google"', async () => {
      const token = await createGoogleToken();
      const principal = await provider.validateToken(token);

      expect(principal?.authProvider).toBe('google');
    });

    it('should extract email from token payload', async () => {
      const token = await createGoogleToken({ email: 'test@example.com' });
      const principal = await provider.validateToken(token);

      expect(principal?.email).toBe('test@example.com');
    });

    it('should extract name from token payload', async () => {
      const token = await createGoogleToken({
        name: 'Alice Smith',
      });
      const principal = await provider.validateToken(token);

      expect(principal?.name).toBe('Alice Smith');
    });

    it('should extract picture as avatarUrl from token payload', async () => {
      const token = await createGoogleToken({
        picture: 'https://lh3.googleusercontent.com/a/photo.jpg',
      });
      const principal = await provider.validateToken(token);

      expect(principal?.avatarUrl).toBe('https://lh3.googleusercontent.com/a/photo.jpg');
    });

    it('should handle token without name claim', async () => {
      const token = await createGoogleToken({
        sub: 'user-no-name',
        name: undefined,
      });
      const principal = await provider.validateToken(token);

      expect(principal).not.toBeNull();
      expect(principal?.name).toBeUndefined();
    });

    it('should handle token without picture claim', async () => {
      const token = await createGoogleToken({
        sub: 'user-no-picture',
        picture: undefined,
      });
      const principal = await provider.validateToken(token);

      expect(principal).not.toBeNull();
      expect(principal?.avatarUrl).toBeUndefined();
    });

    it('should set empty pantheonSiteRoles', async () => {
      const token = await createGoogleToken();
      const principal = await provider.validateToken(token);

      expect(principal?.pantheonSiteRoles).toEqual({});
    });

    it('should include tokenExpiry from exp claim', async () => {
      const token = await createGoogleToken();
      const principal = await provider.validateToken(token);

      expect(principal).not.toBeNull();
      expect(principal?.tokenExpiry).toBeDefined();
      expect(typeof principal?.tokenExpiry).toBe('string');
      if (principal) {
        const expiryTime = new Date(principal.tokenExpiry).getTime();
        expect(expiryTime).toBeGreaterThan(Date.now());
      }
    });

    it('should handle both Google issuer formats', async () => {
      const token1 = await createGoogleToken(
        { sub: 'user-1' },
        { issuer: 'https://accounts.google.com' },
      );
      const token2 = await createGoogleToken(
        { sub: 'user-2' },
        { issuer: 'accounts.google.com' },
      );

      const principal1 = await provider.validateToken(token1);
      const principal2 = await provider.validateToken(token2);

      const expectedId1 = await providerSubToUuid('google', 'user-1');
      const expectedId2 = await providerSubToUuid('google', 'user-2');

      expect(principal1?.id).toBe(expectedId1);
      expect(principal1?.providerSubjectId).toBe('user-1');
      expect(principal2?.id).toBe(expectedId2);
      expect(principal2?.providerSubjectId).toBe('user-2');
    });

    it('should return null for expired token', async () => {
      // Create a token that expires immediately
      const token = await createGoogleToken({}, { expiresIn: '-1s' });

      const principal = await provider.validateToken(token);
      expect(principal).toBeNull();
    });

    it('should return null for wrong audience', async () => {
      const token = await createGoogleToken(
        {},
        { audience: 'wrong-client-id.apps.googleusercontent.com' },
      );

      const principal = await provider.validateToken(token);
      expect(principal).toBeNull();
    });

    it('should return null for wrong signature (different key)', async () => {
      const token = await createGoogleToken({}, { key: wrongKeyPair.privateKey });

      const principal = await provider.validateToken(token);
      expect(principal).toBeNull();
    });

    it('should return null for tampered token', async () => {
      const token = await createGoogleToken();
      const parts = token.split('.');
      parts[2] = 'invalid-signature';
      const tamperedToken = parts.join('.');

      const principal = await provider.validateToken(tamperedToken);
      expect(principal).toBeNull();
    });

    it('should return null for malformed token', async () => {
      const principal = await provider.validateToken('not-a-valid-jwt');
      expect(principal).toBeNull();
    });

    it('should return null for empty string', async () => {
      const principal = await provider.validateToken('');
      expect(principal).toBeNull();
    });

    it('should return null for token with wrong issuer', async () => {
      const token = await createGoogleToken(
        {},
        { issuer: 'https://example.auth0.com/' },
      );

      const principal = await provider.validateToken(token);
      expect(principal).toBeNull();
    });
  });

  // ===========================================================================
  // validateToken - Edge cases
  // ===========================================================================

  describe('validateToken edge cases', () => {
    let provider: GoogleIdentityProvider;

    beforeEach(() => {
      provider = new GoogleIdentityProvider({
        clientId: TEST_CLIENT_ID,
        jwks: testJwks,
      });
    });

    it('should handle token without email_verified', async () => {
      const token = await createGoogleToken({
        sub: 'user-no-verified',
        email: 'unverified@gmail.com',
        email_verified: undefined,
      });

      const principal = await provider.validateToken(token);
      const expectedId = await providerSubToUuid('google', 'user-no-verified');

      // Should still return a principal - email_verified is informational
      expect(principal).not.toBeNull();
      expect(principal?.id).toBe(expectedId);
      expect(principal?.providerSubjectId).toBe('user-no-verified');
      expect(principal?.email).toBe('unverified@gmail.com');
    });

    it('should handle token without email claim', async () => {
      const token = await createGoogleToken({
        sub: 'user-no-email',
        email: undefined,
      });

      const principal = await provider.validateToken(token);
      const expectedId = await providerSubToUuid('google', 'user-no-email');

      expect(principal).not.toBeNull();
      expect(principal?.id).toBe(expectedId);
      expect(principal?.providerSubjectId).toBe('user-no-email');
      expect(principal?.email).toBeUndefined();
    });

    it('should handle concurrent token validations', async () => {
      const token1 = await createGoogleToken({ sub: 'user-a', email: 'a@gmail.com' });
      const token2 = await createGoogleToken({ sub: 'user-b', email: 'b@gmail.com' });
      const token3 = await createGoogleToken({ sub: 'user-c', email: 'c@gmail.com' });

      const results = await Promise.all([
        provider.validateToken(token1),
        provider.validateToken(token2),
        provider.validateToken(token3),
      ]);

      const expectedA = await providerSubToUuid('google', 'user-a');
      const expectedB = await providerSubToUuid('google', 'user-b');
      const expectedC = await providerSubToUuid('google', 'user-c');

      expect(results[0]?.id).toBe(expectedA);
      expect(results[1]?.id).toBe(expectedB);
      expect(results[2]?.id).toBe(expectedC);
    });
  });

  // ===========================================================================
  // validateAgentKey
  // ===========================================================================

  describe('validateAgentKey', () => {
    let provider: GoogleIdentityProvider;

    beforeEach(() => {
      provider = new GoogleIdentityProvider({
        clientId: TEST_CLIENT_ID,
        jwks: testJwks,
      });
    });

    it('should always return null (Google does not use API keys)', async () => {
      const principal = await provider.validateAgentKey('any-api-key');
      expect(principal).toBeNull();
    });

    it('should return null for empty string', async () => {
      const principal = await provider.validateAgentKey('');
      expect(principal).toBeNull();
    });
  });

  // ===========================================================================
  // Type Conformance
  // ===========================================================================

  describe('Type Conformance', () => {
    it('should return principals conforming to AuthenticatedPrincipal type', async () => {
      const provider = new GoogleIdentityProvider({
        clientId: TEST_CLIENT_ID,
        jwks: testJwks,
      });

      const token = await createGoogleToken();
      const principal = await provider.validateToken(token);

      expect(principal).not.toBeNull();

      if (principal) {
        const typedPrincipal: AuthenticatedPrincipal = principal;
        expect(typedPrincipal.id).toBeDefined();
        expect(typedPrincipal.type).toBe('user');
        expect(typedPrincipal.pantheonSiteRoles).toBeDefined();
        expect(typedPrincipal.tokenExpiry).toBeDefined();
        expect(typedPrincipal.authProvider).toBe('google');
      }
    });
  });
});
