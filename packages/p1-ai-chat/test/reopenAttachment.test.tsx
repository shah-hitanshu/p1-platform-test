import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, fireEvent, waitFor } from '@testing-library/react';
import { MockWebSocket, baseContext, MEDIA_URL, patchObjectUrls } from './testSupport.js';

vi.mock('../src/lib/attachments/downscaleImage.js',
  async () => (await import('./testSupport.js')).downscaleImageMock());
vi.mock('@puckeditor/core',
  async () => (await import('./testSupport.js')).puckCoreMock());
vi.mock('@pantheon-systems/puck-css',
  async () => (await import('./testSupport.js')).puckCssMock());

const { ChatPanel } = await import('../src/components/panel/ChatPanel.js');
const { initialPreview } = await import('../src/components/attachments/AttachmentModal.js');

let scopeCounter = 0;
let fetchMock: ReturnType<typeof vi.fn>;
let revoked: string[];
let restoreObjectUrls: () => void;

/**
 * happy-dom provides an IntersectionObserver that never fires, having no layout — so a
 * lazily-loaded thumbnail would look correct here by never loading at all. This stub is
 * what makes "before visible" and "after visible" two distinct, assertable states.
 */
let showCard: () => void;

beforeEach(() => {
  MockWebSocket.instances = [];
  revoked = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  const callbacks: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
  showCard = () => { for (const cb of callbacks) cb([{ isIntersecting: true }]); };
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { callbacks.push(cb); }
    observe() { /* the test decides when the card is on screen */ }
    disconnect() { /* nothing to release */ }
  });
  restoreObjectUrls = patchObjectUrls({ blobUrl: 'blob:kept-file', onRevoke: url => revoked.push(url) });
});
afterEach(() => {
  restoreObjectUrls();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A conversation reopened later: names and references, no files. */
async function replayTurnWith(attachment: unknown, mediaWorkerUrl?: string): Promise<void> {
  const agentId = `reopen-${++scopeCounter}`;
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
      history: [{ role: 'user', content: 'look at this', attachments: [attachment] }],
    });
  });
}

describe('reopening a file from an earlier session', () => {
  it('offers to open a card that carries a reference', async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await replayTurnWith({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' }, MEDIA_URL);

    expect(screen.getByRole('button', { name: 'Open shot.png' })).toBeTruthy();
    // A long transcript must not fire one authenticated request per card as it loads;
    // only the cards actually on screen fetch anything.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The card is what the transcript shows without being clicked, so a restored image that
  // renders as a filename with a JPG badge reads as a document rather than a picture.
  it('shows the image itself once the card is on screen', async () => {
    fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['bytes']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await replayTurnWith({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' }, MEDIA_URL);

    await act(async () => { showCard(); });
    await waitFor(() => { expect(screen.getByAltText('shot.png')).toBeTruthy(); });

    // Resized server-side: pulling the full original to paint a 72px card is the whole
    // reason the width parameter exists.
    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requested.pathname).toBe('/media/asset-1/content');
    expect(requested.searchParams.get('width')).toBe('144');
  });

  it('asks for no thumbnail for a brief, which has no image to show', async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await replayTurnWith({ kind: 'document', filename: 'brief.md', assetId: 'asset-1' }, MEDIA_URL);

    await act(async () => { showCard(); });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Falling back to the name is what the card did before thumbnails existed, so a failed
  // fetch must not cost anything that already worked.
  it('keeps the card usable when the thumbnail cannot be fetched', async () => {
    fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await replayTurnWith({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' }, MEDIA_URL);

    await act(async () => { showCard(); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });

    expect(screen.queryByAltText('shot.png')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open shot.png' })).toBeTruthy();
  });

  it('leaves the card unopenable when nothing is set up to keep files', async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await replayTurnWith({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' });

    expect(screen.queryByRole('button', { name: 'Open shot.png' })).toBeNull();
    expect(screen.getByText(/shot\.png/)).toBeTruthy();
  });

  it('fetches a kept brief through the authenticated route and shows its text', async () => {
    fetchMock = vi.fn().mockResolvedValue(new Response('# Pricing\n\nThree tiers.', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await replayTurnWith({ kind: 'document', filename: 'brief.md', assetId: 'asset-1' }, MEDIA_URL);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open brief.md' })); });
    await waitFor(() => { expect(screen.getByText(/Three tiers\./)).toBeTruthy(); });

    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requested.pathname).toBe('/media/asset-1/content');
    expect(requested.searchParams.get('siteId')).toBe('site1');
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${baseContext.token}`);
  });

  it('says so plainly when the file has aged out', async () => {
    fetchMock = vi.fn().mockResolvedValue(new Response('gone', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await replayTurnWith({ kind: 'document', filename: 'brief.md', assetId: 'asset-1' }, MEDIA_URL);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open brief.md' })); });
    await waitFor(() => { expect(screen.getByText('This file is no longer available.')).toBeTruthy(); });
  });

  it('releases the object URL for a kept image when the preview closes', async () => {
    // A fresh Response per call: opening the preview reads the bytes and the asset record,
    // and a body can only be consumed once.
    fetchMock = vi.fn(async () => new Response(new Blob(['bytes']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await replayTurnWith({ kind: 'image', filename: 'shot.png', assetId: 'asset-1' }, MEDIA_URL);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open shot.png' })); });
    await waitFor(() => { expect(screen.getByAltText('shot.png')).toBeTruthy(); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close preview' })); });
    // The blob stays alive as long as the URL does, not as long as the element using it.
    expect(revoked).toContain('blob:kept-file');
  });
});

/**
 * The effect that starts the fetch runs after the first commit, so an initial 'idle' painted
 * the terminal "not kept" notice for one frame on a file that was about to load. Effect
 * timing makes that invisible to a rendered assertion, so the decision is pinned directly.
 */
describe('what the preview shows before anything is fetched', () => {
  const load = async (): Promise<Blob> => new Blob(['x']);

  it('starts loading for a kept file that can be fetched', () => {
    expect(initialPreview({ kind: 'image', filename: 'a.png', assetId: 'a1' }, load))
      .toEqual({ status: 'loading' });
  });

  it('stays idle when nothing can fetch it, which is what "not kept" means', () => {
    expect(initialPreview({ kind: 'image', filename: 'a.png', assetId: 'a1' }, undefined))
      .toEqual({ status: 'idle' });
    expect(initialPreview({ kind: 'image', filename: 'a.png' }, load))
      .toEqual({ status: 'idle' });
  });

  it('stays idle for a file still in memory, which never consults it', () => {
    expect(initialPreview({ kind: 'image', filename: 'a.png', dataUrl: 'data:,' }, load))
      .toEqual({ status: 'idle' });
    expect(initialPreview({ kind: 'document', filename: 'b.md', text: '# hi' }, load))
      .toEqual({ status: 'idle' });
  });
});
