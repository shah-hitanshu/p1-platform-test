import { describe, it, expect } from 'vitest';
import {
  EMPTY_STATE,
  appendToken,
  beginTurn,
  clearTranscript,
  completeToolCall,
  endTurn,
  markDisconnected,
  restoreHistory,
  startToolCall,
  type ChatSessionState,
} from '../src/chatState.js';
import type { ChatMessage } from '../src/types.js';

const withMessages = (...messages: ChatMessage[]): ChatSessionState => ({
  ...EMPTY_STATE,
  messages,
});

const assistant = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  content: '',
  isStreaming: true,
  ...over,
});

describe('restoreHistory', () => {
  it('applies replayed history to an empty conversation', () => {
    const next = restoreHistory(EMPTY_STATE, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);

    expect(next.messages.map(m => [m.role, m.content])).toEqual([
      ['user', 'hi'],
      ['assistant', 'hello'],
    ]);
  });

  // A mid-session reconnect must not wipe what the user is looking at.
  it('leaves a live conversation untouched', () => {
    const live = withMessages(assistant('a', { content: 'in progress' }));

    const next = restoreHistory(live, [{ role: 'user', content: 'old' }]);

    // Messages are kept as-is; only `historyLoaded` settles, which flips on the frame
    // arriving rather than on it having been applied.
    expect(next.messages).toBe(live.messages);
    expect(next.historyLoaded).toBe(true);
  });

  it('marks restored tool calls as already finished', () => {
    const next = restoreHistory(EMPTY_STATE, [
      { role: 'assistant', content: 'done', toolCalls: [{ name: 'get_document', result: { ok: true } }] },
    ]);

    expect(next.messages[0]?.toolCalls?.[0]?.status).toBe('done');
  });

  it('keeps a replayed turn in the order it happened', () => {
    const next = restoreHistory(EMPTY_STATE, [
      { role: 'user', content: 'build it' },
      {
        role: 'assistant',
        content: "I'll read the page.\n\nThat page is empty.",
        parts: [
          { type: 'text', text: "I'll read the page." },
          { type: 'tool', tool: { name: 'get_document', result: { ok: true } } },
          { type: 'text', text: 'That page is empty.' },
        ],
      },
    ]);

    expect(next.messages[1]?.parts?.map(p => (p.type === 'text' ? p.text : `tool:${p.tool.name}`))).toEqual([
      "I'll read the page.",
      'tool:get_document',
      'That page is empty.',
    ]);
    expect(next.messages[1]?.parts?.every(p => p.type !== 'tool' || p.tool.status === 'done')).toBe(true);
  });

  // Each part needs its own id or React remounts them as the list is keyed by position.
  it('gives every restored text part a distinct id', () => {
    const next = restoreHistory(EMPTY_STATE, [
      {
        role: 'assistant',
        content: 'one\n\ntwo',
        parts: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }],
      },
    ]);

    const ids = next.messages[0]?.parts?.filter(p => p.type === 'text').map(p => (p as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
  });

  it('falls back to the flat call list when no parts are sent', () => {
    const next = restoreHistory(EMPTY_STATE, [
      { role: 'assistant', content: 'done', toolCalls: [{ name: 'get_document' }] },
    ]);

    expect(next.messages[0]?.parts).toBeUndefined();
    expect(next.messages[0]?.toolCalls).toHaveLength(1);
  });
});

describe('beginTurn', () => {
  it('appends the user message and the assistant message its reply streams into', () => {
    const next = beginTurn(EMPTY_STATE, 'build a pricing page', 'assist-1');

    expect(next.isLoading).toBe(true);
    expect(next.messages).toHaveLength(2);
    expect(next.messages[0]).toMatchObject({ role: 'user', content: 'build a pricing page' });
    expect(next.messages[1]).toMatchObject({ id: 'assist-1', role: 'assistant', content: '', isStreaming: true });
  });
});

describe('appendToken', () => {
  it('accumulates streamed chunks on the target message only', () => {
    const state = withMessages(assistant('a'), assistant('b'));

    const next = appendToken(appendToken(state, 'a', 'p1', 'Hel'), 'a', 'p1', 'lo');

    expect(next.messages[0]?.content).toBe('Hello');
    expect(next.messages[1]?.content).toBe('');
    // Both deltas land in the one open text part rather than opening a second.
    expect(next.messages[0]?.parts).toEqual([{ type: 'text', id: 'p1', text: 'Hello' }]);
  });
});

describe('endTurn', () => {
  it('stops streaming and clears loading on success, attaching no error', () => {
    const state = { ...withMessages(assistant('a', { content: 'done' })), isLoading: true };

    const next = endTurn(state, 'a');

    expect(next.isLoading).toBe(false);
    expect(next.messages[0]?.isStreaming).toBe(false);
    expect(next.messages[0]?.error).toBeUndefined();
  });

  it('records the reason when the turn failed', () => {
    const state = { ...withMessages(assistant('a')), isLoading: true };

    const next = endTurn(state, 'a', { error: 'Rate limit reached' });

    expect(next.messages[0]).toMatchObject({ isStreaming: false, error: 'Rate limit reached' });
  });

  // 'done' can arrive with no assistant message in flight, e.g. after a clear.
  it('still clears loading when no turn was in flight', () => {
    const state = { ...EMPTY_STATE, isLoading: true };

    expect(endTurn(state, null)).toEqual({ ...EMPTY_STATE, isLoading: false });
  });
});

describe('markDisconnected', () => {
  // Previously ready/messages/isLoading were set in three separate updates, so
  // subscribers could observe ready:false while isLoading was still true.
  it('drops readiness, ends the turn, and flags the message in one state', () => {
    const state = { ...withMessages(assistant('a')), isLoading: true, ready: true };

    const next = markDisconnected(state, 'a', null);

    expect(next).toMatchObject({ ready: false, isLoading: false });
    expect(next.messages[0]).toMatchObject({ isStreaming: false, error: 'Connection lost' });
  });

  it('keeps the brief that was in flight, so "Try again" has something to resend', () => {
    const state = { ...withMessages(assistant('a')), isLoading: true, ready: true };

    const next = markDisconnected(state, 'a', { text: 'build me a pricing page' });

    expect(next.retry).toEqual({ text: 'build me a pricing page' });
  });

  it('does not invent an error when nothing was in flight', () => {
    const state = { ...withMessages(assistant('a', { isStreaming: false })), ready: true };

    const next = markDisconnected(state, null, null);

    expect(next.ready).toBe(false);
    expect(next.messages[0]?.error).toBeUndefined();
  });
});

describe('tool calls', () => {
  it('adds a running call, then resolves it with its result', () => {
    const started = startToolCall(withMessages(assistant('a')), 'a', {
      id: 'c1',
      name: 'get_document',
      input: { path: '/x' },
      status: 'running',
    });
    expect(started.messages[0]?.toolCalls).toEqual([
      { id: 'c1', name: 'get_document', input: { path: '/x' }, status: 'running' },
    ]);

    const finished = completeToolCall(started, 'a', {
      toolCallId: 'c1',
      toolName: 'get_document',
      toolResult: { ok: true },
    });
    expect(finished.messages[0]?.toolCalls).toEqual([
      { id: 'c1', name: 'get_document', input: { path: '/x' }, result: { ok: true }, status: 'done' },
    ]);
  });

  // Version skew: a Worker predating tool ids sends none, so matching falls back to name.
  it('resolves only the first still-running call with that name', () => {
    const running = { name: 'get_document', status: 'running' as const };
    let state = startToolCall(withMessages(assistant('a')), 'a', running);
    state = completeToolCall(state, 'a', { toolName: 'get_document', toolResult: 'first' });
    state = startToolCall(state, 'a', running);

    const next = completeToolCall(state, 'a', { toolName: 'get_document', toolResult: 'second' });

    expect(next.messages[0]?.toolCalls?.map(tc => tc.result)).toEqual(['first', 'second']);
  });

  it('marks a call still in flight as abandoned when the turn ends', () => {
    const state = {
      ...startToolCall(withMessages(assistant('a')), 'a', {
        id: 'c1',
        name: 'apply_document_edits',
        status: 'running',
      }),
      isLoading: true,
    };

    // Nothing will ever deliver this call's tool_end, so it must not stay 'running' —
    // it would render as in-flight forever.
    const next = endTurn(state, 'a', { stopped: true });

    expect(next.messages[0]?.toolCalls?.map(tc => tc.status)).toEqual(['abandoned']);
  });
});

describe('clearTranscript', () => {
  it('empties the transcript without touching connection state', () => {
    const state = { ...withMessages(assistant('a')), ready: true };

    expect(clearTranscript(state)).toEqual({ ...EMPTY_STATE, ready: true });
  });
});

// Every transition returns a new object so useSyncExternalStore can detect the change.
describe('immutability', () => {
  it('never mutates the state it is given', () => {
    const state = { ...withMessages(assistant('a')), isLoading: true, ready: true };
    const snapshot = structuredClone(state);

    appendToken(state, 'a', 'a-text-0', 'x');
    endTurn(state, 'a', { error: 'boom' });
    markDisconnected(state, 'a', null);
    startToolCall(state, 'a', { name: 't', status: 'running' });
    clearTranscript(state);

    expect(state).toEqual(snapshot);
  });
});
