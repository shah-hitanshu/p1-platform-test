/**
 * Content Redirect Lookup API Tests (TDD)
 *
 * Tests for the public-facing redirect lookup endpoint:
 * GET /api/sites/{siteId}/content-redirects/{path}
 *
 * Site-token authenticated, reads from main branch only.
 * Handles parenting resolution for child paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services', () => ({
  getMainBranch: vi.fn(),
  getDocumentByPath: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
}));

const testPrincipal = {
  id: 'site-token-1',
  type: 'service' as const,
  dbUserId: undefined,
  email: undefined,
  verified: true,
};

describe('Content Redirect Lookup API', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Direct redirect lookup
  // ===========================================================================

  describe('Direct lookup', () => {
    it('should return redirect for exact path match', async () => {
      const { handleContentRedirectRoutes } = await import(
        '../../src/routes/redirect-content-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-uuid',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdById: 'system',
        createdByType: 'system',
      });

      vi.mocked(services.getDocumentByPath).mockResolvedValueOnce({
        id: 'redirect-doc-uuid',
        siteId: 'site-1',
        path: '_registry/redirects/old-page',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'ver-1',
        documentId: 'redirect-doc-uuid',
        versionNumber: 1,
        snapshot: {
          fromPath: '/old-page',
          destination: '/new-page',
          redirectType: 'permanent',
          parenting: false,
        },
        source: 'edit',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/content-redirects/old-page',
        { method: 'GET' },
      );

      const response = await handleContentRedirectRoutes(request, {
        siteId: 'site-1',
        documentPath: 'old-page',
        principal: testPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.fromPath).toBe('/old-page');
      expect(body.destination).toBe('/new-page');
      expect(body.redirectType).toBe('permanent');
      expect(body.statusCode).toBe(301);
    });

    it('should return 302 status code for temporary redirects', async () => {
      const { handleContentRedirectRoutes } = await import(
        '../../src/routes/redirect-content-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-uuid',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdById: 'system',
        createdByType: 'system',
      });

      vi.mocked(services.getDocumentByPath).mockResolvedValueOnce({
        id: 'redirect-doc-uuid',
        siteId: 'site-1',
        path: '_registry/redirects/temp-page',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'ver-1',
        documentId: 'redirect-doc-uuid',
        versionNumber: 1,
        snapshot: {
          fromPath: '/temp-page',
          destination: '/new-temp-page',
          redirectType: 'temporary',
          parenting: false,
        },
        source: 'edit',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/content-redirects/temp-page',
        { method: 'GET' },
      );

      const response = await handleContentRedirectRoutes(request, {
        siteId: 'site-1',
        documentPath: 'temp-page',
        principal: testPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.redirectType).toBe('temporary');
      expect(body.statusCode).toBe(302);
    });

    it('should return 404 when no redirect exists', async () => {
      const { handleContentRedirectRoutes } = await import(
        '../../src/routes/redirect-content-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-uuid',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdById: 'system',
        createdByType: 'system',
      });

      // No document found at the redirect path
      vi.mocked(services.getDocumentByPath).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/content-redirects/nonexistent',
        { method: 'GET' },
      );

      const response = await handleContentRedirectRoutes(request, {
        siteId: 'site-1',
        documentPath: 'nonexistent',
        principal: testPrincipal,
      });

      expect(response.status).toBe(404);
    });

    it('should return 404 when main branch not found', async () => {
      const { handleContentRedirectRoutes } = await import(
        '../../src/routes/redirect-content-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/content-redirects/old-page',
        { method: 'GET' },
      );

      const response = await handleContentRedirectRoutes(request, {
        siteId: 'site-1',
        documentPath: 'old-page',
        principal: testPrincipal,
      });

      expect(response.status).toBe(404);
    });

    it('should return 404 when redirect has no version on main branch', async () => {
      const { handleContentRedirectRoutes } = await import(
        '../../src/routes/redirect-content-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-uuid',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdById: 'system',
        createdByType: 'system',
      });

      vi.mocked(services.getDocumentByPath).mockResolvedValueOnce({
        id: 'redirect-doc-uuid',
        siteId: 'site-1',
        path: '_registry/redirects/old-page',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      // No version on main branch (redirect is on a feature branch only)
      vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/content-redirects/old-page',
        { method: 'GET' },
      );

      const response = await handleContentRedirectRoutes(request, {
        siteId: 'site-1',
        documentPath: 'old-page',
        principal: testPrincipal,
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // Parenting redirects
  // ===========================================================================

  describe('Parenting resolution', () => {
    it('should resolve parenting redirect for child path', async () => {
      const { handleContentRedirectRoutes } = await import(
        '../../src/routes/redirect-content-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-uuid',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdById: 'system',
        createdByType: 'system',
      });

      // No direct redirect at news/article
      vi.mocked(services.getDocumentByPath)
        .mockResolvedValueOnce(null)
        // Parent redirect at news with parenting: true
        .mockResolvedValueOnce({
          id: 'parent-redirect-uuid',
          siteId: 'site-1',
          path: '_registry/redirects/news',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'db-user-1',
          createdByType: 'user',
        });

      vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'ver-1',
        documentId: 'parent-redirect-uuid',
        versionNumber: 1,
        snapshot: {
          fromPath: '/news',
          destination: '/articles',
          redirectType: 'permanent',
          parenting: true,
        },
        source: 'edit',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/content-redirects/news/article',
        { method: 'GET' },
      );

      const response = await handleContentRedirectRoutes(request, {
        siteId: 'site-1',
        documentPath: 'news/article',
        principal: testPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.destination).toBe('/articles/article');
      expect(body.redirectType).toBe('permanent');
      expect(body.statusCode).toBe(301);
    });

    it('should not propagate when parent has parenting: false', async () => {
      const { handleContentRedirectRoutes } = await import(
        '../../src/routes/redirect-content-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-uuid',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdById: 'system',
        createdByType: 'system',
      });

      // No direct redirect at news/article
      vi.mocked(services.getDocumentByPath)
        .mockResolvedValueOnce(null)
        // Parent redirect at news exists but parenting: false
        .mockResolvedValueOnce({
          id: 'parent-redirect-uuid',
          siteId: 'site-1',
          path: '_registry/redirects/news',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'db-user-1',
          createdByType: 'user',
        });

      vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'ver-1',
        documentId: 'parent-redirect-uuid',
        versionNumber: 1,
        snapshot: {
          fromPath: '/news',
          destination: '/articles',
          redirectType: 'permanent',
          parenting: false,
        },
        source: 'edit',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/content-redirects/news/article',
        { method: 'GET' },
      );

      const response = await handleContentRedirectRoutes(request, {
        siteId: 'site-1',
        documentPath: 'news/article',
        principal: testPrincipal,
      });

      expect(response.status).toBe(404);
    });

    it('should resolve deep nested parenting redirect', async () => {
      const { handleContentRedirectRoutes } = await import(
        '../../src/routes/redirect-content-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-uuid',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdById: 'system',
        createdByType: 'system',
      });

      // No direct redirect at docs/api/v2/endpoints
      vi.mocked(services.getDocumentByPath)
        .mockResolvedValueOnce(null)
        // No redirect at docs/api/v2
        .mockResolvedValueOnce(null)
        // No redirect at docs/api
        .mockResolvedValueOnce(null)
        // Redirect at docs with parenting: true
        .mockResolvedValueOnce({
          id: 'docs-redirect-uuid',
          siteId: 'site-1',
          path: '_registry/redirects/docs',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'db-user-1',
          createdByType: 'user',
        });

      vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'ver-1',
        documentId: 'docs-redirect-uuid',
        versionNumber: 1,
        snapshot: {
          fromPath: '/docs',
          destination: '/documentation',
          redirectType: 'permanent',
          parenting: true,
        },
        source: 'edit',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/content-redirects/docs/api/v2/endpoints',
        { method: 'GET' },
      );

      const response = await handleContentRedirectRoutes(request, {
        siteId: 'site-1',
        documentPath: 'docs/api/v2/endpoints',
        principal: testPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.destination).toBe('/documentation/api/v2/endpoints');
    });
  });

  // ===========================================================================
  // Method Not Allowed
  // ===========================================================================

  describe('Method Not Allowed', () => {
    it('should return 405 for POST', async () => {
      const { handleContentRedirectRoutes } = await import(
        '../../src/routes/redirect-content-api'
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/content-redirects/old-page',
        { method: 'POST' },
      );

      const response = await handleContentRedirectRoutes(request, {
        siteId: 'site-1',
        documentPath: 'old-page',
        principal: testPrincipal,
      });

      expect(response.status).toBe(405);
    });
  });
});
