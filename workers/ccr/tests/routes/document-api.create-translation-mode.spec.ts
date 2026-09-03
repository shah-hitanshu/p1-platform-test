/**
 * The create-translation route carries the mode the locale's content is seeded
 * with. `copy` is the only mode implemented, so anything else is refused rather
 * than silently treated as a copy: a client asking for content this backend
 * cannot produce learns so instead of getting the wrong content.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeBranch } from '../helpers/branch';
import { makePrincipal } from '../helpers/principal';
import type { DocumentRouteContext } from '../../src/routes/document-api';
import type { CreateTranslationResult } from '../../src/services/create-translation-service';

vi.mock('../../src/services', async () => {
  const actual = await vi.importActual('../../src/services');
  return {
    ...actual,
    getBranch: vi.fn(),
    getMainBranch: vi.fn(),
    createTranslation: vi.fn(),
    documentExistsOnBranch: vi.fn(),
  };
});

vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  getEffectiveRole: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    override name = 'AuthorizationError';
  },
}));

const CANONICAL_ID = '11111111-1111-1111-1111-111111111111';

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

const translationResult: CreateTranslationResult = {
  document: {
    id: 'doc-translation',
    siteId: 'site-1',
    path: 'pages/home.fr-FR',
    locale: 'fr-FR',
    createdAt: '2026-01-24T12:00:00.000Z',
  },
  version: {
    id: 'version-1',
    documentId: 'doc-translation',
    branchId: 'branch-1',
    versionNumber: 1,
    snapshot: {},
    source: 'edit',
    createdById: 'user-1',
    createdByType: 'user',
    createdAt: '2026-01-24T12:00:00.000Z',
  },
  localization: {
    derivedDocumentId: 'doc-translation',
    upstreamDocumentId: CANONICAL_ID,
    relationType: 'localization',
    syncedUpstreamVersion: 4,
  },
};

const context: DocumentRouteContext = {
  siteId: 'site-1',
  branchId: 'branch-1',
  documentId: CANONICAL_ID,
  action: 'translations' as const,
  principal: makePrincipal({ id: 'user-1', type: 'user' }),
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

describe('POST create translation with a mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('passes the copy mode to the service', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.createTranslation).mockResolvedValueOnce(translationResult);

    const response = await handleDocumentRoutes(
      postTranslationRequest({ locale: 'fr-FR', mode: 'copy' }),
      context,
    );

    expect(response.status).toBe(201);
    const callArg = vi.mocked(services.createTranslation).mock.calls[0]?.[0];
    expect(callArg?.mode).toBe('copy');
  });

  it('names no mode when the body omits one, leaving the service default', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.createTranslation).mockResolvedValueOnce(translationResult);

    const response = await handleDocumentRoutes(
      postTranslationRequest({ locale: 'fr-FR' }),
      context,
    );

    expect(response.status).toBe(201);
    const callArg = vi.mocked(services.createTranslation).mock.calls[0]?.[0];
    expect(callArg?.mode).toBeUndefined();
  });

  it.each(['empty', 'ai', 'COPY'])('rejects %s, which is not an implemented mode', async (mode) => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);

    const response = await handleDocumentRoutes(
      postTranslationRequest({ locale: 'fr-FR', mode }),
      context,
    );

    expect(response.status).toBe(400);
    expect(services.createTranslation).not.toHaveBeenCalled();
  });

  it('names the modes it accepts when refusing one', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);

    const response = await handleDocumentRoutes(
      postTranslationRequest({ locale: 'fr-FR', mode: 'empty' }),
      context,
    );

    const body: { error: string } = await response.json();
    expect(body.error).toContain('copy');
  });
});

describe('POST create translation with a blank path', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it.each([['empty', ''], ['whitespace', '   ']])(
    'rejects a %s path rather than defaulting it to the site root',
    async (_label, path) => {
      const { handleDocumentRoutes } = await import('../../src/routes/document-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
      vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);

      const response = await handleDocumentRoutes(
        postTranslationRequest({ locale: 'fr-FR', path }),
        context,
      );

      expect(response.status).toBe(400);
      expect(services.createTranslation).not.toHaveBeenCalled();
    },
  );
});
