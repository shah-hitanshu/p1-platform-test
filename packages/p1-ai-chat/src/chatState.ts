import type {
  ChatMessage,
  MessageOrigin,
  MessagePart,
  PendingPage,
  ToolCallStatus,
  RestoredMessage,
  SendMessageOptions,
} from './types.js';

/**
 * Pure state transitions for a chat session: state in, next state out. Knows nothing about
 * WebSockets, timers, or the store, so the conversation logic is testable without a socket.
 */

/** The turn to resend on retry. Holds the text because the composer is cleared on send. */
export interface RetryTarget {
  text: string;
  opts?: SendMessageOptions;
}

/** The slice of session state a view renders. Replaced immutably so `useSyncExternalStore` can diff it. */
export interface ChatSessionState {
  messages: ChatMessage[];
  isLoading: boolean;
  /** True while the socket for this scope is open and usable. */
  ready: boolean;
  /** The composer's text, kept here so a plugin-panel remount can't discard a half-written brief. */
  draft: string;
  /**
   * False until the agent has answered `get_history`. Distinguishes "this conversation is
   * empty" from "history hasn't arrived", which otherwise flashes the empty state on open.
   */
  historyLoaded: boolean;
  /** True between an unexpected disconnect and the next reconnect attempt. */
  reconnecting: boolean;
  /** The turn to resend if the user asks to retry, or null when the last turn didn't fail. */
  retry: RetryTarget | null;
  /**
   * A page the user has asked for that the agent has not created yet, or null. Rendered state
   * rather than a private field because it decides whether the composer works: answering the
   * agent's question about which template to use must not need a page open.
   */
  pendingPage: PendingPage | null;
}

export const EMPTY_STATE: ChatSessionState = {
  messages: [],
  isLoading: false,
  ready: false,
  draft: '',
  historyLoaded: false,
  reconnecting: false,
  retry: null,
  pendingPage: null,
};

/** Remember, or forget, the page the conversation is waiting to have created. */
export function setPendingPage(
  state: ChatSessionState,
  pendingPage: PendingPage | null,
): ChatSessionState {
  if (state.pendingPage === pendingPage) return state;
  return { ...state, pendingPage };
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 9);
}

/** Map a replayed turn into the UI message shape. Restored tool calls already ran, so 'done'. */
function restoredToChatMessage(m: RestoredMessage): ChatMessage {
  const id = makeId();
  const toolCalls: ToolCallStatus[] | undefined =
    m.toolCalls && m.toolCalls.length > 0
      ? m.toolCalls.map(tc => ({ name: tc.name, input: tc.input, result: tc.result, status: 'done' as const }))
      : undefined;
  // Ordered parts when the Worker sent them, so a replayed turn renders as the live one did.
  const parts: MessagePart[] | undefined =
    m.parts && m.parts.length > 0
      ? m.parts.map((part, i) =>
          part.type === 'text'
            ? { type: 'text', id: `${id}-p${i}`, text: part.text }
            : {
                type: 'tool',
                tool: { name: part.tool.name, input: part.tool.input, result: part.tool.result, status: 'done' as const },
              },
        )
      : undefined;
  return {
    id,
    role: m.role,
    content: m.content,
    ...(parts ? { parts } : {}),
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
  // `historyLoaded` flips on the frame arriving, not on it having content, so an empty
  // conversation settles into its empty state instead of waiting forever.
  const loaded = { ...state, historyLoaded: true };
  if (state.messages.length > 0) return loaded;
  return { ...loaded, messages: history.map(restoredToChatMessage) };
}

/** Keep `parts` canonical and mirror it into the flat `toolCalls` the legacy renderer reads. */
function withParts(m: ChatMessage, parts: MessagePart[]): ChatMessage {
  return { ...m, parts, toolCalls: parts.flatMap(p => (p.type === 'tool' ? [p.tool] : [])) };
}

/** Append streamed text to the open text part, opening one if this is the first delta. */
function appendText(parts: MessagePart[], openId: string, text: string): MessagePart[] {
  const index = parts.findIndex(p => p.type === 'text' && p.id === openId);
  if (index === -1) return [...parts, { type: 'text', id: openId, text }];
  const next = [...parts];
  const part = next[index] as { type: 'text'; id: string; text: string };
  next[index] = { ...part, text: part.text + text };
  return next;
}

/**
 * Resolve the tool part a `tool_end` refers to, in place so ordering survives. Matches on
 * call id, since one turn can call the same tool twice. The name fallback covers a Worker
 * predating tool ids; `matched` keeps that path to a single call too.
 */
function resolveToolPart(
  parts: MessagePart[],
  msg: { toolCallId?: string; toolName: string; toolInput?: unknown; toolResult?: unknown },
): MessagePart[] {
  let matched = false;
  return parts.map(part => {
    if (matched || part.type !== 'tool') return part;
    const tool = part.tool;
    const isMatch = msg.toolCallId
      ? tool.id === msg.toolCallId
      : tool.name === msg.toolName && tool.status === 'running';
    if (!isMatch) return part;
    matched = true;
    return {
      type: 'tool',
      tool: { ...tool, input: msg.toolInput ?? tool.input, result: msg.toolResult, status: 'done' as const },
    };
  });
}

/** Append the user's message plus the empty assistant message its reply streams into. */
export function beginTurn(
  state: ChatSessionState,
  text: string,
  assistantId: string,
  origin?: MessageOrigin,
): ChatSessionState {
  return {
    ...state,
    isLoading: true,
    // A new turn supersedes any pending offer; failure paths re-arm it.
    retry: null,
    messages: [
      ...state.messages,
      { id: makeId(), role: 'user', content: text, ...(origin ? { origin } : {}) },
      { id: assistantId, role: 'assistant', content: '', isStreaming: true },
    ],
  };
}

/**
 * Append a streamed delta. `openTextPartId` is the text part currently receiving deltas; a
 * tool call closes it, so the next token opens a fresh part and the interleaving survives.
 */
export function appendToken(
  state: ChatSessionState,
  assistantId: string,
  openTextPartId: string,
  chunk: string,
): ChatSessionState {
  return mapMessage(state, assistantId, m => ({
    ...withParts(m, appendText(m.parts ?? [], openTextPartId, chunk)),
    content: m.content + chunk,
    isStreaming: true,
  }));
}

/**
 * Finish the in-flight turn. 'done', 'error', a stop, a failed send and a dropped connection
 * all end a turn identically and differ only in what they annotate the message with. Null
 * `assistantId` means no turn was in flight, and still clears `isLoading`.
 */
export function endTurn(
  state: ChatSessionState,
  assistantId: string | null,
  patch?: Partial<ChatMessage>,
): ChatSessionState {
  const cleared = { ...state, isLoading: false };
  if (!assistantId) return cleared;
  return mapMessage(cleared, assistantId, m => {
    const ended: ChatMessage = { ...m, isStreaming: false, ...(patch ?? {}) };
    // Guarded: `messageParts` treats a present-but-empty `parts` as canonical, so writing
    // `parts: []` onto a turn without any would drop its `content`.
    const parts = ended.parts;
    if (!parts?.some(p => p.type === 'tool' && p.tool.status === 'running')) return ended;
    return withParts(ended, abandonRunningTools(parts));
  });
}

/** Mark every still-running tool part abandoned. Callers check that any are. */
function abandonRunningTools(parts: MessagePart[]): MessagePart[] {
  return parts.map(p =>
    p.type === 'tool' && p.tool.status === 'running'
      ? { type: 'tool', tool: { ...p.tool, status: 'abandoned' as const } }
      : p,
  );
}

/** The user stopped the turn. Keeps whatever streamed, and reads as a note, not a failure. */
export function stopTurn(state: ChatSessionState, assistantId: string | null): ChatSessionState {
  return endTurn(state, assistantId, { stopped: true });
}

export function setDraft(state: ChatSessionState, draft: string): ChatSessionState {
  return { ...state, draft };
}

export function setRetry(state: ChatSessionState, retry: RetryTarget | null): ChatSessionState {
  return { ...state, retry };
}

export function markReconnecting(state: ChatSessionState, reconnecting: boolean): ChatSessionState {
  return { ...state, reconnecting };
}

/** The socket is open and usable. */
export function markReady(state: ChatSessionState): ChatSessionState {
  return { ...state, ready: true };
}

/** Settle `historyLoaded` without applying history, for when the request was never sent. */
export function markHistoryLoaded(state: ChatSessionState): ChatSessionState {
  return { ...state, historyLoaded: true };
}

/**
 * End the turn, mark the socket unusable and offer the turn for retry, as one update. A turn
 * cut off by a dropped socket is the case retry exists for, so it is armed here.
 */
export function markDisconnected(
  state: ChatSessionState,
  assistantId: string | null,
  // Required, not defaulted: a missing argument silently cleared retry.
  retry: RetryTarget | null,
): ChatSessionState {
  const ended = endTurn(state, assistantId, assistantId ? { error: 'Connection lost' } : undefined);
  return { ...ended, ready: false, retry: assistantId ? retry : state.retry };
}

export function startToolCall(
  state: ChatSessionState,
  assistantId: string,
  call: ToolCallStatus,
): ChatSessionState {
  return mapMessage(state, assistantId, m =>
    withParts(m, [...(m.parts ?? []), { type: 'tool', tool: call }]),
  );
}

/** Resolve the call a `tool_end` refers to. See {@link resolveToolPart} for the matching rule. */
export function completeToolCall(
  state: ChatSessionState,
  assistantId: string,
  msg: { toolCallId?: string; toolName: string; toolInput?: unknown; toolResult?: unknown },
): ChatSessionState {
  return mapMessage(state, assistantId, m => withParts(m, resolveToolPart(m.parts ?? [], msg)));
}

/**
 * Drop the trailing exchange — the last user message and everything after it. Used by retry,
 * so a resend replaces the failed turn rather than stacking under it.
 */
export function dropLastExchange(state: ChatSessionState): ChatSessionState {
  const lastUser = state.messages.map(m => m.role).lastIndexOf('user');
  if (lastUser === -1) return state;
  return { ...state, messages: state.messages.slice(0, lastUser) };
}

/** Clear the transcript. Retry goes with it: it refers to a turn no longer on screen. */
export function clearTranscript(state: ChatSessionState): ChatSessionState {
  return { ...state, messages: [], retry: null };
}
