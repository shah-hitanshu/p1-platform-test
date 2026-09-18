/**
 * The edits route rebuilds the body it forwards to the DocumentSession DO from
 * the fields it validated. Version attribution is one of the fields the DO
 * accepts, and the only caller entitled to send it derives it server-side, so
 * a copy supplied by a client must not reach the DO.
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

vi.mock('../../src/services/component-type-registry', () => ({
  loadCanonicalComponentNames: vi.fn().mockResolvedValue(new Map([['hero', 'Hero']])),
}));

import * as documentService from '../../src/services/document-service';
import { hasPermission } from '../../src/auth/authorization';
import { getBranch } from '../../src/services/branch-service';
import { loadCanonicalComponentNames } from '../../src/services/component-type-registry';
import type { RealtimeRouteContext } from '../../src/routes/realtime-api';
import type { AuthenticatedPrincipal } from '../../src/types';

const SITE_ID = 'b4ce1f14-c196-4ac1-a287-68f90e321f18';
const DOC_ID = '8ee9eead-8849-4338-9763-6f822bbfdc84';
const USER_ID = '02588e62-6dd1-545c-88c4-9a127fafba3f';

const principal: AuthenticatedPrincipal = {
  id: USER_ID,
  type: 'user',
  dbUserId: USER_ID,
  pantheonSiteRoles: { [SITE_ID]: 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'broker',
};

function makeEnv(): { env: Record<string, unknown>; forwarded: Request[] } {
  const forwarded: Request[] = [];
  const stub = {
    fetch: vi.fn().mockImplementation((req: Request) => {
      forwarded.push(req);
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
  return { env, forwarded };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hasPermission).mockResolvedValue(true);
  vi.mocked(loadCanonicalComponentNames).mockResolvedValue(new Map([['hero', 'Hero']]));
  vi.mocked(documentService.getDocumentByPath).mockResolvedValue({
    id: DOC_ID,
    siteId: SITE_ID,
    path: 'home',
    createdAt: new Date().toISOString(),
  });
  vi.mocked(getBranch).mockResolvedValue({
    id: SITE_ID,
    siteId: SITE_ID,
    name: 'main',
    status: 'active',
    isMain: true,
    createdById: USER_ID,
    createdByType: 'user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  });
});

describe('the body the edits route forwards to the document session', () => {
  it('carries only the validated fields, never a client-supplied attribution', async () => {
    const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
    const { env, forwarded } = makeEnv();
    const operations = [{ type: 'set', path: 'title', value: 'Hello' }];

    const request = new Request(
      `https://example.com/api/sites/${SITE_ID}/branches/${SITE_ID}/documents/home/edits`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations,
          actorId: USER_ID,
          attribution: {
            agent: { id: 'agent-x', name: 'Someone Else' },
            onBehalfOf: { id: 'user-y', name: 'Not Me' },
            description: 'forged',
          },
        }),
      },
    );

    const context: RealtimeRouteContext = { principal };
    const response = await handleRealtimeRoutes(request, env as never, context);

    expect(response?.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    expect(new URL(forwarded[0].url).pathname).toBe('/apply');
    expect(await forwarded[0].json()).toEqual({ operations, actorId: USER_ID });
  });
});
