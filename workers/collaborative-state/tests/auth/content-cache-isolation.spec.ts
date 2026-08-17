/**
 * Auth isolation on the cacheable content path.
 *
 * The Workers Caching key excludes headers, and the sat_ token travels in
 * X-API-Key. Caching the content route without keeping token validation on
 * every request would serve one tenant's content to another's token, or to no
 * token at all. These pin that down before caching is enabled: each assertion
 * repeats a URL that a previous request already fetched successfully, which is
 * exactly the sequence a cache turns into a hit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';
import type { Env } from '../../src/env';

const cachedContent = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

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

vi.mock('../../src/db', () => ({
  initializeDatabaseFromConnectionString: vi.fn(),
  runWithConnection: vi.fn().mockImplementation(
    (_connStr: string, _opts: unknown, fn: () => unknown) => fn(),
  ),
  query: vi.fn().mockResolvedValue({ rows: [{ now: new Date().toISOString() }] }),
}));

vi.mock('../../src/routes/content-api', () => ({
  handleContentRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'content-api' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}));

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

vi.mock('../../src/auth/mock-identity-provider', () => ({
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
}));

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
        return !token.startsWith('sat_');
      }
      async validateToken(token: string): Promise<AuthenticatedPrincipal | null> {
        const principal = await this.mockProvider.validateToken(token);
        if (principal !== null) principal.authProvider = 'mock';
        return principal;
      }
      async validateAgentKey(apiKey: string): Promise<AuthenticatedPrincipal | null> {
        const principal = await this.mockProvider.validateAgentKey(apiKey);
        if (principal !== null) principal.authProvider = 'mock';
        return principal;
      }
    },
  };
});

const mockSatValidateToken = vi.fn();
vi.mock('../../src/services/site-api-token-service', () => ({
  validateToken: mockSatValidateToken,
  generateToken: vi.fn(),
  listTokens: vi.fn().mockResolvedValue([]),
  revokeToken: vi.fn(),
}));

const SITE_A = 'site-aaa';
const SITE_B = 'site-bbb';
const SHARED_PATH = 'home';

const mockEnv = {
  ENVIRONMENT: 'local',
  LOG_LEVEL: 'error',
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
} as unknown as Env;

const mockContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

function tokenFor(siteId: string) {
  return { tokenId: `tok-${siteId}`, siteId, scopes: ['read:published'] };
}

function contentRequest(siteId: string, apiKey?: string): Request {
  return new Request(
    `https://api.example.com/api/sites/${siteId}/content/${SHARED_PATH}`,
    {
      method: 'GET',
      headers: apiKey === undefined ? {} : { 'X-API-Key': apiKey },
    },
  );
}

describe('content path auth isolation under caching', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cachedContent.fetch.mockResolvedValue(
      new Response(JSON.stringify({ mock: 'cached-content' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('rejects a token bound to another site', async () => {
    mockSatValidateToken.mockResolvedValue(tokenFor(SITE_A));
    const module = await import('../../src/index');

    const response = await module.default.fetch(
      contentRequest(SITE_B, 'sat_tokenboundtositea'),
      mockEnv,
      mockContext,
    );

    expect(response.status).toBe(403);
    expect(cachedContent.fetch).not.toHaveBeenCalled();
  });

  it('does not serve site B content to a site A token after B warmed the same URL', async () => {
    const module = await import('../../src/index');

    mockSatValidateToken.mockResolvedValue(tokenFor(SITE_B));
    const warm = await module.default.fetch(
      contentRequest(SITE_B, 'sat_tokenboundtositeb'),
      mockEnv,
      mockContext,
    );
    expect(warm.status).toBe(200);

    mockSatValidateToken.mockResolvedValue(tokenFor(SITE_A));
    const crossTenant = await module.default.fetch(
      contentRequest(SITE_B, 'sat_tokenboundtositea'),
      mockEnv,
      mockContext,
    );

    expect(crossTenant.status).toBe(403);
    expect(cachedContent.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a revoked token on a URL it previously fetched successfully', async () => {
    const module = await import('../../src/index');

    mockSatValidateToken.mockResolvedValue(tokenFor(SITE_A));
    const warm = await module.default.fetch(
      contentRequest(SITE_A, 'sat_stillvalid'),
      mockEnv,
      mockContext,
    );
    expect(warm.status).toBe(200);

    mockSatValidateToken.mockResolvedValue(null);
    const revoked = await module.default.fetch(
      contentRequest(SITE_A, 'sat_stillvalid'),
      mockEnv,
      mockContext,
    );

    expect(revoked.status).toBe(401);
  });

  it('rejects an unauthenticated request to a warmed URL', async () => {
    const module = await import('../../src/index');

    mockSatValidateToken.mockResolvedValue(tokenFor(SITE_A));
    const warm = await module.default.fetch(
      contentRequest(SITE_A, 'sat_stillvalid'),
      mockEnv,
      mockContext,
    );
    expect(warm.status).toBe(200);

    const anonymous = await module.default.fetch(
      contentRequest(SITE_A),
      mockEnv,
      mockContext,
    );

    expect(anonymous.status).toBe(401);
  });

  // Memoizing validation per token is a planned optimization; memoizing it per
  // URL is the bug this guards against.
  it('validates each distinct token even on an already-warmed URL', async () => {
    mockSatValidateToken.mockResolvedValue(tokenFor(SITE_A));
    const module = await import('../../src/index');

    await module.default.fetch(
      contentRequest(SITE_A, 'sat_firsttoken'),
      mockEnv,
      mockContext,
    );
    mockSatValidateToken.mockClear();

    await module.default.fetch(
      contentRequest(SITE_A, 'sat_secondtoken'),
      mockEnv,
      mockContext,
    );

    expect(mockSatValidateToken).toHaveBeenCalledWith('sat_secondtoken');
  });
});
