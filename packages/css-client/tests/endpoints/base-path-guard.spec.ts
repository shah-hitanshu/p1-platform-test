/**
 * Backstop for endpoints that interpolate a value into a URL without naming it:
 * an empty segment must fail here rather than reach the API, where proxies collapse
 * `/branches//templates` to `/branches/templates` and the branch is misread.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BaseEndpoint } from '../../src/endpoints/base.js';
import { MissingParameterError } from '../../src/errors.js';

describe('BaseEndpoint empty path segments', () => {
  let endpoint: BaseEndpoint;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    endpoint = new BaseEndpoint({ baseUrl: 'https://css.example.com' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws instead of sending a request with an empty middle segment', async () => {
    await expect(
      endpoint.request('/api/sites/site-1/branches//templates', { method: 'GET' }),
    ).rejects.toThrow(MissingParameterError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // No request was sent, so there is no server-issued id to quote.
  it('does not stamp a request id on a failure that never reached the API', async () => {
    await expect(
      endpoint.request('/api/sites/site-1/branches//templates', { method: 'GET' }),
    ).rejects.toMatchObject({ status: 400, requestId: undefined });
  });

  // It only sees an assembled path, so it must not invent an argument name to report.
  it('leaves `parameter` unset and quotes the path instead', async () => {
    await expect(
      endpoint.request('/api/sites/site-1/branches//templates', { method: 'GET' }),
    ).rejects.toMatchObject({ parameter: undefined });
    await expect(
      endpoint.request('/api/sites/site-1/branches//templates', { method: 'GET' }),
    ).rejects.toThrow('Missing required value in request path "/api/sites/site-1/branches//templates"');
  });

  it('allows a trailing empty segment — that is how the root document is addressed', async () => {
    await endpoint.request('/api/sites/site-1/documents/by-path/', { method: 'GET' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores empty segments that only appear in the query string', async () => {
    await endpoint.request('/api/sites/site-1/queries?path=//nested', { method: 'GET' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a well-formed path', async () => {
    await endpoint.request('/api/sites/site-1/branches/branch-1/templates', { method: 'GET' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://css.example.com/api/sites/site-1/branches/branch-1/templates',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
