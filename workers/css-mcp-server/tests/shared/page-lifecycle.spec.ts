/**
 * Page lifecycle tool tests (PCC-3162 Group C)
 *
 * Covers publish_page, archive_page, restore_page, rename_page.
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

describe('publish_page tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs to the branch-scoped publish endpoint', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { published: true, versionId: 'v-1' }));

    const result = await handlers.publish_page({
      site_id: 'site-1', branch_id: 'branch-1', document_id: 'doc-1',
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1/documents/doc-1/publish');
    expect(options.method).toBe('POST');
    expect(result.isError).toBeFalsy();
  });

  it('surfaces a missing page as isError', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Document not found on this branch' }, 404));

    const result = await handlers.publish_page({
      site_id: 'site-1', branch_id: 'branch-1', document_id: 'doc-1',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });
});

describe('archive_page tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('DELETEs the page on the branch and reports success on 204', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, null, 204));

    const result = await handlers.archive_page({
      site_id: 'site-1', branch_id: 'branch-1', document_id: 'doc-1',
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1/documents/doc-1');
    expect(options.method).toBe('DELETE');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text.toLowerCase()).toContain('archiv');
  });
});

describe('restore_page tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs to the site-scoped restore endpoint', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { id: 'doc-1', path: 'pricing', archivedAt: null }));

    const result = await handlers.restore_page({ site_id: 'site-1', document_id: 'doc-1' });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/documents/doc-1/restore');
    expect(options.method).toBe('POST');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('doc-1');
  });

  it('surfaces a document that is not archived as isError', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Document not found or not archived' }, 404));

    const result = await handlers.restore_page({ site_id: 'site-1', document_id: 'doc-1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not archived');
  });
});

describe('rename_page tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('PATCHes the new path on the site-scoped document', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { id: 'doc-1', path: 'plans' }));

    const result = await handlers.rename_page({ site_id: 'site-1', document_id: 'doc-1', path: 'plans' });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/documents/doc-1');
    expect(options.method).toBe('PATCH');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.path).toBe('plans');
    expect(result.content[0].text).toContain('plans');
  });

  it('surfaces a path conflict as isError', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Path is now occupied by another document' }, 409));

    const result = await handlers.rename_page({ site_id: 'site-1', document_id: 'doc-1', path: 'about' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('occupied');
  });

  it('forwards acting-user headers', async () => {
    const handlers = await loadHandlers({ id: 'user-abc', email: 'a@b.test' });
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { id: 'doc-1', path: 'plans' }));

    await handlers.rename_page({ site_id: 'site-1', document_id: 'doc-1', path: 'plans' });

    const [, options] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(options.headers['X-Acting-User-Id']).toBe('user-abc');
    expect(options.headers['X-Acting-User-Email']).toBe('a@b.test');
  });
});
