/**
 * CRDT Preview API Route Tests (TDD)
 *
 * Tests for POST /api/sites/{siteId}/merge/crdt-preview endpoint.
 * This endpoint returns a merged CRDT snapshot without committing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services
vi.mock('../../src/services', () => ({
  checkMergeability: vi.fn(),
  executeMerge: vi.fn(),
  executeMergeWithResolution: vi.fn(),
  previewMerge: vi.fn(),
  createMergeRequest: vi.fn(),
  getMergeRequest: vi.fn(),
  listMergeRequests: vi.fn(),
  updateMergeRequest: vi.fn(),
  updateMergeRequestStatus: vi.fn(),
  deleteMergeRequest: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
  mergeCrdtStates: vi.fn(),
  createDocumentVersion: vi.fn(),
  MergeRequestNotFoundError: class MergeRequestNotFoundError extends Error {
    name = 'MergeRequestNotFoundError';
    constructor(public requestId: string) {
      super(`Merge request not found: ${requestId}`);
    }
  },
  SourceBranchNotFoundError: class SourceBranchNotFoundError extends Error {
    name = 'SourceBranchNotFoundError';
    constructor(public branchId: string) {
      super(`Source branch not found: ${branchId}`);
    }
  },
  TargetBranchNotFoundError: class TargetBranchNotFoundError extends Error {
    name = 'TargetBranchNotFoundError';
    constructor(public branchId: string) {
      super(`Target branch not found: ${branchId}`);
    }
  },
  MergeConflictsError: class MergeConflictsError extends Error {
    name = 'MergeConflictsError';
    constructor(
      public mergeRequestId: string,
      public conflictCount: number,
    ) {
      super('Merge has unresolved conflicts');
    }
  },
  MergeNotAllowedError: class MergeNotAllowedError extends Error {
    name = 'MergeNotAllowedError';
    constructor(
      public mergeRequestId: string,
      public currentStatus: string,
    ) {
      super('Merge not allowed');
    }
  },
  MergeExecutionError: class MergeExecutionError extends Error {
    name = 'MergeExecutionError';
    constructor(public mergeRequestId: string) {
      super('Merge execution failed');
    }
  },
  InvalidCrdtStateError: class InvalidCrdtStateError extends Error {
    name = 'InvalidCrdtStateError';
    constructor(
      public source: 'source' | 'target' | 'base',
      public reason: string,
    ) {
      super(`Invalid CRDT state in ${source} version: ${reason}`);
    }
  },
  MissingCrdtStateError: class MissingCrdtStateError extends Error {
    name = 'MissingCrdtStateError';
    constructor(public versionId: string) {
      super(`Document version "${versionId}" is missing CRDT state required for merge.`);
    }
  },
}));

// Mock authorization
vi.mock('../../src/auth/middleware', () => ({
  requirePermission: vi.fn(() => vi.fn()),
}));

const defaultContext = {
  siteId: 'site-1',
  operation: 'crdt-preview' as const,
  principal: { id: 'user-1', type: 'user' as const },
};

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/sites/site-1/merge/crdt-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/sites/{siteId}/merge/crdt-preview', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('should return 400 when documentId is missing', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = makeRequest({
      sourceBranchId: 'branch-source',
      targetBranchId: 'branch-target',
    });

    const response = await handleMergeRoutes(request, defaultContext);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toMatch(/documentId/i);
  });

  it('should return 400 when sourceBranchId is missing', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = makeRequest({
      documentId: 'doc-1',
      targetBranchId: 'branch-target',
    });

    const response = await handleMergeRoutes(request, defaultContext);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toMatch(/sourceBranchId|targetBranchId|required/i);
  });

  it('should return 400 when targetBranchId is missing', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = makeRequest({
      documentId: 'doc-1',
      sourceBranchId: 'branch-source',
    });

    const response = await handleMergeRoutes(request, defaultContext);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toMatch(/sourceBranchId|targetBranchId|required/i);
  });

  it('should return 404 when source document version is not found', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const services = await import('../../src/services');

    vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce(null);

    const request = makeRequest({
      documentId: 'doc-1',
      sourceBranchId: 'branch-source',
      targetBranchId: 'branch-target',
    });

    const response = await handleMergeRoutes(request, defaultContext);
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toMatch(/source|version|not found/i);
  });

  it('should return 404 when target document version is not found', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const services = await import('../../src/services');

    // Source version exists
    vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
      id: 'ver-1',
      documentId: 'doc-1',
      branchId: 'branch-source',
      versionNumber: 1,
      snapshot: { title: 'Source' },
      crdtState: 'c291cmNlLXN0YXRl',
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
    });
    // Target version not found
    vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce(null);

    const request = makeRequest({
      documentId: 'doc-1',
      sourceBranchId: 'branch-source',
      targetBranchId: 'branch-target',
    });

    const response = await handleMergeRoutes(request, defaultContext);
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toMatch(/target|version|not found/i);
  });

  it('should return 422 when source version lacks CRDT state', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const services = await import('../../src/services');

    vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
      id: 'ver-1',
      documentId: 'doc-1',
      branchId: 'branch-source',
      versionNumber: 1,
      snapshot: { title: 'Source' },
      crdtState: undefined,
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
    });

    const request = makeRequest({
      documentId: 'doc-1',
      sourceBranchId: 'branch-source',
      targetBranchId: 'branch-target',
    });

    const response = await handleMergeRoutes(request, defaultContext);
    expect(response.status).toBe(422);

    const body = await response.json();
    expect(body.error).toMatch(/CRDT state/i);
  });

  it('should return 422 when target version lacks CRDT state', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const services = await import('../../src/services');

    // Source has CRDT state
    vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
      id: 'ver-1',
      documentId: 'doc-1',
      branchId: 'branch-source',
      versionNumber: 1,
      snapshot: { title: 'Source' },
      crdtState: 'c291cmNlLXN0YXRl',
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
    });
    // Target lacks CRDT state
    vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
      id: 'ver-2',
      documentId: 'doc-1',
      branchId: 'branch-target',
      versionNumber: 1,
      snapshot: { title: 'Target' },
      crdtState: undefined,
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
    });

    const request = makeRequest({
      documentId: 'doc-1',
      sourceBranchId: 'branch-source',
      targetBranchId: 'branch-target',
    });

    const response = await handleMergeRoutes(request, defaultContext);
    expect(response.status).toBe(422);

    const body = await response.json();
    expect(body.error).toMatch(/CRDT state/i);
  });

  it('should return 200 with merged snapshot on success', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const services = await import('../../src/services');

    const mergedSnapshot = { title: 'Merged Title', body: 'Merged Body' };

    // Source version
    vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
      id: 'ver-1',
      documentId: 'doc-1',
      branchId: 'branch-source',
      versionNumber: 2,
      snapshot: { title: 'Source Title' },
      crdtState: 'c291cmNlLXN0YXRl',
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
    });
    // Target version
    vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
      id: 'ver-2',
      documentId: 'doc-1',
      branchId: 'branch-target',
      versionNumber: 3,
      snapshot: { title: 'Target Title' },
      crdtState: 'dGFyZ2V0LXN0YXRl',
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
    });
    // Merge result
    vi.mocked(services.mergeCrdtStates).mockReturnValueOnce({
      success: true,
      mergedState: 'bWVyZ2VkLXN0YXRl',
      mergedSnapshot,
    });

    const request = makeRequest({
      documentId: 'doc-1',
      sourceBranchId: 'branch-source',
      targetBranchId: 'branch-target',
    });

    const response = await handleMergeRoutes(request, defaultContext);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.snapshot).toEqual(mergedSnapshot);
  });

  it('should NOT create any new document versions (preview is read-only)', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const services = await import('../../src/services');

    // Source version
    vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
      id: 'ver-1',
      documentId: 'doc-1',
      branchId: 'branch-source',
      versionNumber: 2,
      snapshot: { title: 'Source Title' },
      crdtState: 'c291cmNlLXN0YXRl',
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
    });
    // Target version
    vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
      id: 'ver-2',
      documentId: 'doc-1',
      branchId: 'branch-target',
      versionNumber: 3,
      snapshot: { title: 'Target Title' },
      crdtState: 'dGFyZ2V0LXN0YXRl',
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
    });
    // Merge result
    vi.mocked(services.mergeCrdtStates).mockReturnValueOnce({
      success: true,
      mergedState: 'bWVyZ2VkLXN0YXRl',
      mergedSnapshot: { title: 'Merged' },
    });

    const request = makeRequest({
      documentId: 'doc-1',
      sourceBranchId: 'branch-source',
      targetBranchId: 'branch-target',
    });

    await handleMergeRoutes(request, defaultContext);

    // Verify createDocumentVersion was never called
    expect(services.createDocumentVersion).not.toHaveBeenCalled();
  });

  it('should return 422 when mergeCrdtStates throws InvalidCrdtStateError', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const services = await import('../../src/services');

    // Source version
    vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
      id: 'ver-1',
      documentId: 'doc-1',
      branchId: 'branch-source',
      versionNumber: 1,
      snapshot: { title: 'Source' },
      crdtState: 'aW52YWxpZA==',
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
    });
    // Target version
    vi.mocked(services.getLatestDocumentVersion).mockResolvedValueOnce({
      id: 'ver-2',
      documentId: 'doc-1',
      branchId: 'branch-target',
      versionNumber: 1,
      snapshot: { title: 'Target' },
      crdtState: 'dGFyZ2V0',
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
    });
    // Merge throws error
    const InvalidCrdtStateError = (await import('../../src/services')).InvalidCrdtStateError;
    vi.mocked(services.mergeCrdtStates).mockImplementationOnce(() => {
      throw new InvalidCrdtStateError('source', 'Invalid CRDT data');
    });

    const request = makeRequest({
      documentId: 'doc-1',
      sourceBranchId: 'branch-source',
      targetBranchId: 'branch-target',
    });

    const response = await handleMergeRoutes(request, defaultContext);
    expect(response.status).toBe(422);

    const body = await response.json();
    expect(body.error).toMatch(/CRDT|invalid/i);
  });

  it('should return 405 for non-POST methods', async () => {
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = new Request('http://localhost/api/sites/site-1/merge/crdt-preview', {
      method: 'GET',
    });

    const response = await handleMergeRoutes(request, defaultContext);
    expect(response.status).toBe(405);
  });
});
