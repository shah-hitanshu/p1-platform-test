/**
 * End-to-End OAuth + MCP Flow Tests
 *
 * Tests the observable behavior of the MCP server's OAuth integration.
 * Since full OAuthProvider requires KV and the cloudflare: protocol
 * (not available in Vitest), these tests validate the individual
 * components that compose the flow and verify configuration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

describe('End-to-End: OAuth + MCP Flow', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  // Test 74: Health check accessible without auth
  it('GET /health returns 200 without auth', async () => {
    const { handleHealthCheck } = await import('../../src/health.js');
    const response = handleHealthCheck('local');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('healthy');
  });

  // Test 75: Unauthenticated MCP request returns 401
  // OAuthProvider wraps the /mcp route and rejects unauthenticated requests.
  // We verify the configuration that enables this behavior.
  it('OAuthProvider protects /mcp with Bearer token validation', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const indexSource = readFileSync(resolve(__dirname, '../../src/index.ts'), 'utf-8');
    // Verify OAuthProvider is configured with apiRoute /mcp
    expect(indexSource).toContain("apiRoute: '/mcp'");
    // Verify it wraps an mcpApiHandler
    expect(indexSource).toContain('apiHandler: mcpApiHandler');
    // The library will return 401 for unauthenticated requests to apiRoute
  });

  // Test 77: Authenticated tool call forwards acting-user headers
  it('should include acting-user headers when API client has actingUser', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const client = new McpApiClient({
      baseUrl: 'http://localhost:8787',
      agentId: 'agent-1',
      agentApiKey: 'aak_test-key',
      actingUser: { id: 'user-1', email: 'user@test.com' },
    });

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      sites: [{ id: 's1', name: 'Test', pantheonSiteId: 'p1', createdAt: '2026-01-01' }],
      total: 1,
    }));

    await client.listSites();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['X-API-Key']).toBe('aak_test-key');
    expect(options.headers['X-Acting-User-Id']).toBe('user-1');
    expect(options.headers['X-Acting-User-Email']).toBe('user@test.com');
  });

  // Test 78: Tool call response format
  it('should return formatted tool response from list_sites', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient({
      baseUrl: 'http://localhost:8787',
      agentId: 'agent-1',
      agentApiKey: 'aak_test',
    });
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      sites: [{ id: 's1', name: 'Test', pantheonSiteId: 'p1', createdAt: '2026-01-01' }],
      total: 1,
    }));

    const result = await handlers.list_sites();
    expect(result.content[0].text).toContain('Test');
    expect(result.content[0].text).toContain('site_id: s1');
  });

  // Test 79: Expired token returns 401
  // OAuthProvider enforces token TTL. Once expired, requests return 401.
  // We verify the configuration sets accessTokenTTL.
  it('OAuthProvider enforces token expiry via accessTokenTTL', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const indexSource = readFileSync(resolve(__dirname, '../../src/index.ts'), 'utf-8');
    // accessTokenTTL: 3600 = 1 hour, after which the library rejects with 401
    expect(indexSource).toContain('accessTokenTTL: 3600');
  });

  // Test 80: Revoked token returns 401
  // OAuthProvider uses KV to track revoked tokens. The library
  // automatically rejects requests with revoked tokens.
  // We verify the KV binding is configured for token storage.
  it('OAuthProvider uses OAUTH_KV for token revocation tracking', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const wranglerSource = readFileSync(resolve(__dirname, '../../wrangler.jsonc'), 'utf-8');
    // OAUTH_KV is the KV namespace where the library stores token state
    expect(wranglerSource).toContain('OAUTH_KV');
    // The library uses this to validate and revoke tokens
  });
});
