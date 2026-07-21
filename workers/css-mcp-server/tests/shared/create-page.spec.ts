/**
 * create_page Tool Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
vi.stubGlobal('crypto', {
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = (i * 17) % 256;
    return arr;
  },
});

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

describe('create_page tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const defaultConfig = { baseUrl: 'http://localhost:8787', agentId: 'agent-1', agentApiKey: 'aak_test' };

  it('creates a document with Puck Data in one atomic call', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    // Single atomic response: backend creates document + version together
    mockFetch.mockResolvedValueOnce(createMockResponse(
      true,
      {
        document: { id: 'doc-about', path: '/about', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
        version: { id: 'ver-1', versionNumber: 1, snapshot: {}, documentId: 'doc-about', branchId: 'branch-1', source: 'edit', createdById: '', createdByType: 'agent', createdAt: '' },
      },
      201,
    ));

    const result = await handlers.create_page({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_path: '/about',
      components: [
        { type: 'HeroBlock', props: { title: 'About Us' } },
        { type: 'TextBlock', props: { body: 'We are a team.' } },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('/about');
    // One HTTP call — document + version created atomically
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the POST body contains valid Puck Data as the snapshot
    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
    interface SnapshotBody { path: string; snapshot: { content: { type: string; props: { id: string } }[] } }
    const body = JSON.parse(init.body) as SnapshotBody;
    expect(body.path).toBe('/about');
    expect(body.snapshot.content).toHaveLength(2);
    expect(body.snapshot.content[0].type).toBe('HeroBlock');
    expect(typeof body.snapshot.content[0].props.id).toBe('string');
    expect(body.snapshot.content[0].props.id).toHaveLength(26); // ULID length
  });

  it('places zone components in zones object, not content', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(
      true,
      {
        document: { id: 'doc-1', path: '/page', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
        version: { id: 'ver-1', versionNumber: 1, snapshot: {}, documentId: 'doc-1', branchId: 'branch-1', source: 'edit', createdById: '', createdByType: 'agent', createdAt: '' },
      },
      201,
    ));

    await handlers.create_page({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_path: '/page',
      components: [
        { type: 'Layout', props: {} },
        { type: 'HeroBlock', props: { title: 'Hi' }, zone: 'mainSlot', parentId: 'PARENT-ID-123' },
      ],
    });

    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as {
      path: string;
      snapshot: {
        content: { type: string }[];
        zones?: Record<string, { type: string }[]>;
      };
    };

    // Layout goes to content (no zone), HeroBlock goes to zones
    expect(body.snapshot.content).toHaveLength(1);
    expect(body.snapshot.content[0].type).toBe('Layout');
    expect(body.snapshot.zones?.['PARENT-ID-123:mainSlot']).toHaveLength(1);
    expect(body.snapshot.zones?.['PARENT-ID-123:mainSlot'][0].type).toBe('HeroBlock');
  });

  // Test 16: All component instances get distinct 26-character ULID ids
  it('gives every component in content a distinct 26-character ULID id in props', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    // Override crypto to produce a unique sequence on each call so ULIDs are distinct
    let callCount = 0;
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        const seed = ++callCount;
        for (let i = 0; i < arr.length; i++) arr[i] = (i * 17 + seed * 31) % 256;
        return arr;
      },
    });

    mockFetch.mockResolvedValueOnce(createMockResponse(
      true,
      {
        document: { id: 'doc-1', path: '/page', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
        version: { id: 'ver-1', versionNumber: 1, snapshot: {}, documentId: 'doc-1', branchId: 'branch-1', source: 'edit', createdById: '', createdByType: 'agent', createdAt: '' },
      },
      201,
    ));

    await handlers.create_page({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_path: '/page',
      components: [
        { type: 'HeroBlock', props: { title: 'A' } },
        { type: 'TextBlock', props: { body: 'B' } },
        { type: 'CardBlock', props: { image: 'C' } },
      ],
    });

    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as {
      snapshot: { content: { props: { id: string } }[] };
    };

    expect(body.snapshot.content).toHaveLength(3);
    const ids = body.snapshot.content.map((c) => c.props.id);
    // All IDs are 26-character ULID strings
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id).toHaveLength(26);
    }
    // All IDs are distinct
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);
  });

  // Test 24 partial: Zone component also gets a ULID id in props
  it('gives zone components a 26-character ULID id in their props', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(
      true,
      {
        document: { id: 'doc-1', path: '/page', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
        version: { id: 'ver-1', versionNumber: 1, snapshot: {}, documentId: 'doc-1', branchId: 'branch-1', source: 'edit', createdById: '', createdByType: 'agent', createdAt: '' },
      },
      201,
    ));

    await handlers.create_page({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_path: '/page',
      components: [
        { type: 'Layout', props: {} },
        { type: 'HeroBlock', props: { title: 'Hi' }, zone: 'mainSlot', parentId: 'PARENT-ID-123' },
      ],
    });

    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as {
      snapshot: {
        content: { props: { id: string } }[];
        zones?: Record<string, { props: { id: string } }[]>;
      };
    };

    const zoneItems = body.snapshot.zones?.['PARENT-ID-123:mainSlot'] ?? [];
    expect(zoneItems).toHaveLength(1);
    expect(zoneItems[0].props.id).toHaveLength(26);
  });

  it('rejects document_path starting with /_registry/', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    const result = await handlers.create_page({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_path: '/_registry/components/Foo',
      components: [],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('_registry');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns isError true when document creation fails', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    // Backend returns 409 when path already exists (single call — atomic)
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Document already exists at this path' }, 409));

    const result = await handlers.create_page({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_path: '/existing',
      components: [],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('already exists');
  });
});
