/**
 * OAuth Integration Tests
 *
 * Health endpoint accessibility and the API client's Bearer-token mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

describe('OAuth Integration', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('GET /health should be accessible without auth', async () => {
    const { handleHealthCheck } = await import('../../src/health.js');
    const response = handleHealthCheck('local');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('healthy');
  });

  // Bearer mode: identity lives in the token, so no X-API-Key or acting-user headers.
  it('sends the access token as a Bearer and omits API-key and acting-user headers', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const client = new McpApiClient({
      baseUrl: 'http://localhost:8787',
      agentId: 'mcp-server',
      accessToken: 'auth0-access-token-abc',
      actingUser: { id: 'auth0|user123', email: 'user@example.com' },
    });

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
    await client.listSites();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer auth0-access-token-abc');
    expect(options.headers['X-API-Key']).toBeUndefined();
    expect(options.headers['X-Acting-User-Id']).toBeUndefined();
    expect(options.headers['X-Acting-User-Email']).toBeUndefined();
  });
});
