/**
 * create_page template-skeleton Tests
 *
 * When a template id is supplied the backend builds the page skeleton so the
 * page inherits the template's component slot ids. create_page forwards the
 * template id without a client-assembled snapshot; a client snapshot alongside
 * a template is rejected.
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

// createDocument creates the document and its first version in one POST.
const CREATE_DOCUMENT_RESPONSE = { document: { id: 'doc-1', path: '/home' }, version: { id: 'v1' } };

function isCreateDocumentCall([url, init]: [unknown, unknown]): boolean {
  return (
    typeof url === 'string' &&
    url.endsWith('/documents') &&
    (init as { method?: string } | undefined)?.method === 'POST'
  );
}

function createDocumentBody(): Record<string, unknown> {
  const call = mockFetch.mock.calls.find((c) => isCreateDocumentCall(c as [unknown, unknown]));
  if (call === undefined) {
    throw new Error('createDocument request was not forwarded to the backend');
  }
  const init = call[1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

function createDocumentForwarded(): boolean {
  return mockFetch.mock.calls.some((c) => isCreateDocumentCall(c as [unknown, unknown]));
}

describe('create_page from a template', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('forwards the template id and omits a client snapshot when a template id is given without components', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, CREATE_DOCUMENT_RESPONSE));

    const result = await handlers.create_page({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      template_id: 'tpl-1',
      components: [],
    });

    const body = createDocumentBody();
    expect(result.isError).not.toBe(true);
    expect(body.templateId).toBe('tpl-1');
    expect(Object.prototype.hasOwnProperty.call(body, 'snapshot')).toBe(false);
  });

  it('rejects a template id combined with components and forwards no create-document request', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, CREATE_DOCUMENT_RESPONSE));

    const result = await handlers.create_page({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      template_id: 'tpl-1',
      components: [{ type: 'HeroBlock', props: { title: 'Welcome' } }],
    });

    expect(result.isError).toBe(true);
    expect(createDocumentForwarded()).toBe(false);
  });

  it('forwards a snapshot carrying the components when no template id is given', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, CREATE_DOCUMENT_RESPONSE));

    const result = await handlers.create_page({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      components: [{ type: 'HeroBlock', props: { title: 'Welcome' } }],
    });

    const body = createDocumentBody();
    expect(result.isError).not.toBe(true);
    expect(Object.prototype.hasOwnProperty.call(body, 'templateId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'snapshot')).toBe(true);

    const snapshot = body.snapshot as { content: { type: string; props: { id: string } }[] };
    expect(snapshot.content[0].type).toBe('HeroBlock');
    expect(typeof snapshot.content[0].props.id).toBe('string');
    expect(snapshot.content[0].props.id.length).toBeGreaterThan(0);
  });

  it('forwards the root title when a template id and a title are given', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockResolvedValueOnce(createMockResponse(true, CREATE_DOCUMENT_RESPONSE));

    const result = await handlers.create_page({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      template_id: 'tpl-1',
      components: [],
      root_props: { title: 'My Page' },
    });

    const body = createDocumentBody();
    expect(result.isError).not.toBe(true);
    expect(body.templateId).toBe('tpl-1');
    expect(body.title).toBe('My Page');
  });
});
