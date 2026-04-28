/**
 * Tests for orphan user_site_roles self-heal on first login.
 *
 * Historical writes (including migration 033) stored principal.id where
 * users.id was expected. When a user completes their first Auth0 login
 * and gets linked, any orphan rows in user_site_roles should be rewritten
 * so that authorization and listing queries find them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';

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

const PROVIDER_DERIVED_ID = '3f5f62dd-27bd-528d-94d7-015b99a0c90e';
const DB_USER_ID = '6624d07e-aab3-4bde-a48a-5db1ccffffa0';

let testPrincipalOverrides: Partial<AuthenticatedPrincipal> = {};
let mockUserRow: Record<string, unknown> = {};
let executedQueries: { sql: string; params: unknown[] }[] = [];

vi.mock('../../src/db', () => ({
  initializeDatabaseFromConnectionString: vi.fn(),
  runWithConnection: vi.fn().mockImplementation(
    (_connStr: string, _opts: unknown, fn: () => unknown) => fn(),
  ),
  query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
    executedQueries.push({ sql, params: params ?? [] });
    if (sql.includes('SELECT COUNT(*)')) {
      return Promise.resolve({ rows: [{ count: '1' }] });
    }
    if (sql.includes('FROM app.users WHERE email')) {
      return Promise.resolve({ rows: [mockUserRow] });
    }
    if (sql.includes('UPDATE app.users')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('user_site_roles')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return Promise.resolve({ rows: [{ now: new Date().toISOString() }] });
  }),
}));

vi.mock('../../src/routes/site-api', () => ({
  handleSiteRoutes: vi.fn().mockResolvedValue(
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ),
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
vi.mock('../../src/routes/users-api', () => ({
  handleUsersRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));
vi.mock('../../src/routes/collaborator-api', () => ({
  handleCollaboratorRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}));

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

vi.mock('../../src/auth/mock-identity-provider', () => {
  return {
    MockIdentityProvider: class MockIdentityProvider {
      validateToken = vi.fn().mockImplementation(() =>
        Promise.resolve({
          id: PROVIDER_DERIVED_ID,
          type: 'user' as const,
          email: 'alice@example.com',
          authProvider: 'google' as const,
          pantheonSiteRoles: {},
          tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
          providerSubjectId: 'google-subject-12345',
          ...testPrincipalOverrides,
        }),
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

describe('Orphan user_site_roles self-heal on first login', () => {
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
    GOOGLE_CLIENT_ID: 'test-google-client-id',
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

  function makeRequest(): Request {
    return new Request('https://api.example.com/api/sites', {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:5173',
        Authorization: 'Bearer valid-mock-token',
      },
    });
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    executedQueries = [];
    testPrincipalOverrides = {};
    mockUserRow = {
      id: DB_USER_ID,
      principal_id: null,
      system_role: 'member',
      is_active: true,
      name: null,
      avatar_url: null,
    };
  });

  it('should rewrite orphan user_site_roles rows on first login', async () => {
    // First login: principal_id is null
    mockUserRow = { ...mockUserRow, principal_id: null };

    const module = await import('../../src/index');
    await module.default.fetch(makeRequest(), mockEnv, mockContext);

    const updateRoleQueries = executedQueries.filter((q) =>
      q.sql.includes('UPDATE app.user_site_roles')
      && q.sql.includes('SET user_id'),
    );
    expect(updateRoleQueries).toHaveLength(1);
    // Targets the canonical users.id, sourced from the principal.id
    expect(updateRoleQueries[0].params).toEqual([DB_USER_ID, PROVIDER_DERIVED_ID]);
  });

  it('should drop colliding orphan rows before rewriting', async () => {
    // First login: principal_id is null
    mockUserRow = { ...mockUserRow, principal_id: null };

    const module = await import('../../src/index');
    await module.default.fetch(makeRequest(), mockEnv, mockContext);

    const deleteOrphanQueries = executedQueries.filter((q) =>
      q.sql.includes('DELETE FROM app.user_site_roles')
      && q.sql.includes('orphan')
      && q.sql.includes('canonical'),
    );
    expect(deleteOrphanQueries).toHaveLength(1);
    expect(deleteOrphanQueries[0].params).toEqual([PROVIDER_DERIVED_ID, DB_USER_ID]);
  });

  it('should run delete-then-update in order', async () => {
    mockUserRow = { ...mockUserRow, principal_id: null };

    const module = await import('../../src/index');
    await module.default.fetch(makeRequest(), mockEnv, mockContext);

    const orphanQueries = executedQueries.filter((q) =>
      q.sql.includes('app.user_site_roles')
      && (q.sql.includes('orphan') || q.sql.includes('SET user_id')),
    );
    expect(orphanQueries).toHaveLength(2);
    expect(orphanQueries[0].sql).toContain('DELETE');
    expect(orphanQueries[1].sql).toContain('UPDATE');
  });

  it('should not touch user_site_roles for returning users', async () => {
    // Returning user: principal_id already set
    mockUserRow = { ...mockUserRow, principal_id: PROVIDER_DERIVED_ID };

    const module = await import('../../src/index');
    await module.default.fetch(makeRequest(), mockEnv, mockContext);

    const roleQueries = executedQueries.filter((q) =>
      q.sql.includes('app.user_site_roles'),
    );
    expect(roleQueries).toHaveLength(0);
  });
});
