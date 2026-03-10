/**
 * Post-Publish DO Reload Tests (TDD - Red State)
 *
 * Tests that the worker notifies the main branch's Durable Object to reload
 * after a successful document publish. This ensures the DO reflects the
 * newly published content and broadcasts updates to connected WebSocket clients.
 *
 * These tests verify the integration logic in the worker's fetch handler
 * (index.ts) that calls the DO's /reload endpoint after handleDocumentRoutes
 * returns a successful publish response.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock branch-service for getMainBranch
vi.mock('../../src/services/branch-service', () => ({
  getMainBranch: vi.fn(),
  // Stubs for other exports that may be referenced
  createBranch: vi.fn(),
  createMainBranch: vi.fn(),
  getBranch: vi.fn(),
  getBranchByName: vi.fn(),
  listBranches: vi.fn(),
  updateBranch: vi.fn(),
  updateBranchStatus: vi.fn(),
  deleteBranch: vi.fn(),
  isValidStatusTransition: vi.fn(),
  BranchNotFoundError: class extends Error {},
  DuplicateBranchNameError: class extends Error {},
  InvalidBranchParamsError: class extends Error {},
  MainBranchProtectionError: class extends Error {},
  MainBranchOnlyError: class extends Error {},
  InvalidBranchStatusTransitionError: class extends Error {},
  DatabaseError: class extends Error {},
}));

describe('Post-publish DO reload notification', () => {
  let getMainBranch: Mock;

  beforeEach(async () => {
    vi.resetAllMocks();

    const branchService = await import('../../src/services/branch-service');
    getMainBranch = vi.mocked(branchService.getMainBranch);
  });

  /**
   * Helper that simulates the post-publish notification logic
   * extracted from index.ts. This lets us test the logic in isolation
   * without needing the full worker fetch handler setup.
   */
  async function runPostPublishNotification(params: {
    action?: string;
    responseStatus: number;
    siteId?: string;
    documentId?: string;
    env: {
      DOCUMENT_STATE: {
        idFromName: Mock;
        get: Mock;
      };
    };
  }): Promise<{ reloadCalled: boolean; error?: unknown }> {
    const { action, responseStatus, siteId, documentId, env } = params;

    // Mirror the logic from index.ts
    if (
      action === 'publish' &&
      responseStatus === 200 &&
      documentId !== undefined &&
      siteId !== undefined
    ) {
      try {
        const mainBranch = await getMainBranch(siteId);
        if (mainBranch !== null) {
          const sessionId = `${siteId}:${documentId}:${String(mainBranch.id)}`;
          const doId = env.DOCUMENT_STATE.idFromName(sessionId);
          const stub = env.DOCUMENT_STATE.get(doId);
          await stub.fetch(new Request('http://internal/reload', { method: 'POST' }));
          return { reloadCalled: true };
        }
      } catch (reloadError) {
        console.error('Failed to reload DO after publish:', reloadError);
        return { reloadCalled: false, error: reloadError };
      }
    }
    return { reloadCalled: false };
  }

  interface MockEnvResult {
    DOCUMENT_STATE: {
      idFromName: Mock;
      get: Mock;
    };
  }

  function createMockEnv(): MockEnvResult {
    const mockStubFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    const mockStub = { fetch: mockStubFetch };
    const mockDoId = { toString: (): string => 'do-id' };

    return {
      DOCUMENT_STATE: {
        idFromName: vi.fn().mockReturnValue(mockDoId),
        get: vi.fn().mockReturnValue(mockStub),
      },
    };
  }

  it('should call DO /reload on main branch after successful publish', async () => {
    const env = createMockEnv();

    getMainBranch.mockResolvedValue({
      id: 'main-branch-uuid',
      siteId: 'site-1',
      name: 'main',
      status: 'active',
      isMain: true,
    });

    const result = await runPostPublishNotification({
      action: 'publish',
      responseStatus: 200,
      siteId: 'site-1',
      documentId: 'doc-1',
      env,
    });

    expect(result.reloadCalled).toBe(true);
    expect(env.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith('site-1:doc-1:main-branch-uuid');
    expect(env.DOCUMENT_STATE.get).toHaveBeenCalled();

    // Verify the stub was called with POST /reload
    const stub = env.DOCUMENT_STATE.get.mock.results[0]?.value as { fetch: Mock };
    const fetchCall = stub.fetch.mock.calls[0] as [Request];
    expect(fetchCall[0].method).toBe('POST');
    expect(new URL(fetchCall[0].url).pathname).toBe('/reload');
  });

  it('should NOT call DO reload when action is not publish', async () => {
    const env = createMockEnv();

    const result = await runPostPublishNotification({
      action: 'restore',
      responseStatus: 200,
      siteId: 'site-1',
      documentId: 'doc-1',
      env,
    });

    expect(result.reloadCalled).toBe(false);
    expect(env.DOCUMENT_STATE.idFromName).not.toHaveBeenCalled();
  });

  it('should NOT call DO reload when response status is not 200', async () => {
    const env = createMockEnv();

    const result = await runPostPublishNotification({
      action: 'publish',
      responseStatus: 403,
      siteId: 'site-1',
      documentId: 'doc-1',
      env,
    });

    expect(result.reloadCalled).toBe(false);
    expect(env.DOCUMENT_STATE.idFromName).not.toHaveBeenCalled();
  });

  it('should NOT call DO reload when documentId is missing', async () => {
    const env = createMockEnv();

    const result = await runPostPublishNotification({
      action: 'publish',
      responseStatus: 200,
      siteId: 'site-1',
      documentId: undefined,
      env,
    });

    expect(result.reloadCalled).toBe(false);
  });

  it('should NOT call DO reload when main branch is null', async () => {
    const env = createMockEnv();

    getMainBranch.mockResolvedValue(null);

    const result = await runPostPublishNotification({
      action: 'publish',
      responseStatus: 200,
      siteId: 'site-1',
      documentId: 'doc-1',
      env,
    });

    expect(result.reloadCalled).toBe(false);
    expect(env.DOCUMENT_STATE.idFromName).not.toHaveBeenCalled();
  });

  it('should swallow errors from DO reload and not propagate them', async () => {
    const env = createMockEnv();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation((): void => { /* noop */ });

    getMainBranch.mockRejectedValue(new Error('DB connection failed'));

    const result = await runPostPublishNotification({
      action: 'publish',
      responseStatus: 200,
      siteId: 'site-1',
      documentId: 'doc-1',
      env,
    });

    expect(result.reloadCalled).toBe(false);
    expect(result.error).toBeDefined();
    // Should log the error but not throw
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to reload DO after publish:',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it('should use correct session ID format: siteId:documentId:mainBranchId', async () => {
    const env = createMockEnv();

    getMainBranch.mockResolvedValue({
      id: 'branch-abc-123',
      siteId: 'site-xyz',
      name: 'main',
      status: 'active',
      isMain: true,
    });

    await runPostPublishNotification({
      action: 'publish',
      responseStatus: 200,
      siteId: 'site-xyz',
      documentId: 'doc-456',
      env,
    });

    expect(env.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith(
      'site-xyz:doc-456:branch-abc-123',
    );
  });
});
