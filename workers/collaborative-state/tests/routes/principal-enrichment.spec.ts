/**
 * Tests for principal ID enrichment in index.ts.
 *
 * Validates that when a non-mock auth provider is used and the user exists
 * in the database, principal.id is set to the DB users.id (not the
 * provider-derived UUIDv5) so that downstream authorization queries against
 * user_site_roles match correctly.
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

// The UUIDv5-derived principal ID (from google + subject)
const PROVIDER_DERIVED_ID = '3f5f62dd-27bd-528d-94d7-015b99a0c90e';
// The DB-generated users.id
const DB_USER_ID = '6624d07e-aab3-4bde-a48a-5db1ccffffa0';

const mockPrincipal: AuthenticatedPrincipal = {
  id: PROVIDER_DERIVED_ID,
  type: 'user',
  email: 'alice@example.com',
  name: 'Alice Developer',
  avatarUrl: 'https://example.com/alice.jpg',
  authProvider: 'google',
  pantheonSiteRoles: {},
  tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  providerSubjectId: 'google-subject-12345',
};

// Track the principal passed to route handlers
let capturedPrincipal: AuthenticatedPrincipal | null = null;

// Mock the database with query-aware responses
vi.mock('../../src/db', () => ({
  initializeDatabaseFromConnectionString: vi.fn(),
  runWithConnection: vi.fn().mockImplementation((_connStr: string, _opts: unknown, fn: () => unknown) => fn()),
  query: vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('SELECT EXISTS')) {
      return Promise.resolve({ rows: [{ populated: true }] });
    }
    if (sql.includes('FROM app.users WHERE email')) {
      return Promise.resolve({
        rows: [{
          id: DB_USER_ID,
          principal_id: PROVIDER_DERIVED_ID,
          system_role: 'member',
          is_active: true,
          name: 'Alice Developer',
          avatar_url: 'https://example.com/alice.jpg',
        }],
      });
    }
    // Default for health check / other queries
    return Promise.resolve({ rows: [{ now: new Date().toISOString() }] });
  }),
}));

// Mock route handlers to capture the principal
vi.mock('../../src/routes/site-api', () => ({
  handleSiteRoutes: vi.fn().mockImplementation((_req: unknown, context: { principal: AuthenticatedPrincipal }) => {
    capturedPrincipal = context.principal;
    return new Response(JSON.stringify({ mock: 'site-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }),
}));
vi.mock('../../src/routes/branch-api', () => ({
  handleBranchRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));
vi.mock('../../src/routes/document-api', () => ({
  handleDocumentRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));
vi.mock('../../src/routes/checkpoint-api', () => ({
  handleCheckpointRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));
vi.mock('../../src/routes/merge-api', () => ({
  handleMergeRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));
vi.mock('../../src/routes/grant-api', () => ({
  handleGrantRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));
vi.mock('../../src/routes/structure-api', () => ({
  handleStructureRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));
vi.mock('../../src/routes/node-api', () => ({
  handleNodeRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));
vi.mock('../../src/routes/metadata-api', () => ({
  handleMetadataRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));
vi.mock('../../src/routes/realtime-api', () => ({
  handleRealtimeRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));
vi.mock('../../src/routes/internal-api', () => ({
  handleInternalRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));
vi.mock('../../src/routes/presence-api', () => ({
  handlePresenceRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));

// Mock metrics
vi.mock('../../src/services/metrics-service', () => ({
  initializeMetrics: vi.fn(),
  incrementCounter: vi.fn(),
  recordTiming: vi.fn(),
  setGauge: vi.fn(),
  flushMetrics: vi.fn(),
  normalizePathPattern: vi.fn().mockReturnValue('/api/sites'),
  classifyError: vi.fn().mockReturnValue('unknown'),
  getStatusClass: vi.fn().mockReturnValue('2xx'),
}));

// Mock the mock-identity-provider
vi.mock('../../src/auth/mock-identity-provider', () => {
  return {
    MockIdentityProvider: class MockIdentityProvider {
      validateToken = vi.fn().mockImplementation(() =>
        Promise.resolve({ ...mockPrincipal }),
      );
      validateAgentKey = vi.fn().mockResolvedValue(null);
      getUser = vi.fn().mockReturnValue(null);
      issueToken = vi.fn().mockResolvedValue('mock-jwt-token');
    },
  };
});

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

describe('Principal ID Enrichment', () => {
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
    // Setting Auth0 vars makes hasRealAuthProviders() return true, enabling enrichment
    AUTH0_ISSUER_BASE_URL: 'https://test.auth0.com',
    AUTH0_AUDIENCE: 'test-audience',
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
    capturedPrincipal = null;
  });

  it('should set dbUserId to DB users.id while preserving principal.id', async () => {
    const module = await import('../../src/index');

    const request = new Request('https://api.example.com/api/sites', {
      method: 'GET',
      headers: {
        'Origin': 'http://localhost:5173',
        'Authorization': 'Bearer valid-mock-token',
      },
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(200);
    if (capturedPrincipal === null) {
      throw new Error('Expected capturedPrincipal to be set');
    }
    // principal.id should remain the provider-derived UUIDv5 (used by clients as actorId)
    expect(capturedPrincipal.id).toBe(PROVIDER_DERIVED_ID);
    // dbUserId should be the DB users.id (used for authorization queries)
    expect(capturedPrincipal.dbUserId).toBe(DB_USER_ID);
  });

  it('should attach systemRole from DB user row', async () => {
    const module = await import('../../src/index');

    const request = new Request('https://api.example.com/api/sites', {
      method: 'GET',
      headers: {
        'Origin': 'http://localhost:5173',
        'Authorization': 'Bearer valid-mock-token',
      },
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(200);
    if (capturedPrincipal === null) {
      throw new Error('Expected capturedPrincipal to be set');
    }
    expect(capturedPrincipal.systemRole).toBe('member');
  });
});
