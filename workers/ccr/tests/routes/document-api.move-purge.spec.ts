/**
 * A move on main rewrites live paths, so the edge has to be told: the old path
 * would keep serving cached content and the new one a cached 404. A move on a
 * workstream branch leaves the global path alone and must not purge.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makePrincipal } from '../helpers/principal';
import { makeBranch } from '../helpers/branch';
import type { DocumentRouteContext } from '../../src/routes/document-api';

vi.mock('../../src/services', async () => {
  const actual = await vi.importActual('../../src/services');
  return {
    ...actual,
    getBranch: vi.fn(),
    getMainBranch: vi.fn(),
    moveDocumentGlobally: vi.fn(),
    moveDocumentOnBranch: vi.fn(),
  };
});

const purgeContentCache = vi.hoisted(() => vi.fn());
const purgeDeletedDocument = vi.hoisted(() => vi.fn());
vi.mock('../../src/cache/purge', () => ({ purgeContentCache, purgeDeletedDocument }));

vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  getEffectiveRole: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    override name = 'AuthorizationError';
  },
}));

const DOCUMENT_ID = '44444444-4444-4444-4444-444444444444';
const MAIN_BRANCH_ID = '11111111-1111-1111-1111-111111111111';
const WORKSTREAM_ID = '22222222-2222-2222-2222-222222222222';

function context(branchId: string): DocumentRouteContext {
  return {
    siteId: 'site-1',
    branchId,
    documentId: DOCUMENT_ID,
    principal: makePrincipal({ id: 'user-1', type: 'user' }),
  };
}

function patch(): Request {
  return new Request(
    `https://api.example.com/api/sites/site-1/branches/branch/documents/${DOCUMENT_ID}`,
    { method: 'PATCH', body: JSON.stringify({ path: 'august/aug13' }) },
  );
}

describe('PATCH document path — edge cache purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('purges the site cache after a move on main', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValue(
      makeBranch({ id: MAIN_BRANCH_ID, siteId: 'site-1', name: 'main', isMain: true }),
    );
    vi.mocked(services.moveDocumentGlobally).mockResolvedValue({ movedCount: 3 });

    const response = await handleDocumentRoutes(patch(), context(MAIN_BRANCH_ID));

    expect(response.status).toBe(200);
    expect(services.moveDocumentGlobally).toHaveBeenCalledWith(DOCUMENT_ID, 'august/aug13');
    expect(purgeContentCache).toHaveBeenCalledWith({
      siteId: 'site-1',
      branchId: MAIN_BRANCH_ID,
      documentId: DOCUMENT_ID,
    });
  });

  it('does not purge after a move on a workstream branch', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValue(
      makeBranch({ id: WORKSTREAM_ID, siteId: 'site-1', name: 'ws', isMain: false }),
    );
    vi.mocked(services.moveDocumentOnBranch).mockResolvedValue({ movedCount: 1 });

    const response = await handleDocumentRoutes(patch(), context(WORKSTREAM_ID));

    expect(response.status).toBe(200);
    expect(services.moveDocumentOnBranch).toHaveBeenCalledWith(
      WORKSTREAM_ID,
      DOCUMENT_ID,
      'august/aug13',
    );
    expect(purgeContentCache).not.toHaveBeenCalled();
  });

  it('does not purge when the move fails', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValue(
      makeBranch({ id: MAIN_BRANCH_ID, siteId: 'site-1', name: 'main', isMain: true }),
    );
    vi.mocked(services.moveDocumentGlobally).mockRejectedValue(new Error('path taken'));

    const response = await handleDocumentRoutes(patch(), context(MAIN_BRANCH_ID));

    expect(response.status).toBe(500);
    expect(purgeContentCache).not.toHaveBeenCalled();
  });
});
