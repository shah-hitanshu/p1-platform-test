/**
 * Tests for principal enrichment under mock-auth mode in index.ts.
 *
 * The allowlist gate previously skipped checkUserAllowlist() entirely when
 * only mock auth is configured (isMockOnly). That function both (1) rejects
 * users that are not on the allowlist and (2) enriches the principal from
 * the matching app.users row (dbUserId, systemRole, name, avatar). Skipping
 * the whole function meant systemRole was never set locally, so admin
 * behavior could not be exercised end-to-end in mock-auth mode.
 *
 * These tests pin the split responsibilities:
 * - mock-auth mode: the allowlist REJECTION is skipped (dev ergonomics
 *   preserved), but enrichment still runs when a matching active user row
 *   exists.
 * - real-auth mode: unchanged — rejection still happens and enrichment
 *   still happens.
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

// The UUIDv5-derived principal ID (from provider + subject)
const PROVIDER_DERIVED_ID = '7a1b03c4-55dd-5e0f-8a67-0123456789ab';
// The DB-generated users.id
const DB_USER_ID = 'a7b30d1e-ffc2-4b7d-9c30-1db2cc00aa11';
const USER_EMAIL = 'alice@example.com';

const userPrincipal: AuthenticatedPrincipal = {
  id: PROVIDER_DERIVED_ID,
  type: 'user',
  email: USER_EMAIL,
  name: 'Alice Developer',
  avatarUrl: 'https://example.com/alice.jpg',
  authProvider: 'mock',
  pantheonSiteRoles: {},
  tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  providerSubjectId: 'mock-subject-12345',
};

let userCount = 1; // by default the allowlist has rows
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
    if (sql.includes('SELECT COUNT(*)') && sql.includes('app.users')) {
      return Promise.resolve({ rows: [{ count: String(userCount) }] });
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

// Mock identity provider so requests with a Bearer token resolve to a
// fresh copy of the user principal (fresh so enrichment mutations do not
// leak between tests).
vi.mock('../../src/auth/mock-identity-provider', () => {
  return {
    MockIdentityProvider: class MockIdentityProvider {
      validateToken = vi.fn().mockImplementation(() =>
        Promise.resolve({ ...userPrincipal }),
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
        return await this.mockProvider.validateToken(token);
      }
      async validateAgentKey(apiKey: string): Promise<AuthenticatedPrincipal | null> {
        return await this.mockProvider.validateAgentKey(apiKey);
      }
    },
  };
});

describe('principal enrichment under mock-auth mode', () => {
  // No AUTH0_* or broker vars: hasRealAuthProviders() === false, so
  // isMockOnly === true (local development with mock auth only).
  const mockOnlyEnv = {
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

  // Setting Auth0 vars makes hasRealAuthProviders() return true, so
  // isMockOnly === false and the allowlist gate must enforce rejection.
  const realAuthEnv = {
    ...mockOnlyEnv,
    AUTH0_ISSUER_BASE_URL: 'https://test.auth0.com',
    AUTH0_AUDIENCE: 'test-audience',
  };

  const mockContext: ExecutionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  };

  function makeUserRequest(): Request {
    return new Request('https://api.example.com/api/sites', {
      method: 'GET',
      headers: {
        'Origin': 'http://localhost:5173',
        'Authorization': 'Bearer valid-mock-token',
      },
    });
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    executedQueries = [];
    siteApiCalled = false;
    capturedSiteApiPrincipal = null;
    userCount = 1;
    allowlistRow = {
      id: DB_USER_ID,
      principal_id: PROVIDER_DERIVED_ID,
      system_role: 'admin',
      is_active: true,
      name: 'Alice Developer',
      avatar_url: 'https://example.com/alice.jpg',
    };
  });

  describe('mock-auth mode (isMockOnly === true)', () => {
    it('enriches the principal from a matching active user row', async () => {
      const module = await import('../../src/index');
      const response = await module.default.fetch(makeUserRequest(), mockOnlyEnv, mockContext);

      expect(response.status).toBe(200);
      expect(siteApiCalled).toBe(true);
      if (capturedSiteApiPrincipal === null) {
        throw new Error('Expected capturedSiteApiPrincipal to be set');
      }
      // Enrichment must run even without real auth providers so that
      // systemRole-driven behavior (e.g. admin listSites) is testable locally.
      expect(capturedSiteApiPrincipal.dbUserId).toBe(DB_USER_ID);
      expect(capturedSiteApiPrincipal.systemRole).toBe('admin');
    });

    it('does not reject when the allowlist has no matching row', async () => {
      // In real-auth mode this exact state would produce a 403; mock-auth
      // mode must preserve dev ergonomics and let the request through.
      userCount = 1;
      allowlistRow = null;

      const module = await import('../../src/index');
      const response = await module.default.fetch(makeUserRequest(), mockOnlyEnv, mockContext);

      expect(response.status).toBe(200);
      expect(siteApiCalled).toBe(true);
      // No row matched, so there is nothing to enrich from.
      expect(capturedSiteApiPrincipal?.dbUserId).toBeUndefined();
      expect(capturedSiteApiPrincipal?.systemRole).toBeUndefined();
    });

    it('does not reject when the matching row is inactive, and does not enrich', async () => {
      allowlistRow = {
        id: DB_USER_ID,
        principal_id: PROVIDER_DERIVED_ID,
        system_role: 'admin',
        is_active: false,
        name: null,
        avatar_url: null,
      };

      const module = await import('../../src/index');
      const response = await module.default.fetch(makeUserRequest(), mockOnlyEnv, mockContext);

      expect(response.status).toBe(200);
      expect(siteApiCalled).toBe(true);
      expect(capturedSiteApiPrincipal?.dbUserId).toBeUndefined();
      expect(capturedSiteApiPrincipal?.systemRole).toBeUndefined();
    });
  });

  describe('real-auth mode (isMockOnly === false) stays unchanged', () => {
    it('still rejects with 403 when the user is not in the allowlist', async () => {
      userCount = 1;
      allowlistRow = null;

      const module = await import('../../src/index');
      const response = await module.default.fetch(makeUserRequest(), realAuthEnv, mockContext);

      expect(response.status).toBe(403);
      expect(siteApiCalled).toBe(false);
    });

    it('still enriches the principal from a matching active user row', async () => {
      const module = await import('../../src/index');
      const response = await module.default.fetch(makeUserRequest(), realAuthEnv, mockContext);

      expect(response.status).toBe(200);
      if (capturedSiteApiPrincipal === null) {
        throw new Error('Expected capturedSiteApiPrincipal to be set');
      }
      expect(capturedSiteApiPrincipal.dbUserId).toBe(DB_USER_ID);
      expect(capturedSiteApiPrincipal.systemRole).toBe('admin');
    });
  });
});
