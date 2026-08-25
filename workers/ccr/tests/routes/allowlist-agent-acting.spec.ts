/**
 * PCC-3190: tests for the user allowlist gate as it applies to agent
 * principals that forward an acting-user identity from the MCP server.
 *
 * The allowlist gate at workers/src/index.ts previously exited early when
 * `principal.email` was undefined. Agent principals carry no email
 * themselves, so this caused the gate to be skipped entirely for agent
 * traffic — letting any authenticated Google user (forwarded as the
 * acting user) reach downstream handlers without an allowlist check.
 *
 * The fix widens the gate so that when an agent principal carries an
 * `actingUserEmail`, the allowlist is checked against that email.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';

const AGENT_ID = 'agent-uuid-01010101-0101-0101-0101-010101010101';
const ACTING_USER_EMAIL = 'acting-user@example.com';
const ACTING_USER_ID = 'acting-user-provider-id';
const ACTING_DB_USER_ID = 'db-acting-user-id-22222222';

let agentPrincipalOverrides: Partial<AuthenticatedPrincipal> = {};
let allowlistPopulated = true; // by default the allowlist has rows
let allowlistRow: Record<string, unknown> | null = null;
let executedQueries: { sql: string; params: unknown[] }[] = [];
let siteApiCalled = false;
let capturedSiteApiPrincipal: AuthenticatedPrincipal | null = null;

vi.mock('../../src/db', () => ({
  initializeDatabaseFromConnectionString: vi.fn(),
  runWithConnection: vi.fn().mockImplementation(
    (_connStr: string, _opts: unknown, fn: () => unknown) => fn(),
  ),
  query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
    executedQueries.push({ sql, params: params ?? [] });
    if (sql.includes('SELECT EXISTS') && sql.includes('app.users')) {
      return Promise.resolve({ rows: [{ populated: allowlistPopulated }] });
    }
    if (sql.includes('FROM app.users WHERE email')) {
      return Promise.resolve({ rows: allowlistRow !== null ? [allowlistRow] : [] });
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
  handleSiteRoutes: vi.fn().mockImplementation(
    (_req: Request, context: { principal: AuthenticatedPrincipal }) => {
      siteApiCalled = true;
      capturedSiteApiPrincipal = context.principal;
      return Promise.resolve(
        new Response(JSON.stringify({ sites: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    },
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

// Mock identity provider so that requests carrying X-API-Key: aak_test
// resolve to an agent principal with overridable acting-user fields.
vi.mock('../../src/auth/mock-identity-provider', () => {
  return {
    MockIdentityProvider: class MockIdentityProvider {
      validateToken = vi.fn().mockResolvedValue(null);
      validateAgentKey = vi.fn().mockImplementation(() =>
        Promise.resolve({
          id: AGENT_ID,
          type: 'agent' as const,
          pantheonSiteRoles: {},
          tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
          authProvider: 'agent_key' as const,
          ...agentPrincipalOverrides,
        }),
      );
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
        return await this.mockProvider.validateToken(token);
      }
      async validateAgentKey(apiKey: string): Promise<AuthenticatedPrincipal | null> {
        return await this.mockProvider.validateAgentKey(apiKey);
      }
    },
  };
});

describe('PCC-3190: allowlist gate for agent principals with acting user', () => {
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
    // hasRealAuthProviders() checks for Auth0 or broker credentials (not GOOGLE_CLIENT_ID,
    // which was removed with the Google OAuth flow). Setting these makes isMockOnly === false
    // so the allowlist gate runs.
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

  function makeAgentRequest(
    actingUserEmail: string | undefined,
    actingUserIdHeader: string | undefined,
  ): Request {
    const headers: Record<string, string> = {
      Origin: 'http://localhost:5173',
      'X-API-Key': 'aak_test-agent-key',
    };
    if (actingUserEmail !== undefined) {
      headers['X-Acting-User-Email'] = actingUserEmail;
    }
    if (actingUserIdHeader !== undefined) {
      headers['X-Acting-User-Id'] = actingUserIdHeader;
    }
    return new Request('https://api.example.com/api/sites', {
      method: 'GET',
      headers,
    });
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    executedQueries = [];
    siteApiCalled = false;
    capturedSiteApiPrincipal = null;
    agentPrincipalOverrides = {};
    allowlistPopulated = true;
    allowlistRow = {
      id: ACTING_DB_USER_ID,
      principal_id: ACTING_USER_ID,
      system_role: 'member',
      is_active: true,
      name: null,
      avatar_url: null,
    };
  });

  it('rejects with 403 when agent acts on behalf of a user that is NOT in the allowlist', async () => {
    // Allowlist is non-empty but the acting user is not in it.
    allowlistPopulated = true;
    allowlistRow = null;

    const module = await import('../../src/index');
    const response = await module.default.fetch(
      makeAgentRequest(ACTING_USER_EMAIL, ACTING_USER_ID),
      mockEnv,
      mockContext,
    );

    expect(response.status).toBe(403);
    expect(siteApiCalled).toBe(false);

    // The gate must look up the acting user's email, not the (absent) agent email.
    const userLookup = executedQueries.find((q) =>
      q.sql.includes('FROM app.users WHERE email'),
    );
    expect(userLookup).toBeDefined();
    expect(userLookup?.params).toContain(ACTING_USER_EMAIL.toLowerCase());
  });

  it('rejects with 403 when agent acts on behalf of an inactive allowlisted user', async () => {
    allowlistPopulated = true;
    allowlistRow = {
      id: ACTING_DB_USER_ID,
      principal_id: ACTING_USER_ID,
      system_role: 'member',
      is_active: false,
      name: null,
      avatar_url: null,
    };

    const module = await import('../../src/index');
    const response = await module.default.fetch(
      makeAgentRequest(ACTING_USER_EMAIL, ACTING_USER_ID),
      mockEnv,
      mockContext,
    );

    expect(response.status).toBe(403);
    expect(siteApiCalled).toBe(false);
  });

  it('passes the gate and reaches the route handler when acting user IS in the allowlist', async () => {
    allowlistPopulated = true;
    // Default allowlistRow set in beforeEach: active user.

    const module = await import('../../src/index');
    const response = await module.default.fetch(
      makeAgentRequest(ACTING_USER_EMAIL, ACTING_USER_ID),
      mockEnv,
      mockContext,
    );

    expect(response.status).toBe(200);
    expect(siteApiCalled).toBe(true);
    // Ensure the principal that reached the handler is still the agent (we
    // intentionally do NOT swap the principal identity to the acting user).
    expect(capturedSiteApiPrincipal?.id).toBe(AGENT_ID);
    expect(capturedSiteApiPrincipal?.type).toBe('agent');
    expect(capturedSiteApiPrincipal?.actingUserEmail).toBe(ACTING_USER_EMAIL);
  });

  it('does NOT mutate principal.dbUserId or systemRole from the acting user row', async () => {
    // Regression guard: the agent path must not adopt the acting user's DB
    // identity, otherwise downstream agent-keyed authorization breaks.
    allowlistPopulated = true;

    const module = await import('../../src/index');
    await module.default.fetch(
      makeAgentRequest(ACTING_USER_EMAIL, ACTING_USER_ID),
      mockEnv,
      mockContext,
    );

    expect(siteApiCalled).toBe(true);
    expect(capturedSiteApiPrincipal?.dbUserId).toBeUndefined();
    expect(capturedSiteApiPrincipal?.systemRole).toBeUndefined();
  });

  it('preserves legacy agent traffic (no acting user) by NOT applying the allowlist gate', async () => {
    // Agent without acting-user headers -- the gate stays bypassed exactly as it did before.
    allowlistPopulated = true;
    allowlistRow = null; // even with no allowlist row, the gate must not engage.

    const module = await import('../../src/index');
    const response = await module.default.fetch(
      makeAgentRequest(undefined, undefined),
      mockEnv,
      mockContext,
    );

    expect(response.status).toBe(200);
    expect(siteApiCalled).toBe(true);

    // No app.users SELECT email lookup must have happened for the legacy path.
    const userLookup = executedQueries.find((q) =>
      q.sql.includes('FROM app.users WHERE email'),
    );
    expect(userLookup).toBeUndefined();
  });

  it('skips the gate entirely when the allowlist is empty (count=0)', async () => {
    // When app.users has no rows the allowlist is treated as "open" --
    // this preserves the existing behavior for fresh dev/test databases.
    allowlistPopulated = false;
    allowlistRow = null;

    const module = await import('../../src/index');
    const response = await module.default.fetch(
      makeAgentRequest(ACTING_USER_EMAIL, ACTING_USER_ID),
      mockEnv,
      mockContext,
    );

    expect(response.status).toBe(200);
    expect(siteApiCalled).toBe(true);

    // The COUNT(*) should have been executed, but no email lookup.
    const userLookup = executedQueries.find((q) =>
      q.sql.includes('FROM app.users WHERE email'),
    );
    expect(userLookup).toBeUndefined();
  });

  // The user-principal allowlist behavior is covered by the existing
  // tests/routes/principal-enrichment.spec.ts and
  // tests/routes/principal-orphan-role-selfheal.spec.ts suites; we do not
  // duplicate that coverage here.
});
