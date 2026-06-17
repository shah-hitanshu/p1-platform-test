/**
 * Security Limits - Centralized constants for DoS protection
 *
 * These constants prevent resource exhaustion attacks by limiting:
 * - Array sizes
 * - String lengths
 * - Iteration counts
 *
 * When adding new limits, document:
 * - What the limit protects against
 * - The rationale for the specific value
 */

// =============================================================================
// Focus Region Limits
// Used in: activity-detection-service.ts, document-session.ts, realtime-api.ts
// =============================================================================

/**
 * Maximum number of focus regions per actor.
 * Prevents a single user from claiming too many regions.
 * Value: 50 (reasonable for component selection scenarios)
 */
export const MAX_FOCUS_REGIONS_PER_ACTOR = 50;

/**
 * Maximum focus regions per request to the focus-regions endpoint.
 * Same as MAX_FOCUS_REGIONS_PER_ACTOR since they're used together.
 */
export const MAX_FOCUS_REGIONS_PER_REQUEST = 50;

// =============================================================================
// Activity Detection Limits
// Used in: activity-detection-service.ts
// =============================================================================

/**
 * Maximum number of active regions to track.
 * Prevents memory exhaustion from unbounded region accumulation.
 * Value: 500 (allows tracking many concurrent edits)
 */
export const MAX_ACTIVE_REGIONS = 500;

/**
 * Default idle timeout in milliseconds.
 * Time after which humans are considered idle for agent politeness.
 * Value: 5000ms (5 seconds - balances responsiveness and stability)
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 5000;

// =============================================================================
// Conflict Detection Limits
// Used in: document-session.ts
// =============================================================================

/**
 * Maximum overlapping regions to report per conflict.
 * Prevents large memory allocation when many regions conflict.
 * Value: 10 (enough to diagnose issues without exhaustion)
 */
export const MAX_CONFLICT_REGIONS_TO_REPORT = 10;

/**
 * Maximum length for conflict reason strings.
 * Prevents unbounded string concatenation.
 * Value: 500 characters (enough for useful error messages)
 */
export const MAX_CONFLICT_REASON_LENGTH = 500;

// =============================================================================
// Agent Edit Session Limits
// Used in: document-session.ts, realtime-api.ts, agent-context-service.ts
// =============================================================================

/**
 * Maximum target regions per agent edit session.
 * Prevents agents from claiming too many regions.
 * Value: 100 (allows complex multi-region edits)
 */
export const MAX_TARGET_REGIONS = 100;

/**
 * Maximum length for region path strings.
 * Prevents memory issues with deeply nested paths.
 * Value: 256 characters (allows deep nesting like /a/b/c/.../z)
 */
export const MAX_REGION_PATH_LENGTH = 256;

/**
 * Maximum length for reason/intent strings.
 * Prevents memory issues with verbose descriptions.
 * Value: 500 characters (enough for useful context)
 */
export const MAX_REASON_LENGTH = 500;

/**
 * Maximum operations per apply request.
 * Prevents large batch operations from overwhelming the system.
 * Value: 1000 (allows complex edits without DoS risk)
 */
export const MAX_OPERATIONS_PER_REQUEST = 1000;

// =============================================================================
// WebSocket Limits
// Used in: document-session.ts
// =============================================================================

/**
 * Maximum number of concurrent WebSocket connections per document.
 * Prevents resource exhaustion from too many connections.
 * Value: 100 (supports large collaborative sessions)
 */
export const MAX_WEBSOCKET_CONNECTIONS = 100;

/**
 * Maximum WebSocket message size in bytes.
 * Prevents memory exhaustion from oversized messages.
 * Value: 1MB (allows large CRDT updates)
 */
export const MAX_WEBSOCKET_MESSAGE_SIZE = 1024 * 1024;

// =============================================================================
// Actor ID Limits
// Used in: document-session.ts
// =============================================================================

/**
 * Maximum length for actor ID strings.
 * Prevents memory issues with oversized identifiers.
 * Value: 128 characters (sufficient for UUIDs and names)
 */
export const MAX_ACTOR_ID_LENGTH = 128;

// =============================================================================
// Path and Value Limits
// Used in: document-session.ts
// =============================================================================

/**
 * Maximum path depth for nested operations.
 * Prevents stack overflow from deeply nested paths.
 * Value: 50 (allows deep nesting without risk)
 */
export const MAX_PATH_DEPTH = 50;

/**
 * Maximum object nesting depth for values.
 * Prevents stack overflow from recursive value conversion.
 * Value: 50 (allows complex objects without risk)
 */
export const MAX_VALUE_DEPTH = 50;

// =============================================================================
// Intent and Operation Limits
// Used in: document-session.ts, realtime-api.ts, agent-context-service.ts
// =============================================================================

/**
 * Maximum length for intent string.
 * Prevents memory issues with verbose descriptions.
 * Value: 1000 characters (enough for detailed context)
 */
export const MAX_INTENT_LENGTH = 1000;

/**
 * Maximum length for acting-user name strings forwarded from MCP/agent clients.
 * Truncated (not rejected) since the value originates from a trusted OAuth provider.
 * Value: 256 characters (sufficient for any display name)
 */
export const MAX_ACTING_USER_NAME_LENGTH = 256;

/**
 * Maximum length for operation type string.
 * Prevents memory issues with operation categorization.
 * Value: 100 characters (enough for any category name)
 */
export const MAX_OPERATION_TYPE_LENGTH = 100;

// =============================================================================
// URL Parameter Limits
// Used in: realtime-api.ts
// =============================================================================

/**
 * Maximum length for siteId parameter.
 * Prevents memory issues with URL parsing.
 * Value: 128 characters (sufficient for UUIDs and names)
 */
export const MAX_SITE_ID_LENGTH = 128;

/**
 * Maximum length for branchId parameter.
 * Prevents memory issues with URL parsing.
 * Value: 128 characters (sufficient for branch names)
 */
export const MAX_BRANCH_ID_LENGTH = 128;

/**
 * Maximum length for documentPath parameter.
 * Prevents memory issues with URL parsing.
 * Value: 512 characters (allows nested paths)
 */
export const MAX_DOCUMENT_PATH_LENGTH = 512;

/**
 * Maximum length for edit session ID.
 * Prevents memory issues with session tracking.
 * Value: 128 characters (sufficient for generated IDs)
 */
export const MAX_EDIT_SESSION_ID_LENGTH = 128;

// =============================================================================
// Debounce Limits (Scaling Optimizations)
// Used in: document-session.ts
// =============================================================================

/**
 * Debounce window for DO storage persistence (in milliseconds).
 * Instead of persisting on every WebSocket message, edits within this window
 * are batched and persisted once. Always persist immediately on last client
 * disconnect and on /apply HTTP endpoint.
 * Value: 2000ms (2 seconds - acceptable data-at-risk window since connected
 * clients hold state in memory and CRDTs re-sync on reconnect)
 */
export const PERSIST_DEBOUNCE_MS = 2000;

/**
 * Debounce window for WebSocket broadcast batching (in milliseconds).
 * Incoming Yjs updates are batched within this window and merged via
 * Y.mergeUpdates() before broadcasting to all connections. Reduces O(N^2)
 * broadcast work to O(N) per batch window.
 * Value: 50ms (imperceptible to users, significant CPU/network savings)
 */
export const BROADCAST_DEBOUNCE_MS = 50;

// =============================================================================
// Cleanup Timer Limits
// Used in: document-session.ts
// =============================================================================

/**
 * Interval for periodic cleanup of stale data.
 * Runs cleanup of stale presence, focus regions, and active regions.
 * Value: 60000ms (60 seconds - balanced between responsiveness and CPU usage)
 */
export const CLEANUP_INTERVAL_MS = 60000;

/**
 * Maximum age for focus entries before they are considered stale.
 * Focus entries older than this are cleared by periodic cleanup.
 * Value: 60000ms (60 seconds - allows for network delays)
 */
export const FOCUS_STALE_THRESHOLD_MS = 60000;

/**
 * Stale timeout for the site-level PresenceManager DO actor index.
 * Actors are normally removed by actorLeft RPC on webSocketClose (~90s after TCP drop).
 * This is a safety net for the rare case where that RPC fails silently.
 * Long value avoids false eviction of idle-but-connected users from branch/site presence.
 */
export const PRESENCE_DO_STALE_THRESHOLD_MS = 8 * 60 * 60 * 1000; // 8 hours

/**
 * Stale timeout for the DocumentSession DO's local per-document presenceManager.
 * Actors are normally removed by unregisterByActorId on webSocketClose.
 * Kept short because getPresenceList() includes local PM entries — ghost actors
 * here would appear in document presence for the duration of the threshold.
 */
export const LOCAL_PRESENCE_STALE_THRESHOLD_MS = 120000; // 2 minutes

/**
 * Maximum age for agent edit sessions before they are considered orphaned.
 * Edit sessions older than this are cleared by periodic cleanup.
 * Value: 600000ms (10 minutes - balances long operations with cleanup speed)
 */
export const MAX_EDIT_SESSION_AGE_MS = 600000;

// =============================================================================
// WebSocket Rate Limiting (Scaling Optimizations)
// Used in: document-session.ts
// =============================================================================

/** Maximum WebSocket messages per second per actor */
export const MAX_MESSAGES_PER_SECOND = 50;

/** Rate limit tracking window in milliseconds */
export const RATE_LIMIT_WINDOW_MS = 1000;

/** Number of consecutive rate limit hits before closing connection */
export const RATE_LIMIT_CLOSE_THRESHOLD = 3;
