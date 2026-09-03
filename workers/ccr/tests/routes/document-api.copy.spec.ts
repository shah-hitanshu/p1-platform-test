import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makePrincipal } from '../helpers/principal';
import { makeBranch } from '../helpers/branch';
import type { DocumentRouteContext } from '../../src/routes/document-api';

// Spread actual so HttpError and its subclasses keep their prototype chains —
// the handler's instanceof HttpError check relies on them.
vi.mock('../../src/services', async () => {
  const actual = await vi.importActual<typeof import('../../src/services')>('../../src/services');
  return {
    ...actual,
    getBranch: vi.fn(),
    getMainBranch: vi.fn(),
    isTombstonedOnBranch: vi.fn(),
    duplicateDocument: vi.fn(),
    getSiteOwner: vi.fn().mockResolvedValue(null),
  };
});

const purgeContentCache = vi.hoisted(() => vi.fn());
vi.mock('../../src/cache/purge', () => ({ purgeContentCache, purgeDeletedDocument: vi.fn() }));

vi.mock('../../src/auth/authorization', async () => {
  const actual = await vi.importActual('../../src/auth/authorization');
  return { ...actual, assertPermission: vi.fn() };
});

const copyContext: DocumentRouteContext = {
  siteId: 'site-1',
  branchId: 'branch-1',
  documentId: 'doc-1',
  action: 'copy',
  principal: makePrincipal({ id: 'provider-user-1', type: 'user', dbUserId: 'db-user-1' }),
};

const mainBranchCopyContext: DocumentRouteContext = {
  ...copyContext,
  branchId: 'main-branch-1',
};

function postCopy(body: Record<string, unknown>): Request {
  return new Request(
    'https://api.example.com/api/sites/site-1/branches/branch-1/documents/doc-1/copy',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('POST documents/{id}/copy', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const services = await import('../../src/services');
    vi.mocked(services.getBranch).mockResolvedValue(
      makeBranch({ id: 'branch-1', siteId: 'site-1', name: 'feature', isMain: false }),
    );
    vi.mocked(services.getMainBranch).mockResolvedValue(
      makeBranch({ id: 'main-branch-1', siteId: 'site-1', name: 'main', isMain: true }),
    );
    vi.mocked(services.isTombstonedOnBranch).mockResolvedValue(false);
    vi.mocked(services.duplicateDocument).mockResolvedValue({
      documents: [{ id: 'copy-1', siteId: 'site-1', path: 'about-2', createdAt: 'now' }],
    });

    const { assertPermission } = await import('../../src/auth/authorization');
    vi.mocked(assertPermission).mockResolvedValue(undefined);
  });

  it('404s when the document is tombstoned on this branch', async () => {
    const services = await import('../../src/services');
    vi.mocked(services.isTombstonedOnBranch).mockResolvedValueOnce(true);

    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const response = await handleDocumentRoutes(postCopy({}), copyContext);

    expect(response.status).toBe(404);
  });

  it('copies a page inherited from main, which has no version on the branch', async () => {
    const services = await import('../../src/services');
    vi.mocked(services.isTombstonedOnBranch).mockResolvedValueOnce(false);

    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const response = await handleDocumentRoutes(postCopy({}), copyContext);

    expect(response.status).toBe(201);
  });

  it('asserts canEditDocuments', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const { assertPermission } = await import('../../src/auth/authorization');
    await handleDocumentRoutes(postCopy({}), copyContext);

    expect(vi.mocked(assertPermission)).toHaveBeenCalledWith(
      copyContext.principal, 'site-1', 'branch-1', 'canEditDocuments',
    );
  });

  it('rejects a non-boolean includeChildren', async () => {
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const response = await handleDocumentRoutes(postCopy({ includeChildren: 'yes' }), copyContext);

    expect(response.status).toBe(400);
  });

  it('defaults includeChildren to false', async () => {
    const services = await import('../../src/services');
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    await handleDocumentRoutes(postCopy({}), copyContext);

    expect(vi.mocked(services.duplicateDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ includeChildren: false }),
    );
  });

  it('writes the version as the database user, not the provider id', async () => {
    const services = await import('../../src/services');
    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    await handleDocumentRoutes(postCopy({}), copyContext);

    expect(vi.mocked(services.duplicateDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: 'db-user-1' }),
    );
  });

  it('returns 201 with the copied documents', async () => {
    const services = await import('../../src/services');
    vi.mocked(services.duplicateDocument).mockResolvedValueOnce({
      documents: [{ id: 'copy-1', siteId: 'site-1', path: 'about-2', createdAt: 'now' }],
    });

    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const response = await handleDocumentRoutes(postCopy({}), copyContext);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      documents: [{ id: 'copy-1', siteId: 'site-1', path: 'about-2', createdAt: 'now' }],
    });
  });

  it('succeeds on the main branch', async () => {
    const services = await import('../../src/services');
    vi.mocked(services.getBranch).mockResolvedValue(
      makeBranch({ id: 'main-branch-1', siteId: 'site-1', name: 'main', isMain: true }),
    );

    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const response = await handleDocumentRoutes(postCopy({}), mainBranchCopyContext);

    expect(response.status).toBe(201);
  });

  it('maps an over-cap subtree to 400 with the count in the message', async () => {
    const services = await import('../../src/services');
    const { DuplicateSubtreeTooLargeError } = await import('../../src/services');
    vi.mocked(services.duplicateDocument).mockRejectedValueOnce(
      new DuplicateSubtreeTooLargeError(101, 100),
    );

    const { handleDocumentRoutes } = await import('../../src/routes/document-api');
    const response = await handleDocumentRoutes(postCopy({ includeChildren: true }), copyContext);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining('101') }),
    );
  });
});
