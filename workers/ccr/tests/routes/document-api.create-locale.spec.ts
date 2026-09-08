/**
 * A document's locale can be set when it is created, so a page authored in a
 * market locale records that locale from its first version rather than being
 * patched afterwards. The locale is independent of the localization edge: a
 * document carrying one is still a canonical until an edge points at it.
 *
 * The registry is not consulted. A locale only has to be a well-formed language
 * tag; bounding a picker to the site's markets is the editor's job.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makePrincipal } from '../helpers/principal';
import { makeBranch } from '../helpers/branch';
import type { CreateDocumentOnBranchResult } from '../../src/services/document-types';

vi.mock('../../src/services', async () => {
  const actual = await vi.importActual('../../src/services');
  return {
    ...actual,
    getBranch: vi.fn(),
    getMainBranch: vi.fn(),
    createDocumentOnBranch: vi.fn(),
    getLatestDocumentVersionWithFallback: vi.fn(),
    buildDocumentSkeletonFromTemplate: vi.fn(),
  };
});

vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  assertSiteBinding: vi.fn(),
  getEffectiveRole: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    override name = 'AuthorizationError';
  },
}));

const featureBranch = makeBranch({
  id: 'branch-1',
  siteId: 'site-1',
  name: 'feature',
  status: 'active',
  isMain: false,
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-01-24T10:00:00.000Z',
  updatedAt: '2026-01-24T10:00:00.000Z',
});

const mainBranch = makeBranch({
  id: 'main-branch',
  siteId: 'site-1',
  name: 'main',
  status: 'active',
  isMain: true,
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-01-24T10:00:00.000Z',
  updatedAt: '2026-01-24T10:00:00.000Z',
});

function createdResult(locale?: string): CreateDocumentOnBranchResult {
  return {
    document: {
      id: 'doc-new',
      siteId: 'site-1',
      path: 'pages/nouveau',
      ...(locale === undefined ? {} : { locale }),
      createdAt: '2026-01-24T12:00:00.000Z',
    },
    version: {
      id: 'version-1',
      documentId: 'doc-new',
      branchId: 'branch-1',
      versionNumber: 1,
      snapshot: {},
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: '2026-01-24T12:00:00.000Z',
    },
  };
}

function postCreateRequest(body: Record<string, unknown>): Request {
  return new Request(
    'https://api.example.com/api/sites/site-1/branches/branch-1/documents',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

const context = {
  siteId: 'site-1',
  branchId: 'branch-1',
  principal: makePrincipal({ id: 'user-1', type: 'user' }),
};

describe('POST create document with a locale', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('passes the locale to the create service', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(mainBranch);
    vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce(createdResult('fr-FR'));

    const response = await handleDocumentRoutes(
      postCreateRequest({ path: 'pages/nouveau', locale: 'fr-FR' }),
      context,
    );

    expect(response.status).toBe(201);
    expect(services.createDocumentOnBranch).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'fr-FR' }),
    );
  });

  it('normalizes nothing itself, forwarding the tag as sent', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(mainBranch);
    vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce(createdResult('he'));

    await handleDocumentRoutes(
      postCreateRequest({ path: 'pages/nouveau', locale: 'iw' }),
      context,
    );

    const params = vi.mocked(services.createDocumentOnBranch).mock.calls[0]?.[0];
    expect(params?.locale).toBe('iw');
  });

  it('creates a document with no locale when the body omits one', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(mainBranch);
    vi.mocked(services.createDocumentOnBranch).mockResolvedValueOnce(createdResult());

    const response = await handleDocumentRoutes(
      postCreateRequest({ path: 'pages/new-page' }),
      context,
    );

    expect(response.status).toBe(201);
    const params = vi.mocked(services.createDocumentOnBranch).mock.calls[0]?.[0];
    expect(params?.locale).toBeUndefined();
  });

  it('answers 400 when the service rejects the language tag', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.getMainBranch).mockResolvedValueOnce(mainBranch);
    vi.mocked(services.createDocumentOnBranch).mockRejectedValueOnce(
      new services.InvalidLocaleError('not a locale'),
    );

    const response = await handleDocumentRoutes(
      postCreateRequest({ path: 'pages/nouveau', locale: 'not a locale' }),
      context,
    );

    expect(response.status).toBe(400);
  });
});
