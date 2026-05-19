/**
 * Phase 1: Multi-Provider Auth Abstraction Layer - Test Suite (TDD)
 *
 * Tests define expected behavior of the IdentityProvider interface,
 * MultiProviderIdentityProvider routing, and MockIdentityProviderAdapter.
 * Tests should FAIL initially until implementation is complete.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as jose from 'jose';

// Import types
import type { AuthenticatedPrincipal, MockIdentityConfig, AuthProvider } from '../../src/types';

// Import the classes under test - will fail until implemented
import {
  MultiProviderIdentityProvider,
  MockIdentityProviderAdapter,
} from '../../src/auth/identity-provider';
// IdentityProvider interface is verified structurally through the adapter tests

// Import existing MockIdentityProvider for adapter tests
import { MockIdentityProvider } from '../../src/auth/mock-identity-provider';

/**
 * Sample test configuration matching existing test patterns.
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
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'Zappy AI Assistant',
      apiKey: 'test-agent-key-zappy',
      siteRoles: {
        'site-123': 'editor',
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
 * Helper to create a configured MockIdentityProvider.
 */
function createMockProvider(): MockIdentityProvider {
  return new MockIdentityProvider({
    config: TEST_CONFIG,
    jwtSecret: TEST_JWT_SECRET,
    tokenExpiry: TEST_TOKEN_EXPIRY,
  });
}

/**
 * Helper to create a configured MockIdentityProviderAdapter.
 */
function createMockAdapter(): MockIdentityProviderAdapter {
  return new MockIdentityProviderAdapter(createMockProvider());
}

/**
 * Helper to create a JWT with a specific issuer for routing tests.
 */
async function createTokenWithIssuer(
  issuer: string,
  claims: Record<string, unknown> = {},
): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  return await new jose.SignJWT({
    sub: 'test-user',
    type: 'user',
    email: 'test@example.com',
    siteRoles: {},
    ...claims,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

describe('Phase 1: Multi-Provider Auth Abstraction Layer', () => {
  // ===========================================================================
  // AuthProvider type
  // ===========================================================================

  describe('AuthProvider type', () => {
    it('should accept valid AuthProvider values', () => {
      const providers: AuthProvider[] = ['auth0', 'google', 'mock', 'unknown'];
      expect(providers).toHaveLength(4);
    });

    it('should allow authProvider on AuthenticatedPrincipal', () => {
      const principal: AuthenticatedPrincipal = {
        id: 'test-user',
        type: 'user',
        email: 'test@example.com',
        pantheonSiteRoles: {},
        tokenExpiry: new Date().toISOString(),
        authProvider: 'mock',
      };
      expect(principal.authProvider).toBe('mock');
    });

    it('should allow AuthenticatedPrincipal without authProvider (backward compatible)', () => {
      const principal: AuthenticatedPrincipal = {
        id: 'test-user',
        type: 'user',
        pantheonSiteRoles: {},
        tokenExpiry: new Date().toISOString(),
      };
      expect(principal.authProvider).toBeUndefined();
    });
  });

  // ===========================================================================
  // MockIdentityProviderAdapter
  // ===========================================================================

  describe('MockIdentityProviderAdapter', () => {
    let adapter: MockIdentityProviderAdapter;

    beforeEach(() => {
      adapter = createMockAdapter();
    });

    it('should implement IdentityProvider interface', () => {
      // Verify all required properties/methods exist
      expect(adapter.name).toBe('mock');
      expect(typeof adapter.canVerifyToken).toBe('function');
      expect(typeof adapter.validateToken).toBe('function');
      expect(typeof adapter.validateAgentKey).toBe('function');
    });

    it('should have name property set to "mock"', () => {
      expect(adapter.name).toBe('mock');
    });

    describe('canVerifyToken', () => {
      it('should return true for mock-issued tokens', async () => {
        const mockProvider = createMockProvider();
        const token = await mockProvider.issueToken('user-alice');
        expect(adapter.canVerifyToken(token)).toBe(true);
      });

      it('should return false for tokens with different issuer', async () => {
        const token = await createTokenWithIssuer('https://accounts.google.com');
        expect(adapter.canVerifyToken(token)).toBe(false);
      });

      it('should return false for tokens with auth0 issuer', async () => {
        const token = await createTokenWithIssuer('https://example.auth0.com/');
        expect(adapter.canVerifyToken(token)).toBe(false);
      });

      it('should return false for malformed tokens', () => {
        expect(adapter.canVerifyToken('not-a-jwt')).toBe(false);
      });

      it('should return false for empty string', () => {
        expect(adapter.canVerifyToken('')).toBe(false);
      });
    });

    describe('validateToken', () => {
      it('should delegate to MockIdentityProvider and return principal', async () => {
        const mockProvider = createMockProvider();
        const token = await mockProvider.issueToken('user-alice');

        const principal = await adapter.validateToken(token);

        expect(principal).not.toBeNull();
        expect(principal?.id).toBe('user-alice');
        expect(principal?.type).toBe('user');
        expect(principal?.email).toBe('alice@example.com');
      });

      it('should set authProvider to "mock" on returned principal', async () => {
        const mockProvider = createMockProvider();
        const token = await mockProvider.issueToken('user-alice');

        const principal = await adapter.validateToken(token);

        expect(principal?.authProvider).toBe('mock');
      });

      it('should return null for invalid tokens', async () => {
        const principal = await adapter.validateToken('invalid-token');
        expect(principal).toBeNull();
      });

      it('should return null for tokens from other issuers', async () => {
        const token = await createTokenWithIssuer('https://accounts.google.com');
        const principal = await adapter.validateToken(token);
        // The underlying MockIdentityProvider will reject tokens with wrong issuer
        expect(principal).toBeNull();
      });
    });

    describe('validateAgentKey', () => {
      it('should delegate to MockIdentityProvider for valid keys', async () => {
        const principal = await adapter.validateAgentKey('test-agent-key-zappy');

        expect(principal).not.toBeNull();
        expect(principal?.id).toBe('a0000000-0000-0000-0000-000000000001');
        expect(principal?.type).toBe('agent');
      });

      it('should set authProvider to "mock" on returned principal', async () => {
        const principal = await adapter.validateAgentKey('test-agent-key-zappy');
        expect(principal?.authProvider).toBe('mock');
      });

      it('should return null for invalid API keys', async () => {
        const principal = await adapter.validateAgentKey('unknown-key');
        expect(principal).toBeNull();
      });

      it('should return null for empty API key', async () => {
        const principal = await adapter.validateAgentKey('');
        expect(principal).toBeNull();
      });
    });
  });

  // ===========================================================================
  // MultiProviderIdentityProvider - Construction
  // ===========================================================================

  describe('MultiProviderIdentityProvider construction', () => {
    it('should create with empty provider list', () => {
      const multi = new MultiProviderIdentityProvider([]);
      expect(multi).toBeInstanceOf(MultiProviderIdentityProvider);
    });

    it('should create with one provider', () => {
      const adapter = createMockAdapter();
      const multi = new MultiProviderIdentityProvider([adapter]);
      expect(multi).toBeInstanceOf(MultiProviderIdentityProvider);
    });

    it('should create with multiple providers', () => {
      const adapter1 = createMockAdapter();
      const adapter2 = createMockAdapter();
      const multi = new MultiProviderIdentityProvider([adapter1, adapter2]);
      expect(multi).toBeInstanceOf(MultiProviderIdentityProvider);
    });
  });

  // ===========================================================================
  // MultiProviderIdentityProvider - Token Routing
  // ===========================================================================

  describe('MultiProviderIdentityProvider token routing', () => {
    let multi: MultiProviderIdentityProvider;
    let mockProvider: MockIdentityProvider;

    beforeEach(() => {
      mockProvider = createMockProvider();
      const adapter = new MockIdentityProviderAdapter(mockProvider);
      multi = new MultiProviderIdentityProvider([adapter]);
    });

    it('should route mock tokens to MockIdentityProviderAdapter', async () => {
      const token = await mockProvider.issueToken('user-alice');
      const principal = await multi.validateToken(token);

      expect(principal).not.toBeNull();
      expect(principal?.id).toBe('user-alice');
      expect(principal?.type).toBe('user');
      expect(principal?.authProvider).toBe('mock');
    });

    it('should return null when no provider can verify token', async () => {
      const token = await createTokenWithIssuer('https://unknown-provider.com');
      const principal = await multi.validateToken(token);

      expect(principal).toBeNull();
    });

    it('should return null for malformed tokens (non-JWT)', async () => {
      const principal = await multi.validateToken('not-a-jwt');
      expect(principal).toBeNull();
    });

    it('should return null for empty token string', async () => {
      const principal = await multi.validateToken('');
      expect(principal).toBeNull();
    });

    it('should route by iss claim correctly', async () => {
      const mockToken = await mockProvider.issueToken('user-alice');
      const mockPayload = jose.decodeJwt(mockToken);
      expect(mockPayload.iss).toBe('mock-identity-provider');

      const principal = await multi.validateToken(mockToken);
      expect(principal?.authProvider).toBe('mock');
    });

    it('should set authProvider on returned principal', async () => {
      const token = await mockProvider.issueToken('user-alice');
      const principal = await multi.validateToken(token);

      expect(principal).not.toBeNull();
      expect(principal?.authProvider).toBe('mock');
    });
  });

  // ===========================================================================
  // MultiProviderIdentityProvider - API Key Routing
  // ===========================================================================

  describe('MultiProviderIdentityProvider API key routing', () => {
    let multi: MultiProviderIdentityProvider;

    beforeEach(() => {
      const adapter = createMockAdapter();
      multi = new MultiProviderIdentityProvider([adapter]);
    });

    it('should route agent keys through providers in order', async () => {
      const principal = await multi.validateAgentKey('test-agent-key-zappy');

      expect(principal).not.toBeNull();
      expect(principal?.id).toBe('a0000000-0000-0000-0000-000000000001');
      expect(principal?.type).toBe('agent');
      expect(principal?.authProvider).toBe('mock');
    });

    it('should return null when no provider validates the key', async () => {
      const principal = await multi.validateAgentKey('unknown-api-key');
      expect(principal).toBeNull();
    });

    it('should return null for empty API key', async () => {
      const principal = await multi.validateAgentKey('');
      expect(principal).toBeNull();
    });
  });

  // ===========================================================================
  // MultiProviderIdentityProvider - No providers registered
  // ===========================================================================

  describe('MultiProviderIdentityProvider with no providers', () => {
    let multi: MultiProviderIdentityProvider;

    beforeEach(() => {
      multi = new MultiProviderIdentityProvider([]);
    });

    it('should return null for any token', async () => {
      const mockProvider = createMockProvider();
      const token = await mockProvider.issueToken('user-alice');
      const principal = await multi.validateToken(token);
      expect(principal).toBeNull();
    });

    it('should return null for any API key', async () => {
      const principal = await multi.validateAgentKey('any-key');
      expect(principal).toBeNull();
    });
  });

  // ===========================================================================
  // MultiProviderIdentityProvider - Multiple providers, correct selection
  // ===========================================================================

  describe('MultiProviderIdentityProvider with multiple providers', () => {
    it('should select the correct provider among multiple', async () => {
      // Create two mock adapters with different configs
      const config1: MockIdentityConfig = {
        users: [
          {
            id: 'user-from-provider1',
            email: 'p1@example.com',
            name: 'Provider 1 User',
            siteRoles: { 'site-1': 'admin' },
          },
        ],
        agents: [],
        defaultSiteRoles: {},
      };

      const config2: MockIdentityConfig = {
        users: [
          {
            id: 'user-from-provider2',
            email: 'p2@example.com',
            name: 'Provider 2 User',
            siteRoles: { 'site-2': 'admin' },
          },
        ],
        agents: [],
        defaultSiteRoles: {},
      };

      const provider1 = new MockIdentityProvider({
        config: config1,
        jwtSecret: TEST_JWT_SECRET,
        tokenExpiry: TEST_TOKEN_EXPIRY,
      });

      const provider2 = new MockIdentityProvider({
        config: config2,
        jwtSecret: TEST_JWT_SECRET,
        tokenExpiry: TEST_TOKEN_EXPIRY,
      });

      // Both adapters will have canVerifyToken return true for mock tokens
      // The first one should be tried first
      const adapter1 = new MockIdentityProviderAdapter(provider1);
      const adapter2 = new MockIdentityProviderAdapter(provider2);

      const multi = new MultiProviderIdentityProvider([adapter1, adapter2]);

      // Issue token from provider1 - both adapters canVerifyToken, but provider1 should validate it
      const token = await provider1.issueToken('user-from-provider1');
      const principal = await multi.validateToken(token);

      expect(principal).not.toBeNull();
      expect(principal?.id).toBe('user-from-provider1');
      expect(principal?.authProvider).toBe('mock');
    });

    it('should fall through to second provider if first returns null', async () => {
      const config1: MockIdentityConfig = {
        users: [],
        agents: [
          {
            id: 'agent-1',
            name: 'Agent 1',
            apiKey: 'key-for-agent-1',
            siteRoles: { 'site-1': 'editor' },
          },
        ],
        defaultSiteRoles: {},
      };

      const config2: MockIdentityConfig = {
        users: [],
        agents: [
          {
            id: 'agent-2',
            name: 'Agent 2',
            apiKey: 'key-for-agent-2',
            siteRoles: { 'site-2': 'editor' },
          },
        ],
        defaultSiteRoles: {},
      };

      const adapter1 = new MockIdentityProviderAdapter(
        new MockIdentityProvider({
          config: config1,
          jwtSecret: TEST_JWT_SECRET,
        }),
      );
      const adapter2 = new MockIdentityProviderAdapter(
        new MockIdentityProvider({
          config: config2,
          jwtSecret: TEST_JWT_SECRET,
        }),
      );

      const multi = new MultiProviderIdentityProvider([adapter1, adapter2]);

      // key-for-agent-2 is only in config2, so adapter1 should return null, adapter2 should match
      const principal = await multi.validateAgentKey('key-for-agent-2');

      expect(principal).not.toBeNull();
      expect(principal?.id).toBe('agent-2');
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge cases', () => {
    it('should handle token with unknown issuer gracefully', async () => {
      const adapter = createMockAdapter();
      const multi = new MultiProviderIdentityProvider([adapter]);

      const token = await createTokenWithIssuer('https://some-random-issuer.com');
      const principal = await multi.validateToken(token);

      expect(principal).toBeNull();
    });

    it('should handle base64-encoded but non-JWT string', async () => {
      const adapter = createMockAdapter();
      const multi = new MultiProviderIdentityProvider([adapter]);

      // A string with dots but not a valid JWT
      const fakeToken = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.';
      const principal = await multi.validateToken(fakeToken);

      expect(principal).toBeNull();
    });

    it('should handle concurrent token validations', async () => {
      const adapter = createMockAdapter();
      const multi = new MultiProviderIdentityProvider([adapter]);
      const mockProvider = createMockProvider();
      const token = await mockProvider.issueToken('user-alice');

      const results = await Promise.all([
        multi.validateToken(token),
        multi.validateToken(token),
        multi.validateToken(token),
      ]);

      for (const principal of results) {
        expect(principal?.id).toBe('user-alice');
        expect(principal?.authProvider).toBe('mock');
      }
    });

    it('should handle concurrent API key validations', async () => {
      const adapter = createMockAdapter();
      const multi = new MultiProviderIdentityProvider([adapter]);

      const results = await Promise.all([
        multi.validateAgentKey('test-agent-key-zappy'),
        multi.validateAgentKey('unknown-key'),
        multi.validateAgentKey('test-agent-key-zappy'),
      ]);

      expect(results[0]?.id).toBe('a0000000-0000-0000-0000-000000000001');
      expect(results[1]).toBeNull();
      expect(results[2]?.id).toBe('a0000000-0000-0000-0000-000000000001');
    });
  });
});

