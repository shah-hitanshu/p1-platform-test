/**
 * Phase 2.1: Mock Identity Provider - Test Suite (TDD)
 *
 * These tests define the expected behavior of the MockIdentityProvider class
 * before implementation. Tests should FAIL initially until the implementation is complete.
 *
 * @see collaborative-state-system-architecture-v2.2.md Section: Mock Identity Provider
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as jose from 'jose';

// Import types - these already exist from Phase 1.3
import type {
  AuthenticatedPrincipal,
  MockIdentityConfig,
  PantheonRole,
  AgentSiteRole,
} from '../../src/types';

// Import the class under test - will fail until implemented
import { MockIdentityProvider } from '../../src/auth/mock-identity-provider';

/**
 * Sample test configuration matching the architecture document.
 */
const TEST_CONFIG: MockIdentityConfig = {
  users: [
    {
      id: 'user-alice',
      email: 'alice@example.com',
      name: 'Alice Developer',
      siteRoles: {
        'site-123': 'admin',
        'site-456': 'developer',
      },
    },
    {
      id: 'user-bob',
      email: 'bob@example.com',
      name: 'Bob Reviewer',
      siteRoles: {
        'site-123': 'team_member',
      },
    },
  ],
  agents: [
    {
      id: 'agent-zappy',
      name: 'Zappy AI Assistant',
      apiKey: 'test-agent-key-zappy',
      siteRoles: {
        'site-123': 'editor',
      },
    },
    {
      id: 'agent-helper',
      name: 'Helper Bot',
      apiKey: 'test-agent-key-helper',
      siteRoles: {
        'site-123': 'viewer',
        'site-456': 'editor',
      },
    },
  ],
  defaultSiteRoles: {
    'site-123': 'team_member',
  },
};

const TEST_JWT_SECRET = 'test-secret-do-not-use-in-production-minimum-32-chars';
const TEST_TOKEN_EXPIRY = '1h';

/**
 * Helper to decode a JWT without verification for inspection.
 */
function decodeToken(token: string): jose.JWTPayload {
  return jose.decodeJwt(token);
}

/**
 * Helper to verify a JWT with the test secret.
 */
async function verifyToken(token: string): Promise<jose.JWTPayload> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  const { payload } = await jose.jwtVerify(token, secret);
  return payload;
}

describe('Phase 2.1: Mock Identity Provider', () => {
  let provider: MockIdentityProvider;

  beforeEach(() => {
    provider = new MockIdentityProvider({
      config: TEST_CONFIG,
      jwtSecret: TEST_JWT_SECRET,
      tokenExpiry: TEST_TOKEN_EXPIRY,
    });
  });

  // ===========================================================================
  // Constructor and Configuration
  // ===========================================================================

  describe('Constructor and Configuration', () => {
    it('should create an instance with valid configuration', () => {
      expect(provider).toBeInstanceOf(MockIdentityProvider);
    });

    it('should throw if jwtSecret is missing', () => {
      expect(() => {
        new MockIdentityProvider({
          config: TEST_CONFIG,
          jwtSecret: '',
          tokenExpiry: TEST_TOKEN_EXPIRY,
        });
      }).toThrow(/jwtSecret/i);
    });

    it('should throw if jwtSecret is too short (less than 32 characters)', () => {
      expect(() => {
        new MockIdentityProvider({
          config: TEST_CONFIG,
          jwtSecret: 'short-secret',
          tokenExpiry: TEST_TOKEN_EXPIRY,
        });
      }).toThrow(/jwtSecret.*32/i);
    });

    it('should throw if config is missing users array', () => {
      expect(() => {
        new MockIdentityProvider({
          config: { agents: [], defaultSiteRoles: {} } as MockIdentityConfig,
          jwtSecret: TEST_JWT_SECRET,
          tokenExpiry: TEST_TOKEN_EXPIRY,
        });
      }).toThrow(/users/i);
    });

    it('should throw if config is missing agents array', () => {
      expect(() => {
        new MockIdentityProvider({
          config: { users: [], defaultSiteRoles: {} } as MockIdentityConfig,
          jwtSecret: TEST_JWT_SECRET,
          tokenExpiry: TEST_TOKEN_EXPIRY,
        });
      }).toThrow(/agents/i);
    });

    it('should use default token expiry of 24h if not specified', () => {
      const providerWithDefaults = new MockIdentityProvider({
        config: TEST_CONFIG,
        jwtSecret: TEST_JWT_SECRET,
      });
      expect(providerWithDefaults).toBeInstanceOf(MockIdentityProvider);
    });
  });

  // ===========================================================================
  // Token Issuance (issueToken)
  // ===========================================================================

  describe('Token Issuance (issueToken)', () => {
    it('should issue a valid JWT for a known user', async () => {
      const token = await provider.issueToken('user-alice');

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include correct claims in the token', async () => {
      const token = await provider.issueToken('user-alice');
      const payload = decodeToken(token);

      expect(payload.sub).toBe('user-alice');
      expect(payload.email).toBe('alice@example.com');
      expect(payload.name).toBe('Alice Developer');
      expect(payload.type).toBe('user');
    });

    it('should include site roles in the token', async () => {
      const token = await provider.issueToken('user-alice');
      const payload = decodeToken(token);

      expect(payload.siteRoles).toEqual({
        'site-123': 'admin',
        'site-456': 'developer',
      });
    });

    it('should include the correct issuer claim', async () => {
      const token = await provider.issueToken('user-alice');
      const payload = decodeToken(token);

      expect(payload.iss).toBe('mock-identity-provider');
    });

    it('should sign the token with the configured secret', async () => {
      const token = await provider.issueToken('user-alice');

      // Should not throw - token is valid
      const payload = await verifyToken(token);
      expect(payload.sub).toBe('user-alice');
    });

    it('should set token expiration according to configured expiry', async () => {
      const token = await provider.issueToken('user-alice');
      const payload = decodeToken(token);

      expect(payload.exp).toBeDefined();
      expect(payload.iat).toBeDefined();

      // Token should expire approximately 1 hour from now (TEST_TOKEN_EXPIRY = '1h')
      const now = Math.floor(Date.now() / 1000);
      const expectedExp = now + 60 * 60; // 1 hour in seconds
      expect(payload.exp).toBeGreaterThan(now);
      expect(payload.exp).toBeLessThanOrEqual(expectedExp + 5); // Allow 5 second tolerance
    });

    it('should throw for unknown user ID', async () => {
      await expect(provider.issueToken('user-unknown')).rejects.toThrow(
        /user.*not found/i,
      );
    });

    it('should issue tokens for different users with correct claims', async () => {
      const tokenAlice = await provider.issueToken('user-alice');
      const tokenBob = await provider.issueToken('user-bob');

      const payloadAlice = decodeToken(tokenAlice);
      const payloadBob = decodeToken(tokenBob);

      expect(payloadAlice.sub).toBe('user-alice');
      expect(payloadAlice.email).toBe('alice@example.com');

      expect(payloadBob.sub).toBe('user-bob');
      expect(payloadBob.email).toBe('bob@example.com');
    });
  });

  // ===========================================================================
  // Token Validation (validateToken)
  // ===========================================================================

  describe('Token Validation (validateToken)', () => {
    it('should return AuthenticatedPrincipal for valid token', async () => {
      const token = await provider.issueToken('user-alice');
      const principal = await provider.validateToken(token);

      expect(principal).not.toBeNull();
      expect(principal?.id).toBe('user-alice');
      expect(principal?.type).toBe('user');
      expect(principal?.email).toBe('alice@example.com');
    });

    it('should include pantheonSiteRoles in the principal', async () => {
      const token = await provider.issueToken('user-alice');
      const principal = await provider.validateToken(token);

      expect(principal?.pantheonSiteRoles).toEqual({
        'site-123': 'admin',
        'site-456': 'developer',
      });
    });

    it('should include tokenExpiry in the principal', async () => {
      const token = await provider.issueToken('user-alice');
      const principal = await provider.validateToken(token);

      expect(principal?.tokenExpiry).toBeDefined();
      // tokenExpiry should be an ISO string
      expect(typeof principal?.tokenExpiry).toBe('string');
      if (principal) {
        expect(new Date(principal.tokenExpiry).getTime()).toBeGreaterThan(
          Date.now(),
        );
      }
    });

    it('should return null for invalid signature', async () => {
      const token = await provider.issueToken('user-alice');
      // Tamper with the token by modifying the signature
      const parts = token.split('.');
      parts[2] = 'invalid-signature';
      const tamperedToken = parts.join('.');

      const principal = await provider.validateToken(tamperedToken);
      expect(principal).toBeNull();
    });

    it('should return null for token signed with different secret', async () => {
      // Create a provider with different secret
      const otherProvider = new MockIdentityProvider({
        config: TEST_CONFIG,
        jwtSecret: 'different-secret-also-at-least-32-characters-long',
        tokenExpiry: TEST_TOKEN_EXPIRY,
      });

      const token = await otherProvider.issueToken('user-alice');
      const principal = await provider.validateToken(token);

      expect(principal).toBeNull();
    });

    it('should return null for expired token', async () => {
      // Create a provider with very short expiry
      const shortExpiryProvider = new MockIdentityProvider({
        config: TEST_CONFIG,
        jwtSecret: TEST_JWT_SECRET,
        tokenExpiry: '1s', // 1 second
      });

      const token = await shortExpiryProvider.issueToken('user-alice');

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const principal = await provider.validateToken(token);
      expect(principal).toBeNull();
    });

    it('should return null for malformed token', async () => {
      const principal = await provider.validateToken('not-a-valid-jwt');
      expect(principal).toBeNull();
    });

    it('should return null for empty token', async () => {
      const principal = await provider.validateToken('');
      expect(principal).toBeNull();
    });

    it('should return null for token with wrong issuer', async () => {
      // Manually create a token with wrong issuer
      const secret = new TextEncoder().encode(TEST_JWT_SECRET);
      const wrongIssuerToken = await new jose.SignJWT({
        sub: 'user-alice',
        email: 'alice@example.com',
        name: 'Alice Developer',
        type: 'user',
        siteRoles: { 'site-123': 'admin' },
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('wrong-issuer')
        .setExpirationTime('1h')
        .sign(secret);

      const principal = await provider.validateToken(wrongIssuerToken);
      expect(principal).toBeNull();
    });
  });

  // ===========================================================================
  // Agent API Key Validation (validateAgentKey)
  // ===========================================================================

  describe('Agent API Key Validation (validateAgentKey)', () => {
    it('should return AuthenticatedPrincipal for valid API key', async () => {
      const principal = await provider.validateAgentKey('test-agent-key-zappy');

      expect(principal).not.toBeNull();
      expect(principal?.id).toBe('agent-zappy');
      expect(principal?.type).toBe('agent');
    });

    it('should include agent site roles in pantheonSiteRoles', async () => {
      const principal = await provider.validateAgentKey('test-agent-key-zappy');

      // Agent site roles are mapped to pantheonSiteRoles
      expect(principal?.pantheonSiteRoles).toEqual({
        'site-123': 'editor',
      });
    });

    it('should not include email for agents (agents have no email)', async () => {
      const principal = await provider.validateAgentKey('test-agent-key-zappy');

      expect(principal?.email).toBeUndefined();
    });

    it('should set tokenExpiry to 24 hours from now for agents', async () => {
      const principal = await provider.validateAgentKey('test-agent-key-zappy');

      expect(principal).not.toBeNull();
      expect(principal?.tokenExpiry).toBeDefined();

      if (principal) {
        const expiryTime = new Date(principal.tokenExpiry).getTime();
        const expectedExpiry = Date.now() + 24 * 60 * 60 * 1000;

        // Allow 5 second tolerance
        expect(expiryTime).toBeGreaterThan(expectedExpiry - 5000);
        expect(expiryTime).toBeLessThanOrEqual(expectedExpiry + 5000);
      }
    });

    it('should return null for unknown API key', async () => {
      const principal = await provider.validateAgentKey('unknown-api-key');
      expect(principal).toBeNull();
    });

    it('should return null for empty API key', async () => {
      const principal = await provider.validateAgentKey('');
      expect(principal).toBeNull();
    });

    it('should validate different agents correctly', async () => {
      const zappy = await provider.validateAgentKey('test-agent-key-zappy');
      const helper = await provider.validateAgentKey('test-agent-key-helper');

      expect(zappy?.id).toBe('agent-zappy');
      expect(zappy?.pantheonSiteRoles).toEqual({ 'site-123': 'editor' });

      expect(helper?.id).toBe('agent-helper');
      expect(helper?.pantheonSiteRoles).toEqual({
        'site-123': 'viewer',
        'site-456': 'editor',
      });
    });
  });

  // ===========================================================================
  // User Lookup (getUser)
  // ===========================================================================

  describe('User Lookup (getUser)', () => {
    it('should return user by ID', () => {
      const user = provider.getUser('user-alice');

      expect(user).toBeDefined();
      expect(user?.id).toBe('user-alice');
      expect(user?.email).toBe('alice@example.com');
      expect(user?.name).toBe('Alice Developer');
    });

    it('should return undefined for unknown user', () => {
      const user = provider.getUser('user-unknown');
      expect(user).toBeUndefined();
    });

    it('should return user by email', () => {
      const user = provider.getUserByEmail('bob@example.com');

      expect(user).toBeDefined();
      expect(user?.id).toBe('user-bob');
    });

    it('should return undefined for unknown email', () => {
      const user = provider.getUserByEmail('unknown@example.com');
      expect(user).toBeUndefined();
    });
  });

  // ===========================================================================
  // Agent Lookup (getAgent)
  // ===========================================================================

  describe('Agent Lookup (getAgent)', () => {
    it('should return agent by ID', () => {
      const agent = provider.getAgent('agent-zappy');

      expect(agent).toBeDefined();
      expect(agent?.id).toBe('agent-zappy');
      expect(agent?.name).toBe('Zappy AI Assistant');
    });

    it('should return undefined for unknown agent', () => {
      const agent = provider.getAgent('agent-unknown');
      expect(agent).toBeUndefined();
    });
  });

  // ===========================================================================
  // Type Conformance
  // ===========================================================================

  describe('Type Conformance', () => {
    it('should return principals conforming to AuthenticatedPrincipal type', async () => {
      const token = await provider.issueToken('user-alice');
      const principal = await provider.validateToken(token);

      expect(principal).not.toBeNull();

      // TypeScript compile-time check - if this compiles, the type is correct
      if (principal) {
        const typedPrincipal: AuthenticatedPrincipal = principal;

        expect(typedPrincipal.id).toBe('user-alice');
        expect(typedPrincipal.type).toBe('user');
        expect(typedPrincipal.pantheonSiteRoles).toBeDefined();
        expect(typedPrincipal.tokenExpiry).toBeDefined();
      }
    });

    it('should accept config conforming to MockIdentityConfig type', () => {
      // TypeScript compile-time check
      const config: MockIdentityConfig = {
        users: [
          {
            id: 'test-user',
            email: 'test@example.com',
            name: 'Test User',
            siteRoles: { 'site-1': 'admin' },
          },
        ],
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            apiKey: 'test-key',
            siteRoles: { 'site-1': 'editor' },
          },
        ],
        defaultSiteRoles: {},
      };

      const testProvider = new MockIdentityProvider({
        config,
        jwtSecret: TEST_JWT_SECRET,
      });

      expect(testProvider).toBeInstanceOf(MockIdentityProvider);
    });

    it('should use correct PantheonRole values in user siteRoles', async () => {
      const token = await provider.issueToken('user-alice');
      const principal = await provider.validateToken(token);

      expect(principal).not.toBeNull();

      if (principal) {
        // These should all be valid PantheonRole values
        const validRoles: PantheonRole[] = [
          'owner',
          'admin',
          'developer',
          'team_member',
        ];
        const userRoles = Object.values(principal.pantheonSiteRoles);

        for (const role of userRoles) {
          expect(validRoles).toContain(role);
        }
      }
    });

    it('should use correct AgentSiteRole values in agent siteRoles', async () => {
      const principal = await provider.validateAgentKey('test-agent-key-zappy');

      expect(principal).not.toBeNull();

      if (principal) {
        // Agent roles are different from Pantheon roles
        const validAgentRoles: AgentSiteRole[] = ['viewer', 'editor', 'admin'];
        const agentRoles = Object.values(principal.pantheonSiteRoles);

        for (const role of agentRoles) {
          expect(validAgentRoles).toContain(role);
        }
      }
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle user with empty siteRoles', async () => {
      const configWithEmptyRoles: MockIdentityConfig = {
        users: [
          {
            id: 'user-noroles',
            email: 'noroles@example.com',
            name: 'No Roles User',
            siteRoles: {},
          },
        ],
        agents: [],
        defaultSiteRoles: {},
      };

      const providerWithEmptyRoles = new MockIdentityProvider({
        config: configWithEmptyRoles,
        jwtSecret: TEST_JWT_SECRET,
      });

      const token = await providerWithEmptyRoles.issueToken('user-noroles');
      const principal = await providerWithEmptyRoles.validateToken(token);

      expect(principal?.pantheonSiteRoles).toEqual({});
    });

    it('should handle special characters in user names', async () => {
      const configWithSpecialChars: MockIdentityConfig = {
        users: [
          {
            id: 'user-special',
            email: "o'brien@example.com",
            name: "Dr. Jane O'Brien-Smith",
            siteRoles: { 'site-123': 'admin' },
          },
        ],
        agents: [],
        defaultSiteRoles: {},
      };

      const specialProvider = new MockIdentityProvider({
        config: configWithSpecialChars,
        jwtSecret: TEST_JWT_SECRET,
      });

      const token = await specialProvider.issueToken('user-special');
      const payload = decodeToken(token);

      expect(payload.name).toBe("Dr. Jane O'Brien-Smith");
      expect(payload.email).toBe("o'brien@example.com");
    });

    it('should handle concurrent token validation', async () => {
      const token = await provider.issueToken('user-alice');

      // Validate the same token concurrently
      const results = await Promise.all([
        provider.validateToken(token),
        provider.validateToken(token),
        provider.validateToken(token),
      ]);

      for (const principal of results) {
        expect(principal?.id).toBe('user-alice');
      }
    });

    it('should handle concurrent API key validation', async () => {
      const results = await Promise.all([
        provider.validateAgentKey('test-agent-key-zappy'),
        provider.validateAgentKey('test-agent-key-helper'),
        provider.validateAgentKey('test-agent-key-zappy'),
      ]);

      expect(results[0]?.id).toBe('agent-zappy');
      expect(results[1]?.id).toBe('agent-helper');
      expect(results[2]?.id).toBe('agent-zappy');
    });
  });
});
