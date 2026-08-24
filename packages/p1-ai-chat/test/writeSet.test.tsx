import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentChat } from '../src/hooks/useAgentChat.js';
import {
  EMPTY_STATE,
  addToWriteSet,
  forgetWriteSet,
  removeFromWriteSet,
  visitPage,
} from '../src/lib/session/chatState.js';
import type { ChatContext } from '../src/types.js';
import { MockWebSocket, baseContext } from './testSupport.js';

describe('write set transitions', () => {
  it('grants the open page, in the form the agent stores paths in', () => {
    expect(visitPage(EMPTY_STATE, '/about').writeSet).toEqual(['about']);
  });

  it('keeps the home page, whose path really is "/"', () => {
    expect(visitPage(EMPTY_STATE, '/').writeSet).toEqual(['/']);
  });

  it('grants nothing when no page is open', () => {
    expect(visitPage(EMPTY_STATE, '').writeSet).toBeNull();
  });

  it('adds a page without letting it appear twice', () => {
    const visited = visitPage(EMPTY_STATE, 'about');
    const added = addToWriteSet(visited, '/pricing');

    expect(added.writeSet).toEqual(['about', 'pricing']);
    expect(addToWriteSet(added, 'pricing')).toBe(added);
  });

  it('removes a page, and allows the set to end up empty', () => {
    const visited = visitPage(EMPTY_STATE, 'about');

    expect(removeFromWriteSet(visited, '/about').writeSet).toEqual([]);
  });

  it('forgets the set so the next conversation grants itself again', () => {
    const visited = visitPage(EMPTY_STATE, 'about');

    expect(forgetWriteSet(visited).writeSet).toBeNull();
  });

  it('returns the same state when the open page is already the granted one', () => {
    const visited = visitPage(EMPTY_STATE, 'about');

    expect(visitPage(visited, '/About')).toBe(visited);
  });
});

// A page is in the set for one of two reasons, and only one of them expires.
describe('what a visit takes back', () => {
  it('drops the page the last visit granted', () => {
    const zed = visitPage(EMPTY_STATE, 'zed');
    const a = visitPage(zed, 'a');

    expect(a.writeSet).toEqual(['a']);
    expect(visitPage(a, 'b').writeSet).toEqual(['b']);
  });

  it('keeps a page the user added, once they have moved on', () => {
    const a = visitPage(EMPTY_STATE, 'a');
    const withPricing = addToWriteSet(a, 'pricing');

    expect(visitPage(withPricing, 'b').writeSet).toEqual(['pricing', 'b']);
  });

  it('keeps a page the user added while standing on it', () => {
    const a = visitPage(EMPTY_STATE, 'a');
    const kept = addToWriteSet(a, 'a');

    expect(kept.autoWritePath).toBeNull();
    expect(visitPage(kept, 'b').writeSet).toEqual(['a', 'b']);
  });

  it('stops expiring a page it granted once the user removes and re-adds it', () => {
    const a = visitPage(EMPTY_STATE, 'a');
    const b = visitPage(a, 'b');
    const readded = addToWriteSet(b, 'a');

    expect(visitPage(readded, 'c').writeSet).toEqual(['a', 'c']);
  });

  it('has nothing to expire after the user removes the page it granted', () => {
    const a = visitPage(EMPTY_STATE, 'a');
    const pinned = addToWriteSet(a, 'pricing');
    const emptied = removeFromWriteSet(pinned, 'a');

    expect(emptied.autoWritePath).toBeNull();
    expect(visitPage(emptied, 'b').writeSet).toEqual(['pricing', 'b']);
  });
});

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// Sessions are cached module-level by agentId, so each test needs its own scope.
let scopeCounter = 0;

async function mount() {
  const agentId = `write-set-${++scopeCounter}`;
  const hook = renderHook(() =>
    useAgentChat({ agentUrl: 'http://agent.test', agentId, getContext: async () => baseContext }),
  );
  await act(async () => {
    MockWebSocket.instances[0].open();
  });
  const ws = (): MockWebSocket => MockWebSocket.instances[0];

  return {
    ...hook,
    ws,
    contexts: (): ChatContext[] =>
      ws()
        .sent.map(s => JSON.parse(s) as { type: string; context?: ChatContext })
        .filter(f => f.type === 'chat')
        .map(f => f.context as ChatContext),
    endTurn: async (): Promise<void> => {
      await act(async () => {
        ws().emit({ type: 'done' });
      });
    },
  };
}

describe('the write set a turn is sent with', () => {
  it('carries the pages the user has allowed', async () => {
    const panel = await mount();

    act(() => {
      panel.result.current.visitPage('/about');
      panel.result.current.addWritablePage('/pricing');
    });
    await act(async () => {
      await panel.result.current.sendMessage('tidy these up');
    });

    expect(panel.contexts()[0].writeSet).toEqual(['about', 'pricing']);
  });

  // Sending [] instead would tell the Worker "edit nothing" on the very first turn, when what
  // we mean is "we have not decided yet — fall back to the open document".
  it('is absent until a page has been opened', async () => {
    const panel = await mount();

    await act(async () => {
      await panel.result.current.sendMessage('change the heading');
    });

    expect('writeSet' in panel.contexts()[0]).toBe(false);
  });

  it('is sent empty once the user has removed every page', async () => {
    const panel = await mount();

    act(() => {
      panel.result.current.visitPage('/about');
      panel.result.current.removeWritablePage('/about');
    });
    await act(async () => {
      await panel.result.current.sendMessage('what is on this site?');
    });

    expect(panel.contexts()[0].writeSet).toEqual([]);
  });

  // A `fill-page` request points the turn at a page the conversation was not seeded on. The host
  // app naming the target is as explicit as the user adding it, and without this every edit the
  // turn was sent to make is refused.
  it('includes a page the turn was pointed at', async () => {
    const panel = await mount();

    act(() => {
      panel.result.current.visitPage('/about');
    });
    await act(async () => {
      await panel.result.current.sendMessage('fill this in', { documentPath: 'pricing' });
    });

    expect(panel.contexts()[0].writeSet).toEqual(['about', 'pricing']);
  });

  it('does not duplicate a target already in the set', async () => {
    const panel = await mount();

    act(() => {
      panel.result.current.visitPage('/about');
    });
    await act(async () => {
      await panel.result.current.sendMessage('fill this in', { documentPath: '/About' });
    });

    expect(panel.contexts()[0].writeSet).toEqual(['about']);
  });

  it('grows to include a page the agent created', async () => {
    const panel = await mount();

    act(() => {
      panel.result.current.visitPage('/about');
    });
    await act(async () => {
      await panel.result.current.sendMessage('add a pricing page');
    });
    await act(async () => {
      panel.ws().emit({
        type: 'tool_end',
        toolName: 'create_page',
        toolResult: { documentId: 'd2', documentPath: 'pricing' },
      });
    });
    await panel.endTurn();
    await act(async () => {
      await panel.result.current.sendMessage('now fill it in');
    });

    expect(panel.result.current.writeSet).toEqual(['about', 'pricing']);
    expect(panel.contexts()[1].writeSet).toEqual(['about', 'pricing']);
  });

  it('does not grow when the create failed', async () => {
    const panel = await mount();

    act(() => {
      panel.result.current.visitPage('/about');
    });
    await act(async () => {
      panel.ws().emit({
        type: 'tool_end',
        toolName: 'create_page',
        toolResult: { error: 'a page already exists at that path' },
      });
    });

    expect(panel.result.current.writeSet).toEqual(['about']);
  });

  // The pages were added for a conversation the user just threw away.
  it('is forgotten when the conversation is cleared', async () => {
    const panel = await mount();

    act(() => {
      panel.result.current.visitPage('/about');
      panel.result.current.addWritablePage('/pricing');
    });
    await act(async () => {
      panel.result.current.clearMessages();
    });

    expect(panel.result.current.writeSet).toBeNull();
  });
});
