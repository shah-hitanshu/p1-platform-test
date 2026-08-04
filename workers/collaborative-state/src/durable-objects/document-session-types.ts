/**
 * Types, interfaces, and constants for the DocumentSession Durable Object.
 * Extracted from document-session.ts for maintainability.
 */

/**
 * Storage key for persisted Yjs document state
 */
export const YDOC_STORAGE_KEY = 'ydoc';

/**
 * Storage key for persisted presence state.
 * Presence is stored in DO storage so it survives DO eviction/re-instantiation.
 */
export const PRESENCE_STORAGE_KEY = 'presenceState';

/**
 * Storage key for persisted edit sessions.
 * Edit sessions are stored in DO storage so they survive DO eviction/re-instantiation.
 * In Miniflare (local dev), DOs can be evicted after ~5-10 seconds of inactivity.
 * In production Cloudflare, DOs can be evicted after ~30 seconds of inactivity.
 */
export const EDIT_SESSIONS_STORAGE_KEY = 'editSessions';

/**
 * Storage key for persisted branch version timestamp.
 * Persisted so that after DO hibernation wake, checkBranchInvalidation()
 * does not spuriously reload from Postgres when the KV timestamp
 * hasn't actually changed.
 */
export const BRANCH_VERSION_STORAGE_KEY = 'lastSeenBranchVersion';

/**
 * Storage key for CoW baseline component IDs.
 * Written during initializeFromHyperdrive() when the CoW fallback path is used
 * (branch has no versions; source branch snapshot is loaded instead).
 * Read and deleted on the first sync write to detect if a stale browser Yjs
 * state has overridden the authoritative CoW baseline (Failure Mode B).
 */
export const COW_BASELINE_IDS_KEY = 'cowBaselineComponentIds';

/**
 * Valid edit operation types
 */
export const VALID_OPERATION_TYPES = ['set', 'delete', 'insert', 'move', 'replace'] as const;

/**
 * Idle timeout before syncing to PostgreSQL (in milliseconds)
 * Sync triggers after 5 seconds of no edits
 */
export const SYNC_IDLE_TIMEOUT_MS = 5000;

// =============================================================================
// Agent Edit Session Types
// =============================================================================

export type { SessionOwner } from '../types';

/**
 * Active edit session tracking
 */
export interface EditSession {
  id: string;
  /** The actor the session belongs to, from the identity the Worker verified. */
  ownerId: string;
  ownerType: 'user' | 'agent';
  trigger: import('../types').CheckpointTrigger;
  intent: string;
  targetRegions: string[];
  checkpointId?: string;
  startedAt: number;
  conflicted?: boolean;
  conflictReason?: string;
}

/**
 * An edit session as persisted before sessions could be owned by a person.
 * `agentId` is read as an agent owner when restoring.
 */
export interface StoredEditSession extends Omit<EditSession, 'ownerId' | 'ownerType'> {
  ownerId?: string;
  ownerType?: 'user' | 'agent';
  agentId?: string;
}

/**
 * Request body for /can-agent-edit endpoint
 */
export interface CanAgentEditRequest {
  agentId: string;
  trigger: 'human_requested' | 'autonomous';
  targetRegions?: string[];
}

/**
 * Request body for /agent-edit-start endpoint
 */
export interface AgentEditStartRequest {
  agentId: string;
  trigger: 'human_requested' | 'autonomous';
  intent: string;
  targetRegions?: string[];
}

/**
 * Request body for /agent-edit-complete endpoint
 */
export interface AgentEditCompleteRequest {
  editSessionId: string;
}

/**
 * Request body for /agent-edit-abort endpoint
 */
export interface AgentEditAbortRequest {
  editSessionId: string;
  reason?: string;
}

/**
 * Request body for /agent-stop endpoint (human-initiated stop)
 */
export interface AgentStopRequest {
  agentId: string;
  reason?: string;
}

/**
 * Session information parsed from the Durable Object ID
 */
export interface SessionInfo {
  siteId: string;
  documentId: string;
  branchId: string;
}

/**
 * Request body for the /apply endpoint
 */
export interface ApplyRequest {
  operations: import('../types').EditOperation[];
  actorId: string;
}

/**
 * Response from the /snapshot endpoint
 */
export interface SnapshotResponse {
  snapshot: Record<string, unknown>;
  stateVector: number[];
  connectedActors: import('../types').ConnectionMeta[];
}

/**
 * Response from the /apply endpoint
 */
export interface ApplyResponse {
  success: boolean;
  snapshot?: Record<string, unknown>;
  operationsApplied?: number;
  error?: string;
}

/**
 * Response from the /sync endpoint
 */
export interface SyncResponse {
  synced: boolean;
  snapshot: Record<string, unknown>;
  stateVector: number[];
}

/**
 * Environment interface for DocumentSession
 */
export interface DocumentSessionEnv {
  API_URL?: string;
  ENVIRONMENT?: string;
  /** Internal API URL for syncing to PostgreSQL */
  INTERNAL_API_URL?: string;
  /** Shared secret for internal API authentication */
  INTERNAL_SECRET?: string;
  /** Enable detailed DO alarm/cleanup metrics (can be high volume) */
  DO_ALARM_METRICS_ENABLED?: string;
  /** Phase 5.1: Queue binding for async DO-to-PostgreSQL sync */
  SYNC_QUEUE?: Queue;
  /** Phase 5.3: Hyperdrive binding for direct DB access from DOs */
  HYPERDRIVE?: Hyperdrive;
  /** Phase 3.2: PresenceManager DO binding for site-level presence aggregation */
  PRESENCE?: DurableObjectNamespace;
  /** DocumentSession DO namespace for cross-branch reload after publish */
  DOCUMENT_STATE?: DurableObjectNamespace;
  /** KV namespace for branch invalidation signals (pull-based DO invalidation) */
  CONFIG_KV?: KVNamespace;
}
