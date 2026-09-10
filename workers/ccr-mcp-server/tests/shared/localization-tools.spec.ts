/**
 * Localization tools
 *
 * create_translation wraps the backend translations POST; list_locale_variants
 * wraps the translations GET; get_drift wraps the upstream-diff GET and defaults
 * its relation to localization; resolve_drift marks reconciled props against the
 * upstream-resolutions route.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

/** A tool result's leading text, empty when it led with content of another kind. */
function firstText(result: { content: { type: string; text?: unknown }[] }): string {
  const [first] = result.content;
  return first.type === 'text' ? String(first.text) : '';
}

const defaultConfig = {
  baseUrl: 'http://localhost:8787',
  agentId: 'agent-1',
  agentApiKey: 'aak_test',
};

describe('Localization tool definitions', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('lists create_translation, list_locale_variants, and get_drift with matching schemas', async () => {
    const { allTools, schemas } = await import('../../src/tools/index.js');
    const names = Object.keys(allTools);
    for (const tool of ['create_translation', 'list_locale_variants', 'get_drift', 'resolve_drift']) {
      expect(names).toContain(tool);
      expect(schemas).toHaveProperty(tool);
    }
  });

  it('get_drift description points to the existing edit tools for reconciliation', async () => {
    const { allTools } = await import('../../src/tools/index.js');
    const def = allTools.get_drift;
    expect(def.description).toMatch(/edit/i);
  });
});

describe('create_translation tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const createdResult = {
    document: { id: 'doc-fr', path: '/home.fr', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    version: { id: 'ver-1', versionNumber: 1, snapshot: {}, documentId: 'doc-fr', branchId: 'branch-1', source: 'edit', createdById: 'u1', createdByType: 'user', createdAt: '' },
    localization: { derivedDocumentId: 'doc-fr', upstreamDocumentId: 'doc-canonical', relationType: 'localization', syncedUpstreamVersion: 3 },
  };

  it('POSTs locale and path to the translations endpoint and returns the created translation', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, createdResult, 201));

    const result = await handlers.create_translation({
      site_id: 'site-1',
      branch_id: 'branch-1',
      canonical_document_id: 'doc-canonical',
      locale: 'fr',
      path: '/home.fr',
    });

    expect(result.isError).toBeFalsy();
    const [url, init] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(
      'http://localhost:8787/api/sites/site-1/branches/branch-1/documents/doc-canonical/translations',
    );
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body) as { locale: string; path?: string };
    expect(body.locale).toBe('fr');
    expect(body.path).toBe('/home.fr');

    const text = result.content[0].text;
    expect(text).toContain('doc-fr');
    expect(text).toContain('localization');
  });

  it('omits path from the body when not supplied', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, createdResult, 201));

    await handlers.create_translation({
      site_id: 'site-1',
      branch_id: 'branch-1',
      canonical_document_id: 'doc-canonical',
      locale: 'de',
    });

    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.locale).toBe('de');
    expect(body).not.toHaveProperty('path');
  });

  it('returns isError:true when the backend rejects the translation', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(
      createMockResponse(false, { error: 'locale is required' }, 400),
    );

    const result = await handlers.create_translation({
      site_id: 'site-1',
      branch_id: 'branch-1',
      canonical_document_id: 'doc-canonical',
      locale: 'fr',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('locale is required');
  });

  it('rejects an empty locale at the schema level', async () => {
    const { schemas } = await import('../../src/tools/index.js');
    const parsed = schemas.create_translation.safeParse({
      site_id: 'site-1',
      branch_id: 'branch-1',
      canonical_document_id: 'doc-canonical',
      locale: '',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('list_locale_variants tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('GETs the translations endpoint and returns the canonical and its variants', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      canonical: { id: 'doc-canonical', path: '/home', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      variants: [
        {
          document: { id: 'doc-fr', path: '/home.fr', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
          localization: { derivedDocumentId: 'doc-fr', upstreamDocumentId: 'doc-canonical', relationType: 'localization', syncedUpstreamVersion: 3 },
        },
      ],
    }));

    const result = await handlers.list_locale_variants({
      site_id: 'site-1',
      branch_id: 'branch-1',
      canonical_document_id: 'doc-canonical',
    });

    expect(result.isError).toBeFalsy();
    const [url, init] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe(
      'http://localhost:8787/api/sites/site-1/branches/branch-1/documents/doc-canonical/translations',
    );
    expect(init.method).toBe('GET');

    const text = result.content[0].text;
    expect(text).toContain('doc-canonical');
    expect(text).toContain('doc-fr');
  });

  it('returns isError:true when the document is not found', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(
      createMockResponse(false, { error: 'Document not found on this branch' }, 404),
    );

    const result = await handlers.list_locale_variants({
      site_id: 'site-1',
      branch_id: 'branch-1',
      canonical_document_id: 'missing',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });
});

describe('get_drift tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const summary = {
    relationType: 'localization',
    derivedDocumentId: 'doc-fr',
    upstreamDocumentId: 'doc-canonical',
    fromVersion: 3,
    toVersion: 5,
    slotDelta: { added: [], removed: [], moved: [] },
    changes: [
      { classification: 'needsTranslation', componentId: 'slot-1', propPath: '/title', translatable: true },
    ],
    counts: { structural: 0, prop: 0, advisory: 0, needsTranslation: 1, autoApplied: 0 },
  };

  it('GETs upstream-diff with relationType=localization by default and returns the classified summary', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, summary));

    const result = await handlers.get_drift({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_id: 'doc-fr',
    });

    expect(result.isError).toBeFalsy();
    const [url, init] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe(
      'http://localhost:8787/api/sites/site-1/branches/branch-1/documents/doc-fr/upstream-diff?relationType=localization',
    );
    expect(init.method).toBe('GET');

    const text = result.content[0].text;
    expect(text).toContain('needsTranslation');
    expect(text).toContain('localization');
  });

  it('passes relationType=template when the caller selects the template relation', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { ...summary, relationType: 'template' }));

    await handlers.get_drift({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_id: 'doc-page',
      relation_type: 'template',
    });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('relationType=template');
  });

  it('returns isError:true when the document has no relation of that type', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(
      createMockResponse(false, { error: 'No localization relation for this document' }, 404),
    );

    const result = await handlers.get_drift({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_id: 'doc-fr',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No localization relation');
  });

  it('rejects an unknown relation_type at the schema level', async () => {
    const { schemas } = await import('../../src/tools/index.js');
    const parsed = schemas.get_drift.safeParse({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_id: 'doc-fr',
      relation_type: 'sideways',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('resolve_drift tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const resolutions = { upstreamResolutions: { 'slot-1': { '/title': 5 } } };
  const url = 'http://localhost:8787/api/sites/site-1/branches/branch-1/documents/doc-fr/upstream-resolutions';

  it('PUTs the named prop and returns the stored resolutions', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, resolutions));

    const result = await handlers.resolve_drift({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_id: 'doc-fr',
      fields: [{ slot_id: 'slot-1', prop_path: '/title' }],
      upstream_version_id: '8f14e45f-ea2b-4c1f-9a3d-2b7c6d5e4f31',
    });

    expect(result.isError).toBeFalsy();
    const [calledUrl, init] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      targets: [{ slotId: 'slot-1', propPath: '/title' }],
      upstreamVersionId: '8f14e45f-ea2b-4c1f-9a3d-2b7c6d5e4f31',
    });
    expect(firstText(result)).toContain('upstreamResolutions');
  });

  it('sends the version the caller was shown, not one the server picks', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, resolutions));

    await handlers.resolve_drift({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_id: 'doc-fr',
      fields: [{ slot_id: 'slot-1', prop_path: '/title' }],
      upstream_version_id: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
    });

    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
    expect((JSON.parse(init.body) as { upstreamVersionId: string }).upstreamVersionId).toBe(
      '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
    );
  });

  it('refuses to record without the version the changes were read at', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    const result = await handlers.resolve_drift({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_id: 'doc-fr',
      fields: [{ slot_id: 'slot-1', prop_path: '/title' }],
    });

    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('DELETEs when the caller clears a mark', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { upstreamResolutions: {} }));

    await handlers.resolve_drift({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_id: 'doc-fr',
      fields: [{ slot_id: 'slot-1', prop_path: '/title' }],
      resolved: false,
    });

    const [, init] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({
      targets: [{ slotId: 'slot-1', propPath: '/title' }],
    });
  });

  it('marks every prop named in one call', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValue(createMockResponse(true, resolutions));

    const result = await handlers.resolve_drift({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_id: 'doc-fr',
      fields: [
        { slot_id: 'slot-1', prop_path: '/title' },
        { slot_id: 'slot-1', prop_path: '/badge/label' },
        { slot_id: '__root__', prop_path: '/title' },
      ],
      upstream_version_id: '8f14e45f-ea2b-4c1f-9a3d-2b7c6d5e4f31',
    });

    // One request carries the batch, so the edge is written once.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
    expect((JSON.parse(init.body) as { targets: unknown[] }).targets).toHaveLength(3);
    expect(firstText(result)).toContain('Marked 3');
  });

  it('marks nothing when one named change is refused', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(
      createMockResponse(false, { error: 'The canonical document holds no slot "slot-2"' }, 400),
    );

    const result = await handlers.resolve_drift({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_id: 'doc-fr',
      fields: [
        { slot_id: 'slot-1', prop_path: '/title' },
        { slot_id: 'slot-2', prop_path: '/body' },
      ],
      upstream_version_id: '8f14e45f-ea2b-4c1f-9a3d-2b7c6d5e4f31',
    });

    // The batch is one statement, so a refused target leaves the whole call undone
    // rather than settling some of it.
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('slot-2');
  });

  it('errors when no prop could be marked', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValue(createMockResponse(false, { error: 'nope' }, 404));

    const result = await handlers.resolve_drift({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_id: 'doc-fr',
      fields: [{ slot_id: 'slot-1', prop_path: '/title' }],
      upstream_version_id: '8f14e45f-ea2b-4c1f-9a3d-2b7c6d5e4f31',
    });

    expect(result.isError).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
  });
});

describe('get_drift resolved changes', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('asks for outstanding changes only by default', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { changes: [], resolvedCount: 2 }));

    await handlers.get_drift({ site_id: 'site-1', branch_id: 'branch-1', document_id: 'doc-fr' });

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).not.toContain('includeResolved');
  });

  it('asks for the resolved changes too when requested', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { changes: [], resolvedCount: 2 }));

    await handlers.get_drift({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_id: 'doc-fr',
      include_resolved: true,
    });

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain('includeResolved=true');
  });
});
