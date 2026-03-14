/**
 * Post-Merge KV Invalidation Tests
 *
 * Verifies that after a successful merge execute, a branch
 * invalidation signal is written to CONFIG_KV for the target branch.
 *
 * These tests mock the service layer and verify that the route handler
 * calls writeBranchInvalidation with the correct arguments.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the services module
vi.mock('../../src/services', () => ({
  executeMerge: vi.fn(),
  executeMergeWithResolution: vi.fn(),
  handleMergeRoutes: vi.fn(),
  getMainBranch: vi.fn(),
  checkMergeability: vi.fn(),
  previewMerge: vi.fn(),
  createMergeRequest: vi.fn(),
  getMergeRequest: vi.fn(),
  listMergeRequests: vi.fn(),
  updateMergeRequest: vi.fn(),
  updateMergeRequestStatus: vi.fn(),
  deleteMergeRequest: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
  mergeCrdtStates: vi.fn(),
  MergeRequestNotFoundError: class extends Error {},
  SourceBranchNotFoundError: class extends Error {},
  TargetBranchNotFoundError: class extends Error {},
  MergeConflictsError: class extends Error {},
  MergeNotAllowedError: class extends Error {},
  MergeExecutionError: class extends Error {},
  InvalidCrdtStateError: class extends Error {},
  MissingCrdtStateError: class extends Error {},
}));

// Mock the auth module to allow all permissions
vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn().mockResolvedValue(undefined),
  AuthorizationError: class extends Error {},
}));

vi.mock('../../src/services/branch-invalidation-service', () => ({
  writeBranchInvalidation: vi.fn().mockResolvedValue(undefined),
}));

describe('post-merge KV invalidation', () => {
  beforeEach(() => {
    // clearAllMocks resets call counts but preserves mock implementations
    // set by vi.mock() at module scope — no require() re-wiring needed.
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should write invalidation signal after successful direct merge execute', async () => {
    const { executeMerge } = await import('../../src/services');
    const { writeBranchInvalidation } = await import(
      '../../src/services/branch-invalidation-service'
    );

    (executeMerge as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mergeRequestId: 'mr-1',
      checkpointId: 'cp-1',
      documentsUpdated: 2,
    });

    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = new Request('http://localhost/api/sites/site-1/merge/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceBranchId: 'branch-source',
        targetBranchId: 'branch-target',
        message: 'Test merge',
      }),
    });

    const mockKV = {} as KVNamespace;
    const response = await handleMergeRoutes(request, {
      siteId: 'site-1',
      operation: 'execute',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      configKV: mockKV,
    });

    expect(response.status).toBe(200);
    expect(writeBranchInvalidation).toHaveBeenCalledWith(mockKV, 'branch-target');
  });

  it('should NOT write invalidation signal when merge fails', async () => {
    const { executeMerge } = await import('../../src/services');
    const { writeBranchInvalidation } = await import(
      '../../src/services/branch-invalidation-service'
    );

    const { MergeConflictsError } = await import('../../src/services');
    (executeMerge as ReturnType<typeof vi.fn>).mockRejectedValue(
      new MergeConflictsError('mr-1', 2),
    );

    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = new Request('http://localhost/api/sites/site-1/merge/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceBranchId: 'branch-source',
        targetBranchId: 'branch-target',
        message: 'Test merge',
      }),
    });

    const mockKV = {} as KVNamespace;
    const response = await handleMergeRoutes(request, {
      siteId: 'site-1',
      operation: 'execute',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      configKV: mockKV,
    });

    expect(response.status).toBe(409);
    expect(writeBranchInvalidation).not.toHaveBeenCalled();
  });

  it('should swallow KV write errors without failing the merge response', async () => {
    const { executeMerge } = await import('../../src/services');
    const { writeBranchInvalidation } = await import(
      '../../src/services/branch-invalidation-service'
    );

    (executeMerge as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mergeRequestId: 'mr-1',
      checkpointId: 'cp-1',
      documentsUpdated: 1,
    });
    (writeBranchInvalidation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('KV write failed'),
    );

    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = new Request('http://localhost/api/sites/site-1/merge/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceBranchId: 'branch-source',
        targetBranchId: 'branch-target',
        message: 'Test merge',
      }),
    });

    const mockKV = {} as KVNamespace;
    const response = await handleMergeRoutes(request, {
      siteId: 'site-1',
      operation: 'execute',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      configKV: mockKV,
    });

    // Merge succeeded — KV failure is swallowed
    expect(response.status).toBe(200);
  });

  it('should write invalidation signal after merge request execute', async () => {
    const { executeMerge, getMergeRequest } = await import('../../src/services');
    const { writeBranchInvalidation } = await import(
      '../../src/services/branch-invalidation-service'
    );

    (getMergeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'mr-1',
      sourceBranchId: 'branch-source',
      targetBranchId: 'branch-target',
      status: 'approved',
      title: 'Test',
    });
    (executeMerge as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mergeRequestId: 'mr-1',
      checkpointId: 'cp-1',
      documentsUpdated: 1,
    });

    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = new Request('http://localhost/api/sites/site-1/merge-requests/mr-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const mockKV = {} as KVNamespace;
    const response = await handleMergeRoutes(request, {
      siteId: 'site-1',
      executeRequest: true,
      mergeRequestId: 'mr-1',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      configKV: mockKV,
    });

    expect(response.status).toBe(200);
    expect(writeBranchInvalidation).toHaveBeenCalledWith(mockKV, 'branch-target');
  });

  it('should write invalidation for merge with conflict resolution', async () => {
    const { executeMergeWithResolution } = await import('../../src/services');
    const { writeBranchInvalidation } = await import(
      '../../src/services/branch-invalidation-service'
    );

    (executeMergeWithResolution as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mergeRequestId: 'mr-1',
      checkpointId: 'cp-1',
      documentsUpdated: 2,
      conflictsResolved: 1,
    });

    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = new Request('http://localhost/api/sites/site-1/merge/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceBranchId: 'branch-source',
        targetBranchId: 'branch-target',
        message: 'Merge with resolutions',
        conflictResolutions: [
          { documentId: 'doc-1', strategy: 'take-source' },
        ],
      }),
    });

    const mockKV = {} as KVNamespace;
    const response = await handleMergeRoutes(request, {
      siteId: 'site-1',
      operation: 'execute',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      configKV: mockKV,
    });

    expect(response.status).toBe(200);
    expect(writeBranchInvalidation).toHaveBeenCalledWith(mockKV, 'branch-target');
  });
});
