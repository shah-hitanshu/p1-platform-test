import type { ChatMessage, ToolCallStatus, RestoredMessage } from './types.js';

/**
 * Pure state transitions for a chat session: state in, next state out. Knows nothing about
 * WebSockets, timers, or the store, so the conversation logic is testable without a socket.
 */

/** The slice of session state a view renders. Replaced immutably so `useSyncExternalStore` can diff it. */
export interface ChatSessionState {
  messages: ChatMessage[];
  isLoading: boolean;
  /** True while the socket for this scope is open and usable. */
  ready: boolean;
}

export const EMPTY_STATE: ChatSessionState = { messages: [], isLoading: false, ready: false };

export function makeId(): string {
  return Math.random().toString(36).slice(2, 9);
}

/** Map a replayed turn into the UI message shape. Restored tool calls already ran, so 'done'. */
function restoredToChatMessage(m: RestoredMessage): ChatMessage {
  const toolCalls: ToolCallStatus[] | undefined =
    m.toolCalls && m.toolCalls.length > 0
      ? m.toolCalls.map(tc => ({ name: tc.name, input: tc.input, result: tc.result, status: 'done' as const }))
      : undefined;
  return {
    id: makeId(),
    role: m.role,
    content: m.content,
    ...(toolCalls ? { toolCalls } : {}),
  };
}

/** Replace one message by id, leaving the rest untouched. */
function mapMessage(
  state: ChatSessionState,
  id: string,
  fn: (message: ChatMessage) => ChatMessage,
): ChatSessionState {
  return { ...state, messages: state.messages.map(m => (m.id === id ? fn(m) : m)) };
}

/**
 * Apply history replayed by the agent, but only when the view is empty, so a mid-session
 * reconnect never overwrites a live conversation.
 */
export function restoreHistory(state: ChatSessionState, history: RestoredMessage[]): ChatSessionState {
  if (state.messages.length > 0) return state;
  return { ...state, messages: history.map(restoredToChatMessage) };
}

/** Append the user's message plus the empty assistant message its reply streams into. */
export function beginTurn(state: ChatSessionState, text: string, assistantId: string): ChatSessionState {
  return {
    ...state,
    isLoading: true,
    messages: [
      ...state.messages,
      { id: makeId(), role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '', isStreaming: true },
    ],
  };
}

export function appendToken(state: ChatSessionState, assistantId: string, chunk: string): ChatSessionState {
  return mapMessage(state, assistantId, m => ({ ...m, content: m.content + chunk, isStreaming: true }));
}

/**
 * Finish the in-flight turn, optionally recording why it failed. 'done', 'error', a failed
 * send and a dropped connection all end a turn identically. Null `assistantId` means no turn
 * was in flight, and still clears `isLoading`.
 */
export function endTurn(
  state: ChatSessionState,
  assistantId: string | null,
  error?: string,
): ChatSessionState {
  const cleared = { ...state, isLoading: false };
  if (!assistantId) return cleared;
  return mapMessage(cleared, assistantId, m => ({
    ...m,
    isStreaming: false,
    ...(error ? { error } : {}),
  }));
}

/** The socket is open and usable. */
export function markReady(state: ChatSessionState): ChatSessionState {
  return { ...state, ready: true };
}

/** End the turn and mark the socket unusable, as one update. */
export function markDisconnected(state: ChatSessionState, assistantId: string | null): ChatSessionState {
  return { ...endTurn(state, assistantId, assistantId ? 'Connection lost' : undefined), ready: false };
}

export function startToolCall(
  state: ChatSessionState,
  assistantId: string,
  name: string,
  input?: unknown,
): ChatSessionState {
  const toolCall: ToolCallStatus = { name, input, status: 'running' };
  return mapMessage(state, assistantId, m => ({ ...m, toolCalls: [...(m.toolCalls ?? []), toolCall] }));
}

/**
 * Resolve the first still-running call with this name. Matching by name is only sound while
 * the agent runs tools one at a time, which it does; concurrent calls would need call ids.
 */
export function completeToolCall(
  state: ChatSessionState,
  assistantId: string,
  name: string,
  result?: unknown,
): ChatSessionState {
  return mapMessage(state, assistantId, m => ({
    ...m,
    toolCalls: (m.toolCalls ?? []).map(tc =>
      tc.name === name && tc.status === 'running' ? { ...tc, result, status: 'done' as const } : tc,
    ),
  }));
}

export function clearTranscript(state: ChatSessionState): ChatSessionState {
  return { ...state, messages: [] };
}
