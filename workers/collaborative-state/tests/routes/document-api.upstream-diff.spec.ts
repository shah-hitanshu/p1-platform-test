/**
 * Upstream-diff route: a document can report how its upstream edge target drifted
 * since it was last synced, classified for the requested relation type. The route
 * is read-only, guards the document to the branch, and 404s when no edge exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRoute } from '../../src/routes/route-parser';
import { makeBranch } from '../helpers/branch';
import { makePrincipal } from '../helpers/principal';
import { readJson } from '../helpers/http';
import type { DocumentRouteContext } from '../../src/routes/document-api';

vi.mock('../../src/services', () => ({
  getBranch: vi.fn(),
  getMainBranch: vi.fn(),
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

const DOC_ID = '22222222-2222-2222-2222-222222222222';

const featureBranch = makeBranch({
  id: 'branch-1',
  siteId: 'site-1',
  name: 'feature',
  isMain: false,
});

const summary = {
  relationType: 'localization' as const,
  sourceDocumentId: DOC_ID,
  targetDocumentId: '33333333-3333-3333-3333-333333333333',
  fromVersion: 1,
  toVersion: 2,
  slotDelta: { added: [], removed: [], moved: [], templateIds: [] },
  changes: [],
  counts: { structural: 0, prop: 0, advisory: 0, needsTranslation: 0, autoApplied: 0 },
};

function upstreamDiffRequest(query = ''): Request {
  return new Request(
    `https://api.example.com/api/sites/site-1/branches/branch-1/documents/${DOC_ID}/upstream-diff${query}`,
    { method: 'GET' },
  );
}

const context: DocumentRouteContext = {
  siteId: 'site-1',
  branchId: 'branch-1',
  documentId: DOC_ID,
  action: 'upstream-diff' as const,
  principal: makePrincipal({ id: 'user-1', type: 'user' }),
};

describe('parseRoute - upstream-diff route', () => {
  it('parses the upstream-diff route to the documents handler', () => {
    const result = parseRoute(
      `/api/sites/site-1/branches/branch-1/documents/${DOC_ID}/upstream-diff`,
    );
    expect(result).toEqual({
      handler: 'documents',
      params: {
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: DOC_ID,
        action: 'upstream-diff',
      },
    });
  });
});

describe('GET upstream-diff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the classified change summary for the requested relation type', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.buildChangeSummary).mockResolvedValueOnce(summary);

    const response = await handleDocumentRoutes(
      upstreamDiffRequest('?relationType=localization'),
      context,
    );

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.relationType).toBe('localization');
    expect(body.fromVersion).toBe(1);

    const callArg = vi.mocked(services.buildChangeSummary).mock.calls[0]?.[0];
    expect(callArg?.sourceDocumentId).toBe(DOC_ID);
    expect(callArg?.branchId).toBe('branch-1');
    expect(callArg?.relationType).toBe('localization');
  });

  it('defaults to the localization relation when none is given', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.buildChangeSummary).mockResolvedValueOnce(summary);

    const response = await handleDocumentRoutes(upstreamDiffRequest(), context);

    expect(response.status).toBe(200);
    const callArg = vi.mocked(services.buildChangeSummary).mock.calls[0]?.[0];
    expect(callArg?.relationType).toBe('localization');
  });

  it('passes the template relation through when requested', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.buildChangeSummary).mockResolvedValueOnce({
      ...summary,
      relationType: 'template',
    });

    const response = await handleDocumentRoutes(
      upstreamDiffRequest('?relationType=template'),
      context,
    );

    expect(response.status).toBe(200);
    const callArg = vi.mocked(services.buildChangeSummary).mock.calls[0]?.[0];
    expect(callArg?.relationType).toBe('template');
  });

  it('rejects an unknown relation type with 400', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);

    const response = await handleDocumentRoutes(
      upstreamDiffRequest('?relationType=bogus'),
      context,
    );

    expect(response.status).toBe(400);
    expect(services.buildChangeSummary).not.toHaveBeenCalled();
  });

  it('returns 404 when the document is not on this branch', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(false);

    const response = await handleDocumentRoutes(upstreamDiffRequest(), context);

    expect(response.status).toBe(404);
    expect(services.buildChangeSummary).not.toHaveBeenCalled();
  });

  it('returns 404 when the document has no edge of the requested relation type', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);
    vi.mocked(services.documentExistsOnBranch).mockResolvedValueOnce(true);
    vi.mocked(services.buildChangeSummary).mockResolvedValueOnce(null);

    const response = await handleDocumentRoutes(upstreamDiffRequest(), context);

    expect(response.status).toBe(404);
  });

  it('rejects a non-GET method with 405', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const services = await import('../../src/services');

    vi.mocked(services.getBranch).mockResolvedValueOnce(featureBranch);

    const request = new Request(
      `https://api.example.com/api/sites/site-1/branches/branch-1/documents/${DOC_ID}/upstream-diff`,
      { method: 'POST' },
    );
    const response = await handleDocumentRoutes(request, context);

    expect(response.status).toBe(405);
    expect(services.buildChangeSummary).not.toHaveBeenCalled();
  });
});
