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
} from './chatState.js';
import type { ChatMessage } from './types.js';

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

    expect(restoreHistory(live, [{ role: 'user', content: 'old' }])).toBe(live);
  });

  it('marks restored tool calls as already finished', () => {
    const next = restoreHistory(EMPTY_STATE, [
      { role: 'assistant', content: 'done', toolCalls: [{ name: 'get_document', result: { ok: true } }] },
    ]);

    expect(next.messages[0]?.toolCalls?.[0]?.status).toBe('done');
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

    const next = appendToken(appendToken(state, 'a', 'Hel'), 'a', 'lo');

    expect(next.messages[0]?.content).toBe('Hello');
    expect(next.messages[1]?.content).toBe('');
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

    const next = endTurn(state, 'a', 'Rate limit reached');

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

    const next = markDisconnected(state, 'a');

    expect(next).toMatchObject({ ready: false, isLoading: false });
    expect(next.messages[0]).toMatchObject({ isStreaming: false, error: 'Connection lost' });
  });

  it('does not invent an error when nothing was in flight', () => {
    const state = { ...withMessages(assistant('a', { isStreaming: false })), ready: true };

    const next = markDisconnected(state, null);

    expect(next.ready).toBe(false);
    expect(next.messages[0]?.error).toBeUndefined();
  });
});

describe('tool calls', () => {
  it('adds a running call, then resolves it with its result', () => {
    const started = startToolCall(withMessages(assistant('a')), 'a', 'get_document', { path: '/x' });
    expect(started.messages[0]?.toolCalls).toEqual([
      { name: 'get_document', input: { path: '/x' }, status: 'running' },
    ]);

    const finished = completeToolCall(started, 'a', 'get_document', { ok: true });
    expect(finished.messages[0]?.toolCalls).toEqual([
      { name: 'get_document', input: { path: '/x' }, result: { ok: true }, status: 'done' },
    ]);
  });

  it('resolves only the first still-running call with that name', () => {
    let state = startToolCall(withMessages(assistant('a')), 'a', 'get_document');
    state = completeToolCall(state, 'a', 'get_document', 'first');
    state = startToolCall(state, 'a', 'get_document');

    const next = completeToolCall(state, 'a', 'get_document', 'second');

    expect(next.messages[0]?.toolCalls?.map(tc => tc.result)).toEqual(['first', 'second']);
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

    appendToken(state, 'a', 'x');
    endTurn(state, 'a', 'boom');
    markDisconnected(state, 'a');
    startToolCall(state, 'a', 't');
    clearTranscript(state);

    expect(state).toEqual(snapshot);
  });
});
