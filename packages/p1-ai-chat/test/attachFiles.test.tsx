import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, fireEvent, waitFor, createEvent } from '@testing-library/react';
import type { ChatContext, DraftRequest, DraftRequestChannel } from '../src/types.js';
import { AttachmentError, MAX_BRIEF_CHARS } from '../src/attachments.js';
import { MockWebSocket, baseContext } from './testSupport.js';

// Canvas decoding is not implemented in happy-dom, and it is not what these tests are
// about: the panel's own downscaler is covered in downscaleImage.test.ts.
const prepared = vi.fn(async (file: File) => `data:image/webp;base64,${btoa(file.name)}`);
vi.mock('../src/downscaleImage.js', () => ({ downscaleImage: (file: File) => prepared(file) }));

vi.mock('@puckeditor/core', () => ({
  useGetPuck: () => () => ({ dispatch: vi.fn() }),
  createUsePuck: () => (selector: (state: unknown) => unknown) =>
    selector({ selectedItem: null, appState: { ui: { itemSelector: null } }, config: { components: {} } }),
}));
vi.mock('@pantheon-systems/puck-css', () => ({
  humanizeComponentName: (name: string) => name,
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
  prepared.mockClear();
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeDraftChannel(): DraftRequestChannel {
  let latest: DraftRequest | null = null;
  const listeners = new Set<(request: DraftRequest) => void>();
  return {
    publish: request => { latest = request; for (const l of listeners) l(request); },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    getLatest: () => latest,
    clearLatest: () => { latest = null; },
  };
}

async function mountPanel(draftRequests?: DraftRequestChannel): Promise<MockWebSocket> {
  const agentId = `attachments-${++scopeCounter}`;
  render(
    <ChatPanel options={{
      agentUrl: 'http://agent.test',
      getAgentId: () => agentId,
      ...(draftRequests ? { draftRequests } : {}),
    }} />,
  );
  await act(async () => { MockWebSocket.instances[0].open(); });
  const ws = MockWebSocket.instances[0];
  await act(async () => { ws.emit({ type: 'history', history: [] }); });
  return ws;
}

async function dropFiles(...files: File[]): Promise<void> {
  await act(async () => {
    fireEvent.drop(screen.getByTestId('chat-composer'), {
      dataTransfer: { files, types: ['Files'] },
    });
  });
}

async function pasteFiles(...files: File[]): Promise<void> {
  await act(async () => {
    fireEvent.paste(screen.getByTestId('chat-composer'), {
      clipboardData: { files, types: files.length > 0 ? ['Files'] : ['text/plain'] },
    });
  });
}

async function sendTurn(text: string): Promise<void> {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
}

function chatContext(ws: MockWebSocket): ChatContext | undefined {
  return ws.sent
    .map(s => JSON.parse(s) as { type: string; context?: ChatContext })
    .find(f => f.type === 'chat')?.context;
}

const briefFile = (text: string, name = 'brief.md'): File =>
  new File([text], name, { type: 'text/markdown' });

describe('attaching a brief', () => {
  it('sends the file text with the turn, and names the file in the transcript', async () => {
    const ws = await mountPanel();

    await dropFiles(briefFile('# Pricing\n\nThree tiers.'));
    await waitFor(() => { expect(screen.getByText(/brief\.md/)).toBeTruthy(); });
    await sendTurn('build this');

    expect(chatContext(ws)?.attachments).toEqual([
      { kind: 'document', filename: 'brief.md', text: '# Pricing\n\nThree tiers.' },
    ]);
    // The brief's text goes to the model, not into the message the transcript shows.
    expect(screen.getByText('build this')).toBeTruthy();
  });

  it('sends an HTML brief as the text it says', async () => {
    const ws = await mountPanel();

    await dropFiles(new File(
      ['<h1>Pricing</h1><script>x()</script><p>Three tiers.</p>'],
      'page.html',
      { type: 'text/html' },
    ));
    await waitFor(() => { expect(screen.getByText(/page\.html/)).toBeTruthy(); });
    await sendTurn('use this');

    expect(chatContext(ws)?.attachments).toEqual([
      { kind: 'document', filename: 'page.html', text: 'Pricing\n\nThree tiers.' },
    ]);
  });

  it('empties the composer of files once they have gone with a turn', async () => {
    const ws = await mountPanel();

    await dropFiles(briefFile('a brief'));
    await waitFor(() => { expect(screen.getByRole('button', { name: /Remove/ })).toBeTruthy(); });
    await sendTurn('build this');
    await act(async () => { ws.emit({ type: 'done' }); });

    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });
});

describe('pasting a file', () => {
  it('takes a pasted brief the same way a dropped one is taken', async () => {
    const ws = await mountPanel();

    await pasteFiles(briefFile('# Pricing', 'pasted.md'));
    await waitFor(() => { expect(screen.getByText(/pasted\.md/)).toBeTruthy(); });
    await sendTurn('build this');

    expect(chatContext(ws)?.attachments).toEqual([
      { kind: 'document', filename: 'pasted.md', text: '# Pricing' },
    ]);
  });

  // The clipboard hands a screenshot over unnamed, and the invented name is what the card's
  // alt text has to carry.
  it('names a screenshot the clipboard handed over unnamed', async () => {
    const ws = await mountPanel();

    await pasteFiles(new File(['bytes'], '', { type: 'image/png' }));
    await waitFor(() => { expect(screen.getByAltText('pasted-image.png')).toBeTruthy(); });
    await sendTurn('what does this show?');

    expect(chatContext(ws)?.attachments).toEqual([
      { kind: 'image', filename: 'pasted-image.png', dataUrl: `data:image/webp;base64,${btoa('pasted-image.png')}` },
    ]);
  });

  it('leaves a paste carrying no file alone', async () => {
    await mountPanel();

    await pasteFiles();

    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });
});

describe('the files a sent turn shows', () => {
  it('shows a brief as a card, and opens what was sent', async () => {
    await mountPanel();

    await dropFiles(new File(['# Pricing\n\nThree tiers.'], 'brief.md', { type: 'text/markdown' }));
    await waitFor(() => { expect(screen.getByText(/brief\.md/)).toBeTruthy(); });
    await sendTurn('use this');

    const card = await screen.findByRole('button', { name: 'Open brief.md' });
    await act(async () => { fireEvent.click(card); });

    expect(screen.getByText(/Three tiers\./)).toBeTruthy();
  });

  it('closes the preview and leaves the conversation as it was', async () => {
    await mountPanel();

    await dropFiles(new File(['# Pricing'], 'brief.md', { type: 'text/markdown' }));
    await waitFor(() => { expect(screen.getByText(/brief\.md/)).toBeTruthy(); });
    await sendTurn('use this');
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Open brief.md' })); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close preview' })); });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('use this')).toBeTruthy();
  });

  it('shows an image as itself, and opens it full size', async () => {
    await mountPanel();

    await pasteFiles(new File(['bytes'], 'shot.png', { type: 'image/png' }));
    await waitFor(() => { expect(screen.getByAltText('shot.png')).toBeTruthy(); });
    await sendTurn('what is wrong here?');

    const card = await screen.findByRole('button', { name: 'Open shot.png' });
    await act(async () => { fireEvent.click(card); });

    // Two now: the card's own thumbnail, and the full-size copy in the modal.
    expect(screen.getAllByAltText('shot.png').length).toBeGreaterThan(1);
  });
});

describe('a file still on the composer', () => {
  it('opens from its card, before the turn is sent', async () => {
    await mountPanel();

    await dropFiles(new File(['# Pricing\n\nThree tiers.'], 'brief.md', { type: 'text/markdown' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Open brief.md' })).toBeTruthy(); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open brief.md' })); });

    expect(screen.getByText(/Three tiers\./)).toBeTruthy();
  });

  // StrictMode runs an effect mount -> cleanup -> mount, and a cleanup that closed the dialog
  // fired the native close event, which the panel read as the user dismissing it.
  it('stays open when effects are run twice', async () => {
    const agentId = `attachments-strict-${++scopeCounter}`;
    render(
      <React.StrictMode>
        <ChatPanel options={{ agentUrl: 'http://agent.test', getAgentId: () => agentId }} />
      </React.StrictMode>,
    );
    await act(async () => { MockWebSocket.instances[0].open(); });
    await act(async () => { MockWebSocket.instances[0].emit({ type: 'history', history: [] }); });

    await dropFiles(new File(['# Pricing\n\nThree tiers.'], 'brief.md', { type: 'text/markdown' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Open brief.md' })).toBeTruthy(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open brief.md' })); });

    expect(screen.getByText(/Three tiers\./)).toBeTruthy();
  });

  it('cannot be opened while it is still being read', async () => {
    await mountPanel();
    let release = (): void => {};
    prepared.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return 'data:image/webp;base64,AA==';
    });

    await pasteFiles(new File(['bytes'], 'slow.png', { type: 'image/png' }));

    const card = screen.getByRole('button', { name: 'Open slow.png' });
    expect(card.getAttribute('disabled')).not.toBeNull();
    await act(async () => { release(); });
  });
});

describe('a conversation reopened later', () => {
  it('still shows what a turn carried, with nothing to open', async () => {
    const agentId = `attachments-restore-${++scopeCounter}`;
    render(<ChatPanel options={{ agentUrl: 'http://agent.test', getAgentId: () => agentId }} />);
    await act(async () => { MockWebSocket.instances[0].open(); });
    await act(async () => {
      MockWebSocket.instances[0].emit({
        type: 'history',
        history: [
          { role: 'user', content: 'what is wrong here?', attachments: [{ kind: 'image', filename: 'shot.png' }] },
          { role: 'assistant', content: 'The header overlaps the nav.' },
        ],
      });
    });

    expect(screen.getByText(/shot\.png/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open shot.png' })).toBeNull();
  });

  // The turn is rebuilt from what the socket said. A `dataUrl` in it would be rendered as the
  // card's image, so the restored entry is built from the name and the kind alone.
  it('renders nothing a replayed turn claims beyond the name', async () => {
    const agentId = `attachments-restore-hostile-${++scopeCounter}`;
    render(<ChatPanel options={{ agentUrl: 'http://agent.test', getAgentId: () => agentId }} />);
    await act(async () => { MockWebSocket.instances[0].open(); });
    await act(async () => {
      MockWebSocket.instances[0].emit({
        type: 'history',
        history: [
          {
            role: 'user',
            content: 'look at this',
            attachments: [{
              kind: 'image',
              filename: 'shot.png',
              dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
              text: 'not from us either',
            }],
          },
        ],
      });
    });

    expect(screen.getByText(/shot\.png/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open shot.png' })).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('a brief too long to carry whole', () => {
  // The Worker receives the shortened text and cannot tell it was cut, so only the panel can say.
  it('says so, and still sends what fits', async () => {
    const ws = await mountPanel();

    await dropFiles(briefFile('x'.repeat(MAX_BRIEF_CHARS + 500), 'long.md'));
    await waitFor(() => expect(screen.getByText(/long\.md is long/)).toBeTruthy());
    await sendTurn('use this');

    const [attachment] = chatContext(ws)?.attachments ?? [];
    expect(attachment?.kind === 'document' && attachment.text.length).toBe(MAX_BRIEF_CHARS);
  });
});

describe('a turn that failed', () => {
  // The composer is emptied on send, so a resend has to come from what the turn kept.
  it('sends the files again when the turn is retried', async () => {
    const ws = await mountPanel();
    await dropFiles(briefFile('# Pricing\n\nThree tiers.'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open brief.md' })).toBeTruthy());
    await sendTurn('use this');

    await act(async () => { ws.emit({ type: 'error', error: 'Rate limit reached' }); });
    await act(async () => { fireEvent.click(screen.getByText('Try again')); });

    const chats = ws.sent
      .map(sent => JSON.parse(sent) as { type: string; context?: ChatContext })
      .filter(frame => frame.type === 'chat');
    expect(chats).toHaveLength(2);
    expect(chats[1].context?.attachments).toEqual([
      { kind: 'document', filename: 'brief.md', text: '# Pricing\n\nThree tiers.' },
    ]);
    // Replaced, not stacked: one user turn, still showing its file.
    expect(screen.getAllByRole('button', { name: 'Open brief.md' })).toHaveLength(1);
  });
});

describe('a send that carries no files of its own', () => {
  const chats = (ws: MockWebSocket): { context?: ChatContext }[] =>
    ws.sent.map(sent => JSON.parse(sent) as { type: string; context?: ChatContext })
      .filter(frame => frame.type === 'chat');

  // The panel's promise is that a message never quietly goes without the file attached to it.
  // A seeded turn is not that message, so it must not empty the composer on its way past.
  it('leaves a staged brief alone when the editor seeds a turn', async () => {
    const bus = makeDraftChannel();
    const ws = await mountPanel(bus);
    await dropFiles(briefFile('# Pricing\n\nThree tiers.'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open brief.md' })).toBeTruthy());

    await act(async () => {
      bus.publish({ kind: 'fill-page', brief: 'build a pricing page', documentPath: '/current' });
    });

    expect(chats(ws)).toHaveLength(1);
    expect(chats(ws)[0].context?.attachments).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Open brief.md' })).toBeTruthy();
  });

  // A resend replays the failed turn's own files; anything staged since belongs to the next
  // message, and clearing it would destroy a file that never travelled.
  it('leaves a file staged after the turn it was not part of is retried', async () => {
    const ws = await mountPanel();
    await dropFiles(briefFile('# Pricing'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open brief.md' })).toBeTruthy());
    await sendTurn('use this');
    await act(async () => { ws.emit({ type: 'error', error: 'Rate limit reached' }); });

    await dropFiles(briefFile('# Later', 'later.md'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open later.md' })).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByText('Try again')); });

    expect(chats(ws)[1].context?.attachments).toEqual([
      { kind: 'document', filename: 'brief.md', text: '# Pricing' },
    ]);
    expect(screen.getByRole('button', { name: 'Open later.md' })).toBeTruthy();
  });

  // Promised files (an Outlook attachment drag) advertise `Files` and deliver none. The drop
  // still has to be taken, or the browser opens whatever it was over the editor.
  it('still cancels a drop that promised files and delivered none', async () => {
    await mountPanel();
    const composer = screen.getByTestId('chat-composer');
    const drop = createEvent.drop(composer, { dataTransfer: { files: [], types: ['Files'] } });

    await act(async () => { fireEvent(composer, drop); });

    expect(drop.defaultPrevented).toBe(true);
  });
});

describe('the cap on how many files a turn carries', () => {
  const brief = (n: number): File =>
    new File([`# ${String(n)}`], `f${String(n)}.md`, { type: 'text/markdown' });

  it('takes the full four', async () => {
    await mountPanel();

    for (let n = 1; n <= 4; n++) await dropFiles(brief(n));

    await waitFor(() => { expect(screen.getByText(/f4\.md/)).toBeTruthy(); });
    expect(screen.queryByText(/Only 4 files/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /Remove/ })).toHaveLength(4);
  });

  it('takes four dropped together', async () => {
    await mountPanel();

    await dropFiles(brief(1), brief(2), brief(3), brief(4));

    await waitFor(() => { expect(screen.getByText(/f4\.md/)).toBeTruthy(); });
    expect(screen.queryByText(/Only 4 files/)).toBeNull();
  });

  it('takes a fourth after three dropped together', async () => {
    await mountPanel();

    await dropFiles(brief(1), brief(2), brief(3));
    await dropFiles(brief(4));

    await waitFor(() => { expect(screen.getByText(/f4\.md/)).toBeTruthy(); });
    expect(screen.queryByText(/Only 4 files/)).toBeNull();
  });

  it('still takes four when a refusal is sitting on the composer', async () => {
    await mountPanel();

    await dropFiles(new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' }));
    await waitFor(() => { expect(screen.getByText(/PDF and Word files cannot be read yet/)).toBeTruthy(); });
    for (let n = 1; n <= 4; n++) await dropFiles(brief(n));

    await waitFor(() => { expect(screen.getByText(/f4\.md/)).toBeTruthy(); });
    expect(screen.queryByText(/Only 4 files/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /Remove/ })).toHaveLength(4);
  });

  it('keeps only the last four refusals', async () => {
    await mountPanel();

    for (let n = 1; n <= 6; n++) {
      await dropFiles(new File(['%PDF'], `spec${String(n)}.pdf`, { type: 'application/pdf' }));
    }

    await waitFor(() => { expect(screen.getByText(/spec6\.pdf/)).toBeTruthy(); });
    expect(screen.getAllByRole('button', { name: /Dismiss/ })).toHaveLength(4);
    expect(screen.queryByText(/spec1\.pdf/)).toBeNull();
  });

  it('refuses the fifth, and says why', async () => {
    await mountPanel();

    for (let n = 1; n <= 5; n++) await dropFiles(brief(n));

    await waitFor(() => { expect(screen.getByText(/Only 4 files can be attached/)).toBeTruthy(); });
    expect(screen.getAllByRole('button', { name: /Remove/ })).toHaveLength(4);
  });
});

describe('a file dragged over the panel', () => {
  async function dragOver(types: string[]): Promise<void> {
    await act(async () => {
      fireEvent.dragEnter(screen.getByTestId('chat-composer'), { dataTransfer: { types } });
    });
  }

  it('covers the panel while the file is over it', async () => {
    await mountPanel();
    expect(screen.queryByTestId('chat-drop-overlay')).toBeNull();

    await dragOver(['Files']);
    expect(screen.getByTestId('chat-drop-overlay')).toBeTruthy();

    await act(async () => { fireEvent.dragLeave(screen.getByTestId('chat-composer')); });
    expect(screen.queryByTestId('chat-drop-overlay')).toBeNull();
  });

  // The reason the panel counts drags instead of holding a flag: crossing into the textarea
  // fires dragleave on the panel, and a flag would clear the overlay mid-drag.
  it('stays covered while the drag crosses a child of the panel', async () => {
    await mountPanel();
    await dragOver(['Files']);

    const textarea = screen.getByRole('textbox');
    await act(async () => { fireEvent.dragEnter(textarea, { dataTransfer: { types: ['Files'] } }); });
    await act(async () => { fireEvent.dragLeave(textarea); });

    expect(screen.getByTestId('chat-drop-overlay')).toBeTruthy();

    await act(async () => { fireEvent.dragLeave(screen.getByTestId('chat-composer')); });
    expect(screen.queryByTestId('chat-drop-overlay')).toBeNull();
  });

  it('stays out of the way of a drag carrying no file', async () => {
    await mountPanel();

    await dragOver(['text/plain']);

    expect(screen.queryByTestId('chat-drop-overlay')).toBeNull();
  });

  // A drag can advertise Files on entry and still deliver none on drop.
  it('uncovers the panel when the drop turns out to carry nothing', async () => {
    await mountPanel();
    await dragOver(['Files']);

    await act(async () => {
      fireEvent.drop(screen.getByTestId('chat-composer'), { dataTransfer: { files: [], types: ['Files'] } });
    });

    expect(screen.queryByTestId('chat-drop-overlay')).toBeNull();
  });

  it('uncovers the panel once the file lands', async () => {
    await mountPanel();
    await dragOver(['Files']);

    await dropFiles(new File(['# Brief'], 'brief.md', { type: 'text/markdown' }));

    expect(screen.queryByTestId('chat-drop-overlay')).toBeNull();
    await waitFor(() => { expect(screen.getByText(/brief\.md/)).toBeTruthy(); });
  });

  it('offers a button for picking a file without dragging one', async () => {
    await mountPanel();

    expect(screen.getByRole('button', { name: 'Attach a brief or an image' })).toBeTruthy();
  });
});

describe('a file that cannot be used', () => {
  it('says so, and holds the turn back rather than sending without it', async () => {
    const ws = await mountPanel();

    await dropFiles(new File(['%PDF'], 'brief.pdf', { type: 'application/pdf' }));

    await waitFor(() => { expect(screen.getByText(/PDF and Word files cannot be read yet/)).toBeTruthy(); });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'use this' } });
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('disabled')).not.toBeNull();

    // Dismissing the refusal releases the turn, which then carries no attachments.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Dismiss/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });

    expect(chatContext(ws)?.attachments).toBeUndefined();
  });

  it('reports a file it could read but that had nothing in it', async () => {
    await mountPanel();

    await dropFiles(briefFile('   ', 'empty.md'));

    await waitFor(() => { expect(screen.getByText(/has no text in it/)).toBeTruthy(); });
  });
});

describe('attaching an image', () => {
  it('sends the image itself, shrunk, with the turn', async () => {
    const ws = await mountPanel();

    await dropFiles(new File(['bytes'], 'hero.png', { type: 'image/png' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: /Remove/ })).toBeTruthy(); });
    await sendTurn('what is wrong with this layout?');

    expect(chatContext(ws)?.attachments).toEqual([
      { kind: 'image', filename: 'hero.png', dataUrl: `data:image/webp;base64,${btoa('hero.png')}` },
    ]);
    // Nothing is uploaded anywhere: the bytes ride on the turn.
    expect(prepared).toHaveBeenCalledTimes(1);
  });

  it('says so when the image cannot be prepared, and holds the turn back', async () => {
    prepared.mockRejectedValueOnce(new AttachmentError('This image could not be read.'));
    await mountPanel();

    await dropFiles(new File(['bytes'], 'hero.png', { type: 'image/png' }));

    await waitFor(() => { expect(screen.getByText(/could not be read/)).toBeTruthy(); });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'look at this' } });
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('disabled')).not.toBeNull();
  });
});
