/**
 * WebSocket and HTTP response utilities.
 * Extracted from document-session.ts for maintainability.
 */

import type { ApplyResponse } from './document-session-types';
import type { WsServerMessage, WsPresenceErrorMessage } from '../types/websocket-messages';

/**
 * Decode base64 string to Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Broadcast an update to all connected clients, optionally excluding a sender.
 *
 * @param getWebSockets - Function that returns all WebSockets
 * @param update - The binary update to broadcast
 * @param sender - Optional WebSocket to exclude from the broadcast
 */
export function broadcastUpdate(
  getWebSockets: () => WebSocket[],
  update: Uint8Array,
  sender?: WebSocket,
): void {
  for (const conn of getWebSockets()) {
    if (conn !== sender && conn.readyState === WebSocket.OPEN) {
      conn.send(update);
    }
  }
}

/**
 * Create an error response with ApplyResponse format.
 */
export function errorResponse(status: number, message: string): Response {
  const response: ApplyResponse = {
    success: false,
    error: message,
  };
  return new Response(
    JSON.stringify(response),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Create a JSON response with the given status and data.
 */
export function jsonResponse(status: number, data: unknown): Response {
  return new Response(
    JSON.stringify(data),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Send a WebSocket message to a specific client.
 */
export function sendWsMessage(ws: WebSocket, message: WsServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Broadcast a WebSocket message to all clients except the sender.
 *
 * @param sender - The WebSocket to exclude
 * @param getWebSockets - Function that returns all WebSockets
 * @param message - The message to broadcast
 */
export function broadcastToOthers(
  sender: WebSocket,
  getWebSockets: () => WebSocket[],
  message: WsServerMessage,
): void {
  const json = JSON.stringify(message);
  for (const conn of getWebSockets()) {
    if (conn !== sender && conn.readyState === WebSocket.OPEN) {
      conn.send(json);
    }
  }
}

/**
 * Send a presence error message to a client.
 */
export function sendPresenceError(ws: WebSocket, code: string, message: string): void {
  const error: WsPresenceErrorMessage = {
    type: 'presence_error',
    code,
    message,
    timestamp: Date.now(),
  };
  sendWsMessage(ws, error);
}
