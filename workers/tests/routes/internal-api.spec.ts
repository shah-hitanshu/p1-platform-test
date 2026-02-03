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
    documentId: string;
    constructor(path: string) {
      super(`Document at path "${path}" not found.`);
      this.documentId = path;
    }
  },
  SyncError: class SyncError extends Error {
    override name = 'SyncError';
  },
}));

// Mock checkpoint service
vi.mock('../../src/services/checkpoint-service', () => ({
  createCheckpoint: vi.fn(),
  revertToCheckpoint: vi.fn(),
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
    documentId: string;
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
      documentId: 'pages/home',
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
        documentId: syncBody.documentId,
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
        body: JSON.stringify(createValidSyncBody({ documentId: 'pages/missing' })),
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

    it('should require documentId', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const request = new Request('http://localhost/internal/crdt-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify(createValidSyncBody({ documentId: '' })),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('documentId');
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

  // =============================================================================
  // Agent Checkpoint API Tests (Agent Politeness Protocol)
  // =============================================================================

  describe('POST /internal/agent-checkpoint-start', () => {
    // Request body type
    interface AgentCheckpointStartBody {
      branchId: string;
      agentId: string;
      intent: string;
      trigger: 'human_requested' | 'autonomous';
      targetRegions?: string[];
    }

    function createValidStartBody(overrides: Partial<AgentCheckpointStartBody> = {}): AgentCheckpointStartBody {
      return {
        branchId: 'branch-uuid-123',
        agentId: 'agent-uuid-456',
        intent: 'Update hero section',
        trigger: 'autonomous',
        targetRegions: ['root.hero'],
        ...overrides,
      };
    }

    it('should create a checkpoint before agent edits', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const checkpointService = await import('../../src/services/checkpoint-service');

      const mockCheckpoint = {
        id: 'checkpoint-uuid-789',
        branchId: 'branch-uuid-123',
        checkpointType: 'agent_pre_edit' as const,
        createdById: 'agent-uuid-456',
        createdByType: 'agent' as const,
        createdAt: '2026-01-28T10:00:00.000Z',
        trigger: 'autonomous' as const,
        description: 'Pre-edit checkpoint: Update hero section',
        affectedRegions: ['root.hero'],
        status: 'completed' as const,
      };

      vi.mocked(checkpointService.createCheckpoint).mockResolvedValue({
        checkpoint: mockCheckpoint,
        documentCount: 3,
      });

      const body = createValidStartBody();
      const request = new Request('http://localhost/internal/agent-checkpoint-start', {
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

      expect(response.status).toBe(200);
      const responseBody = await response.json();
      expect(responseBody.checkpointId).toBe('checkpoint-uuid-789');

      expect(checkpointService.createCheckpoint).toHaveBeenCalledWith({
        branchId: 'branch-uuid-123',
        checkpointType: 'agent_pre_edit',
        createdById: 'agent-uuid-456',
        createdByType: 'agent',
        description: 'Pre-edit checkpoint: Update hero section',
        trigger: 'autonomous',
        affectedRegions: ['root.hero'],
      });
    });

    it('should require branchId', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const body = createValidStartBody({ branchId: '' });
      const request = new Request('http://localhost/internal/agent-checkpoint-start', {
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
      expect(responseBody.error).toContain('branchId');
    });

    it('should require agentId', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const body = createValidStartBody({ agentId: '' });
      const request = new Request('http://localhost/internal/agent-checkpoint-start', {
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
      expect(responseBody.error).toContain('agentId');
    });

    it('should require intent', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const body = createValidStartBody({ intent: '' });
      const request = new Request('http://localhost/internal/agent-checkpoint-start', {
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
      expect(responseBody.error).toContain('intent');
    });

    it('should return 404 when branch not found', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const checkpointService = await import('../../src/services/checkpoint-service');

      vi.mocked(checkpointService.createCheckpoint).mockRejectedValue(
        new checkpointService.BranchNotFoundError('branch-uuid-missing'),
      );

      const body = createValidStartBody({ branchId: 'branch-uuid-missing' });
      const request = new Request('http://localhost/internal/agent-checkpoint-start', {
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

      expect(response.status).toBe(404);
      const responseBody = await response.json();
      expect(responseBody.error).toContain('Branch');
    });
  });

  describe('POST /internal/agent-checkpoint-complete', () => {
    interface AgentCheckpointCompleteBody {
      branchId: string;
      agentId: string;
      intent: string;
      preEditCheckpointId: string;
      affectedRegions?: string[];
    }

    function createValidCompleteBody(
      overrides: Partial<AgentCheckpointCompleteBody> = {},
    ): AgentCheckpointCompleteBody {
      return {
        branchId: 'branch-uuid-123',
        agentId: 'agent-uuid-456',
        intent: 'Update hero section',
        preEditCheckpointId: 'checkpoint-uuid-pre',
        affectedRegions: ['root.hero'],
        ...overrides,
      };
    }

    it('should create a checkpoint after agent edits', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const checkpointService = await import('../../src/services/checkpoint-service');

      const mockCheckpoint = {
        id: 'checkpoint-uuid-post',
        branchId: 'branch-uuid-123',
        checkpointType: 'agent_post_edit' as const,
        createdById: 'agent-uuid-456',
        createdByType: 'agent' as const,
        createdAt: '2026-01-28T10:05:00.000Z',
        trigger: 'autonomous' as const,
        description: 'Post-edit checkpoint: Update hero section',
        affectedRegions: ['root.hero'],
        status: 'completed' as const,
      };

      vi.mocked(checkpointService.createCheckpoint).mockResolvedValue({
        checkpoint: mockCheckpoint,
        documentCount: 3,
      });

      const body = createValidCompleteBody();
      const request = new Request('http://localhost/internal/agent-checkpoint-complete', {
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

      expect(response.status).toBe(200);
      const responseBody = await response.json();
      expect(responseBody.checkpointId).toBe('checkpoint-uuid-post');

      expect(checkpointService.createCheckpoint).toHaveBeenCalledWith({
        branchId: 'branch-uuid-123',
        checkpointType: 'agent_post_edit',
        createdById: 'agent-uuid-456',
        createdByType: 'agent',
        description: 'Post-edit checkpoint: Update hero section',
        trigger: 'autonomous',
        affectedRegions: ['root.hero'],
      });
    });

    it('should require preEditCheckpointId', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const body = createValidCompleteBody({ preEditCheckpointId: '' });
      const request = new Request('http://localhost/internal/agent-checkpoint-complete', {
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
      expect(responseBody.error).toContain('preEditCheckpointId');
    });
  });

  describe('POST /internal/agent-checkpoint-rollback', () => {
    interface AgentCheckpointRollbackBody {
      checkpointId: string;
      agentId: string;
      reason?: string;
    }

    function createValidRollbackBody(
      overrides: Partial<AgentCheckpointRollbackBody> = {},
    ): AgentCheckpointRollbackBody {
      return {
        checkpointId: 'checkpoint-uuid-pre',
        agentId: 'agent-uuid-456',
        reason: 'User interrupted the agent',
        ...overrides,
      };
    }

    it('should rollback to pre-edit checkpoint', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const checkpointService = await import('../../src/services/checkpoint-service');

      const mockCheckpoint = {
        id: 'checkpoint-uuid-reverted',
        branchId: 'branch-uuid-123',
        checkpointType: 'manual' as const,
        createdById: 'agent-uuid-456',
        createdByType: 'agent' as const,
        createdAt: '2026-01-28T10:10:00.000Z',
        status: 'completed' as const,
      };

      vi.mocked(checkpointService.revertToCheckpoint).mockResolvedValue({
        checkpoint: mockCheckpoint,
        documentsReverted: 2,
      });

      const body = createValidRollbackBody();
      const request = new Request('http://localhost/internal/agent-checkpoint-rollback', {
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

      expect(response.status).toBe(200);
      const responseBody = await response.json();
      expect(responseBody.rolledBack).toBe(true);
      expect(responseBody.documentsReverted).toBe(2);

      expect(checkpointService.revertToCheckpoint).toHaveBeenCalledWith({
        checkpointId: 'checkpoint-uuid-pre',
        createdById: 'agent-uuid-456',
        createdByType: 'agent',
        message: 'User interrupted the agent',
      });
    });

    it('should require checkpointId', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');

      const body = createValidRollbackBody({ checkpointId: '' });
      const request = new Request('http://localhost/internal/agent-checkpoint-rollback', {
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
      expect(responseBody.error).toContain('checkpointId');
    });

    it('should return 404 when checkpoint not found', async () => {
      const { handleInternalRoutes } = await import('../../src/routes/internal-api');
      const checkpointService = await import('../../src/services/checkpoint-service');

      vi.mocked(checkpointService.revertToCheckpoint).mockRejectedValue(
        new checkpointService.CheckpointNotFoundError('checkpoint-uuid-missing'),
      );

      const body = createValidRollbackBody({ checkpointId: 'checkpoint-uuid-missing' });
      const request = new Request('http://localhost/internal/agent-checkpoint-rollback', {
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

      expect(response.status).toBe(404);
      const responseBody = await response.json();
      expect(responseBody.error).toContain('Checkpoint');
    });
  });
});
