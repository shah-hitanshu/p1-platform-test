/**
 * The worker forwards the resolved `dbUserId` (app.users.id) to the
 * DocumentSession DO so publish and sync attribute to a real users row.
 * Presence identity keeps using the OAuth subject (`_verifiedActorId`);
 * attribution is a separate channel.
 *
 * The forwarded value is a worker-derived authority, so client-supplied copies
 * are stripped first, like the other verified-identity fields.
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

vi.mock('../../src/services/document-service', () => ({
  getDocumentByPath: vi.fn(),
}));

vi.mock('../../src/auth/authorization', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/services/branch-service', () => ({
  getBranch: vi.fn(),
  getBranchByName: vi.fn(),
}));

vi.mock('../../src/services/site-service', () => ({
  getCachedSiteAllowedOrigins: vi.fn().mockResolvedValue([]),
}));

import * as documentService from '../../src/services/document-service';
import { hasPermission } from '../../src/auth/authorization';
import { getBranch } from '../../src/services/branch-service';
import type { RealtimeRouteContext } from '../../src/routes/realtime-api';
import type { AuthenticatedPrincipal } from '../../src/types';

const SITE_ID = 'b4ce1f14-c196-4ac1-a287-68f90e321f18';
const DOC_ID = '8ee9eead-8849-4338-9763-6f822bbfdc84';
const RAW_SUBJECT = 'google-oauth2|107221644627712432289';
const DB_USER_ID = '02588e62-6dd1-545c-88c4-9a127fafba3f';

/** Broker-shaped principal: id is the raw OAuth subject, but the allowlist has
 * already resolved dbUserId to the users row. */
const principalWithDbUserId: AuthenticatedPrincipal = {
  id: RAW_SUBJECT,
  type: 'user',
  dbUserId: DB_USER_ID,
  pantheonSiteRoles: { [SITE_ID]: 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'broker',
};

/** Same shape but never resolved (no users row / no email) — dbUserId absent. */
const principalNoDbUserId: AuthenticatedPrincipal = {
  id: RAW_SUBJECT,
  type: 'user',
  pantheonSiteRoles: { [SITE_ID]: 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'broker',
};

interface CapturedRequest {
  headers: Headers;
  url: string;
}

function makeEnv(): { env: Record<string, unknown>; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const stub = {
    fetch: vi.fn().mockImplementation((req: Request) => {
      captured.push({ headers: req.headers, url: req.url });
      return Promise.resolve(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  };
  const env = {
    ENVIRONMENT: 'test',
    DOCUMENT_STATE: {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-do-id' }),
      get: vi.fn().mockReturnValue(stub),
    },
    POSTGRES_CONNECTION_STRING: 'postgresql://test:test@localhost/test',
  };
  return { env, captured };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hasPermission).mockResolvedValue(true);
  vi.mocked(documentService.getDocumentByPath).mockResolvedValue({
    id: DOC_ID,
    siteId: SITE_ID,
    path: 'home',
    createdAt: new Date().toISOString(),
    archivedAt: null,
  });
  vi.mocked(getBranch).mockResolvedValue({
    id: SITE_ID,
    siteId: SITE_ID,
    name: 'main',
    status: 'active',
    isMain: true,
    createdById: DB_USER_ID,
    createdByType: 'user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  });
});

describe('dbUserId forwarding to the DocumentSession DO', () => {
  it('sets _verifiedDbUserId from the principal on the WebSocket path', async () => {
    const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
    const { env, captured } = makeEnv();

    const request = new Request(
      `https://example.com/api/sites/${SITE_ID}/branches/${SITE_ID}/documents/home/connect` +
        `?actorId=${encodeURIComponent(RAW_SUBJECT)}&actorType=user`,
      { method: 'GET', headers: { Upgrade: 'websocket' } },
    );

    const context: RealtimeRouteContext = { principal: principalWithDbUserId };
    await handleRealtimeRoutes(request, env as never, context);

    expect(captured).toHaveLength(1);
    const forwardedUrl = new URL(captured[0].url);
    // Presence identity stays the subject; attribution carries the users.id.
    expect(forwardedUrl.searchParams.get('_verifiedActorId')).toBe(RAW_SUBJECT);
    expect(forwardedUrl.searchParams.get('_verifiedDbUserId')).toBe(DB_USER_ID);
  });

  it('overrides a client-supplied _verifiedDbUserId with the worker value', async () => {
    const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
    const { env, captured } = makeEnv();

    const request = new Request(
      `https://example.com/api/sites/${SITE_ID}/branches/${SITE_ID}/documents/home/connect` +
        `?actorId=${encodeURIComponent(RAW_SUBJECT)}&actorType=user` +
        '&_verifiedDbUserId=11111111-1111-1111-1111-111111111111',
      { method: 'GET', headers: { Upgrade: 'websocket' } },
    );

    const context: RealtimeRouteContext = { principal: principalWithDbUserId };
    await handleRealtimeRoutes(request, env as never, context);

    const forwardedUrl = new URL(captured[0].url);
    expect(forwardedUrl.searchParams.get('_verifiedDbUserId')).toBe(DB_USER_ID);
  });

  it('omits _verifiedDbUserId (even a forged one) when the principal has no dbUserId', async () => {
    const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
    const { env, captured } = makeEnv();

    const request = new Request(
      `https://example.com/api/sites/${SITE_ID}/branches/${SITE_ID}/documents/home/connect` +
        `?actorId=${encodeURIComponent(RAW_SUBJECT)}&actorType=user` +
        '&_verifiedDbUserId=11111111-1111-1111-1111-111111111111',
      { method: 'GET', headers: { Upgrade: 'websocket' } },
    );

    const context: RealtimeRouteContext = { principal: principalNoDbUserId };
    await handleRealtimeRoutes(request, env as never, context);

    const forwardedUrl = new URL(captured[0].url);
    expect(forwardedUrl.searchParams.get('_verifiedDbUserId')).toBeNull();
  });

  it('sets X-Verified-Db-User-Id from the principal on the HTTP path', async () => {
    const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
    const { env, captured } = makeEnv();

    const request = new Request(
      `https://example.com/api/sites/${SITE_ID}/branches/${SITE_ID}/documents/home`,
      {
        method: 'GET',
        headers: { 'X-Verified-Db-User-Id': '11111111-1111-1111-1111-111111111111' },
      },
    );

    const context: RealtimeRouteContext = { principal: principalWithDbUserId };
    await handleRealtimeRoutes(request, env as never, context);

    expect(captured).toHaveLength(1);
    // Worker value wins over the forged client header.
    expect(captured[0].headers.get('X-Verified-Db-User-Id')).toBe(DB_USER_ID);
  });

  it('strips a forged X-Verified-Db-User-Id when the principal has no dbUserId', async () => {
    const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
    const { env, captured } = makeEnv();

    const request = new Request(
      `https://example.com/api/sites/${SITE_ID}/branches/${SITE_ID}/documents/home`,
      {
        method: 'GET',
        headers: { 'X-Verified-Db-User-Id': '11111111-1111-1111-1111-111111111111' },
      },
    );

    const context: RealtimeRouteContext = { principal: principalNoDbUserId };
    await handleRealtimeRoutes(request, env as never, context);

    expect(captured[0].headers.get('X-Verified-Db-User-Id')).toBeNull();
  });
});
