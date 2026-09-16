/**
 * Main-branch scope enforcement for site API tokens [PCC-3898].
 *
 * `?branch=` accepts a UUID or a branch name, so the parameter's text cannot
 * say whether it names main. Classifying every value as non-main denied
 * `?branch=main` on published content a read:published token is entitled to.
 * These pin down the resolved classification and, just as importantly, which
 * requests are answered without paying for the lookup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../../src/env';

const cachedContent = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class WorkflowEntrypoint {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
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
  // Both the PCC-3676 member gate and the PCC-3898 scope check resolve a
  // ?branch= ref through this.
  resolveBranch: vi.fn(),
}));

const mockSatValidateToken = vi.fn();
vi.mock('../../src/services/site-api-token-service', () => ({
  validateToken: mockSatValidateToken,
  generateToken: vi.fn(),
  listTokens: vi.fn().mockResolvedValue([]),
  revokeToken: vi.fn(),
}));

const SITE = 'site-aaa';
const MAIN_BRANCH_ID = '11111111-2222-3333-4444-555555555555';
const FEATURE_BRANCH_ID = '99999999-8888-7777-6666-555555555555';

const MAIN_BRANCH = { id: MAIN_BRANCH_ID, name: 'main', isMain: true };
const FEATURE_BRANCH = { id: FEATURE_BRANCH_ID, name: 'feature-x', isMain: false };

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

function tokenWithScopes(scopes: string[]) {
  return { tokenId: 'tok-1', siteId: SITE, scopes };
}

function request(path: string, branch?: string): Request {
  const url = new URL(`https://api.example.com/api/sites/${SITE}${path}`);
  if (branch !== undefined) url.searchParams.set('branch', branch);
  return new Request(url.toString(), {
    method: 'GET',
    headers: { 'X-API-Key': 'sat_readpublished' },
  });
}

const contentRequest = (branch?: string) => request('/content/home', branch);

describe('read:published branch classification', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockSatValidateToken.mockResolvedValue(tokenWithScopes(['read:published']));
    cachedContent.fetch.mockResolvedValue(
      new Response(JSON.stringify({ mock: 'cached-content' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('allows a read with no branch parameter, resolving nothing', async () => {
    const contentApi = await import('../../src/routes/content-api');
    const module = await import('../../src/index');

    const res = await module.default.fetch(contentRequest(), mockEnv, mockContext);

    expect(res.status).toBe(200);
    // The handlers default to main, so the common case stays query-free.
    expect(contentApi.resolveBranch).not.toHaveBeenCalled();
  });

  it('allows ?branch=main — the name resolves to the site\'s main branch', async () => {
    const contentApi = await import('../../src/routes/content-api');
    vi.mocked(contentApi.resolveBranch).mockResolvedValue(MAIN_BRANCH);
    const module = await import('../../src/index');

    const res = await module.default.fetch(contentRequest('main'), mockEnv, mockContext);

    expect(res.status).toBe(200);
    expect(contentApi.resolveBranch).toHaveBeenCalledTimes(1);
  });

  it('allows ?branch=<main branch uuid>', async () => {
    const contentApi = await import('../../src/routes/content-api');
    vi.mocked(contentApi.resolveBranch).mockResolvedValue(MAIN_BRANCH);
    const module = await import('../../src/index');

    const res = await module.default.fetch(
      contentRequest(MAIN_BRANCH_ID), mockEnv, mockContext,
    );

    expect(res.status).toBe(200);
  });

  it('denies ?branch=<non-main branch uuid> with a 403, before the handler', async () => {
    const contentApi = await import('../../src/routes/content-api');
    vi.mocked(contentApi.resolveBranch).mockResolvedValue(FEATURE_BRANCH);
    const module = await import('../../src/index');

    const res = await module.default.fetch(
      contentRequest(FEATURE_BRANCH_ID), mockEnv, mockContext,
    );

    expect(res.status).toBe(403);
    expect(cachedContent.fetch).not.toHaveBeenCalled();
    expect(contentApi.handleContentRoutes).not.toHaveBeenCalled();
  });

  it('denies an unresolvable ref with the same 403, not a 404', async () => {
    const contentApi = await import('../../src/routes/content-api');
    vi.mocked(contentApi.resolveBranch).mockResolvedValue(null);
    const module = await import('../../src/index');

    const res = await module.default.fetch(
      contentRequest('no-such-branch'), mockEnv, mockContext,
    );

    // Same status as a real non-main branch: the code must not tell a
    // published-only token which branch names exist.
    expect(res.status).toBe(403);
  });

  it('reports a failed lookup as a server error, not as a denial', async () => {
    const contentApi = await import('../../src/routes/content-api');
    vi.mocked(contentApi.resolveBranch).mockRejectedValue(new Error('pool exhausted'));
    const module = await import('../../src/index');

    const res = await module.default.fetch(contentRequest('main'), mockEnv, mockContext);

    expect(res.status).toBe(500);
  });
});

describe('branch resolution stays off requests that do not need it', () => {
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

  it('refuses a handler the scope never allows without resolving the branch', async () => {
    mockSatValidateToken.mockResolvedValue(tokenWithScopes(['read:published']));
    const contentApi = await import('../../src/routes/content-api');
    const module = await import('../../src/index');

    // read:published does not reach the documents handler on any branch, so the
    // refusal owes nothing to the ?branch= value.
    const res = await module.default.fetch(
      request('/documents/by-path/home', 'main'), mockEnv, mockContext,
    );

    expect(res.status).toBe(403);
    expect(contentApi.resolveBranch).not.toHaveBeenCalled();
  });

  it('does not resolve the branch for a scope that allows any branch', async () => {
    mockSatValidateToken.mockResolvedValue(tokenWithScopes(['read:all']));
    const contentApi = await import('../../src/routes/content-api');
    const module = await import('../../src/index');

    const res = await module.default.fetch(
      contentRequest(FEATURE_BRANCH_ID), mockEnv, mockContext,
    );

    expect(res.status).toBe(200);
    expect(contentApi.resolveBranch).not.toHaveBeenCalled();
  });

  it('takes the branch-agnostic clause when a token carries both scopes', async () => {
    mockSatValidateToken.mockResolvedValue(tokenWithScopes(['read:published', 'read:all']));
    const contentApi = await import('../../src/routes/content-api');
    const module = await import('../../src/index');

    const res = await module.default.fetch(
      contentRequest(FEATURE_BRANCH_ID), mockEnv, mockContext,
    );

    expect(res.status).toBe(200);
    expect(contentApi.resolveBranch).not.toHaveBeenCalled();
  });
});
