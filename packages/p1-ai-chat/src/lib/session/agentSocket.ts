import type { ChatContext, RestoredMessage, RestoredPart, RestoredToolCall, ServerMessage } from '../../types.js';

/** The wire protocol with the Agent Worker. No React, no session state. */

/**
 * Everything the client can send. Closed union sent through the single {@link sendToAgent}
 * entry point, so changing a required field is a compile error at every call site.
 */
export type AgentRequest =
  | { type: 'chat'; message: string; context: ChatContext; turnId: string }
  | { type: 'get_history'; token: string }
  | { type: 'clear'; token: string }
  | { type: 'cancel' };

/** The one place client frames are serialized and sent. */
export function sendToAgent(ws: WebSocket, request: AgentRequest): void {
  ws.send(JSON.stringify(request));
}

/** Build the agent WebSocket URL for a conversation. */
export function createWebsocketConnectionUrl(agentUrl: string, agentId: string): string {
  const base = agentUrl.replace(/^http/, 'ws').replace(/\/$/, '');
  return `${base}/agents/chat-agent/${encodeURIComponent(agentId)}`;
}

/** One replayed call. `name` is read during render, so it has to be a string. */
function isRestoredToolCall(value: unknown): value is RestoredToolCall {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).name === 'string'
  );
}

/** One ordered piece of a replayed turn, checked per variant rather than on the tag alone. */
function isRestoredPart(value: unknown): value is RestoredPart {
  if (typeof value !== 'object' || value === null) return false;
  const part = value as Record<string, unknown>;
  if (part.type === 'text') return typeof part.text === 'string';
  if (part.type === 'tool') return isRestoredToolCall(part.tool);
  return false;
}

/** One replayed turn. `content` must be a string — rendering calls `.trim()` on it. */
function isRestoredMessage(value: unknown): value is RestoredMessage {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  if (m.role !== 'user' && m.role !== 'assistant') return false;
  if (typeof m.content !== 'string') return false;
  if (m.parts !== undefined && !(Array.isArray(m.parts) && m.parts.every(isRestoredPart))) {
    return false;
  }
  if (m.toolCalls === undefined) return true;
  return Array.isArray(m.toolCalls) && m.toolCalls.every(isRestoredToolCall);
}

/**
 * Narrow an already-parsed frame to a {@link ServerMessage}. Checks each variant's payload,
 * not just the `type` tag, since the consumer dereferences those fields directly.
 */
export function isServerMessage(value: unknown): value is ServerMessage {
  if (typeof value !== 'object' || value === null) return false;
  const frame = value as Record<string, unknown>;
  // A non-string `turnId` tests unequal to every turn, dropping every frame as stale.
  if (frame.turnId !== undefined && typeof frame.turnId !== 'string') return false;
  switch (frame.type) {
    case 'token':
      return typeof frame.content === 'string';
    case 'done':
      return true;
    case 'error':
      return typeof frame.error === 'string';
    case 'tool_start':
    case 'tool_end':
      // Optional: a pre-tool-id Worker sends none, and matching then falls back to the name.
      return (
        typeof frame.toolName === 'string' &&
        (frame.toolCallId === undefined || typeof frame.toolCallId === 'string')
      );
    case 'history':
      // Dereferenced during render, where a throw takes the editor tree down with it.
      return Array.isArray(frame.history) && frame.history.every(isRestoredMessage);
    case 'cancelled':
    case 'cleared':
      return true;
    default:
      return false;
  }
}

/**
 * The turn a frame belongs to, or undefined for frames that aren't turn-scoped and for a
 * Worker deployed before `turnId` existed. Read through the union rather than cast, so
 * adding a turn-scoped frame that forgets the field is a compile error here.
 */
export function frameTurnId(msg: ServerMessage): string | undefined {
  return 'turnId' in msg ? msg.turnId : undefined;
}

/**
 * Why the agent rejected the connection, as one of our own literals — the same reason
 * {@link frameLabel} exists. `unrecognized` covers a Worker that added a reason we don't know.
 */
export function connectionErrorLabel(error: string): string {
  switch (error) {
    case 'Authentication failed':
      return 'authentication failed';
    case 'Not authorized for this conversation':
      return 'not authorized for this conversation';
    case 'Invalid message format':
      return 'invalid frame';
    case 'Binary messages not supported':
      return 'binary frame';
    default:
      return 'unrecognized';
  }
}

/**
 * A label for a validated frame, built from literals here rather than from the frame itself.
 * Logging `msg.type` directly would put network-derived text in a log line (log injection).
 */
export function frameLabel(msg: ServerMessage): string {
  switch (msg.type) {
    case 'token':
      return 'token';
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    case 'tool_start':
      return 'tool_start';
    case 'tool_end':
      return 'tool_end';
    case 'history':
      return 'history';
    case 'cancelled':
      return 'cancelled';
    case 'cleared':
      return 'cleared';
  }
}

/**
 * Parse and validate a raw frame, returning null for anything unusable. The rejected payload
 * is deliberately not logged: it is arbitrary network content, and visible in the inspector.
 */
export function parseServerMessage(data: unknown): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data as string);
  } catch {
    console.warn('[p1-ai-chat] discarded a non-JSON frame from the agent');
    return null;
  }
  if (!isServerMessage(parsed)) {
    console.warn('[p1-ai-chat] discarded an unrecognized frame from the agent');
    return null;
  }
  return parsed;
}
