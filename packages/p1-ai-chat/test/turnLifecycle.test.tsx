import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentChat } from '../src/hooks/useAgentChat.js';
import { MockWebSocket, baseContext } from './testSupport.js';

/**
 * How a turn ends: stopped, cleared, dropped, or gone quiet.
 *
 * Each of these used to leave the panel wedged in some way, because ending a turn means
 * resetting four things at once (loading, the assistant id, the open text part, the
 * watchdog) and each path reset a different subset.
 */

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Sessions are cached module-level by agentId, so each test needs its own scope.
let scopeCounter = 0;

async function mount() {
  const agentId = `turn-scope-${++scopeCounter}`;
  const getContext = vi.fn(async () => baseContext);
  const hook = renderHook(() => useAgentChat({ agentUrl: 'http://agent.test', agentId, getContext }));
  await act(async () => { MockWebSocket.instances[0].open(); });
  return {
    ...hook,
    agentId,
    getContext,
    ws: () => MockWebSocket.instances[MockWebSocket.instances.length - 1],
    assistant: () => hook.result.current.messages.filter(m => m.role === 'assistant').at(-1),
  };
}

async function mountMidTurn() {
  const h = await mount();
  await act(async () => { await h.result.current.sendMessage('build a pricing page'); });
  await act(async () => { h.ws().emit({ type: 'token', content: 'Working on it.' }); });
  return h;
}

describe('stop', () => {
  it('ends the turn immediately and tells the agent to stand down', async () => {
    const { result, ws, assistant } = await mountMidTurn();

    await act(async () => { result.current.stop(); });

    expect(result.current.isLoading).toBe(false);
    expect(assistant()?.stopped).toBe(true);
    expect(assistant()?.isStreaming).toBe(false);
    expect(ws().frames().some(f => f.type === 'cancel')).toBe(true);
  });

  it('keeps what already streamed', async () => {
    const { result, assistant } = await mountMidTurn();

    await act(async () => { result.current.stop(); });

    expect(assistant()?.content).toBe('Working on it.');
  });

  // Tokens still in flight when Stop was pressed must not reopen a turn that has ended.
  it('ignores frames that arrive after stopping', async () => {
    const { result, ws, assistant } = await mountMidTurn();

    await act(async () => { result.current.stop(); });
    await act(async () => {
      ws().emit({ type: 'token', content: ' more text' });
      ws().emit({ type: 'done' });
    });

    expect(assistant()?.content).toBe('Working on it.');
    expect(result.current.isLoading).toBe(false);
  });

  it('does nothing when no turn is running', async () => {
    const { result, ws } = await mount();

    await act(async () => { result.current.stop(); });

    expect(ws().frames().some(f => f.type === 'cancel')).toBe(false);
  });

  // The agent only notices a cancel between tool calls, so its acknowledgement can arrive
  // seconds later — by which time the user may have sent something else. That late frame
  // belongs to the turn that was stopped, not to the one now running.
  it('does not let a late cancel acknowledgement kill the next turn', async () => {
    const { result, ws, assistant } = await mountMidTurn();
    const stoppedTurnId = assistant()?.id;

    await act(async () => { result.current.stop(); });
    await act(async () => { await result.current.sendMessage('second request'); });
    expect(result.current.isLoading).toBe(true);

    // The acknowledgement for the *first* turn finally lands.
    await act(async () => { ws().emit({ type: 'cancelled', turnId: stoppedTurnId }); });

    expect(result.current.isLoading).toBe(true);
    expect(assistant()?.stopped).toBeUndefined();
  });

  it('does not let a late done from a stopped turn end the next one', async () => {
    const { result, ws, assistant } = await mountMidTurn();
    const stoppedTurnId = assistant()?.id;

    await act(async () => { result.current.stop(); });
    await act(async () => { await result.current.sendMessage('second request'); });
    await act(async () => {
      ws().emit({ type: 'token', content: 'stale ', turnId: stoppedTurnId });
      ws().emit({ type: 'done', turnId: stoppedTurnId });
    });

    expect(result.current.isLoading).toBe(true);
    // The stale text must not land in the new turn either.
    expect(assistant()?.content).toBe('');
  });
});

describe('clear', () => {
  // The freeze: the transcript emptied but the turn kept running, so the composer stayed
  // disabled and streamed tokens were written to a message that no longer existed.
  it('does not leave the panel loading when clearing mid-stream', async () => {
    const { result } = await mountMidTurn();

    await act(async () => { result.current.clearMessages(); });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('cancels the running turn so the agent stops editing the page', async () => {
    const { result, ws } = await mountMidTurn();

    await act(async () => { result.current.clearMessages(); });

    const frames = ws().frames().map(f => f.type);
    expect(frames).toContain('cancel');
    expect(frames).toContain('clear');
  });

  it('leaves a cleared transcript empty when late frames arrive', async () => {
    const { result, ws } = await mountMidTurn();

    await act(async () => { result.current.clearMessages(); });
    await act(async () => {
      ws().emit({ type: 'token', content: 'orphaned' });
      ws().emit({ type: 'done' });
    });

    expect(result.current.messages).toEqual([]);
  });
});

describe('retry', () => {
  it('offers a retry after a failed turn and resends the same brief', async () => {
    const { result, ws } = await mountMidTurn();

    await act(async () => { ws().emit({ type: 'error', error: 'Rate limit reached' }); });
    expect(result.current.canRetry).toBe(true);

    await act(async () => { result.current.retry(); });

    // The failed exchange is replaced rather than stacked under a dead one.
    expect(result.current.messages.filter(m => m.role === 'user')).toHaveLength(1);
    expect(result.current.messages[0].content).toBe('build a pricing page');
    const chats = ws().sent.map(s => JSON.parse(s) as { type: string; message?: string })
      .filter(f => f.type === 'chat');
    expect(chats).toHaveLength(2);
    expect(chats[1].message).toBe('build a pricing page');
  });

  it('withdraws the offer once the retry itself succeeds', async () => {
    const { result, ws } = await mountMidTurn();

    await act(async () => { ws().emit({ type: 'error', error: 'boom' }); });
    expect(result.current.canRetry).toBe(true);

    await act(async () => { result.current.retry(); });
    await act(async () => { ws().emit({ type: 'done' }); });

    expect(result.current.canRetry).toBe(false);
  });

  it('offers a retry when the connection drops mid-turn', async () => {
    const { result, ws } = await mountMidTurn();

    await act(async () => { ws().close(); });

    expect(result.current.canRetry).toBe(true);
  });

  // The offer must also be withdrawn by an unrelated next turn, not only by taking it —
  // otherwise "Try again" ends up pointing at the exchange that succeeded.
  it('withdraws the offer when a different turn succeeds, keeping that exchange', async () => {
    const { result, ws } = await mountMidTurn();

    await act(async () => { ws().emit({ type: 'error', error: 'Rate limit reached' }); });
    expect(result.current.canRetry).toBe(true);

    await act(async () => { await result.current.sendMessage('something else'); });
    await act(async () => { ws().emit({ type: 'done' }); });

    expect(result.current.canRetry).toBe(false);
    expect(result.current.messages.filter(m => m.role === 'user').map(m => m.content))
      .toEqual(['build a pricing page', 'something else']);
  });

  it('does nothing when nothing failed', async () => {
    const { result, ws } = await mount();

    await act(async () => { result.current.retry(); });

    expect(ws().frames().some(f => f.type === 'chat')).toBe(false);
  });
});

describe('reconnect', () => {
  // Nothing else calls connect() while the panel stays mounted, so without this a single
  // blip left the panel permanently unready — and a seeded draft gated on `ready` could
  // never fire again.
  it('reconnects after an unexpected close', async () => {
    vi.useFakeTimers();
    const { result, ws } = await mount();
    expect(result.current.ready).toBe(true);

    await act(async () => { ws().close(); });
    expect(result.current.ready).toBe(false);
    expect(result.current.reconnecting).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(MockWebSocket.instances).toHaveLength(2);

    await act(async () => { MockWebSocket.instances[1].open(); });
    expect(result.current.ready).toBe(true);
    expect(result.current.reconnecting).toBe(false);
  });

  it('backs off between attempts rather than hammering a worker that is down', async () => {
    vi.useFakeTimers();
    const { ws } = await mount();

    await act(async () => { ws().close(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(MockWebSocket.instances).toHaveLength(2);

    // Second failure waits longer than the first.
    await act(async () => { MockWebSocket.instances[1].close(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(MockWebSocket.instances).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('stops reconnecting once the panel detaches', async () => {
    vi.useFakeTimers();
    const { ws, unmount } = await mount();

    await act(async () => { ws().close(); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe('silence watchdog', () => {
  // A worker that dies mid-turn leaves the socket open and simply stops sending. Without a
  // ceiling the composer stayed disabled forever, and the session leaked too, since
  // reaping is deferred for as long as a turn looks live.
  it('ends a turn the agent has abandoned', async () => {
    vi.useFakeTimers();
    const { result, ws } = await mount();
    await act(async () => { await result.current.sendMessage('go'); });

    await act(async () => { await vi.advanceTimersByTimeAsync(120_001); });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.messages.at(-1)?.error).toBe('The agent stopped responding');
    expect(result.current.canRetry).toBe(true);
    expect(ws().frames().some(f => f.type === 'cancel')).toBe(true);
  });

  it('measures silence, not turn length, so a long stream is not killed', async () => {
    vi.useFakeTimers();
    const { result, ws } = await mount();
    await act(async () => { await result.current.sendMessage('go'); });

    // Frames keep arriving well past the timeout, but never with a long enough gap.
    for (let i = 0; i < 4; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      await act(async () => { ws().emit({ type: 'token', content: 'tick ' }); });
    }

    expect(result.current.isLoading).toBe(true);
    expect(result.current.messages.at(-1)?.error).toBeUndefined();
  });

  it('disarms once the turn ends', async () => {
    vi.useFakeTimers();
    const { result, ws } = await mount();
    await act(async () => { await result.current.sendMessage('go'); });
    await act(async () => { ws().emit({ type: 'done' }); });

    await act(async () => { await vi.advanceTimersByTimeAsync(120_001); });

    expect(result.current.messages.at(-1)?.error).toBeUndefined();
  });
});

describe('composer draft', () => {
  // The session store exists because Puck remounts plugin panels while a page hydrates.
  // The draft was the one piece of panel state still left outside it.
  it('survives a remount of the panel', async () => {
    const { result, agentId, getContext, unmount } = await mount();

    await act(async () => { result.current.setInput('half-written brief'); });
    unmount();

    const remounted = renderHook(() =>
      useAgentChat({ agentUrl: 'http://agent.test', agentId, getContext }),
    );
    expect(remounted.result.current.input).toBe('half-written brief');
  });

  it('clears on send', async () => {
    const { result } = await mount();

    await act(async () => { result.current.setInput('build it'); });
    await act(async () => { result.current.submit(); });

    expect(result.current.input).toBe('');
    expect(result.current.messages[0].content).toBe('build it');
  });

  it('keeps the draft when a send is refused because a turn is running', async () => {
    const { result } = await mountMidTurn();

    await act(async () => { result.current.setInput('follow-up while streaming'); });
    await act(async () => { result.current.submit(); });

    expect(result.current.input).toBe('follow-up while streaming');
  });
});

describe('the setup window', () => {
  /**
   * A send suspends while auth resolves, and Stop stays live throughout (it only needs
   * `isLoading`). Nothing used to re-check on the far side of that await, so the frame went
   * out anyway: the agent ran the whole turn and edited the document while every frame it
   * echoed was discarded as stale — the page changed with nothing on screen to say so.
   */
  async function mountWithDeferredAuth() {
    const agentId = `setup-scope-${++scopeCounter}`;
    let release!: (ctx: typeof baseContext) => void;
    const gate = new Promise<typeof baseContext>(resolve => { release = resolve; });
    const getContext = vi.fn(() => gate);
    const hook = renderHook(() => useAgentChat({ agentUrl: 'http://agent.test', agentId, getContext }));
    await act(async () => { MockWebSocket.instances[0].open(); });
    return { ...hook, release, ws: () => MockWebSocket.instances[0] };
  }

  it('does not send a turn that was stopped while auth was still resolving', async () => {
    const { result, release, ws } = await mountWithDeferredAuth();

    void result.current.sendMessage('add a pricing section');
    await act(async () => {});
    expect(result.current.isLoading).toBe(true);

    await act(async () => { result.current.stop(); });
    // Auth finally resolves, long after the turn was abandoned.
    await act(async () => { release(baseContext); });

    expect(result.current.isLoading).toBe(false);
    expect(ws().frames().filter(f => f.type === 'chat')).toHaveLength(0);
  });

  it('does not let two sends both reach the agent across that window', async () => {
    const { result, release, ws } = await mountWithDeferredAuth();

    void result.current.sendMessage('first');
    await act(async () => {});
    // Stop clears isLoading, so the single-flight guard no longer blocks a second send
    // while the first is still suspended.
    await act(async () => { result.current.stop(); });
    void result.current.sendMessage('second');
    await act(async () => { release(baseContext); });

    const chats = ws().sent.map(s => JSON.parse(s) as { type: string; message?: string })
      .filter(f => f.type === 'chat');
    expect(chats).toHaveLength(1);
    expect(chats[0].message).toBe('second');
  });
});

describe('connection-scoped errors', () => {
  /**
   * The agent sends some errors untagged by design — a rejected get_history/clear, an
   * unparseable frame — because they arrive outside any turn. Attributing those to the turn
   * in flight killed it: a Clear with an expired token stamped its auth error onto the
   * streaming message and orphaned the real turn, which kept editing the page.
   */
  it('leaves the streaming turn alone', async () => {
    const { result, ws, assistant } = await mountMidTurn();

    await act(async () => {
      ws().emit({ type: 'error', error: 'Authentication failed', scope: 'connection' });
    });

    expect(result.current.isLoading).toBe(true);
    expect(assistant()?.error).toBeUndefined();
    expect(assistant()?.isStreaming).toBe(true);

    // ...and the turn still completes normally afterwards.
    await act(async () => { ws().emit({ type: 'done' }); });
    expect(result.current.isLoading).toBe(false);
    expect(assistant()?.error).toBeUndefined();
  });

  it('still ends the turn for an ordinary turn error', async () => {
    const { result, ws, assistant } = await mountMidTurn();

    await act(async () => { ws().emit({ type: 'error', error: 'Rate limit reached' }); });

    expect(result.current.isLoading).toBe(false);
    expect(assistant()?.error).toBe('Rate limit reached');
  });
});

describe('abandoned tool calls', () => {
  it('stops rendering a call as in-flight once the turn ends', async () => {
    const { result, ws, assistant } = await mountMidTurn();

    await act(async () => {
      ws().emit({ type: 'tool_start', toolCallId: 'c1', toolName: 'apply_document_edits' });
      ws().emit({ type: 'tool_start', toolCallId: 'c2', toolName: 'complete_edit_session' });
      ws().emit({ type: 'tool_end', toolCallId: 'c1', toolName: 'apply_document_edits', toolResult: { success: true } });
    });

    await act(async () => { result.current.stop(); });

    // c1 finished; c2 never reported back and must not be left spinning.
    expect(assistant()?.toolCalls?.map(tc => tc.status)).toEqual(['done', 'abandoned']);
  });
});
