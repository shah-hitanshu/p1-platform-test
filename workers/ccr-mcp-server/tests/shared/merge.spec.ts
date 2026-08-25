/**
 * Direct merge tool tests (PCC-3162 Group A)
 *
 * Covers preview_merge, check_merge, execute_merge.
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
  return createToolHandlers(new McpApiClient(defaultConfig), actingUser);
}

describe('check_merge tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs source/target to the check endpoint', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { mergeable: true, conflicts: [] }));

    const result = await handlers.check_merge({
      site_id: 'site-1',
      source_branch_id: 'branch-1',
      target_branch_id: 'branch-main',
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/merge/check');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.sourceBranchId).toBe('branch-1');
    expect(body.targetBranchId).toBe('branch-main');
    expect(result.isError).toBeFalsy();
  });

  it('schema requires source and target branch ids', async () => {
    const { schemas } = await import('../../src/shared/tools.js');
    expect(schemas.check_merge.safeParse({ site_id: 'site-1', source_branch_id: 'b1' }).success).toBe(false);
  });
});

describe('preview_merge tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('forwards includeContent and excludePathPrefixes to the preview endpoint', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { documents: [], summary: { changed: 0 } }));

    const result = await handlers.preview_merge({
      site_id: 'site-1',
      source_branch_id: 'branch-1',
      target_branch_id: 'branch-main',
      include_content: true,
      exclude_path_prefixes: ['_registry/'],
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/merge/preview');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.sourceBranchId).toBe('branch-1');
    expect(body.targetBranchId).toBe('branch-main');
    expect(body.includeContent).toBe(true);
    expect(body.excludePathPrefixes).toEqual(['_registry/']);
    expect(result.isError).toBeFalsy();
  });

  it('omits optional fields when not provided', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { documents: [] }));

    await handlers.preview_merge({
      site_id: 'site-1',
      source_branch_id: 'branch-1',
      target_branch_id: 'branch-main',
    });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, unknown>;
    expect(body.includeContent).toBeUndefined();
    expect(body.excludePathPrefixes).toBeUndefined();
  });
});

describe('execute_merge tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs to the execute endpoint with a message', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { merged: true, publishedDocumentIds: ['doc-1'] }));

    const result = await handlers.execute_merge({
      site_id: 'site-1',
      source_branch_id: 'branch-1',
      target_branch_id: 'branch-main',
      message: 'Ship pricing rewrite',
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/merge/execute');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.sourceBranchId).toBe('branch-1');
    expect(body.targetBranchId).toBe('branch-main');
    expect(body.message).toBe('Ship pricing rewrite');
    expect(result.isError).toBeFalsy();
  });

  it('maps snake_case conflict_resolutions to the backend conflictResolutions shape', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { merged: true }));

    await handlers.execute_merge({
      site_id: 'site-1',
      source_branch_id: 'branch-1',
      target_branch_id: 'branch-main',
      conflict_resolutions: [
        { document_id: 'doc-1', strategy: 'manual', resolved_snapshot: { content: [] } },
        { document_id: 'doc-2', strategy: 'take-source' },
      ],
    });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as {
      conflictResolutions: { documentId: string; strategy: string; resolvedSnapshot?: unknown }[];
    };
    expect(body.conflictResolutions).toHaveLength(2);
    expect(body.conflictResolutions[0]).toMatchObject({
      documentId: 'doc-1',
      strategy: 'manual',
      resolvedSnapshot: { content: [] },
    });
    expect(body.conflictResolutions[1]).toMatchObject({ documentId: 'doc-2', strategy: 'take-source' });
    expect(body.conflictResolutions[1].resolvedSnapshot).toBeUndefined();
  });

  it('surfaces a 409 conflict as isError', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Merge has unresolved conflicts' }, 409));

    const result = await handlers.execute_merge({
      site_id: 'site-1',
      source_branch_id: 'branch-1',
      target_branch_id: 'branch-main',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('unresolved conflicts');
  });

  it('schema rejects an invalid conflict strategy', async () => {
    const { schemas } = await import('../../src/shared/tools.js');
    const parsed = schemas.execute_merge.safeParse({
      site_id: 'site-1',
      source_branch_id: 'b1',
      target_branch_id: 'b2',
      conflict_resolutions: [{ document_id: 'd1', strategy: 'nonsense' }],
    });
    expect(parsed.success).toBe(false);
  });
});
