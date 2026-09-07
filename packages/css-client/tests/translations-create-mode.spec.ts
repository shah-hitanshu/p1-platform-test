/**
 * translations.create() carries the mode its content is seeded with, so a caller
 * states which it wants rather than relying on the default meaning what it
 * happens to mean today.
 *
 * Omitting it sends no field, which is what leaves the server's default in
 * charge rather than pinning a mode the caller never chose.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function okResponse(): unknown {
  return {
    ok: true,
    status: 201,
    json: async () => ({
      document: { id: 'doc-fr', siteId: 'site-1', path: 'pricing.fr-FR', locale: 'fr-FR' },
      version: {},
      localization: {},
    }),
  };
}

function sentBody(): Record<string, unknown> {
  const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe('P1Client translations.create() - mode', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';

  const params = {
    siteId: 'site-1',
    branchId: 'branch-1',
    canonicalDocumentId: 'doc-canonical',
    locale: 'fr-FR',
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the mode when the caller names one', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    const client = new P1Client({ baseUrl, apiKey });
    await client.translations.create({ ...params, mode: 'copy' });

    expect(sentBody().mode).toBe('copy');
  });

  it('sends no mode when the caller names none', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    const client = new P1Client({ baseUrl, apiKey });
    await client.translations.create(params);

    expect('mode' in sentBody()).toBe(false);
  });

  it('carries the mode alongside an explicit path', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    const client = new P1Client({ baseUrl, apiKey });
    await client.translations.create({ ...params, path: 'tarifs', mode: 'copy' });

    expect(sentBody()).toMatchObject({ locale: 'fr-FR', path: 'tarifs', mode: 'copy' });
  });
});
