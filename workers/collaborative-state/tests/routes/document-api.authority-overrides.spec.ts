/**
 * Authority-override routes: a translation exposes the per-prop authority map on
 * its localization edge, and lets an editor break (set) or reset (clear) a single
 * (slotId, propName) override. The routes guard the document to the branch, reject
 * a document that is not a translation, bound the keys they accept, and surface a
 * write the map's ceiling refused as a 400.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Authority } from '@pantheon-systems/p1-content-validator';
import { parseRoute } from '../../src/routes/route-parser';
import { makeBranch } from '../helpers/branch';
import { makePrincipal } from '../helpers/principal';
import { readJson } from '../helpers/http';
import type { DocumentRouteContext } from '../../src/routes/document-api';

vi.mock('../../src/services', () => ({
  getBranch: vi.fn(),
  getMainBranch: vi.fn(),
  getLocalizationEdgeBySource: vi.fn(),
  getAuthorityOverrides: vi.fn(),
  resolveSlotAuthorityDefaults: vi.fn(),
  authorityOverridesToJson: (
    overrides: Map<string, Map<string, string>>,
  ): Record<string, Record<string, string>> =>
    Object.fromEntries([...overrides].map(([slotId, props]) => [slotId, Object.fromEntries(props)])),
  setAuthorityOverride: vi.fn(),
  clearAuthorityOverride: vi.fn(),
  buildChangeSummary: vi.fn(),
  createTranslation: vi.fn(),
  listLocaleVariants: vi.fn(),
  createDocument: vi.fn(),
  getDocument: vi.fn(),
  getDocumentByPath: vi.fn(),
  updateDocumentPath: vi.fn(),
  archiveDocument: vi.fn(),
  restoreDocument: vi.fn(),
  listDocuments: vi.fn(),
  listDocumentsOnBranch: vi.fn(),
  createDocumentOnBranch: vi.fn(),
  documentExistsOnBranch: vi.fn(),
  deleteDocumentOnBranch: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
  getLatestDocumentVersionWithFallback: vi.fn(),
  getDocumentVersion: vi.fn(),
  listDocumentVersions: vi.fn(),
  createDocumentVersion: vi.fn(),
  reconstructVersionSnapshot: vi.fn(),
  publishDocument: vi.fn(),
  buildDocumentSkeletonFromTemplate: vi.fn(),
  PageConflictError: class PageConflictError extends Error {
    override name = 'PageConflictError';
  },
  RestoreVersionNotFoundError: class RestoreVersionNotFoundError extends Error {
    override name = 'RestoreVersionNotFoundError';
  },
  SiteNotFoundError: class SiteNotFoundError extends Error {
    override name = 'SiteNotFoundError';
  },
  DuplicateDocumentPathError: class DuplicateDocumentPathError extends Error {
    override name = 'DuplicateDocumentPathError';
  },
  InvalidDocumentPathError: class InvalidDocumentPathError extends Error {
    override name = 'InvalidDocumentPathError';
  },
  DocumentNotFoundError: class DocumentNotFoundError extends Error {
    override name = 'DocumentNotFoundError';
  },
  DocumentPathConflictError: class DocumentPathConflictError extends Error {
    override name = 'DocumentPathConflictError';
  },
  InvalidDocumentVersionParamsError: class InvalidDocumentVersionParamsError extends Error {
    override name = 'InvalidDocumentVersionParamsError';
  },
  TranslationAlreadyExistsError: class TranslationAlreadyExistsError extends Error {
    override name = 'TranslationAlreadyExistsError';
  },
  InvalidLocaleError: class InvalidLocaleError extends Error {
    override name = 'InvalidLocaleError';
  },
  CanonicalVersionNotFoundError: class CanonicalVersionNotFoundError extends Error {
    override name = 'CanonicalVersionNotFoundError';
  },
}));

vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  getEffectiveRole: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    override name = 'AuthorizationError';
  },
}));

vi.mock('./template-api', () => ({
  templateMetadata: vi.fn().mockReturnValue({}),
}));

const TRANSLATION_ID = '22222222-2222-2222-2222-222222222222';
const CANONICAL_ID = '33333333-3333-3333-3333-333333333333';

const featureBranch = makeBranch({
  id: 'branch-1',
  siteId: 'site-1',
  name: 'feature',
  isMain: false,
});

const localizationEdge = {
  id: 'edge-1',
  sourceDocumentId: TRANSLATION_ID,
  targetDocumentId: CANONICAL_ID,
  relationType: 'localization' as const,
  syncedVersion: 3,
  metadata: {},
  createdAt: '2026-01-24T11:00:00.000Z',
};

const overridesMap = new Map<string, Map<string, Authority>>([
  ['HeadingBlock-1', new Map([['title', 'locale']])],
  ['ImageBlock-1', new Map([['alt', 'canonical']])],
]);

const overridesJson = {
  'HeadingBlock-1': { title: 'locale' },
  'ImageBlock-1': { alt: 'canonical' },
};

function authorityOverridesUrl(): string {
  return `https://api.example.com/api/sites/site-1/branches/branch-1/documents/${TRANSLATION_ID}/authority-overrides`;
}

function getRequest(): Request {
  return new Request(authorityOverridesUrl(), { method: 'GET' });
}

function putRequest(body: Record<string, unknown>): Request {
  return new Request(authorityOverridesUrl(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deleteRequest(body: Record<string, unknown>): Request {
  return new Request(authorityOverridesUrl(), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const context: DocumentRouteContext = {
  siteId: 'site-1',
  branchId: 'branch-1',
  documentId: TRANSLATION_ID,
  action: 'authority-overrides' as const,
  principal: makePrincipal({ id: 'user-1', type: 'user' }),
};

describe('parseRoute - authority-overrides route', () => {
  it('parses the authority-overrides route to the documents handler', () => {
    const result = parseRoute(
      `/api/sites/site-1/branches/branch-1/documents/${TRANSLATION_ID}/authority-overrides`,
    );
    expect(result).toEqual({
      handler: 'documents',
      params: {
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: TRANSLATION_ID,
        action: 'authority-overrides',
      },
    });
  });
});

const requestByMethod = {
  GET: (): Request => getRequest(),
  PUT: (): Request => putRequest({ slotId: 'HeadingBlock-1', propName: 'title', authority: 'locale' }),
  DELETE: (): Request => deleteRequest({ slotId: 'ImageBlock-1', propName: 'alt' }),
} as const;

const METHODS = Object.keys(requestByMethod) as (keyof typeof requestByMethod)[];

describe('GET authority-overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the full authority-overrides map for the translation', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');
    const auth = await import('../../src/auth/authorization');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.getLocalizationEdgeBySource).mockResolvedValueOnce(localizationEdge);
    vi.mocked(services.getAuthorityOverrides).mockResolvedValueOnce(overridesMap);

    const response = await handleDocumentRoutes(getRequest(), context);

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.authorityOverrides).toEqual(overridesJson);

    expect(auth.assertPermission).toHaveBeenCalledWith(
      context.principal,
      'site-1',
      'branch-1',
      'canView',
    );
    expect(vi.mocked(services.getAuthorityOverrides).mock.calls[0]?.[0]).toBe(TRANSLATION_ID);
  });

  it('returns an empty map for a translation with no overrides', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.getLocalizationEdgeBySource).mockResolvedValueOnce(localizationEdge);
    vi.mocked(services.getAuthorityOverrides).mockResolvedValueOnce(new Map());

    const response = await handleDocumentRoutes(getRequest(), context);

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.authorityOverrides).toEqual({});
  });

});

describe('authority-overrides document guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const method of METHODS) {
    it(`answers ${method} with 404 when the document is not on this branch`, async () => {
      const { handleDocumentRoutes } = await import('../../src/routes/document-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
      vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(false);

      const response = await handleDocumentRoutes(requestByMethod[method](), context);

      expect(response.status).toBe(404);
      expect(services.getLocalizationEdgeBySource).not.toHaveBeenCalled();
      expect(services.getAuthorityOverrides).not.toHaveBeenCalled();
      expect(services.setAuthorityOverride).not.toHaveBeenCalled();
      expect(services.clearAuthorityOverride).not.toHaveBeenCalled();
    });

    it(`answers ${method} with 404 when the document is not a translation`, async () => {
      const { handleDocumentRoutes } = await import('../../src/routes/document-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
      vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
      vi.mocked(services.getLocalizationEdgeBySource).mockResolvedValueOnce(null);

      const response = await handleDocumentRoutes(requestByMethod[method](), context);

      expect(response.status).toBe(404);
      expect(services.getAuthorityOverrides).not.toHaveBeenCalled();
      expect(services.setAuthorityOverride).not.toHaveBeenCalled();
      expect(services.clearAuthorityOverride).not.toHaveBeenCalled();
    });
  }
});

describe('PUT authority-overrides (set)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets a single override and returns the updated map', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');
    const auth = await import('../../src/auth/authorization');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.getLocalizationEdgeBySource).mockResolvedValueOnce(localizationEdge);
    vi.mocked(services.setAuthorityOverride).mockResolvedValueOnce();
    vi.mocked(services.getAuthorityOverrides).mockResolvedValueOnce(new Map([['HeadingBlock-1', new Map([['title', 'locale']])]]));

    const response = await handleDocumentRoutes(
      putRequest({ slotId: 'HeadingBlock-1', propName: 'title', authority: 'locale' }),
      context,
    );

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.authorityOverrides).toEqual({ 'HeadingBlock-1': { title: 'locale' } });

    expect(auth.assertPermission).toHaveBeenCalledWith(
      context.principal,
      'site-1',
      'branch-1',
      'canEditDocuments',
    );
    expect(vi.mocked(services.setAuthorityOverride).mock.calls[0]).toEqual([
      TRANSLATION_ID,
      'HeadingBlock-1',
      'title',
      'locale',
    ]);
  });

  it('accepts the canonical authority value', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.getLocalizationEdgeBySource).mockResolvedValueOnce(localizationEdge);
    vi.mocked(services.setAuthorityOverride).mockResolvedValueOnce();
    vi.mocked(services.getAuthorityOverrides).mockResolvedValueOnce(new Map([['HeadingBlock-1', new Map([['title', 'canonical']])]]));

    const response = await handleDocumentRoutes(
      putRequest({ slotId: 'HeadingBlock-1', propName: 'title', authority: 'canonical' }),
      context,
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(services.setAuthorityOverride).mock.calls[0]?.[3]).toBe('canonical');
  });

  it('rejects an authority that is not canonical or locale with 400', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.getLocalizationEdgeBySource).mockResolvedValueOnce(localizationEdge);

    const response = await handleDocumentRoutes(
      putRequest({ slotId: 'HeadingBlock-1', propName: 'title', authority: 'bogus' }),
      context,
    );

    expect(response.status).toBe(400);
    expect(services.setAuthorityOverride).not.toHaveBeenCalled();
  });

  it('answers a write refused by the map ceiling with 400 naming the limit', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');
    const { AuthorityOverrideLimitError } = await import('../../src/services/relations-service');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.getLocalizationEdgeBySource).mockResolvedValueOnce(localizationEdge);
    vi.mocked(services.setAuthorityOverride).mockRejectedValueOnce(
      new AuthorityOverrideLimitError(TRANSLATION_ID),
    );

    const response = await handleDocumentRoutes(
      putRequest({ slotId: 'HeadingBlock-1', propName: 'title', authority: 'locale' }),
      context,
    );

    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect(body.error).toContain('at most');
    expect(body.error).toContain('authority overrides');
  });
});

describe('DELETE authority-overrides (clear)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears a single override and returns the pruned map', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');
    const auth = await import('../../src/auth/authorization');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.getLocalizationEdgeBySource).mockResolvedValueOnce(localizationEdge);
    vi.mocked(services.clearAuthorityOverride).mockResolvedValueOnce();
    vi.mocked(services.getAuthorityOverrides).mockResolvedValueOnce(new Map());

    const response = await handleDocumentRoutes(
      deleteRequest({ slotId: 'ImageBlock-1', propName: 'alt' }),
      context,
    );

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.authorityOverrides).toEqual({});

    expect(auth.assertPermission).toHaveBeenCalledWith(
      context.principal,
      'site-1',
      'branch-1',
      'canEditDocuments',
    );
    expect(vi.mocked(services.clearAuthorityOverride).mock.calls[0]).toEqual([
      TRANSLATION_ID,
      'ImageBlock-1',
      'alt',
    ]);
  });

  it('does not consult the map ceiling', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.getLocalizationEdgeBySource).mockResolvedValueOnce(localizationEdge);
    vi.mocked(services.clearAuthorityOverride).mockResolvedValueOnce();
    vi.mocked(services.getAuthorityOverrides).mockResolvedValueOnce(new Map());

    const response = await handleDocumentRoutes(
      deleteRequest({ slotId: 'ImageBlock-1', propName: 'alt' }),
      context,
    );

    expect(response.status).toBe(200);
    expect(services.clearAuthorityOverride).toHaveBeenCalled();
    expect(services.setAuthorityOverride).not.toHaveBeenCalled();
  });
});

describe('authority-overrides method and auth guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unsupported method with 405', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);

    const request = new Request(authorityOverridesUrl(), { method: 'POST' });
    const response = await handleDocumentRoutes(request, context);

    expect(response.status).toBe(405);
    expect(services.getLocalizationEdgeBySource).not.toHaveBeenCalled();
  });

  it('returns 403 when the principal lacks the required permission', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');
    const auth = await import('../../src/auth/authorization');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(auth.assertPermission).mockRejectedValueOnce(
      new auth.AuthorizationError('forbidden', 'canEditDocuments', 'VIEWER'),
    );

    const response = await handleDocumentRoutes(
      putRequest({ slotId: 'HeadingBlock-1', propName: 'title', authority: 'locale' }),
      context,
    );

    expect(response.status).toBe(403);
    expect(services.setAuthorityOverride).not.toHaveBeenCalled();
  });
});

describe('authority-overrides key validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const overLength = 'a'.repeat(257);

  function primeTranslation(services: typeof import('../../src/services')): void {
    vi.mocked(services.getBranch).mockResolvedValue(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValue(true);
    vi.mocked(services.getLocalizationEdgeBySource).mockResolvedValue(localizationEdge);
  }

  const rejectedKeys = [
    { label: 'an empty slotId', slotId: '', propName: 'title' },
    { label: 'an empty propName', slotId: 'HeadingBlock-1', propName: '' },
    { label: 'an over-length slotId', slotId: overLength, propName: 'title' },
    { label: 'an over-length propName', slotId: 'HeadingBlock-1', propName: overLength },
  ] as const;

  for (const { label, slotId, propName } of rejectedKeys) {
    it(`rejects ${label} with 400 on PUT`, async () => {
      const { handleDocumentRoutes } = await import('../../src/routes/document-api');
      const services = await import('../../src/services');
      primeTranslation(services);

      const response = await handleDocumentRoutes(
        putRequest({ slotId, propName, authority: 'locale' }),
        context,
      );

      expect(response.status).toBe(400);
      expect(services.setAuthorityOverride).not.toHaveBeenCalled();
    });

    it(`rejects ${label} with 400 on DELETE`, async () => {
      const { handleDocumentRoutes } = await import('../../src/routes/document-api');
      const services = await import('../../src/services');
      primeTranslation(services);

      const response = await handleDocumentRoutes(deleteRequest({ slotId, propName }), context);

      expect(response.status).toBe(400);
      expect(services.clearAuthorityOverride).not.toHaveBeenCalled();
    });
  }

  it('accepts a normal Type-<uuid> slotId and prop name', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');
    primeTranslation(services);
    const slotId = 'HeroBlock-11111111-1111-1111-1111-111111111111';
    vi.mocked(services.setAuthorityOverride).mockResolvedValueOnce();
    vi.mocked(services.getAuthorityOverrides).mockResolvedValueOnce(new Map([[slotId, new Map([['title', 'locale']])]]));

    const response = await handleDocumentRoutes(
      putRequest({ slotId, propName: 'title', authority: 'locale' }),
      context,
    );

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.authorityOverrides).toEqual({ [slotId]: { title: 'locale' } });
    expect(vi.mocked(services.setAuthorityOverride).mock.calls[0]).toEqual([
      TRANSLATION_ID,
      slotId,
      'title',
      'locale',
    ]);
  });
});
