/**
 * Document API — puckActions Passthrough Tests
 *
 * Tests that the REST version creation endpoint passes puckActions from
 * the request body to createDocumentVersion, enabling classifyChange()
 * to classify the version as structural or prop-only.
 *
 * @see PROPOSAL-010 Section 5: Structural Action Capture
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock services — follow existing pattern from document-api.spec.ts
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
  getLatestDocumentVersion: vi.fn(),
  getDocumentVersion: vi.fn(),
  listDocumentVersions: vi.fn(),
  createDocumentVersion: vi.fn(),
  reconstructVersionSnapshot: vi.fn(),
  getMainBranch: vi.fn(),
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

describe('Document API — puckActions passthrough', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('should pass puckActions to createDocumentVersion when provided in request body', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
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
      versionNumber: 2,
      snapshot: { content: [] },
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: '2026-06-17T00:00:00.000Z',
    });

    const puckActions = [
      { type: 'reorder', sourceIndex: 2, destinationIndex: 0, sourceZone: 'content', destinationZone: 'content' },
      { type: 'insert', componentType: 'TextBlock', destinationIndex: 1, destinationZone: 'content' },
    ];

    const request = new Request(
      'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot: { content: [], root: {}, zones: {} },
          puckActions,
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
    expect(services.createDocumentVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        branchId: 'branch-1',
        puckActions,
      }),
    );
  });

  it('should not include puckActions when not provided in request body', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
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
      versionNumber: 2,
      snapshot: { content: [] },
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: '2026-06-17T00:00:00.000Z',
    });

    const request = new Request(
      'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/versions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot: { content: [], root: {}, zones: {} },
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
    const call = vi.mocked(services.createDocumentVersion).mock.calls[0][0];
    expect(call.puckActions).toBeUndefined();
  });
});
