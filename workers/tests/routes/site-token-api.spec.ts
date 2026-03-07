/**
 * Site API Token Routes Tests (TDD)
 *
 * Tests for token management endpoints under /api/sites/:siteId/tokens.
 * Requires admin role on the site.
 * Tests should FAIL initially until implementation is complete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock services
vi.mock('../../src/services/site-api-token-service', () => ({
  generateToken: vi.fn(),
  listTokens: vi.fn(),
  revokeToken: vi.fn(),
}));

// Mock authorization
vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    override name = 'AuthorizationError';
    constructor(
      message: string,
      public requiredPermission: string,
      public roleName: string,
    ) {
      super(message);
    }
  },
}));

// Mock getMainBranch for permission checks
vi.mock('../../src/services', () => ({
  getMainBranch: vi.fn(),
}));

describe('Site API Token Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  const adminPrincipal = {
    id: 'user-uuid-admin',
    type: 'user' as const,
    email: 'admin@example.com',
    pantheonSiteRoles: { 'site-uuid-456': 'admin' as const },
    tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
    authProvider: 'google' as const,
  };

  // ===========================================================================
  // POST /api/sites/:siteId/tokens - Generate Token
  // ===========================================================================

  describe('POST /api/sites/:siteId/tokens', () => {
    it('should generate a new token and return it with metadata', async () => {
      const { handleSiteTokenRoutes } = await import('../../src/routes/site-token-api');
      const tokenService = await import('../../src/services/site-api-token-service');
      const services = await import('../../src/services');
      const auth = await import('../../src/auth/authorization');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'main-branch-id',
        siteId: 'site-uuid-456',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(auth.assertPermission).mockResolvedValue(undefined);
      vi.mocked(tokenService.generateToken).mockResolvedValue({
        token: 'sat_abc123def456ghi789',
        metadata: {
          id: 'token-uuid-123',
          siteId: 'site-uuid-456',
          prefix: 'sat_abc1',
          name: 'Production frontend',
          scopes: ['read:published'],
          createdBy: 'user-uuid-admin',
          createdAt: '2026-03-06T10:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
        },
      });

      const request = new Request('https://api.example.com/api/sites/site-uuid-456/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Production frontend', scopes: ['read:published'] }),
      });

      const response = await handleSiteTokenRoutes(request, {
        siteId: 'site-uuid-456',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(201);
      const body = await response.json() as { token: string; metadata: { id: string; name: string } };
      expect(body.token).toBe('sat_abc123def456ghi789');
      expect(body.metadata.id).toBe('token-uuid-123');
      expect(body.metadata.name).toBe('Production frontend');
    });

    it('should require admin permission (canManageGrants)', async () => {
      const { handleSiteTokenRoutes } = await import('../../src/routes/site-token-api');
      const services = await import('../../src/services');
      const auth = await import('../../src/auth/authorization');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'main-branch-id',
        siteId: 'site-uuid-456',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const { AuthorizationError } = auth;
      vi.mocked(auth.assertPermission).mockRejectedValue(
        new AuthorizationError('Missing permission', 'canManageGrants', 'VIEWER'),
      );

      const request = new Request('https://api.example.com/api/sites/site-uuid-456/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My token' }),
      });

      const response = await handleSiteTokenRoutes(request, {
        siteId: 'site-uuid-456',
        principal: { ...adminPrincipal, id: 'non-admin-user' },
      });

      expect(response.status).toBe(403);
    });

    it('should return 400 when name is missing', async () => {
      const { handleSiteTokenRoutes } = await import('../../src/routes/site-token-api');
      const services = await import('../../src/services');
      const auth = await import('../../src/auth/authorization');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'main-branch-id',
        siteId: 'site-uuid-456',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(auth.assertPermission).mockResolvedValue(undefined);

      const request = new Request('https://api.example.com/api/sites/site-uuid-456/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await handleSiteTokenRoutes(request, {
        siteId: 'site-uuid-456',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(400);
    });

    it('should reject service principals from creating tokens', async () => {
      const { handleSiteTokenRoutes } = await import('../../src/routes/site-token-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'main-branch-id',
        siteId: 'site-uuid-456',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request('https://api.example.com/api/sites/site-uuid-456/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'sneaky token' }),
      });

      const response = await handleSiteTokenRoutes(request, {
        siteId: 'site-uuid-456',
        principal: {
          id: 'token-uuid',
          type: 'service' as const,
          pantheonSiteRoles: {},
          tokenExpiry: new Date().toISOString(),
          authProvider: 'site_token' as const,
          siteId: 'site-uuid-456',
        },
      });

      expect(response.status).toBe(403);
    });
  });

  // ===========================================================================
  // GET /api/sites/:siteId/tokens - List Tokens
  // ===========================================================================

  describe('GET /api/sites/:siteId/tokens', () => {
    it('should list tokens for a site', async () => {
      const { handleSiteTokenRoutes } = await import('../../src/routes/site-token-api');
      const tokenService = await import('../../src/services/site-api-token-service');
      const services = await import('../../src/services');
      const auth = await import('../../src/auth/authorization');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'main-branch-id',
        siteId: 'site-uuid-456',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(auth.assertPermission).mockResolvedValue(undefined);
      vi.mocked(tokenService.listTokens).mockResolvedValue([
        {
          id: 'token-1',
          siteId: 'site-uuid-456',
          prefix: 'sat_abc1',
          name: 'Token A',
          scopes: ['read:published'],
          createdBy: 'user-uuid-admin',
          createdAt: '2026-03-06T10:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
        },
        {
          id: 'token-2',
          siteId: 'site-uuid-456',
          prefix: 'sat_def2',
          name: 'Token B',
          scopes: ['read:published'],
          createdBy: 'user-uuid-admin',
          createdAt: '2026-03-06T11:00:00.000Z',
          lastUsedAt: '2026-03-06T12:00:00.000Z',
          revokedAt: null,
        },
      ]);

      const request = new Request('https://api.example.com/api/sites/site-uuid-456/tokens', {
        method: 'GET',
      });

      const response = await handleSiteTokenRoutes(request, {
        siteId: 'site-uuid-456',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json() as { tokens: Array<{ id: string }> };
      expect(body.tokens).toHaveLength(2);
      expect(body.tokens[0].id).toBe('token-1');
    });

    it('should return empty array when no tokens exist', async () => {
      const { handleSiteTokenRoutes } = await import('../../src/routes/site-token-api');
      const tokenService = await import('../../src/services/site-api-token-service');
      const services = await import('../../src/services');
      const auth = await import('../../src/auth/authorization');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'main-branch-id',
        siteId: 'site-uuid-456',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(auth.assertPermission).mockResolvedValue(undefined);
      vi.mocked(tokenService.listTokens).mockResolvedValue([]);

      const request = new Request('https://api.example.com/api/sites/site-uuid-456/tokens', {
        method: 'GET',
      });

      const response = await handleSiteTokenRoutes(request, {
        siteId: 'site-uuid-456',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json() as { tokens: unknown[] };
      expect(body.tokens).toEqual([]);
    });
  });

  // ===========================================================================
  // DELETE /api/sites/:siteId/tokens/:tokenId - Revoke Token
  // ===========================================================================

  describe('DELETE /api/sites/:siteId/tokens/:tokenId', () => {
    it('should revoke a token', async () => {
      const { handleSiteTokenRoutes } = await import('../../src/routes/site-token-api');
      const tokenService = await import('../../src/services/site-api-token-service');
      const services = await import('../../src/services');
      const auth = await import('../../src/auth/authorization');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'main-branch-id',
        siteId: 'site-uuid-456',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(auth.assertPermission).mockResolvedValue(undefined);
      vi.mocked(tokenService.revokeToken).mockResolvedValue(true);

      const request = new Request('https://api.example.com/api/sites/site-uuid-456/tokens/token-uuid-123', {
        method: 'DELETE',
      });

      const response = await handleSiteTokenRoutes(request, {
        siteId: 'site-uuid-456',
        tokenId: 'token-uuid-123',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(204);
    });

    it('should return 404 when token not found', async () => {
      const { handleSiteTokenRoutes } = await import('../../src/routes/site-token-api');
      const tokenService = await import('../../src/services/site-api-token-service');
      const services = await import('../../src/services');
      const auth = await import('../../src/auth/authorization');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'main-branch-id',
        siteId: 'site-uuid-456',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(auth.assertPermission).mockResolvedValue(undefined);
      vi.mocked(tokenService.revokeToken).mockResolvedValue(false);

      const request = new Request('https://api.example.com/api/sites/site-uuid-456/tokens/non-existent', {
        method: 'DELETE',
      });

      const response = await handleSiteTokenRoutes(request, {
        siteId: 'site-uuid-456',
        tokenId: 'non-existent',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(404);
    });

    it('should require admin permission', async () => {
      const { handleSiteTokenRoutes } = await import('../../src/routes/site-token-api');
      const services = await import('../../src/services');
      const auth = await import('../../src/auth/authorization');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'main-branch-id',
        siteId: 'site-uuid-456',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const { AuthorizationError } = auth;
      vi.mocked(auth.assertPermission).mockRejectedValue(
        new AuthorizationError('Missing permission', 'canManageGrants', 'EDITOR'),
      );

      const request = new Request('https://api.example.com/api/sites/site-uuid-456/tokens/token-uuid-123', {
        method: 'DELETE',
      });

      const response = await handleSiteTokenRoutes(request, {
        siteId: 'site-uuid-456',
        tokenId: 'token-uuid-123',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(403);
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should return 404 when site has no main branch', async () => {
      const { handleSiteTokenRoutes } = await import('../../src/routes/site-token-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(null);

      const request = new Request('https://api.example.com/api/sites/site-uuid-456/tokens', {
        method: 'GET',
      });

      const response = await handleSiteTokenRoutes(request, {
        siteId: 'site-uuid-456',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(404);
    });

    it('should return 400 when siteId is missing', async () => {
      const { handleSiteTokenRoutes } = await import('../../src/routes/site-token-api');

      const request = new Request('https://api.example.com/api/sites//tokens', {
        method: 'GET',
      });

      const response = await handleSiteTokenRoutes(request, {
        principal: adminPrincipal,
      });

      expect(response.status).toBe(400);
    });

    it('should return 405 for unsupported methods', async () => {
      const { handleSiteTokenRoutes } = await import('../../src/routes/site-token-api');
      const services = await import('../../src/services');
      const auth = await import('../../src/auth/authorization');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'main-branch-id',
        siteId: 'site-uuid-456',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(auth.assertPermission).mockResolvedValue(undefined);

      const request = new Request('https://api.example.com/api/sites/site-uuid-456/tokens', {
        method: 'PATCH',
      });

      const response = await handleSiteTokenRoutes(request, {
        siteId: 'site-uuid-456',
        principal: adminPrincipal,
      });

      expect(response.status).toBe(405);
    });
  });
});
