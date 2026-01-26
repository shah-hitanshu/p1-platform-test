/**
 * Phase 1.2: Internal API Routes Tests (TDD)
 *
 * Tests for the internal API endpoint for CRDT sync operations.
 * This endpoint is called by Durable Objects to persist state to PostgreSQL.
 *
 * Uses X-Internal-Secret header for authentication instead of user/agent tokens.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock CRDT sync service
vi.mock('../../src/services/crdt-sync-service', () => ({
  syncCrdtToPostgres: vi.fn(),
  DocumentNotFoundError: class DocumentNotFoundError extends Error {
    name = 'DocumentNotFoundError';
    documentPath: string;
    constructor(path: string) {
      super(`Document at path "${path}" not found.`);
      this.documentPath = path;
    }
  },
  SyncError: class SyncError extends Error {
    override name = 'SyncError';
  },
}));

describe('Phase 1.2: Internal API Routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // =============================================================================
  // Request body type for sync endpoint
  // =============================================================================

  interface CrdtSyncBody {
    siteId: string;
    documentPath: string;
    branchId: string;
    snapshot: Record<string, unknown>;
    crdtState: string;
    actorId: string;
    actorType: 'user' | 'agent';
  }

  // Helper to create a valid sync request body
  function createValidSyncBody(overrides: Partial<CrdtSyncBody> = {}): CrdtSyncBody {
    return {
      siteId: 'site-uuid-123',
      documentPath: 'pages/home',
      branchId: 'branch-uuid-456',
      snapshot: { root: { title: 'Test Document' } },
      crdtState: 'base64encodedcrdtstate==',
      actorId: 'user-uuid-789',
      actorType: 'user',
      ...overrides,
    };
  }

  // =============================================================================
  // Authentication Tests
  // =============================================================================

  describe('authentication', () => {
    it('should require X-Internal-Secret header', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createValidSyncBody()),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toContain('X-Internal-Secret');
    });

    it('should reject invalid X-Internal-Secret', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'wrong-secret',
        },
        body: JSON.stringify(createValidSyncBody()),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('Invalid');
    });

    it('should accept valid X-Internal-Secret', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const crdtSyncService = await import('../../src/services/crdt-sync-service');

      vi.mocked(crdtSyncService.syncCrdtToPostgres).mockResolvedValue({
        id: 'version-uuid',
        documentId: 'doc-uuid',
        branchId: 'branch-uuid-456',
        versionNumber: 1,
        snapshot: { root: { title: 'Test' } },
        crdtState: 'base64==',
        source: 'realtime',
        createdById: 'user-uuid-789',
        createdByType: 'user',
        createdAt: '2026-01-25T10:00:00.000Z',
      });

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify(createValidSyncBody()),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(200);
    });
  });

  // =============================================================================
  // POST /internal/crdt-sync Tests
  // =============================================================================

  describe('POST /internal/crdt-sync', () => {
    it('should call syncCrdtToPostgres with correct parameters', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const crdtSyncService = await import('../../src/services/crdt-sync-service');

      vi.mocked(crdtSyncService.syncCrdtToPostgres).mockResolvedValue({
        id: 'version-uuid',
        documentId: 'doc-uuid',
        branchId: 'branch-uuid-456',
        versionNumber: 1,
        snapshot: { root: { title: 'Test' } },
        crdtState: 'base64==',
        source: 'realtime',
        createdById: 'user-uuid-789',
        createdByType: 'user',
        createdAt: '2026-01-25T10:00:00.000Z',
      });

      const syncBody = createValidSyncBody();
      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify(syncBody),
      });

      await handleInternalRoutes(request, { internalSecret: 'correct-secret' });

      expect(crdtSyncService.syncCrdtToPostgres).toHaveBeenCalledWith({
        siteId: syncBody.siteId,
        documentPath: syncBody.documentPath,
        branchId: syncBody.branchId,
        snapshot: syncBody.snapshot,
        crdtState: syncBody.crdtState,
        actorId: syncBody.actorId,
        actorType: syncBody.actorType,
      });
    });

    it('should return created version on success', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const crdtSyncService = await import('../../src/services/crdt-sync-service');

      const mockVersion = {
        id: 'version-uuid',
        documentId: 'doc-uuid',
        branchId: 'branch-uuid-456',
        versionNumber: 5,
        snapshot: { root: { title: 'Test' } },
        crdtState: 'base64==',
        source: 'realtime' as const,
        createdById: 'user-uuid-789',
        createdByType: 'user' as const,
        createdAt: '2026-01-25T10:00:00.000Z',
      };

      vi.mocked(crdtSyncService.syncCrdtToPostgres).mockResolvedValue(mockVersion);

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify(createValidSyncBody()),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version).toBeDefined();
      expect(body.version.id).toBe('version-uuid');
      expect(body.version.versionNumber).toBe(5);
    });

    it('should return 404 when document not found', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const crdtSyncService = await import('../../src/services/crdt-sync-service');

      vi.mocked(crdtSyncService.syncCrdtToPostgres).mockRejectedValue(
        new crdtSyncService.DocumentNotFoundError('pages/missing'),
      );

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify(createValidSyncBody({ documentPath: 'pages/missing' })),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('Document');
    });

    it('should return 500 on sync error', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const crdtSyncService = await import('../../src/services/crdt-sync-service');

      vi.mocked(crdtSyncService.syncCrdtToPostgres).mockRejectedValue(
        new crdtSyncService.SyncError('Database connection failed'),
      );

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify(createValidSyncBody()),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toContain('Sync');
    });
  });

  // =============================================================================
  // Request Validation Tests
  // =============================================================================

  describe('request validation', () => {
    it('should require siteId', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify(createValidSyncBody({ siteId: '' })),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('siteId');
    });

    it('should require documentPath', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify(createValidSyncBody({ documentPath: '' })),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('documentPath');
    });

    it('should require branchId', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify(createValidSyncBody({ branchId: '' })),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('branchId');
    });

    it('should require crdtState', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify(createValidSyncBody({ crdtState: '' })),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('crdtState');
    });

    it('should require actorId', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify(createValidSyncBody({ actorId: '' })),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('actorId');
    });

    it('should require valid actorType', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const body = createValidSyncBody();
      (body as { actorType: string }).actorType = 'invalid';

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify(body),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(400);
      const responseBody = await response.json();
      expect(responseBody.error).toContain('actorType');
    });

    it('should handle malformed JSON', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: 'not valid json',
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('JSON');
    });
  });

  // =============================================================================
  // Routing Tests
  // =============================================================================

  describe('routing', () => {
    it('should only accept POST method', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const methods = ['GET', 'PUT', 'PATCH', 'DELETE'];

      for (const method of methods) {
        const request = new Request('http://localhost/internal/crdt-sync', {
          method,
          headers: {
            'X-Internal-Secret': 'correct-secret',
          },
        });

        const response = await handleInternalRoutes(request, {
          internalSecret: 'correct-secret',
        });

        expect(response.status).toBe(405);
      }
    });

    it('should return 404 for unknown paths', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const request = new Request('http://localhost/internal/unknown', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify({}),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(404);
    });
  });
});
