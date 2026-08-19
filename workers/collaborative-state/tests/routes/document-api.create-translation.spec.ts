/**
 * Translation routes: a canonical document can spawn a locale variant and list
 * the variants derived from it. The serialized document exposes its locale.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRoute } from '../../src/routes/route-parser';
import { makeBranch } from '../helpers/branch';
import { makePrincipal } from '../helpers/principal';
import { readJson } from '../helpers/http';
import type { DocumentRouteContext } from '../../src/routes/document-api';
import type {
  CreateTranslationResult,
  LocaleVariantsResult,
} from '../../src/services/create-translation-service';

vi.mock('../../src/services', async () => {
  const actual = await vi.importActual('../../src/services');
  return {
    ...actual,
    getBranch: vi.fn(),
    getMainBranch: vi.fn(),
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
  };
});

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

const CANONICAL_ID = '11111111-1111-1111-1111-111111111111';

const featureBranch = makeBranch({
  id: 'branch-1',
  siteId: 'site-1',
  name: 'feature',
  isMain: false,
});

const translationResult: CreateTranslationResult = {
  document: {
    id: 'doc-fr',
    siteId: 'site-1',
    path: 'pages/home.fr-FR',
    createdAt: '2026-01-24T12:00:00.000Z',
    locale: 'fr-FR',
  },
  version: {
    id: 'version-fr-1',
    documentId: 'doc-fr',
    branchId: 'branch-1',
    versionNumber: 1,
    snapshot: { content: [{ type: 'HeroBlock', props: { id: 'HeroBlock-aaaa' } }], zones: {}, root: { props: {} } },
    source: 'edit',
    createdById: 'user-1',
    createdByType: 'user',
    createdAt: '2026-01-24T12:00:00.000Z',
  },
  localization: {
    sourceDocumentId: 'doc-fr',
    targetDocumentId: CANONICAL_ID,
    relationType: 'localization' as const,
    syncedVersion: 3,
  },
};

function postTranslationRequest(body: Record<string, unknown>): Request {
  return new Request(
    `https://api.example.com/api/sites/site-1/branches/branch-1/documents/${CANONICAL_ID}/translations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function getTranslationsRequest(): Request {
  return new Request(
    `https://api.example.com/api/sites/site-1/branches/branch-1/documents/${CANONICAL_ID}/translations`,
    { method: 'GET' },
  );
}

const context: DocumentRouteContext = {
  siteId: 'site-1',
  branchId: 'branch-1',
  documentId: CANONICAL_ID,
  action: 'translations' as const,
  principal: makePrincipal({ id: 'user-1', type: 'user' }),
};

describe('parseRoute - translation routes', () => {
  it('parses the translations collection route to the documents handler', () => {
    const result = parseRoute(
      `/api/sites/site-1/branches/branch-1/documents/${CANONICAL_ID}/translations`,
    );
    expect(result).toEqual({
      handler: 'documents',
      params: {
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: CANONICAL_ID,
        action: 'translations',
      },
    });
  });
});

describe('POST create-translation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a translation and returns document, version, and localization edge', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.createTranslation).mockResolvedValueOnce(translationResult);

    const response = await handleDocumentRoutes(postTranslationRequest({ locale: 'fr-FR' }), context);

    expect(response.status).toBe(201);
    const body = await readJson<CreateTranslationResult>(response);
    expect(body.document.locale).toBe('fr-FR');
    expect(body.version.versionNumber).toBe(1);
    expect(body.localization.targetDocumentId).toBe(CANONICAL_ID);
    expect(body.localization.relationType).toBe('localization');

    const callArg = vi.mocked(services.createTranslation).mock.calls[0]?.[0];
    expect(callArg?.canonicalDocumentId).toBe(CANONICAL_ID);
    expect(callArg?.branchId).toBe('branch-1');
    expect(callArg?.locale).toBe('fr-FR');
    expect(callArg?.createdById).toBe('user-1');
  });

  it('rejects a request without a locale', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);

    const response = await handleDocumentRoutes(postTranslationRequest({}), context);

    expect(response.status).toBe(400);
    expect(services.createTranslation).not.toHaveBeenCalled();
  });

  it('maps a duplicate-locale conflict to 409', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.createTranslation).mockRejectedValueOnce(
      new services.TranslationAlreadyExistsError(CANONICAL_ID, 'fr-FR'),
    );

    const response = await handleDocumentRoutes(postTranslationRequest({ locale: 'fr-FR' }), context);
    expect(response.status).toBe(409);
  });

  it('maps a missing canonical document to 404', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.createTranslation).mockRejectedValueOnce(
      new services.DocumentNotFoundError('missing'),
    );

    const response = await handleDocumentRoutes(postTranslationRequest({ locale: 'fr-FR' }), context);
    expect(response.status).toBe(404);
  });

  it('returns 404 when the canonical document is not on this branch', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(false);

    const response = await handleDocumentRoutes(postTranslationRequest({ locale: 'fr-FR' }), context);

    expect(response.status).toBe(404);
    expect(services.createTranslation).not.toHaveBeenCalled();
  });
});

describe('GET list locale variants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the canonical document with its locale variants', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.listLocaleVariants).mockResolvedValueOnce({
      canonical: {
        id: CANONICAL_ID,
        siteId: 'site-1',
        path: 'pages/home',
        createdAt: '2026-01-24T10:00:00.000Z',
      },
      variants: [
        { document: translationResult.document, localization: translationResult.localization },
      ],
    });

    const response = await handleDocumentRoutes(getTranslationsRequest(), context);

    expect(response.status).toBe(200);
    const body = await readJson<LocaleVariantsResult>(response);
    expect(body.canonical.id).toBe(CANONICAL_ID);
    expect(body.variants[0].document.locale).toBe('fr-FR');

    // The listing is scoped to the branch named in the request.
    expect(services.listLocaleVariants).toHaveBeenCalledWith(CANONICAL_ID, 'branch-1');
  });

  it('returns 404 when the canonical document is not on this branch', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(false);

    const response = await handleDocumentRoutes(getTranslationsRequest(), context);

    expect(response.status).toBe(404);
    expect(services.listLocaleVariants).not.toHaveBeenCalled();
  });
});
