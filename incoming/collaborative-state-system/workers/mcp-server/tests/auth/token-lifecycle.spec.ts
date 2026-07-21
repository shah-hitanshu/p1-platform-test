/**
 * Token Lifecycle Tests
 *
 * Tests that user claims from OAuth tokens flow through to the API client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

describe('Token Lifecycle', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  // Test 92: Token with user claims makes actingUser available
  it('should create API client with actingUser from token claims', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const client = new McpApiClient({
      baseUrl: 'http://localhost:8787',
      agentId: 'agent-1',
      agentApiKey: 'aak_test',
      actingUser: { id: 'u1', email: 'u@test.com' },
    });

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
    await client.listSites();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['X-Acting-User-Id']).toBe('u1');
    expect(options.headers['X-Acting-User-Email']).toBe('u@test.com');
  });

  // Test 93: Token without user claims works in agent-only mode
  it('should work without acting-user when token lacks user info', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const client = new McpApiClient({
      baseUrl: 'http://localhost:8787',
      agentId: 'agent-1',
      agentApiKey: 'aak_test',
    });

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
    await client.listSites();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['X-Acting-User-Id']).toBeUndefined();
    expect(options.headers['X-Acting-User-Email']).toBeUndefined();
  });
});
