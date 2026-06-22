/**
 * AAK Key Routing Tests (B4)
 *
 * Verifies that aak_ prefixed keys sent via X-API-Key header are correctly
 * routed to the AgentApiKeyProvider through the worker's authenticate() function.
 *
 * Also verifies that AgentApiKeyProvider is re-exported from the auth barrel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';

// Mock cloudflare:workers DurableObject base class for Hibernatable WebSocket API
vi.mock('cloudflare:workers', () => ({
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

// Mock the mock-identity-provider (needed for local env setup)
vi.mock('../../src/auth/mock-identity-provider', () => {
  return {
    MockIdentityProvider: class MockIdentityProvider {
      validateToken = vi.fn().mockResolvedValue(null);
      validateAgentKey = vi.fn().mockResolvedValue(null);
      getUser = vi.fn().mockReturnValue(null);
      issueToken = vi.fn().mockResolvedValue('mock-jwt-token');
    },
  };
});

// Mock identity-provider to bypass JWT decode
vi.mock('../../src/auth/identity-provider', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/auth/identity-provider')
      >('../../src/auth/identity-provider');
  return {
    ...actual,
    MockIdentityProviderAdapter: class MockIdentityProviderAdapter {
      name = 'mock' as const;
      canVerifyToken(): boolean {
        return false;
      }
      // eslint-disable-next-line @typescript-eslint/require-await
      async validateToken(): Promise<AuthenticatedPrincipal | null> {
        return null;
      }
      // eslint-disable-next-line @typescript-eslint/require-await
      async validateAgentKey(): Promise<AuthenticatedPrincipal | null> {
        return null;
      }
    },
  };
});

// Mock the site-api-token-service
vi.mock('../../src/services/site-api-token-service', () => ({
  validateToken: vi.fn().mockResolvedValue(null),
  generateToken: vi.fn(),
  listTokens: vi.fn().mockResolvedValue([]),
  revokeToken: vi.fn(),
}));

// Mock the agent-api-key-service — this is what AgentApiKeyProvider delegates to
const mockAakValidateKey = vi.fn();
vi.mock('../../src/services/agent-api-key-service', () => ({
  validateKey: mockAakValidateKey,
}));

describe('aak_ key routing (B4)', () => {
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
  });

  it('should authenticate aak_ keys via X-API-Key header', async () => {
    mockAakValidateKey.mockResolvedValue({
      keyId: 'key-uuid-123',
      agentId: 'agent-uuid-456',
    });

    const module = await import('../../src/index');

    const request = new Request('https://api.example.com/api/sites', {
      method: 'GET',
      headers: {
        'X-API-Key': 'aak_validagentkey123abc',
      },
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(200);
    expect(mockAakValidateKey).toHaveBeenCalledWith('aak_validagentkey123abc');
  });

  it('should return 401 for invalid aak_ keys', async () => {
    mockAakValidateKey.mockResolvedValue(null);

    const module = await import('../../src/index');

    const request = new Request('https://api.example.com/api/sites', {
      method: 'GET',
      headers: {
        'X-API-Key': 'aak_invalidkey',
      },
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(401);
  });

  it('should authenticate aak_ keys via apiKey query parameter', async () => {
    mockAakValidateKey.mockResolvedValue({
      keyId: 'key-uuid-123',
      agentId: 'agent-uuid-456',
    });

    const module = await import('../../src/index');

    const request = new Request('https://api.example.com/api/sites?apiKey=aak_validagentkey123abc', {
      method: 'GET',
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(200);
    expect(mockAakValidateKey).toHaveBeenCalledWith('aak_validagentkey123abc');
  });
});

describe('auth barrel exports (B4)', () => {
  it('should export AgentApiKeyProvider from auth index', async () => {
    const authModule = await import('../../src/auth/index');

    expect(authModule.AgentApiKeyProvider).toBeDefined();
    expect(typeof authModule.AgentApiKeyProvider).toBe('function');
  });
});
