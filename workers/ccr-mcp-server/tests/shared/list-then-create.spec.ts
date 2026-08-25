/**
 * Test 4: End-to-end agent workflow — list_components → create_page
 *
 * Verifies that an agent can:
 * 1. Discover HeroBlock via list_components
 * 2. Use that component in create_page and get a valid ULID-stamped page
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
vi.stubGlobal('crypto', {
  getRandomValues: (arr: Uint8Array) => {
    let seed = 0;
    for (let i = 0; i < arr.length; i++) arr[i] = ((i * 17) + (++seed * 31)) % 256;
    return arr;
  },
});

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

describe('End-to-end agent workflow: list_components → create_page', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const defaultConfig = { baseUrl: 'http://localhost:8787', agentId: 'agent-1', agentApiKey: 'aak_test' };

  // Test 4: Agent calls list_components then create_page with discovered components
  it('discovers HeroBlock via list_components then creates a page using it with a ULID id', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    // Fetch 1: list_components → listDocuments returns one component doc
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      documents: [
        {
          id: 'doc-hero-uuid',
          path: '/_registry/components/HeroBlock',
          siteId: 'site-1',
          archived: false,
          createdAt: '',
          updatedAt: '',
        },
      ],
    }));

    // Fetch 2: list_components → getDocumentLatestVersion for HeroBlock (uses doc.id, not encoded path)
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      id: 'ver-1',
      documentId: 'doc-hero-uuid',
      versionNumber: 1,
      snapshot: {
        name: 'HeroBlock',
        label: 'Hero',
        provenance: 'site',
        fields: [{ type: 'text', name: 'title', label: 'Title' }],
        defaultProps: { title: '' },
        ai: { instructions: 'Use for page hero sections.' },
        descriptorHash: 'abc123',
        registeredAt: '2026-04-01T00:00:00Z',
      },
    }));

    // Step 1: Call list_components
    const listResult = await handlers.list_components({ site_id: 'site-1', branch_id: 'branch-1' });

    // Confirm HeroBlock is discoverable
    expect(listResult.isError).toBeFalsy();
    expect(listResult.content[0].text).toContain('HeroBlock');

    // Confirm the version fetch used the document UUID, not an encoded path
    const [secondUrl] = mockFetch.mock.calls[1] as [string, ...unknown[]];
    expect(secondUrl).toContain('/documents/doc-hero-uuid/versions/latest');
    expect(secondUrl).not.toContain('%2F');

    // Fetch 3: create_page → createDocument POST (atomic)
    mockFetch.mockResolvedValueOnce(createMockResponse(
      true,
      {
        document: {
          id: 'doc-landing',
          path: '/landing',
          siteId: 'site-1',
          archived: false,
          createdAt: '',
          updatedAt: '',
        },
        version: {
          id: 'ver-landing-1',
          versionNumber: 1,
          snapshot: {},
          documentId: 'doc-landing',
          branchId: 'branch-1',
          source: 'edit',
          createdById: '',
          createdByType: 'agent',
          createdAt: '',
        },
      },
      201,
    ));

    // Step 2: Call create_page using the component type discovered by list_components
    const createResult = await handlers.create_page({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_path: '/landing',
      components: [{ type: 'HeroBlock', props: { title: 'Welcome' } }],
    });

    // Step 3: Validate create_page result
    expect(createResult.isError).toBeFalsy();
    expect(createResult.content[0].text).toContain('/landing');

    // Inspect the POST body
    const [, createInit] = mockFetch.mock.calls[2] as [string, { body: string }];
    interface CreateBody {
      path: string;
      snapshot: {
        content: { type: string; props: { id: string; [key: string]: unknown } }[];
      };
    }
    const body = JSON.parse(createInit.body) as CreateBody;

    // Component type is preserved
    expect(body.snapshot.content[0].type).toBe('HeroBlock');

    // props.id is a 26-character ULID string
    expect(body.snapshot.content[0].props.id).toHaveLength(26);
    expect(typeof body.snapshot.content[0].props.id).toBe('string');

    // Exactly 3 total fetch calls: 1 list + 1 version + 1 create
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
