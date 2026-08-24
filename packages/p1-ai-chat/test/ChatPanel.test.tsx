import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { DraftRequest, DraftRequestChannel } from '../src/types.js';
import { MockWebSocket, baseContext } from './testSupport.js';

const dispatch = vi.fn();

// The panel is a Puck plugin panel living inside the CSS editor, so both of those have to
// stand in. Mocked at the module boundary rather than threaded through props, because the
// panel is constructed by Puck and reads them from context.
let currentDocument: { id: string; path: string } | null = { id: 'doc1', path: '/current' };

const branchDocuments = [
  { id: 'doc1', path: '/current', archived: false },
  { id: 'doc2', path: '/pricing', archived: false },
  { id: 'doc3', path: '/old', archived: true },
  { id: 'doc4', path: '_registry/components/Hero', archived: false },
];

vi.mock('@pantheon-systems/puck-css', () => ({
  useP1Puck: () => ({
    userId: 'u1',
    siteId: 'site1',
    branchId: 'main',
    currentDocument,
    documents: branchDocuments,
  }),
  useP1Auth: () => ({ getToken: async () => baseContext.token, isAuthenticated: true }),
  aiPanelStore: { close: vi.fn(), open: vi.fn(), toggle: vi.fn(), isOpen: () => true, subscribe: () => () => {} },
}));
vi.mock('@puckeditor/core', () => ({
  useGetPuck: () => () => ({ dispatch }),
  createUsePuck: () => (selector: (state: unknown) => unknown) =>
    selector({ selectedItem: null, appState: { ui: { itemSelector: null } } }),
}));

const { ChatPanel } = await import('../src/components/panel/ChatPanel.js');

let scopeCounter = 0;

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  dispatch.mockClear();
  currentDocument = { id: 'doc1', path: '/current' };
});
afterEach(() => { vi.unstubAllGlobals(); });

/** Render the panel on its own conversation scope and open its socket. */
async function renderPanel() {
  const agentId = `panel-scope-${++scopeCounter}`;
  const panel = (): React.ReactElement =>
    <ChatPanel options={{ agentUrl: 'http://agent.test', getAgentId: () => agentId }} />;
  const view = render(panel());
  await act(async () => { MockWebSocket.instances[0].open(); });
  const ws = (): MockWebSocket => MockWebSocket.instances[MockWebSocket.instances.length - 1];
  await act(async () => { ws().emit({ type: 'history', history: [] }); });
  return {
    ...view,
    ws,
    /** Tear the panel down and mount it again on the same conversation. */
    remount: async (): Promise<void> => {
      view.unmount();
      render(panel());
      await act(async () => { await Promise.resolve(); });
    },
    /** Open another page in the editor, as navigating within the same session does. */
    navigate: async (doc: { id: string; path: string } | null): Promise<void> => {
      currentDocument = doc;
      // A fresh element: React bails out of a re-render handed the identical one.
      await act(async () => { view.rerender(panel()); });
    },
  };
}

const composer = (): HTMLTextAreaElement => screen.getByRole('textbox') as HTMLTextAreaElement;

/** The scope row starts collapsed, so anything about the pages themselves has to open it. */
async function showScope(): Promise<void> {
  const summary = screen.queryByText(/Reads the whole site/);
  if (summary) await act(async () => { fireEvent.click(summary); });
}

/** Minimal stand-in for the app-owned intent bus that seeds the panel. */
function makeDraftChannel(): DraftRequestChannel {
  let latest: DraftRequest | null = null;
  const listeners = new Set<(request: DraftRequest) => void>();
  return {
    publish: intent => {
      latest = intent;
      for (const l of listeners) l(intent);
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLatest: () => latest,
    clearLatest: () => { latest = null; },
  };
}

async function send(text: string, ws: () => MockWebSocket) {
  fireEvent.change(composer(), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await act(async () => { ws().emit({ type: 'token', content: 'Working.' }); });
}

describe('ChatPanel', () => {
  it('names the transcript with a role that exposes the label', async () => {
    await renderPanel();

    // An aria-label on a role-less element is not required to be exposed, so the
    // focusable transcript would otherwise be an unnamed tab stop.
    const transcript = screen.getByRole('region', { name: 'Conversation' });
    expect(transcript.getAttribute('tabindex')).toBe('0');
  });

  it('waits for history rather than flashing the empty-state prompt', async () => {
    const agentId = `panel-scope-${++scopeCounter}`;
    render(<ChatPanel options={{ agentUrl: 'http://agent.test', getAgentId: () => agentId }} />);
    await act(async () => { MockWebSocket.instances[0].open(); });

    expect(screen.getByText('Loading conversation…')).toBeTruthy();

    await act(async () => {
      MockWebSocket.instances[0].emit({ type: 'history', history: [] });
    });
    expect(screen.queryByText('Loading conversation…')).toBeNull();
    expect(screen.getByText(/I can generate or restructure the page/)).toBeTruthy();
  });

  // Focusing unconditionally on every isLoading transition snatched the caret out of the
  // canvas or a sidebar field the moment the agent finished.
  it('does not take focus on mount', async () => {
    await renderPanel();

    expect(document.activeElement).not.toBe(composer());
  });

  it('returns focus to the composer after a turn sent from it', async () => {
    const { ws } = await renderPanel();
    await send('build a pricing page', ws);

    // Focus moved elsewhere while the agent worked.
    const transcript = screen.getByRole('region', { name: 'Conversation' });
    act(() => { transcript.focus(); });
    expect(document.activeElement).toBe(transcript);

    await act(async () => { ws().emit({ type: 'done' }); });
    expect(document.activeElement).toBe(composer());
  });

  // A seeded turn (Create Page → "Generate with AI") is not the user typing here, so its
  // completion must leave the caret wherever they actually put it.
  it('leaves focus alone when a seeded turn finishes', async () => {
    const agentId = `panel-scope-${++scopeCounter}`;
    const bus = makeDraftChannel();
    render(
      <ChatPanel options={{ agentUrl: 'http://agent.test', getAgentId: () => agentId, draftRequests: bus }} />,
    );
    await act(async () => { MockWebSocket.instances[0].open(); });
    const ws = MockWebSocket.instances[0];
    await act(async () => { ws.emit({ type: 'history', history: [] }); });

    const transcript = screen.getByRole('region', { name: 'Conversation' });
    act(() => { transcript.focus(); });

    await act(async () => {
      bus.publish({ kind: 'fill-page', brief: 'build a pricing page', documentPath: '/current' });
    });
    // Revealing the panel is the publisher's job now; this only checks the seed sent.
    expect(ws.frames().filter(f => f.type === 'chat')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();

    await act(async () => { ws.emit({ type: 'done' }); });

    expect(document.activeElement).toBe(transcript);
  });

  // The page does not exist, so it cannot be the turn's target: it travels as the page to
  // create, leaving the turn pointed at whatever the editor happens to have open.
  it('sends a page-to-create request as a page to create, not as a target document', async () => {
    const agentId = `panel-scope-${++scopeCounter}`;
    const bus = makeDraftChannel();
    render(
      <ChatPanel options={{ agentUrl: 'http://agent.test', getAgentId: () => agentId, draftRequests: bus }} />,
    );
    await act(async () => { MockWebSocket.instances[0].open(); });
    const ws = MockWebSocket.instances[0];
    await act(async () => { ws.emit({ type: 'history', history: [] }); });

    await act(async () => {
      bus.publish({
        kind: 'create-page',
        brief: 'a blog post about caching',
        page: { title: 'Caching', path: 'blog/caching' },
      });
    });

    const chat = ws.sent
      .map(s => JSON.parse(s) as { type: string; message?: string; context?: Record<string, unknown> })
      .find(f => f.type === 'chat');
    expect(chat?.message).toBe('a blog post about caching');
    expect(chat?.context?.pendingPage).toEqual({ title: 'Caching', path: 'blog/caching' });
    expect(chat?.context?.documentPath).toBe('/current');
  });

  // The turn arrives without the user having touched the composer, so the transcript has to
  // account for it — and the dialog collected a title and path shown nowhere else.
  it('attributes a seeded brief to the dialog it came from', async () => {
    const agentId = `panel-scope-${++scopeCounter}`;
    const bus = makeDraftChannel();
    render(
      <ChatPanel options={{ agentUrl: 'http://agent.test', getAgentId: () => agentId, draftRequests: bus }} />,
    );
    await act(async () => { MockWebSocket.instances[0].open(); });
    await act(async () => { MockWebSocket.instances[0].emit({ type: 'history', history: [] }); });

    await act(async () => {
      bus.publish({
        kind: 'create-page',
        brief: 'a blog post about caching',
        page: { title: 'Caching', path: 'blog/caching' },
      });
    });

    expect(screen.getByText('New page').parentElement?.textContent).toBe('New page · Caching');
    expect(screen.getByText('/blog/caching')).toBeTruthy();
  });

  it('leaves a turn typed into the composer unattributed', async () => {
    const { ws } = await renderPanel();
    await send('a blog post about caching', ws);

    expect(screen.queryByText('New page')).toBeNull();
  });

  describe('while a turn is streaming', () => {
    it('offers Stop in place of Send', async () => {
      const { ws } = await renderPanel();
      await send('go', ws);

      expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop' })); });

      expect(ws().frames().some(f => f.type === 'cancel')).toBe(true);
      expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
      // Scoped to the transcript: the status region announces "Stopped" too, so an
      // unscoped query matches both.
      const transcript = screen.getByRole('region', { name: 'Conversation' });
      expect(within(transcript).getByText('Stopped')).toBeTruthy();
    });

    // A reply takes tens of seconds; locking the box made composing the follow-up wait.
    it('still lets the user compose', async () => {
      const { ws } = await renderPanel();
      await send('go', ws);

      expect(composer().disabled).toBe(false);
      fireEvent.change(composer(), { target: { value: 'next request' } });
      expect(composer().value).toBe('next request');
    });

    it('does not send on Enter, keeping the draft intact', async () => {
      const { ws } = await renderPanel();
      await send('go', ws);

      fireEvent.change(composer(), { target: { value: 'next request' } });
      await act(async () => { fireEvent.keyDown(composer(), { key: 'Enter' }); });

      const chats = ws().frames().filter(f => f.type === 'chat');
      expect(chats).toHaveLength(1);
      expect(composer().value).toBe('next request');
    });
  });

  describe('status announcements', () => {
    const status = (): string => screen.getByRole('status').textContent ?? '';

    it('says nothing on open, even when history ends in a reply', async () => {
      const agentId = `panel-scope-${++scopeCounter}`;
      render(<ChatPanel options={{ agentUrl: 'http://agent.test', getAgentId: () => agentId }} />);
      await act(async () => { MockWebSocket.instances[0].open(); });
      await act(async () => {
        MockWebSocket.instances[0].emit({
          type: 'history',
          history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Done.' }],
        });
      });

      expect(status()).toBe('');
    });

    it('names the step in flight, then reports the turn finished', async () => {
      const { ws } = await renderPanel();
      await send('go', ws);
      expect(status()).toBe('Working on your request');

      await act(async () => {
        ws().emit({ type: 'tool_start', toolCallId: 'c1', toolName: 'apply_document_edits' });
      });
      expect(status()).toBe('Applying changes…');

      // An empty region announces nothing, so completion has to say something.
      await act(async () => { ws().emit({ type: 'done' }); });
      expect(status()).toBe('Reply ready');
    });

    it('reports a failure and a stop distinctly', async () => {
      const { ws } = await renderPanel();
      await send('go', ws);
      await act(async () => { ws().emit({ type: 'error', error: 'Rate limit reached' }); });
      expect(status()).toBe('Something went wrong');

      await send('again', ws);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop' })); });
      expect(status()).toBe('Stopped');
    });
  });

  describe('clear', () => {
    async function clearAfterOneExchange() {
      const { ws } = await renderPanel();
      await send('go', ws);
      await act(async () => { ws().emit({ type: 'done' }); });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' })); });
      return { ws };
    }

    it('wipes the conversation on the first click, with no confirmation step', async () => {
      const { ws } = await clearAfterOneExchange();

      expect(screen.queryByText('go')).toBeNull();
      expect(ws().frames().some(f => f.type === 'clear')).toBe(true);
      // The empty-state prompt returns rather than a "loading history" placeholder.
      expect(screen.getByText(/I can generate or restructure the page/)).toBeTruthy();
    });

    it('hides the action once there is nothing left to clear', async () => {
      await clearAfterOneExchange();

      expect(screen.queryByRole('button', { name: 'Clear conversation' })).toBeNull();
    });

    // The button unmounts with the last message it was clearing, so without this focus
    // falls to the document body.
    it('hands focus to the composer, since the button it was on is gone', async () => {
      await clearAfterOneExchange();

      expect(document.activeElement).toBe(composer());
    });
  });

  it('pins the transcript to the newest message once the panel gains a size', async () => {
    const observers: (() => void)[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { observers.push(callback); }
      observe() {}
      disconnect() {}
    });

    await renderPanel();
    const transcript = screen.getByRole('region', { name: 'Conversation' });
    // happy-dom has no layout engine, so stand in for content taller than the box.
    Object.defineProperty(transcript, 'scrollHeight', { value: 500, configurable: true });
    expect(transcript.scrollTop).toBe(0);

    for (const fire of observers) fire();

    expect(transcript.scrollTop).toBe(500);
  });

  it('reserves as much room in the composer as the buttons overlaying it need', async () => {
    const observed: { el: Element; fire: () => void }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      callback: () => void;
      constructor(callback: () => void) { this.callback = callback; }
      observe(el: Element) { observed.push({ el, fire: this.callback }); }
      disconnect() {}
    });

    await renderPanel();
    const actions = screen.getByTestId('composer-actions');
    // happy-dom has no layout engine, so stand in for the width the row would report.
    Object.defineProperty(actions, 'offsetWidth', { value: 92, configurable: true });

    const entry = observed.find(o => o.el === actions);
    expect(entry).toBeDefined();
    act(() => { entry?.fire(); });

    expect(composer().style.paddingRight).toBe('108px');
  });

  it('refuses to send while no page is open', async () => {
    currentDocument = null;
    // No `getAgentId`, so the conversation id is derived — from the user and site only.
    render(<ChatPanel options={{ agentUrl: 'http://agent.test' }} />);
    await act(async () => { MockWebSocket.instances[0].open(); });
    const ws = MockWebSocket.instances[0];
    await act(async () => { ws.emit({ type: 'history', history: [] }); });

    fireEvent.change(composer(), { target: { value: 'build a pricing page' } });
    const sendButton = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;

    expect(sendButton.disabled).toBe(true);
    expect(screen.getByText('Open a page to make changes')).toBeTruthy();

    await act(async () => { fireEvent.click(sendButton); });
    expect(ws.frames().some(f => f.type === 'chat')).toBe(false);
  });

  // The agent asks which template to start from and waits for an answer. Requiring an open page
  // to type that answer left the conversation stuck on its own question.
  it('lets the user answer while the page they asked for still does not exist', async () => {
    currentDocument = null;
    const agentId = `panel-scope-${++scopeCounter}`;
    const bus = makeDraftChannel();
    render(
      <ChatPanel options={{ agentUrl: 'http://agent.test', getAgentId: () => agentId, draftRequests: bus }} />,
    );
    await act(async () => { MockWebSocket.instances[0].open(); });
    const ws = MockWebSocket.instances[0];
    await act(async () => { ws.emit({ type: 'history', history: [] }); });

    await act(async () => {
      bus.publish({
        kind: 'create-page',
        brief: 'a blog post',
        page: { title: 'Caching', path: 'blog/caching' },
      });
    });
    await act(async () => { ws.emit({ type: 'done' }); });

    fireEvent.change(composer(), { target: { value: 'Ok' } });
    const sendButton = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(false);
    expect(screen.queryByText('Open a page to make changes')).toBeNull();

    await act(async () => { fireEvent.click(sendButton); });

    const chats = ws.sent
      .map(s => JSON.parse(s) as { type: string; message?: string })
      .filter(f => f.type === 'chat');
    expect(chats.map(c => c.message)).toEqual(['a blog post', 'Ok']);
  });

  it('locks the composer again once that page exists but none is open', async () => {
    currentDocument = null;
    const agentId = `panel-scope-${++scopeCounter}`;
    const bus = makeDraftChannel();
    render(
      <ChatPanel options={{ agentUrl: 'http://agent.test', getAgentId: () => agentId, draftRequests: bus }} />,
    );
    await act(async () => { MockWebSocket.instances[0].open(); });
    const ws = MockWebSocket.instances[0];
    await act(async () => { ws.emit({ type: 'history', history: [] }); });

    await act(async () => {
      bus.publish({
        kind: 'create-page',
        brief: 'a blog post',
        page: { title: 'Caching', path: 'blog/caching' },
      });
    });
    await act(async () => {
      ws.emit({
        type: 'tool_end',
        toolName: 'create_page',
        toolResult: { documentId: 'd1', documentPath: 'blog/caching' },
      });
      ws.emit({ type: 'done' });
    });

    fireEvent.change(composer(), { target: { value: 'now add a summary' } });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  describe('composer footer', () => {
    // Per the design, and it keeps the control off the hint's row, which wrapped at this width.
    it('keeps the action off the hint row', async () => {
      await renderPanel();

      const hint = screen.getByText('Enter to send · Shift+Enter for newline');
      // The control moved into the input, so the hint has its row to itself.
      expect(hint.parentElement?.querySelector('button')).toBeNull();
      expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
      expect(screen.getAllByText(/Enter to send/)).toHaveLength(1);
    });

    it('replaces the hint with the connection state while reconnecting', async () => {
      const { ws } = await renderPanel();
      await act(async () => { ws().close(); });

      expect(screen.getByText('Reconnecting…')).toBeTruthy();
      expect(screen.queryByText(/Enter to send/)).toBeNull();
    });
  });

  describe('scope row', () => {
    it('states that the agent reads the whole site', async () => {
      await renderPanel();
      await showScope();

      expect(screen.getByText('entire site')).toBeTruthy();
    });

    it('starts out able to edit the page that was open', async () => {
      await renderPanel();
      await showScope();

      expect(screen.getByText('current')).toBeTruthy();
    });

    it('swaps in the page the user navigates to', async () => {
      const { navigate } = await renderPanel();
      await showScope();

      await navigate({ id: 'doc2', path: '/pricing' });

      expect(screen.getByText('pricing')).toBeTruthy();
      // Browsing past a page is not a reason to keep it: only the last visit's page is here.
      expect(screen.queryByText('current')).toBeNull();
    });

    it('keeps a page the user added themselves when they navigate away', async () => {
      const { navigate } = await renderPanel();
      await showScope();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Add page/ }));
      });
      await act(async () => {
        fireEvent.click(screen.getByText('pricing'));
      });

      await navigate({ id: 'doc9', path: '/blog' });

      expect(screen.getByText('pricing')).toBeTruthy();
      expect(screen.getByText('blog')).toBeTruthy();
      expect(screen.queryByText('current')).toBeNull();
    });

    // The set is not what the effect keys on, so the chip for the page you are on can be removed.
    it('leaves a dismissed page out while you stay on it', async () => {
      const { navigate } = await renderPanel();
      await showScope();
      await navigate({ id: 'doc2', path: '/pricing' });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Stop editing: pricing' }));
      });

      expect(screen.queryByText('pricing')).toBeNull();
    });

    it('adopts it again on the next visit', async () => {
      const { navigate } = await renderPanel();
      await showScope();
      await navigate({ id: 'doc2', path: '/pricing' });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Stop editing: pricing' }));
      });

      await navigate({ id: 'doc1', path: '/current' });
      await navigate({ id: 'doc2', path: '/pricing' });

      expect(screen.getByText('pricing')).toBeTruthy();
    });

    // Without re-seeding, the header claimed nothing was editable while the Worker still allowed it.
    it('adopts the open page again after the conversation is cleared', async () => {
      const { ws } = await renderPanel();
      await showScope();
      await send('change the heading', ws);
      await act(async () => { ws().emit({ type: 'done' }); });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }));
      });

      expect(screen.getByText('current')).toBeTruthy();
      expect(screen.queryByText(/not change existing pages/)).toBeNull();
    });

    it('takes a page back when its chip is dismissed', async () => {
      await renderPanel();
      await showScope();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Stop editing/ }));
      });

      expect(screen.queryByText('current')).toBeNull();
      // Not "cannot change anything": creating a page is not gated by the write set.
      expect(screen.getByText(/not change existing pages/)).toBeTruthy();
    });

    it('starts collapsed, saying how many pages it is not listing', async () => {
      await renderPanel();

      expect(screen.getByText('Reads the whole site, edits 1 page')).toBeTruthy();
      expect(screen.queryByText('current')).toBeNull();
    });

    it('lists the pages once opened, and hides them again', async () => {
      await renderPanel();

      await showScope();
      expect(screen.getByText('current')).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Hide which pages/ }));
      });
      expect(screen.queryByText('current')).toBeNull();
    });

    it('counts the pages it is hiding', async () => {
      const { navigate } = await renderPanel();
      await showScope();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Add page/ }));
      });
      await act(async () => { fireEvent.click(screen.getByText('pricing')); });
      await navigate({ id: 'doc9', path: '/blog' });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Hide which pages/ }));
      });

      expect(screen.getByText('Reads the whole site, edits 2 pages')).toBeTruthy();
    });

    it('says so when it is hiding nothing', async () => {
      await renderPanel();
      await showScope();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Stop editing: current' }));
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Hide which pages/ }));
      });

      expect(screen.getByText('Reads the whole site, edits no existing pages')).toBeTruthy();
    });

    // Local state would collapse again here, and this is the flow the toggle is for.
    it('stays open across a remount and a navigation', async () => {
      const { navigate, remount } = await renderPanel();
      await showScope();

      await navigate({ id: 'doc2', path: '/pricing' });
      await remount();

      expect(screen.getByText('pricing')).toBeTruthy();
      expect(screen.queryByText(/Reads the whole site/)).toBeNull();
    });

    it('offers the site\'s other pages, and nothing archived or internal', async () => {
      await renderPanel();
      await showScope();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Add page/ }));
      });

      expect(screen.getByText('pricing')).toBeTruthy();
      expect(screen.queryByText('old')).toBeNull();
      expect(screen.queryByText(/_registry/)).toBeNull();
    });

    // jsdom lays nothing out, so this cannot catch the overlap itself — only stop the two
    // properties being dropped as decoration. See AddPageDropdown for what they do.
    it('keeps picker rows from being shrunk under their content', async () => {
      await renderPanel();
      await showScope();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Add page/ }));
      });

      const row = screen.getByText('pricing').closest('li') as HTMLLIElement;
      expect(row.style.flexShrink).toBe('0');
      expect(row.style.minWidth).toBe('15rem');
    });

    it('adds a page the user picks', async () => {
      await renderPanel();
      await showScope();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Add page/ }));
      });
      await act(async () => {
        fireEvent.click(screen.getByText('pricing'));
      });

      expect(screen.getAllByRole('button', { name: /Stop editing/ })).toHaveLength(2);
    });
  });
});
