/**
 * OAuth + MCP Flow Tests
 *
 * Component behaviors that compose the flow: health, acting-user header
 * forwarding, and tool-response formatting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

describe('OAuth + MCP Flow', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('GET /health returns 200 without auth', async () => {
    const { handleHealthCheck } = await import('../../src/health.js');
    const response = handleHealthCheck('local');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('healthy');
  });

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

  // The agent authoring round-trip (start -> apply -> complete) forwards the
  // caller's key and never fabricates an actor id; the backend resolves the
  // agent from the key and the edit session from its id.
  it('agent authoring round-trip forwards the key with no fabricated actor id', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient({
      baseUrl: 'http://localhost:8787',
      agentApiKey: 'aak_agent',
    });
    const handlers = createToolHandlers(client);

    mockFetch
      .mockResolvedValueOnce(createMockResponse(true, {
        editSessionId: 'sess-1',
        checkpointId: 'cp-1',
        expiresAt: '2026-01-01T00:00:00Z',
        reservedRegions: ['content.0'],
      }))
      .mockResolvedValueOnce(createMockResponse(true, { snapshot: {} }))
      .mockResolvedValueOnce(createMockResponse(true, { success: true, version: 2 }))
      .mockResolvedValueOnce(createMockResponse(true, { success: true, checkpointId: 'cp-2' }));

    await handlers.start_edit_session({
      site_id: 's1', branch_id: 'b1', document_path: '/home',
      intent: 'edit hero', target_regions: ['content.0'],
    });
    await handlers.apply_document_edits({
      site_id: 's1', branch_id: 'b1', document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [{ type: 'replace', path: 'content.0.props.title', content: 'Hi' }],
    });
    await handlers.complete_edit_session({
      site_id: 's1', branch_id: 'b1', document_path: '/home', edit_session_id: 'sess-1',
    });

    expect(mockFetch).toHaveBeenCalledTimes(4);

    const [, startOptions] = mockFetch.mock.calls[0];
    expect(startOptions.headers['X-API-Key']).toBe('aak_agent');
    expect(startOptions.headers['X-Actor-Type']).toBe('agent');
    expect(startOptions.headers['X-Actor-Id']).toBeUndefined();

    const [, applyOptions] = mockFetch.mock.calls[2];
    const applyBody = JSON.parse(applyOptions.body);
    expect(applyBody.editSessionId).toBe('sess-1');
    expect(applyBody.actorId).toBeUndefined();
    expect(applyOptions.headers['X-API-Key']).toBe('aak_agent');
  });

  // The human (OAuth) read path forwards the user's bearer token, marks the
  // actor type user, and sends no actor id or agent key.
  it('human read forwards the bearer token as a user with no actor id', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const actingUser = { id: 'auth0|user-1', email: 'u@ex.com' };
    const client = new McpApiClient({
      baseUrl: 'http://localhost:8787',
      accessToken: 'auth0-token',
      actingUser,
    });
    const handlers = createToolHandlers(client, actingUser);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      snapshot: { content: [] }, version: 1, documentPath: '/home',
    }));

    await handlers.get_document({ site_id: 's1', branch_id: 'b1', document_path: '/home' });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer auth0-token');
    expect(options.headers['X-Actor-Type']).toBe('user');
    expect(options.headers['X-Actor-Id']).toBeUndefined();
    expect(options.headers['X-API-Key']).toBeUndefined();
  });
});
