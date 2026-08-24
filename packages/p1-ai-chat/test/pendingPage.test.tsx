import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentChat } from '../src/hooks/useAgentChat.js';
import { createdPagePath } from '../src/lib/session/chatSession.js';
import type { ChatContext } from '../src/types.js';
import { MockWebSocket, baseContext } from './testSupport.js';

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// Sessions are cached module-level by agentId, so each test needs its own scope or it
// reattaches to an earlier test's socket.
let scopeCounter = 0;

async function mount(onPageCreated?: (path: string) => void) {
  const agentId = `pending-${++scopeCounter}`;
  const hook = renderHook(() =>
    useAgentChat({
      agentUrl: 'http://agent.test',
      agentId,
      getContext: async () => baseContext,
      ...(onPageCreated ? { onPageCreated } : {}),
    }),
  );
  await act(async () => {
    MockWebSocket.instances[0].open();
  });
  const ws = (): MockWebSocket => MockWebSocket.instances[0];

  return {
    ...hook,
    ws,
    /** Contexts of the chat turns sent so far, in order. */
    contexts: (): ChatContext[] =>
      ws()
        .sent.map(s => JSON.parse(s) as { type: string; context?: ChatContext })
        .filter(f => f.type === 'chat')
        .map(f => f.context as ChatContext),
    /** End the turn in flight, so the next send is not swallowed by single-flight. */
    endTurn: async (): Promise<void> => {
      await act(async () => {
        ws().emit({ type: 'done' });
      });
    },
  };
}

describe('a page the agent has yet to create', () => {
  it('sends the page to create with the brief', async () => {
    const panel = await mount();

    await act(async () => {
      await panel.result.current.sendMessage('a blog post about caching', {
        pendingPage: { title: 'Caching', path: 'blog/caching' },
      });
    });

    expect(panel.contexts()[0].pendingPage).toEqual({ title: 'Caching', path: 'blog/caching' });
  });

  // The agent proposes a template and waits, so the answer arrives on a later turn — an
  // ordinary typed one, which carries no options of its own.
  it('keeps sending it on the turns that follow', async () => {
    const panel = await mount();

    await act(async () => {
      await panel.result.current.sendMessage('a blog post about caching', {
        pendingPage: { title: 'Caching', path: 'blog/caching' },
      });
    });
    await panel.endTurn();
    await act(async () => {
      await panel.result.current.sendMessage('yes, use that one');
    });

    expect(panel.contexts()[1].pendingPage).toEqual({ title: 'Caching', path: 'blog/caching' });
  });

  it('stops sending it once the page exists', async () => {
    const panel = await mount();

    await act(async () => {
      await panel.result.current.sendMessage('a blog post', {
        pendingPage: { title: 'Caching', path: 'blog/caching' },
      });
    });
    await act(async () => {
      panel.ws().emit({
        type: 'tool_end',
        toolName: 'create_page',
        toolResult: { documentId: 'd1', documentPath: 'blog/caching' },
      });
    });
    await panel.endTurn();
    await act(async () => {
      await panel.result.current.sendMessage('now add a summary');
    });

    expect('pendingPage' in panel.contexts()[1]).toBe(false);
  });

  it('carries nothing on an ordinary typed turn', async () => {
    const panel = await mount();

    await act(async () => {
      await panel.result.current.sendMessage('change the heading');
    });

    expect('pendingPage' in panel.contexts()[0]).toBe(false);
  });

  // The request for it was in the transcript that just went away.
  it('is dropped when the conversation is cleared', async () => {
    const panel = await mount();

    await act(async () => {
      await panel.result.current.sendMessage('a blog post', {
        pendingPage: { title: 'Caching', path: 'blog/caching' },
      });
    });
    await panel.endTurn();
    await act(async () => {
      panel.result.current.clearMessages();
    });
    await act(async () => {
      await panel.result.current.sendMessage('what can you do?');
    });

    expect('pendingPage' in panel.contexts()[1]).toBe(false);
  });
});

describe('opening the page the agent created', () => {
  it('reports the path it was created at', async () => {
    const onPageCreated = vi.fn();
    const panel = await mount(onPageCreated);

    await act(async () => {
      await panel.result.current.sendMessage('a blog post', {
        pendingPage: { title: 'Caching', path: 'blog/caching' },
      });
    });
    await act(async () => {
      panel.ws().emit({
        type: 'tool_end',
        toolName: 'create_page',
        toolResult: { documentId: 'd1', documentPath: 'blog/caching', versionId: 'v1' },
      });
    });

    expect(onPageCreated).toHaveBeenCalledExactlyOnceWith('blog/caching');
  });

  // A failed tool returns `{ error }` where the result would be, so there is nothing to open —
  // and the page still needs creating, so the pending page must survive.
  it('does not navigate when the create failed', async () => {
    const onPageCreated = vi.fn();
    const panel = await mount(onPageCreated);

    await act(async () => {
      await panel.result.current.sendMessage('a blog post', {
        pendingPage: { title: 'Caching', path: 'blog/caching' },
      });
    });
    await act(async () => {
      panel.ws().emit({
        type: 'tool_end',
        toolName: 'create_page',
        toolResult: { error: 'A page already exists at blog/caching' },
      });
    });
    await panel.endTurn();
    await act(async () => {
      await panel.result.current.sendMessage('try blog/caching-2');
    });

    expect(onPageCreated).not.toHaveBeenCalled();
    expect(panel.contexts()[1].pendingPage).toEqual({ title: 'Caching', path: 'blog/caching' });
  });

  // A turn that creates the page and then fails while filling it offers a retry. Re-seeding the
  // page it already created asks the agent to create a second one.
  it('does not ask again for a page the failed turn already created', async () => {
    const panel = await mount();

    await act(async () => {
      await panel.result.current.sendMessage('a blog post', {
        pendingPage: { title: 'Caching', path: 'blog/caching' },
      });
    });
    await act(async () => {
      panel.ws().emit({
        type: 'tool_end',
        toolName: 'create_page',
        toolResult: { documentId: 'd1', documentPath: 'blog/caching' },
      });
      panel.ws().emit({ type: 'error', error: 'applying the edits failed' });
    });
    await act(async () => {
      panel.result.current.retry();
    });

    expect('pendingPage' in panel.contexts()[1]).toBe(false);
  });

  // The paired half of the test above: a resend drops the page it seeded, but the note saying
  // where the brief came from describes the turn, so it has to come back with it.
  it('keeps the brief attributed to the dialog when a failed turn is retried', async () => {
    const panel = await mount();
    const origin = { source: 'create-page' as const, page: { title: 'Caching', path: 'blog/caching' } };

    await act(async () => {
      await panel.result.current.sendMessage('a blog post', {
        pendingPage: { title: 'Caching', path: 'blog/caching' },
        origin,
      });
    });
    await act(async () => {
      panel.ws().emit({ type: 'error', error: 'applying the edits failed' });
    });
    await act(async () => {
      panel.result.current.retry();
    });

    expect(panel.result.current.messages[0].origin).toEqual(origin);
  });

  it('ignores the other tools a turn calls', async () => {
    const onPageCreated = vi.fn();
    const panel = await mount(onPageCreated);

    await act(async () => {
      await panel.result.current.sendMessage('a blog post');
    });
    await act(async () => {
      panel.ws().emit({
        type: 'tool_end',
        toolName: 'apply_document_edits',
        toolResult: { documentPath: 'blog/caching', operationsApplied: 3 },
      });
    });

    expect(onPageCreated).not.toHaveBeenCalled();
  });
});

describe('createdPagePath', () => {
  it('reads the path out of a successful create', () => {
    expect(createdPagePath({ documentId: 'd1', documentPath: 'about' })).toBe('about');
  });

  it('rejects a result that also carries an error', () => {
    expect(createdPagePath({ documentPath: 'about', error: 'partly failed' })).toBeNull();
  });

  it('rejects a blank or missing path', () => {
    expect(createdPagePath({ documentPath: '  ' })).toBeNull();
    expect(createdPagePath({ documentId: 'd1' })).toBeNull();
    expect(createdPagePath(null)).toBeNull();
    expect(createdPagePath('about')).toBeNull();
  });
});
