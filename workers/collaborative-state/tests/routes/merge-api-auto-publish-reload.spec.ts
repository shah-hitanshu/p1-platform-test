/**
 * Merge API: Auto-Publish DO /reload Tests
 *
 * Verifies that after a merge into main auto-publishes documents, the route
 * handler fires DO /reload notifications per published document so live
 * editor sessions on main pick up the new versions. Mirrors the post-publish
 * reload in document-api dispatch (route-dispatch.ts:97-119).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn().mockResolvedValue(undefined),
  AuthorizationError: class extends Error {},
}));

vi.mock('../../src/services/branch-invalidation-service', () => ({
  writeBranchInvalidation: vi.fn().mockResolvedValue(undefined),
}));

interface MockStub {
  fetch: ReturnType<typeof vi.fn>;
}

interface MockBinding {
  binding: DurableObjectNamespace;
  stubs: MockStub[];
  idFromName: ReturnType<typeof vi.fn>;
}

function buildMockBinding(): MockBinding {
  const stubs: MockStub[] = [];
  const idFromName = vi.fn((name: string): { toString: () => string } => ({
    toString: (): string => name,
  }));
  const binding = {
    idFromName,
    get: vi.fn((): MockStub => {
      const stub: MockStub = {
        fetch: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
      };
      stubs.push(stub);
      return stub;
    }),
  } as unknown as DurableObjectNamespace;
  return { binding, stubs, idFromName };
}

describe('merge-api auto-publish DO /reload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires DO /reload per auto-published document with the correct sessionId', async () => {
    const { executeMerge, getMergeRequest } = await import('../../src/services');

    (getMergeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'mr-1',
      sourceBranchId: 'branch-source',
      targetBranchId: 'main-branch',
      status: 'approved',
      title: 'Test',
    });
    (executeMerge as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mergeRequestId: 'mr-1',
      checkpointId: 'cp-1',
      documentsUpdated: 2,
      publishCheckpointId: 'cp-publish-1',
      publishedDocumentIds: ['doc-a', 'doc-b'],
    });

    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const { binding, stubs, idFromName } = buildMockBinding();

    const request = new Request(
      'http://localhost/api/sites/site-1/merge-requests/mr-1/execute',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );

    const response = await handleMergeRoutes(request, {
      siteId: 'site-1',
      executeRequest: true,
      mergeRequestId: 'mr-1',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      documentStateBinding: binding,
    });

    expect(response.status).toBe(200);

    // sessionId format: `${siteId}:${documentId}:${mainBranchId}`.
    expect(idFromName).toHaveBeenCalledWith('site-1:doc-a:main-branch');
    expect(idFromName).toHaveBeenCalledWith('site-1:doc-b:main-branch');

    // One DO fetch per published document, hitting /reload.
    expect(stubs).toHaveLength(2);
    for (const stub of stubs) {
      expect(stub.fetch).toHaveBeenCalledTimes(1);
      const callArg = stub.fetch.mock.calls[0]?.[0] as Request | undefined;
      expect(callArg?.method).toBe('POST');
      expect(callArg?.url).toBe('http://internal/reload');
    }
  });

  it('does NOT fire DO /reload when publishedDocumentIds is undefined (target was not main)', async () => {
    const { executeMerge, getMergeRequest } = await import('../../src/services');

    (getMergeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'mr-1',
      sourceBranchId: 'branch-source',
      targetBranchId: 'feature-branch-c',
      status: 'approved',
      title: 'Test',
    });
    (executeMerge as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mergeRequestId: 'mr-1',
      checkpointId: 'cp-1',
      documentsUpdated: 1,
      // No publishedDocumentIds — target wasn't main.
    });

    const { handleMergeRoutes } = await import('../../src/routes/merge-api');
    const { binding, stubs, idFromName } = buildMockBinding();

    const request = new Request(
      'http://localhost/api/sites/site-1/merge-requests/mr-1/execute',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );

    const response = await handleMergeRoutes(request, {
      siteId: 'site-1',
      executeRequest: true,
      mergeRequestId: 'mr-1',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      documentStateBinding: binding,
    });

    expect(response.status).toBe(200);
    expect(idFromName).not.toHaveBeenCalled();
    expect(stubs).toHaveLength(0);
  });

  it('swallows DO fetch errors and still returns the merge response', async () => {
    const { executeMerge, getMergeRequest } = await import('../../src/services');

    (getMergeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'mr-1',
      sourceBranchId: 'branch-source',
      targetBranchId: 'main-branch',
      status: 'approved',
      title: 'Test',
    });
    (executeMerge as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mergeRequestId: 'mr-1',
      checkpointId: 'cp-1',
      documentsUpdated: 1,
      publishedDocumentIds: ['doc-a'],
    });

    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    // Failing stub — fetch rejects.
    const stub: MockStub = {
      fetch: vi.fn().mockRejectedValue(new Error('DO unreachable')),
    };
    const binding = {
      idFromName: vi.fn((): { toString: () => string } => ({
        toString: (): string => 'fake',
      })),
      get: vi.fn((): MockStub => stub),
    } as unknown as DurableObjectNamespace;

    const request = new Request(
      'http://localhost/api/sites/site-1/merge-requests/mr-1/execute',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );

    const response = await handleMergeRoutes(request, {
      siteId: 'site-1',
      executeRequest: true,
      mergeRequestId: 'mr-1',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      documentStateBinding: binding,
    });

    // Merge response succeeds despite the failed reload.
    expect(response.status).toBe(200);
    expect(stub.fetch).toHaveBeenCalledTimes(1);
  });

  it('does nothing when documentStateBinding is not provided in context', async () => {
    const { executeMerge, getMergeRequest } = await import('../../src/services');

    (getMergeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'mr-1',
      sourceBranchId: 'branch-source',
      targetBranchId: 'main-branch',
      status: 'approved',
      title: 'Test',
    });
    (executeMerge as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mergeRequestId: 'mr-1',
      checkpointId: 'cp-1',
      documentsUpdated: 1,
      publishedDocumentIds: ['doc-a'],
    });

    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = new Request(
      'http://localhost/api/sites/site-1/merge-requests/mr-1/execute',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );

    const response = await handleMergeRoutes(request, {
      siteId: 'site-1',
      executeRequest: true,
      mergeRequestId: 'mr-1',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      // No documentStateBinding — handler must not throw.
    });

    expect(response.status).toBe(200);
  });
});
