/**
 * Internal Publish API Route Tests
 *
 * Tests for POST /internal/publish endpoint.
 * Called by Durable Objects to publish a document after flushing CRDT state.
 * Uses X-Internal-Secret header for authentication.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock checkpoint service
vi.mock('../../src/services/checkpoint-service', () => ({
  publishDocument: vi.fn(),
  BranchNotFoundError: class BranchNotFoundError extends Error {
    name = 'BranchNotFoundError';
    branchId: string;
    constructor(branchId: string) {
      super(`Branch with ID "${branchId}" not found.`);
      this.branchId = branchId;
    }
  },
  CheckpointNotFoundError: class CheckpointNotFoundError extends Error {
    name = 'CheckpointNotFoundError';
    checkpointId: string;
    constructor(checkpointId: string) {
      super(`Checkpoint with ID "${checkpointId}" not found.`);
      this.checkpointId = checkpointId;
    }
  },
  InvalidCheckpointParamsError: class InvalidCheckpointParamsError extends Error {
    name = 'InvalidCheckpointParamsError';
  },
  // Stubs needed for the module to load (re-exported by internal-api)
  createCheckpoint: vi.fn(),
  revertToCheckpoint: vi.fn(),
}));

// Mock crdt-sync-service (needed by internal-api.ts import)
vi.mock('../../src/services/crdt-sync-service', () => ({
  syncCrdtToPostgres: vi.fn(),
  loadLatestCrdtState: vi.fn(),
  DocumentNotFoundError: class DocumentNotFoundError extends Error {
    name = 'DocumentNotFoundError';
    documentId: string;
    constructor(docId: string) {
      super(`Document "${docId}" not found.`);
      this.documentId = docId;
    }
  },
  SyncError: class SyncError extends Error {
    override name = 'SyncError';
  },
}));

describe('Internal Publish API', () => {
  const INTERNAL_SECRET = 'test-internal-secret';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Helper to create a request with the internal secret header
  function createRequest(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      secret?: string;
    } = {},
  ): Request {
    const { method = 'POST', body, secret = INTERNAL_SECRET } = options;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (secret) {
      headers['X-Internal-Secret'] = secret;
    }
    return new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  // Valid publish request body
  function createValidPublishBody(overrides: Partial<{
    siteId: string;
    branchId: string;
    documentId: string;
    createdById: string;
    createdByType: string;
  }> = {}): Record<string, string> {
    return {
      siteId: 'site-uuid-123',
      branchId: 'branch-uuid-456',
      documentId: 'doc-uuid-789',
      createdById: 'user-uuid-abc',
      createdByType: 'user',
      ...overrides,
    };
  }

  describe('POST /internal/publish', () => {
    it('should return 401 without X-Internal-Secret', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const request = createRequest('/internal/publish', { secret: '' });
      const response = await handleInternalRoutes(request, { internalSecret: INTERNAL_SECRET });

      expect(response.status).toBe(401);
    });

    it('should return 403 with wrong X-Internal-Secret', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const request = createRequest('/internal/publish', { secret: 'wrong-secret' });
      const response = await handleInternalRoutes(request, { internalSecret: INTERNAL_SECRET });

      expect(response.status).toBe(403);
    });

    it('should return 405 for non-POST methods', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const request = createRequest('/internal/publish', { method: 'GET' });
      const response = await handleInternalRoutes(request, { internalSecret: INTERNAL_SECRET });

      expect(response.status).toBe(405);
    });

    it('should return 400 for invalid JSON body', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const request = new Request('http://localhost/internal/publish', {
        method: 'POST',
        headers: {
          'X-Internal-Secret': INTERNAL_SECRET,
          'Content-Type': 'application/json',
        },
        body: 'not-json',
      });
      const response = await handleInternalRoutes(request, { internalSecret: INTERNAL_SECRET });

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing siteId', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const body = createValidPublishBody({ siteId: '' });
      const request = createRequest('/internal/publish', { body });
      const response = await handleInternalRoutes(request, { internalSecret: INTERNAL_SECRET });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain('siteId');
    });

    it('should return 400 for missing branchId', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const body = createValidPublishBody({ branchId: '' });
      const request = createRequest('/internal/publish', { body });
      const response = await handleInternalRoutes(request, { internalSecret: INTERNAL_SECRET });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain('branchId');
    });

    it('should return 400 for missing documentId', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const body = createValidPublishBody({ documentId: '' });
      const request = createRequest('/internal/publish', { body });
      const response = await handleInternalRoutes(request, { internalSecret: INTERNAL_SECRET });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain('documentId');
    });

    it('should return 400 for missing createdById', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const body = createValidPublishBody({ createdById: '' });
      const request = createRequest('/internal/publish', { body });
      const response = await handleInternalRoutes(request, { internalSecret: INTERNAL_SECRET });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain('createdById');
    });

    it('should return 400 for invalid createdByType', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const body = createValidPublishBody({ createdByType: 'invalid' });
      const request = createRequest('/internal/publish', { body });
      const response = await handleInternalRoutes(request, { internalSecret: INTERNAL_SECRET });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain('createdByType');
    });

    it('should call publishDocument with correct params and return result', async () => {
      const { publishDocument } = await import('../../src/services/checkpoint-service');
      const mockResult = {
        checkpoint: {
          id: 'cp-1',
          branchId: 'main-branch',
          name: 'Publish: document',
          checkpointType: 'publish',
          status: 'completed',
          createdById: 'user-uuid-abc',
          createdByType: 'user',
          createdAt: new Date().toISOString(),
          documentCount: 1,
        },
        publishedVersionId: 'version-xyz',
        sourceBranchName: 'my-feature-branch',
      };
      vi.mocked(publishDocument).mockResolvedValue(mockResult as never);

      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const body = createValidPublishBody();
      const request = createRequest('/internal/publish', { body });
      const response = await handleInternalRoutes(request, { internalSecret: INTERNAL_SECRET });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.checkpoint.id).toBe('cp-1');
      expect(json.publishedVersionId).toBe('version-xyz');
      expect(json.sourceBranchName).toBe('my-feature-branch');

      expect(publishDocument).toHaveBeenCalledWith({
        siteId: 'site-uuid-123',
        branchId: 'branch-uuid-456',
        documentId: 'doc-uuid-789',
        createdById: 'user-uuid-abc',
        createdByType: 'user',
      });
    });

    it('should accept createdByType "agent"', async () => {
      const { publishDocument } = await import('../../src/services/checkpoint-service');
      vi.mocked(publishDocument).mockResolvedValue({
        checkpoint: { id: 'cp-1' },
        publishedVersionId: 'v-1',
      } as never);

      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const body = createValidPublishBody({ createdByType: 'agent' });
      const request = createRequest('/internal/publish', { body });
      const response = await handleInternalRoutes(request, { internalSecret: INTERNAL_SECRET });

      expect(response.status).toBe(200);
      expect(publishDocument).toHaveBeenCalledWith(
        expect.objectContaining({ createdByType: 'agent' }),
      );
    });

    it('should return 500 when publishDocument throws', async () => {
      const { publishDocument } = await import('../../src/services/checkpoint-service');
      vi.mocked(publishDocument).mockRejectedValue(new Error('DB connection failed'));

      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const body = createValidPublishBody();
      const request = createRequest('/internal/publish', { body });
      const response = await handleInternalRoutes(request, { internalSecret: INTERNAL_SECRET });

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.error).toContain('Publish failed');
    });

    it('should return 404 when document has no versions', async () => {
      const { publishDocument } = await import('../../src/services/checkpoint-service');
      vi.mocked(publishDocument).mockRejectedValue(
        new Error('Document with ID "doc-uuid-789" not found'),
      );

      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const body = createValidPublishBody();
      const request = createRequest('/internal/publish', { body });
      const response = await handleInternalRoutes(request, { internalSecret: INTERNAL_SECRET });

      // The generic error handler should return 500 for unrecognized errors
      expect(response.status).toBe(500);
    });
  });
});
