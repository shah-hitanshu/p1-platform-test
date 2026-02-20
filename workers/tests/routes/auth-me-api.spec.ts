/**
 * Tests for GET /api/auth/me endpoint.
 *
 * Validates that the endpoint returns authenticated principal info
 * and rejects unauthenticated requests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';

// Mock the database
vi.mock('../../src/db', () => ({
  initializeDatabaseFromConnectionString: vi.fn(),
  runWithConnection: vi.fn().mockImplementation((_connStr: string, _opts: unknown, fn: () => unknown) => fn()),
  query: vi.fn().mockResolvedValue({ rows: [{ now: new Date().toISOString() }] }),
}));

// Mock all route handlers (not under test, but required by index.ts imports)
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

// Mock metrics (not under test)
vi.mock('../../src/services/metrics-service', () => ({
  initializeMetrics: vi.fn(),
  incrementCounter: vi.fn(),
  recordTiming: vi.fn(),
  setGauge: vi.fn(),
  flushMetrics: vi.fn(),
  normalizePathPattern: vi.fn().mockReturnValue('/api/auth/me'),
  classifyError: vi.fn().mockReturnValue('unknown'),
  getStatusClass: vi.fn().mockReturnValue('2xx'),
}));

const mockTokenPrincipal: AuthenticatedPrincipal = {
  id: '11111111-1111-1111-1111-111111111111',
  type: 'user',
  email: 'alice@example.com',
  name: 'Alice Developer',
  avatarUrl: 'https://example.com/alice.jpg',
  authProvider: 'mock',
  pantheonSiteRoles: { 'site-123': 'admin' },
  tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  providerSubjectId: 'mock-subject-alice',
};

// Track whether the mock should return a principal or null
let shouldAuthenticate = true;

vi.mock('../../src/auth/mock-identity-provider', () => {
  return {
    MockIdentityProvider: class MockIdentityProvider {
      validateToken = vi.fn().mockImplementation(() =>
        Promise.resolve(shouldAuthenticate ? { ...mockTokenPrincipal } : null),
      );
      validateAgentKey = vi.fn().mockResolvedValue(null);
      getUser = vi.fn().mockReturnValue({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'alice@example.com',
        name: 'Alice Developer',
        siteRoles: { 'site-123': 'admin' },
      });
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

describe('GET /api/auth/me', () => {
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
    shouldAuthenticate = true;
  });

  it('should return 401 when no token is provided', async () => {
    shouldAuthenticate = false;

    const module = await import('../../src/index');
    const request = new Request('https://api.example.com/api/auth/me', {
      method: 'GET',
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(401);
    const body: { error: string } = await response.json();
    expect(body.error).toBe('Authentication required');
  });

  it('should return 401 when an invalid token is provided', async () => {
    shouldAuthenticate = false;

    const module = await import('../../src/index');
    const request = new Request('https://api.example.com/api/auth/me', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer invalid-token',
      },
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(401);
    const body: { error: string } = await response.json();
    expect(body.error).toBe('Authentication required');
  });

  it('should return principal info for a valid token', async () => {
    shouldAuthenticate = true;

    const module = await import('../../src/index');
    const request = new Request('https://api.example.com/api/auth/me', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer valid-mock-token',
      },
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(200);
    const body: Record<string, unknown> = await response.json();
    expect(body.id).toBe(mockTokenPrincipal.id);
    expect(body.type).toBe(mockTokenPrincipal.type);
    expect(body.email).toBe(mockTokenPrincipal.email);
    expect(body.name).toBe(mockTokenPrincipal.name);
    expect(body.avatarUrl).toBe(mockTokenPrincipal.avatarUrl);
    expect(body.authProvider).toBe(mockTokenPrincipal.authProvider);
    expect(body.tokenExpiry).toBe(mockTokenPrincipal.tokenExpiry);
    expect(body.providerSubjectId).toBe(mockTokenPrincipal.providerSubjectId);
  });

  it('should return only the expected principal fields', async () => {
    shouldAuthenticate = true;

    const module = await import('../../src/index');
    const request = new Request('https://api.example.com/api/auth/me', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer valid-mock-token',
      },
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(200);
    const body: Record<string, unknown> = await response.json();
    const keys = Object.keys(body);
    expect(keys).toEqual(
      expect.arrayContaining(['id', 'type', 'email', 'name', 'avatarUrl', 'authProvider', 'tokenExpiry', 'providerSubjectId']),
    );
    // Should NOT include sensitive fields like pantheonSiteRoles or scopes
    expect(body).not.toHaveProperty('pantheonSiteRoles');
    expect(body).not.toHaveProperty('scopes');
    expect(body).not.toHaveProperty('organizationId');
  });

  it('should include CORS headers in the response', async () => {
    shouldAuthenticate = true;

    const module = await import('../../src/index');
    const request = new Request('https://api.example.com/api/auth/me', {
      method: 'GET',
      headers: {
        'Origin': 'http://localhost:5173',
        'Authorization': 'Bearer valid-mock-token',
      },
    });

    const response = await module.default.fetch(request, mockEnv, mockContext);

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });
});
