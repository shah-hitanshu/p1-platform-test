/**
 * CCR Content Client Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1ContentClient } from '../src/content.js';
import type { PageContent, SeoMetadata, RedirectInfo } from '../src/content.js';
import { P1ApiError } from '../src/errors.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('P1ContentClient', () => {
  const baseUrl = 'http://localhost:8787';
  const apiToken = 'test-api-token';
  const siteId = 'site-123';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create client with required config', () => {
      const client = new P1ContentClient({ baseUrl, apiToken, siteId });
      expect(client).toBeInstanceOf(P1ContentClient);
    });

    it('should strip trailing slashes from baseUrl', async () => {
      const client = new P1ContentClient({
        baseUrl: 'http://localhost:8787///',
        apiToken,
        siteId,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ pages: [], branchId: 'b1', branchName: 'main', isMainBranch: true }),
      });

      await client.getPagePaths();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites/site-123/content-pages',
        expect.any(Object),
      );
    });
  });

  describe('getPage', () => {
    it('should construct correct URL with X-API-Key header', async () => {
      const mockPage = {
        documentId: 'doc-1',
        path: 'home',
        data: { title: 'Home' },
        branchId: 'branch-1',
        branchName: 'main',
        isMainBranch: true,
        versionNumber: 1,
        versionCreatedAt: '2026-01-01T00:00:00Z',
        etag: '"abc123"',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPage,
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });
      const result = await client.getPage('home');

      expect(result).toEqual(mockPage);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/content/home`,
        expect.objectContaining({
          headers: { 'X-API-Key': apiToken },
        }),
      );
    });

    it('should strip leading slashes from document path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ documentId: 'doc-1', path: 'about/team' }),
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });
      await client.getPage('/about/team');

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/content/about/team`,
        expect.any(Object),
      );
    });

    it('should append ?branch= query param when branchId is set', async () => {
      const branchId = 'branch-456';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ documentId: 'doc-1', path: 'home' }),
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId, branchId });
      await client.getPage('home');

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/content/home?branch=${branchId}`,
        expect.any(Object),
      );
    });

    it('should return null on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });
      const result = await client.getPage('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw P1ApiError on non-404 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });

      await expect(client.getPage('home')).rejects.toThrow(P1ApiError);
      await expect(async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => ({ error: 'Forbidden' }),
        });
        await client.getPage('home');
      }).rejects.toMatchObject({
        status: 403,
        message: 'Forbidden',
      });
    });

    it('should handle non-JSON error responses gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => { throw new Error('not JSON'); },
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });

      await expect(client.getPage('home')).rejects.toThrow(P1ApiError);
    });

    // PCC-3407: the content payload carries site-level SEO metadata for the
    // HTML <head> on public renders (og:site_name). Page-level tags are
    // derived client-side from the snapshot in `data`, so the wire type
    // carries only siteName. It rides on the read the page already makes.
    it('should surface SEO metadata from the content payload', async () => {
      const metadata: SeoMetadata = {
        siteName: 'Acme Docs',
      };
      const mockPage = {
        documentId: 'doc-1',
        metadata,
        path: 'about/team',
        data: { root: { props: {} } },
        branchId: 'branch-1',
        branchName: 'main',
        isMainBranch: true,
        versionNumber: 3,
        versionCreatedAt: '2026-01-01T00:00:00Z',
        etag: '"abc123"',
        inherited: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPage,
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });
      const result: PageContent | null = await client.getPage('about/team');

      expect(result?.metadata).toEqual(metadata);
      // Typed access proves the field exists on the interface.
      expect(result?.metadata?.siteName).toBe('Acme Docs');
      expect(result?.inherited).toBe(false);
    });

    it('should treat siteName as absent when omitted', async () => {
      // Every SeoMetadata field is optional; an empty object is a valid payload.
      const metadata: SeoMetadata = {};
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          documentId: 'doc-2',
          metadata,
          path: 'minimal',
          data: {},
          branchId: 'branch-1',
          branchName: 'main',
          isMainBranch: true,
          versionNumber: 1,
          versionCreatedAt: '2026-01-01T00:00:00Z',
          etag: '"def456"',
        }),
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });
      const result = await client.getPage('minimal');

      expect(result?.metadata).toEqual({});
      expect(result?.metadata?.siteName).toBeUndefined();
    });
  });

  describe('getPagePaths', () => {
    it('should construct correct URL and return page list', async () => {
      const mockResult = {
        pages: [
          { path: 'home', documentId: 'doc-1', lastModifiedAt: '2026-01-01T00:00:00Z' },
          { path: 'about', documentId: 'doc-2', lastModifiedAt: '2026-01-02T00:00:00Z' },
        ],
        branchId: 'branch-1',
        branchName: 'main',
        isMainBranch: true,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });
      const result = await client.getPagePaths();

      expect(result).toEqual(mockResult);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/content-pages`,
        expect.objectContaining({
          headers: { 'X-API-Key': apiToken },
        }),
      );
    });

    it('should append ?branch= query param when branchId is set', async () => {
      const branchId = 'branch-789';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ pages: [], branchId, branchName: 'dev', isMainBranch: false }),
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId, branchId });
      await client.getPagePaths();

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/content-pages?branch=${branchId}`,
        expect.any(Object),
      );
    });

    it('should throw P1ApiError on error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });

      await expect(client.getPagePaths()).rejects.toThrow(P1ApiError);
      await expect(async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Server error' }),
        });
        await client.getPagePaths();
      }).rejects.toMatchObject({
        status: 500,
        message: 'Server error',
      });
    });
  });

  describe('getRedirect', () => {
    it('should construct correct URL with X-API-Key header', async () => {
      const mockRedirect: RedirectInfo = {
        origin: '/old-page',
        destination: '/new-page',
        redirectType: 'permanent',
        parenting: false,
        statusCode: 301,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockRedirect,
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });
      const result = await client.getRedirect('/old-page');

      expect(result).toEqual(mockRedirect);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/content-redirects/old-page`,
        expect.objectContaining({
          headers: { 'X-API-Key': apiToken },
        }),
      );
    });

    it('should strip leading slashes from path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          origin: '/about/team',
          destination: '/team',
          redirectType: 'permanent',
          parenting: false,
          statusCode: 301,
        }),
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });
      await client.getRedirect('/about/team');

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/${siteId}/content-redirects/about/team`,
        expect.any(Object),
      );
    });

    it('should return null on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'No redirect found' }),
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });
      const result = await client.getRedirect('/nonexistent');

      expect(result).toBeNull();
    });

    it('should throw P1ApiError on non-404 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });

      await expect(client.getRedirect('/old-page')).rejects.toThrow(P1ApiError);
    });

    it('should handle temporary redirect with 302 status code', async () => {
      const mockRedirect: RedirectInfo = {
        origin: '/temp-page',
        destination: '/new-temp-page',
        redirectType: 'temporary',
        parenting: false,
        statusCode: 302,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockRedirect,
      });

      const client = new P1ContentClient({ baseUrl, apiToken, siteId });
      const result = await client.getRedirect('/temp-page');

      expect(result?.redirectType).toBe('temporary');
      expect(result?.statusCode).toBe(302);
    });
  });
});
