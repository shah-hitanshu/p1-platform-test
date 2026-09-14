/**
 * Tests for principal name/avatar enrichment from the database.
 *
 * Validates that when a non-mock auth provider is used:
 * 1. Missing JWT name/avatarUrl are filled from stored DB values
 * 2. JWT values take precedence over DB values
 * 3. First-login UPDATE uses COALESCE for avatar_url
 * 4. Returning users with changed JWT values trigger DB updates
 * 5. No unnecessary DB updates when values match
 * 6. No enrichment when DB has null name/avatar_url
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';
import { users } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';

const PROVIDER_DERIVED_ID = '3f5f62dd-27bd-528d-94d7-015b99a0c90e';
const DB_USER_ID = '6624d07e-aab3-4bde-a48a-5db1ccffffa0';

// Mutable per-test state
let testPrincipalOverrides: Partial<AuthenticatedPrincipal> = {};
let mockUserRow: Record<string, unknown> = {};
let database: DatabaseStub;
let capturedPrincipal: AuthenticatedPrincipal | null = null;

vi.mock('../../src/db', () => ({
  initializeDatabaseFromConnectionString: vi.fn(),
  runWithConnection: vi.fn().mockImplementation(
    (_connStr: string, _opts: unknown, fn: () => unknown) => fn(),
  ),
}));

// Mock route handlers to capture the enriched principal
vi.mock('../../src/routes/site-api', () => ({
  handleSiteRoutes: vi.fn().mockImplementation(
    (_req: unknown, context: { principal: AuthenticatedPrincipal }) => {
      capturedPrincipal = context.principal;
      return new Response(JSON.stringify({ mock: 'site-api' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  ),
}));

// Minimal route handler mocks
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

// Mock identity provider with per-test principal overrides
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
          // A test may override the provider to exercise a non-mock path.
          principal.authProvider = testPrincipalOverrides.authProvider ?? 'mock';
        }
        return principal;
      }
      async validateAgentKey(apiKey: string): Promise<AuthenticatedPrincipal | null> {
        const principal = await this.mockProvider.validateAgentKey(apiKey);
        if (principal !== null) {
          // A test may override the provider to exercise a non-mock path.
          principal.authProvider = testPrincipalOverrides.authProvider ?? 'mock';
        }
        return principal;
      }
    },
  };
});

describe('Principal Name/Avatar Enrichment from Database', () => {
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
    BROKER_TX: {} as DurableObjectNamespace,
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
    vi.clearAllMocks();
    capturedPrincipal = null;
    database = stubDatabase();
    testPrincipalOverrides = {};
    mockUserRow = {
      id: DB_USER_ID,
      principalId: PROVIDER_DERIVED_ID,
      systemRole: 'member',
      isActive: true,
      name: null,
      avatarUrl: null,
    };
  });

  it('should enrich principal from DB when JWT lacks name and avatarUrl', async () => {
    // JWT has no name or avatarUrl
    testPrincipalOverrides = { name: undefined, avatarUrl: undefined };
    // DB has stored values
    mockUserRow = {
      ...mockUserRow,
      name: 'Alice from DB',
      avatarUrl: 'https://db.example.com/alice.jpg',
    };
    database.on(users).select.returns([mockUserRow]);

    const module = await import('../../src/index');
    const response = await module.default.fetch(makeRequest(), mockEnv, mockContext);

    expect(response.status).toBe(200);
    if (capturedPrincipal === null) {
      throw new Error('Expected capturedPrincipal to be set');
    }
    expect(capturedPrincipal.name).toBe('Alice from DB');
    expect(capturedPrincipal.avatarUrl).toBe('https://db.example.com/alice.jpg');
  });

  it('should preserve JWT name and avatarUrl when present', async () => {
    // JWT has name and avatarUrl
    testPrincipalOverrides = {
      name: 'Alice from JWT',
      avatarUrl: 'https://jwt.example.com/alice.jpg',
    };
    // DB has different stored values
    mockUserRow = {
      ...mockUserRow,
      name: 'Alice from DB',
      avatarUrl: 'https://db.example.com/alice.jpg',
    };
    database.on(users).select.returns([mockUserRow]);

    const module = await import('../../src/index');
    const response = await module.default.fetch(makeRequest(), mockEnv, mockContext);

    expect(response.status).toBe(200);
    if (capturedPrincipal === null) {
      throw new Error('Expected capturedPrincipal to be set');
    }
    expect(capturedPrincipal.name).toBe('Alice from JWT');
    expect(capturedPrincipal.avatarUrl).toBe('https://jwt.example.com/alice.jpg');
  });

  it('should not null out a stored avatar_url on first login for a provider that carries none', async () => {
    // JWT has name but no avatarUrl
    testPrincipalOverrides = {
      name: 'Alice JWT',
      avatarUrl: undefined,
    };
    // First login: principal_id is null
    mockUserRow = {
      ...mockUserRow,
      principalId: null,
      name: 'Alice Existing',
      avatarUrl: 'https://existing.example.com/alice.jpg',
    };
    database.on(users).select.returns([mockUserRow]);

    const module = await import('../../src/index');
    await module.default.fetch(makeRequest(), mockEnv, mockContext);

    // The one UPDATE this request issues is the first-login principal_id link.
    const updateQueries = database.calls(users).update;
    expect(updateQueries.length).toBe(1);
    // The stored value is written back, not clobbered with null.
    expect(updateQueries[0].params).toContain('https://existing.example.com/alice.jpg');
  });

  // Only the broker JWT carries the upstream photo, so an absent one there means
  // the photo was removed.
  it('should clear a stored avatar_url when a broker login carries no picture', async () => {
    testPrincipalOverrides = {
      authProvider: 'broker',
      name: 'Alice Broker',
      avatarUrl: undefined,
    };
    mockUserRow = {
      ...mockUserRow,
      principalId: PROVIDER_DERIVED_ID,
      name: 'Alice Broker',
      avatarUrl: 'https://db.example.com/removed.jpg',
    };
    database.on(users).select.returns([mockUserRow]);

    const module = await import('../../src/index');
    await module.default.fetch(makeRequest(), mockEnv, mockContext);

    // A row already linked (principal_id set) only ever gets the name/avatar
    // refresh update, never the first-login link.
    const refreshQueries = database.calls(users).update;
    expect(refreshQueries.length).toBe(1);
    expect(refreshQueries[0].params).toContain(null);
    // ...and the principal falls back to initials rather than the stale photo.
    if (capturedPrincipal === null) {
      throw new Error('Expected capturedPrincipal to be set');
    }
    expect(capturedPrincipal.avatarUrl).toBeUndefined();
  });

  it('should keep enriching a non-broker principal from the stored avatar_url', async () => {
    testPrincipalOverrides = { authProvider: 'auth0', avatarUrl: undefined };
    mockUserRow = {
      ...mockUserRow,
      principalId: PROVIDER_DERIVED_ID,
      avatarUrl: 'https://db.example.com/alice.jpg',
    };
    database.on(users).select.returns([mockUserRow]);

    const module = await import('../../src/index');
    await module.default.fetch(makeRequest(), mockEnv, mockContext);

    if (capturedPrincipal === null) {
      throw new Error('Expected capturedPrincipal to be set');
    }
    expect(capturedPrincipal.avatarUrl).toBe('https://db.example.com/alice.jpg');
    // Nothing changed, so no write.
    expect(database.calls(users).update).toHaveLength(0);
  });

  it('should update DB when returning user has changed name', async () => {
    // JWT has updated name
    testPrincipalOverrides = {
      name: 'Alice New Name',
      avatarUrl: 'https://jwt.example.com/new.jpg',
    };
    // Returning user with old values
    mockUserRow = {
      ...mockUserRow,
      principalId: PROVIDER_DERIVED_ID,
      name: 'Alice Old Name',
      avatarUrl: 'https://db.example.com/old.jpg',
    };
    database.on(users).select.returns([mockUserRow]);

    const module = await import('../../src/index');
    await module.default.fetch(makeRequest(), mockEnv, mockContext);

    // A row already linked (principal_id set) only ever gets the name/avatar
    // refresh update, never the first-login link.
    const refreshQueries = database.calls(users).update;
    expect(refreshQueries.length).toBe(1);
    expect(refreshQueries[0].params).toContain('Alice New Name');
  });

  it('should not trigger UPDATE when returning user values match DB', async () => {
    // JWT has same values as DB
    testPrincipalOverrides = {
      name: 'Alice Same',
      avatarUrl: 'https://same.example.com/alice.jpg',
    };
    // DB has same values
    mockUserRow = {
      ...mockUserRow,
      principalId: PROVIDER_DERIVED_ID,
      name: 'Alice Same',
      avatarUrl: 'https://same.example.com/alice.jpg',
    };
    database.on(users).select.returns([mockUserRow]);

    const module = await import('../../src/index');
    await module.default.fetch(makeRequest(), mockEnv, mockContext);

    // No UPDATE queries should have been executed
    expect(database.calls(users).update).toHaveLength(0);
  });

  it('should not enrich when DB has null name and avatar_url', async () => {
    // JWT has no name or avatarUrl
    testPrincipalOverrides = { name: undefined, avatarUrl: undefined };
    // DB also has null values
    mockUserRow = {
      ...mockUserRow,
      name: null,
      avatarUrl: null,
    };
    database.on(users).select.returns([mockUserRow]);

    const module = await import('../../src/index');
    await module.default.fetch(makeRequest(), mockEnv, mockContext);

    if (capturedPrincipal === null) {
      throw new Error('Expected capturedPrincipal to be set');
    }
    expect(capturedPrincipal.name).toBeUndefined();
    expect(capturedPrincipal.avatarUrl).toBeUndefined();
  });

  // /api/auth/me used to return before the allowlist check ran, so it reported
  // only what the token carried — leaving the header avatar blank.
  it('enriches /api/auth/me from the DB when the token carries no avatarUrl', async () => {
    testPrincipalOverrides = { name: undefined, avatarUrl: undefined };
    mockUserRow = {
      ...mockUserRow,
      name: 'Alice from DB',
      avatarUrl: 'https://db.example.com/alice.jpg',
    };
    database.on(users).select.returns([mockUserRow]);

    const module = await import('../../src/index');
    const response = await module.default.fetch(
      new Request('https://api.example.com/api/auth/me', {
        method: 'GET',
        headers: {
          Origin: 'http://localhost:5173',
          Authorization: 'Bearer valid-mock-token',
        },
      }),
      mockEnv,
      mockContext,
    );

    expect(response.status).toBe(200);
    const body = await response.json<{ name?: string; avatarUrl?: string }>();
    expect(body.avatarUrl).toBe('https://db.example.com/alice.jpg');
    expect(body.name).toBe('Alice from DB');
  });

  // The allowlist rejection path had no coverage, and /api/auth/me now shares
  // the same gate as dispatched routes — an inactive row must refuse both.
  it('refuses /api/auth/me with 403 when the user row is not active', async () => {
    mockUserRow = { ...mockUserRow, isActive: false };
    database.on(users).select.returns([mockUserRow]);

    const module = await import('../../src/index');
    const response = await module.default.fetch(
      new Request('https://api.example.com/api/auth/me', {
        method: 'GET',
        headers: {
          Origin: 'http://localhost:5173',
          Authorization: 'Bearer valid-mock-token',
        },
      }),
      mockEnv,
      mockContext,
    );

    expect(response.status).toBe(403);
    const body = await response.json<{ error?: string }>();
    expect(body.error).toBe('User not authorized');
  });

  it('refuses a dispatched route with 403 when the user row is not active', async () => {
    mockUserRow = { ...mockUserRow, isActive: false };
    database.on(users).select.returns([mockUserRow]);

    const module = await import('../../src/index');
    const response = await module.default.fetch(makeRequest(), mockEnv, mockContext);

    expect(response.status).toBe(403);
    expect(capturedPrincipal).toBeNull();
  });
});
