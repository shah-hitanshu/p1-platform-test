/**
 * documents.create() carries an optional locale, so a page authored in a market
 * locale records it in the same call that creates it rather than needing a
 * follow-up patch.
 *
 * A document with no locale is the ordinary case and sends no field at all,
 * which is what leaves it unlabelled rather than labelled null.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockDocument(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'doc-1',
    siteId: 'site-1',
    path: 'pages/nouveau',
    archived: false,
    createdAt: '2026-06-08T00:00:00Z',
    updatedAt: '2026-06-08T00:00:00Z',
    ...fields,
  };
}

describe('P1Client documents.create() - locale', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the locale in the request body when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ document: mockDocument({ locale: 'fr-FR' }) }),
    });

    const client = new P1Client({ baseUrl, apiKey });
    await client.documents.create({
      siteId: 'site-1',
      branchId: 'branch-1',
      path: 'pages/nouveau',
      locale: 'fr-FR',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.locale).toBe('fr-FR');
  });

  it('omits the locale from the request body when not provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ document: mockDocument() }),
    });

    const client = new P1Client({ baseUrl, apiKey });
    await client.documents.create({
      siteId: 'site-1',
      branchId: 'branch-1',
      path: 'pages/new-page',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect('locale' in body).toBe(false);
  });
});
