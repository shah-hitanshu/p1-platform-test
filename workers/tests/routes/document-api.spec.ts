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
}));

// Mock authorization
vi.mock('../../src/auth/middleware', () => ({
  requirePermission: vi.fn(() => vi.fn()),
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
});
