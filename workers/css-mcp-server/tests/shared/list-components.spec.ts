/**
 * list_components Tool Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

describe('list_components tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const defaultConfig = { baseUrl: 'http://localhost:8787', agentId: 'agent-1', agentApiKey: 'aak_test' };

  it('returns formatted list of components from the registry', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    // First call: list docs at /_registry/components/ prefix
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      documents: [
        { id: 'doc-hero', path: '/_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      ],
    }));

    // Second call: getDocumentLatestVersion for HeroBlock (by doc.id = 'doc-hero')
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      id: 'ver-1',
      documentId: 'doc-hero',
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

    const result = await handlers.list_components({ site_id: 'site-1', branch_id: 'branch-1' });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('HeroBlock');
    expect(text).toContain('[site]');
    expect(text).toContain('1 field');
    expect(text).toContain('Use for page hero sections.');

    // Verify the second call used doc.id (UUID), not the doc.path
    const [secondUrl] = mockFetch.mock.calls[1] as [string, ...unknown[]];
    expect(secondUrl).toContain('/documents/doc-hero/versions/latest');
    expect(secondUrl).not.toContain('%2F_registry'); // must not use encoded path
  });

  // Registry casing regression (PCC-3437 follow-up): the document path is
  // lowercased server-side, but the descriptor snapshot's own `name` field
  // preserves the component's real case. list_components must surface that
  // preserved-case name to the calling agent, not the lowercased path.
  it('surfaces the descriptor snapshot\'s original-case name, not the lowercased path', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      documents: [
        { id: 'doc-lc', path: '/_registry/components/leadcapture', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      ],
    }));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      id: 'ver-1',
      documentId: 'doc-lc',
      versionNumber: 1,
      snapshot: {
        name: 'LeadCapture',
        provenance: 'site',
        fields: [{ type: 'text', name: 'headline', label: 'Headline' }],
        defaultProps: { headline: '' },
      },
    }));

    const result = await handlers.list_components({ site_id: 'site-1', branch_id: 'branch-1' });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('LeadCapture');
    expect(text).not.toContain('leadcapture (');
  });

  it('returns a graceful message when no components are registered', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { documents: [] }));

    const result = await handlers.list_components({ site_id: 'site-1', branch_id: 'branch-1' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('No components registered');
  });

  it('returns isError true on API failure', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Internal server error' }, 500));

    const result = await handlers.list_components({ site_id: 'site-1', branch_id: 'branch-1' });

    expect(result.isError).toBe(true);
  });
});
