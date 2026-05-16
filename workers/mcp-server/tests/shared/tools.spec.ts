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

  // Test 18: 14 tool definitions
  it('should return exactly 14 tool definitions', async () => {
    const { getToolDefinitions } = await import('../../src/shared/tools.js');
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(14);
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
    expect(names).toContain('list_components');
    expect(names).toContain('create_page');
    expect(names).toContain('create_branch');
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

  // Test 26a: create_branch happy path
  it('create_branch should call apiClient.createBranch with mapped fields and format result', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      id: 'branch-new-1',
      siteId: 'site-1',
      name: 'draft-hero',
      description: 'PCC-1234',
      status: 'active',
      isMain: false,
      sourceBranchId: 'branch-main',
      sourceCheckpointId: 'cp-1',
      createdById: 'agent-1',
      createdByType: 'agent',
      createdAt: '2026-05-12T00:00:00Z',
      updatedAt: '2026-05-12T00:00:00Z',
    }, 201));

    const result = await handlers.create_branch({
      site_id: 'site-1',
      name: 'draft-hero',
      description: 'PCC-1234',
      parent_branch_id: 'branch-main',
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches');
    const body = JSON.parse(options.body) as { name: string; description?: string; parentBranchId?: string };
    expect(body.name).toBe('draft-hero');
    expect(body.description).toBe('PCC-1234');
    expect(body.parentBranchId).toBe('branch-main');

    const text = result.content[0]?.text ?? '';
    expect(text).toContain('branch-new-1');
    expect(text).toContain('draft-hero');
    expect(result.isError).toBeFalsy();
  });

  // Test 26b: create_branch error path surfaces isError:true
  it('create_branch should return isError:true when API rejects', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(false, {
      error: 'Branch with this name already exists',
    }, 409));

    const result = await handlers.create_branch({
      site_id: 'site-1',
      name: 'main',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('already exists');
  });

  // Test 26c: create_branch schema rejects empty name
  it('create_branch schema should reject empty name', async () => {
    const { schemas } = await import('../../src/shared/tools.js');
    const parseResult = schemas.create_branch.safeParse({
      site_id: 'site-1',
      name: '',
    });
    expect(parseResult.success).toBe(false);
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

/**
 * Agent attribution (PCC-3189 / red-team Finding 3 — Critical)
 *
 * Before the fix, both check_edit_permission and start_edit_session
 * hardcoded trigger:'autonomous' and never set requestedById, so the
 * backend audit log recorded "autonomous" for every MCP tool call —
 * defeating human-vs-AI attribution at the audit layer.
 *
 * Contract these tests lock in:
 *   - actingUser passed → trigger='human_requested', requestedById=actingUser.id
 *   - actingUser absent → trigger='autonomous', requestedById omitted
 *     (preserves the bypassed-OAuth fallback already warned about
 *      at src/index.ts:57-59)
 */
describe('Agent attribution (PCC-3189)', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const defaultConfig = {
    baseUrl: 'http://localhost:8787',
    agentId: 'agent-1',
    agentApiKey: 'aak_test',
  };
  const actingUser = { id: 'user-abc', email: 'a@b.test' };

  function bodyOfCall(callIndex: number): Record<string, unknown> {
    const [, options] = mockFetch.mock.calls[callIndex];
    return JSON.parse(String(options.body)) as Record<string, unknown>;
  }

  it('check_edit_permission with actingUser sends trigger=human_requested + requestedById', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client, actingUser);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { allowed: true }));
    await handlers.check_edit_permission({
      site_id: 's1', branch_id: 'b1', document_path: '/home',
      intent: 'tweak hero', target_regions: ['root.props.title'],
    });

    const body = bodyOfCall(0);
    expect(body.trigger).toBe('human_requested');
    expect(body.requestedById).toBe('user-abc');
  });

  it('start_edit_session with actingUser sends trigger=human_requested + requestedById', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client, actingUser);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      editSessionId: 'es-1', checkpointId: 'cp-1',
      expiresAt: '2026-01-01', reservedRegions: ['root.props.title'],
    }));
    await handlers.start_edit_session({
      site_id: 's1', branch_id: 'b1', document_path: '/home',
      intent: 'tweak hero', target_regions: ['root.props.title'],
    });

    const body = bodyOfCall(0);
    expect(body.trigger).toBe('human_requested');
    expect(body.requestedById).toBe('user-abc');
  });

  it('check_edit_permission without actingUser falls back to trigger=autonomous + no requestedById', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { allowed: true }));
    await handlers.check_edit_permission({
      site_id: 's1', branch_id: 'b1', document_path: '/home',
      intent: 'tweak hero', target_regions: ['root.props.title'],
    });

    const body = bodyOfCall(0);
    expect(body.trigger).toBe('autonomous');
    expect(body.requestedById).toBeUndefined();
  });

  it('start_edit_session without actingUser falls back to trigger=autonomous + no requestedById', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      editSessionId: 'es-1', checkpointId: 'cp-1',
      expiresAt: '2026-01-01', reservedRegions: [],
    }));
    await handlers.start_edit_session({
      site_id: 's1', branch_id: 'b1', document_path: '/home',
      intent: 'tweak hero', target_regions: [],
    });

    const body = bodyOfCall(0);
    expect(body.trigger).toBe('autonomous');
    expect(body.requestedById).toBeUndefined();
  });

  // Per ticket: "Add a unit test that fails if trigger==='autonomous'
  // while actingUser is set." This is the load-bearing invariant — the
  // entire reason the audit log can distinguish human-from-AI work
  // post-fix. Named explicitly so a future regression jumps out.
  it('NEVER sends trigger=autonomous when actingUser is set (regression invariant)', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client, actingUser);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { allowed: true }));
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      editSessionId: 'es-1', checkpointId: 'cp-1',
      expiresAt: '2026-01-01', reservedRegions: [],
    }));

    await handlers.check_edit_permission({
      site_id: 's1', branch_id: 'b1', document_path: '/home',
      intent: 'tweak hero', target_regions: ['root.props.title'],
    });
    await handlers.start_edit_session({
      site_id: 's1', branch_id: 'b1', document_path: '/home',
      intent: 'tweak hero', target_regions: ['root.props.title'],
    });

    expect(bodyOfCall(0).trigger).not.toBe('autonomous');
    expect(bodyOfCall(1).trigger).not.toBe('autonomous');
  });

  // Defensive edge case: if actingUser is somehow constructed with an
  // empty id (Google's `sub` claim shouldn't ever be empty in practice,
  // but a misconfigured upstream could deliver one), we must NOT ship
  // trigger='human_requested' with requestedById=''. The backend's
  // validateAgentContext (workers/src/services/agent-context-service.ts)
  // would reject that combo with HTTP 400. Better to fall through to
  // the autonomous path so the request still completes.
  it('treats empty actingUser.id as missing — falls back to autonomous', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client, { id: '', email: 'a@b.test' });

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { allowed: true }));
    await handlers.check_edit_permission({
      site_id: 's1', branch_id: 'b1', document_path: '/home',
      intent: 'tweak', target_regions: ['x'],
    });

    const body = bodyOfCall(0);
    expect(body.trigger).toBe('autonomous');
    expect(body.requestedById).toBeUndefined();
  });
});
