import { describe, it, expect, vi, afterEach } from 'vitest';
import { contentTypeFor } from '../src/lib/attachments/contentType.js';
import {
  presignAndPut,
  finalizeChatUpload,
  isKeptAttachmentInLibrary,
} from '../src/lib/attachments/mediaApi.js';

const target = { workerUrl: 'https://media.example.com', siteId: 'site-1', token: 'tok' };

function fileFacts(name: string, type: string) {
  return { name, type, size: 10 };
}

afterEach(() => vi.restoreAllMocks());

describe('contentTypeFor', () => {
  // The two cases that make `file.type` unusable on its own.
  it('names a .md that the browser reported no type for', () => {
    expect(contentTypeFor(fileFacts('brief.md', ''))).toBe('text/markdown');
  });

  it('names a .csv that Windows reported as a spreadsheet', () => {
    expect(contentTypeFor(fileFacts('rows.csv', 'application/vnd.ms-excel'))).toBe('text/csv');
  });

  it('does not mistake .markdown for .md, or read past a double extension', () => {
    expect(contentTypeFor(fileFacts('notes.markdown', ''))).toBe('text/markdown');
    expect(contentTypeFor(fileFacts('archive.md.txt', ''))).toBe('text/plain');
  });

  it('trusts an image type, matching how the file was classed an image in the first place', () => {
    expect(contentTypeFor(fileFacts('shot.PNG', 'image/png'))).toBe('image/png');
  });

  it('falls back to plain text rather than guessing', () => {
    expect(contentTypeFor(fileFacts('README', ''))).toBe('text/plain');
  });
});

describe('presignAndPut', () => {
  /**
   * The upload URL is signed over the declared content type, so a mismatch between the two
   * legs is rejected on the signature with nothing useful in the response. One derivation
   * feeding both is the only thing that makes that impossible.
   */
  it('declares the same content type to presign and to storage', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        assetId: 'a1', versionId: 'v1', filename: 'brief.md', uploadUrl: 'https://r2.example.com/put',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['hello'], 'brief.md', { type: '' });
    await presignAndPut(target, file);

    const presignBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { contentType: string };
    const putHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>;
    expect(presignBody.contentType).toBe('text/markdown');
    expect(putHeaders['Content-Type']).toBe(presignBody.contentType);
  });

  it('marks the upload as coming from the chat, which is what keeps it out of the library', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        assetId: 'a1', versionId: 'v1', filename: 'brief.md', uploadUrl: 'https://r2.example.com/put',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await presignAndPut(target, new File(['x'], 'brief.md', { type: '' }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { origin: string };
    expect(body.origin).toBe('chat');
  });

  it('throws without sending bytes when the reservation is refused', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('no', { status: 415 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(presignAndPut(target, new File(['x'], 'x.md', { type: '' }))).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('finalizeChatUpload', () => {
  it('records the reserved ids and returns the asset id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const assetId = await finalizeChatUpload(target, { assetId: 'a1', versionId: 'v1', filename: 'brief.md' });

    expect(assetId).toBe('a1');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, string>;
    expect(body).toMatchObject({ assetId: 'a1', versionId: 'v1', filename: 'brief.md', origin: 'chat' });
  });
});

describe('isKeptAttachmentInLibrary', () => {
  it('reads a library asset off the absent origin, and a chat one off its presence', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ assetId: 'a1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ assetId: 'a1', origin: 'chat' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await isKeptAttachmentInLibrary(target, 'a1')).toBe(true);
    expect(await isKeptAttachmentInLibrary(target, 'a1')).toBe(false);
  });

  // Absent `origin` is what means "in the library", so anything that is not an asset reads
  // as a yes by default — and a yes hides the only route the image has back into the library.
  it('refuses to read a library answer out of a body that is not an asset', async () => {
    for (const body of ['[]', '"nope"', 'null']) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
      await expect(isKeptAttachmentInLibrary(target, 'a1')).rejects.toThrow(/other than an asset/);
    }
  });

  // 404 is the library saying it does not hold this, which is exactly what a deletion
  // leaves behind. Reading it as a missing file would strike the image from the transcript.
  it('reports not-in-library, rather than throwing, for an asset the library deleted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"Not found"}', { status: 404 })));

    await expect(isKeptAttachmentInLibrary(target, 'a1')).resolves.toBe(false);
  });
});
