/**
 * Merge request tool tests (PCC-3162 Group A)
 *
 * Covers create_merge_request, list_merge_requests, get_merge_request,
 * update_merge_request, execute_merge_request.
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

const mergeRequestFixture = {
  id: 'mr-1',
  siteId: 'site-1',
  sourceBranchId: 'branch-1',
  targetBranchId: 'branch-main',
  title: 'Pricing rewrite',
  description: 'PCC-3162',
  status: 'open',
  createdById: 'agent-1',
  createdByType: 'agent',
  createdAt: '2026-06-16T00:00:00Z',
  updatedAt: '2026-06-16T00:00:00Z',
};

async function loadHandlers(actingUser?: { id: string; email: string }): Promise<ToolHandlers> {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  const { createToolHandlers } = await import('../../src/shared/tools.js');
  return createToolHandlers(new McpApiClient(defaultConfig), actingUser);
}

describe('create_merge_request tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs title/description/source/target', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, mergeRequestFixture, 201));

    const result = await handlers.create_merge_request({
      site_id: 'site-1',
      source_branch_id: 'branch-1',
      target_branch_id: 'branch-main',
      title: 'Pricing rewrite',
      description: 'PCC-3162',
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/merge-requests');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.sourceBranchId).toBe('branch-1');
    expect(body.targetBranchId).toBe('branch-main');
    expect(body.title).toBe('Pricing rewrite');
    expect(body.description).toBe('PCC-3162');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('mr-1');
  });

  it('schema rejects an empty title', async () => {
    const { schemas } = await import('../../src/shared/tools.js');
    const parsed = schemas.create_merge_request.safeParse({
      site_id: 'site-1',
      source_branch_id: 'b1',
      target_branch_id: 'b2',
      title: '',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('list_merge_requests tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('GETs the collection without a status filter', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { mergeRequests: [mergeRequestFixture] }));

    const result = await handlers.list_merge_requests({ site_id: 'site-1' });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/merge-requests');
    expect(options.method).toBe('GET');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('mr-1');
  });

  it('appends the status query parameter when provided', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { mergeRequests: [] }));

    await handlers.list_merge_requests({ site_id: 'site-1', status: 'open' });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/merge-requests?status=open');
  });

  it('reports an empty result clearly', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { mergeRequests: [] }));

    const result = await handlers.list_merge_requests({ site_id: 'site-1' });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text.toLowerCase()).toContain('no merge requests');
  });

  it('schema rejects an invalid status', async () => {
    const { schemas } = await import('../../src/shared/tools.js');
    expect(schemas.list_merge_requests.safeParse({ site_id: 'site-1', status: 'bogus' }).success).toBe(false);
  });
});

describe('get_merge_request tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('GETs a single merge request by id', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, mergeRequestFixture));

    const result = await handlers.get_merge_request({ site_id: 'site-1', merge_request_id: 'mr-1' });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/merge-requests/mr-1');
    expect(options.method).toBe('GET');
    expect(result.content[0].text).toContain('Pricing rewrite');
  });

  it('returns isError when the merge request is missing', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Merge request not found' }, 404));

    const result = await handlers.get_merge_request({ site_id: 'site-1', merge_request_id: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });
});

describe('update_merge_request tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('PATCHes status to approve the request', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { ...mergeRequestFixture, status: 'approved' }));

    const result = await handlers.update_merge_request({
      site_id: 'site-1',
      merge_request_id: 'mr-1',
      status: 'approved',
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/merge-requests/mr-1');
    expect(options.method).toBe('PATCH');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.status).toBe('approved');
    expect(result.content[0].text).toContain('approved');
  });

  it('PATCHes title and description', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, mergeRequestFixture));

    await handlers.update_merge_request({
      site_id: 'site-1',
      merge_request_id: 'mr-1',
      title: 'New title',
      description: 'New description',
    });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, unknown>;
    expect(body.title).toBe('New title');
    expect(body.description).toBe('New description');
  });

  it('returns an error when no fields are provided to change', async () => {
    const handlers = await loadHandlers();

    const result = await handlers.update_merge_request({ site_id: 'site-1', merge_request_id: 'mr-1' });

    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('execute_merge_request tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs to the execute endpoint with an empty body when no resolutions are given', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { merged: true, publishedDocumentIds: [] }));

    const result = await handlers.execute_merge_request({ site_id: 'site-1', merge_request_id: 'mr-1' });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/merge-requests/mr-1/execute');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.resolutions).toBeUndefined();
    expect(result.isError).toBeFalsy();
  });

  it('maps snake_case resolutions to the backend resolutions shape', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { merged: true }));

    await handlers.execute_merge_request({
      site_id: 'site-1',
      merge_request_id: 'mr-1',
      resolutions: [{ document_id: 'doc-1', strategy: 'take-target' }],
    });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as {
      resolutions: { documentId: string; strategy: string }[];
    };
    expect(body.resolutions).toHaveLength(1);
    expect(body.resolutions[0]).toMatchObject({ documentId: 'doc-1', strategy: 'take-target' });
  });

  it('surfaces a not-allowed status error', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(
      false,
      { error: "Cannot execute merge request with status 'open'. Must be 'approved' or 'conflicted'." },
      400,
    ));

    const result = await handlers.execute_merge_request({ site_id: 'site-1', merge_request_id: 'mr-1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Must be');
  });
});
