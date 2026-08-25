/**
 * Copy-on-Write (COW) Document API Routes Tests (TDD)
 *
 * Tests for COW fallback behavior in branch-scoped document routes.
 * On non-main branches, documents inherited from main should be
 * readable via fallback when no local version exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';
import { makePrincipal } from '../helpers/principal';
import { makeBranch } from '../helpers/branch';

// Mock the services
vi.mock('../../src/services', () => ({
  createDocument: vi.fn(),
  getDocument: vi.fn(),
  getDocumentByPath: vi.fn(),
  updateDocumentPath: vi.fn(),
  archiveDocument: vi.fn(),
  restoreDocument: vi.fn(),
  listDocuments: vi.fn(),
  listDocumentsOnBranch: vi.fn(),
  createDocumentOnBranch: vi.fn(),
  documentExistsOnBranch: vi.fn(),
  deleteDocumentOnBranch: vi.fn(),
  getBranch: vi.fn(),
  getMainBranch: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
  getLatestDocumentVersionWithFallback: vi.fn(),
  getDocumentVersion: vi.fn(),
  listDocumentVersions: vi.fn(),
  createDocumentVersion: vi.fn(),
  SiteNotFoundError: class SiteNotFoundError extends Error {
    override name = 'SiteNotFoundError';
    constructor(public siteId: string) {
      super(`Site with ID "${siteId}" not found.`);
    }
  },
  DuplicateDocumentPathError: class DuplicateDocumentPathError extends Error {
    override name = 'DuplicateDocumentPathError';
    constructor(public path: string) {
      super(`A document with path "${path}" already exists.`);
    }
  },
  InvalidDocumentPathError: class InvalidDocumentPathError extends Error {
    override name = 'InvalidDocumentPathError';
  },
  DocumentNotFoundError: class DocumentNotFoundError extends Error {
    override name = 'DocumentNotFoundError';
    constructor(public documentId: string) {
      super(`Document with ID "${documentId}" not found.`);
    }
  },
  DocumentPathConflictError: class DocumentPathConflictError extends Error {
    override name = 'DocumentPathConflictError';
    constructor(public path: string) {
      super(`Path "${path}" is occupied.`);
    }
  },
  BranchNotFoundError: class BranchNotFoundError extends Error {
    override name = 'BranchNotFoundError';
    constructor(public branchId: string) {
      super(`Branch with ID "${branchId}" not found.`);
    }
  },
  InvalidDocumentVersionParamsError: class InvalidDocumentVersionParamsError extends Error {
    override name = 'InvalidDocumentVersionParamsError';
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

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const mainBranch = makeBranch({
  id: 'branch-main',
  siteId: 'site-1',
  name: 'main',
  status: 'active' as const,
  isMain: true,
  createdById: 'user-1',
  createdByType: 'user' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const featureBranch = makeBranch({
  id: 'branch-feature',
  siteId: 'site-1',
  name: 'feature-one',
  status: 'active' as const,
  isMain: false,
  createdById: 'user-1',
  createdByType: 'user' as const,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
});

const mockDocument = {
  id: 'doc-1',
  siteId: 'site-1',
  path: 'pages/about',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const mockMainVersion = {
  id: 'version-main-1',
  documentId: 'doc-1',
  branchId: 'branch-main',
  versionNumber: 1,
  snapshot: { title: 'About Us', content: [] },
  source: 'edit',
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const mockPrincipal = makePrincipal({
  id: 'user-1',
  type: 'user',
  siteId: 'site-1',
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Copy-on-Write (COW) Document API Fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // =========================================================================
  // GET document on non-main branch -- COW fallback
  // =========================================================================

  describe('GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId} -- COW fallback', () => {
    it('should return document via COW fallback when it exists on main but not on feature branch', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      // Branch lookup: feature branch (non-main)
      vi.mocked(services.getBranch).mockResolvedValue(featureBranch);
      // Document does NOT exist locally on the feature branch
      vi.mocked(services.documentExistsOnBranch).mockResolvedValue(false);
      // Fallback: look up main branch
      vi.mocked(services.getMainBranch).mockResolvedValue(mainBranch);
      // Fallback version check confirms document exists on main
      vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValue({
        version: mockMainVersion,
        inherited: true,
      });
      // Return the document details
      vi.mocked(services.getDocument).mockResolvedValue(mockDocument);

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/branch-feature/documents/doc-1',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-feature',
        documentId: 'doc-1',
        principal: mockPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body).toHaveProperty('id', 'doc-1');
    });

    it('should return 404 on main branch when document does not exist (no COW fallback)', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      // Branch lookup: main branch
      vi.mocked(services.getBranch).mockResolvedValue(mainBranch);
      // Document does NOT exist on main
      vi.mocked(services.documentExistsOnBranch).mockResolvedValue(false);

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/branch-main/documents/doc-1',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-main',
        documentId: 'doc-1',
        principal: mockPrincipal,
      });

      expect(response.status).toBe(404);

      // getMainBranch should NOT be called -- no COW fallback on main
      expect(services.getMainBranch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // GET latest version on non-main branch -- COW fallback
  // =========================================================================

  describe('GET .../documents/{documentId}/versions/latest -- COW fallback', () => {
    it('should return inherited version from main when no local version exists on feature branch', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      // Branch lookup: feature branch (non-main)
      vi.mocked(services.getBranch).mockResolvedValue(featureBranch);
      // Document does NOT exist locally on the feature branch
      vi.mocked(services.documentExistsOnBranch).mockResolvedValue(false);
      // No local version on branch
      vi.mocked(services.getLatestDocumentVersion).mockResolvedValue(null);
      // Fallback: look up main branch
      vi.mocked(services.getMainBranch).mockResolvedValue(mainBranch);
      // Fallback returns the inherited version
      vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValue({
        version: mockMainVersion,
        inherited: true,
      });

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/branch-feature/documents/doc-1/versions/latest',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-feature',
        documentId: 'doc-1',
        versionsPath: true,
        versionAction: 'latest',
        principal: mockPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body).toHaveProperty('inherited', true);
      expect(body).toHaveProperty('id', mockMainVersion.id);
    });

    it('should return local version without inherited flag when document exists on feature branch', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      const localVersion = {
        id: 'version-feature-1',
        documentId: 'doc-1',
        branchId: 'branch-feature',
        versionNumber: 1,
        snapshot: { title: 'Local About', content: [] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-02-01T00:00:00.000Z',
      };

      // Branch lookup: feature branch (non-main)
      vi.mocked(services.getBranch).mockResolvedValue(featureBranch);
      // Document DOES exist locally on the feature branch
      vi.mocked(services.documentExistsOnBranch).mockResolvedValue(true);
      // Local version returned directly
      vi.mocked(services.getLatestDocumentVersion).mockResolvedValue(localVersion);

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/branch-feature/documents/doc-1/versions/latest',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-feature',
        documentId: 'doc-1',
        versionsPath: true,
        versionAction: 'latest',
        principal: mockPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body).toHaveProperty('id', 'version-feature-1');
      // Should NOT have inherited: true
      expect(body).not.toHaveProperty('inherited', true);
    });
  });

  // =========================================================================
  // POST create version on non-main branch for inherited document
  // =========================================================================

  describe('POST .../documents/{documentId}/versions -- COW write to inherited doc', () => {
    it('should create a version on feature branch for an inherited document', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      const newVersion = {
        id: 'version-feature-new',
        documentId: 'doc-1',
        branchId: 'branch-feature',
        versionNumber: 1,
        snapshot: { title: 'Updated About' },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-02-15T00:00:00.000Z',
      };

      // Branch lookup: feature branch (non-main)
      vi.mocked(services.getBranch).mockResolvedValue(featureBranch);
      // Document does NOT exist locally on the feature branch (inherited)
      vi.mocked(services.documentExistsOnBranch).mockResolvedValue(false);
      // Fallback: look up main branch
      vi.mocked(services.getMainBranch).mockResolvedValue(mainBranch);
      // Fallback confirms document exists on main
      vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValue({
        version: mockMainVersion,
        inherited: true,
      });
      // Creating the new version succeeds
      vi.mocked(services.createDocumentVersion).mockResolvedValue(newVersion);

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/branch-feature/documents/doc-1/versions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snapshot: { title: 'Updated About' } }),
        },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-feature',
        documentId: 'doc-1',
        versionsPath: true,
        principal: mockPrincipal,
      });

      expect(response.status).toBe(201);
      const body = await readJson(response);
      expect(body).toHaveProperty('id', 'version-feature-new');
      expect(body).toHaveProperty('branchId', 'branch-feature');
    });
  });

  // =========================================================================
  // List documents on non-main branch includes inherited flag
  // =========================================================================

  describe('GET /api/sites/{siteId}/branches/{branchId}/documents -- inherited flags', () => {
    it('should include inherited flag on documents listed for a non-main branch', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      const documentsWithInheritance = [
        {
          id: 'doc-1',
          siteId: 'site-1',
          path: 'pages/about',
          createdAt: '2026-01-01T00:00:00.000Z',
          inherited: false,
        },
        {
          id: 'doc-2',
          siteId: 'site-1',
          path: 'pages/home',
          createdAt: '2026-01-01T00:00:00.000Z',
          inherited: true,
        },
      ];

      // getBranch is called to validate branch + to determine if COW fallback is needed
      vi.mocked(services.getBranch).mockResolvedValue(featureBranch);
      // getMainBranch called for COW fallback lookup
      vi.mocked(services.getMainBranch).mockResolvedValue(mainBranch);
      // listDocumentsOnBranch returns docs with inherited flags
      vi.mocked(services.listDocumentsOnBranch).mockResolvedValue(
        documentsWithInheritance,
      );

      const request = new Request(
        'http://localhost/api/sites/site-1/branches/branch-feature/documents',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-feature',
        principal: mockPrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.documents).toHaveLength(2);
      expect(body.documents[0]).toHaveProperty('inherited', false);
      expect(body.documents[1]).toHaveProperty('inherited', true);
    });
  });
});
