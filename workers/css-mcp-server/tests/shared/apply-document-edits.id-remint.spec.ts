/**
 * apply_document_edits id re-minting Tests
 *
 * Agent-supplied component content is an injection boundary: incoming component
 * ids are re-minted at the op boundary before ops are forwarded to the backend.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

// A minted slot id is `${type}-${uuid}`; this matches the trailing uuid.
const MINTED_ID_SUFFIX = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Component {
  type: string;
  props: Record<string, unknown> & { id: string };
}

interface ForwardedOp {
  type: string;
  path: string;
  content?: unknown;
  index?: number;
}

const defaultConfig = {
  baseUrl: 'http://localhost:8787',
  agentId: 'agent-1',
  agentApiKey: 'aak_test',
};

// apply_document_edits fetches the current snapshot, looks up document metadata,
// then forwards the ops to the backend. Queue those three responses in order.
function mockApplyEditsFlow(currentSnapshot: Record<string, unknown>): void {
  mockFetch.mockResolvedValueOnce(createMockResponse(true, { snapshot: currentSnapshot }));
  mockFetch.mockResolvedValueOnce(createMockResponse(true, {}));
  mockFetch.mockResolvedValueOnce(createMockResponse(true, { success: true, version: 2 }));
}

function forwardedOperations(): ForwardedOp[] {
  const call = mockFetch.mock.calls.find(
    ([url]) => typeof url === 'string' && (url).endsWith('/edits'),
  );
  if (call === undefined) {
    throw new Error('applyEdits request was not forwarded to the backend');
  }
  const init = call[1] as { body: string };
  return (JSON.parse(init.body) as { operations: ForwardedOp[] }).operations;
}

function editsForwarded(): boolean {
  return mockFetch.mock.calls.some(
    ([url]) => typeof url === 'string' && (url).endsWith('/edits'),
  );
}

describe('apply_document_edits id re-minting', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('mints a fresh server-side id for a component added through an add op and discards the client id', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    mockApplyEditsFlow({ content: [] });

    const clientId = 'client-hero-id';
    await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [
        { type: 'add', path: '/content/0', content: { type: 'HeroBlock', props: { id: clientId, title: 'Welcome' } } },
      ],
    });

    const added = forwardedOperations()[0].content as Component;
    expect(added.props.id).toMatch(MINTED_ID_SUFFIX);
    expect(added.props.id.startsWith('HeroBlock-')).toBe(true);
    expect(added.props.id).not.toBe(clientId);
    expect(added.type).toBe('HeroBlock');
    expect(added.props.title).toBe('Welcome');
  });

  it('mints fresh ids for every component nested in arrays and objects within an add op value', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    mockApplyEditsFlow({ content: [] });

    await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [
        {
          type: 'add',
          path: '/content/0',
          content: {
            type: 'Grid',
            props: {
              id: 'client-grid',
              columns: 2,
              items: [
                { type: 'Cell', props: { id: 'client-cell-1', body: 'A' } },
                { type: 'Cell', props: { id: 'client-cell-2', body: 'B' } },
              ],
            },
          },
        },
      ],
    });

    const grid = forwardedOperations()[0].content as {
      type: string;
      props: { id: string; columns: number; items: Component[] };
    };
    const cells = grid.props.items;

    expect(grid.props.id).toMatch(MINTED_ID_SUFFIX);
    expect(grid.props.id.startsWith('Grid-')).toBe(true);
    expect(grid.props.id).not.toBe('client-grid');
    expect(grid.props.columns).toBe(2);

    expect(cells[0].props.id).toMatch(MINTED_ID_SUFFIX);
    expect(cells[0].props.id.startsWith('Cell-')).toBe(true);
    expect(cells[0].props.id).not.toBe('client-cell-1');
    expect(cells[0].props.body).toBe('A');

    expect(cells[1].props.id).toMatch(MINTED_ID_SUFFIX);
    expect(cells[1].props.id.startsWith('Cell-')).toBe(true);
    expect(cells[1].props.id).not.toBe('client-cell-2');
    expect(cells[1].props.body).toBe('B');

    const minted = new Set([grid.props.id, cells[0].props.id, cells[1].props.id]);
    expect(minted.size).toBe(3);
  });

  it('re-mints the incoming id when a replace op targets a component position whose current id differs', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    mockApplyEditsFlow({
      content: [
        { type: 'TextBlock', props: { id: 'TextBlock-existing', body: 'x' } },
        { type: 'HeroBlock', props: { id: 'HeroBlock-current-slot', title: 'Old' } },
      ],
    });

    const foreignId = 'foreign-hero-id';
    await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [
        { type: 'replace', path: '/content/1', content: { type: 'HeroBlock', props: { id: foreignId, title: 'Replaced' } } },
      ],
    });

    const replaced = forwardedOperations()[0].content as Component;
    expect(replaced.props.id).toMatch(MINTED_ID_SUFFIX);
    expect(replaced.props.id.startsWith('HeroBlock-')).toBe(true);
    expect(replaced.props.id).not.toBe(foreignId);
    expect(replaced.props.title).toBe('Replaced');
  });

  it('preserves the incoming id when a replace op targets a component position whose current id matches', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    const slotId = 'HeroBlock-1111aaaa-2222-3333-4444-555566667777';
    mockApplyEditsFlow({
      content: [
        { type: 'TextBlock', props: { id: 'TextBlock-existing', body: 'x' } },
        { type: 'HeroBlock', props: { id: slotId, title: 'Old' } },
      ],
    });

    await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [
        { type: 'replace', path: '/content/1', content: { type: 'HeroBlock', props: { id: slotId, title: 'New' } } },
      ],
    });

    const replaced = forwardedOperations()[0].content as Component;
    expect(replaced.props.id).toBe(slotId);
    expect(replaced.props.title).toBe('New');
  });

  it('preserves a zone item id when a replace op targets its position and the current id matches', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    const zoneKey = 'Layout-abc:main';
    const slotId = 'HeroBlock-9999bbbb-8888-7777-6666-555544443333';
    mockApplyEditsFlow({
      content: [{ type: 'Layout', props: { id: 'Layout-abc' } }],
      zones: {
        [zoneKey]: [{ type: 'HeroBlock', props: { id: slotId, title: 'Old' } }],
      },
    });

    await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [
        { type: 'replace', path: `/zones/${zoneKey}/0`, content: { type: 'HeroBlock', props: { id: slotId, title: 'New' } } },
      ],
    });

    const replaced = forwardedOperations()[0].content as Component;
    expect(replaced.props.id).toBe(slotId);
    expect(replaced.props.title).toBe('New');
  });

  it('leaves a replace at a deeper prop path untouched', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    mockApplyEditsFlow({
      content: [{ type: 'HeroBlock', props: { id: 'HeroBlock-current-slot', title: 'Old' } }],
    });

    await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [
        { type: 'replace', path: '/content/0/props/title', content: 'New Title' },
      ],
    });

    const op = forwardedOperations()[0];
    expect(op.type).toBe('replace');
    expect(op.path).toBe('content.0.props.title');
    expect(op.content).toBe('New Title');
  });

  it('leaves a remove op untouched', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    mockApplyEditsFlow({
      content: [
        { type: 'HeroBlock', props: { id: 'HeroBlock-a', title: 'A' } },
        { type: 'TextBlock', props: { id: 'TextBlock-b', body: 'B' } },
      ],
    });

    await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [
        { type: 'remove', path: '/content/1' },
      ],
    });

    const op = forwardedOperations()[0];
    expect(op).toEqual({ type: 'remove', path: 'content.1' });
  });

  it('rejects the request when a whole-component replace cannot read the current snapshot', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    // getDocument fails; lookupDocumentByPath still resolves. No occupant can be read.
    mockFetch.mockRejectedValueOnce(new Error('snapshot fetch failed'));
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {}));

    const result = await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [
        { type: 'replace', path: '/content/0', content: { type: 'HeroBlock', props: { id: 'HeroBlock-x', title: 'New' } } },
      ],
    });

    expect(result.isError).toBe(true);
    expect(editsForwarded()).toBe(false);
  });

  it('applies an add-only request even when the current snapshot cannot be read', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    mockFetch.mockRejectedValueOnce(new Error('snapshot fetch failed'));
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {}));
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { success: true, version: 2 }));

    await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [
        { type: 'add', path: '/content/0', content: { type: 'HeroBlock', props: { id: 'client-id', title: 'Hi' } } },
      ],
    });

    const added = forwardedOperations()[0].content as Component;
    expect(added.props.id).toMatch(MINTED_ID_SUFFIX);
    expect(added.props.id).not.toBe('client-id');
  });

  it('rejects the request when an earlier op shifts the list a later whole-component replace targets', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    mockApplyEditsFlow({
      content: [
        { type: 'TextBlock', props: { id: 'TextBlock-0', body: 'x' } },
        { type: 'HeroBlock', props: { id: 'HeroBlock-slot', title: 'Old' } },
      ],
    });

    const result = await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [
        { type: 'add', path: '/content/0', content: { type: 'Banner', props: { id: 'client-banner' } } },
        { type: 'replace', path: '/content/1', content: { type: 'HeroBlock', props: { id: 'HeroBlock-slot', title: 'New' } } },
      ],
    });

    expect(result.isError).toBe(true);
    expect(editsForwarded()).toBe(false);
  });

  it('preserves ids for several in-place replaces when no op shifts the list', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    mockApplyEditsFlow({
      content: [
        { type: 'ABlock', props: { id: 'ABlock-slot', v: 0 } },
        { type: 'BBlock', props: { id: 'BBlock-slot', v: 0 } },
        { type: 'CBlock', props: { id: 'CBlock-slot', v: 0 } },
      ],
    });

    await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [
        { type: 'replace', path: '/content/0', content: { type: 'ABlock', props: { id: 'ABlock-slot', v: 1 } } },
        { type: 'replace', path: '/content/2', content: { type: 'CBlock', props: { id: 'CBlock-slot', v: 1 } } },
      ],
    });

    const ops = forwardedOperations();
    expect((ops[0].content as Component).props.id).toBe('ABlock-slot');
    expect((ops[1].content as Component).props.id).toBe('CBlock-slot');
  });

  it('preserves nested component ids when an in-place replace matches the current occupant', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    const gridId = 'Grid-1111aaaa-2222-3333-4444-555566667777';
    const cellId = 'Cell-9999bbbb-8888-7777-6666-555544443333';
    mockApplyEditsFlow({
      content: [
        { type: 'Grid', props: { id: gridId, items: [{ type: 'Cell', props: { id: cellId, body: 'A' } }] } },
      ],
    });

    await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [
        {
          type: 'replace',
          path: '/content/0',
          content: { type: 'Grid', props: { id: gridId, items: [{ type: 'Cell', props: { id: cellId, body: 'B' } }] } },
        },
      ],
    });

    const grid = forwardedOperations()[0].content as {
      props: { id: string; items: Component[] };
    };
    expect(grid.props.id).toBe(gridId);
    expect(grid.props.items[0].props.id).toBe(cellId);
    expect(grid.props.items[0].props.body).toBe('B');
  });

  it('re-mints only the foreign elements of a whole-array replace, keeping ids already in the array', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const handlers = createToolHandlers(new McpApiClient(defaultConfig));

    const keptId = 'TextBlock-1111aaaa-2222-3333-4444-555566667777';
    mockApplyEditsFlow({
      content: [
        { type: 'TextBlock', props: { id: keptId, body: 'kept' } },
        { type: 'TextBlock', props: { id: 'TextBlock-gone', body: 'gone' } },
      ],
    });

    await handlers.apply_document_edits({
      site_id: 's1',
      branch_id: 'b1',
      document_path: '/home',
      edit_session_id: 'sess-1',
      operations: [
        {
          type: 'replace',
          path: '/content',
          content: [
            { type: 'TextBlock', props: { id: keptId, body: 'kept' } },
            { type: 'TextBlock', props: { id: 'foreign-injected', body: 'new' } },
          ],
        },
      ],
    });

    const arr = forwardedOperations()[0].content as Component[];
    expect(arr[0].props.id).toBe(keptId);
    expect(arr[1].props.id).toMatch(MINTED_ID_SUFFIX);
    expect(arr[1].props.id).not.toBe('foreign-injected');
    expect(arr[1].props.id.startsWith('TextBlock-')).toBe(true);
  });
});
