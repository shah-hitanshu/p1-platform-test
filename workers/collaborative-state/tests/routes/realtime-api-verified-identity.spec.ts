/**
 * PCC-3457 (review finding B1): client-forged verified-identity channels must
 * never reach the DocumentSession DO.
 *
 * WHY (Rule 9): verified identity (email/name) now feeds JIT user
 * provisioning at sync time — a forged X-Verified-Email is no longer a
 * cosmetic display-name spoof, it is a row-claiming credential (claiming a
 * pre-provisioned admin row = privilege escalation). The worker boundary must
 * therefore strip ALL inbound X-Verified-* headers and _verified* query
 * params before injecting the authenticated principal's values.
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

/** Principal WITHOUT email/name — the exact case where a conditional set()
 * would previously let a forged header/param survive. */
const principalNoEmail: AuthenticatedPrincipal = {
  id: '11111111-2222-3333-4444-555555555555',
  type: 'user',
  pantheonSiteRoles: { [SITE_ID]: 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'auth0',
};

interface CapturedRequest {
  headers: Headers;
  url: string;
}

function makeEnv(): {
  env: Record<string, unknown>;
  captured: CapturedRequest[];
  } {
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
    createdById: principalNoEmail.id,
    createdByType: 'user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  });
});

describe('PCC-3457 B1: verified-identity forgery channels are closed at the worker boundary', () => {
  it('strips client-supplied X-Verified-* headers on the HTTP path even when the principal lacks that field', async () => {
    const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
    const { env, captured } = makeEnv();

    const request = new Request(
      `https://example.com/api/sites/${SITE_ID}/branches/${SITE_ID}/documents/home`,
      {
        method: 'GET',
        headers: {
          // Forged by a malicious authenticated client:
          'X-Verified-Email': 'victim-admin@company.test',
          'X-Verified-Name': 'Victim Admin',
          'X-Verified-Actor-Id': 'some-other-actor',
        },
      },
    );

    const context: RealtimeRouteContext = { principal: principalNoEmail };
    await handleRealtimeRoutes(request, env as never, context);

    expect(captured).toHaveLength(1);
    const forwarded = captured[0];
    // The principal has no email/name, so after stripping there must be NO
    // email/name headers at all — the forgeries must not survive.
    expect(forwarded.headers.get('X-Verified-Email')).toBeNull();
    expect(forwarded.headers.get('X-Verified-Name')).toBeNull();
    // Actor id is always set from the authenticated principal, never the client.
    expect(forwarded.headers.get('X-Verified-Actor-Id')).toBe(principalNoEmail.id);
  });

  it('strips client-supplied _verified* query params on the WebSocket path', async () => {
    const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
    const { env, captured } = makeEnv();

    const request = new Request(
      `https://example.com/api/sites/${SITE_ID}/branches/${SITE_ID}/documents/home/connect` +
        `?actorId=${principalNoEmail.id}&actorType=user` +
        `&_verifiedEmail=${encodeURIComponent('victim-admin@company.test')}` +
        '&_verifiedActorId=some-other-actor',
      {
        method: 'GET',
        headers: { Upgrade: 'websocket' },
      },
    );

    const context: RealtimeRouteContext = { principal: principalNoEmail };
    await handleRealtimeRoutes(request, env as never, context);

    expect(captured).toHaveLength(1);
    const forwardedUrl = new URL(captured[0].url);
    // Principal has no email → after stripping, no _verifiedEmail at all.
    expect(forwardedUrl.searchParams.get('_verifiedEmail')).toBeNull();
    // Worker-derived identity wins over the client-supplied param.
    expect(forwardedUrl.searchParams.get('_verifiedActorId')).toBe(principalNoEmail.id);
  });
});
