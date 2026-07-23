/**
 * PCC-3458: Realtime DO session keys must use the canonical branch UUID
 *
 * WHY (Rule 9): the realtime route builds the DocumentState DO key as
 * `{siteId}:{documentId}:{branchRef}` with the branch ref EXACTLY as the
 * client sent it. A client passing the branch *name* (`main`) silently gets a
 * different Durable Object than the UUID-keyed one every other subsystem uses
 * (post-publish/merge /reload, CRDT loading, presence rollup). The name-keyed
 * orphan cannot load from Postgres (uuid cast fails on "main"), initializes
 * empty, and accepts whatever a client pushes — confirmed in production logs
 * during incident PCC-3464.
 *
 * Contract: the realtime route resolves the branch ref (name or UUID) to the
 * canonical branch UUID before generating the session key — the same
 * normalization content-api's resolveBranch performs — and rejects refs that
 * do not resolve to a branch of the requested site. One document+branch must
 * map to exactly one DO, no matter how the client spells the branch.
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

vi.mock('../../src/services/branch-service', () => ({
  getBranch: vi.fn(),
  getBranchByName: vi.fn(),
}));

vi.mock('../../src/auth/authorization', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

import * as documentService from '../../src/services/document-service';
import * as branchService from '../../src/services/branch-service';
import { hasPermission } from '../../src/auth/authorization';
import type { RealtimeRouteContext } from '../../src/routes/realtime-api';
import type { AuthenticatedPrincipal } from '../../src/types';

// Production-shaped identifiers (PCC-3462: fixtures mirror real data shapes).
const SITE_ID = 'b4ce1f14-c196-4ac1-a287-68f90e321f18';
const DOC_ID = '8ee9eead-8849-4338-9763-6f822bbfdc84';
const MAIN_BRANCH_ID = '23411882-fe64-481f-b972-a670d9a5ff67';
const OTHER_SITE_ID = '4568691f-2348-4258-8769-8f47654c260c';

const principal: AuthenticatedPrincipal = {
  id: '11111111-2222-3333-4444-555555555555',
  type: 'user',
  email: 'editor@example.test',
  pantheonSiteRoles: { [SITE_ID]: 'admin' },
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  authProvider: 'auth0',
};
const context: RealtimeRouteContext = { principal };

interface MockStub {
  fetch: ReturnType<typeof vi.fn>;
}

function makeEnv(): {
  env: {
    ENVIRONMENT: string;
    DOCUMENT_STATE: {
      idFromName: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
    };
    POSTGRES_CONNECTION_STRING: string;
  };
  stub: MockStub;
  } {
  const stub: MockStub = {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  };
  const env = {
    ENVIRONMENT: 'test',
    DOCUMENT_STATE: {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-do-id' }),
      get: vi.fn().mockReturnValue(stub),
    },
    POSTGRES_CONNECTION_STRING: 'postgresql://test:test@localhost/test',
  };
  return { env, stub };
}

const mainBranch = {
  id: MAIN_BRANCH_ID,
  siteId: SITE_ID,
  name: 'main',
  isMain: true,
  createdAt: new Date().toISOString(),
  archivedAt: null,
};

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
});

async function callRoute(branchRef: string): Promise<Response | null> {
  const { handleRealtimeRoutes } = await import('../../src/routes/realtime-api');
  const request = new Request(
    `https://example.com/api/sites/${SITE_ID}/branches/${encodeURIComponent(branchRef)}/documents/home`,
    { method: 'GET' },
  );
  return handleRealtimeRoutes(request, currentEnv.env, context);
}

let currentEnv: ReturnType<typeof makeEnv>;

describe('PCC-3458: branch-ref resolution in realtime DO session keys', () => {
  beforeEach(() => {
    currentEnv = makeEnv();
  });

  it('resolves a branch NAME to the canonical UUID-keyed session (same DO as the rest of the system)', async () => {
    vi.mocked(branchService.getBranchByName).mockResolvedValue(mainBranch);

    const response = await callRoute('main');

    expect(response?.status).toBe(200);
    expect(branchService.getBranchByName).toHaveBeenCalledWith(SITE_ID, 'main');
    // THE assertion of this ticket: the DO key carries the branch UUID,
    // never the literal name.
    expect(currentEnv.env.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith(
      `${SITE_ID}:${DOC_ID}:${MAIN_BRANCH_ID}`,
    );
  });

  it('keys by the same session for a UUID ref (name and UUID converge on one DO)', async () => {
    vi.mocked(branchService.getBranch).mockResolvedValue(mainBranch);

    const response = await callRoute(MAIN_BRANCH_ID);

    expect(response?.status).toBe(200);
    expect(currentEnv.env.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith(
      `${SITE_ID}:${DOC_ID}:${MAIN_BRANCH_ID}`,
    );
  });

  it('rejects an unknown branch name with 404 and never touches a DO', async () => {
    vi.mocked(branchService.getBranchByName).mockResolvedValue(null);

    const response = await callRoute('no-such-branch');

    expect(response?.status).toBe(404);
    expect(currentEnv.env.DOCUMENT_STATE.idFromName).not.toHaveBeenCalled();
  });

  it('rejects a branch UUID that does not exist with 404 and never touches a DO', async () => {
    vi.mocked(branchService.getBranch).mockResolvedValue(null);

    const response = await callRoute('99999999-9999-4999-8999-999999999999');

    expect(response?.status).toBe(404);
    expect(currentEnv.env.DOCUMENT_STATE.idFromName).not.toHaveBeenCalled();
  });

  it("rejects a branch belonging to a different site (cross-site guard, mirrors content-api's resolveBranch)", async () => {
    vi.mocked(branchService.getBranch).mockResolvedValue({
      ...mainBranch,
      siteId: OTHER_SITE_ID,
    });

    const response = await callRoute(MAIN_BRANCH_ID);

    expect(response?.status).toBe(404);
    expect(currentEnv.env.DOCUMENT_STATE.idFromName).not.toHaveBeenCalled();
  });
});
