/**
 * create_translation carries the mode the locale's content is seeded with, and
 * offers only the modes the backend implements — so an agent cannot ask for
 * content this backend has no way to produce.
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

const createdResult = {
  document: {
    id: 'doc-fr',
    path: '/home.fr',
    siteId: 'site-1',
    archived: false,
    createdAt: '',
    updatedAt: '',
  },
  version: {
    id: 'ver-1',
    versionNumber: 1,
    snapshot: {},
    documentId: 'doc-fr',
    branchId: 'branch-1',
    source: 'edit',
    createdById: 'u1',
    createdByType: 'user',
    createdAt: '',
  },
  localization: {
    derivedDocumentId: 'doc-fr',
    upstreamDocumentId: 'doc-canonical',
    relationType: 'localization',
    syncedUpstreamVersion: 3,
  },
};

async function callCreateTranslation(
  input: Record<string, unknown>,
): Promise<{ locale: string; mode?: string }> {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  const { createTestHandlers } = await import('../helpers/tool-handlers.js');
  const handlers = await createTestHandlers(new McpApiClient(defaultConfig));

  mockFetch.mockResolvedValueOnce(createMockResponse(true, createdResult, 201));

  await handlers.create_translation({
    site_id: 'site-1',
    branch_id: 'branch-1',
    canonical_document_id: 'doc-canonical',
    locale: 'fr',
    ...input,
  });

  const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
  return JSON.parse(init.body) as { locale: string; mode?: string };
}

function parseInput(schema: { safeParse: (v: unknown) => { success: boolean } }, mode: string) {
  return schema.safeParse({
    site_id: 'site-1',
    branch_id: 'branch-1',
    canonical_document_id: 'doc-canonical',
    locale: 'fr',
    mode,
  });
}

describe('create_translation mode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the mode when one is named', async () => {
    const body = await callCreateTranslation({ mode: 'copy' });
    expect(body.mode).toBe('copy');
  });

  it('sends no mode when none is named', async () => {
    const body = await callCreateTranslation({});
    expect('mode' in body).toBe(false);
  });

  it('accepts copy', async () => {
    const { schemas } = await import('../../src/tools/index.js');
    expect(parseInput(schemas.create_translation, 'copy').success).toBe(true);
  });

  it.each(['empty', 'ai'])('refuses %s, which the backend does not implement', async (mode) => {
    const { schemas } = await import('../../src/tools/index.js');
    expect(parseInput(schemas.create_translation, mode).success).toBe(false);
  });
});
