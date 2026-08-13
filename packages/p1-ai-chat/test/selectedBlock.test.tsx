import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, fireEvent } from '@testing-library/react';
import type { ChatContext } from '../src/types.js';
import { MockWebSocket, baseContext } from './testSupport.js';

const dispatch = vi.fn();

// The panel reads Puck's state directly: it renders inside the Puck tree.
let selectedItem: { type: string; props: Record<string, unknown> } | null = null;
let itemSelector: { zone?: string; index?: number } | null = null;
const config = { components: { HeadingBlock: { label: 'Heading' } } };

vi.mock('@puckeditor/core', () => ({
  useGetPuck: () => () => ({ dispatch }),
  createUsePuck: () => (selector: (state: unknown) => unknown) =>
    selector({ selectedItem, appState: { ui: { itemSelector } }, config }),
}));
vi.mock('@pantheon-systems/puck-css', () => ({
  humanizeComponentName: (name: string) => name.replace(/Block$/, ''),
  useP1Puck: () => ({
    userId: 'u1',
    siteId: 'site1',
    branchId: 'main',
    currentDocument: { id: 'doc1', path: '/current' },
    documents: [{ id: 'doc1', path: '/current', archived: false }],
  }),
  useP1Auth: () => ({ getToken: async () => baseContext.token, isAuthenticated: true }),
  aiPanelStore: { close: vi.fn(), open: vi.fn(), toggle: vi.fn(), isOpen: () => true, subscribe: () => () => {} },
}));

const { ChatPanel } = await import('../src/ChatPanel.js');

let scopeCounter = 0;

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  selectedItem = null;
  itemSelector = null;
});
afterEach(() => { vi.unstubAllGlobals(); });

/** Mount the panel, send one turn, and return the context that turn carried. */
async function contextOfATurn(): Promise<ChatContext> {
  const agentId = `selected-block-${++scopeCounter}`;
  render(<ChatPanel options={{ agentUrl: 'http://agent.test', getAgentId: () => agentId }} />);
  await act(async () => { MockWebSocket.instances[0].open(); });
  const ws = MockWebSocket.instances[0];
  await act(async () => { ws.emit({ type: 'history', history: [] }); });

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'make this shorter' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });

  const frame = ws.sent
    .map(s => JSON.parse(s) as { type: string; context?: ChatContext })
    .find(f => f.type === 'chat');
  return frame?.context as ChatContext;
}

describe('the selected block a turn carries', () => {
  it('names the block as the editor labels it, with what it says', async () => {
    selectedItem = { type: 'HeadingBlock', props: { id: '01JHEADING', title: 'Simple pricing' } };
    itemSelector = { zone: 'root:default-zone', index: 2 };

    expect((await contextOfATurn()).selectedBlock).toEqual({
      id: '01JHEADING',
      type: 'HeadingBlock',
      path: 'content.2',
      label: 'Heading',
      preview: 'Simple pricing',
    });
  });

  it('falls back to a humanized type when the config gives no label', async () => {
    selectedItem = { type: 'QuoteBlock', props: { id: '01JQUOTE' } };
    itemSelector = { zone: 'root:default-zone', index: 1 };

    expect((await contextOfATurn()).selectedBlock?.label).toBe('Quote');
  });

  it('reads the text out of rich text, without its markup', async () => {
    selectedItem = { type: 'HeadingBlock', props: { id: '01J', text: '<h2>Simple <em>pricing</em></h2>' } };
    itemSelector = { zone: 'root:default-zone', index: 0 };

    expect((await contextOfATurn()).selectedBlock?.preview).toBe('Simple pricing');
  });

  it('shortens a long run of text', async () => {
    selectedItem = { type: 'HeadingBlock', props: { id: '01J', title: 'x'.repeat(200) } };
    itemSelector = { zone: 'root:default-zone', index: 0 };

    const preview = (await contextOfATurn()).selectedBlock?.preview ?? '';
    expect(preview).toHaveLength(60);
    expect(preview.endsWith('…')).toBe(true);
  });

  it.each([
    ['newline-delimited text', { items: 'First item\nSecond item\nThird item' }],
    ['an array of strings', { items: ['First item', 'Second item', 'Third item'] }],
    ['an array of objects', { items: [{ label: 'First item' }, { label: 'Second item' }, { label: 'Third item' }] }],
  ])('describes a list held as %s by its first entry and a count', async (_case, props) => {
    selectedItem = { type: 'ListBlock', props: { id: '01JLIST', ...props } };
    itemSelector = { zone: 'root:default-zone', index: 5 };

    const selected = (await contextOfATurn()).selectedBlock;
    expect(selected?.preview).toBe('First item');
    expect(selected?.itemCount).toBe(3);
  });

  // Wrapped prose is not a list of items, however many lines its markup spans.
  it('does not count the lines of a block that says one thing', async () => {
    selectedItem = {
      type: 'ParagraphBlock',
      props: { id: '01JPARA', text: '<p>Start building free,</p>\n<p>then unlock Pro.</p>' },
    };
    itemSelector = { zone: 'root:default-zone', index: 3 };

    const selected = (await contextOfATurn()).selectedBlock;
    expect(selected?.itemCount).toBeUndefined();
    expect(selected?.preview).toBe('Start building free, then unlock Pro.');
  });

  it('gives no count to a block that says one thing', async () => {
    selectedItem = { type: 'HeadingBlock', props: { id: '01J', title: 'Simple pricing' } };
    itemSelector = { zone: 'root:default-zone', index: 2 };

    expect((await contextOfATurn()).selectedBlock?.itemCount).toBeUndefined();
  });

  it('carries no preview for a block with nothing to say', async () => {
    selectedItem = { type: 'DividerBlock', props: { id: '01JDIVIDER' } };
    itemSelector = { zone: 'root:default-zone', index: 4 };

    expect((await contextOfATurn()).selectedBlock?.preview).toBeUndefined();
  });

  it('addresses a block inside a nested zone by that zone', async () => {
    selectedItem = { type: 'ButtonBlock', props: { id: '01JBUTTON' } };
    itemSelector = { zone: '01JGRID:inner', index: 0 };

    expect((await contextOfATurn()).selectedBlock?.path).toBe('zones.01JGRID:inner.0');
  });

  it('is absent when the user has selected nothing', async () => {
    expect('selectedBlock' in (await contextOfATurn())).toBe(false);
  });

  it.each([
    ['no zone', { index: 1 }],
    ['no index', { zone: 'root:default-zone' }],
  ])('is absent when the selector has %s', async (_case, selector) => {
    selectedItem = { type: 'HeadingBlock', props: { id: '01JHEADING' } };
    itemSelector = selector;

    expect('selectedBlock' in (await contextOfATurn())).toBe(false);
  });

  it('is absent for an item Puck has not given an id', async () => {
    selectedItem = { type: 'HeadingBlock', props: {} };
    itemSelector = { zone: 'root:default-zone', index: 0 };

    expect('selectedBlock' in (await contextOfATurn())).toBe(false);
  });
});
