/**
 * WebSocket Presence Message Types
 *
 * Defines the protocol for real-time presence updates over WebSocket.
 * This enables near-instant presence synchronization without HTTP polling.
 *
 * Protocol Design:
 * - Binary frames: Yjs CRDT updates (existing, unchanged)
 * - Text frames: JSON presence/control messages (new)
 *
 * The WebSocket natively distinguishes binary and text frames,
 * so presence messages can coexist with Yjs sync on the same connection.
 */

import type { ActorPresence, PresenceState } from '../types';

// =============================================================================
// Client → Server Messages
// =============================================================================

/**
 * Update focus regions for the current actor.
 * Server will broadcast to other clients and send ack.
 */
export interface WsFocusRegionUpdateMessage {
  type: 'focus_region_update';
  /** JSON paths the actor is focused on (e.g., ['$.hero', '$.content.blocks[0]']) */
  focusRegions: string[];
  /** Client timestamp for latency measurement */
  timestamp: number;
}

/**
 * Heartbeat to keep presence alive and optionally update state.
 * Should be sent periodically (e.g., every 30s) to prevent stale detection.
 */
export interface WsPresenceHeartbeatMessage {
  type: 'presence_heartbeat';
  /** Optional state update (active, idle, editing) */
  state?: PresenceState;
  /** Client timestamp for latency measurement */
  timestamp: number;
}

/**
 * Union of all client-to-server WebSocket messages.
 */
export type WsClientMessage = WsFocusRegionUpdateMessage | WsPresenceHeartbeatMessage;

// =============================================================================
// Server → Client Messages
// =============================================================================

/**
 * Full presence update for all actors in the document.
 * Sent on connect and periodically (e.g., every 10s) for consistency.
 */
export interface WsPresenceUpdateMessage {
  type: 'presence_update';
  /** All actors currently present in the document */
  actors: ActorPresence[];
  /** Server timestamp */
  timestamp: number;
}

/**
 * Incremental broadcast when another actor updates their focus regions.
 * More efficient than full presence updates for focus changes.
 */
export interface WsFocusRegionBroadcastMessage {
  type: 'focus_region_broadcast';
  /** Actor whose focus regions changed */
  actorId: string;
  /** New focus regions for this actor */
  focusRegions: string[];
  /** Server timestamp */
  timestamp: number;
}

/**
 * Acknowledgment of focus region update from client.
 * Confirms the server received and processed the update.
 */
export interface WsFocusRegionAckMessage {
  type: 'focus_region_ack';
  /** Whether the update was accepted */
  success: boolean;
  /** The focus regions that were set */
  focusRegions: string[];
  /** Server timestamp */
  timestamp: number;
}

/**
 * Error message for invalid presence operations.
 */
export interface WsPresenceErrorMessage {
  type: 'presence_error';
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Server timestamp */
  timestamp: number;
}

/**
 * Union of all server-to-client WebSocket messages.
 */
export type WsServerMessage =
  | WsPresenceUpdateMessage
  | WsFocusRegionBroadcastMessage
  | WsFocusRegionAckMessage
  | WsPresenceErrorMessage;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a message is a client message.
 */
export function isWsClientMessage(msg: unknown): msg is WsClientMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === 'focus_region_update' || m.type === 'presence_heartbeat';
}

/**
 * Check if a message is a focus region update.
 */
export function isWsFocusRegionUpdate(msg: unknown): msg is WsFocusRegionUpdateMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === 'focus_region_update' &&
    Array.isArray(m.focusRegions) &&
    typeof m.timestamp === 'number'
  );
}

/**
 * Check if a message is a presence heartbeat.
 */
export function isWsPresenceHeartbeat(msg: unknown): msg is WsPresenceHeartbeatMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === 'presence_heartbeat' &&
    typeof m.timestamp === 'number' &&
    (m.state === undefined || ['active', 'idle', 'editing'].includes(m.state as string))
  );
}
