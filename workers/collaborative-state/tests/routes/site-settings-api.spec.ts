import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';

vi.mock('../../src/services/site-settings-service', () => ({
  getSiteSettings: vi.fn(),
  updateSiteSettings: vi.fn(),
  InvalidSettingsError: class InvalidSettingsError extends Error {
    public readonly name = 'InvalidSettingsError';
    constructor(message: string) {
      super(message);
      Object.setPrototypeOf(this, InvalidSettingsError.prototype);
    }
  },
}));

vi.mock('../../src/services', () => ({
  getMainBranch: vi.fn(),
}));

vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {},
}));

const mockPrincipal: AuthenticatedPrincipal = {
  id: 'user-alice',
  type: 'user',
  email: 'alice@example.com',
  authProvider: 'mock',
  pantheonSiteRoles: { 'site-123': 'admin' },
  tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
};

const mockServicePrincipal: AuthenticatedPrincipal = {
  id: 'service-bot',
  type: 'service',
  authProvider: 'mock',
  pantheonSiteRoles: { 'site-123': 'admin' },
  tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
  scopes: ['read:published'],
  tokenSiteId: 'site-123',
};

describe('Site Settings API Routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('GET /api/sites/{siteId}/settings', () => {
    it('should return settings with effective values', async () => {
      const { handleSiteSettingsRoutes } = await import('../../src/routes/site-settings-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'branch-main',
        siteId: 'site-123',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      vi.mocked(settingsService.getSiteSettings).mockResolvedValue({
        cacheTtlMain: 120,
        cacheTtlBranch: 5,
      });

      const request = new Request('https://api.example.com/api/sites/site-123/settings', {
        method: 'GET',
      });

      const response = await handleSiteSettingsRoutes(request, {
        siteId: 'site-123',
        principal: mockPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.settings).toEqual({
        cacheTtlMain: 120,
        cacheTtlBranch: 5,
      });
    });

    it('should return 404 when site not found', async () => {
      const { handleSiteSettingsRoutes } = await import('../../src/routes/site-settings-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(null);

      const request = new Request('https://api.example.com/api/sites/nonexistent/settings', {
        method: 'GET',
      });

      const response = await handleSiteSettingsRoutes(request, {
        siteId: 'nonexistent',
        principal: mockPrincipal,
      });

      expect(response.status).toBe(404);
    });

    it('should return 403 for service principals', async () => {
      const { handleSiteSettingsRoutes } = await import('../../src/routes/site-settings-api');

      const request = new Request('https://api.example.com/api/sites/site-123/settings', {
        method: 'GET',
      });

      const response = await handleSiteSettingsRoutes(request, {
        siteId: 'site-123',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(403);
    });

    it('should return 400 when siteId is missing', async () => {
      const { handleSiteSettingsRoutes } = await import('../../src/routes/site-settings-api');

      const request = new Request('https://api.example.com/api/sites//settings', {
        method: 'GET',
      });

      const response = await handleSiteSettingsRoutes(request, {
        siteId: undefined,
        principal: mockPrincipal,
      });

      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /api/sites/{siteId}/settings', () => {
    it('should update settings and return result', async () => {
      const { handleSiteSettingsRoutes } = await import('../../src/routes/site-settings-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'branch-main',
        siteId: 'site-123',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      vi.mocked(settingsService.updateSiteSettings).mockResolvedValue({
        cacheTtlMain: 120,
        cacheTtlBranch: 10,
      });

      const request = new Request('https://api.example.com/api/sites/site-123/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheTtlMain: 120, cacheTtlBranch: 10 }),
      });

      const response = await handleSiteSettingsRoutes(request, {
        siteId: 'site-123',
        principal: mockPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.settings).toEqual({
        cacheTtlMain: 120,
        cacheTtlBranch: 10,
      });
      expect(settingsService.updateSiteSettings).toHaveBeenCalledWith(
        'site-123',
        { cacheTtlMain: 120, cacheTtlBranch: 10 },
      );
    });

    it('should return 403 for unauthorized users', async () => {
      const { handleSiteSettingsRoutes } = await import('../../src/routes/site-settings-api');
      const services = await import('../../src/services');
      const { AuthorizationError } = await import('../../src/auth/authorization');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'branch-main',
        siteId: 'site-123',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const { assertPermission } = await import('../../src/auth/authorization');
      vi.mocked(assertPermission).mockRejectedValue(
        new AuthorizationError('Insufficient permissions'),
      );

      const request = new Request('https://api.example.com/api/sites/site-123/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheTtlMain: 120 }),
      });

      const response = await handleSiteSettingsRoutes(request, {
        siteId: 'site-123',
        principal: mockPrincipal,
      });

      expect(response.status).toBe(403);
    });

    it('should return 400 for invalid settings', async () => {
      const { handleSiteSettingsRoutes } = await import('../../src/routes/site-settings-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'branch-main',
        siteId: 'site-123',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const { InvalidSettingsError } = await import('../../src/services/site-settings-service');
      vi.mocked(settingsService.updateSiteSettings).mockRejectedValue(
        new InvalidSettingsError('cacheTtlMain must be a positive integer'),
      );

      const request = new Request('https://api.example.com/api/sites/site-123/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheTtlMain: -1 }),
      });

      const response = await handleSiteSettingsRoutes(request, {
        siteId: 'site-123',
        principal: mockPrincipal,
      });

      expect(response.status).toBe(400);
    });

    it('should return 404 when site not found on update', async () => {
      const { handleSiteSettingsRoutes } = await import('../../src/routes/site-settings-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'branch-main',
        siteId: 'site-123',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      vi.mocked(settingsService.updateSiteSettings).mockResolvedValue(null);

      const request = new Request('https://api.example.com/api/sites/site-123/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheTtlMain: 120 }),
      });

      const response = await handleSiteSettingsRoutes(request, {
        siteId: 'site-123',
        principal: mockPrincipal,
      });

      expect(response.status).toBe(404);
    });

    it('should return 403 for service principals', async () => {
      const { handleSiteSettingsRoutes } = await import('../../src/routes/site-settings-api');

      const request = new Request('https://api.example.com/api/sites/site-123/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheTtlMain: 120 }),
      });

      const response = await handleSiteSettingsRoutes(request, {
        siteId: 'site-123',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(403);
    });
  });

  describe('unsupported methods', () => {
    it('should return 405 for POST', async () => {
      const { handleSiteSettingsRoutes } = await import('../../src/routes/site-settings-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'branch-main',
        siteId: 'site-123',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const request = new Request('https://api.example.com/api/sites/site-123/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await handleSiteSettingsRoutes(request, {
        siteId: 'site-123',
        principal: mockPrincipal,
      });

      expect(response.status).toBe(405);
    });

    it('should return 405 for DELETE', async () => {
      const { handleSiteSettingsRoutes } = await import('../../src/routes/site-settings-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue({
        id: 'branch-main',
        siteId: 'site-123',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const request = new Request('https://api.example.com/api/sites/site-123/settings', {
        method: 'DELETE',
      });

      const response = await handleSiteSettingsRoutes(request, {
        siteId: 'site-123',
        principal: mockPrincipal,
      });

      expect(response.status).toBe(405);
    });
  });
});
