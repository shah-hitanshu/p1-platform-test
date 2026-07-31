/**
 * Branch lifecycle tool tests (PCC-3162 Group A)
 *
 * Covers get_branch, update_branch, archive_branch, restore_branch.
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

const branchFixture = {
  id: 'branch-1',
  siteId: 'site-1',
  name: 'draft-hero',
  description: 'PCC-3162',
  status: 'active',
  isMain: false,
  sourceBranchId: 'branch-main',
  sourceCheckpointId: 'cp-1',
  createdById: 'agent-1',
  createdByType: 'agent',
  createdAt: '2026-06-16T00:00:00Z',
  updatedAt: '2026-06-16T00:00:00Z',
};

async function loadHandlers(actingUser?: { id: string; email: string }): Promise<ToolHandlers> {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  const { createToolHandlers } = await import('../../src/shared/tools.js');
  const config = actingUser !== undefined ? { ...defaultConfig, actingUser } : defaultConfig;
  return createToolHandlers(new McpApiClient(config), actingUser);
}

describe('get_branch tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('GETs the branch and formats its details', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, branchFixture));

    const result = await handlers.get_branch({ site_id: 'site-1', branch_id: 'branch-1' });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1');
    expect(options.method).toBe('GET');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('branch-1');
    expect(result.content[0].text).toContain('draft-hero');
  });

  it('returns isError when the branch is not found', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Branch not found' }, 404));

    const result = await handlers.get_branch({ site_id: 'site-1', branch_id: 'missing' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Branch not found');
  });
});

describe('update_branch tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('PATCHes name and description', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { ...branchFixture, name: 'renamed' }));

    const result = await handlers.update_branch({
      site_id: 'site-1',
      branch_id: 'branch-1',
      name: 'renamed',
      description: 'updated note',
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1');
    expect(options.method).toBe('PATCH');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.name).toBe('renamed');
    expect(body.description).toBe('updated note');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('renamed');
  });

  it('PATCHes status when only status is provided', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { ...branchFixture, status: 'review' }));

    await handlers.update_branch({ site_id: 'site-1', branch_id: 'branch-1', status: 'review' });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, unknown>;
    expect(body.status).toBe('review');
  });

  it('schema rejects an unknown status value', async () => {
    const { schemas } = await import('../../src/shared/tools.js');
    const parsed = schemas.update_branch.safeParse({
      site_id: 'site-1',
      branch_id: 'branch-1',
      status: 'bogus',
    });
    expect(parsed.success).toBe(false);
  });

  it('returns an error when no fields are provided to change', async () => {
    const handlers = await loadHandlers();

    const result = await handlers.update_branch({ site_id: 'site-1', branch_id: 'branch-1' });

    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('archive_branch tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('DELETEs the branch and reports success on 204', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, null, 204));

    const result = await handlers.archive_branch({ site_id: 'site-1', branch_id: 'branch-1' });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1');
    expect(options.method).toBe('DELETE');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text.toLowerCase()).toContain('archiv');
  });

  it('returns isError when archiving the main branch is rejected', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Cannot archive the main branch' }, 400));

    const result = await handlers.archive_branch({ site_id: 'site-1', branch_id: 'branch-main' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cannot archive the main branch');
  });
});

describe('restore_branch tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs to the restore endpoint and returns the branch', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { ...branchFixture, status: 'active' }));

    const result = await handlers.restore_branch({ site_id: 'site-1', branch_id: 'branch-1' });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1/restore');
    expect(options.method).toBe('POST');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('branch-1');
  });

  it('returns isError when the branch is not archived', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Branch not found or not archived' }, 404));

    const result = await handlers.restore_branch({ site_id: 'site-1', branch_id: 'branch-1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not archived');
  });
});

describe('branch lifecycle acting-user attribution', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('forwards acting-user headers on update_branch', async () => {
    const handlers = await loadHandlers({ id: 'user-abc', email: 'a@b.test' });
    mockFetch.mockResolvedValueOnce(createMockResponse(true, branchFixture));

    await handlers.update_branch({ site_id: 'site-1', branch_id: 'branch-1', name: 'x' });

    const [, options] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(options.headers['X-Acting-User-Id']).toBe('user-abc');
    expect(options.headers['X-Acting-User-Email']).toBe('a@b.test');
  });
});
