/**
 * Redirect API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for redirect CRUD operations.
 * Redirects are stored as documents at _registry/redirects/* using document services.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services
vi.mock('../../src/services', () => ({
  createDocumentOnBranch: vi.fn(),
  listDocumentsOnBranch: vi.fn(),
  getDocument: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
  documentExistsOnBranch: vi.fn(),
  createDocumentVersion: vi.fn(),
  deleteDocumentOnBranch: vi.fn(),
  getBranch: vi.fn().mockResolvedValue({ id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true }),
  getBranchByName: vi.fn(),
  getDocumentByPath: vi.fn(),
  updateDocumentPath: vi.fn(),
  DuplicateDocumentPathError: class DuplicateDocumentPathError extends Error {
    override name = 'DuplicateDocumentPathError';
    constructor(public path: string) {
      super(`Document already exists at path: ${path}`);
    }
  },
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

const testPrincipal = {
  id: 'user-1',
  type: 'user' as const,
  dbUserId: 'db-user-1',
  email: 'test@example.com',
  verified: true,
};

describe('Redirect API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // POST /redirects - Create Redirect
  // ===========================================================================

  describe('POST /redirects - Create', () => {
    it('should create a redirect', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getDocumentByPath).mockResolvedValueOnce(null);

      vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce({
        document: {
          id: 'redirect-uuid',
          siteId: 'site-1',
          path: '_registry/redirects/redirect-uuid',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'db-user-1',
          createdByType: 'user',
        },
        version: {
          id: 'version-uuid',
          documentId: 'redirect-uuid',
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
        },
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromPath: '/old-page',
            destination: '/new-page',
            redirectType: 'permanent',
            parenting: false,
          }),
        },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBe('redirect-uuid');
      expect(body.fromPath).toBe('/old-page');
      expect(body.destination).toBe('/new-page');
      expect(body.redirectType).toBe('permanent');
      expect(body.parenting).toBe(false);
    });

    it('should return 400 when fromPath is missing', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destination: '/new-page',
            redirectType: 'permanent',
          }),
        },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.invalidParams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'fromPath' }),
        ]),
      );
    });

    it('should return 400 when destination is missing', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromPath: '/old-page',
            redirectType: 'permanent',
          }),
        },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.invalidParams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'destination' }),
        ]),
      );
    });

    it('should return 400 for invalid redirectType', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromPath: '/old-page',
            destination: '/new-page',
            redirectType: 'invalid',
          }),
        },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.invalidParams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'redirectType' }),
        ]),
      );
    });

    it('should return 400 when fromPath does not start with /', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromPath: 'no-slash',
            destination: '/new-page',
            redirectType: 'permanent',
          }),
        },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.invalidParams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'fromPath' }),
        ]),
      );
    });

    it('should return all validation errors at once', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            redirectType: 'invalid',
          }),
        },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.invalidParams.map((p: { name: string }) => p.name)).toEqual(
        expect.arrayContaining(['fromPath', 'destination', 'redirectType']),
      );
    });

    it('should return 400 for non-object body', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify('not an object'),
        },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('Invalid request body shape');
    });

    it('should return 409 when redirect already exists', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getDocumentByPath).mockResolvedValueOnce(null);

      vi.mocked(services.createDocumentOnBranch).mockRejectedValueOnce(
        new services.DuplicateDocumentPathError('_registry/redirects/old-page'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromPath: '/old-page',
            destination: '/new-page',
            redirectType: 'permanent',
            parenting: false,
          }),
        },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(409);
    });

    it('should return 409 when a page exists at the fromPath path', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      // Mock getDocumentByPath to return an existing page document (NOT a registry doc)
      vi.mocked(services.getDocumentByPath).mockResolvedValueOnce({
        id: 'page-doc-uuid',
        siteId: 'site-1',
        path: 'old-page',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromPath: '/old-page',
            destination: '/new-page',
            redirectType: 'permanent',
            parenting: false,
          }),
        },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toContain('page');
    });

    it('should default redirectType to permanent and parenting to false', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getDocumentByPath).mockResolvedValueOnce(null);

      vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce({
        document: {
          id: 'redirect-uuid',
          siteId: 'site-1',
          path: '_registry/redirects/redirect-uuid',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'db-user-1',
          createdByType: 'user',
        },
        version: {
          id: 'version-uuid',
          documentId: 'redirect-uuid',
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
        },
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromPath: '/old-page',
            destination: '/new-page',
          }),
        },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(201);

      // Verify createDocumentOnBranch was called with defaults
      expect(services.createDocumentOnBranch).toHaveBeenCalledWith(
        expect.objectContaining({
          snapshot: expect.objectContaining({
            redirectType: 'permanent',
            parenting: false,
          }),
        }),
      );
    });
  });

  // ===========================================================================
  // GET /redirects - List Redirects
  // ===========================================================================

  describe('GET /redirects - List', () => {
    it('should list all redirects on branch', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.listDocumentsOnBranch).mockResolvedValueOnce([
        {
          id: 'redirect-1',
          siteId: 'site-1',
          path: '_registry/redirects/redirect-1',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'db-user-1',
          createdByType: 'user',
        },
        {
          id: 'redirect-2',
          siteId: 'site-1',
          path: '_registry/redirects/redirect-2',
          createdAt: '2026-01-24T11:00:00.000Z',
          createdById: 'db-user-1',
          createdByType: 'user',
        },
      ]);

      vi.mocked(services.getLatestDocumentVersion)
        .mockResolvedValueOnce({
          id: 'ver-1',
          documentId: 'redirect-1',
          versionNumber: 1,
          snapshot: {
            fromPath: '/old-page-1',
            destination: '/new-page-1',
            redirectType: 'permanent',
            parenting: false,
          },
          source: 'edit',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'db-user-1',
          createdByType: 'user',
        })
        .mockResolvedValueOnce({
          id: 'ver-2',
          documentId: 'redirect-2',
          versionNumber: 1,
          snapshot: {
            fromPath: '/old-page-2',
            destination: '/new-page-2',
            redirectType: 'temporary',
            parenting: true,
          },
          source: 'edit',
          createdAt: '2026-01-24T11:00:00.000Z',
          createdById: 'db-user-1',
          createdByType: 'user',
        });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        { method: 'GET' },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.redirects).toHaveLength(2);
      expect(services.listDocumentsOnBranch).toHaveBeenCalledWith(
        'branch-1',
        expect.objectContaining({ pathPrefix: '_registry/redirects/' }),
      );
    });

    it('should return empty array when no redirects', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.listDocumentsOnBranch).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        { method: 'GET' },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.redirects).toHaveLength(0);
    });
  });

  // ===========================================================================
  // GET /redirects/{redirectId} - Get Redirect
  // ===========================================================================

  describe('GET /redirects/{redirectId} - Get', () => {
    it('should get a single redirect', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getDocument).mockResolvedValueOnce({
        id: 'redirect-1',
        siteId: 'site-1',
        path: '_registry/redirects/redirect-1',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'ver-1',
        documentId: 'redirect-1',
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
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects/redirect-1',
        { method: 'GET' },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        redirectId: 'redirect-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe('redirect-1');
      expect(body.fromPath).toBe('/old-page');
      expect(body.destination).toBe('/new-page');
    });

    it('should return 404 when redirect not found', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getDocument).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects/nonexistent',
        { method: 'GET' },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        redirectId: 'nonexistent',
        principal: testPrincipal,
      });

      expect(response.status).toBe(404);
    });

    it('should return 400 when document is not a redirect', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getDocument).mockResolvedValueOnce({
        id: 'doc-1',
        siteId: 'site-1',
        path: 'some/regular/page',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects/doc-1',
        { method: 'GET' },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        redirectId: 'doc-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(400);
    });
  });

  // ===========================================================================
  // PATCH /redirects/{redirectId} - Update Redirect
  // ===========================================================================

  describe('PATCH /redirects/{redirectId} - Update', () => {
    it('should update a redirect', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);

      vi.mocked(services.getDocument).mockResolvedValueOnce({
        id: 'redirect-1',
        siteId: 'site-1',
        path: '_registry/redirects/redirect-1',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'ver-1',
        documentId: 'redirect-1',
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

      vi.mocked(services.createDocumentVersion).mockResolvedValueOnce({
        id: 'ver-2',
        documentId: 'redirect-1',
        versionNumber: 2,
        snapshot: {
          fromPath: '/old-page',
          destination: '/updated-page',
          redirectType: 'permanent',
          parenting: false,
        },
        source: 'edit',
        createdAt: '2026-01-24T12:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects/redirect-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destination: '/updated-page',
          }),
        },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        redirectId: 'redirect-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.destination).toBe('/updated-page');
    });

    it('should return 404 when updating non-existent redirect', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(false);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects/nonexistent',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destination: '/updated-page',
          }),
        },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        redirectId: 'nonexistent',
        principal: testPrincipal,
      });

      expect(response.status).toBe(404);
    });

    it('should update only provided fields', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);

      vi.mocked(services.getDocument).mockResolvedValueOnce({
        id: 'redirect-1',
        siteId: 'site-1',
        path: '_registry/redirects/redirect-1',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
        id: 'ver-1',
        documentId: 'redirect-1',
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

      vi.mocked(services.createDocumentVersion).mockResolvedValueOnce({
        id: 'ver-2',
        documentId: 'redirect-1',
        versionNumber: 2,
        snapshot: {
          fromPath: '/old-page',
          destination: '/new-page',
          redirectType: 'temporary',
          parenting: false,
        },
        source: 'edit',
        createdAt: '2026-01-24T12:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects/redirect-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            redirectType: 'temporary',
          }),
        },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        redirectId: 'redirect-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(200);

      // Verify createDocumentVersion was called with snapshot that has
      // updated redirectType but unchanged fromPath/destination/parenting
      expect(services.createDocumentVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          snapshot: expect.objectContaining({
            fromPath: '/old-page',
            destination: '/new-page',
            redirectType: 'temporary',
            parenting: false,
          }),
        }),
      );
    });
  });

  // ===========================================================================
  // DELETE /redirects/{redirectId} - Delete Redirect
  // ===========================================================================

  describe('DELETE /redirects/{redirectId} - Delete', () => {
    it('should delete a redirect', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);

      vi.mocked(services.getDocument).mockResolvedValueOnce({
        id: 'redirect-1',
        siteId: 'site-1',
        path: '_registry/redirects/redirect-1',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'db-user-1',
        createdByType: 'user',
      });

      vi.mocked(services.deleteDocumentOnBranch).mockResolvedValueOnce(undefined);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects/redirect-1',
        { method: 'DELETE' },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        redirectId: 'redirect-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(204);
    });

    it('should return 404 when deleting non-existent redirect', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(false);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects/nonexistent',
        { method: 'DELETE' },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        redirectId: 'nonexistent',
        principal: testPrincipal,
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // Authorization
  // ===========================================================================

  describe('Authorization', () => {
    it('should check canView for GET requests', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.listDocumentsOnBranch).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        { method: 'GET' },
      );

      await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        testPrincipal,
        'site-1',
        'branch-1',
        'canView',
      );
    });

    it('should check canEdit for POST/PATCH/DELETE', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.getDocumentByPath).mockResolvedValueOnce(null);

      vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce({
        document: {
          id: 'redirect-uuid',
          siteId: 'site-1',
          path: '_registry/redirects/redirect-uuid',
          createdAt: '2026-01-24T10:00:00.000Z',
          createdById: 'db-user-1',
          createdByType: 'user',
        },
        version: {
          id: 'version-uuid',
          documentId: 'redirect-uuid',
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
        },
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromPath: '/old-page',
            destination: '/new-page',
            redirectType: 'permanent',
            parenting: false,
          }),
        },
      );

      await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        testPrincipal,
        'site-1',
        'branch-1',
        'canEdit',
      );
    });

    it('should return 403 on authorization error', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );
      const { assertPermission, AuthorizationError } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(assertPermission).mockRejectedValueOnce(
        new AuthorizationError(
          'Missing permission: canView',
          'canView',
          'viewer',
        ),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        { method: 'GET' },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(403);
    });
  });

  // ===========================================================================
  // Method Not Allowed
  // ===========================================================================

  describe('Method Not Allowed', () => {
    it('should return 405 for PUT', async () => {
      const { handleRedirectRoutes } = await import(
        '../../src/routes/redirect-api'
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/redirects',
        { method: 'PUT' },
      );

      const response = await handleRedirectRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: testPrincipal,
      });

      expect(response.status).toBe(405);
    });
  });
});
