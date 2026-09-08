/**
 * Where authorization sits relative to the document and branch lookups in the
 * branch-scoped document routes.
 *
 * Two things are pinned here, and they pull in opposite directions:
 *
 * - A request that will be refused should not pay for lookups whose answer it
 *   never sees. The assertions on call counts are the point of these tests,
 *   not incidental to them — a reordering that reintroduces the cost has to
 *   fail something.
 * - Which of 403 and 404 a caller observes is an information-disclosure
 *   decision. It is asserted directly for each of the four cases that can
 *   produce one, so it stays a decision rather than a consequence of
 *   statement order.
 *
 * Authorization is deliberately NOT mocked: these tests are about the real
 * assertPermission running against a mocked `query`, so `db.query` call counts
 * are the authorization cost and the mocked services are the lookup cost.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makePrincipal } from '../helpers/principal';
import { makeBranch } from '../helpers/branch';

// The lookups are stubbed on the service modules the `src/services` barrel
// re-exports them from, rather than on the barrel itself. Mocking the barrel
// means importActual-ing it, which builds a second copy of the whole service
// graph — including its error classes — and the route module's
// `instanceof HttpError` then stops matching the class assertPermission throws,
// turning every 403 under test into a 500.
vi.mock('../../src/services/branch-service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/branch-service')>(
    '../../src/services/branch-service',
  );
  return { ...actual, getBranch: vi.fn(), getMainBranch: vi.fn() };
});

vi.mock('../../src/services/document-service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/document-service')>(
    '../../src/services/document-service',
  );
  return { ...actual, getDocument: vi.fn(), documentExistsOnBranch: vi.fn() };
});

type DocumentVersionService = typeof import('../../src/services/document-version-service');

vi.mock('../../src/services/document-version-service', async () => {
  const actual = await vi.importActual<DocumentVersionService>(
    '../../src/services/document-version-service',
  );
  return {
    ...actual,
    getLatestDocumentVersion: vi.fn(),
    getLatestDocumentVersionWithFallback: vi.fn(),
    listDocumentVersions: vi.fn(),
  };
});

vi.mock('../../src/db', async () => {
  const actual = await vi.importActual<typeof import('../../src/db')>('../../src/db');
  return { ...actual, query: vi.fn() };
});

const purgeContentCache = vi.hoisted(() => vi.fn());
const purgeDeletedDocument = vi.hoisted(() => vi.fn());
vi.mock('../../src/cache/purge', () => ({ purgeContentCache, purgeDeletedDocument }));

const featureBranch = makeBranch({
  id: '11111111-1111-4111-8111-111111111111',
  siteId: 'site-1',
  name: 'feature-one',
  isMain: false,
});

/** A user with no row in user_site_roles and no JWT role: NO_ACCESS. */
const strangerPrincipal = makePrincipal({ id: 'user-stranger', type: 'user' });

/** A user the database gives EDITOR on site-1. */
const memberPrincipal = makePrincipal({
  id: 'user-member',
  type: 'user',
  pantheonSiteRoles: { 'site-1': 'team_member' },
});

const versionsRequest = (method = 'GET'): Request =>
  new Request(
    `http://localhost/api/sites/site-1/branches/${featureBranch.id}/documents/doc-1/versions/latest`,
    { method },
  );

const versionsContext = {
  siteId: 'site-1',
  branchId: featureBranch.id,
  documentId: 'doc-1',
  versionsPath: true,
  versionAction: 'latest' as const,
};

async function loadRoutes() {
  const { handleDocumentRoutes } = await import('../../src/routes/document-api');
  const services = await import('../../src/services');
  const db = await import('../../src/db');
  return { handleDocumentRoutes, services, query: vi.mocked(db.query) };
}

/**
 * Answers every lookup the branch-scoped routes can reach, so a test that is
 * about ordering fails on its call-count assertion rather than on an
 * unstubbed mock returning undefined.
 */
function stubLookups(
  services: Awaited<ReturnType<typeof loadRoutes>>['services'],
  overrides: { documentExistsOnBranch?: boolean } = {},
): void {
  vi.mocked(services.getBranch).mockResolvedValue(featureBranch);
  vi.mocked(services.getMainBranch).mockResolvedValue(null);
  vi.mocked(services.documentExistsOnBranch).mockResolvedValue(
    overrides.documentExistsOnBranch ?? true,
  );
  vi.mocked(services.getLatestDocumentVersion).mockResolvedValue(null);
  vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValue(null);
  vi.mocked(services.getDocument).mockResolvedValue(null);
  vi.mocked(services.listDocumentVersions).mockResolvedValue([]);
}

/** Every lookup the version routes can reach before returning. */
function lookupCalls(services: Awaited<ReturnType<typeof loadRoutes>>['services']): Record<string, number> {
  return {
    getBranch: vi.mocked(services.getBranch).mock.calls.length,
    getMainBranch: vi.mocked(services.getMainBranch).mock.calls.length,
    documentExistsOnBranch: vi.mocked(services.documentExistsOnBranch).mock.calls.length,
    getLatestDocumentVersionWithFallback: vi.mocked(
      services.getLatestDocumentVersionWithFallback,
    ).mock.calls.length,
    getDocument: vi.mocked(services.getDocument).mock.calls.length,
  };
}

describe('branch-scoped document routes: authorization before lookups', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('a service token bound to another site', () => {
    it('is refused without a single database query', async () => {
      const { handleDocumentRoutes, services, query } = await loadRoutes();

      stubLookups(services);

      const response = await handleDocumentRoutes(versionsRequest(), {
        ...versionsContext,
        principal: makePrincipal({
          id: 'sat-1',
          type: 'service',
          siteId: 'site-other',
          scopes: ['read:all'],
        }),
      });

      expect(response.status).toBe(403);
      expect(query).not.toHaveBeenCalled();
      expect(lookupCalls(services)).toEqual({
        getBranch: 0,
        getMainBranch: 0,
        documentExistsOnBranch: 0,
        getLatestDocumentVersionWithFallback: 0,
        getDocument: 0,
      });
    });

    it('is refused on the plain document route without a single database query', async () => {
      const { handleDocumentRoutes, services, query } = await loadRoutes();

      stubLookups(services);

      const response = await handleDocumentRoutes(
        new Request(
          `http://localhost/api/sites/site-1/branches/${featureBranch.id}/documents/doc-1`,
          { method: 'GET' },
        ),
        {
          siteId: 'site-1',
          branchId: featureBranch.id,
          documentId: 'doc-1',
          principal: makePrincipal({
            id: 'sat-1',
            type: 'service',
            siteId: 'site-other',
            scopes: ['read:all'],
          }),
        },
      );

      expect(response.status).toBe(403);
      expect(query).not.toHaveBeenCalled();
      expect(lookupCalls(services).getBranch).toBe(0);
    });
  });

  describe('a service token whose scope does not cover the operation', () => {
    it('is refused without a single database query', async () => {
      const { handleDocumentRoutes, services, query } = await loadRoutes();

      stubLookups(services);

      // write:registry reaches POST on the documents handler through the coarse
      // scope gate; the deny-by-default guard in the route module refuses
      // publish, and has to do so before any lookup.
      const response = await handleDocumentRoutes(
        new Request(
          `http://localhost/api/sites/site-1/branches/${featureBranch.id}/documents/doc-1/publish`,
          { method: 'POST' },
        ),
        {
          siteId: 'site-1',
          branchId: featureBranch.id,
          documentId: 'doc-1',
          action: 'publish' as const,
          principal: makePrincipal({
            id: 'sat-1',
            type: 'service',
            siteId: 'site-1',
            scopes: ['write:registry'],
          }),
        },
      );

      expect(response.status).toBe(403);
      expect(query).not.toHaveBeenCalled();
      expect(lookupCalls(services)).toEqual({
        getBranch: 0,
        getMainBranch: 0,
        documentExistsOnBranch: 0,
        getLatestDocumentVersionWithFallback: 0,
        getDocument: 0,
      });
    });
  });

  describe('a caller with no role on the site', () => {
    it('is refused on the version routes before any document lookup', async () => {
      const { handleDocumentRoutes, services, query } = await loadRoutes();

      stubLookups(services);
      query.mockResolvedValue({ rows: [] });

      const response = await handleDocumentRoutes(versionsRequest(), {
        ...versionsContext,
        principal: strangerPrincipal,
      });

      expect(response.status).toBe(403);
      expect(lookupCalls(services)).toEqual({
        // The branch lookup stays ahead of authorization on purpose: it is what
        // makes a branch outside the site a 404 rather than a 403.
        getBranch: 1,
        getMainBranch: 0,
        documentExistsOnBranch: 0,
        getLatestDocumentVersionWithFallback: 0,
        getDocument: 0,
      });
    });

    it('costs exactly the two queries authorization itself needs', async () => {
      const { handleDocumentRoutes, services, query } = await loadRoutes();

      stubLookups(services);
      query.mockResolvedValue({ rows: [] });

      await handleDocumentRoutes(versionsRequest(), {
        ...versionsContext,
        principal: strangerPrincipal,
      });

      // The site role, then the branch grant. Nothing else.
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('is refused on a version write before any document lookup', async () => {
      const { handleDocumentRoutes, services, query } = await loadRoutes();

      stubLookups(services);
      query.mockResolvedValue({ rows: [] });

      const response = await handleDocumentRoutes(
        new Request(
          `http://localhost/api/sites/site-1/branches/${featureBranch.id}/documents/doc-1/versions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ snapshot: { title: 'nope' } }),
          },
        ),
        {
          siteId: 'site-1',
          branchId: featureBranch.id,
          documentId: 'doc-1',
          versionsPath: true,
          principal: strangerPrincipal,
        },
      );

      expect(response.status).toBe(403);
      expect(lookupCalls(services).documentExistsOnBranch).toBe(0);
    });

    it('is refused on the plain document route before any document lookup', async () => {
      const { handleDocumentRoutes, services, query } = await loadRoutes();

      stubLookups(services);
      query.mockResolvedValue({ rows: [] });

      const response = await handleDocumentRoutes(
        new Request(
          `http://localhost/api/sites/site-1/branches/${featureBranch.id}/documents/doc-1`,
          { method: 'GET' },
        ),
        {
          siteId: 'site-1',
          branchId: featureBranch.id,
          documentId: 'doc-1',
          principal: strangerPrincipal,
        },
      );

      expect(response.status).toBe(403);
      expect(lookupCalls(services).documentExistsOnBranch).toBe(0);
      expect(lookupCalls(services).getDocument).toBe(0);
    });

    it('cannot tell a document that is on the branch from one that is not', async () => {
      const { handleDocumentRoutes, services, query } = await loadRoutes();

      stubLookups(services);
      query.mockResolvedValue({ rows: [] });

      const present = await handleDocumentRoutes(versionsRequest(), {
        ...versionsContext,
        principal: strangerPrincipal,
      });

      vi.clearAllMocks();
      stubLookups(services, { documentExistsOnBranch: false });
      query.mockResolvedValue({ rows: [] });

      const absent = await handleDocumentRoutes(versionsRequest(), {
        ...versionsContext,
        documentId: 'doc-does-not-exist',
        principal: strangerPrincipal,
      });

      expect(present.status).toBe(403);
      expect(absent.status).toBe(403);
    });
  });

  describe('the 403-versus-404 boundary for a caller who does have access', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('answers 404 when the branch is not one of the site\'s', async () => {
      const { handleDocumentRoutes, services, query } = await loadRoutes();

      vi.mocked(services.getBranch).mockResolvedValue(
        makeBranch({ id: featureBranch.id, siteId: 'site-other', isMain: false }),
      );
      query.mockResolvedValue({ rows: [{ role: 'team_member' }] });

      const response = await handleDocumentRoutes(versionsRequest(), {
        ...versionsContext,
        principal: memberPrincipal,
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: 'Branch not found' });
    });

    it('answers 404 when the document is absent from the branch', async () => {
      const { handleDocumentRoutes, services, query } = await loadRoutes();

      vi.mocked(services.getBranch).mockResolvedValue(featureBranch);
      vi.mocked(services.documentExistsOnBranch).mockResolvedValue(false);
      vi.mocked(services.getMainBranch).mockResolvedValue(null);
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('user_site_roles')) {
          return { rows: [{ role: 'team_member' }] };
        }
        return { rows: [{ site_id: 'site-1', role: null }] };
      });

      const response = await handleDocumentRoutes(versionsRequest(), {
        ...versionsContext,
        principal: memberPrincipal,
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: 'Document not found on this branch',
      });
    });

    it('still serves a document inherited from main', async () => {
      const { handleDocumentRoutes, services, query } = await loadRoutes();

      const mainBranch = makeBranch({
        id: '22222222-2222-4222-8222-222222222222',
        siteId: 'site-1',
        isMain: true,
      });
      const inherited = {
        id: 'version-main-1',
        documentId: 'doc-1',
        branchId: mainBranch.id,
        versionNumber: 1,
        snapshot: { title: 'About' },
      };

      vi.mocked(services.getBranch).mockResolvedValue(featureBranch);
      vi.mocked(services.documentExistsOnBranch).mockResolvedValue(false);
      vi.mocked(services.getMainBranch).mockResolvedValue(mainBranch);
      vi.mocked(services.getLatestDocumentVersion).mockResolvedValue(null);
      vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValue({
        version: inherited as never,
        inherited: true,
      });
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('user_site_roles')) {
          return { rows: [{ role: 'team_member' }] };
        }
        return { rows: [{ site_id: 'site-1', role: null }] };
      });

      const response = await handleDocumentRoutes(versionsRequest(), {
        ...versionsContext,
        principal: memberPrincipal,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: 'version-main-1',
        inherited: true,
      });
    });
  });
});
