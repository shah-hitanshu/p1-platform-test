/**
 * Navigation placement tool tests (PCC-3162 Group B)
 *
 * Covers list_structures, get_navigation, add_navigation_item,
 * update_navigation_item, move_navigation_item, reorder_navigation_items,
 * remove_navigation_item.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ToolHandlers } from '../../src/shared/tools.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

const defaultConfig = {
  baseUrl: 'http://localhost:8787',
  agentId: 'agent-1',
  agentApiKey: 'aak_test',
};

const nodeFixture = {
  id: 'node-1',
  structureId: 'struct-1',
  parentNodeId: null,
  name: 'Pricing',
  slug: 'pricing',
  nodeType: 'document',
  documentId: 'doc-1',
  position: 0,
};

async function loadHandlers(actingUser?: { id: string; email: string }): Promise<ToolHandlers> {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  const { createToolHandlers } = await import('../../src/shared/tools.js');
  const config = actingUser !== undefined ? { ...defaultConfig, actingUser } : defaultConfig;
  return createToolHandlers(new McpApiClient(config), actingUser);
}

describe('list_structures tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('GETs the structures collection on a branch', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      structures: [{ id: 'struct-1', name: 'Main navigation', structureType: 'hierarchy' }],
    }));

    const result = await handlers.list_structures({ site_id: 'site-1', branch_id: 'branch-1' });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1/structures');
    expect(options.method).toBe('GET');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('struct-1');
  });

  it('forwards structure_type as the type query parameter', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { structures: [] }));

    await handlers.list_structures({ site_id: 'site-1', branch_id: 'branch-1', structure_type: 'collection' });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1/structures?type=collection');
  });

  it('reports an empty result clearly', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { structures: [] }));

    const result = await handlers.list_structures({ site_id: 'site-1', branch_id: 'branch-1' });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text.toLowerCase()).toContain('no structures');
  });

  it('schema rejects an invalid structure_type', async () => {
    const { schemas } = await import('../../src/shared/tools.js');
    expect(schemas.list_structures.safeParse({
      site_id: 'site-1', branch_id: 'branch-1', structure_type: 'bogus',
    }).success).toBe(false);
  });
});

describe('get_navigation tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('GETs the navigation tree for a structure', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      structureId: 'struct-1',
      structureName: 'Main navigation',
      tree: [{ id: 'node-1', name: 'Pricing', children: [] }],
    }));

    const result = await handlers.get_navigation({
      site_id: 'site-1', branch_id: 'branch-1', structure_id: 'struct-1',
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1/structures/struct-1/navigation');
    expect(options.method).toBe('GET');
    expect(result.content[0].text).toContain('Pricing');
  });
});

describe('add_navigation_item tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs a document node with camelCase body keys', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, nodeFixture, 201));

    const result = await handlers.add_navigation_item({
      site_id: 'site-1',
      branch_id: 'branch-1',
      structure_id: 'struct-1',
      name: 'Pricing',
      slug: 'pricing',
      node_type: 'document',
      position: 0,
      document_id: 'doc-1',
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1/structures/struct-1/nodes');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.name).toBe('Pricing');
    expect(body.slug).toBe('pricing');
    expect(body.nodeType).toBe('document');
    expect(body.position).toBe(0);
    expect(body.documentId).toBe('doc-1');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('node-1');
  });

  it('forwards parent_node_id and external_url for nested external links', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, nodeFixture, 201));

    await handlers.add_navigation_item({
      site_id: 'site-1',
      branch_id: 'branch-1',
      structure_id: 'struct-1',
      name: 'Docs',
      slug: 'docs',
      node_type: 'external',
      position: 1,
      parent_node_id: 'node-parent',
      external_url: 'https://example.test/docs',
    });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, unknown>;
    expect(body.parentNodeId).toBe('node-parent');
    expect(body.externalUrl).toBe('https://example.test/docs');
  });

  it('returns an error when a document node has no document_id', async () => {
    const handlers = await loadHandlers();

    const result = await handlers.add_navigation_item({
      site_id: 'site-1',
      branch_id: 'branch-1',
      structure_id: 'struct-1',
      name: 'Pricing',
      slug: 'pricing',
      node_type: 'document',
      position: 0,
    });

    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns an error when an external node has no external_url', async () => {
    const handlers = await loadHandlers();

    const result = await handlers.add_navigation_item({
      site_id: 'site-1',
      branch_id: 'branch-1',
      structure_id: 'struct-1',
      name: 'Docs',
      slug: 'docs',
      node_type: 'external',
      position: 0,
    });

    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('schema rejects an invalid node_type', async () => {
    const { schemas } = await import('../../src/shared/tools.js');
    expect(schemas.add_navigation_item.safeParse({
      site_id: 'site-1', branch_id: 'branch-1', structure_id: 'struct-1',
      name: 'X', slug: 'x', node_type: 'bogus', position: 0,
    }).success).toBe(false);
  });
});

describe('update_navigation_item tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('PATCHes name, slug, and position', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { ...nodeFixture, name: 'Plans' }));

    const result = await handlers.update_navigation_item({
      site_id: 'site-1',
      branch_id: 'branch-1',
      structure_id: 'struct-1',
      node_id: 'node-1',
      name: 'Plans',
      slug: 'plans',
      position: 2,
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/node-1');
    expect(options.method).toBe('PATCH');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.name).toBe('Plans');
    expect(body.slug).toBe('plans');
    expect(body.position).toBe(2);
    expect(result.content[0].text).toContain('Plans');
  });

  it('returns an error when no fields are provided to change', async () => {
    const handlers = await loadHandlers();

    const result = await handlers.update_navigation_item({
      site_id: 'site-1', branch_id: 'branch-1', structure_id: 'struct-1', node_id: 'node-1',
    });

    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('move_navigation_item tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs to the move endpoint with new parent and position', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { ...nodeFixture, parentNodeId: 'node-2', position: 1 }));

    const result = await handlers.move_navigation_item({
      site_id: 'site-1',
      branch_id: 'branch-1',
      structure_id: 'struct-1',
      node_id: 'node-1',
      new_parent_id: 'node-2',
      new_position: 1,
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/node-1/move');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.newParentId).toBe('node-2');
    expect(body.newPosition).toBe(1);
    expect(result.isError).toBeFalsy();
  });

  it('moves to top level when new_parent_id is omitted', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, nodeFixture));

    await handlers.move_navigation_item({
      site_id: 'site-1', branch_id: 'branch-1', structure_id: 'struct-1', node_id: 'node-1',
    });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, unknown>;
    expect(body.newParentId).toBeNull();
  });

  it('surfaces a circular-reference rejection as isError', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Move would create circular reference' }, 400));

    const result = await handlers.move_navigation_item({
      site_id: 'site-1', branch_id: 'branch-1', structure_id: 'struct-1', node_id: 'node-1', new_parent_id: 'node-1',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('circular reference');
  });
});

describe('reorder_navigation_items tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs the node order to the reorder endpoint', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { success: true, reorderedCount: 3 }));

    const result = await handlers.reorder_navigation_items({
      site_id: 'site-1',
      branch_id: 'branch-1',
      structure_id: 'struct-1',
      node_order: ['node-3', 'node-1', 'node-2'],
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/reorder');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.nodeOrder).toEqual(['node-3', 'node-1', 'node-2']);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('3');
  });

  it('scopes the reorder to a parent when parent_node_id is given', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { success: true, reorderedCount: 2 }));

    await handlers.reorder_navigation_items({
      site_id: 'site-1',
      branch_id: 'branch-1',
      structure_id: 'struct-1',
      parent_node_id: 'node-parent',
      node_order: ['node-1', 'node-2'],
    });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, unknown>;
    expect(body.parentNodeId).toBe('node-parent');
  });
});

describe('remove_navigation_item tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('DELETEs the node and reports success on 204', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, null, 204));

    const result = await handlers.remove_navigation_item({
      site_id: 'site-1', branch_id: 'branch-1', structure_id: 'struct-1', node_id: 'node-1',
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/node-1');
    expect(options.method).toBe('DELETE');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text.toLowerCase()).toContain('remov');
  });

  it('surfaces a not-found node as isError', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Node not found' }, 404));

    const result = await handlers.remove_navigation_item({
      site_id: 'site-1', branch_id: 'branch-1', structure_id: 'struct-1', node_id: 'missing',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Node not found');
  });
});

describe('navigation acting-user attribution', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('forwards acting-user headers on add_navigation_item', async () => {
    const handlers = await loadHandlers({ id: 'user-abc', email: 'a@b.test' });
    mockFetch.mockResolvedValueOnce(createMockResponse(true, nodeFixture, 201));

    await handlers.add_navigation_item({
      site_id: 'site-1',
      branch_id: 'branch-1',
      structure_id: 'struct-1',
      name: 'Pricing',
      slug: 'pricing',
      node_type: 'section',
      position: 0,
    });

    const [, options] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(options.headers['X-Acting-User-Id']).toBe('user-abc');
    expect(options.headers['X-Acting-User-Email']).toBe('a@b.test');
  });
});
