/**
 * CSS Client - Versions keepalive Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('P1Client versions.create keepalive', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'v-1', documentId: 'doc-1', branchId: 'branch-1' }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets fetch keepalive when the option is passed', async () => {
    const client = new P1Client({ baseUrl, apiKey });
    await client.versions.create(
      'site-1',
      { documentId: 'doc-1', branchId: 'branch-1', snapshot: { content: [] } },
      { keepalive: true }
    );

    expect(mockFetch.mock.calls[0][1].keepalive).toBe(true);
  });

  it('does not set keepalive by default', async () => {
    const client = new P1Client({ baseUrl, apiKey });
    await client.versions.create('site-1', {
      documentId: 'doc-1',
      branchId: 'branch-1',
      snapshot: { content: [] },
    });

    expect(mockFetch.mock.calls[0][1].keepalive).toBeUndefined();
  });
});
