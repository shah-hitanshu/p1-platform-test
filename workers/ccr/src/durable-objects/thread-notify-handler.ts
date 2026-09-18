/**
 * Relays a thread change to every editor connected to this document.
 * The worker posts here after a comment commits; the message is forwarded as
 * is, so this never needs the document's content loaded.
 */

import type { WsThreadEventMessage } from '../types/websocket-messages';
import { errorResponse, jsonResponse, sendWsMessage } from './websocket-utils';

const THREAD_EVENT_TYPES = new Set(['comment_posted', 'comment_updated', 'thread_status_changed']);

function isThreadEventMessage(value: unknown): value is WsThreadEventMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as { type?: unknown; event?: unknown };
  if (message.type !== 'thread_event') return false;
  if (typeof message.event !== 'object' || message.event === null) return false;
  const event = message.event as { type?: unknown; thread?: unknown };
  return typeof event.type === 'string' && THREAD_EVENT_TYPES.has(event.type)
    && typeof event.thread === 'object' && event.thread !== null;
}

export async function handleThreadNotify(
  request: Request,
  getWebSockets: () => WebSocket[],
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(405, 'Method not allowed. Use POST.');
  }

  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON body');
  }
  if (!isThreadEventMessage(message)) {
    return errorResponse(400, 'Expected a thread_event message');
  }

  let delivered = 0;
  for (const ws of getWebSockets()) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    sendWsMessage(ws, message);
    delivered += 1;
  }
  return jsonResponse(200, { delivered });
}
