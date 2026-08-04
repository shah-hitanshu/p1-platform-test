import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MockWebSocket, baseContext } from './testSupport.js';
import type { DraftRequest, DraftRequestChannel } from '../src/types.js';

const dispatch = vi.fn();

// The panel is a Puck plugin panel living inside the CSS editor, so both of those have to
// stand in. Mocked at the module boundary rather than threaded through props, because the
// panel is constructed by Puck and reads them from context.
let currentDocument: { id: string; path: string } | null = { id: 'doc1', path: '/current' };

vi.mock('@pantheon-systems/puck-css', () => ({
  useP1Puck: () => ({
    userId: 'u1',
    siteId: 'site1',
    branchId: 'main',
    currentDocument,
  }),
  useP1Auth: () => ({ getToken: async () => baseContext.token, isAuthenticated: true }),
}));
vi.mock('@puckeditor/core', () => ({ useGetPuck: () => () => ({ dispatch }) }));

const { ChatPanel } = await import('../src/ChatPanel.js');

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
  const view = render(<ChatPanel options={{ agentUrl: 'http://agent.test', getAgentId: () => agentId }} />);
  await act(async () => { MockWebSocket.instances[0].open(); });
  const ws = (): MockWebSocket => MockWebSocket.instances[MockWebSocket.instances.length - 1];
  await act(async () => { ws().emit({ type: 'history', history: [] }); });
  return { ...view, ws };
}

const composer = (): HTMLTextAreaElement => screen.getByRole('textbox') as HTMLTextAreaElement;

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
  await act(async () => { fireEvent.click(screen.getByText('Send')); });
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
    expect(screen.getByText(/Describe the page you want/)).toBeTruthy();
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
      bus.publish({ brief: 'build a pricing page', documentPath: '/current' });
    });
    // The seed really did start a turn, and opened the panel to show it.
    expect(ws.frames().filter(f => f.type === 'chat')).toHaveLength(1);
    expect(dispatch).toHaveBeenCalled();
    expect(screen.getByText('Stop')).toBeTruthy();

    await act(async () => { ws.emit({ type: 'done' }); });

    expect(document.activeElement).toBe(transcript);
  });

  describe('while a turn is streaming', () => {
    it('offers Stop in place of Send', async () => {
      const { ws } = await renderPanel();
      await send('go', ws);

      expect(screen.queryByText('Send')).toBeNull();
      await act(async () => { fireEvent.click(screen.getByText('Stop')); });

      expect(ws().frames().some(f => f.type === 'cancel')).toBe(true);
      expect(screen.getByText('Send')).toBeTruthy();
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
      await act(async () => { fireEvent.click(screen.getByText('Stop')); });
      expect(status()).toBe('Stopped');
    });
  });

  describe('clear', () => {
    async function clearAfterOneExchange() {
      const { ws } = await renderPanel();
      await send('go', ws);
      await act(async () => { ws().emit({ type: 'done' }); });
      await act(async () => { fireEvent.click(screen.getByText('Clear')); });
      return { ws };
    }

    it('wipes the conversation on the first click, with no confirmation step', async () => {
      const { ws } = await clearAfterOneExchange();

      expect(screen.queryByText('go')).toBeNull();
      expect(ws().frames().some(f => f.type === 'clear')).toBe(true);
      // The empty-state prompt returns rather than a "loading history" placeholder.
      expect(screen.getByText(/Describe the page you want/)).toBeTruthy();
    });

    it('hides the action once there is nothing left to clear', async () => {
      await clearAfterOneExchange();

      expect(screen.queryByText('Clear')).toBeNull();
    });

    // The button unmounts with the last message it was clearing, so without this focus
    // falls to the document body.
    it('hands focus to the composer, since the button it was on is gone', async () => {
      await clearAfterOneExchange();

      expect(document.activeElement).toBe(composer());
    });
  });

  it('pins the transcript to the newest message once the panel gains a size', async () => {
    const observers: Array<() => void> = [];
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

  it('refuses to send until the document has resolved', async () => {
    currentDocument = null;
    // No `getAgentId`, so the id comes from the document and falls back to `root`.
    render(<ChatPanel options={{ agentUrl: 'http://agent.test' }} />);
    await act(async () => { MockWebSocket.instances[0].open(); });
    const ws = MockWebSocket.instances[0];
    await act(async () => { ws.emit({ type: 'history', history: [] }); });

    fireEvent.change(composer(), { target: { value: 'build a pricing page' } });
    const send = screen.getByText('Send') as HTMLButtonElement;

    expect(send.disabled).toBe(true);
    expect(screen.getByText('Opening the page…')).toBeTruthy();

    await act(async () => { fireEvent.click(send); });
    expect(ws.frames().some(f => f.type === 'chat')).toBe(false);
  });

  describe('composer footer', () => {
    // The action had a row to itself directly above the hint, costing ~40px of a narrow
    // panel to seat one control.
    it('seats the hint and the action on one row', async () => {
      await renderPanel();

      const hint = screen.getByText('Enter to send · Shift+Enter for newline');
      // Siblings, not merely both somewhere in the composer — the old layout had the button
      // in a wrapper of its own, which shares only the outer container with the hint.
      expect(screen.getByText('Send').parentElement).toBe(hint.parentElement);
      expect(screen.getAllByText(/Enter to send/)).toHaveLength(1);
    });

    it('replaces the hint with the connection state while reconnecting, keeping one row', async () => {
      const { ws } = await renderPanel();
      await act(async () => { ws().close(); });

      const hint = screen.getByText('Reconnecting…');
      expect(screen.getByText('Send').parentElement).toBe(hint.parentElement);
      expect(screen.queryByText(/Enter to send/)).toBeNull();
    });
  });
});
