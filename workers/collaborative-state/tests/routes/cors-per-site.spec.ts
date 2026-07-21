/**
 * Per-site CORS integration tests (PCC-3334)
 *
 * Verifies that the three-layer CORS merge (system defaults + env + per-site
 * allowed_origins) works end-to-end through the worker fetch handler.
 *
 * System defaults always allowed:
 *   - localhost (any port, any protocol)
 *   - all origins (wildcard) when no allowed_origins configured
 *   - configured list only when allowed_origins is set (opted-in restriction)
 *
 * Per-site: custom domains from app.sites.allowed_origins, looked up by siteId.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../../src/db', () => ({
  initializeDatabaseFromConnectionString: vi.fn(),
  runWithConnection: vi.fn().mockImplementation((_connStr: string, _opts: unknown, fn: () => unknown) => fn()),
  query: vi.fn().mockResolvedValue({ rows: [] }),
}));

// Mock site-service so we can control what getSiteAllowedOrigins returns
vi.mock('../../src/services/site-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/site-service')>();
  return {
    ...actual,
    getCachedSiteAllowedOrigins: vi.fn().mockResolvedValue([]),
  };
});

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
    new Response(JSON.stringify({ mock: 'branch-api' }), { status: 200 }),
  ),
}));

vi.mock('../../src/routes/document-api', () => ({
  handleDocumentRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'document-api' }), { status: 200 }),
  ),
}));

vi.mock('../../src/routes/checkpoint-api', () => ({
  handleCheckpointRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'checkpoint-api' }), { status: 200 }),
  ),
}));

vi.mock('../../src/routes/merge-api', () => ({
  handleMergeRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'merge-api' }), { status: 200 }),
  ),
}));

vi.mock('../../src/routes/grant-api', () => ({
  handleGrantRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'grant-api' }), { status: 200 }),
  ),
}));

vi.mock('../../src/routes/structure-api', () => ({
  handleStructureRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'structure-api' }), { status: 200 }),
  ),
}));

vi.mock('../../src/routes/node-api', () => ({
  handleNodeRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'node-api' }), { status: 200 }),
  ),
}));

vi.mock('../../src/routes/metadata-api', () => ({
  handleMetadataRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'metadata-api' }), { status: 200 }),
  ),
}));

vi.mock('../../src/routes/realtime-api', () => ({
  handleRealtimeRoutes: vi.fn().mockImplementation(() =>
    new Response(JSON.stringify({ mock: 'realtime-api' }), { status: 200 }),
  ),
}));

const mockTokenPrincipal = {
  id: 'user-alice',
  type: 'user' as const,
  email: 'alice@example.com',
  authProvider: 'mock' as const,
  pantheonSiteRoles: {},
  tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

vi.mock('../../src/auth/mock-identity-provider', () => ({
  MockIdentityProvider: class MockIdentityProvider {
    validateToken = vi.fn().mockResolvedValue({ ...mockTokenPrincipal });
    validateAgentKey = vi.fn().mockResolvedValue(null);
    getUser = vi.fn().mockReturnValue(null);
    issueToken = vi.fn().mockResolvedValue('mock-token');
  },
}));

vi.mock('../../src/auth/identity-provider', async () => {
  const actual = await vi.importActual<typeof import('../../src/auth/identity-provider')>(
    '../../src/auth/identity-provider',
  );
  return {
    ...actual,
    hasRealAuthProviders: vi.fn().mockReturnValue(false),
  };
});

const mockEnv = {
  ENVIRONMENT: 'local',
  LOG_LEVEL: 'debug',
  // Deliberately restrictive — does NOT include pantheonsite.io or custom domains
  CORS_ORIGINS: 'https://dashboard.example.com',
  WEBSOCKET_HEARTBEAT_INTERVAL: '30000',
  DOCUMENT_SYNC_BATCH_SIZE: '50',
  PRESENCE_TTL_SECONDS: '300',
  POSTGRES_CONNECTION_STRING: 'postgres://test:test@localhost:5432/test',
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

describe('Per-site CORS enforcement (PCC-3334)', () => {
  beforeEach(() => {
    vi.resetModules();
    // clearAllMocks resets call history only. Per-test overrides must use
    // mockResolvedValueOnce / mockRejectedValueOnce so they expire after
    // one call and do not bleed into subsequent tests.
    vi.clearAllMocks();
  });

  // ===========================================================================
  // System defaults — localhost
  // ===========================================================================

  describe('system default: localhost', () => {
    it('allows OPTIONS preflight from localhost:3000 even when not in CORS_ORIGINS', async () => {
      const module = await import('../../src/index');
      const request = new Request('https://api.example.com/health', {
        method: 'OPTIONS',
        headers: { 'Origin': 'http://localhost:3000' },
      });
      const response = await module.default.fetch(request, mockEnv, mockContext);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('allows OPTIONS preflight from localhost:8787 even when not in CORS_ORIGINS', async () => {
      const module = await import('../../src/index');
      const request = new Request('https://api.example.com/health', {
        method: 'OPTIONS',
        headers: { 'Origin': 'http://localhost:8787' },
      });
      const response = await module.default.fetch(request, mockEnv, mockContext);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('adds CORS headers to GET /health from localhost', async () => {
      const module = await import('../../src/index');
      const request = new Request('https://api.example.com/health', {
        headers: { 'Origin': 'http://localhost:5173' },
      });
      const response = await module.default.fetch(request, mockEnv, mockContext);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  // ===========================================================================
  // Default open: wildcard allows all origins when no allowed_origins set
  // ===========================================================================

  describe('default open (no allowed_origins configured)', () => {
    it('allows OPTIONS preflight from any domain by default', async () => {
      const module = await import('../../src/index');
      const request = new Request('https://api.example.com/health', {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://rko2026.pantheon.io' },
      });
      const response = await module.default.fetch(request, mockEnv, mockContext);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('allows *.pantheonsite.io by default (wildcard covers it)', async () => {
      const module = await import('../../src/index');
      const request = new Request('https://api.example.com/health', {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://mysite.pantheonsite.io' },
      });
      const response = await module.default.fetch(request, mockEnv, mockContext);
      expect(response.status).toBe(204);
    });
  });

  // ===========================================================================
  // Per-site custom domains
  // ===========================================================================

  describe('per-site allowed_origins', () => {
    it('allows a preflight from a custom domain in the site allowed_origins', async () => {
      const siteService = await import('../../src/services/site-service');
      vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValueOnce(['https://www.custom-domain.com']);

      const module = await import('../../src/index');
      const siteId = 'test-site-id-123';
      const request = new Request(`https://api.example.com/api/sites/${siteId}`, {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://www.custom-domain.com' },
      });
      const response = await module.default.fetch(request, mockEnv, mockContext);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://www.custom-domain.com');
    });

    it('blocks a preflight from a custom domain NOT in the site allowed_origins', async () => {
      const siteService = await import('../../src/services/site-service');
      vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValueOnce(['https://www.allowed-domain.com']);

      const module = await import('../../src/index');
      const siteId = 'test-site-id-123';
      const request = new Request(`https://api.example.com/api/sites/${siteId}`, {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://www.unlisted-domain.com' },
      });
      const response = await module.default.fetch(request, mockEnv, mockContext);
      expect(response.status).toBe(403);
    });

    it('falls back gracefully when getSiteAllowedOrigins returns null', async () => {
      const siteService = await import('../../src/services/site-service');
      // null = site not found; should not crash, should use system defaults only
      vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValueOnce(null);

      const module = await import('../../src/index');
      const siteId = 'nonexistent-site';
      const request = new Request(`https://api.example.com/api/sites/${siteId}`, {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://mysite.pantheon.io' },
      });
      const response = await module.default.fetch(request, mockEnv, mockContext);
      // System default (*.pantheon.io) still works even when site not found
      expect(response.status).toBe(204);
    });

    it('falls back to wildcard (open) when getCachedSiteAllowedOrigins throws', async () => {
      const siteService = await import('../../src/services/site-service');
      vi.mocked(siteService.getCachedSiteAllowedOrigins).mockRejectedValueOnce(new Error('DB connection error'));

      const module = await import('../../src/index');
      const siteId = 'any-site';
      const request = new Request(`https://api.example.com/api/sites/${siteId}`, {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://any-domain.com' },
      });
      const response = await module.default.fetch(request, mockEnv, mockContext);
      // DB error → siteOrigins falls back to [] → wildcard (open default)
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  // ===========================================================================
  // Opted-in: when allowed_origins IS configured, wildcard is replaced
  // ===========================================================================

  describe('opted-in restriction', () => {
    it('blocks an origin not in the configured list', async () => {
      const siteService = await import('../../src/services/site-service');
      vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValueOnce(['https://www.allowed-domain.com']);

      const module = await import('../../src/index');
      const siteId = 'test-site-id-123';
      const request = new Request(`https://api.example.com/api/sites/${siteId}`, {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://www.unlisted-domain.com' },
      });
      const response = await module.default.fetch(request, mockEnv, mockContext);
      expect(response.status).toBe(403);
    });
  });
});
