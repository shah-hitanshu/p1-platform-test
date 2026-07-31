import type { ChatContext, ServerMessage } from './types.js';

/** The wire protocol with the Agent Worker. No React, no session state. */

/**
 * Everything the client can send. Closed union sent through the single {@link sendToAgent}
 * entry point, so changing a required field is a compile error at every call site.
 */
export type AgentRequest =
  | { type: 'chat'; message: string; context: ChatContext }
  | { type: 'get_history'; token: string }
  | { type: 'clear'; token: string };

/** The one place client frames are serialized and sent. */
export function sendToAgent(ws: WebSocket, request: AgentRequest): void {
  ws.send(JSON.stringify(request));
}

/** Build the agent WebSocket URL for a conversation. */
export function createWebsocketConnectionUrl(agentUrl: string, agentId: string): string {
  const base = agentUrl.replace(/^http/, 'ws').replace(/\/$/, '');
  return `${base}/agents/chat-agent/${encodeURIComponent(agentId)}`;
}

/**
 * Narrow an already-parsed frame to a {@link ServerMessage}. Checks each variant's payload,
 * not just the `type` tag, since the consumer dereferences those fields directly.
 */
export function isServerMessage(value: unknown): value is ServerMessage {
  if (typeof value !== 'object' || value === null) return false;
  const frame = value as Record<string, unknown>;
  switch (frame.type) {
    case 'token':
      return typeof frame.content === 'string';
    case 'done':
      return true;
    case 'error':
      return typeof frame.error === 'string';
    case 'tool_start':
    case 'tool_end':
      return typeof frame.toolName === 'string';
    case 'history':
      return Array.isArray(frame.history);
    default:
      return false;
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
