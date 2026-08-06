/**
 * Phase 1.2: Internal API Routes Tests (TDD)
 *
 * Tests for the internal API endpoint for CRDT sync operations.
 * This endpoint is called by Durable Objects to persist state to PostgreSQL.
 *
 * Uses X-Internal-Secret header for authentication instead of user/agent tokens.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSiteAllowedOrigins } from '../../src/services/site-service';
import type { Site } from '../../src/types/domain';
import { readJson } from '../helpers/http';
import { makePrincipal } from '../helpers/principal';
import { makeBranch } from '../helpers/branch';

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

// Mock site service
vi.mock('../../src/services/site-service', () => ({
  getSiteAllowedOrigins: vi.fn(),
}));

// Mock services barrel (used by site-api.ts) — only for T5 round-trip scenario
vi.mock('../../src/services', () => ({
  createSite: vi.fn(),
  getSite: vi.fn(),
  updateSite: vi.fn(),
  deleteSite: vi.fn(),
  listSites: vi.fn(),
  listBranches: vi.fn(),
  createMainBranch: vi.fn(),
  getMainBranch: vi.fn(),
  DuplicatePantheonSiteIdError: class DuplicatePantheonSiteIdError extends Error {
    name = 'DuplicatePantheonSiteIdError';
  },
  InvalidSiteParamsError: class InvalidSiteParamsError extends Error {
    override name = 'InvalidSiteParamsError';
  },
}));

// Mock authorization (used by site-api.ts) — only for T5 round-trip scenario
vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  getSiteRole: vi.fn().mockResolvedValue('ADMIN'),
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
      const body = await readJson(response);
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
      const body = await readJson(response);
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
      const body = await readJson(response);
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
      const body = await readJson(response);
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
      const body = await readJson(response);
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
      const body = await readJson(response);
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
      const body = await readJson(response);
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
      const body = await readJson(response);
      expect(body.error).toContain('branchId');
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
      const body = await readJson(response);
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
      const responseBody = await readJson(response);
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
      const body = await readJson(response);
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
        checkpointType: 'session_pre_edit' as const,
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
      const responseBody = await readJson(response);
      expect(responseBody.checkpointId).toBe('checkpoint-uuid-789');

      expect(checkpointService.createCheckpoint).toHaveBeenCalledWith({
        branchId: 'branch-uuid-123',
        checkpointType: 'session_pre_edit',
        createdById: 'agent-uuid-456',
        createdByType: 'agent',
        description: 'Pre-edit checkpoint: Update hero section',
        trigger: 'autonomous',
        affectedRegions: ['root.hero'],
        forceFullSnapshot: false,
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
      const responseBody = await readJson(response);
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
      const responseBody = await readJson(response);
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
      const responseBody = await readJson(response);
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
      const responseBody = await readJson(response);
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
        checkpointType: 'session_post_edit' as const,
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
      const responseBody = await readJson(response);
      expect(responseBody.checkpointId).toBe('checkpoint-uuid-post');

      expect(checkpointService.createCheckpoint).toHaveBeenCalledWith({
        branchId: 'branch-uuid-123',
        checkpointType: 'session_post_edit',
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
      const responseBody = await readJson(response);
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
      const responseBody = await readJson(response);
      expect(responseBody.rolledBack).toBe(true);
      expect(responseBody.documentsReverted).toBe(2);

      expect(checkpointService.revertToCheckpoint).toHaveBeenCalledWith({
        checkpointId: 'checkpoint-uuid-pre',
        createdById: 'agent-uuid-456',
        createdByType: 'agent',
        message: 'User interrupted the agent',
      });
    });

    it('should forward documentsSkipped from the revert result', async () => {
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
        documentsSkipped: 3,
      });

      const request = new Request('http://localhost/internal/agent-checkpoint-rollback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': 'correct-secret',
        },
        body: JSON.stringify(createValidRollbackBody()),
      });

      const response = await handleInternalRoutes(request, {
        internalSecret: 'correct-secret',
      });

      expect(response.status).toBe(200);
      const responseBody = await readJson(response);
      expect(responseBody.documentsSkipped).toBe(3);
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
      const responseBody = await readJson(response);
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
      const responseBody = await readJson(response);
      expect(responseBody.error).toContain('Checkpoint');
    });
  });
});

describe('GET /internal/site-auth-config/:siteId', () => {
  const INTERNAL_SECRET = 'correct-secret';

  function makeRequest(siteId: string, secret?: string): Request {
    return new Request(`http://localhost/internal/site-auth-config/${siteId}`, {
      method: 'GET',
      headers: secret !== undefined
        ? { 'X-Internal-Secret': secret }
        : {},
    });
  }

  it('returns 404 when site is not found', async () => {
    const { handleInternalRoutes } = await import('../../src/routes/internal-api');
    vi.mocked(getSiteAllowedOrigins).mockResolvedValueOnce(null);
    const req = makeRequest('missing-site', INTERNAL_SECRET);
    const res = await handleInternalRoutes(req, { internalSecret: INTERNAL_SECRET });
    expect(res.status).toBe(404);
  });

  it('returns 200 with allowedOrigins when site exists', async () => {
    const { handleInternalRoutes } = await import('../../src/routes/internal-api');
    vi.mocked(getSiteAllowedOrigins).mockResolvedValueOnce([
      'https://mysite.com',
      '*-mysite.pantheonsite.io',
    ]);
    const req = makeRequest('site-123', INTERNAL_SECRET);
    const res = await handleInternalRoutes(req, { internalSecret: INTERNAL_SECRET });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.siteId).toBe('site-123');
    expect(body.allowedOrigins).toEqual(['https://mysite.com', '*-mysite.pantheonsite.io']);
  });

  it('returns empty array when site has no allowed origins configured', async () => {
    const { handleInternalRoutes } = await import('../../src/routes/internal-api');
    vi.mocked(getSiteAllowedOrigins).mockResolvedValueOnce([]);
    const req = makeRequest('site-empty', INTERNAL_SECRET);
    const res = await handleInternalRoutes(req, { internalSecret: INTERNAL_SECRET });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.allowedOrigins).toEqual([]);
  });

  it('returns 500 when site service throws', async () => {
    const { handleInternalRoutes } = await import('../../src/routes/internal-api');
    vi.mocked(getSiteAllowedOrigins).mockRejectedValueOnce(new Error('DB down'));
    const req = makeRequest('site-1', INTERNAL_SECRET);
    const res = await handleInternalRoutes(req, { internalSecret: INTERNAL_SECRET });
    expect(res.status).toBe(500);
  });

  // T7d: auth tests for GET /internal/site-auth-config/:siteId
  it('returns 401 when X-Internal-Secret header is missing', async () => {
    const { handleInternalRoutes } = await import('../../src/routes/internal-api');
    const req = makeRequest('site-1'); // no secret argument → no header
    const res = await handleInternalRoutes(req, { internalSecret: INTERNAL_SECRET });
    expect(res.status).toBe(401);
  });

  it('returns 403 when X-Internal-Secret header is wrong', async () => {
    const { handleInternalRoutes } = await import('../../src/routes/internal-api');
    const req = makeRequest('site-1', 'wrong-secret');
    const res = await handleInternalRoutes(req, { internalSecret: INTERNAL_SECRET });
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// T5: allowedOrigins round-trip scenario
// =============================================================================

describe('T5: allowedOrigins round-trip — set via site API, propagates to internal auth config', () => {
  const INTERNAL_SECRET = 'correct-secret';

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('PATCH site with allowedOrigins → GET site returns field → GET /internal/site-auth-config returns value', async () => {
    const { handleSiteRoutes } = await import('../../src/routes/site-api');
    const { handleInternalRoutes } = await import('../../src/routes/internal-api');
    const services = await import('../../src/services');

    const updatedSite: Site = {
      id: 'site-t5',
      pantheonSiteId: 'pantheon-t5',
      name: 'T5 Site',
      allowedOrigins: ['https://mysite.com'],
      workflowSettings: {
        mergeApprovalMode: 'optional',
        minApprovers: 1,
        allowSelfApproval: true,
        approverMode: 'both',
        approverMinRole: 'EDITOR',
      },
      createdAt: '2026-04-07T00:00:00.000Z',
      updatedAt: '2026-04-07T00:00:00.000Z',
    };

    const mainBranch = makeBranch({
      id: 'main-branch-t5',
      siteId: 'site-t5',
      name: 'main',
      isMain: true,
      status: 'active',
      createdAt: '2026-04-07T00:00:00.000Z',
      createdById: 'user-1',
      createdByType: 'user',
    });

    // Step 1: PATCH /api/sites/site-t5 with allowedOrigins
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(mainBranch);
    vi.mocked(services.updateSite).mockResolvedValueOnce(updatedSite);

    const patchReq = new Request('https://api.example.com/api/sites/site-t5', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowedOrigins: ['https://mysite.com'] }),
    });
    const patchRes = await handleSiteRoutes(patchReq, {
      siteId: 'site-t5',
      principal: makePrincipal({ id: 'user-1', type: 'user' }),
    });
    expect(patchRes.status).toBe(200);

    // Step 2: GET /api/sites/site-t5 returns allowedOrigins field
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(mainBranch);
    vi.mocked(services.getSite).mockResolvedValueOnce(updatedSite);

    const getReq = new Request('https://api.example.com/api/sites/site-t5', {
      method: 'GET',
    });
    const getRes = await handleSiteRoutes(getReq, {
      siteId: 'site-t5',
      principal: makePrincipal({ id: 'user-1', type: 'user' }),
    });
    expect(getRes.status).toBe(200);
    const rawSiteBody: unknown = await getRes.json();
    const siteBody = rawSiteBody as Site;
    expect(siteBody.allowedOrigins).toEqual(['https://mysite.com']);

    // Step 3: GET /internal/site-auth-config/site-t5 returns correct allowedOrigins
    vi.mocked(getSiteAllowedOrigins).mockResolvedValueOnce(['https://mysite.com']);

    const internalReq = new Request(
      'http://localhost/internal/site-auth-config/site-t5',
      {
        method: 'GET',
        headers: { 'X-Internal-Secret': INTERNAL_SECRET },
      },
    );
    const internalRes = await handleInternalRoutes(internalReq, {
      internalSecret: INTERNAL_SECRET,
    });
    expect(internalRes.status).toBe(200);
    const rawAuthConfig: unknown = await internalRes.json();
    const authConfig = rawAuthConfig as { siteId: string; allowedOrigins: string[] };
    expect(authConfig.allowedOrigins).toEqual(['https://mysite.com']);
  });
});
