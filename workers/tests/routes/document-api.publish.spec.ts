/**
 * Publish Document API Route Tests (TDD - Red State)
 *
 * Tests for POST /api/sites/:siteId/branches/:branchId/documents/:documentId/publish
 * which creates a publish-type checkpoint capturing the document's latest version.
 *
 * These tests are written BEFORE implementation following TDD methodology.
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
  publishDocument: vi.fn(),
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

const mainBranch = {
  id: 'branch-main',
  siteId: 'site-1',
  name: 'main',
  status: 'active' as const,
  isMain: true,
  createdById: 'user-1',
  createdByType: 'user' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockPrincipal = {
  id: 'user-1',
  type: 'user' as const,
  siteId: 'site-1',
};

const mockCheckpoint = {
  id: 'checkpoint-publish-001',
  branchId: 'branch-main',
  name: null,
  message: null,
  checkpointType: 'publish',
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-03-09T10:00:00.000Z',
};

const mockPublishedVersionId = 'version-uuid-latest';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/sites/:siteId/branches/:branchId/documents/:documentId/publish', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('should return 200 with checkpoint and version on successful publish', async () => {
    const { handleDocumentRoutes } = await import(
      '../../src/routes/document-api'
    );
    const services = await import('../../src/services');
    const { assertPermission } = await import('../../src/auth/authorization');

    // Branch lookup
    vi.mocked(services.getBranch).mockResolvedValue(mainBranch);
    // Document exists on branch
    vi.mocked(services.documentExistsOnBranch).mockResolvedValue(true);
    // Permission check passes (no throw)
    vi.mocked(assertPermission).mockImplementation(() => undefined);
    // publishDocument returns checkpoint + version ID
    vi.mocked(services.publishDocument).mockResolvedValue({
      checkpoint: mockCheckpoint,
      publishedVersionId: mockPublishedVersionId,
    });

    const request = new Request(
      'http://localhost/api/sites/site-1/branches/branch-main/documents/doc-1/publish',
      { method: 'POST' },
    );

    const response = await handleDocumentRoutes(request, {
      siteId: 'site-1',
      branchId: 'branch-main',
      documentId: 'doc-1',
      principal: mockPrincipal,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('checkpoint');
    expect(body).toHaveProperty('publishedVersionId', mockPublishedVersionId);
  });

  it('should return 404 when document does not exist on branch', async () => {
    const { handleDocumentRoutes } = await import(
      '../../src/routes/document-api'
    );
    const services = await import('../../src/services');
    const { assertPermission } = await import('../../src/auth/authorization');

    // Branch lookup
    vi.mocked(services.getBranch).mockResolvedValue(mainBranch);
    // Document does NOT exist on branch
    vi.mocked(services.documentExistsOnBranch).mockResolvedValue(false);
    // Permission check passes
    vi.mocked(assertPermission).mockImplementation(() => undefined);

    const request = new Request(
      'http://localhost/api/sites/site-1/branches/branch-main/documents/doc-1/publish',
      { method: 'POST' },
    );

    const response = await handleDocumentRoutes(request, {
      siteId: 'site-1',
      branchId: 'branch-main',
      documentId: 'doc-1',
      principal: mockPrincipal,
    });

    expect(response.status).toBe(404);
  });

  it('should require canEditDocuments permission', async () => {
    const { handleDocumentRoutes } = await import(
      '../../src/routes/document-api'
    );
    const services = await import('../../src/services');
    const { assertPermission, AuthorizationError } = await import(
      '../../src/auth/authorization'
    );

    // Branch lookup
    vi.mocked(services.getBranch).mockResolvedValue(mainBranch);
    // Document exists on branch
    vi.mocked(services.documentExistsOnBranch).mockResolvedValue(true);
    // Permission check fails
    vi.mocked(assertPermission).mockImplementation(() => {
      throw new AuthorizationError(
        'Insufficient permissions',
        'canEditDocuments',
        'viewer',
      );
    });

    const request = new Request(
      'http://localhost/api/sites/site-1/branches/branch-main/documents/doc-1/publish',
      { method: 'POST' },
    );

    const response = await handleDocumentRoutes(request, {
      siteId: 'site-1',
      branchId: 'branch-main',
      documentId: 'doc-1',
      principal: mockPrincipal,
    });

    expect(response.status).toBe(403);
  });
});
