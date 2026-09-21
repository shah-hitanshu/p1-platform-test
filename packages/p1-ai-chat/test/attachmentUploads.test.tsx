import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ChatContext } from '../src/types.js';
import { MockWebSocket, MEDIA_URL, happyMedia } from './testSupport.js';

vi.mock('../src/lib/attachments/downscaleImage.js',
  async () => (await import('./testSupport.js')).downscaleImageMock());
vi.mock('@puckeditor/core',
  async () => (await import('./testSupport.js')).puckCoreMock());
// Hoisted so the module factory below can reach it: counting token fetches is how the
// test tells whether the send path did work it did not need to.
const auth = vi.hoisted(() => ({ tokenFetches: 0 }));

vi.mock('@pantheon-systems/puck-css',
  async () => (await import('./testSupport.js')).puckCssMock(auth));

const { ChatPanel } = await import('../src/components/panel/ChatPanel.js');

let scopeCounter = 0;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  MockWebSocket.instances = [];
  auth.tokenFetches = 0;
  vi.stubGlobal('WebSocket', MockWebSocket);
  fetchMock = happyMedia();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountPanel(mediaWorkerUrl?: string): Promise<MockWebSocket> {
  const agentId = `uploads-${++scopeCounter}`;
  render(
    <ChatPanel options={{
      agentUrl: 'http://agent.test',
      getAgentId: () => agentId,
      ...(mediaWorkerUrl ? { mediaWorkerUrl } : {}),
    }} />,
  );
  // Waited for rather than assumed: a previous test's session can still be settling when
  // this one renders, so the socket is not always up by the first tick.
  await waitFor(() => { expect(MockWebSocket.instances[0]).toBeTruthy(); });
  await act(async () => { MockWebSocket.instances[0].open(); });
  const ws = MockWebSocket.instances[0];
  await act(async () => { ws.emit({ type: 'history', history: [] }); });
  return ws;
}

async function dropBrief(name = 'brief.md'): Promise<void> {
  await act(async () => {
    fireEvent.drop(screen.getByTestId('chat-composer'), {
      dataTransfer: { files: [new File(['# hi'], name, { type: 'text/markdown' })], types: ['Files'] },
    });
  });
}

async function dropImage(name = 'shot.png'): Promise<void> {
  await act(async () => {
    fireEvent.drop(screen.getByTestId('chat-composer'), {
      dataTransfer: { files: [new File(['bytes'], name, { type: 'image/png' })], types: ['Files'] },
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

const calledWith = (fragment: string) =>
  fetchMock.mock.calls.filter(c => String(c[0]).includes(fragment));

describe('keeping chat attachments', () => {
  it('sends the stored id with the turn', async () => {
    const ws = await mountPanel(MEDIA_URL);
    await dropBrief();
    await waitFor(() => { expect(screen.getByText(/brief\.md/)).toBeTruthy(); });

    await sendTurn('build this');

    expect(chatContext(ws)?.attachments).toEqual([
      { kind: 'document', filename: 'brief.md', text: '# hi', assetId: 'asset-1' },
    ]);
  });

  it('keeps nothing, and asks for nothing, when no media URL is configured', async () => {
    const ws = await mountPanel();
    await dropBrief();
    await waitFor(() => { expect(screen.getByText(/brief\.md/)).toBeTruthy(); });

    await sendTurn('build this');

    expect(fetchMock).not.toHaveBeenCalled();
    // Exactly today's behaviour: the file still travels, it just isn't kept.
    expect(chatContext(ws)?.attachments).toEqual([
      { kind: 'document', filename: 'brief.md', text: '# hi' },
    ]);
  });

  // The turn is the thing that must not break. Everything about keeping the file is
  // best effort on top of it.
  it('sends the turn normally when the upload fails', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    const ws = await mountPanel(MEDIA_URL);
    await dropBrief();
    await waitFor(() => { expect(screen.getByText(/brief\.md/)).toBeTruthy(); });

    await sendTurn('build this');

    expect(chatContext(ws)?.attachments).toEqual([
      { kind: 'document', filename: 'brief.md', text: '# hi' },
    ]);
  });

  it('never records a file the user removed before sending', async () => {
    await mountPanel(MEDIA_URL);
    await dropBrief();
    await waitFor(() => { expect(screen.getByText(/brief\.md/)).toBeTruthy(); });
    await waitFor(() => { expect(calledWith('/media/presign')).toHaveLength(1); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /remove/i })); });
    await sendTurn('never mind');

    // Bytes reached storage, but nothing recorded them, so they are collected server-side.
    expect(calledWith('/media/finalize')).toHaveLength(0);
  });

  it('records only as the turn is sent, not when the file is staged', async () => {
    await mountPanel(MEDIA_URL);
    await dropBrief();
    await waitFor(() => { expect(calledWith('/media/presign')).toHaveLength(1); });

    expect(calledWith('/media/finalize')).toHaveLength(0);

    await sendTurn('build this');
    await waitFor(() => { expect(calledWith('/media/finalize')).toHaveLength(1); });
  });
});

describe('id alignment', () => {
  // A refused file sits in the composer with the others. It never travels, so the
  // staged-id list and the attachment list must still line up for the ones that do.
  it('pairs each stored id with the file it belongs to when a refusal is present', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/media/presign')) {
        const n = calledWith('/media/presign').length;
        return new Response(JSON.stringify({
          assetId: `asset-${n}`, versionId: 'v1', filename: `f${n}.md`, uploadUrl: 'https://storage.test/put',
        }), { status: 200 });
      }
      if (url.startsWith('https://storage.test/')) return new Response(null, { status: 200 });
      return new Response('{}', { status: 201 });
    });

    const ws = await mountPanel(MEDIA_URL);
    await act(async () => {
      fireEvent.drop(screen.getByTestId('chat-composer'), {
        dataTransfer: {
          files: [
            new File(['# one'], 'one.md', { type: 'text/markdown' }),
            new File(['nope'], 'bad.exe', { type: 'application/x-msdownload' }),
          ],
          types: ['Files'],
        },
      });
    });
    await waitFor(() => { expect(screen.getAllByText(/bad\.exe/).length).toBeGreaterThan(0); });

    // The refusal blocks sending until it is dismissed, which is existing behaviour.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss bad.exe' }));
    });
    await sendTurn('build this');

    const sentFiles = chatContext(ws)?.attachments ?? [];
    expect(sentFiles).toHaveLength(1);
    expect(sentFiles[0]).toMatchObject({ filename: 'one.md', assetId: 'asset-1' });
  });
});

describe('retrying a turn that carried files', () => {
  // The reference only persists if it rides in the turn's own frame, so a retry that
  // dropped it would leave the file kept but unreachable for the rest of its 30 days.
  it('carries the same stored ids', async () => {
    const ws = await mountPanel(MEDIA_URL);
    await dropBrief();
    await waitFor(() => { expect(screen.getByText(/brief\.md/)).toBeTruthy(); });
    await sendTurn('build this');
    await waitFor(() => { expect(chatContext(ws)).toBeTruthy(); });

    const first = ws.sent.length;
    await act(async () => {
      ws.emit({ type: 'error', error: 'the agent fell over' });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    await waitFor(() => { expect(ws.sent.length).toBeGreaterThan(first); });

    const frames = ws.sent
      .map(s => JSON.parse(s) as { type: string; context?: ChatContext })
      .filter(f => f.type === 'chat');
    expect(frames).toHaveLength(2);
    expect(frames[1].context?.attachments).toEqual([
      { kind: 'document', filename: 'brief.md', text: '# hi', assetId: 'asset-1' },
    ]);
  });
});

describe('a turn sent in this session', () => {
  /**
   * `setTurnFiles` exists so the card gains its reference the moment finalize lands, without
   * a reload. Every other test here reads the outgoing frame or a replayed turn, so the
   * transcript side of that — the card becoming openable — went unasserted.
   *
   * Also the only end-to-end cover for the image path: the agent gets the downscaled data
   * URL, storage gets the original file.
   */
  it('offers a live-sent image to the library once its upload is recorded', async () => {
    // The card is openable from its own dataUrl either way, so the reference is only
    // observable through the offer, which is gated on it.
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/media/presign')) {
        return new Response(JSON.stringify({
          assetId: 'asset-1', versionId: 'v1', filename: 'shot.png', uploadUrl: 'https://storage.test/put',
        }), { status: 200 });
      }
      if (url.startsWith('https://storage.test/')) return new Response(null, { status: 200 });
      if (url.includes('/media/finalize')) return new Response('{}', { status: 201 });
      if (url.includes('/media/schema')) return new Response('[]', { status: 200 });
      if (/\/media\/asset-1\?/.test(url)) {
        return new Response(JSON.stringify({ origin: 'chat' }), { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const ws = await mountPanel(MEDIA_URL);
    await dropImage();
    await sendTurn('what is this');

    // The frame carries the shrunk copy the agent reads, plus the stored reference.
    expect(chatContext(ws)?.attachments?.[0]).toMatchObject({
      kind: 'image', filename: 'shot.png', assetId: 'asset-1',
    });
    // The bytes sent to storage are the file as attached, not the downscaled data URL.
    const put = fetchMock.mock.calls.find(c => String(c[0]).startsWith('https://storage.test/'));
    expect((put?.[1] as { body?: unknown } | undefined)?.body).toBeInstanceOf(File);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open shot.png' })); });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add to library' })).toBeTruthy();
    });
  });
});

describe('turns that carry no files', () => {
  /**
   * Resolving where to keep a file costs a token fetch, and most turns keep nothing. The
   * send path already waits on this work, so doing it unconditionally would put the cost
   * on every message anyone ever sends.
   */
  it('does no media work at all, even with a media URL configured', async () => {
    const ws = await mountPanel(MEDIA_URL);
    const before = auth.tokenFetches;

    await sendTurn('just a question');

    expect(fetchMock).not.toHaveBeenCalled();
    // One, for the turn's own context — not a second for storage that has nothing to do.
    expect(auth.tokenFetches - before).toBe(1);
    expect(chatContext(ws)?.attachments).toBeUndefined();
  });
});

describe('turns that carry files', () => {
  /**
   * The send resolves a context for the turn's own frame, and recording the upload needs the
   * same siteId and token. Resolving it twice fetched two tokens for one send — invisible in
   * behaviour, and a doubled auth round trip on exactly the turns that are already slowest.
   */
  it('resolves the auth context once, not once per consumer', async () => {
    await mountPanel(MEDIA_URL);
    await dropBrief();
    // Measured from after the attach: staging the upload resolves its own context, which is
    // a different moment and not what this pins.
    const before = auth.tokenFetches;

    await sendTurn('here you go');

    expect(auth.tokenFetches - before).toBe(1);
    expect(calledWith('/media/finalize')).toHaveLength(1);
  });
});

describe('attaching several files at once', () => {
  /**
   * Staging resolves where to keep the file, which costs a token fetch. Doing that per file
   * meant dropping a folder of images fired one auth round trip each, all at once — the send
   * path already shares one, so this was just an inconsistency with a cost.
   */
  it('resolves the auth context once for the whole drop', async () => {
    await mountPanel(MEDIA_URL);
    const before = auth.tokenFetches;

    await act(async () => {
      fireEvent.drop(screen.getByTestId('chat-composer'), {
        dataTransfer: {
          files: [
            new File(['# a'], 'a.md', { type: 'text/markdown' }),
            new File(['# b'], 'b.md', { type: 'text/markdown' }),
            new File(['# c'], 'c.md', { type: 'text/markdown' }),
          ],
          types: ['Files'],
        },
      });
    });

    expect(auth.tokenFetches - before).toBe(1);
  });
});

describe('a file still uploading when the turn is sent', () => {
  /** Resolves the presign only when the test says so. */
  function heldPresign() {
    let release: () => void = () => undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/media/presign')) {
        await held;
        return new Response(JSON.stringify({
          assetId: 'asset-late', versionId: 'v1', filename: 'brief.md', uploadUrl: 'https://storage.test/put',
        }), { status: 200 });
      }
      if (url.startsWith('https://storage.test/')) return new Response(null, { status: 200 });
      return new Response('{}', { status: 201 });
    });
    return { fetchImpl, release: () => release() };
  }

  /**
   * The card goes up as soon as the turn is sent, before its upload is recorded. Opening it
   * in that window used to capture the file as it was then, so the reference `setTurnFiles`
   * adds a moment later never reached the open modal and the library offer never appeared.
   */
  it('grows the library offer in a modal opened before the upload landed', async () => {
    const { fetchImpl, release } = heldPresign();
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/media/schema')) return new Response('[]', { status: 200 });
      if (/\/media\/asset-late\?/.test(url)) {
        return new Response(JSON.stringify({ origin: 'chat' }), { status: 200 });
      }
      return fetchImpl(input);
    });
    vi.stubGlobal('fetch', fetchMock);

    await mountPanel(MEDIA_URL);
    await dropImage('late.png');

    // Sent with the presign still held, so the turn's file carries no reference yet.
    await sendTurn('look at this');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open late.png' }));
    });
    expect(screen.queryByRole('button', { name: 'Add to library' })).toBeNull();

    // The modal stays open while the upload finishes.
    await act(async () => { release(); });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add to library' })).toBeTruthy();
    });
  });

  it('sends anyway when the upload outlasts the deadline', { timeout: 15_000 }, async () => {
    const { fetchImpl } = heldPresign(); // never released
    fetchMock = fetchImpl;
    vi.stubGlobal('fetch', fetchMock);

    // Mounted on real timers: the panel's own setup depends on them.
    const ws = await mountPanel(MEDIA_URL);
    await dropBrief();
    await waitFor(() => { expect(screen.getByText(/brief\.md/)).toBeTruthy(); });

    // Real timers throughout: React's scheduler runs on them, and swapping to fake ones
    // mid-file leaves it unable to render the next test's panel at all. So this genuinely
    // waits out the deadline rather than fast-forwarding it.
    await sendTurn('build this');
    await waitFor(
      () => { expect(chatContext(ws)).toBeTruthy(); },
      { timeout: 10_000 },
    );

    // The turn went, and the file still reached the agent — only its reference was lost.
    expect(chatContext(ws)?.attachments).toEqual([
      { kind: 'document', filename: 'brief.md', text: '# hi' },
    ]);
  });
  // Reading a file takes milliseconds; sending the original can take a while. Without a
  // wait, anyone who attaches and sends straight away loses the reference — and there is
  // no second chance, because it only persists if it rides in this turn's frame.
  it('waits for an upload that lands just after send, and keeps it', async () => {
    const { fetchImpl, release } = heldPresign();
    fetchMock = fetchImpl;
    vi.stubGlobal('fetch', fetchMock);

    const ws = await mountPanel(MEDIA_URL);
    await dropBrief();
    await waitFor(() => { expect(screen.getByText(/brief\.md/)).toBeTruthy(); });

    // Released well after the click but well inside the deadline, so the turn can only
    // carry the reference if it genuinely waited for the upload.
    const sent = sendTurn('build this');
    const landsDuringTheWait = setTimeout(release, 400);
    await sent;
    await waitFor(() => { expect(chatContext(ws)).toBeTruthy(); }, { timeout: 10_000 });
    clearTimeout(landsDuringTheWait);

    expect(chatContext(ws)?.attachments).toEqual([
      { kind: 'document', filename: 'brief.md', text: '# hi', assetId: 'asset-late' },
    ]);
  });

});

describe('a recording that lands slowly', () => {
  /** Holds the recording call only; the bytes go up immediately. */
  function heldFinalize() {
    let release: () => void = () => undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/media/presign')) {
        return new Response(JSON.stringify({
          assetId: 'asset-slow', versionId: 'v1', filename: 'brief.md', uploadUrl: 'https://storage.test/put',
        }), { status: 200 });
      }
      if (url.startsWith('https://storage.test/')) return new Response(null, { status: 200 });
      if (url.includes('/media/finalize')) { await held; return new Response('{}', { status: 201 }); }
      return new Response('{}', { status: 201 });
    });
    return { fetchImpl, release: () => release() };
  }

  it('keeps the reference when recording outlasts the upload deadline', { timeout: 20_000 }, async () => {
    const { fetchImpl, release } = heldFinalize();
    fetchMock = fetchImpl;
    vi.stubGlobal('fetch', fetchMock);

    const ws = await mountPanel(MEDIA_URL);
    await dropBrief();
    await waitFor(() => { expect(screen.getByText(/brief\.md/)).toBeTruthy(); });

    // Released past the deadline that bounds the upload, so the turn can only carry the
    // reference if that deadline no longer governs the recording call.
    const sent = sendTurn('build this');
    const landsLate = setTimeout(release, 4_000);
    await sent;
    await waitFor(() => { expect(chatContext(ws)).toBeTruthy(); }, { timeout: 15_000 });
    clearTimeout(landsLate);

    expect(chatContext(ws)?.attachments).toEqual([
      { kind: 'document', filename: 'brief.md', text: '# hi', assetId: 'asset-slow' },
    ]);
  });
});
