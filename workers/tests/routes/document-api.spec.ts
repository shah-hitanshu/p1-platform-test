/**
 * Phase 7.1.1b: Document CRUD API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for document CRUD operations.
 * Includes soft-delete with archive/restore functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services
vi.mock('../../src/services', () => ({
  createDocument: vi.fn(),
  getDocument: vi.fn(),
  getDocumentByPath: vi.fn(),
  updateDocumentPath: vi.fn(),
  archiveDocument: vi.fn(),
  restoreDocument: vi.fn(),
  listDocuments: vi.fn(),
  // Branch-scoped document operations
  listDocumentsOnBranch: vi.fn(),
  createDocumentOnBranch: vi.fn(),
  documentExistsOnBranch: vi.fn(),
  deleteDocumentOnBranch: vi.fn(),
  getBranch: vi.fn(),
  // Document version operations
  getLatestDocumentVersion: vi.fn(),
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
      super(`Path "${path}" is occupied by another document.`);
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
  getMainBranch: vi.fn(),
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

describe('Phase 7.1.1b: Document CRUD API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // POST /api/sites/{siteId}/documents - Create Document
  // ===========================================================================

  describe('POST /api/sites/{siteId}/documents', () => {
    it('should create a new document', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.createDocument).mockResolvedValueOnce({
        id: 'doc-uuid',
        siteId: 'site-1',
        path: 'pages/about-us',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: 'pages/about-us',
          }),
        },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBe('doc-uuid');
      expect(body.path).toBe('pages/about-us');
    });

    it('should return 400 for missing path', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('path');
    });

    it('should return 404 for non-existent site', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.createDocument).mockRejectedValueOnce(
        new services.SiteNotFoundError('nonexistent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/nonexistent/documents',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: 'pages/home',
          }),
        },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });

    it('should return 409 for duplicate path', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.createDocument).mockRejectedValueOnce(
        new services.DuplicateDocumentPathError('pages/about-us'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: 'pages/about-us',
          }),
        },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(409);
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/documents - List Documents
  // ===========================================================================

  describe('GET /api/sites/{siteId}/documents', () => {
    it('should list documents', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.listDocuments).mockResolvedValueOnce([
        {
          id: 'doc-1',
          siteId: 'site-1',
          path: 'pages/home',
          createdAt: '2026-01-24T10:00:00.000Z',
        },
        {
          id: 'doc-2',
          siteId: 'site-1',
          path: 'pages/about',
          createdAt: '2026-01-24T11:00:00.000Z',
        },
      ]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.documents).toHaveLength(2);
    });

    it('should filter by path prefix', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.listDocuments).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents?pathPrefix=pages/',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      expect(services.listDocuments).toHaveBeenCalledWith(
        'site-1',
        expect.objectContaining({ pathPrefix: 'pages/' }),
      );
    });

    it('should support pagination', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.listDocuments).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents?limit=20&offset=10',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      expect(services.listDocuments).toHaveBeenCalledWith(
        'site-1',
        expect.objectContaining({ limit: 20, offset: 10 }),
      );
    });

    it('should support archived filter', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.listDocuments).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents?archived=true',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      expect(services.listDocuments).toHaveBeenCalledWith(
        'site-1',
        expect.objectContaining({ archived: true }),
      );
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/documents/{documentId} - Get Document
  // ===========================================================================

  describe('GET /api/sites/{siteId}/documents/{documentId}', () => {
    it('should return document details', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.getDocument).mockResolvedValueOnce({
        id: 'doc-1',
        siteId: 'site-1',
        path: 'pages/about',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents/doc-1',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        documentId: 'doc-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe('doc-1');
      expect(body.path).toBe('pages/about');
    });

    it('should return 404 for non-existent document', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.getDocument).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents/nonexistent',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        documentId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/documents/by-path/{documentPath} - Get by Path
  // ===========================================================================

  describe('GET /api/sites/{siteId}/documents/by-path/{documentPath}', () => {
    it('should return document by path', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.getDocumentByPath).mockResolvedValueOnce({
        id: 'doc-1',
        siteId: 'site-1',
        path: 'pages/about-us',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents/by-path/pages%2Fabout-us',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        documentPath: 'pages/about-us',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.path).toBe('pages/about-us');
    });

    it('should return 404 for non-existent path', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.getDocumentByPath).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents/by-path/nonexistent',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        documentPath: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // PATCH /api/sites/{siteId}/documents/{documentId} - Update Document Path
  // ===========================================================================

  describe('PATCH /api/sites/{siteId}/documents/{documentId}', () => {
    it('should update document path', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.updateDocumentPath).mockResolvedValueOnce({
        id: 'doc-1',
        siteId: 'site-1',
        path: 'pages/about',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents/doc-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: 'pages/about',
          }),
        },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        documentId: 'doc-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.path).toBe('pages/about');
    });

    it('should return 404 for non-existent document', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.updateDocumentPath).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents/nonexistent',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: 'pages/new-path',
          }),
        },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        documentId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });

    it('should return 409 for duplicate path', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.updateDocumentPath).mockRejectedValueOnce(
        new services.DuplicateDocumentPathError('pages/existing'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents/doc-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: 'pages/existing',
          }),
        },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        documentId: 'doc-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(409);
    });
  });

  // ===========================================================================
  // DELETE /api/sites/{siteId}/documents/{documentId} - Soft Delete
  // ===========================================================================

  describe('DELETE /api/sites/{siteId}/documents/{documentId}', () => {
    it('should soft-delete (archive) a document', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.archiveDocument).mockResolvedValueOnce(true);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents/doc-1',
        { method: 'DELETE' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        documentId: 'doc-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(204);
      expect(services.archiveDocument).toHaveBeenCalledWith('doc-1');
    });

    it('should return 404 for non-existent document', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.archiveDocument).mockResolvedValueOnce(false);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents/nonexistent',
        { method: 'DELETE' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        documentId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // POST /api/sites/{siteId}/documents/{documentId}/restore - Restore
  // ===========================================================================

  describe('POST /api/sites/{siteId}/documents/{documentId}/restore', () => {
    it('should restore an archived document', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.restoreDocument).mockResolvedValueOnce({
        id: 'doc-1',
        siteId: 'site-1',
        path: 'pages/about-us',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents/doc-1/restore',
        { method: 'POST' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        documentId: 'doc-1',
        action: 'restore',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe('doc-1');
    });

    it('should return 404 for non-existent or non-archived document', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.restoreDocument).mockRejectedValueOnce(
        new services.DocumentNotFoundError('nonexistent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents/nonexistent/restore',
        { method: 'POST' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        documentId: 'nonexistent',
        action: 'restore',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });

    it('should return 409 if path is now occupied', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.restoreDocument).mockRejectedValueOnce(
        new services.DocumentPathConflictError('pages/about-us'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents/doc-1/restore',
        { method: 'POST' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        documentId: 'doc-1',
        action: 'restore',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(409);
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should return 405 for unsupported methods', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents',
        { method: 'PUT' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(405);
    });

    it('should handle service errors gracefully', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });
      vi.mocked(services.listDocuments).mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(500);
    });
  });

  // =============================================================================
  // Branch-Scoped Document Operations
  // =============================================================================

  describe('Branch-Scoped Document Operations', () => {
    // =========================================================================
    // GET /api/sites/{siteId}/branches/{branchId}/documents - List on Branch
    // =========================================================================

    describe('GET /api/sites/{siteId}/branches/{branchId}/documents', () => {
      it('should list documents on a branch', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.listDocumentsOnBranch).mockResolvedValueOnce([
          {
            id: 'doc-1',
            siteId: 'site-1',
            path: 'pages/home',
            createdAt: '2026-01-24T10:00:00.000Z',
          },
        ]);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.documents).toHaveLength(1);
      });

      it('should return 404 when branch does not exist', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce(null);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/nonexistent/documents',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'nonexistent',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(404);
      });

      it('should support pathPrefix filter on branch', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.listDocumentsOnBranch).mockResolvedValueOnce([]);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents?pathPrefix=pages/',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(200);
        expect(services.listDocumentsOnBranch).toHaveBeenCalledWith(
          'branch-1',
          expect.objectContaining({ pathPrefix: 'pages/' }),
        );
      });
    });

    // =========================================================================
    // POST /api/sites/{siteId}/branches/{branchId}/documents - Create on Branch
    // =========================================================================

    describe('POST /api/sites/{siteId}/branches/{branchId}/documents', () => {
      it('should create a document on a branch', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'feature',
          status: 'active',
          isMain: false,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce({
          document: {
            id: 'doc-new',
            siteId: 'site-1',
            path: 'pages/new-page',
            createdAt: '2026-01-24T12:00:00.000Z',
          },
          version: {
            id: 'version-1',
            documentId: 'doc-new',
            branchId: 'branch-1',
            versionNumber: 1,
            snapshot: {},
            source: 'edit',
            createdById: 'user-1',
            createdByType: 'user',
            createdAt: '2026-01-24T12:00:00.000Z',
          },
        });

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: 'pages/new-page' }),
          },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.document.id).toBe('doc-new');
        expect(body.version).toBeDefined();
      });

      it('should return 400 for missing path', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'feature',
          status: 'active',
          isMain: false,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(400);
      });

      it('should return 404 when branch does not exist', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce(null);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/nonexistent/documents',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: 'pages/test' }),
          },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'nonexistent',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(404);
      });
    });

    // =========================================================================
    // GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}
    // =========================================================================

    describe('GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}', () => {
      it('should return document if it exists on the branch', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
        vi.mocked(services.getDocument).mockResolvedValueOnce({
          id: 'doc-1',
          siteId: 'site-1',
          path: 'pages/about',
          createdAt: '2026-01-24T10:00:00.000Z',
        });

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.id).toBe('doc-1');
      });

      it('should return 404 when document is not on branch', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(false);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-nothere',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-nothere',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(404);
      });
    });

    // =========================================================================
    // DELETE /api/sites/{siteId}/branches/{branchId}/documents/{documentId}
    // =========================================================================

    describe('DELETE /api/sites/{siteId}/branches/{branchId}/documents/{documentId}', () => {
      it('should create tombstone version on branch', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'feature',
          status: 'active',
          isMain: false,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.deleteDocumentOnBranch).mockResolvedValueOnce(true);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1',
          { method: 'DELETE' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(204);
        expect(services.deleteDocumentOnBranch).toHaveBeenCalledWith({
          documentId: 'doc-1',
          branchId: 'branch-1',
          deletedById: 'user-1',
          deletedByType: 'user',
        });
      });

      it('should return 404 when document does not exist', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'feature',
          status: 'active',
          isMain: false,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.deleteDocumentOnBranch).mockRejectedValueOnce(
          new services.DocumentNotFoundError('nonexistent'),
        );

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/nonexistent',
          { method: 'DELETE' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'nonexistent',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(404);
      });

      it('should return 404 when branch does not exist', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce(null);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/nonexistent/documents/doc-1',
          { method: 'DELETE' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'nonexistent',
          documentId: 'doc-1',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(404);
      });
    });

    // =========================================================================
    // Document Version Routes
    // =========================================================================

    // GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions
    describe('GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions', () => {
      it('should list document versions', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
        vi.mocked(services.listDocumentVersions).mockResolvedValueOnce([
          {
            id: 'version-2',
            documentId: 'doc-1',
            branchId: 'branch-1',
            versionNumber: 2,
            snapshot: { title: 'Updated' },
            source: 'edit',
            createdById: 'user-1',
            createdByType: 'user',
            createdAt: '2026-01-24T12:00:00.000Z',
          },
          {
            id: 'version-1',
            documentId: 'doc-1',
            branchId: 'branch-1',
            versionNumber: 1,
            snapshot: { title: 'Initial' },
            source: 'edit',
            createdById: 'user-1',
            createdByType: 'user',
            createdAt: '2026-01-24T10:00:00.000Z',
          },
        ]);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          versionsPath: true,
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.versions).toHaveLength(2);
        expect(body.versions[0].versionNumber).toBe(2);
        expect(body.versions[1].versionNumber).toBe(1);
      });

      it('should return 404 when branch does not exist', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce(null);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/nonexistent/documents/doc-1/versions',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'nonexistent',
          documentId: 'doc-1',
          versionsPath: true,
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(404);
      });

      it('should return 404 when document does not exist on branch', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(false);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-nothere/versions',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-nothere',
          versionsPath: true,
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(404);
      });
    });

    // GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/latest
    describe('GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/latest', () => {
      it('should return the latest document version', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
        vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
          id: 'version-3',
          documentId: 'doc-1',
          branchId: 'branch-1',
          versionNumber: 3,
          snapshot: { content: [{ type: 'Heading', props: { title: 'Hello' } }], root: {} },
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T14:00:00.000Z',
        });

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions/latest',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          versionsPath: true,
          versionAction: 'latest',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.id).toBe('version-3');
        expect(body.versionNumber).toBe(3);
        expect(body.snapshot.content).toBeDefined();
      });

      it('should return 404 when no versions exist', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
        vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce(null);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions/latest',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          versionsPath: true,
          versionAction: 'latest',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(404);
      });
    });

    // GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/{versionId}
    describe('GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/{versionId}', () => {
      it('should return 200 with version data when version exists', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
        vi.mocked(services.getDocumentVersion).mockResolvedValueOnce({
          id: 'version-123e4567-e89b-12d3-a456-426614174000',
          documentId: 'doc-1',
          branchId: 'branch-1',
          versionNumber: 2,
          snapshot: { content: [{ type: 'Heading', props: { title: 'Historical' } }], root: {} },
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T11:00:00.000Z',
        });

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions/version-123e4567-e89b-12d3-a456-426614174000',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          versionsPath: true,
          versionAction: 'by-id',
          versionId: 'version-123e4567-e89b-12d3-a456-426614174000',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.id).toBe('version-123e4567-e89b-12d3-a456-426614174000');
        expect(body.versionNumber).toBe(2);
        expect(body.snapshot.content).toBeDefined();
      });

      it('should return 404 when version ID does not exist', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
        vi.mocked(services.getDocumentVersion).mockResolvedValueOnce(null);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions/nonexistent-version-id-00000000',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          versionsPath: true,
          versionAction: 'by-id',
          versionId: 'nonexistent-version-id-00000000',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(404);
      });

      it('should return 404 when version exists but belongs to different document', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
        // Version exists but belongs to a different document
        vi.mocked(services.getDocumentVersion).mockResolvedValueOnce({
          id: 'version-123e4567-e89b-12d3-a456-426614174000',
          documentId: 'doc-other',
          branchId: 'branch-1',
          versionNumber: 1,
          snapshot: {},
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
        });

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions/version-123e4567-e89b-12d3-a456-426614174000',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          versionsPath: true,
          versionAction: 'by-id',
          versionId: 'version-123e4567-e89b-12d3-a456-426614174000',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(404);
      });

      it('should return 404 when version exists but belongs to different branch', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
        // Version exists but belongs to a different branch
        vi.mocked(services.getDocumentVersion).mockResolvedValueOnce({
          id: 'version-123e4567-e89b-12d3-a456-426614174000',
          documentId: 'doc-1',
          branchId: 'branch-other',
          versionNumber: 1,
          snapshot: {},
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
        });

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions/version-123e4567-e89b-12d3-a456-426614174000',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          versionsPath: true,
          versionAction: 'by-id',
          versionId: 'version-123e4567-e89b-12d3-a456-426614174000',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(404);
      });

      it('should return 404 when document does not exist on branch', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(false);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-nothere/versions/version-123e4567-e89b-12d3-a456-426614174000',
          { method: 'GET' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-nothere',
          versionsPath: true,
          versionAction: 'by-id',
          versionId: 'version-123e4567-e89b-12d3-a456-426614174000',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(404);
      });

      it('should return 405 for non-GET methods', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions/version-123e4567-e89b-12d3-a456-426614174000',
          { method: 'DELETE' },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          versionsPath: true,
          versionAction: 'by-id',
          versionId: 'version-123e4567-e89b-12d3-a456-426614174000',
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(405);
      });
    });

    // POST /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions
    describe('POST /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions', () => {
      it('should create a new document version', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
        vi.mocked(services.createDocumentVersion).mockResolvedValueOnce({
          id: 'version-new',
          documentId: 'doc-1',
          branchId: 'branch-1',
          versionNumber: 4,
          snapshot: { content: [{ type: 'Text', props: { text: 'Hello World' } }] },
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T15:00:00.000Z',
        });

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              snapshot: { content: [{ type: 'Text', props: { text: 'Hello World' } }] },
            }),
          },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          versionsPath: true,
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.id).toBe('version-new');
        expect(body.versionNumber).toBe(4);
        expect(body.source).toBe('edit');
        expect(services.createDocumentVersion).toHaveBeenCalledWith({
          documentId: 'doc-1',
          branchId: 'branch-1',
          snapshot: { content: [{ type: 'Text', props: { text: 'Hello World' } }] },
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
        });
      });

      it('should return 400 when snapshot is missing', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          versionsPath: true,
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('snapshot');
      });

      it('should return 400 when snapshot is not an object', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ snapshot: 'not an object' }),
          },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          versionsPath: true,
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('object');
      });

      it('should return 404 when document does not exist on branch', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(false);

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-nothere/versions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ snapshot: { title: 'Test' } }),
          },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-nothere',
          versionsPath: true,
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(404);
      });

      it('should accept any valid JSON object as snapshot (Puck-like structure)', async () => {
        const { handleDocumentRoutes } = await import(
          '../../src/routes/document-api'
        );
        const services = await import('../../src/services');

        const puckSnapshot = {
          content: [
            { type: 'HeadingBlock', props: { id: 'h1', title: 'Welcome' } },
            { type: 'TextBlock', props: { id: 't1', text: 'Hello world' } },
          ],
          root: { props: { title: 'My Page' } },
          zones: {},
        };

        vi.mocked(services.getBranch).mockResolvedValueOnce({
          id: 'branch-1',
          siteId: 'site-1',
          name: 'main',
          status: 'active',
          isMain: true,
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T10:00:00.000Z',
          updatedAt: '2026-01-24T10:00:00.000Z',
        });
        vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
        vi.mocked(services.createDocumentVersion).mockResolvedValueOnce({
          id: 'version-puck',
          documentId: 'doc-1',
          branchId: 'branch-1',
          versionNumber: 1,
          snapshot: puckSnapshot,
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T15:00:00.000Z',
        });

        const request = new Request(
          'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ snapshot: puckSnapshot }),
          },
        );

        const response = await handleDocumentRoutes(request, {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentId: 'doc-1',
          versionsPath: true,
          principal: { id: 'user-1', type: 'user' },
        });

        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.snapshot).toEqual(puckSnapshot);
      });
    });
  });

  // ===========================================================================
  // Authorization
  // ===========================================================================

  describe('Authorization', () => {
    const authPrincipal = {
      id: 'user-1',
      type: 'user' as const,
      email: 'alice@example.com',
      pantheonSiteRoles: { 'site-1': 'admin' as const },
      tokenExpiry: '2026-01-24T10:00:00.000Z',
    };

    it('should check canView permission for branch-scoped GET list documents', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-1',
        siteId: 'site-1',
        name: 'feature',
        isMain: false,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.listDocumentsOnBranch).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/documents',
        { method: 'GET' },
      );

      await handleDocumentRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'branch-1',
        'canView',
      );
    });

    it('should check canEditDocuments permission for branch-scoped POST create document', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-1',
        siteId: 'site-1',
        name: 'feature',
        isMain: false,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce({
        document: {
          id: 'doc-new',
          siteId: 'site-1',
          path: '/test',
          createdAt: '2026-01-24T12:00:00.000Z',
        },
        version: {
          id: 'version-1',
          documentId: 'doc-new',
          branchId: 'branch-1',
          versionNumber: 1,
          snapshot: {},
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-24T12:00:00.000Z',
        },
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/documents',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: '/test' }),
        },
      );

      await handleDocumentRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'branch-1',
        'canEditDocuments',
      );
    });

    it('should check canView permission for site-scoped GET list documents', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-1',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(services.listDocuments).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/documents',
        { method: 'GET' },
      );

      await handleDocumentRoutes(request, {
        siteId: 'site-1',
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'main-branch-id',
        'canView',
      );
    });

    it('should return 403 when principal lacks permission', async () => {
      const { handleDocumentRoutes } = await import(
        '../../src/routes/document-api'
      );
      const services = await import('../../src/services');
      const { assertPermission, AuthorizationError } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-1',
        siteId: 'site-1',
        name: 'feature',
        isMain: false,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      });

      vi.mocked(assertPermission).mockImplementationOnce(() => {
        throw new AuthorizationError(
          'Permission denied',
          'canView',
          'viewer',
        );
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/documents',
        { method: 'GET' },
      );

      const response = await handleDocumentRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        principal: authPrincipal,
      });

      expect(response.status).toBe(403);
    });
  });
});
