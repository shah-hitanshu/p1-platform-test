/**
 * CSS Client - Authority Overrides Endpoint Tests
 *
 * Per-translation authority overrides record, per prop, whether a slot's value
 * is inherited from the canonical ('canonical') or owned by this translation
 * ('locale'). Breaking inheritance PUTs 'locale'; resetting DELETEs the entry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('P1Client authority overrides', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';
  const siteId = 'site-1';
  const branchId = 'branch-1';
  const documentId = 'doc-fr';

  const url = `${baseUrl}/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/authority-overrides`;

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAuthorityOverrides', () => {
    it('GETs the document authority-overrides route and parses the map', async () => {
      const response = {
        authorityOverrides: {
          'comp-1': { title: 'locale', body: 'canonical' },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => response,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const result = await client.translations.getAuthorityOverrides(siteId, branchId, documentId);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, init] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe(url);
      expect(init.method).toBe('GET');
      expect(result.authorityOverrides['comp-1'].title).toBe('locale');
      expect(result.authorityOverrides['comp-1'].body).toBe('canonical');
    });

    it('parses an empty override map', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ authorityOverrides: {} }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      const result = await client.translations.getAuthorityOverrides(siteId, branchId, documentId);
      expect(result.authorityOverrides).toEqual({});
    });

    it('carries the template slot defaults and the fallback authority', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          authorityOverrides: { 'comp-1': { title: 'locale' } },
          slotDefaults: { 'comp-2': 'locale' },
          defaultAuthority: 'canonical',
        }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      const result = await client.translations.getAuthorityOverrides(siteId, branchId, documentId);

      expect(result.slotDefaults['comp-2']).toBe('locale');
      expect(result.defaultAuthority).toBe('canonical');
    });
  });

  describe('setAuthorityOverride', () => {
    it('PUTs slotId/propName/authority and returns the updated map', async () => {
      const response = {
        authorityOverrides: { 'comp-1': { title: 'locale' } },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => response,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const result = await client.translations.setAuthorityOverride(siteId, branchId, documentId, {
        slotId: 'comp-1',
        propName: 'title',
        authority: 'locale',
      });

      const [calledUrl, init] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe(url);
      expect(init.method).toBe('PUT');
      const body = JSON.parse(init.body);
      expect(body).toEqual({ slotId: 'comp-1', propName: 'title', authority: 'locale' });
      expect(result.authorityOverrides['comp-1'].title).toBe('locale');
    });

    it('supports resetting to canonical authority via PUT', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ authorityOverrides: { 'comp-1': { title: 'canonical' } } }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      await client.translations.setAuthorityOverride(siteId, branchId, documentId, {
        slotId: 'comp-1',
        propName: 'title',
        authority: 'canonical',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.authority).toBe('canonical');
    });
  });

  describe('clearAuthorityOverride', () => {
    it('DELETEs slotId/propName and returns the pruned map', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ authorityOverrides: {} }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      const result = await client.translations.clearAuthorityOverride(siteId, branchId, documentId, {
        slotId: 'comp-1',
        propName: 'title',
      });

      const [calledUrl, init] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe(url);
      expect(init.method).toBe('DELETE');
      const body = JSON.parse(init.body);
      expect(body).toEqual({ slotId: 'comp-1', propName: 'title' });
      expect(result.authorityOverrides).toEqual({});
    });
  });
});
