import type {
  AttachedFile,
  Attachment,
  ChatContext,
  PendingAttachment,
  SendMessageOptions,
  ServerMessage,
} from '../../types.js';
import { AttachmentError, NO_IMAGE_DECODER } from '../attachments/attachmentError.js';
import { htmlToText, truncateBrief } from '../attachments/briefText.js';
import { checkAttachment } from '../attachments/checkAttachment.js';
import {
  finalizeChatUpload,
  presignAndPut,
  type MediaTarget,
  type PresignedChatUpload,
} from '../attachments/mediaApi.js';
import { MAX_ATTACHMENTS, isHtmlFile } from '../attachments/fileRules.js';
import { uniqueFilename } from '../attachments/uniqueFilename.js';
import {
  EMPTY_STATE,
  makeId,
  addAttachment,
  addToWriteSet,
  appendToken,
  beginTurn,
  clearAttachments,
  clearTranscript,
  dropLastExchange,
  completeToolCall,
  endTurn,
  forgetWriteSet,
  markDisconnected,
  markHistoryLoaded,
  markReady,
  markReconnecting,
  normalizeDocumentPath,
  removeAttachment,
  setTurnFiles,
  removeFromWriteSet,
  resolveAttachment,
  restoreHistory,
  visitPage,
  setDraft,
  setPendingPage,
  setRetry,
  setScopeExpanded,
  startToolCall,
  stopTurn,
  type ChatSessionState,
  type RetryTarget,
} from './chatState.js';
import {
  createWebsocketConnectionUrl,
  frameLabel,
  frameTurnId,
  parseServerMessage,
  connectionErrorLabel,
  sendToAgent,
} from './agentSocket.js';

/**
 * Session-scoped chat store: holds state, notifies subscribers, owns the socket lifecycle.
 *
 * Keyed by `agentId` in a module-level map rather than component state: Puck remounts plugin
 * panels while a new page hydrates, which would otherwise drop the socket every time.
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
  /**
   * Id of the text part currently receiving deltas, or null when none is open. A tool call
   * closes it, so the next token opens a fresh part, which is what preserves the interleaving.
   */
  openTextPartId: string | null;
  subscribers: Set<() => void>;
  reapTimer: ReturnType<typeof setTimeout> | null;
  /** Absolute deadline for the streaming grace period; null when not waiting on one. */
  streamingGraceUntil: number | null;
  /** Silence watchdog for the turn in flight (see {@link TURN_SILENCE_TIMEOUT_MS}). */
  turnTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Consecutive failed reconnects, for backoff. Reset once a socket opens. */
  reconnectAttempts: number;
  /** The last turn sent, so a failure can offer to resend it. */
  lastSend: RetryTarget | null;
  /** Set by the currently-attached view. Called when the agent creates a page. */
  onPageCreated: ((path: string) => void) | null;
  /** Injected by the view, so the conversation store touches no browser imaging API. */
  prepareImage: ((file: File) => Promise<string>) | null;
  /** Base URL of the media API. Null disables keeping attachments, nothing else. */
  mediaWorkerUrl: string | null;
  /**
   * Uploads in flight or finished, by staged attachment id. The promise is held so a turn sent
   * before its file finished can still wait for it. Never rejects; null means it was not kept.
   *
   * Entries outlive their turn so a retry can record the same upload again (finalize is
   * idempotent). Removing a file is the only thing that drops its entry, so a file staged and
   * then removed is never recorded.
   */
  pendingUploads: Map<string, Promise<PresignedChatUpload | null>>;
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
      openTextPartId: null,
      turnTimer: null,
      reconnectTimer: null,
      reconnectAttempts: 0,
      lastSend: null,
      onPageCreated: null,
      prepareImage: null,
      mediaWorkerUrl: null,
      pendingUploads: new Map(),
    };
    sessions.set(agentId, session);
  }
  return session;
}

/** Close the socket and forget the session. The agent keeps history, so this is safe. */
function closeSession(session: ChatSession): void {
  // Timers first: a pending callback closes over the session and would retain it.
  endLocalTurn(session);
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }
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

/**
 * How long a turn may go without any frame before it's declared dead. A Worker that dies
 * mid-turn leaves the socket open and just stops sending. Every frame resets it, so this
 * bounds silence, not turn length.
 */
const TURN_SILENCE_TIMEOUT_MS = 120_000;

/** Clear the turn's local bookkeeping. Every way a turn can end routes through here. */
function endLocalTurn(session: ChatSession): void {
  if (session.turnTimer) {
    clearTimeout(session.turnTimer);
    session.turnTimer = null;
  }
  session.currentAssistantId = null;
  session.openTextPartId = null;
}

/** First reconnect delay; doubles per consecutive failure up to {@link RECONNECT_MAX_DELAY_MS}. */
const RECONNECT_BASE_DELAY_MS = 1_000;
/** Ceiling on the backoff, so a Worker that stays down is retried steadily rather than never. */
const RECONNECT_MAX_DELAY_MS = 30_000;

/** Reconnect after an unexpected close, backing off. Only while something is watching. */
function scheduleReconnect(session: ChatSession): void {
  if (session.reconnectTimer) return;
  update(session, markReconnecting(session.state, true));
  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** session.reconnectAttempts,
    RECONNECT_MAX_DELAY_MS,
  );
  session.reconnectAttempts += 1;
  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = null;
    if (session.subscribers.size === 0) {
      update(session, markReconnecting(session.state, false));
      return;
    }
    void connect(session).catch(() => {
      // Still down; chained from the timer rather than recursed so the attempt count grows.
      if (session.subscribers.size > 0) scheduleReconnect(session);
    });
  }, delay);
}

/** Best-effort cancel. The agent scopes it to this connection, so it needs no token. */
function sendCancel(session: ChatSession): void {
  const ws = session.ws;
  if (ws?.readyState !== WebSocket.OPEN) return;
  try {
    sendToAgent(ws, { type: 'cancel' });
  } catch {
    // The local turn is being ended regardless.
  }
}

/**
 * (Re)arm the silence watchdog. Called on send and on every frame, so the timeout measures
 * the gap between frames, not the turn's length: a long page build streams continuously and
 * must not be killed for taking a while.
 */
function touchTurn(session: ChatSession): void {
  if (session.turnTimer) clearTimeout(session.turnTimer);
  if (!session.state.isLoading) {
    session.turnTimer = null;
    return;
  }
  session.turnTimer = setTimeout(() => {
    session.turnTimer = null;
    if (!session.state.isLoading) return;
    // Tell the agent to stand down too, so it stops editing the page if it is still alive.
    sendCancel(session);
    const id = session.currentAssistantId;
    endLocalTurn(session);
    update(
      session,
      setRetry(
        endTurn(session.state, id, { error: 'The agent stopped responding' }),
        session.lastSend,
      ),
    );
  }, TURN_SILENCE_TIMEOUT_MS);
}

function scheduleReap(session: ChatSession): void {
  if (session.reapTimer) clearTimeout(session.reapTimer);
  session.reapTimer = setTimeout(() => {
    session.reapTimer = null;
    reapIfUnused(session);
  }, REAP_DELAY_MS);
}

/**
 * True when a frame belongs to a turn other than the one running. A cancel is only noticed
 * between tool calls, so its acknowledgement can land after the user has sent something else.
 * A frame with no `turnId` predates the field and is attributed to the current turn.
 */
function isStaleFrame(session: ChatSession, msg: ServerMessage): boolean {
  const turnId = frameTurnId(msg);
  return turnId !== undefined && turnId !== session.currentAssistantId;
}

function applyServerMessage(session: ChatSession, msg: ServerMessage): void {
  // `cleared` is acknowledgement only: the view was cleared optimistically on request.
  if (msg.type === 'cleared') return;
  if (msg.type === 'history') {
    update(session, restoreHistory(session.state, msg.history));
    return;
  }
  if (isStaleFrame(session, msg)) return;

  const id = session.currentAssistantId;
  switch (msg.type) {
    case 'done':
      endLocalTurn(session);
      update(session, endTurn(session.state, id));
      return;
    case 'error':
      // Belongs to the socket, not this turn, so it must not end it.
      if (msg.scope === 'connection') {
        console.warn(`[p1-ai-chat] agent reported a connection error: ${connectionErrorLabel(msg.error)}`);
        return;
      }
      endLocalTurn(session);
      update(session, setRetry(endTurn(session.state, id, { error: msg.error }), session.lastSend));
      return;
    // The agent confirming the stop. Usually redundant, since Stop ends the turn locally at
    // once, but it is also how a cancel triggered server-side by a clear reports back.
    case 'cancelled':
      endLocalTurn(session);
      update(session, stopTurn(session.state, id));
      return;
  }
  // The remaining frames only make sense against an in-flight assistant message.
  if (!id) return;
  touchTurn(session);
  switch (msg.type) {
    case 'token': {
      const partId = session.openTextPartId ?? makeId();
      session.openTextPartId = partId;
      update(session, appendToken(session.state, id, partId, msg.content));
      return;
    }
    case 'tool_start':
      // Close the open text part so prose after this call becomes a new part.
      session.openTextPartId = null;
      update(
        session,
        startToolCall(session.state, id, {
          id: msg.toolCallId,
          name: msg.toolName,
          input: msg.toolInput,
          status: 'running',
        }),
      );
      return;
    case 'tool_end':
      update(session, completeToolCall(session.state, id, msg));
      if (msg.toolName === 'create_page') notePageCreated(session, msg.toolResult);
      return;
  }
}

/**
 * What our `create_page` tool sends back. Fields are `unknown` rather than their intended types
 * because this crosses the socket: the Worker's type says what it meant to send, not what turned
 * up, so naming the shape must not be mistaken for having checked it.
 */
interface CreatePageResult {
  documentPath?: unknown;
  /** Sent in place of the path when the call failed, e.g. a page already exists there. */
  error?: unknown;
}

/**
 * The path a `create_page` call wrote to, or null when it created nothing.
 *
 * The failure is only ruled out here, not reported: a result carrying `error` renders as a failed
 * step in the transcript with its message (see `toolCallOutcome`).
 */
export function createdPagePath(toolResult: unknown): string | null {
  if (typeof toolResult !== 'object' || toolResult === null) return null;
  const { documentPath, error } = toolResult as CreatePageResult;
  if (error !== undefined) return null;
  return typeof documentPath === 'string' && documentPath.trim() !== '' ? documentPath : null;
}

/**
 * Record that the page the conversation was waiting on now exists: stop asking the agent to
 * create it, and let the editor open it.
 *
 * Those two go together. Keep sending the pending page and the agent creates it a second time;
 * skip the navigation and the next turn is built from the document still on screen, so it edits
 * the old page instead of the new one.
 */
function notePageCreated(session: ChatSession, toolResult: unknown): void {
  const path = createdPagePath(toolResult);
  if (!path) return;
  update(session, addToWriteSet(setPendingPage(session.state, null), path));
  session.onPageCreated?.(path);
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
      session.reconnectAttempts = 0;
      if (session.state.reconnecting) update(session, markReconnecting(session.state, false));
      void (async () => {
        // Ask for persisted history so a reopened panel restores the chat.
        let requested = false;
        try {
          const context = await session.getContext?.();
          if (context) {
            sendToAgent(ws, { type: 'get_history', token: context.token });
            requested = true;
          }
        } catch (err) {
          // Chat still works without restored history, but a silent swallow loses a
          // transcript with no signal anywhere.
          console.warn('[p1-ai-chat] could not restore conversation history', err);
        } finally {
          // Nothing will answer it, so settle the flag here.
          if (!requested && !session.state.historyLoaded) {
            update(session, markHistoryLoaded(session.state));
          }
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
      // Via endLocalTurn, or the open text part and watchdog outlive the turn.
      endLocalTurn(session);
      update(session, markDisconnected(session.state, id, session.lastSend));
      // Nothing else calls connect() while the panel stays mounted.
      if (session.subscribers.size > 0) scheduleReconnect(session);
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

/**
 * Take files the user dropped or picked. A refused file gets an entry too: one that vanished on
 * drop reads as a bug, and the composer will not send while a refusal is on it.
 */
function sessionAttachFiles(session: ChatSession, files: File[]): void {
  const contextForDrop = dropContextFactory(session);
  const taken = attachedFilenames(session.state);
  for (const dropped of files) {
    const filename = uniqueFilename(dropped.name, taken);
    // Renamed on the File itself, not just the card, so the upload stores it under the name
    // the assistant was told.
    const file = filename === dropped.name
      ? dropped
      : new File([dropped], filename, { type: dropped.type });
    const id = makeId();
    const verdict = checkAttachment(file);
    // Only files that will travel count: counting refusals tells someone looking at three
    // files that they already have four.
    const carried = session.state.attachments.filter(a => a.status !== 'error').length;
    const full = carried >= MAX_ATTACHMENTS;
    const refusal = full
      ? `Only ${String(MAX_ATTACHMENTS)} files can be attached at a time.`
      : verdict.kind === 'rejected' ? verdict.reason : null;
    const kind = verdict.kind === 'image' ? 'image' : 'document';

    if (refusal !== null) {
      update(session, addAttachment(session.state, {
        id, kind, filename, status: 'error', error: refusal,
      }));
      continue;
    }

    // Reserved only now: a name a refusal above walked away from is still free.
    taken.add(filename);
    const pending: PendingAttachment = { id, kind, filename, status: 'pending' };
    update(session, addAttachment(session.state, pending));
    // Not awaited as a batch: a slow image must not hold up the brief dropped with it.
    void settleAttachment(session, id, file, kind);
    stageUpload(session, id, file, contextForDrop());
  }
}

/**
 * Every filename this conversation has already used. Turns that have been sent count too, not
 * just the composer: the assistant can still be asked to act on a file from an earlier one.
 *
 * A refused file holds no name, for the same reason it does not count towards the cap — it
 * never reaches the conversation, so numbering the next one would answer a clash nobody has.
 */
function attachedFilenames(state: ChatSessionState): Set<string> {
  const names = new Set<string>();
  for (const attachment of state.attachments) {
    if (attachment.status !== 'error') names.add(attachment.filename);
  }
  for (const message of state.messages) {
    for (const attachment of message.attachments ?? []) names.add(attachment.filename);
  }
  return names;
}

/**
 * One auth context for a whole drop: resolving one costs a token fetch, and a drop stages
 * every file at once. Lazy, so a drop with nothing keepable costs none.
 */
function dropContextFactory(session: ChatSession): () => Promise<ChatContext> | undefined {
  let resolving: Promise<ChatContext> | undefined;
  return () => {
    const getContext = session.getContext;
    if (!session.mediaWorkerUrl || !getContext) return undefined;
    if (!resolving) {
      try {
        resolving = Promise.resolve(getContext());
      } catch {
        // getContext is typed to allow a synchronous implementation, and this runs in the
        // drop handler rather than inside uploadTarget's catch. Losing the file's
        // reopenability beats losing the drop.
        return undefined;
      }
    }
    return resolving;
  };
}

async function settleAttachment(
  session: ChatSession,
  id: string,
  file: File,
  kind: 'document' | 'image',
): Promise<void> {
  try {
    if (kind === 'document') {
      const raw = await file.text();
      // Converted before truncating, so the cap counts what the agent reads, not markup.
      const { text, truncated } = truncateBrief(isHtmlFile(file) ? htmlToText(raw) : raw);
      if (text.trim() === '') throw new AttachmentError('This file has no text in it.');
      update(session, resolveAttachment(session.state, id, { status: 'ready', text, truncated }));
      return;
    }
    const prepare = session.prepareImage;
    if (!prepare) throw new AttachmentError(NO_IMAGE_DECODER);
    const dataUrl = await prepare(file);
    update(session, resolveAttachment(session.state, id, { status: 'ready', dataUrl }));
  } catch (err) {
    // Only a message we wrote is shown to the user; anything else gets one of ours.
    const error = err instanceof AttachmentError ? err.message : 'This file could not be attached.';
    update(session, resolveAttachment(session.state, id, { status: 'error', error }));
  }
}

/**
 * Uploads the original file, in parallel with the panel reading it for the agent. The two are
 * deliberately independent: the agent gets a normalized copy (markup stripped, text cut,
 * images shrunk), while storage has to get the file the user actually attached — otherwise
 * "add to library" would publish something they never chose.
 *
 * Failures are silent. {@link attachmentBlocker} gates only on reading and decoding, so a turn
 * whose upload failed still sends; it just cannot be reopened later.
 */
function stageUpload(
  session: ChatSession,
  id: string,
  file: File,
  context?: Promise<ChatContext>,
): void {
  // Entries outlive their turn so a retry can re-record them, so nothing else prunes this and
  // a long-lived session would grow one per file forever. Evicting the oldest costs a
  // several-turns-old retry its reopenability; retention collects the bytes either way.
  while (session.pendingUploads.size >= MAX_TRACKED_UPLOADS) {
    const oldest = session.pendingUploads.keys().next();
    if (oldest.done === true) break;
    session.pendingUploads.delete(oldest.value);
  }
  session.pendingUploads.set(
    id,
    (async () => {
      const target = await uploadTarget(session, context);
      if (target === null) return null;
      try {
        return await presignAndPut(target, file);
      } catch (err) {
        console.warn('[p1-ai-chat] could not keep an attachment; it will not be reopenable', err);
        return null;
      }
    })(),
  );
}

/** A few turns' worth of attachments. See stageUpload. */
const MAX_TRACKED_UPLOADS = MAX_ATTACHMENTS * 4;

/** Bounds a wait without cancelling the work being waited on. */
function after(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

/**
 * Null when attachments cannot be kept. That is never a reason to fail a turn.
 *
 * `context` lets a caller that is already resolving one share it. Resolving a context fetches
 * an auth token, and a send does that anyway — without this a turn carrying files fetched two.
 */
async function uploadTarget(
  session: ChatSession,
  context?: Promise<ChatContext>,
): Promise<MediaTarget | null> {
  const workerUrl = session.mediaWorkerUrl;
  const getContext = session.getContext;
  if (!workerUrl) return null;
  try {
    // Inside the try: getContext is typed to allow a synchronous implementation, and a
    // throw escaping here would reject a call every caller treats as resolving to null —
    // aborting the turn over a file that just could not be kept.
    const resolving = context ?? (getContext ? Promise.resolve(getContext()) : null);
    if (!resolving) return null;
    const { siteId, token } = await resolving;
    return siteId && token ? { workerUrl, siteId, token } : null;
  } catch {
    return null;
  }
}

/**
 * Bounds sending the bytes: long enough for a typical attachment, short enough that a slow
 * one doesn't read as stuck.
 */
const UPLOAD_DEADLINE_MS = 3_000;

/**
 * Records the uploads for the files going out with this turn. Recording is what makes a file
 * retrievable, and doing it here instead of at staging time means a file the user removes
 * before sending is never recorded; its bytes are swept server-side.
 *
 * Each settles independently, so one failure only costs that file its reopenability.
 */
async function recordUploads(
  session: ChatSession,
  attachmentIds: string[],
  context: Promise<ChatContext>,
): Promise<Map<string, string>> {
  const staged = attachmentIds
    .map(id => ({ id, upload: session.pendingUploads.get(id) }))
    .filter((entry): entry is { id: string; upload: Promise<PresignedChatUpload | null> } =>
      entry.upload !== undefined);
  // Checked first: most turns carry no files, and there is nothing to wait on for those.
  if (staged.length === 0) return new Map();

  const target = await uploadTarget(session, context);
  if (target === null) return new Map();

  const recorded = new Map<string, string>();
  await Promise.all(
    staged.map(async ({ id, upload }) => {
      // Only the bytes are raced, because they can be megabytes and the user should not be
      // stuck behind their own upload. Recording them is one small call with its own request
      // timeout, waited out in full: the reference only persists if it rides in this turn's
      // frame, so losing it to a merely slow service loses it for good.
      const reserved = await Promise.race([upload, after(UPLOAD_DEADLINE_MS).then(() => null)]);
      if (reserved === null) return;
      try {
        recorded.set(id, await finalizeChatUpload(target, reserved));
      } catch (err) {
        console.warn('[p1-ai-chat] could not keep an attachment; it will not be reopenable', err);
      }
    }),
  );
  return recorded;
}

/** The card shape for a file travelling with a turn. */
function toTurnFile(attachment: Attachment): AttachedFile {
  const kept = attachment.assetId === undefined ? {} : { assetId: attachment.assetId };
  return attachment.kind === 'image'
    ? { kind: 'image', filename: attachment.filename, dataUrl: attachment.dataUrl, ...kept }
    : { kind: 'document', filename: attachment.filename, text: attachment.text, ...kept };
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
  // Minted here rather than inside beginTurn so setTurnFiles below can find this turn again.
  const userMessageId = makeId();
  session.currentAssistantId = assistantId;
  session.streamingGraceUntil = null;
  // Sticky, unlike the other overrides: the user's "yes, use that template" is an ordinary
  // typed turn, and it still has to reach the agent knowing what page to create.
  const withPendingPage = opts?.pendingPage
    ? setPendingPage(session.state, opts.pendingPage)
    : session.state;
  // Set before anything can fail, so failure paths can offer this turn for retry.
  session.lastSend = { text: trimmed, ...(opts ? { opts } : {}) };
  const attachments = opts?.attachments ?? [];
  const stagedIds = opts?.attachmentIds ?? [];
  // Emptied in the same update that sends them; a retry resends from `lastSend`.
  update(session, clearAttachments(beginTurn(withPendingPage, trimmed, assistantId, {
    userId: userMessageId,
    ...(opts?.origin ? { origin: opts.origin } : {}),
    // The file itself, so the turn can show what it sent. Lives as long as the session: only
    // the names are persisted, so a replayed turn gets them back without the file.
    files: attachments.map(toTurnFile),
  }), stagedIds));
  // Before the awaits, not after the send: neither `connect` nor `getContext` has a timeout.
  touchTurn(session);

  try {
    const getContext = session.getContext;
    if (!getContext) throw new SendFailureError('Chat is not ready yet. Please try again in a moment.');
    // Resolved once and shared: this fetches an auth token, and recordUploads needs the same
    // siteId and token. Calling it again there would fetch a second for the same turn.
    // Promise.resolve because getContext may be synchronous.
    const resolvingContext = Promise.resolve(getContext());
    // Awaited together for speed, but reported separately: resolving the context fetches an
    // auth token, and calling that "Connection failed" sends the user to check their network.
    // recordUploads joins this instead of running first: the turn already waits on the socket,
    // so keeping the files usually adds no wall clock. It never rejects.
    const [ws, baseContext, recorded] = await Promise.all([
      connect(session).catch(() => {
        throw new SendFailureError('Connection failed');
      }),
      resolvingContext.catch(() => {
        throw new SendFailureError('Could not authenticate. Please try again in a moment.');
      }),
      recordUploads(session, stagedIds, resolvingContext),
    ]);
    // Matched by position. That holds because the composer will not send while a file is
    // still reading or refused. The length check is the fallback: if the two ever diverge,
    // dropping the ids only costs reopenability, but mispairing them would show the wrong file.
    const aligned = stagedIds.length === attachments.length;
    const sent = attachments.map((attachment, i) => {
      const assetId = aligned ? recorded.get(stagedIds[i]) : undefined;
      return assetId === undefined ? attachment : { ...attachment, assetId };
    });
    // So a file attached in this session is reopenable without a reload.
    if (recorded.size > 0) {
      update(session, setTurnFiles(session.state, userMessageId, sent.map(toTurnFile)));
    }
    // Per-turn overrides, plus the conversation's outstanding page if it has one.
    const context: ChatContext = {
      ...baseContext,
      ...(opts?.documentPath != null ? { documentPath: opts.documentPath } : {}),
      ...(opts?.newPage ? { newPage: true } : {}),
      ...(sent.length > 0 ? { attachments: sent } : {}),
      ...(session.state.pendingPage ? { pendingPage: session.state.pendingPage } : {}),
      // Absent rather than [] while unseeded: [] reads as "edit nothing" on the first turn.
      ...(session.state.writeSet !== null
        ? { writeSet: withTarget(session.state.writeSet, opts?.documentPath) }
        : {}),
    };
    // Stop stays live while auth resolves, so this turn may already be abandoned.
    if (session.currentAssistantId !== assistantId) return;
    sendToAgent(ws, { type: 'chat', message: trimmed, context, turnId: assistantId });
    touchTurn(session);
  } catch (err) {
    // Superseded turns must not end the turn that replaced them.
    if (session.currentAssistantId !== assistantId) return;
    endLocalTurn(session);
    const error = err instanceof SendFailureError ? err.message : 'Connection failed';
    update(session, setRetry(endTurn(session.state, assistantId, { error }), session.lastSend));
  }
}

/**
 * The write set plus this turn's own target page, if it named one outside the set. The host app
 * pointing a turn at a page is as explicit a grant as the user adding it — without this, a
 * `fill-page` request lands on a conversation seeded elsewhere and every edit it makes is refused.
 */
function withTarget(writeSet: string[], target: string | undefined): string[] {
  if (target === undefined) return writeSet;
  const normalized = normalizeDocumentPath(target);
  if (normalized === '' || writeSet.includes(normalized)) return writeSet;
  return [...writeSet, normalized];
}

async function sessionClearMessages(session: ChatSession): Promise<void> {
  // Stop first, or the agent keeps editing a page for a conversation that is gone.
  sessionStop(session);
  // The request for a pending page went with the transcript, so the next turn must not still be
  // asking for one.
  update(session, clearTranscript(forgetWriteSet(setPendingPage(session.state, null))));
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

/**
 * Stop the turn in flight. Ends it locally at once rather than waiting for the agent, so the
 * composer frees up immediately; the agent's `cancelled` lands later and is redundant.
 */
function sessionStop(session: ChatSession): void {
  if (!session.state.isLoading) return;
  sendCancel(session);
  const id = session.currentAssistantId;
  endLocalTurn(session);
  update(session, stopTurn(session.state, id));
}

/** Resend the last failed turn. No-op when nothing failed. */
async function sessionRetry(session: ChatSession): Promise<void> {
  const target = session.state.retry;
  if (!target || session.state.isLoading) return;
  // Replace the failed exchange rather than appending below it.
  update(session, dropLastExchange(setRetry(session.state, null)));
  // `pendingPage` seeds conversation state instead of overriding one turn, so it is left out of a
  // resend: the page may well have been created before whatever failed later in the turn, and
  // seeding it again asks for a second one. Anything still outstanding is on the session already.
  const { pendingPage, ...opts } = target.opts ?? {};
  await sessionSendMessage(session, target.text, opts);
}

/** Handle to a live chat session, returned by {@link acquireChatSession}. */
export interface ChatSessionHandle {
  /** Subscribe to state changes; returns an unsubscribe that schedules reaping when idle. */
  subscribe: (listener: () => void) => () => void;
  /** Current state snapshot, referentially stable until the next change. */
  getState: () => ChatSessionState;
  sendMessage: (text: string, opts?: SendMessageOptions) => Promise<void>;
  clearMessages: () => Promise<void>;
  /** Stop the turn in flight, aborting the model request and any tool calls not yet started. */
  stop: () => void;
  /** Resend the last failed turn without retyping it. */
  retry: () => Promise<void>;
  /** Update the composer text, which lives in session state so a remount can't discard it. */
  setDraft: (text: string) => void;
  /** Note the page now open in the editor, which the agent may edit while it stays open. */
  visitPage: (path: string) => void;
  /** Show the pages in the scope row, or collapse it to a count. */
  setScopeExpanded: (expanded: boolean) => void;
  /** Let the agent change one more page, at the user's request. */
  addWritablePage: (path: string) => void;
  /** Take a page back from the agent. */
  removeWritablePage: (path: string) => void;
  attachFiles: (files: File[]) => void;
  removeAttachment: (id: string) => void;
}

/** What the mounted view lends the session: fresh context, and its reach into the editor. */
export interface ChatSessionHooks {
  getContext: () => ChatContext | Promise<ChatContext>;
  /** Called with the path of a page the agent created during a turn. */
  onPageCreated?: (path: string) => void;
  prepareImage?: (file: File) => Promise<string>;
  /** Base URL of the media API. Omit to keep nothing. */
  mediaWorkerUrl?: string;
}

/**
 * Acquire the session for `agentId`, creating and connecting it if needed. Safe to call
 * during render (idempotent).
 */
export function acquireChatSession(
  agentId: string,
  agentUrl: string,
  hooks: ChatSessionHooks,
): ChatSessionHandle {
  // Re-resolves through the map rather than closing over the session object, because a handle
  // outlives the session when reaping deletes the entry. Capturing it would send into an
  // orphaned session nobody is reading.
  const resolve = (): ChatSession => {
    const session = getOrCreate(agentId, agentUrl);
    // Repoint at the mounted view's fresh auth/ids, including after a reap recreated this.
    session.getContext = hooks.getContext;
    session.onPageCreated = hooks.onPageCreated ?? null;
    session.prepareImage = hooks.prepareImage ?? null;
    session.mediaWorkerUrl = hooks.mediaWorkerUrl ?? null;
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
    stop: () => sessionStop(resolve()),
    retry: () => sessionRetry(resolve()),
    setDraft: (text: string) => {
      const session = resolve();
      update(session, setDraft(session.state, text));
    },
    visitPage: (path: string) => {
      const session = resolve();
      update(session, visitPage(session.state, path));
    },
    setScopeExpanded: (expanded: boolean) => {
      const session = resolve();
      update(session, setScopeExpanded(session.state, expanded));
    },
    addWritablePage: (path: string) => {
      const session = resolve();
      update(session, addToWriteSet(session.state, path));
    },
    removeWritablePage: (path: string) => {
      const session = resolve();
      update(session, removeFromWriteSet(session.state, path));
    },
    attachFiles: (files: File[]) => sessionAttachFiles(resolve(), files),
    removeAttachment: (id: string) => {
      const session = resolve();
      // The bytes may already be in storage, but dropping the entry means nothing will ever
      // record them, so they get swept.
      session.pendingUploads.delete(id);
      update(session, removeAttachment(session.state, id));
    },
  };
}
