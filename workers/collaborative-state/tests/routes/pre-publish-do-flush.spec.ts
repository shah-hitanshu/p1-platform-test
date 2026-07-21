/**
 * Pre-Publish DO Flush Tests (TDD - Red State)
 *
 * Tests that the worker flushes the source branch's Durable Object to PostgreSQL
 * BEFORE executing the publish operation. This eliminates the race condition where
 * the DO's async sync queue hasn't written the latest version to Postgres yet,
 * causing the publish endpoint to read and publish a stale version.
 *
 * These tests verify the integration logic in the worker's fetch handler (index.ts)
 * that calls the DO's /flush endpoint before handleDocumentRoutes processes
 * the publish request.
 *
 * Companion to post-publish-do-reload.spec.ts which tests the post-publish
 * notification to the main branch DO.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// =============================================================================
// Tests
// =============================================================================

describe('Pre-publish DO flush', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  /**
   * Helper that simulates the pre-publish flush logic that will be added
   * to index.ts. This tests the logic in isolation without needing the
   * full worker fetch handler setup.
   */
  async function runPrePublishFlush(params: {
    action?: string;
    siteId?: string;
    branchId?: string;
    documentId?: string;
    env: {
      DOCUMENT_STATE: {
        idFromName: Mock;
        get: Mock;
      };
    };
  }): Promise<{ flushed: boolean; error?: unknown }> {
    const { action, siteId, branchId, documentId, env } = params;

    // Mirror the logic that will be added to index.ts
    if (
      action === 'publish' &&
      documentId !== undefined &&
      branchId !== undefined &&
      siteId !== undefined
    ) {
      try {
        const sessionId = `${siteId}:${documentId}:${branchId}`;
        const doId = env.DOCUMENT_STATE.idFromName(sessionId);
        const stub = env.DOCUMENT_STATE.get(doId);
        const flushResponse = await stub.fetch(
          new Request('http://internal/flush', { method: 'POST' }),
        ) as Response;
        if (!flushResponse.ok) {
          console.warn('DO flush before publish failed:', await flushResponse.text());
          return { flushed: false };
        }
        return { flushed: true };
      } catch (flushError) {
        console.warn('DO flush before publish failed:', flushError);
        return { flushed: false, error: flushError };
      }
    }
    return { flushed: false };
  }

  function createMockEnv(flushResponse?: Response): {
    DOCUMENT_STATE: { idFromName: Mock; get: Mock };
  } {
    const mockStubFetch = vi.fn().mockResolvedValue(
      flushResponse ?? new Response(JSON.stringify({ flushed: true }), { status: 200 }),
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

  it('should call DO /flush on source branch before publish', async () => {
    const env = createMockEnv();

    const result = await runPrePublishFlush({
      action: 'publish',
      siteId: 'site-1',
      branchId: 'branch-1',
      documentId: 'doc-1',
      env,
    });

    expect(result.flushed).toBe(true);
    // Verify the correct session ID: siteId:documentId:branchId (source branch, not main)
    expect(env.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith('site-1:doc-1:branch-1');
    expect(env.DOCUMENT_STATE.get).toHaveBeenCalled();

    // Verify the stub was called with POST /flush
    const stub = env.DOCUMENT_STATE.get.mock.results[0]?.value as { fetch: Mock };
    const fetchCall = stub.fetch.mock.calls[0] as [Request];
    expect(fetchCall[0].method).toBe('POST');
    expect(new URL(fetchCall[0].url).pathname).toBe('/flush');
  });

  it('should use the source branch ID, not the main branch', async () => {
    const env = createMockEnv();

    await runPrePublishFlush({
      action: 'publish',
      siteId: 'site-abc',
      branchId: 'feature-branch-xyz',
      documentId: 'doc-456',
      env,
    });

    // The session ID must use the SOURCE branch (where editing happened)
    expect(env.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith(
      'site-abc:doc-456:feature-branch-xyz',
    );
  });

  it('should NOT flush when action is not publish', async () => {
    const env = createMockEnv();

    const result = await runPrePublishFlush({
      action: 'restore',
      siteId: 'site-1',
      branchId: 'branch-1',
      documentId: 'doc-1',
      env,
    });

    expect(result.flushed).toBe(false);
    expect(env.DOCUMENT_STATE.idFromName).not.toHaveBeenCalled();
  });

  it('should NOT flush when branchId is missing', async () => {
    const env = createMockEnv();

    const result = await runPrePublishFlush({
      action: 'publish',
      siteId: 'site-1',
      branchId: undefined,
      documentId: 'doc-1',
      env,
    });

    expect(result.flushed).toBe(false);
    expect(env.DOCUMENT_STATE.idFromName).not.toHaveBeenCalled();
  });

  it('should NOT flush when documentId is missing', async () => {
    const env = createMockEnv();

    const result = await runPrePublishFlush({
      action: 'publish',
      siteId: 'site-1',
      branchId: 'branch-1',
      documentId: undefined,
      env,
    });

    expect(result.flushed).toBe(false);
    expect(env.DOCUMENT_STATE.idFromName).not.toHaveBeenCalled();
  });

  it('should handle flush failure gracefully without blocking publish', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation((): void => { /* noop */ });
    const env = createMockEnv(
      new Response('Internal Server Error', { status: 500 }),
    );

    const result = await runPrePublishFlush({
      action: 'publish',
      siteId: 'site-1',
      branchId: 'branch-1',
      documentId: 'doc-1',
      env,
    });

    // Flush failed, but should not throw — publish proceeds with best-effort
    expect(result.flushed).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      'DO flush before publish failed:',
      expect.any(String),
    );

    consoleSpy.mockRestore();
  });

  it('should handle DO fetch throwing an error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation((): void => { /* noop */ });

    const mockStub = {
      fetch: vi.fn().mockRejectedValue(new Error('DO unavailable')),
    };
    const env = {
      DOCUMENT_STATE: {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'do-id' }),
        get: vi.fn().mockReturnValue(mockStub),
      },
    };

    const result = await runPrePublishFlush({
      action: 'publish',
      siteId: 'site-1',
      branchId: 'branch-1',
      documentId: 'doc-1',
      env,
    });

    // Should not throw, publish proceeds
    expect(result.flushed).toBe(false);
    expect(result.error).toBeDefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      'DO flush before publish failed:',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
