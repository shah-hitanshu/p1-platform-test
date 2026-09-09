/**
 * CSS Client - Translations Endpoint Tests
 *
 * Localization create/list flow: a translation is a locale-tagged document
 * linked to a canonical document via a localization relationship.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';
import type {
  CreateTranslationResult,
  ListTranslationsResult,
  LocalizationRelation,
} from '../src/types.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('P1Client translations', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    const canonicalDocumentId = 'doc-canonical';
    const siteId = 'site-1';
    const branchId = 'branch-1';

    const createResponse: CreateTranslationResult = {
      document: {
        id: 'doc-fr',
        siteId,
        path: 'pages/home.fr-FR',
        archived: false,
        createdAt: '2026-07-13T00:00:00Z',
        updatedAt: '2026-07-13T00:00:00Z',
        locale: 'fr-FR',
      },
      version: {
        id: 'ver-1',
        documentId: 'doc-fr',
        branchId,
        versionNumber: 1,
        snapshot: { content: [], root: {} },
        source: 'initial',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-07-13T00:00:00Z',
      },
      localization: {
        derivedDocumentId: 'doc-fr',
        upstreamDocumentId: canonicalDocumentId,
        relationType: 'localization',
        syncedUpstreamVersion: 1,
        syncedUpstreamVersionId: 'ver-canonical-1',
      },
    };

    it('POSTs to the canonical document translations route with a locale body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => createResponse,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const result = await client.translations.create({
        siteId,
        branchId,
        canonicalDocumentId,
        locale: 'fr-FR',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(
        `${baseUrl}/api/sites/${siteId}/branches/${branchId}/documents/${canonicalDocumentId}/translations`,
      );
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.locale).toBe('fr-FR');
      // path is optional and omitted when not provided
      expect(body.path).toBeUndefined();

      // Parsed response carries the locale-tagged document and the linkage.
      expect(result.document.locale).toBe('fr-FR');
      expect(result.localization.derivedDocumentId).toBe('doc-fr');
      expect(result.localization.upstreamDocumentId).toBe(canonicalDocumentId);
      expect(result.localization.relationType).toBe('localization');
      expect(result.localization.syncedUpstreamVersion).toBe(1);
    });

    it('includes an explicit path in the body when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => createResponse,
      });

      const client = new P1Client({ baseUrl, apiKey });
      await client.translations.create({
        siteId,
        branchId,
        canonicalDocumentId,
        locale: 'fr-FR',
        path: 'pages/home.fr-FR',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.locale).toBe('fr-FR');
      expect(body.path).toBe('pages/home.fr-FR');
    });
  });

  describe('listVariants', () => {
    it('GETs the canonical document translations route and returns canonical + variants', async () => {
      const siteId = 'site-1';
      const branchId = 'branch-1';
      const canonicalDocumentId = 'doc-canonical';

      const listResponse: ListTranslationsResult = {
        canonical: {
          id: canonicalDocumentId,
          siteId,
          path: 'pages/home',
          archived: false,
          createdAt: '2026-07-13T00:00:00Z',
          updatedAt: '2026-07-13T00:00:00Z',
        },
        variants: [
          {
            document: {
              id: 'doc-fr',
              siteId,
              path: 'pages/home.fr-FR',
              archived: false,
              createdAt: '2026-07-13T00:00:00Z',
              updatedAt: '2026-07-13T00:00:00Z',
              locale: 'fr-FR',
            },
            localization: {
              derivedDocumentId: 'doc-fr',
              upstreamDocumentId: canonicalDocumentId,
              relationType: 'localization',
              syncedUpstreamVersion: 1,
              syncedUpstreamVersionId: 'ver-canonical-1',
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => listResponse,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const result = await client.translations.listVariants(siteId, branchId, canonicalDocumentId);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(
        `${baseUrl}/api/sites/${siteId}/branches/${branchId}/documents/${canonicalDocumentId}/translations`,
      );
      expect(init.method).toBe('GET');

      // A canonical has no locale; each variant does.
      expect(result.canonical.locale).toBeUndefined();
      expect(result.variants).toHaveLength(1);
      expect(result.variants[0].document.locale).toBe('fr-FR');
      expect(result.variants[0].localization.derivedDocumentId).toBe('doc-fr');
      expect(result.variants[0].localization.upstreamDocumentId).toBe(canonicalDocumentId);
    });
  });

  describe('LocalizationRelation contract', () => {
    it('names the variant as derived, the canonical as upstream, and allows an unpinned version', () => {
      // A "back to the original" link follows upstreamDocumentId; a document is a
      // translation when it appears as derivedDocumentId. Both pin fields are null
      // until the variant is pinned to a version of the canonical.
      const unbound: LocalizationRelation = {
        derivedDocumentId: 'doc-fr',
        upstreamDocumentId: 'doc-canonical',
        relationType: 'localization',
        syncedUpstreamVersion: null,
        syncedUpstreamVersionId: null,
      };

      expect(unbound.derivedDocumentId).toBe('doc-fr');
      expect(unbound.upstreamDocumentId).toBe('doc-canonical');
      expect(unbound.syncedUpstreamVersion).toBeNull();
    });
  });
});
