import { describe, it, expect, vi } from 'vitest';
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
