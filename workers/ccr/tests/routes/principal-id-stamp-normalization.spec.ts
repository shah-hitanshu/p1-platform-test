/**
 * PCC-3457: principal_id stamp normalization (incident PCC-3464).
 *
 * app.users.principal_id is the lookup key the persistence actor resolver
 * queries by UUIDv5 (providerSubToUuid('auth0', subject)). Two write paths
 * stamp principal_id from principal.id:
 *
 *   1. First-login linking in index.ts (checkUserAllowlist)
 *   2. Bootstrap self-add in users-api.ts (handleAddUser)
 *
 * For broker-authenticated principals, principal.id is the RAW OAuth subject
 * (`google-oauth2|…`). Stamping it verbatim creates rows the resolver can
 * never match — the exact rows migration 045 backfills — so every realtime
 * edit by such a user fails attribution and dead-letters (PCC-3464 data
 * loss). These tests pin the invariant: every writer of principal_id stamps
 * the SAME normalized form the resolver looks up, so the backfill can never
 * be re-poisoned by a new login.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';
import { providerSubToUuid } from '../../src/auth/uuid-v5';
import { users } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';

// Production-shaped raw OAuth subject (same shape as the incident's actor).
const RAW_SUBJECT = 'google-oauth2|107221644627712432289';
// The DB-generated users.id of the pre-provisioned allowlist row.
const DB_USER_ID = '6624d07e-aab3-4bde-a48a-5db1ccffffa0';

const mockPrincipal: AuthenticatedPrincipal = {
  id: RAW_SUBJECT,
  type: 'user',
  email: 'alice@example.com',
  name: 'Alice Developer',
  authProvider: 'auth0',
  pantheonSiteRoles: {},
  tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

let database: DatabaseStub;

vi.mock('../../src/db', () => ({
  initializeDatabaseFromConnectionString: vi.fn(),
  runWithConnection: vi.fn().mockImplementation((_connStr: string, _opts: unknown, fn: () => unknown) => fn()),
  // organization-service.ts (out of this port's scope) still calls the
  // legacy query() when handleAddUser auto-creates an org for a new user.
  query: vi.fn().mockResolvedValue({ rows: [] }),
}));

// Mock route handlers so dispatch terminates without real services.
vi.mock('../../src/routes/site-api', () => ({
  handleSiteRoutes: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
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

// Mock the mock-identity-provider to return our broker-shaped principal.
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
        return this.mockProvider.validateToken(token);
      }
      async validateAgentKey(apiKey: string): Promise<AuthenticatedPrincipal | null> {
        return this.mockProvider.validateAgentKey(apiKey);
      }
    },
  };
});

describe('principal_id stamp normalization (PCC-3457)', () => {
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
    // Setting Auth0 vars makes hasRealAuthProviders() return true, enabling the allowlist path
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
    props: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    database = stubDatabase();
  });

  it('first-login linking stamps the UUIDv5 of a raw OAuth subject, never the raw subject', async () => {
    database.on(users).select.returns([{
      id: DB_USER_ID,
      principalId: null,
      systemRole: 'member',
      isActive: true,
      name: 'Alice Developer',
      avatarUrl: null,
    }]);

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

    const stampQuery = database.calls(users).update[0];
    if (stampQuery === undefined) {
      throw new Error('Expected the first-login principal_id stamp to run');
    }

    // The stamped value must be the SAME key the persistence actor resolver
    // looks up (providerSubToUuid('auth0', <full raw subject>)). Stamping the
    // raw subject instead recreates the unmatchable rows behind PCC-3464.
    const expectedKey = await providerSubToUuid('auth0', RAW_SUBJECT);
    expect(stampQuery.params).toContain(expectedKey);
    expect(stampQuery.params).not.toContain(RAW_SUBJECT);
  });

  it('bootstrap self-add in users-api stamps the UUIDv5 of a raw OAuth subject', async () => {
    const { handleUsersRoutes } = await import('../../src/routes/users-api');

    const request = new Request(
      'https://api.example.com/api/admin/users',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'someone-else@example.com',
          name: 'Someone Else',
          systemRole: 'member',
        }),
      },
    );

    // Empty users table: isSystemAdmin's bootstrap check and handleAddUser's
    // own populated check both pass trivially, so the bootstrap self-add
    // insert runs before the real one.
    database.on(users).insert.returns([{
      id: DB_USER_ID,
      email: 'someone-else@example.com',
      name: 'Someone Else',
      principalId: null,
      authProvider: null,
      systemRole: 'member',
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }]);

    const response = await handleUsersRoutes(request, {
      principal: { ...mockPrincipal },
    });
    expect(response.status).toBe(201);

    // The bootstrap self-add insert (email, principal_id, auth_provider,
    // system_role) runs first; the real user insert (email, name,
    // system_role) runs second.
    const bootstrapInsert = database.calls(users).insert[0];
    if (bootstrapInsert === undefined) {
      throw new Error('Expected the bootstrap self-add insert to run');
    }

    const expectedKey = await providerSubToUuid('auth0', RAW_SUBJECT);
    expect(bootstrapInsert.params[1]).toBe(expectedKey);
    expect(bootstrapInsert.params[1]).not.toBe(RAW_SUBJECT);
  });

  it('isSystemAdmin looks up principal_id by the normalized (UUIDv5) key for raw OAuth subjects', async () => {
    const { handleUsersRoutes } = await import('../../src/routes/users-api');

    // Once app.users.principal_id is uniformly normalized (migration 045 +
    // the stamp fixes above), a reader that queries by the RAW subject can
    // never match — a broker-authenticated system admin would be denied
    // (fail-closed 403). The lookup must use the same normalized key the
    // writers stamp.
    const expectedKey = await providerSubToUuid('auth0', RAW_SUBJECT);
    // A populated table, so isSystemAdmin proceeds to the role lookup, which
    // shares this stub; handleListUsers' own select reads it too.
    database.on(users).select.returns([{ id: 'row-1', systemRole: 'superadmin' }]);

    const response = await handleUsersRoutes(
      new Request('https://api.example.com/api/admin/users', { method: 'GET' }),
      { principal: { ...mockPrincipal } },
    );

    // Raw-subject lookup would miss the normalized row and 403 here.
    expect(response.status).toBe(200);
    const lookup = database.calls(users).select.find((c) => c.sql.includes('principal_id'));
    if (lookup === undefined) {
      throw new Error('Expected the isSystemAdmin principal_id lookup to run');
    }
    expect(lookup.params[0]).toBe(expectedKey);
    expect(lookup.params[0]).not.toBe(RAW_SUBJECT);
  });

  it('bootstrap self-add leaves uuid and legacy principal ids unchanged', async () => {
    const { handleUsersRoutes } = await import('../../src/routes/users-api');

    // A uuid principal.id (auth0-provider principals are already the UUIDv5
    // of their subject) and a legacy no-pipe id must both pass through
    // verbatim — normalization only applies to `provider|subject` ids.
    for (const passthroughId of [
      '3f5f62dd-27bd-528d-94d7-015b99a0c90e',
      'legacy-test-user',
    ]) {
      database = stubDatabase();
      database.on(users).insert.returns([{
        id: DB_USER_ID,
        email: 'someone-else@example.com',
        name: 'Someone Else',
        principalId: null,
        authProvider: null,
        systemRole: 'member',
        isActive: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      }]);

      const response = await handleUsersRoutes(
        new Request('https://api.example.com/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'someone-else@example.com',
            name: 'Someone Else',
            systemRole: 'member',
          }),
        }),
        { principal: { ...mockPrincipal, id: passthroughId } },
      );
      expect(response.status).toBe(201);

      const bootstrapInsert = database.calls(users).insert[0];
      if (bootstrapInsert === undefined) {
        throw new Error('Expected the bootstrap self-add insert to run');
      }
      expect(bootstrapInsert.params[1]).toBe(passthroughId);
    }
  });
});
