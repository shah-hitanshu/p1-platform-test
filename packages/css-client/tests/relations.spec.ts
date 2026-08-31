/**
 * CSS Client - Relations Endpoint Tests
 *
 * The upstream-diff endpoint returns a classified ChangeSummary describing how a
 * document has drifted from what it derives from. It is relation-agnostic: the
 * relationType query parameter selects the localization or template edge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';
import { NotFoundError } from '../src/errors.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('P1Client relations', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';
  const siteId = 'site-1';
  const branchId = 'branch-1';
  const documentId = 'doc-fr';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const summary = {
    relationType: 'localization',
    derivedDocumentId: 'doc-fr',
    upstreamDocumentId: 'doc-canonical',
    fromVersion: 3,
    toVersion: 5,
    slotDelta: {},
    changes: [
      {
        classification: 'needsTranslation',
        componentId: 'HeadingBlock-1',
        propPath: '/title',
        upstreamOldValue: 'Hello',
        upstreamNewValue: 'Hello there',
        documentValue: 'Bonjour',
        authority: 'canonical',
        translatable: true,
      },
      {
        classification: 'autoApplied',
        componentId: 'HeadingBlock-1',
        propPath: '/color',
        upstreamOldValue: '#000',
        upstreamNewValue: '#111',
        documentValue: '#000',
      },
      {
        classification: 'advisory',
        componentId: '__root__',
        propPath: '/title',
        upstreamOldValue: 'Home',
        upstreamNewValue: 'Homepage',
        documentValue: 'Accueil',
      },
    ],
    counts: {
      structural: 0,
      prop: 0,
      advisory: 1,
      needsTranslation: 1,
      autoApplied: 1,
    },
  };

  describe('getUpstreamDiff', () => {
    it('GETs the upstream-diff route with the localization relationType and parses the ChangeSummary', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => summary,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const result = await client.relations.getUpstreamDiff(
        siteId,
        branchId,
        documentId,
        'localization',
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(
        `${baseUrl}/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/upstream-diff?relationType=localization`,
      );
      expect(init.method).toBe('GET');

      expect(result.relationType).toBe('localization');
      expect(result.fromVersion).toBe(3);
      expect(result.toVersion).toBe(5);
      expect(result.changes).toHaveLength(3);
      expect(result.counts.needsTranslation).toBe(1);
      expect(result.changes[0].classification).toBe('needsTranslation');
      expect(result.changes[0].componentId).toBe('HeadingBlock-1');
    });

    it('requests the template edge when relationType is template', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...summary, relationType: 'template' }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      const result = await client.relations.getUpstreamDiff(
        siteId,
        branchId,
        documentId,
        'template',
      );

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(
        `${baseUrl}/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/upstream-diff?relationType=template`,
      );
      expect(result.relationType).toBe('template');
    });

    it('rejects with NotFoundError when no edge of that type exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'No localization edge' }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      await expect(
        client.relations.getUpstreamDiff(siteId, branchId, documentId, 'localization'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
