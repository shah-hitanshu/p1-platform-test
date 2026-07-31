/**
 * CSS Client - documents.create() snapshot passthrough
 *
 * The backend's document-create endpoint already accepts an optional
 * `snapshot` in the POST body and writes it as the initial version in the
 * same call — documents.create() never forwarded it, forcing every caller
 * to make a separate versions.create() call even when the content is known
 * up front. Needed so a write-only sync (no read access, no ConflictError
 * fallback via getByPath) can create-or-version a registry document in one
 * call instead of two.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('P1Client documents.create() - snapshot passthrough', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends snapshot in the request body when provided', async () => {
    const mockDocument = {
      id: 'doc-1',
      siteId: 'site-1',
      path: '_registry/components/Hero',
      archived: false,
      createdAt: '2026-06-08T00:00:00Z',
      updatedAt: '2026-06-08T00:00:00Z',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ document: mockDocument }),
    });

    const client = new P1Client({ baseUrl, apiKey });
    await client.documents.create({
      siteId: 'site-1',
      branchId: 'branch-1',
      path: '_registry/components/Hero',
      snapshot: { name: 'Hero', descriptorHash: 'abc123' },
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.snapshot).toEqual({ name: 'Hero', descriptorHash: 'abc123' });
  });

  it('omits snapshot from the request body when not provided', async () => {
    const mockDocument = {
      id: 'doc-2',
      siteId: 'site-1',
      path: '/blank-page',
      archived: false,
      createdAt: '2026-06-08T00:00:00Z',
      updatedAt: '2026-06-08T00:00:00Z',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ document: mockDocument }),
    });

    const client = new P1Client({ baseUrl, apiKey });
    await client.documents.create({
      siteId: 'site-1',
      branchId: 'branch-1',
      path: '/blank-page',
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.snapshot).toBeUndefined();
  });
});
