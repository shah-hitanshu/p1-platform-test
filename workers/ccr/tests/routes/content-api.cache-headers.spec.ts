/**
 * Content API cache headers.
 *
 * 404s currently ship with no Cache-Control, so every repeat request for a
 * dead path is forced back to Postgres. These assert the bounded-TTL negative
 * caching and the Cache-Tag that publish-time purging depends on.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MAX_NOT_FOUND_CACHE_TTL_SECONDS,
  NOT_FOUND_CACHE_TTL_SECONDS,
} from '../../src/cache/content-cache';
import type { AuthenticatedPrincipal } from '../../src/types';

const mocks = vi.hoisted(() => ({
  getMainBranch: vi.fn(),
  getBranch: vi.fn(),
  getBranchByName: vi.fn(),
  getDocumentByPath: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
  getLatestPublishedDocumentVersion: vi.fn(),
  getLatestDocumentVersionWithFallback: vi.fn(),
  hasTombstoneAfterVersion: vi.fn(),
  listDocumentsOnBranch: vi.fn(),
  reconstructVersionSnapshot: vi.fn(),
  getSite: vi.fn(),
  getSiteSettings: vi.fn(),
  getEffectiveCacheTtl: vi.fn(),
}));

vi.mock('../../src/services', () => ({
  getMainBranch: mocks.getMainBranch,
  getBranch: mocks.getBranch,
  getBranchByName: mocks.getBranchByName,
  getDocumentByPath: mocks.getDocumentByPath,
  getLatestDocumentVersion: mocks.getLatestDocumentVersion,
  getLatestPublishedDocumentVersion: mocks.getLatestPublishedDocumentVersion,
  getLatestDocumentVersionWithFallback: mocks.getLatestDocumentVersionWithFallback,
  hasTombstoneAfterVersion: mocks.hasTombstoneAfterVersion,
  listDocumentsOnBranch: mocks.listDocumentsOnBranch,
  reconstructVersionSnapshot: mocks.reconstructVersionSnapshot,
  getSite: mocks.getSite,
  buildPageMetadata: vi.fn().mockReturnValue({}),
  VersionReconstructionError: class VersionReconstructionError extends Error {},
}));

vi.mock('../../src/services/site-settings-service', () => ({
  getSiteSettings: mocks.getSiteSettings,
  getEffectiveCacheTtl: mocks.getEffectiveCacheTtl,
}));

const SITE_ID = 'site-123';
const BRANCH_ID = 'branch-main';
const DOCUMENT_ID = 'doc-456';

const principal: AuthenticatedPrincipal = {
  id: 'tok-123',
  type: 'service',
  pantheonSiteRoles: {},
  tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
  scopes: ['read:published'],
  siteId: SITE_ID,
  authProvider: 'site_token',
};

const mainBranch = { id: BRANCH_ID, name: 'main', isMain: true };

function contentRequest(path = 'home'): Request {
  return new Request(`https://api.example.com/api/sites/${SITE_ID}/content/${path}`, {
    method: 'GET',
  });
}

function contentContext(documentPath = 'home') {
  return { siteId: SITE_ID, documentPath, action: 'content' as const, principal };
}

function pagesRequest(): Request {
  return new Request(`https://api.example.com/api/sites/${SITE_ID}/content-pages`, {
    method: 'GET',
  });
}

function pagesContext() {
  return { siteId: SITE_ID, action: 'content-pages' as const, principal };
}

function parseMaxAge(cacheControl: string | null): number | null {
  const match = /s-maxage=(\d+)/.exec(cacheControl ?? '');
  return match === null ? null : Number(match[1]);
}

describe('content API cache headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMainBranch.mockResolvedValue(mainBranch);
    // Documents are live unless a test tombstones them [PCC-3669].
    mocks.hasTombstoneAfterVersion.mockResolvedValue(false);
    mocks.getSiteSettings.mockResolvedValue(null);
    mocks.getSite.mockResolvedValue({ id: SITE_ID, updatedAt: '2026-08-01T00:00:00.000Z' });
    mocks.getEffectiveCacheTtl.mockReturnValue(600);
  });

  describe('negative caching (404)', () => {
    it('sets a bounded-TTL Cache-Control when the document does not exist', async () => {
      mocks.getDocumentByPath.mockResolvedValue(null);
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const response = await handleContentRoutes(
        contentRequest('blog/player-evaluation-gap/gtm.js'),
        contentContext('blog/player-evaluation-gap/gtm.js'),
      );

      expect(response.status).toBe(404);
      const ttl = parseMaxAge(response.headers.get('Cache-Control'));
      expect(ttl).toBe(NOT_FOUND_CACHE_TTL_SECONDS);
    });

    it('sets a bounded-TTL Cache-Control when the branch does not exist', async () => {
      mocks.getMainBranch.mockResolvedValue(null);
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const response = await handleContentRoutes(contentRequest(), contentContext());

      expect(response.status).toBe(404);
      expect(parseMaxAge(response.headers.get('Cache-Control'))).toBe(
        NOT_FOUND_CACHE_TTL_SECONDS,
      );
    });

    it('sets a bounded-TTL Cache-Control for a tombstoned document', async () => {
      mocks.getDocumentByPath.mockResolvedValue({ id: DOCUMENT_ID, path: 'home' });
      mocks.getLatestPublishedDocumentVersion.mockResolvedValue({
        id: 'v1',
        versionNumber: 3,
        isTombstone: true,
      });
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const response = await handleContentRoutes(contentRequest(), contentContext());

      expect(response.status).toBe(404);
      expect(parseMaxAge(response.headers.get('Cache-Control'))).toBe(
        NOT_FOUND_CACHE_TTL_SECONDS,
      );
    });

    it('never remembers a miss longer than the bound', () => {
      expect(NOT_FOUND_CACHE_TTL_SECONDS).toBeGreaterThan(0);
      expect(NOT_FOUND_CACHE_TTL_SECONDS).toBeLessThanOrEqual(
        MAX_NOT_FOUND_CACHE_TTL_SECONDS,
      );
    });

    it('caches misses more briefly than hits, so an unpublished page recovers first', async () => {
      mocks.getDocumentByPath.mockResolvedValue(null);
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const response = await handleContentRoutes(contentRequest(), contentContext());
      const missTtl = parseMaxAge(response.headers.get('Cache-Control'));

      expect(missTtl).not.toBeNull();
      expect(missTtl!).toBeLessThan(mocks.getEffectiveCacheTtl() as number);
    });

    // Without a tag, a publish cannot clear a cached miss: a page that 404'd
    // before being published stays invisible for the full TTL. The site tag is
    // in every publish purge, so it is what reaches these entries.
    it('tags a miss with the site so publishing the page purges the cached 404', async () => {
      mocks.getDocumentByPath.mockResolvedValue(null);
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const response = await handleContentRoutes(contentRequest(), contentContext());

      expect(response.headers.get('Cache-Tag')).toBe(`site:${SITE_ID}`);
    });

    it('tags a tombstone miss with the site so a republish purges it', async () => {
      mocks.getDocumentByPath.mockResolvedValue({ id: DOCUMENT_ID, path: 'home' });
      mocks.getLatestPublishedDocumentVersion.mockResolvedValue({
        id: 'v1',
        versionNumber: 3,
        isTombstone: true,
      });
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const response = await handleContentRoutes(contentRequest(), contentContext());

      expect(response.headers.get('Cache-Tag')).toBe(`site:${SITE_ID}`);
    });
  });

  describe('positive caching (200)', () => {
    beforeEach(() => {
      mocks.getDocumentByPath.mockResolvedValue({ id: DOCUMENT_ID, path: 'home' });
      mocks.getLatestPublishedDocumentVersion.mockResolvedValue({
        id: 'v1',
        versionNumber: 3,
        snapshot: { content: [] },
        createdAt: '2026-08-01T00:00:00.000Z',
        isTombstone: false,
      });
    });

    it('preserves the existing s-maxage / stale-while-revalidate header', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const response = await handleContentRoutes(contentRequest(), contentContext());

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe(
        'public, s-maxage=600, stale-while-revalidate=3000',
      );
    });

    // PCC-3676: non-main content is member-only, so it must never carry a
    // shareable `public` directive — a downstream CDN/ISR keyed on the bare URL
    // would serve one member's draft to anyone. It goes out private + no-store.
    it('marks non-main (draft) content private and unstored, never public', async () => {
      mocks.getBranchByName.mockResolvedValue({
        id: 'branch-feature', name: 'feature-x', siteId: SITE_ID, isMain: false,
      });
      mocks.getLatestDocumentVersionWithFallback.mockResolvedValue({
        version: {
          id: 'v9', versionNumber: 2, snapshot: { content: [] },
          createdAt: '2026-08-01T00:00:00.000Z', isTombstone: false,
        },
        inherited: false,
      });
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const req = new Request(
        `https://api.example.com/api/sites/${SITE_ID}/content/home?branch=feature-x`,
        { method: 'GET' },
      );
      const response = await handleContentRoutes(req, contentContext());

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    });

    it('marks a non-main page listing private and unstored', async () => {
      mocks.getBranchByName.mockResolvedValue({
        id: 'branch-feature', name: 'feature-x', siteId: SITE_ID, isMain: false,
      });
      mocks.listDocumentsOnBranch.mockResolvedValue([]);
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const req = new Request(
        `https://api.example.com/api/sites/${SITE_ID}/content-pages?branch=feature-x`,
        { method: 'GET' },
      );
      const response = await handleContentRoutes(req, pagesContext());

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    });

    it('tags the response with site and branch so publish can purge it', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const response = await handleContentRoutes(contentRequest(), contentContext());

      const tags = (response.headers.get('Cache-Tag') ?? '').split(',').map((t) => t.trim());
      expect(tags).toContain(`site:${SITE_ID}`);
      expect(tags).toContain(`branch:${BRANCH_ID}`);
      expect(tags).toContain(`doc:${DOCUMENT_ID}`);
    });

    // list:<siteId> is the listings' invalidation handle; if document pages
    // carried it too, every delete's listing purge would evict every page on
    // the site — the exact site-wide wave PCC-3709 removes.
    it('does not tag a document page with the listings tag', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const response = await handleContentRoutes(contentRequest(), contentContext());

      // A 404 here would also lack the list tag — pin the 200 so this cannot
      // pass vacuously when the setup breaks.
      expect(response.status).toBe(200);
      const tags = (response.headers.get('Cache-Tag') ?? '').split(',').map((t) => t.trim());
      expect(tags).not.toContain(`list:${SITE_ID}`);
    });
  });

  // The page list is cached for up to 300s and every publish changes it, so it
  // needs the same treatment as an individual page.
  describe('page list', () => {
    it('sets a bounded-TTL Cache-Control when the branch does not exist', async () => {
      mocks.getMainBranch.mockResolvedValue(null);
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const response = await handleContentRoutes(pagesRequest(), pagesContext());

      expect(response.status).toBe(404);
      expect(parseMaxAge(response.headers.get('Cache-Control'))).toBe(
        NOT_FOUND_CACHE_TTL_SECONDS,
      );
      expect(response.headers.get('Cache-Tag')).toBe(`site:${SITE_ID}`);
    });

    // Without a branch tag, publishing a new page leaves it missing from the
    // list for the full TTL with no way to invalidate it. The list tag is the
    // delete-class purge's handle for the same problem: deleting a page must
    // remove it from the cached listing without evicting the whole site
    // [PCC-3709].
    it('tags the list with the branch, site, and listings tags', async () => {
      mocks.listDocumentsOnBranch.mockResolvedValue([{ id: DOCUMENT_ID, path: 'home' }]);
      mocks.getLatestPublishedDocumentVersion.mockResolvedValue({
        id: 'v1',
        versionNumber: 3,
        createdAt: '2026-08-01T00:00:00.000Z',
        isTombstone: false,
      });
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const response = await handleContentRoutes(pagesRequest(), pagesContext());

      expect(response.status).toBe(200);
      const tags = (response.headers.get('Cache-Tag') ?? '').split(',').map((t) => t.trim());
      expect(tags).toContain(`site:${SITE_ID}`);
      expect(tags).toContain(`branch:${BRANCH_ID}`);
      expect(tags).toContain(`list:${SITE_ID}`);
    });
  });
});
