/**
 * SAT Token Routing Tests
 *
 * Verifies that sat_ prefixed tokens sent via X-API-Key header or apiKey
 * query parameter are correctly routed to validateToken() (not validateAgentKey())
 * in the server's authenticate() function.
 *
 * These tests exercise the worker's fetch handler since authenticate() is not
 * exported directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';

// Content GETs are forwarded to the cacheable entrypoint rather than handled
// inline, so routing is observed there.
const cachedContent = vi.hoisted(() => ({ fetch: vi.fn() }));

// Mock cloudflare:workers DurableObject base class for Hibernatable WebSocket API
vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class WorkerEntrypoint {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
  exports: { CachedContent: cachedContent },
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

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

vi.mock('../../src/routes/content-api', () => ({
  handleContentRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'content-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}));

vi.mock('../../src/routes/site-settings-api', () => ({
  handleSiteSettingsRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'site-settings-api' }), {
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
      canVerifyToken(token: string): boolean {
        // Accept non-sat_ tokens — sat_ tokens should be handled by SiteApiTokenProvider
        return !token.startsWith('sat_');
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

// Mock the site-api-token-service with a controllable validateToken mock
const mockSatValidateToken = vi.fn();
vi.mock('../../src/services/site-api-token-service', () => ({
  validateToken: mockSatValidateToken,
  generateToken: vi.fn(),
  listTokens: vi.fn().mockResolvedValue([]),
  revokeToken: vi.fn(),
}));

describe('sat_ token routing', () => {
  const mockEnv = {
    ENVIRONMENT: 'local',
    LOG_LEVEL: 'debug',
    CORS_ORIGINS: 'https://test.example.com',
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

    cachedContent.fetch.mockResolvedValue(
      new Response(JSON.stringify({ mock: 'cached-content' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    // Default: sat_ tokens are valid
    mockSatValidateToken.mockResolvedValue({
      tokenId: 'tok-123',
      siteId: 'site-123',
      scopes: ['read:published'],
    });
  });

  it('should authenticate sat_ tokens via X-API-Key header', async () => {
    const module = await import('../../src/index');

    const request = new Request('https://api.example.com/api/sites/site-123/content/home', {
      method: 'GET',
      headers: {
        'X-API-Key': 'sat_validtoken123',
      },
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(200);
    expect(cachedContent.fetch).toHaveBeenCalled();
  });

  it('should authenticate sat_ tokens via apiKey query parameter', async () => {
    const module = await import('../../src/index');

    const request = new Request('https://api.example.com/api/sites/site-123/content/home?apiKey=sat_validtoken123', {
      method: 'GET',
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(200);
  });

  it('should still authenticate regular agent keys via X-API-Key header', async () => {
    const module = await import('../../src/index');

    const request = new Request('https://api.example.com/api/sites', {
      method: 'GET',
      headers: {
        'X-API-Key': 'test-agent-key-zappy',
      },
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(200);
  });

  it('should return 401 for invalid sat_ tokens via X-API-Key', async () => {
    // Override the mock to return null for invalid tokens
    mockSatValidateToken.mockResolvedValue(null);

    const module = await import('../../src/index');

    const request = new Request('https://api.example.com/api/sites/site-123', {
      method: 'GET',
      headers: {
        'X-API-Key': 'sat_invalidtoken',
      },
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(401);
  });
});
