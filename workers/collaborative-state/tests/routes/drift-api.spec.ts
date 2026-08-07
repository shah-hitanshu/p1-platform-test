/**
 * Branch drift route: an admin can list, in one request, every translation on a
 * branch that has drifted from its canonical source, each carrying the classified
 * counts needed to render a collapsed row. The route is read-only, admin-gated,
 * and validates the relation type.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRoute } from '../../src/routes/route-parser';
import { readJson } from '../helpers/http';

vi.mock('../../src/services', () => ({
  listBranchDrift: vi.fn(),
}));

vi.mock('../../src/auth/authorization', () => ({
  getEffectiveRole: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    override name = 'AuthorizationError';
  },
}));

import { handleDriftRoutes } from '../../src/routes/drift-api';
import { listBranchDrift } from '../../src/services';
import { DEFAULT_DRIFT_LIMIT, MAX_DRIFT_LIMIT } from '../../src/services/branch-drift-service';
import { getEffectiveRole } from '../../src/auth/authorization';
import type { AuthenticatedPrincipal } from '../../src/types';

const SITE_ID = 'site-1';
const BRANCH_ID = '11111111-2222-3333-4444-555555555555';

const userPrincipal = { id: 'user-1', type: 'user' } as unknown as AuthenticatedPrincipal;

const driftEntry = {
  documentId: '22222222-2222-2222-2222-222222222222',
  path: 'pages/product',
  locale: 'fr-FR',
  targetDocumentId: '33333333-3333-3333-3333-333333333333',
  counts: { structural: 1, prop: 0, advisory: 0, needsTranslation: 2, autoApplied: 1 },
  total: 4,
};

function driftPage(
  drift: (typeof driftEntry)[],
  overrides: { limit?: number; offset?: number; hasMore?: boolean } = {},
): { drift: (typeof driftEntry)[]; limit: number; offset: number; hasMore: boolean } {
  return {
    drift,
    limit: overrides.limit ?? DEFAULT_DRIFT_LIMIT,
    offset: overrides.offset ?? 0,
    hasMore: overrides.hasMore ?? false,
  };
}

function driftRequest(query = '', method = 'GET'): Request {
  return new Request(
    `https://api.example.com/api/sites/${SITE_ID}/branches/${BRANCH_ID}/drift${query}`,
    { method },
  );
}

function context(
  principal: AuthenticatedPrincipal = userPrincipal,
): { siteId: string; branchId: string; principal: AuthenticatedPrincipal } {
  return { siteId: SITE_ID, branchId: BRANCH_ID, principal };
}

describe('parseRoute - drift route', () => {
  it('parses the branch drift route to the drift handler', () => {
    const result = parseRoute(`/api/sites/${SITE_ID}/branches/${BRANCH_ID}/drift`);
    expect(result).toEqual({
      handler: 'drift',
      params: {
        siteId: SITE_ID,
        branchId: BRANCH_ID,
      },
    });
  });
});

describe('GET drift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEffectiveRole).mockResolvedValue({ roleName: 'ADMIN' } as never);
  });

  it('returns the drifted translations for the requested relation type', async () => {
    vi.mocked(listBranchDrift).mockResolvedValueOnce(driftPage([driftEntry]));

    const response = await handleDriftRoutes(
      driftRequest('?relationType=localization'),
      context(),
    );

    expect(response.status).toBe(200);
    const body = await readJson<ReturnType<typeof driftPage>>(response);
    expect(body.drift).toHaveLength(1);
    expect(body.drift[0].locale).toBe('fr-FR');
    expect(body.drift[0].total).toBe(4);

    const callArgs = vi.mocked(listBranchDrift).mock.calls[0];
    expect(callArgs?.[0]).toBe(BRANCH_ID);
    expect(callArgs?.[1]).toBe('localization');
  });

  it('defaults to the localization relation when none is given', async () => {
    vi.mocked(listBranchDrift).mockResolvedValueOnce(driftPage([]));

    const response = await handleDriftRoutes(driftRequest(), context());

    expect(response.status).toBe(200);
    expect(vi.mocked(listBranchDrift).mock.calls[0]?.[1]).toBe('localization');
  });

  it('returns an empty list for a branch with no drifted translations', async () => {
    vi.mocked(listBranchDrift).mockResolvedValueOnce(driftPage([]));

    const response = await handleDriftRoutes(driftRequest(), context());

    expect(response.status).toBe(200);
    const body = await readJson<ReturnType<typeof driftPage>>(response);
    expect(body.drift).toEqual([]);
  });

  it('rejects an unknown relation type with 400', async () => {
    const response = await handleDriftRoutes(driftRequest('?relationType=bogus'), context());

    expect(response.status).toBe(400);
    expect(listBranchDrift).not.toHaveBeenCalled();
  });

  it('returns 403 when the principal is not a site admin', async () => {
    vi.mocked(getEffectiveRole).mockResolvedValueOnce({ roleName: 'EDITOR' } as never);

    const response = await handleDriftRoutes(driftRequest(), context());

    expect(response.status).toBe(403);
    expect(listBranchDrift).not.toHaveBeenCalled();
  });

  it('rejects a non-GET method with 405', async () => {
    const response = await handleDriftRoutes(driftRequest('', 'POST'), context());

    expect(response.status).toBe(405);
    expect(listBranchDrift).not.toHaveBeenCalled();
  });

  it('forwards the requested page bounds and reports them back', async () => {
    vi.mocked(listBranchDrift).mockResolvedValueOnce(
      driftPage([driftEntry], { limit: 10, offset: 20, hasMore: true }),
    );

    const response = await handleDriftRoutes(driftRequest('?limit=10&offset=20'), context());

    expect(response.status).toBe(200);
    const body = await readJson<ReturnType<typeof driftPage>>(response);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(20);
    expect(body.hasMore).toBe(true);
    expect(vi.mocked(listBranchDrift).mock.calls[0]?.[2]).toEqual({ limit: 10, offset: 20 });
  });

  it('leaves the page bounds to the listing when neither param is given', async () => {
    vi.mocked(listBranchDrift).mockResolvedValueOnce(driftPage([]));

    await handleDriftRoutes(driftRequest(), context());

    expect(vi.mocked(listBranchDrift).mock.calls[0]?.[2]).toEqual({
      limit: undefined,
      offset: undefined,
    });
  });

  it('rejects a limit above the maximum with 400', async () => {
    const response = await handleDriftRoutes(
      driftRequest(`?limit=${String(MAX_DRIFT_LIMIT + 1)}`),
      context(),
    );

    expect(response.status).toBe(400);
    expect(listBranchDrift).not.toHaveBeenCalled();
  });
});
