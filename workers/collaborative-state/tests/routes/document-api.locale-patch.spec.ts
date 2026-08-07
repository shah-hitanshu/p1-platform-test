/**
 * A document's locale is editable over PATCH, so a source page can record the
 * language it was authored in. Path and locale are independent: either may be sent
 * alone, both together, and a null locale clears the tag. A malformed language tag
 * is rejected before it reaches the database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makePrincipal } from '../helpers/principal';
import type { DocumentRouteContext } from '../../src/routes/document-api';

vi.mock('../../src/services', () => ({
  getBranch: vi.fn(),
  getMainBranch: vi.fn(),
  listLocaleVariants: vi.fn(),
  createTranslation: vi.fn(),
  documentExistsOnBranch: vi.fn(),
  getLocalizationEdgeBySource: vi.fn(),
  getAuthorityOverrides: vi.fn(),
  resolveSlotAuthorityDefaults: vi.fn(),
  authorityOverridesToJson: vi.fn(),
  setAuthorityOverride: vi.fn(),
  clearAuthorityOverride: vi.fn(),
  buildChangeSummary: vi.fn(),
  createDocument: vi.fn(),
  getDocument: vi.fn(),
  getDocumentByPath: vi.fn(),
  updateDocumentPath: vi.fn(),
  updateDocumentFields: vi.fn(),
  archiveDocument: vi.fn(),
  restoreDocument: vi.fn(),
  listDocuments: vi.fn(),
  listDocumentsOnBranch: vi.fn(),
  createDocumentOnBranch: vi.fn(),
  deleteDocumentOnBranch: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
  getLatestDocumentVersionWithFallback: vi.fn(),
  getDocumentVersion: vi.fn(),
  listDocumentVersions: vi.fn(),
  createDocumentVersion: vi.fn(),
  reconstructVersionSnapshot: vi.fn(),
  publishDocument: vi.fn(),
  buildDocumentSkeletonFromTemplate: vi.fn(),
  documentExists: vi.fn(),
  deleteDocumentWithRedirect: vi.fn(),
  restoreDocumentVersion: vi.fn(),
  checkTranslationPinnedParity: vi.fn(),
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

const DOCUMENT_ID = '44444444-4444-4444-4444-444444444444';

const context: DocumentRouteContext = {
  siteId: 'site-1',
  documentId: DOCUMENT_ID,
  principal: makePrincipal({ id: 'user-1', type: 'user' }),
};

function patch(body: unknown): Request {
  return new Request(
    `https://api.example.com/api/sites/site-1/documents/${DOCUMENT_ID}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

function document(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    id: DOCUMENT_ID,
    siteId: 'site-1',
    path: 'home',
    createdAt: '2026-01-24T10:00:00.000Z',
    updatedAt: '2026-01-24T10:00:00.000Z',
    ...fields,
  };
}

const mainBranch = {
  id: 'branch-main',
  siteId: 'site-1',
  name: 'main',
  status: 'active',
  isMain: true,
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-01-24T10:00:00.000Z',
  updatedAt: '2026-01-24T10:00:00.000Z',
};

describe('PATCH document locale', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const services = await import('../../src/services');
    vi.mocked(services.getMainBranch).mockResolvedValue(mainBranch as never);
  });

  it('sets a locale on a document that has none', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.updateDocumentFields).mockResolvedValueOnce(
      document({ locale: 'en' }) as never,
    );

    const response = await handleDocumentRoutes(patch({ locale: 'en' }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ locale: 'en' });
    expect(services.updateDocumentFields).toHaveBeenCalledWith(DOCUMENT_ID, { locale: 'en' });
  });

  it('clears a locale when null is sent', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.updateDocumentFields).mockResolvedValueOnce(document({}) as never);

    const response = await handleDocumentRoutes(patch({ locale: null }), context);

    expect(response.status).toBe(200);
    expect(services.updateDocumentFields).toHaveBeenCalledWith(DOCUMENT_ID, { locale: null });
  });

  it('updates a path with no locale in the body', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.updateDocumentFields).mockResolvedValueOnce(
      document({ path: 'about' }) as never,
    );

    const response = await handleDocumentRoutes(patch({ path: 'about' }), context);

    expect(response.status).toBe(200);
    expect(services.updateDocumentFields).toHaveBeenCalledWith(DOCUMENT_ID, { path: 'about' });
  });

  it('updates a path and a locale in one request', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.updateDocumentFields).mockResolvedValueOnce(
      document({ path: 'about', locale: 'fr-FR' }) as never,
    );

    const response = await handleDocumentRoutes(patch({ path: 'about', locale: 'fr-FR' }), context);

    expect(response.status).toBe(200);
    expect(services.updateDocumentFields).toHaveBeenCalledWith(DOCUMENT_ID, {
      path: 'about',
      locale: 'fr-FR',
    });
  });

  it('rejects a body that names neither path nor locale', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    const response = await handleDocumentRoutes(patch({}), context);

    expect(response.status).toBe(400);
    expect(services.updateDocumentFields).not.toHaveBeenCalled();
  });

  it('rejects an empty path', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    const response = await handleDocumentRoutes(patch({ path: '   ' }), context);

    expect(response.status).toBe(400);
    expect(services.updateDocumentFields).not.toHaveBeenCalled();
  });

  it('answers 400 when the service rejects the language tag', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.updateDocumentFields).mockRejectedValueOnce(
      new services.InvalidLocaleError('not a locale'),
    );

    const response = await handleDocumentRoutes(patch({ locale: 'not a locale' }), context);

    expect(response.status).toBe(400);
  });

  it('answers 404 when the document does not exist', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.updateDocumentFields).mockResolvedValueOnce(null);

    const response = await handleDocumentRoutes(patch({ locale: 'en' }), context);

    expect(response.status).toBe(404);
  });
});
