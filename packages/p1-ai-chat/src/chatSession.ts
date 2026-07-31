import type { ChatContext, ServerMessage } from './types.js';
import {
  EMPTY_STATE,
  makeId,
  appendToken,
  beginTurn,
  clearTranscript,
  completeToolCall,
  endTurn,
  markDisconnected,
  markReady,
  restoreHistory,
  startToolCall,
  type ChatSessionState,
} from './chatState.js';
import {
  createWebsocketConnectionUrl,
  frameLabel,
  parseServerMessage,
  sendToAgent,
} from './agentSocket.js';

/**
 * Session-scoped chat store: holds state, notifies subscribers, owns the socket lifecycle.
 * Transitions live in chatState.ts, the wire protocol in agentSocket.ts.
 *
 * State lives in a module-level map keyed by `agentId` rather than in component state because
 * Puck remounts plugin panels whenever the editor rebuilds its plugin array, which happens
 * repeatedly while a freshly-created page hydrates. In component state, every remount would
 * drop the socket and wipe an in-progress draft.
 */

export type { ChatSessionState } from './chatState.js';

/** How long a session lingers after its last subscriber detaches before being closed. */
const REAP_DELAY_MS = 30_000;

/** Cap on keeping an unwatched session alive for an in-flight turn, so a hung turn can't pin it. */
const MAX_STREAMING_GRACE_MS = 300_000;

interface ChatSession {
  agentId: string;
  agentUrl: string;
  ws: WebSocket | null;
  connecting: Promise<WebSocket> | null;
  state: ChatSessionState;
  currentAssistantId: string | null;
  /** Set by the currently-attached view; reads fresh auth/context (token, ids) on demand. */
  getContext: (() => ChatContext | Promise<ChatContext>) | null;
  subscribers: Set<() => void>;
  reapTimer: ReturnType<typeof setTimeout> | null;
  /** Absolute deadline for the streaming grace period; null when not waiting on one. */
  streamingGraceUntil: number | null;
}

const sessions = new Map<string, ChatSession>();

/** Apply a state transition and notify subscribers once. */
function update(session: ChatSession, next: ChatSessionState): void {
  session.state = next;
  for (const listener of session.subscribers) listener();
}

/**
 * `agentUrl` binds on first create and is ignored by later acquires for the same `agentId`.
 * Fine while it comes from static plugin config; if it becomes dynamic, the session needs
 * tearing down rather than silently keeping the socket it already opened.
 */
function getOrCreate(agentId: string, agentUrl: string): ChatSession {
  let session = sessions.get(agentId);
  if (!session) {
    session = {
      agentId,
      agentUrl,
      ws: null,
      connecting: null,
      state: EMPTY_STATE,
      currentAssistantId: null,
      getContext: null,
      subscribers: new Set(),
      reapTimer: null,
      streamingGraceUntil: null,
    };
    sessions.set(agentId, session);
  }
  return session;
}

/** Close the socket and forget the session. The agent keeps history, so this is safe. */
function closeSession(session: ChatSession): void {
  session.ws?.close();
  sessions.delete(session.agentId);
}

/**
 * Claim more time for an unwatched session with a turn still streaming, and report whether any
 * remains. Named `claim`, not `is…`, because the first call starts the period: not a predicate.
 */
function claimStreamingGrace(session: ChatSession): boolean {
  if (!session.state.isLoading) return false;
  if (session.streamingGraceUntil === null) {
    session.streamingGraceUntil = Date.now() + MAX_STREAMING_GRACE_MS;
    return true;
  }
  return Date.now() < session.streamingGraceUntil;
}

/** Reap timer callback: either wait longer, or tear the session down. */
function reapIfUnused(session: ChatSession): void {
  if (session.subscribers.size > 0) return;
  if (claimStreamingGrace(session)) {
    scheduleReap(session);
    return;
  }
  closeSession(session);
}

function scheduleReap(session: ChatSession): void {
  if (session.reapTimer) clearTimeout(session.reapTimer);
  session.reapTimer = setTimeout(() => {
    session.reapTimer = null;
    reapIfUnused(session);
  }, REAP_DELAY_MS);
}

function applyServerMessage(session: ChatSession, msg: ServerMessage): void {
  const id = session.currentAssistantId;
  switch (msg.type) {
    case 'history':
      update(session, restoreHistory(session.state, msg.history));
      return;
    case 'done':
      session.currentAssistantId = null;
      update(session, endTurn(session.state, id));
      return;
    case 'error':
      session.currentAssistantId = null;
      update(session, endTurn(session.state, id, msg.error));
      return;
  }
  // The remaining frames only make sense against an in-flight assistant message.
  if (!id) return;
  switch (msg.type) {
    case 'token':
      update(session, appendToken(session.state, id, msg.content));
      return;
    case 'tool_start':
      update(session, startToolCall(session.state, id, msg.toolName, msg.toolInput));
      return;
    case 'tool_end':
      update(session, completeToolCall(session.state, id, msg.toolName, msg.toolResult));
      return;
  }
}

async function connect(session: ChatSession): Promise<WebSocket> {
  if (session.ws?.readyState === WebSocket.OPEN) return session.ws;
  if (session.connecting) return session.connecting;

  session.connecting = new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(createWebsocketConnectionUrl(session.agentUrl, session.agentId));
    session.ws = ws;

    /**
     * A superseded socket keeps firing events: a failed connect leaves its handlers attached,
     * the caller opens a replacement, then the dead socket's `onclose` nulls `session.ws` and
     * discards the live one. Every handler below is guarded on this.
     */
    const isCurrent = (): boolean => session.ws === ws;

    ws.onopen = () => {
      void (async () => {
        // Ask for persisted history so a reopened panel restores the chat.
        try {
          const context = await session.getContext?.();
          if (context) sendToAgent(ws, { type: 'get_history', token: context.token });
        } catch (err) {
          // Chat still works without restored history, but a silent swallow loses a
          // transcript with no signal anywhere.
          console.warn('[p1-ai-chat] could not restore conversation history', err);
        } finally {
          if (isCurrent()) {
            update(session, markReady(session.state));
            resolve(ws);
          } else {
            // Superseded while connecting: fail our callers so they retry the live socket.
            ws.close();
            reject(new Error('WebSocket superseded before it opened'));
          }
        }
      })();
    };

    ws.onerror = () => reject(new Error('WebSocket connection failed'));

    ws.onclose = () => {
      if (!isCurrent()) return;
      session.ws = null;
      session.connecting = null;
      const id = session.currentAssistantId;
      session.currentAssistantId = null;
      update(session, markDisconnected(session.state, id));
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!isCurrent()) return;
      const msg = parseServerMessage(event.data);
      if (!msg) return;
      try {
        applyServerMessage(session, msg);
      } catch (err) {
        console.error('[p1-ai-chat] failed while handling a frame', frameLabel(msg), err);
      }
    };
  });

  try {
    return await session.connecting;
  } finally {
    session.connecting = null;
  }
}

/** Options for a programmatic {@link sessionSendMessage} call. */
export interface SendMessageOptions {
  /**
   * Override the turn's `documentPath` so the agent edits this page instead of the
   * sidebar's currently-open document. Used to draft into a just-created page.
   */
  documentPath?: string;
  /**
   * Tell the agent this page was just created empty for this brief, so it drafts without
   * asking. Travels in the turn's context, so it never appears in the visible transcript.
   */
  newPage?: boolean;
}

/** A send failure whose message is safe to show the user as-is. */
class SendFailureError extends Error {}

async function sessionSendMessage(
  session: ChatSession,
  text: string,
  opts?: SendMessageOptions,
): Promise<void> {
  const trimmed = text.trim();
  // Single-flight per conversation. Beyond double-click protection, this is what stops two
  // mounted panels both submitting the same draft request. Keep it synchronous and first.
  if (!trimmed || session.state.isLoading) return;

  const assistantId = makeId();
  session.currentAssistantId = assistantId;
  session.streamingGraceUntil = null;
  update(session, beginTurn(session.state, trimmed, assistantId));

  try {
    const getContext = session.getContext;
    if (!getContext) throw new SendFailureError('Chat is not ready yet. Please try again in a moment.');
    // Awaited together for speed, but reported separately: resolving the context fetches an
    // auth token, and calling that "Connection failed" sends the user to check their network.
    const [ws, baseContext] = await Promise.all([
      connect(session).catch(() => {
        throw new SendFailureError('Connection failed');
      }),
      // Promise.resolve because getContext may be synchronous.
      Promise.resolve(getContext()).catch(() => {
        throw new SendFailureError('Could not authenticate. Please try again in a moment.');
      }),
    ]);
    // Per-turn overrides only, so an ordinary typed turn carries neither field.
    const context: ChatContext = {
      ...baseContext,
      ...(opts?.documentPath != null ? { documentPath: opts.documentPath } : {}),
      ...(opts?.newPage ? { newPage: true } : {}),
    };
    sendToAgent(ws, { type: 'chat', message: trimmed, context });
  } catch (err) {
    session.currentAssistantId = null;
    const error = err instanceof SendFailureError ? err.message : 'Connection failed';
    update(session, endTurn(session.state, assistantId, error));
  }
}

async function sessionClearMessages(session: ChatSession): Promise<void> {
  update(session, clearTranscript(session.state));
  const ws = session.ws;
  // The local view is cleared either way; telling the agent is best-effort.
  if (ws?.readyState !== WebSocket.OPEN) return;
  try {
    const context = await session.getContext?.();
    if (context) sendToAgent(ws, { type: 'clear', token: context.token });
  } catch (err) {
    console.warn('[p1-ai-chat] could not clear server-side history', err);
  }
}

/** Handle to a live chat session, returned by {@link acquireChatSession}. */
export interface ChatSessionHandle {
  /** Subscribe to state changes; returns an unsubscribe that schedules reaping when idle. */
  subscribe: (listener: () => void) => () => void;
  /** Current state snapshot, referentially stable until the next change. */
  getState: () => ChatSessionState;
  sendMessage: (text: string, opts?: SendMessageOptions) => Promise<void>;
  clearMessages: () => Promise<void>;
}

/**
 * Acquire the session for `agentId`, creating and connecting it if needed. Safe to call
 * during render (idempotent).
 */
export function acquireChatSession(
  agentId: string,
  agentUrl: string,
  getContext: () => ChatContext | Promise<ChatContext>,
): ChatSessionHandle {
  // Re-resolves through the map rather than closing over the session object, because a handle
  // outlives the session when reaping deletes the entry. Capturing it would send into an
  // orphaned session nobody is reading.
  const resolve = (): ChatSession => {
    const session = getOrCreate(agentId, agentUrl);
    // Repoint at the mounted view's fresh auth/ids, including after a reap recreated this.
    session.getContext = getContext;
    return session;
  };

  resolve();

  return {
    subscribe: (listener: () => void) => {
      const session = resolve();
      if (session.reapTimer) {
        clearTimeout(session.reapTimer);
        session.reapTimer = null;
      }
      // Something is watching again, so the streaming grace period no longer applies.
      session.streamingGraceUntil = null;
      session.subscribers.add(listener);
      // Ensure a socket exists once something is watching. Reused if already open.
      void connect(session).catch(() => {
        // A failed eager connect is non-fatal; sendMessage retries and surfaces errors.
      });
      return () => {
        session.subscribers.delete(listener);
        if (session.subscribers.size === 0) scheduleReap(session);
      };
    },
    getState: () => sessions.get(agentId)?.state ?? EMPTY_STATE,
    sendMessage: (text, opts) => sessionSendMessage(resolve(), text, opts),
    clearMessages: () => sessionClearMessages(resolve()),
  };
}
