/**
 * Phase 0: Router Tests (TDD)
 *
 * Tests for API route wiring, CORS middleware, and authentication middleware.
 * Validates that all routes are properly connected and secured.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';

// Mock the database
vi.mock('../../src/db', () => ({
  initializeDatabaseFromConnectionString: vi.fn(),
  runWithConnection: vi.fn().mockImplementation((_connStr: string, _opts: unknown, fn: () => unknown) => fn()),
  query: vi.fn().mockResolvedValue({ rows: [{ now: new Date().toISOString() }] }),
}));

// Mock all route handlers
vi.mock('../../src/routes/site-api', () => ({
  handleSiteRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'site-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}));

vi.mock('../../src/routes/branch-api', () => ({
  handleBranchRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'branch-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}));

vi.mock('../../src/routes/document-api', () => ({
  handleDocumentRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'document-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}));

vi.mock('../../src/routes/checkpoint-api', () => ({
  handleCheckpointRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'checkpoint-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}));

vi.mock('../../src/routes/merge-api', () => ({
  handleMergeRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'merge-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}));

vi.mock('../../src/routes/grant-api', () => ({
  handleGrantRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'grant-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}));

vi.mock('../../src/routes/structure-api', () => ({
  handleStructureRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'structure-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}));

vi.mock('../../src/routes/node-api', () => ({
  handleNodeRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'node-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}));

vi.mock('../../src/routes/metadata-api', () => ({
  handleMetadataRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'metadata-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}));

vi.mock('../../src/routes/realtime-api', () => ({
  handleRealtimeRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'realtime-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}));

// Default mock principals for auth
const mockTokenPrincipal = {
  id: 'user-alice',
  type: 'user' as const,
  email: 'alice@example.com',
  authProvider: 'mock' as const,
  pantheonSiteRoles: { 'site-123': 'admin' },
  tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

const mockAgentPrincipal = {
  id: 'a0000000-0000-0000-0000-000000000001',
  type: 'agent' as const,
  authProvider: 'mock' as const,
  pantheonSiteRoles: { 'site-123': 'editor' },
  tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

// Mock the mock-identity-provider as a proper class
vi.mock('../../src/auth/mock-identity-provider', () => {
  return {
    MockIdentityProvider: class MockIdentityProvider {
      validateToken = vi.fn().mockResolvedValue({ ...mockTokenPrincipal });
      validateAgentKey = vi.fn().mockResolvedValue({ ...mockAgentPrincipal });
      getUser = vi.fn().mockReturnValue({
        id: 'user-alice',
        email: 'alice@example.com',
        name: 'Alice Developer',
        siteRoles: { 'site-123': 'admin' },
      });
      issueToken = vi.fn().mockResolvedValue('mock-jwt-token');
    },
  };
});

// Mock identity-provider to bypass JWT decode in canVerifyToken
interface MockProviderMethods {
  validateToken: (token: string) => Promise<AuthenticatedPrincipal | null>;
  validateAgentKey: (apiKey: string) => Promise<AuthenticatedPrincipal | null>;
}

vi.mock('../../src/auth/identity-provider', async () => {
  const actual = await vi.importActual<
        typeof import('../../src/auth/identity-provider')
          >('../../src/auth/identity-provider');
  return {
    ...actual,
    MockIdentityProviderAdapter: class MockIdentityProviderAdapter {
      name = 'mock' as const;
      private mockProvider: MockProviderMethods;
      constructor(mockProvider: MockProviderMethods) {
        this.mockProvider = mockProvider;
      }
      canVerifyToken(): boolean {
        // Always accept tokens in test — real JWT decode is not needed
        return true;
      }
      async validateToken(token: string): Promise<AuthenticatedPrincipal | null> {
        const principal = await this.mockProvider.validateToken(token);
        if (principal !== null) {
          principal.authProvider = 'mock';
        }
        return principal;
      }
      async validateAgentKey(apiKey: string): Promise<AuthenticatedPrincipal | null> {
        const principal = await this.mockProvider.validateAgentKey(apiKey);
        if (principal !== null) {
          principal.authProvider = 'mock';
        }
        return principal;
      }
    },
  };
});

describe('Phase 0: Router and Middleware', () => {
  // Mock environment
  const mockEnv = {
    ENVIRONMENT: 'local',
    LOG_LEVEL: 'debug',
    CORS_ORIGINS: 'http://localhost:5173,http://localhost:3000',
    WEBSOCKET_HEARTBEAT_INTERVAL: '30000',
    DOCUMENT_SYNC_BATCH_SIZE: '50',
    PRESENCE_TTL_SECONDS: '300',
    POSTGRES_CONNECTION_STRING: 'postgres://test:test@localhost:5432/test',
    FIRESTORE_PROJECT_ID: 'test-project',
    MOCK_JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    DOCUMENT_STATE: {} as DurableObjectNamespace,
    PRESENCE: {} as DurableObjectNamespace,
    SESSION: {} as DurableObjectNamespace,
    CONFIG_KV: {} as KVNamespace,
    SESSION_KV: {} as KVNamespace,
  };

  const mockContext: ExecutionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Health Check (existing, should still work)
  // ===========================================================================

  describe('GET /health', () => {
    it('should return health status', async () => {
      const module = await import('../../src/index');

      const request = new Request('https://api.example.com/health');
      const response = await module.default.fetch(request, mockEnv, mockContext);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('healthy');
    });
  });

  // ===========================================================================
  // CORS Middleware
  // ===========================================================================

  describe('CORS Middleware', () => {
    it('should add CORS headers to responses for allowed origins', async () => {
      const module = await import('../../src/index');

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
        headers: {
          'Origin': 'http://localhost:5173',
          'Authorization': 'Bearer mock-jwt-token',
        },
      });

      const response = await module.default.fetch(request, mockEnv, mockContext);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('should handle OPTIONS preflight requests', async () => {
      const module = await import('../../src/index');

      const request = new Request('https://api.example.com/api/sites', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      });

      const response = await module.default.fetch(request, mockEnv, mockContext);

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    });

    it('should not add CORS headers for disallowed origins', async () => {
      const module = await import('../../src/index');

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
        headers: {
          'Origin': 'https://malicious.com',
          'Authorization': 'Bearer mock-jwt-token',
        },
      });

      const response = await module.default.fetch(request, mockEnv, mockContext);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  // ===========================================================================
  // Authentication Middleware
  // ===========================================================================

  describe('Authentication Middleware', () => {
    it('should authenticate requests with valid JWT Bearer token', async () => {
      const module = await import('../../src/index');
      const siteApi = await import('../../src/routes/site-api');

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer valid-jwt-token',
        },
      });

      const response = await module.default.fetch(request, mockEnv, mockContext);

      expect(response.status).toBe(200);
      expect(siteApi.handleSiteRoutes).toHaveBeenCalled();
    });

    it('should authenticate requests with valid X-API-Key', async () => {
      const module = await import('../../src/index');
      const siteApi = await import('../../src/routes/site-api');

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-agent-key-zappy',
        },
      });

      const response = await module.default.fetch(request, mockEnv, mockContext);

      expect(response.status).toBe(200);
      expect(siteApi.handleSiteRoutes).toHaveBeenCalled();
    });

    it('should return 401 for requests without authentication', async () => {
      const module = await import('../../src/index');

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
        // No Authorization header, no API key — should be 401
      });

      const response = await module.default.fetch(request, mockEnv, mockContext);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toContain('Authentication');
    });

    it('should return 401 for invalid Bearer token', async () => {
      // Mock the adapter's validateToken to return null for this test
      const identityModule = await import('../../src/auth/identity-provider');
      const origAdapter = identityModule.MockIdentityProviderAdapter;
      const adapterProto = origAdapter.prototype;
      const spy = vi.spyOn(adapterProto, 'validateToken').mockResolvedValueOnce(null);

      const module = await import('../../src/index');

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer invalid-token',
        },
      });

      const response = await module.default.fetch(request, mockEnv, mockContext);

      expect(response.status).toBe(401);
      spy.mockRestore();
    });

    it('should skip authentication for health endpoint', async () => {
      const module = await import('../../src/index');

      const request = new Request('https://api.example.com/health', {
        method: 'GET',
      });

      const response = await module.default.fetch(request, mockEnv, mockContext);

      expect(response.status).toBe(200);
    });
  });

  // ===========================================================================
  // Route Wiring - Sites
  // ===========================================================================

  describe('Site Routes', () => {
    it('should route GET /api/sites to site handler', async () => {
      const module = await import('../../src/index');
      const siteApi = await import('../../src/routes/site-api');

      const request = new Request('https://api.example.com/api/sites', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token' },
      });

      await module.default.fetch(request, mockEnv, mockContext);

      expect(siteApi.handleSiteRoutes).toHaveBeenCalled();
      const [, context] = vi.mocked(siteApi.handleSiteRoutes).mock.calls[0];
      expect(context.principal).toBeDefined();
      expect(context.siteId).toBeUndefined();
    });

    it('should route GET /api/sites/{siteId} to site handler with siteId', async () => {
      const module = await import('../../src/index');
      const siteApi = await import('../../src/routes/site-api');

      const request = new Request('https://api.example.com/api/sites/site-123', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token' },
      });

      await module.default.fetch(request, mockEnv, mockContext);

      expect(siteApi.handleSiteRoutes).toHaveBeenCalled();
      const [, context] = vi.mocked(siteApi.handleSiteRoutes).mock.calls[0];
      expect(context.siteId).toBe('site-123');
    });
  });

  // ===========================================================================
  // Route Wiring - Branches
  // ===========================================================================

  describe('Branch Routes', () => {
    it('should route GET /api/sites/{siteId}/branches to branch handler', async () => {
      const module = await import('../../src/index');
      const branchApi = await import('../../src/routes/branch-api');

      const request = new Request('https://api.example.com/api/sites/site-123/branches', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token' },
      });

      await module.default.fetch(request, mockEnv, mockContext);

      expect(branchApi.handleBranchRoutes).toHaveBeenCalled();
      const [, context] = vi.mocked(branchApi.handleBranchRoutes).mock.calls[0];
      expect(context.siteId).toBe('site-123');
      expect(context.branchId).toBeUndefined();
    });

    it('should route GET /api/sites/{siteId}/branches/{branchId} to branch handler', async () => {
      const module = await import('../../src/index');
      const branchApi = await import('../../src/routes/branch-api');

      const request = new Request('https://api.example.com/api/sites/site-123/branches/branch-456', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token' },
      });

      await module.default.fetch(request, mockEnv, mockContext);

      expect(branchApi.handleBranchRoutes).toHaveBeenCalled();
      const [, context] = vi.mocked(branchApi.handleBranchRoutes).mock.calls[0];
      expect(context.siteId).toBe('site-123');
      expect(context.branchId).toBe('branch-456');
    });
  });

  // ===========================================================================
  // Route Wiring - Documents
  // ===========================================================================

  describe('Document Routes', () => {
    it('should route GET /api/sites/{siteId}/documents to document handler', async () => {
      const module = await import('../../src/index');
      const documentApi = await import('../../src/routes/document-api');

      const request = new Request('https://api.example.com/api/sites/site-123/documents', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token' },
      });

      await module.default.fetch(request, mockEnv, mockContext);

      expect(documentApi.handleDocumentRoutes).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Route Wiring - Checkpoints
  // ===========================================================================

  describe('Checkpoint Routes', () => {
    it('should route GET /api/sites/{siteId}/branches/{branchId}/checkpoints to checkpoint handler', async () => {
      const module = await import('../../src/index');
      const checkpointApi = await import('../../src/routes/checkpoint-api');

      const request = new Request('https://api.example.com/api/sites/site-123/branches/branch-456/checkpoints', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token' },
      });

      await module.default.fetch(request, mockEnv, mockContext);

      expect(checkpointApi.handleCheckpointRoutes).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Route Wiring - Merge
  // ===========================================================================

  describe('Merge Routes', () => {
    it('should route POST /api/sites/{siteId}/merge-requests to merge handler', async () => {
      const module = await import('../../src/index');
      const mergeApi = await import('../../src/routes/merge-api');

      const request = new Request('https://api.example.com/api/sites/site-123/merge-requests', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sourceBranchId: 'branch-1', targetBranchId: 'branch-2' }),
      });

      await module.default.fetch(request, mockEnv, mockContext);

      expect(mergeApi.handleMergeRoutes).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Route Wiring - Grants
  // ===========================================================================

  describe('Grant Routes', () => {
    it('should route GET /api/sites/{siteId}/branches/{branchId}/grants to grant handler', async () => {
      const module = await import('../../src/index');
      const grantApi = await import('../../src/routes/grant-api');

      const request = new Request('https://api.example.com/api/sites/site-123/branches/branch-456/grants', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token' },
      });

      await module.default.fetch(request, mockEnv, mockContext);

      expect(grantApi.handleGrantRoutes).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Route Wiring - Structures
  // ===========================================================================

  describe('Structure Routes', () => {
    it('should route GET /api/sites/{siteId}/branches/{branchId}/structures to structure handler', async () => {
      const module = await import('../../src/index');
      const structureApi = await import('../../src/routes/structure-api');

      const request = new Request('https://api.example.com/api/sites/site-123/branches/branch-456/structures', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token' },
      });

      await module.default.fetch(request, mockEnv, mockContext);

      expect(structureApi.handleStructureRoutes).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Route Wiring - Nodes
  // ===========================================================================

  describe('Node Routes', () => {
    it('should route GET /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes to node handler', async () => {
      const module = await import('../../src/index');
      const nodeApi = await import('../../src/routes/node-api');

      const request = new Request('https://api.example.com/api/sites/site-123/branches/branch-456/structures/struct-789/nodes', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token' },
      });

      await module.default.fetch(request, mockEnv, mockContext);

      expect(nodeApi.handleNodeRoutes).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Route Wiring - Metadata
  // ===========================================================================

  describe('Metadata Routes', () => {
    it('should route GET /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/metadata to metadata handler', async () => {
      const module = await import('../../src/index');
      const metadataApi = await import('../../src/routes/metadata-api');

      const request = new Request('https://api.example.com/api/sites/site-123/branches/branch-456/structures/struct-789/metadata', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token' },
      });

      await module.default.fetch(request, mockEnv, mockContext);

      expect(metadataApi.handleMetadataRoutes).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 404 Handling
  // ===========================================================================

  describe('404 Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const module = await import('../../src/index');

      const request = new Request('https://api.example.com/api/unknown', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token' },
      });

      const response = await module.default.fetch(request, mockEnv, mockContext);

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // Route Wiring - Realtime (including focus-regions)
  // ===========================================================================

  describe('Realtime Routes', () => {
    it('should route POST /api/sites/{siteId}/branches/{branchId}/documents/{path}/focus-regions to realtime handler', async () => {
      const module = await import('../../src/index');
      const realtimeApi = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://api.example.com/api/sites/site-123/branches/main/documents/test-doc/focus-regions',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer token',
            'Content-Type': 'application/json',
            'X-Actor-Type': 'user',
          },
          body: JSON.stringify({
            actorId: 'user-123',
            focusRegions: ['/content/0'],
          }),
        },
      );

      await module.default.fetch(request, mockEnv, mockContext);

      expect(realtimeApi.handleRealtimeRoutes).toHaveBeenCalled();
    });

    it('should route POST /api/sites/{siteId}/branches/{branchId}/documents/{path}/edits to realtime handler', async () => {
      const module = await import('../../src/index');
      const realtimeApi = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://api.example.com/api/sites/site-123/branches/main/documents/test-doc/edits',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            operations: [],
            actorId: 'user-123',
          }),
        },
      );

      await module.default.fetch(request, mockEnv, mockContext);

      expect(realtimeApi.handleRealtimeRoutes).toHaveBeenCalled();
    });

    it('should route GET /api/sites/{siteId}/branches/{branchId}/documents/{path}/connect to realtime handler', async () => {
      const module = await import('../../src/index');
      const realtimeApi = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://api.example.com/api/sites/site-123/branches/main/documents/test-doc/connect',
        {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer token',
          },
        },
      );

      await module.default.fetch(request, mockEnv, mockContext);

      expect(realtimeApi.handleRealtimeRoutes).toHaveBeenCalled();
    });

    it('should route POST /api/sites/{siteId}/branches/{branchId}/documents/{path}/can-agent-edit to realtime handler', async () => {
      const module = await import('../../src/index');
      const realtimeApi = await import('../../src/routes/realtime-api');

      const request = new Request(
        'https://api.example.com/api/sites/site-123/branches/main/documents/test-doc/can-agent-edit',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            agentId: 'agent-123',
            trigger: 'human_requested',
            intent: 'Edit content',
            targetRegions: ['/content/0'],
          }),
        },
      );

      await module.default.fetch(request, mockEnv, mockContext);

      expect(realtimeApi.handleRealtimeRoutes).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Mock Auth Endpoint (for frontend login)
  // ===========================================================================

  describe('Mock Auth Endpoint', () => {
    it('should issue a token for a valid user ID at POST /api/auth/token', async () => {
      const module = await import('../../src/index');

      const request = new Request('https://api.example.com/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user-alice' }),
      });

      const response = await module.default.fetch(request, mockEnv, mockContext);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.token).toBeDefined();
      expect(body.user).toBeDefined();
    });

    it('should return 404 for unknown user at POST /api/auth/token', async () => {
      // Swap the MockIdentityProvider export so getUser returns undefined
      const mockIdentityModule = await import('../../src/auth/mock-identity-provider');
      const OrigClass = mockIdentityModule.MockIdentityProvider;
      const PatchedClass = class extends OrigClass {
        override getUser = vi.fn().mockReturnValue(undefined);
      };
      Object.defineProperty(mockIdentityModule, 'MockIdentityProvider', {
        value: PatchedClass, writable: true, configurable: true,
      });

      const module = await import('../../src/index');

      const request = new Request('https://api.example.com/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user-unknown' }),
      });

      const response = await module.default.fetch(request, mockEnv, mockContext);

      expect(response.status).toBe(404);

      // Restore original class
      Object.defineProperty(mockIdentityModule, 'MockIdentityProvider', {
        value: OrigClass, writable: true, configurable: true,
      });
    });

    it('should list available users at GET /api/auth/users', async () => {
      const module = await import('../../src/index');

      const request = new Request('https://api.example.com/api/auth/users', {
        method: 'GET',
      });

      const response = await module.default.fetch(request, mockEnv, mockContext);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.users).toBeDefined();
      expect(Array.isArray(body.users)).toBe(true);
    });
  });
});
