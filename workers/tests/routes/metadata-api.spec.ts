/**
 * Phase 7.1.1b: Metadata API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for document metadata operations.
 * Metadata is branch-scoped via structure association.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services
vi.mock('../../src/services', () => ({
  getBranchStructureState: vi.fn(),
  updateBranchStructureState: vi.fn(),
  getDocumentMetadata: vi.fn(),
  setDocumentMetadata: vi.fn(),
  deleteDocumentMetadata: vi.fn(),
  listDocumentMetadata: vi.fn(),
  validateAllDocuments: vi.fn(),
  getSchemaValidationSummary: vi.fn(),
  getBranchStructure: vi.fn(),
  StructureNotFoundError: class StructureNotFoundError extends Error {
    override name = 'StructureNotFoundError';
    constructor(public structureId: string) {
      super(`Structure not found: ${structureId}`);
    }
  },
  BranchStructureStateNotFoundError: class BranchStructureStateNotFoundError extends Error {
    override name = 'BranchStructureStateNotFoundError';
    constructor(
      public branchId: string,
      public structureId: string,
    ) {
      super(`Structure state not found for branch`);
    }
  },
  DocumentMetadataNotFoundError: class DocumentMetadataNotFoundError extends Error {
    override name = 'DocumentMetadataNotFoundError';
    constructor(
      public branchId: string,
      public structureId: string,
      public documentId: string,
    ) {
      super(`Document metadata not found`);
    }
  },
  SchemaValidationError: class SchemaValidationError extends Error {
    override name = 'SchemaValidationError';
    constructor(
      public errors: Array<{ field: string; message: string }>,
    ) {
      super('Schema validation failed');
    }
  },
}));

// Mock authorization
vi.mock('../../src/auth/middleware', () => ({
  requirePermission: vi.fn(() => vi.fn()),
}));

describe('Phase 7.1.1b: Metadata API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // GET Structure State
  // ===========================================================================

  describe('GET /structures/{structureId}/state', () => {
    it('should return branch structure state', async () => {
      const { handleMetadataRoutes } = await import('../../src/routes/metadata-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructureState).mockResolvedValueOnce({
        branchId: 'branch-1',
        structureId: 'struct-1',
        metadataSchema: {
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
        },
        schemaEnforcement: 'warn',
        hasChangesSinceCheckpoint: false,
        lastModifiedAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/state',
        { method: 'GET' },
      );

      const response = await handleMetadataRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        action: 'state',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.branchId).toBe('branch-1');
      expect(body.structureId).toBe('struct-1');
      expect(body.schemaEnforcement).toBe('warn');
    });

    it('should return 404 for non-existent structure state', async () => {
      const { handleMetadataRoutes } = await import('../../src/routes/metadata-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructureState).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/nonexistent/state',
        { method: 'GET' },
      );

      const response = await handleMetadataRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'nonexistent',
        action: 'state',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // PUT Schema
  // ===========================================================================

  describe('PUT /structures/{structureId}/schema', () => {
    it('should update metadata schema', async () => {
      const { handleMetadataRoutes } = await import('../../src/routes/metadata-api');
      const services = await import('../../src/services');

      vi.mocked(services.updateBranchStructureState).mockResolvedValueOnce({
        branchId: 'branch-1',
        structureId: 'struct-1',
        metadataSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', maxLength: 100 },
            author: { type: 'string' },
          },
          required: ['title', 'author'],
        },
        schemaEnforcement: 'strict',
        hasChangesSinceCheckpoint: true,
        lastModifiedAt: '2026-01-24T11:00:00.000Z',
      });

      vi.mocked(services.getSchemaValidationSummary).mockResolvedValueOnce({
        structureId: 'struct-1',
        totalDocuments: 15,
        conformingDocuments: 12,
        nonConformingDocuments: 3,
        validationErrors: [],
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/schema',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string', maxLength: 100 },
                author: { type: 'string' },
              },
              required: ['title', 'author'],
            },
            enforcement: 'strict',
          }),
        },
      );

      const response = await handleMetadataRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        action: 'schema',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.metadataSchema).toBeDefined();
      expect(body.schemaEnforcement).toBe('strict');
      expect(body.validationResult).toBeDefined();
    });
  });

  // ===========================================================================
  // POST Validate
  // ===========================================================================

  describe('POST /structures/{structureId}/validate', () => {
    it('should validate all documents against schema', async () => {
      const { handleMetadataRoutes } = await import('../../src/routes/metadata-api');
      const services = await import('../../src/services');

      vi.mocked(services.validateAllDocuments).mockResolvedValueOnce({
        structureId: 'struct-1',
        results: [
          {
            documentId: 'doc-1',
            documentPath: 'pages/old-page',
            isValid: false,
            errors: [{ field: 'author', message: 'Required field missing' }],
          },
        ],
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/validate',
        { method: 'POST' },
      );

      const response = await handleMetadataRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        action: 'validate',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.structureId).toBe('struct-1');
      expect(body.results).toHaveLength(1);
    });
  });

  // ===========================================================================
  // GET Document Metadata
  // ===========================================================================

  describe('GET /documents/{documentId}/metadata', () => {
    it('should return document metadata', async () => {
      const { handleMetadataRoutes } = await import('../../src/routes/metadata-api');
      const services = await import('../../src/services');

      vi.mocked(services.getDocumentMetadata).mockResolvedValueOnce({
        documentId: 'doc-1',
        structureId: 'struct-1',
        branchId: 'branch-1',
        metadata: {
          title: 'About Us',
          description: 'Learn more about our company',
        },
        conformsToSchema: true,
        validationErrors: [],
        lastModifiedAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/documents/doc-1/metadata',
        { method: 'GET' },
      );

      const response = await handleMetadataRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        documentId: 'doc-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.documentId).toBe('doc-1');
      expect(body.metadata.title).toBe('About Us');
      expect(body.conformsToSchema).toBe(true);
    });

    it('should return 404 for document not in structure', async () => {
      const { handleMetadataRoutes } = await import('../../src/routes/metadata-api');
      const services = await import('../../src/services');

      vi.mocked(services.getDocumentMetadata).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/documents/nonexistent/metadata',
        { method: 'GET' },
      );

      const response = await handleMetadataRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        documentId: 'nonexistent',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // PUT Document Metadata
  // ===========================================================================

  describe('PUT /documents/{documentId}/metadata', () => {
    it('should update document metadata', async () => {
      const { handleMetadataRoutes } = await import('../../src/routes/metadata-api');
      const services = await import('../../src/services');

      vi.mocked(services.setDocumentMetadata).mockResolvedValueOnce({
        documentId: 'doc-1',
        structureId: 'struct-1',
        branchId: 'branch-1',
        metadata: {
          title: 'About Our Company',
          description: 'Updated description',
          author: 'Content Team',
        },
        conformsToSchema: true,
        validationErrors: [],
        lastModifiedAt: '2026-01-24T11:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/documents/doc-1/metadata',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'About Our Company',
            description: 'Updated description',
            author: 'Content Team',
          }),
        },
      );

      const response = await handleMetadataRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        documentId: 'doc-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.metadata.title).toBe('About Our Company');
      expect(body.conformsToSchema).toBe(true);
    });

    it('should return 400 for schema validation failure in strict mode', async () => {
      const { handleMetadataRoutes } = await import('../../src/routes/metadata-api');
      const services = await import('../../src/services');

      vi.mocked(services.setDocumentMetadata).mockRejectedValueOnce(
        new services.SchemaValidationError([
          { field: 'author', message: 'Required field missing' },
        ]),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/documents/doc-1/metadata',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'About Us',
            // Missing required 'author' field
          }),
        },
      );

      const response = await handleMetadataRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        documentId: 'doc-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(400);
    });
  });

  // ===========================================================================
  // DELETE Document Metadata
  // ===========================================================================

  describe('DELETE /documents/{documentId}/metadata', () => {
    it('should delete document metadata', async () => {
      const { handleMetadataRoutes } = await import('../../src/routes/metadata-api');
      const services = await import('../../src/services');

      vi.mocked(services.deleteDocumentMetadata).mockResolvedValueOnce(undefined);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/documents/doc-1/metadata',
        { method: 'DELETE' },
      );

      const response = await handleMetadataRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        documentId: 'doc-1',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(204);
    });
  });

  // ===========================================================================
  // GET List Document Metadata
  // ===========================================================================

  describe('GET /structures/{structureId}/metadata', () => {
    it('should list document metadata', async () => {
      const { handleMetadataRoutes } = await import('../../src/routes/metadata-api');
      const services = await import('../../src/services');

      vi.mocked(services.listDocumentMetadata).mockResolvedValueOnce([
        {
          documentId: 'doc-1',
          structureId: 'struct-1',
          branchId: 'branch-1',
          metadata: { title: 'Page 1' },
          conformsToSchema: true,
          validationErrors: [],
          lastModifiedAt: '2026-01-24T10:00:00.000Z',
        },
        {
          documentId: 'doc-2',
          structureId: 'struct-1',
          branchId: 'branch-1',
          metadata: { title: 'Page 2' },
          conformsToSchema: false,
          validationErrors: [{ field: 'author', message: 'Required' }],
          lastModifiedAt: '2026-01-24T11:00:00.000Z',
        },
      ]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/metadata',
        { method: 'GET' },
      );

      const response = await handleMetadataRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        action: 'list',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.documents).toHaveLength(2);
    });

    it('should filter by conformance status', async () => {
      const { handleMetadataRoutes } = await import('../../src/routes/metadata-api');
      const services = await import('../../src/services');

      vi.mocked(services.listDocumentMetadata).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/metadata?conforming=false',
        { method: 'GET' },
      );

      const response = await handleMetadataRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        action: 'list',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      expect(services.listDocumentMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ conforming: false }),
      );
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should return 405 for unsupported methods', async () => {
      const { handleMetadataRoutes } = await import('../../src/routes/metadata-api');

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/state',
        { method: 'DELETE' },
      );

      const response = await handleMetadataRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        action: 'state',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(405);
    });

    it('should handle service errors gracefully', async () => {
      const { handleMetadataRoutes } = await import('../../src/routes/metadata-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructureState).mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/state',
        { method: 'GET' },
      );

      const response = await handleMetadataRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        action: 'state',
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(500);
    });
  });
});
