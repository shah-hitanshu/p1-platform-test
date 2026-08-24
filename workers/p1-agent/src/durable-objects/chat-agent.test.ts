import { describe, it, expect, vi } from 'vitest';
import type { Connection, ConnectionContext } from 'agents';
import { ChatAgent, resolveFollowsTemplate } from './chat-agent.js';

describe('resolveFollowsTemplate', () => {
  const context = { siteId: 's1', documentPath: 'blog/hello' };

  it('reports the backend’s answer, not the browser’s', async () => {
    const api = { lookupDocumentByPath: vi.fn().mockResolvedValue({ templateId: 'tpl-1' }) };

    expect(await resolveFollowsTemplate(api, context, new Map())).toBe(true);
  });

  it('reports false for a document with no template', async () => {
    const api = { lookupDocumentByPath: vi.fn().mockResolvedValue({ id: 'd1' }) };

    expect(await resolveFollowsTemplate(api, context, new Map())).toBe(false);
  });

  // `templateId` is only accepted when a document is created, so neither answer goes stale.
  it('asks once per path', async () => {
    const api = { lookupDocumentByPath: vi.fn().mockResolvedValue({ templateId: 'tpl-1' }) };
    const cache = new Map<string, boolean>();

    await resolveFollowsTemplate(api, context, cache);
    await resolveFollowsTemplate(api, context, cache);
    await resolveFollowsTemplate(api, { ...context, documentPath: 'about' }, cache);

    expect(api.lookupDocumentByPath).toHaveBeenCalledTimes(2);
  });

  // Losing the note beats failing the turn — but a failure must not mute the note for the rest
  // of the conversation.
  it('degrades to false on a lookup failure, and does not cache it', async () => {
    const api = { lookupDocumentByPath: vi.fn().mockRejectedValue(new Error('offline')) };
    const cache = new Map<string, boolean>();

    expect(await resolveFollowsTemplate(api, context, cache)).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('does not call the backend without a document to look up', async () => {
    const api = { lookupDocumentByPath: vi.fn() };

    expect(await resolveFollowsTemplate(api, { siteId: 's1', documentPath: '' }, new Map())).toBe(false);
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
