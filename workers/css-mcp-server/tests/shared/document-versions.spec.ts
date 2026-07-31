/**
 * Document version tool tests (PCC-3162 Group C)
 *
 * Covers list_document_versions, get_document_version, restore_document_version.
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

const versionId = '11111111-1111-4111-8111-111111111111';
const versionsUrl = 'http://localhost:8787/api/sites/site-1/branches/branch-1/documents/doc-1/versions';

async function loadHandlers(actingUser?: { id: string; email: string }): Promise<ToolHandlers> {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  const { createToolHandlers } = await import('../../src/shared/tools.js');
  const config = actingUser !== undefined ? { ...defaultConfig, actingUser } : defaultConfig;
  return createToolHandlers(new McpApiClient(config), actingUser);
}

describe('list_document_versions tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('GETs the version history for a document', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      versions: [
        { id: versionId, versionNumber: 2, source: 'edit' },
        { id: 'older', versionNumber: 1, source: 'create' },
      ],
    }));

    const result = await handlers.list_document_versions({
      site_id: 'site-1', branch_id: 'branch-1', document_id: 'doc-1',
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe(versionsUrl);
    expect(options.method).toBe('GET');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain(versionId);
  });

  it('reports an empty history clearly', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { versions: [] }));

    const result = await handlers.list_document_versions({
      site_id: 'site-1', branch_id: 'branch-1', document_id: 'doc-1',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text.toLowerCase()).toContain('no versions');
  });
});

describe('get_document_version tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('GETs a single version snapshot by id', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      id: versionId,
      versionNumber: 2,
      snapshot: { content: [{ type: 'Hero', props: { id: 'h1' } }], root: { props: {} } },
    }));

    const result = await handlers.get_document_version({
      site_id: 'site-1', branch_id: 'branch-1', document_id: 'doc-1', version_id: versionId,
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe(`${versionsUrl}/${versionId}`);
    expect(options.method).toBe('GET');
    expect(result.content[0].text).toContain('Hero');
  });

  it('surfaces a missing version as isError', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Version not found' }, 404));

    const result = await handlers.get_document_version({
      site_id: 'site-1', branch_id: 'branch-1', document_id: 'doc-1', version_id: versionId,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Version not found');
  });
});

describe('restore_document_version tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reads the target snapshot then writes it as a new version', async () => {
    const handlers = await loadHandlers();
    const snapshot = { content: [{ type: 'Hero', props: { id: 'h1' } }], root: { props: {} } };
    mockFetch
      .mockResolvedValueOnce(createMockResponse(true, { id: versionId, versionNumber: 2, snapshot }))
      .mockResolvedValueOnce(createMockResponse(true, { id: 'new-version', versionNumber: 3, snapshot }, 201));

    const result = await handlers.restore_document_version({
      site_id: 'site-1', branch_id: 'branch-1', document_id: 'doc-1', version_id: versionId,
    });

    const [getUrl, getOptions] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(getUrl).toBe(`${versionsUrl}/${versionId}`);
    expect(getOptions.method).toBe('GET');

    const [postUrl, postOptions] = mockFetch.mock.calls[1] as [string, { method: string; body: string }];
    expect(postUrl).toBe(versionsUrl);
    expect(postOptions.method).toBe('POST');
    const body = JSON.parse(postOptions.body) as Record<string, unknown>;
    expect(body.snapshot).toEqual(snapshot);

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('new-version');
  });

  it('does not write when the target version cannot be read', async () => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Version not found' }, 404));

    const result = await handlers.restore_document_version({
      site_id: 'site-1', branch_id: 'branch-1', document_id: 'doc-1', version_id: versionId,
    });

    expect(result.isError).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
