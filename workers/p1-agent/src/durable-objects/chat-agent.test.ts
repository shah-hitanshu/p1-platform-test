import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Connection, ConnectionContext } from 'agents';
import { ChatAgent, resolvePinnedSlots } from './chat-agent.js';

describe('resolvePinnedSlots', () => {
  const context = { siteId: 's1', branchId: 'b1', documentPath: 'blog/hello' };
  const pinnedTemplate = { content: [{ type: 'HeadingBlock', props: { id: 'hero' } }], root: { props: { _pinMap: { hero: true } } } };

  const lookup = (templateId: string | undefined, template: unknown = pinnedTemplate) => ({
    lookupDocumentByPath: vi.fn().mockResolvedValue(templateId === undefined ? { id: 'd1' } : { templateId }),
    getTemplate: vi.fn().mockResolvedValue(template),
  });

  it('reports the slots the template pins', async () => {
    expect(await resolvePinnedSlots(lookup('tpl-1'), context, new Map())).toEqual(['hero']);
  });

  it('reports none for a document with no template', async () => {
    const api = lookup(undefined);

    expect(await resolvePinnedSlots(api, context, new Map())).toEqual([]);
    expect(api.getTemplate).not.toHaveBeenCalled();
  });

  it('reports none for a template that pins nothing', async () => {
    const api = lookup('tpl-1', { content: [{ type: 'HeadingBlock', props: { id: 'hero' } }], root: { props: { _pinMap: { hero: false } } } });

    expect(await resolvePinnedSlots(api, context, new Map())).toEqual([]);
  });

  // `templateId` is only accepted when a document is created, so the linkage cannot go stale.
  it('looks the document up once per path', async () => {
    const api = lookup('tpl-1');
    const cache = new Map<string, string | null>();

    await resolvePinnedSlots(api, context, cache);
    await resolvePinnedSlots(api, context, cache);
    await resolvePinnedSlots(api, { ...context, documentPath: 'about' }, cache);

    expect(api.lookupDocumentByPath).toHaveBeenCalledTimes(2);
  });

  // A slot can be pinned or unpinned from the editor while the conversation is open, so the
  // answer the note depends on is read again every turn.
  it('re-reads the template on every turn', async () => {
    const api = lookup('tpl-1');
    const cache = new Map<string, string | null>();

    await resolvePinnedSlots(api, context, cache);
    await resolvePinnedSlots(api, context, cache);

    expect(api.getTemplate).toHaveBeenCalledTimes(2);
  });

  // Losing the note beats failing the turn — and a page whose template cannot be read is one
  // the editor leaves unlocked too.
  it('degrades to none when the template cannot be read', async () => {
    const api = {
      lookupDocumentByPath: vi.fn().mockResolvedValue({ templateId: 'tpl-1' }),
      getTemplate: vi.fn().mockRejectedValue(new Error('offline')),
    };

    expect(await resolvePinnedSlots(api, context, new Map())).toEqual([]);
  });

  it('degrades to none on a lookup failure, and does not cache it', async () => {
    const api = {
      lookupDocumentByPath: vi.fn().mockRejectedValue(new Error('offline')),
      getTemplate: vi.fn(),
    };
    const cache = new Map<string, string | null>();

    expect(await resolvePinnedSlots(api, context, cache)).toEqual([]);
    expect(cache.size).toBe(0);
  });

  it('does not call the backend without a document to look up', async () => {
    const api = lookup('tpl-1');

    expect(await resolvePinnedSlots(api, { ...context, documentPath: '' }, new Map())).toEqual([]);
    expect(api.lookupDocumentByPath).not.toHaveBeenCalled();
  });
});

describe('ChatAgent state protocol', () => {
  // On the prototype: constructing the agent needs a live Durable Object.
  const connection = { id: 'c1' } as unknown as Connection;

  it('sends no protocol messages, which would carry state to an unauthorized connection', () => {
    expect(ChatAgent.prototype.shouldSendProtocolMessages(connection, {} as ConnectionContext)).toBe(false);
  });

  it('rejects a state update originating from a client', () => {
    expect(() => ChatAgent.prototype.validateStateChange({ conversationHistory: [] }, connection)).toThrow();
  });

  it("accepts the agent's own state update", () => {
    expect(() => ChatAgent.prototype.validateStateChange({ conversationHistory: [] }, 'server')).not.toThrow();
  });
});

// Clearing a conversation deletes the files it carried. Nothing awaits this, and a
// failure is swallowed by design — so without a test the whole path is unobserved.
describe('purging a cleared conversation s uploads', () => {
  type Purge = (siteId: string, token: string, assetIds: string[]) => Promise<void>;
  const purge = (ChatAgent.prototype as unknown as { purgeUploads: Purge }).purgeUploads;
  const withEnv = (fetchMock: ReturnType<typeof vi.fn>) => {
    vi.stubGlobal('fetch', fetchMock);
    return { env: { MEDIA_WORKER_URL: 'https://media.test' } };
  };

  afterEach(() => vi.unstubAllGlobals());

  it('deletes each file, scoped to the site and authorised as the user', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await purge.call(withEnv(fetchMock), 'site-1', 'tok-1', ['a1', 'a2']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = new URL(String(fetchMock.mock.calls[0][0]));
    expect(first.pathname).toBe('/media/a1/chat');
    expect(first.searchParams.get('siteId')).toBe('site-1');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-1');
  });

  // Without the narrowing this route is the picker's own delete, and an image the user
  // added to their media library would be taken out of it by clearing an unrelated chat.
  // A path, not a query flag: a media worker that does not know this route 404s, where an
  // unknown parameter would have been ignored and the delete widened to the whole asset.
  it('asks only for chat uploads, so a promoted image is out of reach', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await purge.call(withEnv(fetchMock), 'site-1', 'tok-1', ['a1']);

    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requested.pathname.endsWith('/chat')).toBe(true);
    // The unscoped delete is a different path; this must never fall back to it.
    expect(requested.pathname).not.toBe('/media/a1');
  });

  // The user asked for the conversation to go, and it already has. Storage catching up
  // is not their problem, and retention collects anything missed here regardless.
  it('resolves even when every delete fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('unreachable'));
    await expect(purge.call(withEnv(fetchMock), 'site-1', 'tok-1', ['a1'])).resolves.toBeUndefined();
  });

  it('keeps going after one file fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('no', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await purge.call(withEnv(fetchMock), 'site-1', 'tok-1', ['a1', 'a2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('escapes ids and site ids into the path and query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await purge.call(withEnv(fetchMock), 'site/one', 'tok', ['a/b']);
    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).toContain('/media/a%2Fb/chat');
    expect(requested).toContain('siteId=site%2Fone');
  });
});
