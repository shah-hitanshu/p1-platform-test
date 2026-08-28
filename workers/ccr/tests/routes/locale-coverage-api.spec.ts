/**
 * Branch locale coverage route: any principal that can view the branch reads, in
 * one request, which canonical documents hold which locale variants and the
 * distinct locales across them. The route is read-only and scoped to the branch's
 * own site.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRoute } from '../../src/routes/route-parser';
import { readJson } from '../helpers/http';

vi.mock('../../src/services', () => ({
  getBranch: vi.fn(),
  getBranchLocaleCoverage: vi.fn(),
}));

vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
}));

import { handleLocaleCoverageRoutes } from '../../src/routes/locale-coverage-api';
import { getBranch, getBranchLocaleCoverage } from '../../src/services';
import { assertPermission } from '../../src/auth/authorization';
import { HttpError } from '../../src/services/errors';
import type { AuthenticatedPrincipal } from '../../src/types';
import type { LocaleCoverage } from '../../src/services/locale-coverage-service';

const SITE_ID = 'site-1';
const BRANCH_ID = '11111111-2222-3333-4444-555555555555';
const CANONICAL_ID = '22222222-2222-2222-2222-222222222222';

const userPrincipal = { id: 'user-1', type: 'user' } as unknown as AuthenticatedPrincipal;

/** Stands in for any service error carrying its own status. */
class StatusError extends HttpError {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const coverage: LocaleCoverage = {
  locales: ['de-DE', 'fr'],
  coverage: [
    {
      canonicalDocumentId: CANONICAL_ID,
      variants: [
        { locale: 'de-DE', documentId: '33333333-3333-3333-3333-333333333333', path: 'about.de-DE' },
        { locale: 'fr', documentId: '44444444-4444-4444-4444-444444444444', path: 'about.fr' },
      ],
    },
  ],
};

function coverageRequest(method = 'GET'): Request {
  return new Request(
    `https://api.example.com/api/sites/${SITE_ID}/branches/${BRANCH_ID}/locale-coverage`,
    { method },
  );
}

function context(
  principal: AuthenticatedPrincipal = userPrincipal,
): { siteId: string; branchId: string; principal: AuthenticatedPrincipal } {
  return { siteId: SITE_ID, branchId: BRANCH_ID, principal };
}

describe('parseRoute - locale coverage route', () => {
  it('parses the branch locale coverage route to its own handler', () => {
    const result = parseRoute(`/api/sites/${SITE_ID}/branches/${BRANCH_ID}/locale-coverage`);
    expect(result).toEqual({
      handler: 'locale-coverage',
      params: { siteId: SITE_ID, branchId: BRANCH_ID },
    });
  });
});

describe('GET locale-coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBranch).mockResolvedValue({ id: BRANCH_ID, siteId: SITE_ID } as never);
  });

  it('returns each canonical with its variants and the distinct locales', async () => {
    vi.mocked(getBranchLocaleCoverage).mockResolvedValueOnce(coverage);

    const response = await handleLocaleCoverageRoutes(coverageRequest(), context());

    expect(response.status).toBe(200);
    const body = await readJson<LocaleCoverage>(response);
    expect(body.locales).toEqual(['de-DE', 'fr']);
    expect(body.coverage).toHaveLength(1);
    expect(body.coverage[0].canonicalDocumentId).toBe(CANONICAL_ID);
    expect(body.coverage[0].variants.map((variant) => variant.locale)).toEqual(['de-DE', 'fr']);
    expect(vi.mocked(getBranchLocaleCoverage).mock.calls[0]?.[0].id).toBe(BRANCH_ID);
  });

  it('returns an empty coverage listing for a branch holding no translations', async () => {
    vi.mocked(getBranchLocaleCoverage).mockResolvedValueOnce({ locales: [], coverage: [] });

    const response = await handleLocaleCoverageRoutes(coverageRequest(), context());

    expect(response.status).toBe(200);
    const body = await readJson<LocaleCoverage>(response);
    expect(body).toEqual({ locales: [], coverage: [] });
  });

  it('requires only view access on the branch', async () => {
    vi.mocked(getBranchLocaleCoverage).mockResolvedValueOnce({ locales: [], coverage: [] });

    await handleLocaleCoverageRoutes(coverageRequest(), context());

    expect(vi.mocked(assertPermission).mock.calls[0]).toEqual([
      userPrincipal,
      SITE_ID,
      BRANCH_ID,
      'canView',
    ]);
  });

  it('returns 403 when the principal cannot view the branch', async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new StatusError('Insufficient permissions', 403),
    );

    const response = await handleLocaleCoverageRoutes(coverageRequest(), context());

    expect(response.status).toBe(403);
    expect(getBranchLocaleCoverage).not.toHaveBeenCalled();
  });

  it('returns 404 when the branch belongs to another site', async () => {
    vi.mocked(getBranch).mockResolvedValueOnce({ id: BRANCH_ID, siteId: 'site-2' } as never);

    const response = await handleLocaleCoverageRoutes(coverageRequest(), context());

    expect(response.status).toBe(404);
    // The permission check reports no access on a foreign branch, so reaching it
    // first would serve a 403 in place of this 404.
    expect(assertPermission).not.toHaveBeenCalled();
    expect(getBranchLocaleCoverage).not.toHaveBeenCalled();
  });

  it('returns 404 when the branch does not exist', async () => {
    vi.mocked(getBranch).mockResolvedValueOnce(null);

    const response = await handleLocaleCoverageRoutes(coverageRequest(), context());

    expect(response.status).toBe(404);
    expect(getBranchLocaleCoverage).not.toHaveBeenCalled();
  });

  it('serves a service error at the status it carries rather than as a 500', async () => {
    vi.mocked(getBranchLocaleCoverage).mockRejectedValueOnce(
      new StatusError('Branch not found', 404),
    );

    const response = await handleLocaleCoverageRoutes(coverageRequest(), context());

    expect(response.status).toBe(404);
  });

  it('serves an unrecognised failure as a 500', async () => {
    vi.mocked(getBranchLocaleCoverage).mockRejectedValueOnce(new Error('connection reset'));

    const response = await handleLocaleCoverageRoutes(coverageRequest(), context());

    expect(response.status).toBe(500);
  });

  it('rejects a non-GET method with 405', async () => {
    const response = await handleLocaleCoverageRoutes(coverageRequest('POST'), context());

    expect(response.status).toBe(405);
    expect(getBranchLocaleCoverage).not.toHaveBeenCalled();
  });
});
