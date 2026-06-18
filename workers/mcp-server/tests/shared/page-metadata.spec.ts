/**
 * Page metadata tool tests (PCC-3162 Group B)
 *
 * Covers get_page_metadata and set_page_metadata.
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

async function loadHandlers(actingUser?: { id: string; email: string }): Promise<ToolHandlers> {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  const { createToolHandlers } = await import('../../src/shared/tools.js');
  const config = actingUser !== undefined ? { ...defaultConfig, actingUser } : defaultConfig;
  return createToolHandlers(new McpApiClient(config), actingUser);
}

const metaUrl =
  'http://localhost:8787/api/sites/site-1/branches/branch-1/structures/struct-1/documents/doc-1/metadata';

describe('get_page_metadata tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('GETs the document metadata within a structure', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      documentId: 'doc-1',
      metadata: { title: 'Pricing', publishedAt: '2026-06-16' },
    }));

    const result = await handlers.get_page_metadata({
      site_id: 'site-1', branch_id: 'branch-1', structure_id: 'struct-1', document_id: 'doc-1',
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe(metaUrl);
    expect(options.method).toBe('GET');
    expect(result.content[0].text).toContain('Pricing');
  });

  it('surfaces missing metadata as isError', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Document metadata not found' }, 404));

    const result = await handlers.get_page_metadata({
      site_id: 'site-1', branch_id: 'branch-1', structure_id: 'struct-1', document_id: 'doc-1',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });
});

describe('set_page_metadata tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('PUTs the metadata object as the request body', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      documentId: 'doc-1',
      metadata: { title: 'Pricing', seoDescription: 'Plans and pricing' },
    }));

    const result = await handlers.set_page_metadata({
      site_id: 'site-1',
      branch_id: 'branch-1',
      structure_id: 'struct-1',
      document_id: 'doc-1',
      metadata: { title: 'Pricing', seoDescription: 'Plans and pricing' },
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(metaUrl);
    expect(options.method).toBe('PUT');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body).toEqual({ title: 'Pricing', seoDescription: 'Plans and pricing' });
    expect(result.isError).toBeFalsy();
  });

  it('surfaces a schema validation failure as isError', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Schema validation failed' }, 400));

    const result = await handlers.set_page_metadata({
      site_id: 'site-1',
      branch_id: 'branch-1',
      structure_id: 'struct-1',
      document_id: 'doc-1',
      metadata: { title: 42 },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Schema validation failed');
  });

  it('forwards acting-user headers', async () => {
    const handlers = await loadHandlers({ id: 'user-abc', email: 'a@b.test' });
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { documentId: 'doc-1', metadata: {} }));

    await handlers.set_page_metadata({
      site_id: 'site-1',
      branch_id: 'branch-1',
      structure_id: 'struct-1',
      document_id: 'doc-1',
      metadata: { title: 'X' },
    });

    const [, options] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(options.headers['X-Acting-User-Id']).toBe('user-abc');
    expect(options.headers['X-Acting-User-Email']).toBe('a@b.test');
  });
});
