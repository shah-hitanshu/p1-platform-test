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

import type { ActorPresence, Checkpoint, PresenceState } from '../types';

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
 * Heartbeat to optionally update actor state (active, idle, editing).
 * Not required for presence tracking — the PresenceManager DO retains actors
 * for 8 hours after last activity; normal removal is via actorLeft on disconnect.
 */
export interface WsPresenceHeartbeatMessage {
  type: 'presence_heartbeat';
  /** Optional state update (active, idle, editing) */
  state?: PresenceState;
  /** Client timestamp for latency measurement */
  timestamp: number;
}

/**
 * Request acknowledgment that all preceding messages have been processed.
 * Used before publish to ensure the DO has received the latest CRDT updates
 * sent on this WebSocket connection before the publish HTTP request arrives.
 */
export interface WsDeliveryAckRequestMessage {
  type: 'delivery_ack_request';
  /** Unique request ID for correlating the response */
  requestId: string;
  /** Client timestamp for latency measurement */
  timestamp: number;
}

/**
 * Request the server to publish the current document.
 * TCP ordering guarantees all preceding binary CRDT updates have been processed
 * before this message is handled, eliminating stale-version-on-publish races.
 *
 * The DO handles the entire publish flow: flush to Postgres → create checkpoint.
 */
export interface WsPublishRequestMessage {
  type: 'publish_request';
  /** Unique request ID for correlating the response */
  requestId: string;
  /** Client timestamp for latency measurement */
  timestamp: number;
}

/**
 * Action metadata sent by the Puck client after a CRDT update.
 * Describes the user action that produced the preceding binary Yjs update,
 * so the sync pipeline can record it alongside the version snapshot.
 */
export interface WsActionMetadataMessage {
  type: 'action_metadata';
  /** Array of Puck actions from the frontend's onAction callback */
  puckActions: { type: string; [key: string]: unknown }[];
  /** @deprecated Use puckActions instead */
  actionType?: string;
  /** @deprecated Use puckActions instead */
  actionMetadata?: Record<string, unknown>;
  /** Client timestamp for latency measurement */
  timestamp?: number;
}

/**
 * Union of all client-to-server WebSocket messages.
 */
export type WsClientMessage =
  | WsFocusRegionUpdateMessage
  | WsPresenceHeartbeatMessage
  | WsDeliveryAckRequestMessage
  | WsPublishRequestMessage
  | WsActionMetadataMessage;

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
 * Server acknowledgment that all preceding messages have been processed.
 * Sent in response to delivery_ack_request.
 */
export interface WsDeliveryAckMessage {
  type: 'delivery_ack';
  /** Matches the requestId from the request */
  requestId: string;
  /** Server timestamp */
  timestamp: number;
}

/**
 * Result of a WebSocket-driven publish request.
 * Sent in response to publish_request after the DO completes flush + publish.
 */
export interface WsPublishResultMessage {
  type: 'publish_result';
  /** Matches the requestId from the request */
  requestId: string;
  /** Whether the publish succeeded */
  success: boolean;
  /** The published version ID (on success) */
  publishedVersionId?: string;
  /** The checkpoint created by the publish (on success) */
  checkpoint?: Checkpoint;
  /** Error message (on failure) */
  error?: string;
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
  | WsPresenceErrorMessage
  | WsDeliveryAckMessage
  | WsPublishResultMessage;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a message is a client message.
 */
export function isWsClientMessage(msg: unknown): msg is WsClientMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === 'focus_region_update' ||
    m.type === 'presence_heartbeat' ||
    m.type === 'delivery_ack_request' ||
    m.type === 'publish_request' ||
    m.type === 'action_metadata'
  );
}

/**
 * Check if a message is an action metadata message.
 */
export function isWsActionMetadata(msg: unknown): msg is WsActionMetadataMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === 'action_metadata' &&
    (
      Array.isArray(m.puckActions) ||
      typeof m.actionType === 'string'
    )
  );
}

/**
 * Check if a message is a delivery ack request.
 */
export function isWsDeliveryAckRequest(msg: unknown): msg is WsDeliveryAckRequestMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === 'delivery_ack_request' &&
    typeof m.requestId === 'string' &&
    typeof m.timestamp === 'number'
  );
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
 * Check if a message is a publish request.
 */
export function isWsPublishRequest(msg: unknown): msg is WsPublishRequestMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === 'publish_request' &&
    typeof m.requestId === 'string' &&
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
