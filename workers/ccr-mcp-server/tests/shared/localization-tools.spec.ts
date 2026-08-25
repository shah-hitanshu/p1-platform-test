/**
 * Localization tools
 *
 * create_translation wraps the backend translations POST; list_locale_variants
 * wraps the translations GET; get_drift wraps the upstream-diff GET and defaults
 * its relation to localization.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

describe('Localization tool definitions', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('lists create_translation, list_locale_variants, and get_drift with matching schemas', async () => {
    const { getToolDefinitions, schemas } = await import('../../src/shared/tools.js');
    const names = getToolDefinitions().map((d) => d.name);
    for (const tool of ['create_translation', 'list_locale_variants', 'get_drift']) {
      expect(names).toContain(tool);
      expect(schemas).toHaveProperty(tool);
    }
  });

  it('get_drift description points to the existing edit tools for reconciliation', async () => {
    const { getToolDefinitions } = await import('../../src/shared/tools.js');
    const def = getToolDefinitions().find((d) => d.name === 'get_drift');
    expect(def?.description).toMatch(/edit/i);
  });
});

describe('create_translation tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const createdResult = {
    document: { id: 'doc-fr', path: '/home.fr', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    version: { id: 'ver-1', versionNumber: 1, snapshot: {}, documentId: 'doc-fr', branchId: 'branch-1', source: 'edit', createdById: 'u1', createdByType: 'user', createdAt: '' },
    localization: { sourceDocumentId: 'doc-fr', targetDocumentId: 'doc-canonical', relationType: 'localization', syncedVersion: 3 },
  };

  it('POSTs locale and path to the translations endpoint and returns the created translation', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

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
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

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
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

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
    const { schemas } = await import('../../src/shared/tools.js');
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
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      canonical: { id: 'doc-canonical', path: '/home', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      variants: [
        {
          document: { id: 'doc-fr', path: '/home.fr', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
          localization: { sourceDocumentId: 'doc-fr', targetDocumentId: 'doc-canonical', relationType: 'localization', syncedVersion: 3 },
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
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

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
    sourceDocumentId: 'doc-fr',
    targetDocumentId: 'doc-canonical',
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
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

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
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

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
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

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
    const { schemas } = await import('../../src/shared/tools.js');
    const parsed = schemas.get_drift.safeParse({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_id: 'doc-fr',
      relation_type: 'sideways',
    });
    expect(parsed.success).toBe(false);
  });
});
