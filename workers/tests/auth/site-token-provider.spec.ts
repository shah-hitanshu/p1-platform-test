/**
 * Site API Token Provider Tests (TDD)
 *
 * Tests for the SiteApiTokenProvider which authenticates
 * application-level API tokens (sat_ prefixed) against the database.
 * Tests should FAIL initially until implementation is complete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { AuthenticatedPrincipal } from '../../src/types';

// Mock the token service
vi.mock('../../src/services/site-api-token-service', () => ({
  validateToken: vi.fn(),
}));

describe('SiteApiTokenProvider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Interface compliance
  // ===========================================================================

  describe('interface', () => {
    it('should have name property set to "site_token"', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const provider = new SiteApiTokenProvider();

      expect(provider.name).toBe('site_token');
    });

    it('should implement canVerifyToken method', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const provider = new SiteApiTokenProvider();

      expect(typeof provider.canVerifyToken).toBe('function');
    });

    it('should implement validateToken method', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const provider = new SiteApiTokenProvider();

      expect(typeof provider.validateToken).toBe('function');
    });

    it('should implement validateAgentKey method', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const provider = new SiteApiTokenProvider();

      expect(typeof provider.validateAgentKey).toBe('function');
    });
  });

  // ===========================================================================
  // canVerifyToken
  // ===========================================================================

  describe('canVerifyToken', () => {
    it('should return true for tokens with sat_ prefix', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const provider = new SiteApiTokenProvider();

      expect(provider.canVerifyToken('sat_abc123def456')).toBe(true);
    });

    it('should return false for JWT tokens', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const provider = new SiteApiTokenProvider();

      // JWT-like token with dots
      expect(provider.canVerifyToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature')).toBe(false);
    });

    it('should return false for empty string', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const provider = new SiteApiTokenProvider();

      expect(provider.canVerifyToken('')).toBe(false);
    });

    it('should return false for tokens with other prefixes', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const provider = new SiteApiTokenProvider();

      expect(provider.canVerifyToken('sk_live_abc123')).toBe(false);
      expect(provider.canVerifyToken('ghp_abc123def456')).toBe(false);
    });

    it('should return false for bare sat_ with no value', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const provider = new SiteApiTokenProvider();

      expect(provider.canVerifyToken('sat_')).toBe(false);
    });
  });

  // ===========================================================================
  // validateToken
  // ===========================================================================

  describe('validateToken', () => {
    it('should return principal for valid token', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const tokenService = await import('../../src/services/site-api-token-service');
      const provider = new SiteApiTokenProvider();

      vi.mocked(tokenService.validateToken).mockResolvedValue({
        tokenId: 'token-uuid-123',
        siteId: 'site-uuid-456',
        scopes: ['read:published'],
      });

      const principal = await provider.validateToken('sat_validtoken123');

      expect(principal).not.toBeNull();
    });

    it('should return principal with type "service"', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const tokenService = await import('../../src/services/site-api-token-service');
      const provider = new SiteApiTokenProvider();

      vi.mocked(tokenService.validateToken).mockResolvedValue({
        tokenId: 'token-uuid-123',
        siteId: 'site-uuid-456',
        scopes: ['read:published'],
      });

      const principal = await provider.validateToken('sat_validtoken123');

      expect(principal?.type).toBe('service');
    });

    it('should set authProvider to "site_token"', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const tokenService = await import('../../src/services/site-api-token-service');
      const provider = new SiteApiTokenProvider();

      vi.mocked(tokenService.validateToken).mockResolvedValue({
        tokenId: 'token-uuid-123',
        siteId: 'site-uuid-456',
        scopes: ['read:published'],
      });

      const principal = await provider.validateToken('sat_validtoken123');

      expect(principal?.authProvider).toBe('site_token');
    });

    it('should include scopes on principal', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const tokenService = await import('../../src/services/site-api-token-service');
      const provider = new SiteApiTokenProvider();

      vi.mocked(tokenService.validateToken).mockResolvedValue({
        tokenId: 'token-uuid-123',
        siteId: 'site-uuid-456',
        scopes: ['read:published', 'read:draft'],
      });

      const principal = await provider.validateToken('sat_validtoken123');

      expect(principal?.scopes).toEqual(['read:published', 'read:draft']);
    });

    it('should include siteId on principal', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const tokenService = await import('../../src/services/site-api-token-service');
      const provider = new SiteApiTokenProvider();

      vi.mocked(tokenService.validateToken).mockResolvedValue({
        tokenId: 'token-uuid-123',
        siteId: 'site-uuid-456',
        scopes: ['read:published'],
      });

      const principal = await provider.validateToken('sat_validtoken123');

      expect(principal?.siteId).toBe('site-uuid-456');
    });

    it('should use tokenId as principal id', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const tokenService = await import('../../src/services/site-api-token-service');
      const provider = new SiteApiTokenProvider();

      vi.mocked(tokenService.validateToken).mockResolvedValue({
        tokenId: 'token-uuid-123',
        siteId: 'site-uuid-456',
        scopes: ['read:published'],
      });

      const principal = await provider.validateToken('sat_validtoken123');

      expect(principal?.id).toBe('token-uuid-123');
    });

    it('should return null for invalid token', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const tokenService = await import('../../src/services/site-api-token-service');
      const provider = new SiteApiTokenProvider();

      vi.mocked(tokenService.validateToken).mockResolvedValue(null);

      const principal = await provider.validateToken('sat_invalidtoken');

      expect(principal).toBeNull();
    });

    it('should return null for non-sat_ tokens', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const provider = new SiteApiTokenProvider();

      const principal = await provider.validateToken('not_a_sat_token');

      expect(principal).toBeNull();
    });

    it('should return null for empty token', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const provider = new SiteApiTokenProvider();

      const principal = await provider.validateToken('');

      expect(principal).toBeNull();
    });

    it('should set empty pantheonSiteRoles', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const tokenService = await import('../../src/services/site-api-token-service');
      const provider = new SiteApiTokenProvider();

      vi.mocked(tokenService.validateToken).mockResolvedValue({
        tokenId: 'token-uuid-123',
        siteId: 'site-uuid-456',
        scopes: ['read:published'],
      });

      const principal = await provider.validateToken('sat_validtoken123');

      expect(principal?.pantheonSiteRoles).toEqual({});
    });
  });

  // ===========================================================================
  // validateAgentKey
  // ===========================================================================

  describe('validateAgentKey', () => {
    it('should always return null (not applicable for site tokens)', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const provider = new SiteApiTokenProvider();

      const principal = await provider.validateAgentKey('any-key');

      expect(principal).toBeNull();
    });

    it('should return null for empty key', async () => {
      const { SiteApiTokenProvider } = await import('../../src/auth/site-token-provider');
      const provider = new SiteApiTokenProvider();

      const principal = await provider.validateAgentKey('');

      expect(principal).toBeNull();
    });
  });
});
