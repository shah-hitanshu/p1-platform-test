import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, fireEvent, waitFor } from '@testing-library/react';
import { MockWebSocket, MEDIA_URL, patchObjectUrls } from './testSupport.js';

vi.mock('../src/lib/attachments/downscaleImage.js',
  async () => (await import('./testSupport.js')).downscaleImageMock());
vi.mock('@puckeditor/core',
  async () => (await import('./testSupport.js')).puckCoreMock());
vi.mock('@pantheon-systems/puck-css',
  async () => (await import('./testSupport.js')).puckCssMock());

const { ChatPanel } = await import('../src/components/panel/ChatPanel.js');

let scopeCounter = 0;
let fetchMock: ReturnType<typeof vi.fn>;
let restoreObjectUrls: () => void;

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  restoreObjectUrls = patchObjectUrls();
});
afterEach(() => {
  restoreObjectUrls();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openReplayedFile(attachment: unknown, mediaWorkerUrl = MEDIA_URL): Promise<void> {
  const agentId = `library-${++scopeCounter}`;
  render(
    <ChatPanel options={{
      agentUrl: 'http://agent.test',
      getAgentId: () => agentId,
      ...(mediaWorkerUrl ? { mediaWorkerUrl } : {}),
    }} />,
  );
  await act(async () => { MockWebSocket.instances[0].open(); });
  await act(async () => {
    MockWebSocket.instances[0].emit({
      type: 'history',
      history: [{ role: 'user', content: 'look', attachments: [attachment] }],
    });
  });
  const name = (attachment as { filename: string }).filename;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: `Open ${name}` })); });
}

const promoteCalls = () =>
  fetchMock.mock.calls.filter(c => String(c[0]).includes('/promote'));

const SCHEMA = [
  { name: 'alt', label: 'Alt text', type: 'string' },
  { name: 'caption', label: 'Caption', type: 'string' },
];

/** The image bytes, the field list, the asset record, and a promote the test picks. */
function media(promote: () => Response, asset: () => Response = chatAsset) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/promote')) return promote();
    if (url.includes('/media/schema')) return new Response(JSON.stringify(SCHEMA), { status: 200 });
    if (url.includes('/content')) return new Response(new Blob(['bytes']), { status: 200 });
    return asset();
  });
}

/** Still a chat attachment: `origin` is sent only until the asset joins the library. */
const chatAsset = () => new Response(JSON.stringify({ origin: 'chat' }), { status: 200 });

/** Opens the details form that the Add button now leads to. */
async function openDetails(): Promise<void> {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add to library' })); });
}

/** Confirms the form — a separate control from the one that opened it. */
async function submitDetails(): Promise<void> {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
}

describe('adding a chat attachment to the media library', () => {
  it('offers the action for a kept image and promotes it on request', async () => {
    fetchMock = media(() => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await openReplayedFile({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' });
    // Making it a site asset is a write, so nothing happens until it is asked for.
    expect(promoteCalls()).toHaveLength(0);

    await openDetails();
    // Asking for details must not promote anything on its own.
    expect(promoteCalls()).toHaveLength(0);

    await submitDetails();
    await waitFor(() => { expect(screen.getByText('Added to the media library')).toBeTruthy(); });

    const requested = new URL(String(promoteCalls()[0][0]));
    expect(requested.pathname).toBe('/media/asset-1/promote');
    expect(requested.searchParams.get('siteId')).toBe('site1');
    expect(promoteCalls()[0][1].method).toBe('POST');
  });

  // Every other way into the library collects alt at upload. An image arriving from chat
  // without it is unusable to a screen reader and nothing later prompts anyone to fix it.
  it('asks for the details the library records, and sends them with the promotion', async () => {
    fetchMock = media(() => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await openReplayedFile({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' });
    await openDetails();

    // Read off the service, so the form cannot drift from the library's own upload.
    await waitFor(() => { expect(screen.getByText('Alt text')).toBeTruthy(); });
    expect(screen.getByText('Caption')).toBeTruthy();

    const [alt, caption] = screen.getAllByRole('textbox').slice(-2);
    fireEvent.change(alt, { target: { value: 'A pink shoe' } });
    fireEvent.change(caption, { target: { value: 'Puzzle' } });
    await submitDetails();
    await waitFor(() => { expect(screen.getByText('Added to the media library')).toBeTruthy(); });

    expect(JSON.parse(promoteCalls()[0][1].body as string)).toEqual({
      metadata: { alt: 'A pink shoe', caption: 'Puzzle' },
    });
  });

  // The field list is a convenience, not a gate: losing it must not cost the user the
  // ability to add the image at all.
  it('still adds the image when the field list cannot be read', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/promote')) return new Response('{}', { status: 200 });
      if (url.includes('/media/schema')) return new Response('nope', { status: 500 });
      if (url.includes('/content')) return new Response(new Blob(['bytes']), { status: 200 });
      return chatAsset();
    });
    vi.stubGlobal('fetch', fetchMock);

    await openReplayedFile({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' });
    await openDetails();
    await submitDetails();

    await waitFor(() => { expect(screen.getByText('Added to the media library')).toBeTruthy(); });
  });

  // The offer exists to collect alt text. A schema the service cannot supply used to render
  // an empty form, so the image landed in the library unlabelled with nothing prompting a fix.
  it('still asks for alt text when the field list cannot be read', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/promote')) return new Response('{}', { status: 200 });
      if (url.includes('/media/schema')) return new Response('nope', { status: 500 });
      if (url.includes('/content')) return new Response(new Blob(['bytes']), { status: 200 });
      return chatAsset();
    });
    vi.stubGlobal('fetch', fetchMock);

    await openReplayedFile({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' });
    await openDetails();

    await waitFor(() => { expect(screen.getByText('Alt text')).toBeTruthy(); });
  });

  it('lets the form be backed out of without writing anything', async () => {
    fetchMock = media(() => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await openReplayedFile({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' });
    await openDetails();
    await waitFor(() => { expect(screen.getByText('Alt text')).toBeTruthy(); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });

    expect(screen.getByRole('button', { name: 'Add to library' })).toBeTruthy();
    expect(screen.queryByText('Alt text')).toBeNull();
    expect(promoteCalls()).toHaveLength(0);
  });

  // Hidden, not disabled: the library holds images, and a greyed control on a brief is a
  // question the user cannot answer.
  it('does not offer the action for a brief', async () => {
    fetchMock = vi.fn().mockResolvedValue(new Response('# hi', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await openReplayedFile({ kind: 'document', filename: 'brief.md', assetId: 'asset-1' });
    await waitFor(() => { expect(screen.getByText('# hi')).toBeTruthy(); });

    expect(screen.queryByRole('button', { name: 'Add to library' })).toBeNull();
    // The button is gated on kind, so the lookup behind it has to be too: a brief's record
    // fetch can only ever produce an answer nothing renders.
    const lookups = fetchMock.mock.calls
      .map(c => String(c[0]))
      .filter(u => u.includes('/media/asset-1') && !u.includes('/content'));
    expect(lookups).toEqual([]);
  });

  // The service takes a second promotion as a no-op, so an offer here would collect alt
  // text and drop it — and report success for a write that never happened.
  it('does not offer the action for an image already in the library', async () => {
    fetchMock = media(
      () => new Response('{}', { status: 200 }),
      () => new Response(JSON.stringify({ assetId: 'asset-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await openReplayedFile({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' });

    await waitFor(() => { expect(screen.getByText(/Already in the media library/)).toBeTruthy(); });
    expect(screen.queryByRole('button', { name: 'Add to library' })).toBeNull();
    expect(promoteCalls()).toHaveLength(0);
  });

  // Nothing about a file that no longer exists can be added, and the preview says so already.
  it('offers nothing once the file has expired', async () => {
    // An expired asset is gone from the content route and the record alike.
    fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/media/schema')
        ? new Response(JSON.stringify(SCHEMA), { status: 200 })
        : new Response('{"error":"Not found"}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await openReplayedFile({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' });

    await waitFor(() => { expect(screen.getByText('This file is no longer available.')).toBeTruthy(); });
    expect(screen.queryByRole('button', { name: 'Add to library' })).toBeNull();
  });

  // Deleting takes an image out of the library, not out of the conversation that sent it:
  // the transcript is a record, and the file it shows must outlive the library's copy.
  it('keeps showing a file the library deleted, and offers to add it back', async () => {
    fetchMock = media(
      () => new Response('{}', { status: 200 }),
      () => new Response('{"error":"Not found"}', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await openReplayedFile({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' });

    await waitFor(() => { expect(screen.getByAltText('shot.png')).toBeTruthy(); });
    expect(screen.queryByText('This file is no longer available.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add to library' })).toBeTruthy();
  });

  // A refusal the user can act on — too long a caption, say — is worth more than "try again".
  it('shows the reason the service gave for refusing', async () => {
    fetchMock = media(() => new Response(
      JSON.stringify({ error: 'Metadata field "caption" exceeds 2000 bytes' }),
      { status: 400 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await openReplayedFile({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' });
    await openDetails();
    await submitDetails();

    await waitFor(() => {
      expect(screen.getByText('Metadata field "caption" exceeds 2000 bytes')).toBeTruthy();
    });
  });

  it('says so and stays retryable when the promotion fails', async () => {
    fetchMock = media(() => new Response('no', { status: 415 }));
    vi.stubGlobal('fetch', fetchMock);

    await openReplayedFile({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' });
    await openDetails();
    await submitDetails();

    await waitFor(() => { expect(screen.getByText(/did not work/)).toBeTruthy(); });
    // Retryable with what was typed still in the form, not back at the start.
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    expect(screen.getByText('Alt text')).toBeTruthy();
  });
});
