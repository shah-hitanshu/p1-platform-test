/**
 * Tool Definitions and Handlers Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

describe('Tool Definitions', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  // Test 18: 11 tool definitions
  it('should return exactly 11 tool definitions', async () => {
    const { getToolDefinitions } = await import('../../src/shared/tools.js');
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(11);
    const names = defs.map((d) => d.name);
    expect(names).toContain('list_sites');
    expect(names).toContain('list_branches');
    expect(names).toContain('list_documents');
    expect(names).toContain('get_document');
    expect(names).toContain('check_edit_permission');
    expect(names).toContain('start_edit_session');
    expect(names).toContain('apply_document_edits');
    expect(names).toContain('complete_edit_session');
    expect(names).toContain('abort_edit_session');
    expect(names).toContain('get_branch_presence');
    expect(names).toContain('get_document_presence');
  });

  // Test 19: Each tool has required fields
  it('should have name, description, and inputSchema for every tool', async () => {
    const { getToolDefinitions } = await import('../../src/shared/tools.js');
    const defs = getToolDefinitions();
    for (const def of defs) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.inputSchema).toBeDefined();
    }
  });
});

describe('Tool Handlers', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const defaultConfig = {
    baseUrl: 'http://localhost:8787',
    agentId: 'agent-1',
    agentApiKey: 'aak_test',
  };

  // Test 20: list_sites formatted output
  it('should format site list with UUIDs', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      sites: [{ id: 'site-1', pantheonSiteId: 'p1', name: 'My Site', createdAt: '2026-01-01' }],
      total: 1,
    }));

    const result = await handlers.list_sites();
    expect(result.content[0].text).toContain('site_id: site-1');
    expect(result.content[0].text).toContain('My Site');
  });

  // Test 21: list_sites empty
  it('should show message for empty site list', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));

    const result = await handlers.list_sites();
    expect(result.content[0].text).toContain('No sites found');
  });

  // Test 22: get_document with region
  it('should extract region from document snapshot', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      snapshot: { content: { body: 'Hello' } },
    }));

    const result = await handlers.get_document({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      region: '/content/body',
    });
    expect(result.content[0].text).toContain('Hello');
  });

  // Test 23: apply_document_edits normalizes paths
  it('should normalize JSON Pointer paths to dot-notation', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { success: true, version: 2 }));

    await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [{ type: 'replace', path: '/content/0/props/title', content: 'New' }],
    });

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.operations[0].path).toBe('content.0.props.title');
  });

  // Test 24: Tool handlers return isError on API errors
  it('should return isError:true on API errors', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const result = await handlers.list_sites();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error: Network failure');
  });

  // Test 25: get_branch_presence formats data
  it('should format branch presence data', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      siteId: 's1',
      branchId: 'b1',
      documents: [{
        documentId: 'd1',
        documentPath: '/home',
        actors: [{
          id: 'p1', actorId: 'u1', actorType: 'user', role: 'human',
          name: 'Alice', state: 'active', lastActivityAt: '2026-01-01', joinedAt: '2026-01-01',
        }],
        actorCount: 1,
        hasActiveEditors: false,
      }],
      totalActors: 1,
      totalDocuments: 1,
    }));

    const result = await handlers.get_branch_presence({ site_id: 's1', branch_id: 'b1' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalActors).toBe(1);
    expect(parsed.totalDocuments).toBe(1);
  });

  // Test 26: get_document_presence formats actor list
  it('should format document presence with role tags', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      presences: [
        {
          id: 'p1', actorId: 'u1', actorType: 'user', role: 'human',
          name: 'Alice', state: 'editing', lastActivityAt: '2026-01-01', joinedAt: '2026-01-01',
        },
        {
          id: 'p2', actorId: 'a1', actorType: 'agent', role: 'agent',
          name: 'Zappy', state: 'active', intent: 'Updating',
          lastActivityAt: '2026-01-01', joinedAt: '2026-01-01',
        },
      ],
    }));

    const result = await handlers.get_document_presence({
      site_id: 's1', branch_id: 'b1', document_path: '/home',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.actors).toContain('[agent]');
    expect(parsed.actors).toContain('[human]');
  });
});
