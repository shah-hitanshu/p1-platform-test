/**
 * Phase 4.1: DocumentSession Durable Object
 *
 * Manages real-time collaborative editing for a single document on a branch.
 * Uses Yjs CRDT for conflict-free concurrent editing.
 *
 * Session Identifier Format: {siteId}:{documentId}:{branchId}
 *
 * Endpoints:
 * - /connect: WebSocket for real-time collaboration
 * - /snapshot: Get current document state + connected actors
 * - /apply: Apply edit operations programmatically (for agents)
 */

import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import type { DurableObjectState } from '@cloudflare/workers-types';
import type { EditOperation, ConnectionMeta, CheckpointTrigger, ActorPresence } from '../types';
import { runWithConnection, query as dbQuery } from '../db';
import {
  createCheckpoint as createCheckpointDirect,
  revertToCheckpoint as revertToCheckpointDirect,
} from '../services/checkpoint-service';
import { incrementCounter, setGauge, recordTiming } from '../services/metrics-service';
import { PresenceManager, regionsOverlap, type SerializedPresenceState } from '../services/presence-service';
import {
  ActivityDetector,
  type ActivityDetectorState,
} from '../services/activity-detection-service';
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  MAX_OPERATIONS_PER_REQUEST,
  MAX_WEBSOCKET_CONNECTIONS,
  MAX_WEBSOCKET_MESSAGE_SIZE,
  MAX_ACTOR_ID_LENGTH,
  MAX_PATH_DEPTH,
  MAX_VALUE_DEPTH,
  MAX_INTENT_LENGTH,
  MAX_TARGET_REGIONS,
  MAX_REASON_LENGTH,
  MAX_CONFLICT_REGIONS_TO_REPORT,
  MAX_CONFLICT_REASON_LENGTH,
  MAX_FOCUS_REGIONS_PER_REQUEST,
  CLEANUP_INTERVAL_MS,
  FOCUS_STALE_THRESHOLD_MS,
  PRESENCE_STALE_THRESHOLD_MS,
  MAX_EDIT_SESSION_AGE_MS,
  PERSIST_DEBOUNCE_MS,
  BROADCAST_DEBOUNCE_MS,
  MAX_MESSAGES_PER_SECOND,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_CLOSE_THRESHOLD,
} from '../constants/security-limits';
import { AgentEditPermissionService } from '../services/agent-edit-permission-service';
import { getOrganizationForSite } from '../services/organization-service';
import { getAgentById } from '../services/agent-service';
import type { Organization } from '../types';
import type {
  WsFocusRegionUpdateMessage,
  WsPresenceHeartbeatMessage,
  WsPresenceUpdateMessage,
  WsFocusRegionBroadcastMessage,
  WsFocusRegionAckMessage,
  WsPresenceErrorMessage,
  WsServerMessage,
} from '../types/websocket-messages';
import { isWsFocusRegionUpdate, isWsPresenceHeartbeat } from '../types/websocket-messages';

/**
 * Storage key for persisted Yjs document state
 */
const YDOC_STORAGE_KEY = 'ydoc';

/**
 * Storage key for persisted presence state.
 * Presence is stored in DO storage so it survives DO eviction/re-instantiation.
 */
const PRESENCE_STORAGE_KEY = 'presenceState';

/**
 * Storage key for persisted edit sessions.
 * Edit sessions are stored in DO storage so they survive DO eviction/re-instantiation.
 * In Miniflare (local dev), DOs can be evicted after ~5-10 seconds of inactivity.
 * In production Cloudflare, DOs can be evicted after ~30 seconds of inactivity.
 */
const EDIT_SESSIONS_STORAGE_KEY = 'editSessions';

/**
 * Valid edit operation types
 */
const VALID_OPERATION_TYPES = ['set', 'delete', 'insert', 'move', 'replace'] as const;

/** Regex for valid actor ID format (alphanumeric, hyphens, underscores) */
const ACTOR_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// =============================================================================
// Agent Edit Session Types
// =============================================================================

/**
 * Active edit session tracking
 */
interface AgentEditSession {
  id: string;
  agentId: string;
  trigger: CheckpointTrigger;
  intent: string;
  targetRegions: string[];
  checkpointId?: string;
  startedAt: number;
  conflicted?: boolean;
  conflictReason?: string;
}

/**
 * Request body for /can-agent-edit endpoint
 */
interface CanAgentEditRequest {
  agentId: string;
  trigger: 'human_requested' | 'autonomous';
  targetRegions?: string[];
}

/**
 * Request body for /agent-edit-start endpoint
 */
interface AgentEditStartRequest {
  agentId: string;
  trigger: 'human_requested' | 'autonomous';
  intent: string;
  targetRegions?: string[];
}

/**
 * Request body for /agent-edit-complete endpoint
 */
interface AgentEditCompleteRequest {
  editSessionId: string;
}

/**
 * Request body for /agent-edit-abort endpoint
 */
interface AgentEditAbortRequest {
  editSessionId: string;
  reason?: string;
}

/**
 * Request body for /agent-stop endpoint (human-initiated stop)
 */
interface AgentStopRequest {
  agentId: string;
  reason?: string;
}

/**
 * Session information parsed from the Durable Object ID
 */
interface SessionInfo {
  siteId: string;
  documentId: string;
  branchId: string;
}

/**
 * Request body for the /apply endpoint
 */
interface ApplyRequest {
  operations: EditOperation[];
  actorId: string;
}

/**
 * Response from the /snapshot endpoint
 */
interface SnapshotResponse {
  snapshot: Record<string, unknown>;
  stateVector: number[];
  connectedActors: ConnectionMeta[];
}

/**
 * Response from the /apply endpoint
 */
interface ApplyResponse {
  success: boolean;
  snapshot?: Record<string, unknown>;
  operationsApplied?: number;
  error?: string;
}

/**
 * Response from the /sync endpoint
 */
interface SyncResponse {
  synced: boolean;
  snapshot: Record<string, unknown>;
  stateVector: number[];
}

/**
 * Environment interface for DocumentSession
 */
interface DocumentSessionEnv {
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
}

/**
 * Idle timeout before syncing to PostgreSQL (in milliseconds)
 * Sync triggers after 5 seconds of no edits
 */
const SYNC_IDLE_TIMEOUT_MS = 5000;

/**
 * DocumentSession Durable Object
 *
 * Each instance manages CRDT state for a single document on a single branch.
 * Multiple users can connect via WebSocket for real-time collaboration.
 */
export class DocumentSession extends DurableObject<DocumentSessionEnv> {
  /** Alias this.ctx as this.state to minimize changes from pre-migration code */
  private get state(): DurableObjectState { return this.ctx; }
  private readonly sessionInfo: SessionInfo;
  private ydoc: Y.Doc;
  private initialized: boolean;

  /** Phase 4.2: Flag for metadata-only init (no CRDT loading) */
  private metadataInitialized = false;

  /** Flag to track if a cleanup alarm is scheduled (avoids redundant setAlarm calls) */
  private cleanupAlarmScheduled = false;

  /** Promise tracking an in-progress sync to prevent concurrent syncs */
  private syncInProgress: Promise<void> | null = null;

  /** Last synced state vector hash for change detection */
  private lastSyncedStateVectorHash: string | null = null;

  // =============================================================================
  // Phase 1.1: Debounced Persistence
  // =============================================================================

  /** Flag indicating that the Y.Doc has been modified and needs to be persisted */
  private persistPending = false;

  // =============================================================================
  // Phase 1.2: Debounced Broadcasts
  // =============================================================================

  /** Accumulated Yjs updates waiting to be broadcast */
  private pendingBroadcastUpdates: Uint8Array[] = [];

  /** Sender WebSocket for each pending broadcast (to exclude from broadcast) */
  private pendingBroadcastSenders: WebSocket[] = [];

  /** Timer ID for the broadcast debounce window */
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;

  // =============================================================================
  // Phase 4.1: WebSocket Rate Limiting
  // =============================================================================

  /** Per-actor message rate tracking for rate limiting */
  private messageRates = new Map<string, {
    timestamps: number[];
    consecutiveRateLimits: number;
    rateLimitedInCurrentWindow: boolean;
  }>();

  // =============================================================================
  // Agent Politeness Services
  // =============================================================================

  /** Presence manager for tracking actors in the document */
  private presenceManager: PresenceManager;

  /** Flag indicating that presence state has been modified and needs to be persisted */
  private presencePersistPending = false;

  /** Activity detector for tracking human activity and idle state */
  private readonly activityDetector: ActivityDetector;

  /** Agent edit permission service for checking if agents can edit */
  private readonly agentEditPermissionService: AgentEditPermissionService;

  /** Active agent edit sessions */
  private readonly editSessions = new Map<string, AgentEditSession>();

  /** Cached organization for this site (null if no org linked, undefined if not yet loaded) */
  private cachedOrganization: Organization | null | undefined = undefined;

  /** Flag indicating whether organization settings have been loaded */
  private orgSettingsLoaded = false;

  constructor(state: unknown, env: unknown) {
    super(state as DurableObjectState, env as DocumentSessionEnv);
    this.sessionInfo = this.parseSessionId();
    this.ydoc = new Y.Doc();
    this.initialized = false;

    // Initialize Agent Politeness services
    this.presenceManager = new PresenceManager();
    this.activityDetector = new ActivityDetector({
      idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    });
    this.agentEditPermissionService = new AgentEditPermissionService({
      activityDetector: this.activityDetector,
      // Agent status lookup would be wired to external service if needed
    });
  }

  /**
   * Check if detailed DO alarm metrics are enabled.
   * These metrics can be high volume and are disabled by default.
   */
  private isAlarmMetricsEnabled(): boolean {
    return this.env.DO_ALARM_METRICS_ENABLED === 'true';
  }

  /**
   * Parse session identifier from Durable Object ID
   * Format: {siteId}:{documentId}:{branchId}
   *
   * Note: We use state.id.name (not state.id.toString()) because:
   * - idFromName(sessionId) stores the name in state.id.name
   * - state.id.toString() returns the internal hex ID, not the name
   */
  private parseSessionId(): SessionInfo {
    // Get the name from the Durable Object ID (set via idFromName)
    // Note: In Miniflare local dev, state.id.name may be undefined even though TypeScript
    // types say it's always a string. We use a type assertion to handle this runtime case.
    const name = this.state.id.name;

    if (name === undefined || name === '') {
      console.error('Durable Object ID has no name - was it created with idFromName()?');
      return {
        siteId: 'unknown',
        documentId: 'unknown',
        branchId: 'unknown',
      };
    }

    const parts = name.split(':');

    if (parts.length >= 3) {
      return {
        siteId: parts[0],
        documentId: parts[1],
        branchId: parts[2],
      };
    }

    console.error(`Malformed session ID name: ${name}`);
    // Default values for malformed IDs (shouldn't happen in practice)
    return {
      siteId: 'unknown',
      documentId: 'unknown',
      branchId: 'unknown',
    };
  }

  /**
   * Get session information (siteId, documentId, branchId)
   */
  getSessionInfo(): SessionInfo {
    return this.sessionInfo;
  }

  /**
   * Create a compact summary of the current Y.Doc state for diagnostic logging.
   * Includes content item count, types, and a truncated JSON preview.
   */
  private snapshotSummary(): string {
    try {
      const root = this.ydoc.getMap('root');
      const json = root.toJSON() as Record<string, unknown>;
      const content = Array.isArray(json.content)
        ? json.content
        : [];
      const types = content
        .map((c: unknown) => {
          const obj = c as Record<string, unknown> | null;
          if (obj !== null && typeof obj === 'object') {
            const t = obj.type;
            return typeof t === 'string' ? t : '?';
          }
          return '?';
        })
        .join(',');
      const preview = JSON.stringify(json).slice(0, 200);
      return `items=${String(content.length)} types=[${types}]`
        + ` preview=${preview}`;
    } catch {
      return '<error reading snapshot>';
    }
  }

  /**
   * Get current connection count
   */
  getConnectionCount(): number {
    return this.state.getWebSockets().length;
  }

  /**
   * Get connection metadata from a WebSocket's serialized attachment.
   */
  private getConnectionMeta(ws: WebSocket): ConnectionMeta | null {
    try {
      return ws.deserializeAttachment() as ConnectionMeta | null;
    } catch {
      return null;
    }
  }

  /**
   * Get all connections paired with their metadata.
   */
  private getAllConnections(): [WebSocket, ConnectionMeta][] {
    const result: [WebSocket, ConnectionMeta][] = [];
    for (const ws of this.state.getWebSockets()) {
      const meta = this.getConnectionMeta(ws);
      if (meta !== null) {
        result.push([ws, meta]);
      }
    }
    return result;
  }

  /**
   * Update session info from request header if not available from state.id.name
   * This is needed because Miniflare (local dev) doesn't provide state.id.name
   */
  /** Storage key for persisted session info (survives hibernation/alarm wakeups) */
  private static readonly SESSION_INFO_KEY = 'sessionInfo';

  private updateSessionInfoFromRequest(request: Request): void {
    // Only update if session info has unknown values (meaning state.id.name wasn't available)
    if (this.sessionInfo.siteId === 'unknown') {
      // Try header first (for regular HTTP requests)
      let sessionId = request.headers.get('X-Session-Id');

      // Fall back to query parameter (for WebSocket requests where headers can't be modified)
      if (sessionId === null || sessionId === '') {
        const url = new URL(request.url);
        sessionId = url.searchParams.get('_sessionId');
      }

      if (sessionId !== null && sessionId !== '') {
        const parts = sessionId.split(':');
        if (parts.length >= 3) {
          this.sessionInfo = {
            siteId: parts[0],
            documentId: parts[1],
            branchId: parts[2],
          };
          // Persist to DO storage so alarm handler can recover session info
          void this.state.storage.put(DocumentSession.SESSION_INFO_KEY, this.sessionInfo);
          console.log(`Session info updated from request: ${JSON.stringify(this.sessionInfo)}`);
        } else {
          console.error(`Invalid session ID format: ${sessionId}`);
        }
      } else {
        console.error(`No session ID found in request. URL: ${request.url}, Headers: X-Session-Id=${request.headers.get('X-Session-Id') ?? 'null'}`);
      }
    }
  }

  /**
   * Restore session info from DO storage when state.id.name is unavailable.
   * This handles alarm wakeups in Miniflare where state.id.name is undefined.
   */
  private async restoreSessionInfoFromStorage(): Promise<void> {
    if (this.sessionInfo.siteId !== 'unknown') {
      return;
    }
    const stored = await this.state.storage.get<SessionInfo>(DocumentSession.SESSION_INFO_KEY);
    if (stored !== undefined && stored.siteId !== 'unknown') {
      this.sessionInfo = stored;
    }
  }

  /**
   * Main fetch handler - routes requests to appropriate handlers
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Update session info from request if state.id.name wasn't available (Miniflare local dev)
      this.updateSessionInfoFromRequest(request);

      // Phase 4.2: Route to appropriate initialization level
      switch (path) {
        // CRDT endpoints — need full Y.Doc initialization
        case '/snapshot':
          await this.initializeCrdtIfNeeded();
          return this.handleSnapshot();

        case '/apply':
          await this.initializeCrdtIfNeeded();
          return await this.handleApplyOperations(request);

        case '/connect':
          await this.initializeCrdtIfNeeded();
          return this.handleWebSocket(request);

        case '/sync':
          await this.initializeCrdtIfNeeded();
          return await this.handleSync(request);

        case '/initialize':
          await this.initializeCrdtIfNeeded();
          return await this.handleInitialize(request);

          // =============================================================
          // Metadata-only endpoints — no CRDT loading needed
          // =============================================================

        case '/presences':
          await this.initializeMetadataIfNeeded();
          return this.handleGetPresences();

        case '/update-focus-regions':
          await this.initializeMetadataIfNeeded();
          return await this.handleUpdateFocusRegions(request);

        case '/activity-state':
          await this.initializeMetadataIfNeeded();
          return this.handleGetActivityState();

        case '/can-agent-edit':
          await this.initializeMetadataIfNeeded();
          return await this.handleCanAgentEdit(request);

        case '/agent-edit-start':
          await this.initializeMetadataIfNeeded();
          return await this.handleAgentEditStart(request);

        case '/agent-edit-complete':
          await this.initializeMetadataIfNeeded();
          return await this.handleAgentEditComplete(request);

        case '/agent-edit-abort':
          await this.initializeMetadataIfNeeded();
          return await this.handleAgentEditAbort(request);

        case '/agent-stop':
          await this.initializeMetadataIfNeeded();
          return await this.handleAgentStop(request);

        case '/edit-sessions':
          await this.initializeMetadataIfNeeded();
          return this.handleGetEditSessions();

        case '/set-idle-timeout':
          await this.initializeMetadataIfNeeded();
          return await this.handleSetIdleTimeout(request);

        case '/org-settings':
          await this.initializeMetadataIfNeeded();
          return this.handleGetOrgSettings();

        case '/org-settings/refresh':
          await this.initializeMetadataIfNeeded();
          return await this.handleRefreshOrgSettings();

        case '/kick-agent':
          await this.initializeMetadataIfNeeded();
          return await this.handleKickAgent(request);

        case '/kick-all-agents':
          await this.initializeMetadataIfNeeded();
          return await this.handleKickAllAgents(request);

        case '/active-agents':
          await this.initializeMetadataIfNeeded();
          return this.handleGetActiveAgents();

        default:
          return new Response(
            JSON.stringify({ error: 'Not Found', path }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
      }
    } catch (error) {
      console.error('DocumentSession error:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  /**
   * Phase 4.2: Initialize metadata only (no CRDT loading).
   * Handles: session info restoration, org settings, edit sessions, presence.
   * Used by presence-only endpoints to avoid expensive Y.Doc loading.
   */
  private async initializeMetadataIfNeeded(): Promise<void> {
    if (this.metadataInitialized) {
      // Ensure org settings are loaded even if already initialized
      await this.loadOrgSettingsIfNeeded();
      return;
    }

    // Phase 3.1: Restore presence state from DO storage
    await this.restorePresence();

    // Load org settings after initialization
    await this.loadOrgSettingsIfNeeded();

    // Restore persisted edit sessions from DO storage
    await this.restoreEditSessions();

    this.metadataInitialized = true;
  }

  /**
   * Phase 4.2: Initialize CRDT state from storage if not already done.
   * First ensures metadata is loaded, then handles Y.Doc loading.
   * Falls back to PostgreSQL if DO storage is empty and internal API is configured.
   */
  private async initializeCrdtIfNeeded(): Promise<void> {
    // Ensure metadata is loaded first
    await this.initializeMetadataIfNeeded();

    if (this.initialized) {
      return;
    }

    const sid = JSON.stringify(this.sessionInfo);
    console.log(`[DO-DIAG] initializeCrdtIfNeeded START session=${sid}`);

    const stored = await this.state.storage.get(YDOC_STORAGE_KEY);

    if (stored instanceof Uint8Array && stored.length > 0) {
      // Priority 1: Use DO storage
      try {
        Y.applyUpdate(this.ydoc, stored);
        this.initialized = true;
        // Set initial state vector hash to prevent unnecessary syncs
        this.lastSyncedStateVectorHash = this.computeStateVectorHash();
        console.log(
          '[DO-DIAG] initializeCrdtIfNeeded LOADED from DO storage,'
          + ` size=${String(stored.length)},`
          + ` ${this.snapshotSummary()}`,
        );
      } catch (error) {
        // Invalid stored data - log and try PostgreSQL fallback
        console.warn('Failed to restore CRDT state from storage:', error);
      }
    } else {
      console.log(
        '[DO-DIAG] initializeCrdtIfNeeded:'
        + ' DO storage empty or not Uint8Array'
        + ` (type=${typeof stored})`,
      );
    }

    // Priority 2: Try to load from PostgreSQL if DO storage was empty or invalid
    if (!this.initialized) {
      const hasHttpApi = this.env.INTERNAL_API_URL !== undefined
        && this.env.INTERNAL_SECRET !== undefined;
      const hasHyperdrive = this.env.HYPERDRIVE !== undefined;
      if (hasHttpApi || hasHyperdrive) {
        try {
          await this.initializeFromPostgres();
          console.log(
            '[DO-DIAG] initializeCrdtIfNeeded'
            + ' LOADED from PostgreSQL,'
            + ` ${this.snapshotSummary()}`,
          );
        } catch (error) {
          console.warn('Failed to initialize from PostgreSQL:', error);
          // Continue with empty state
        }
      }
      this.initialized = true;
    }

    // Phase 1.1: Restore persist pending flag from storage (survives hibernation)
    const pendingFlag = await this.state.storage.get(DocumentSession.PERSIST_PENDING_KEY);
    if (pendingFlag === true) {
      this.persistPending = true;
    }
  }

  /**
   * @deprecated Use initializeMetadataIfNeeded() or initializeCrdtIfNeeded()
   * Kept for backward compatibility during migration.
   */
  private async initializeIfNeeded(): Promise<void> {
    await this.initializeCrdtIfNeeded();
  }

  /**
   * Persist all edit sessions to DO storage.
   * Called whenever sessions are created, modified, or removed.
   */
  private async persistEditSessions(): Promise<void> {
    const sessions: Record<string, AgentEditSession> = {};
    for (const [key, session] of this.editSessions) {
      sessions[key] = session;
    }
    await this.state.storage.put(EDIT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  }

  /**
   * Restore edit sessions from DO storage into the in-memory Map.
   * Called during initialization to recover sessions after DO eviction.
   */
  private async restoreEditSessions(): Promise<void> {
    try {
      const stored = await this.state.storage.get(EDIT_SESSIONS_STORAGE_KEY);
      if (typeof stored !== 'string') {
        return;
      }

      const sessions = JSON.parse(stored) as Record<string, AgentEditSession>;
      const now = Date.now();

      for (const [key, session] of Object.entries(sessions)) {
        // Skip sessions that have exceeded the maximum age
        if (now - session.startedAt > MAX_EDIT_SESSION_AGE_MS) {
          continue;
        }
        this.editSessions.set(key, session);
      }

      if (this.editSessions.size > 0) {
        console.log(`Restored ${String(this.editSessions.size)} edit session(s) from storage`);
      }
    } catch (error) {
      console.warn('Failed to restore edit sessions from storage:', error);
    }
  }

  /**
   * Persist presence state to DO storage.
   * Called immediately on disconnect, debounced on focus updates.
   */
  private async persistPresence(): Promise<void> {
    const serialized = this.presenceManager.serialize();
    await this.state.storage.put(PRESENCE_STORAGE_KEY, serialized);
    this.presencePersistPending = false;
  }

  /**
   * Mark presence as needing persistence (debounced via alarm).
   * Schedules persistence within PERSIST_DEBOUNCE_MS.
   */
  private async markPresencePersistPending(): Promise<void> {
    if (this.presencePersistPending) {
      return;
    }

    this.presencePersistPending = true;

    const dueAt = Date.now() + PERSIST_DEBOUNCE_MS;
    const existingAlarm = await this.state.storage.getAlarm();
    if (existingAlarm === null || existingAlarm > dueAt) {
      await this.state.storage.setAlarm(dueAt);
      this.cleanupAlarmScheduled = true;
    }
  }

  /**
   * Restore presence state from DO storage.
   * Called during initializeIfNeeded() to recover presence after DO eviction.
   */
  private async restorePresence(): Promise<void> {
    try {
      const stored = await this.state.storage.get(PRESENCE_STORAGE_KEY);
      if (stored !== undefined && stored !== null && typeof stored === 'object') {
        const data = stored as SerializedPresenceState;
        if (Array.isArray(data.presences)) {
          this.presenceManager = PresenceManager.deserialize(data);
          console.log(`Restored ${String(this.presenceManager.count())} presence(s) from storage`);
        }
      }
    } catch (error) {
      console.warn('Failed to restore presence from storage:', error);
    }
  }

  /**
   * Phase 3.2: Push presence update to PresenceManager DO.
   * Fire-and-forget: wrapped in try/catch, non-blocking.
   */
  private pushPresenceUpdate(
    type: 'join' | 'leave' | 'focus' | 'state',
    actorId: string,
    extra?: { actor?: ActorPresence; focusRegions?: string[]; state?: string },
  ): void {
    if (this.env.PRESENCE === undefined) {
      return;
    }

    try {
      const presenceId = this.env.PRESENCE.idFromName(this.sessionInfo.siteId);
      const stub = this.env.PRESENCE.get(presenceId);

      const payload = {
        siteId: this.sessionInfo.siteId,
        branchId: this.sessionInfo.branchId,
        documentId: this.sessionInfo.documentId,
      };

      const rpcStub = stub as unknown as Record<string, (arg: unknown) => Promise<void>>;
      let rpcCall: Promise<void> | undefined;

      switch (type) {
        case 'join':
          if (extra?.actor !== undefined) {
            rpcCall = rpcStub.actorJoined({ ...payload, actor: extra.actor });
          }
          break;
        case 'leave':
          rpcCall = rpcStub.actorLeft({ ...payload, actorId });
          break;
        case 'focus':
          if (extra?.focusRegions !== undefined) {
            rpcCall = rpcStub.focusChanged({
              ...payload,
              actorId,
              focusRegions: extra.focusRegions,
            });
          }
          break;
        case 'state':
          if (extra?.state !== undefined) {
            rpcCall = rpcStub.stateChanged({
              ...payload,
              actorId,
              state: extra.state,
            });
          }
          break;
      }

      if (rpcCall !== undefined) {
        rpcCall.catch((error: unknown) => {
          console.warn('Failed to push presence update to PresenceManager:', error);
        });
      }
    } catch (error) {
      console.warn('Failed to get PresenceManager stub:', error);
    }
  }

  /**
   * Load organization settings for this site and update ActivityDetector timeout.
   * Caches the result to avoid repeated lookups.
   */
  private async loadOrgSettingsIfNeeded(): Promise<void> {
    if (this.orgSettingsLoaded) {
      return;
    }

    await this.loadOrganizationSettings();
  }

  /**
   * Load organization settings from the database.
   * Updates the ActivityDetector's idle timeout from org settings.
   */
  private async loadOrganizationSettings(): Promise<void> {
    const { siteId } = this.sessionInfo;

    // Skip for unknown/invalid session IDs
    if (siteId === 'unknown') {
      this.orgSettingsLoaded = true;
      return;
    }

    try {
      const org = await getOrganizationForSite(siteId);
      this.cachedOrganization = org;

      // Update idle timeout from org settings
      if (org?.settings.agentIdleTimeoutMs !== undefined) {
        this.activityDetector.setIdleTimeout(org.settings.agentIdleTimeoutMs);
      }
    } catch (error) {
      console.warn('Failed to load organization settings:', error);
      // Continue with default timeout
      this.cachedOrganization = null;
    }

    this.orgSettingsLoaded = true;
  }

  /**
   * Force refresh of organization settings from the database.
   */
  private async refreshOrganizationSettings(): Promise<void> {
    this.orgSettingsLoaded = false;
    this.cachedOrganization = undefined;
    await this.loadOrganizationSettings();
  }

  /**
   * Load initial state from PostgreSQL.
   * Phase 5.3: Tries direct Hyperdrive first, falls back to HTTP.
   */
  private async initializeFromPostgres(): Promise<void> {
    const { siteId, documentId, branchId } = this.sessionInfo;

    if (
      siteId === 'unknown'
      || documentId === 'unknown'
      || branchId === 'unknown'
    ) {
      return;
    }

    // Phase 5.3: Try direct Hyperdrive path first
    if (this.env.HYPERDRIVE !== undefined) {
      try {
        const loaded = await this.initializeFromHyperdrive();
        if (loaded) return;
      } catch (error) {
        console.warn(
          'Hyperdrive init failed, falling back to HTTP:',
          error,
        );
      }
    }

    await this.initializeFromHttpApi();
  }

  /**
   * Phase 5.3: Initialize from PostgreSQL via Hyperdrive.
   * @returns true if state was loaded
   */
  private async initializeFromHyperdrive(): Promise<boolean> {
    if (this.env.HYPERDRIVE === undefined) return false;

    const { documentId, branchId } = this.sessionInfo;

    interface VersionRow {
      snapshot: Record<string, unknown>;
      crdt_state: Buffer | null;
    }

    const result = await runWithConnection(
      this.env.HYPERDRIVE.connectionString,
      { isHyperdrive: true },
      async () => dbQuery<VersionRow>(
        `SELECT dv.snapshot, dv.crdt_state
         FROM app.document_versions dv
         WHERE dv.document_id = $1 AND dv.branch_id = $2
         ORDER BY dv.version_number DESC LIMIT 1`,
        [documentId, branchId],
      ),
    );

    if (result.rows.length === 0) return false;
    const row = result.rows[0];

    if (row.crdt_state !== null) {
      const base64 = row.crdt_state.toString('base64');
      Y.applyUpdate(this.ydoc, this.base64ToUint8Array(base64));
      console.log(
        `Initialized doc ${documentId} from Hyperdrive CRDT state`,
      );
      await this.persist();
      this.lastSyncedStateVectorHash = this.computeStateVectorHash();
      return true;
    }

    if (typeof row.snapshot === 'object') {
      const root = this.ydoc.getMap('root');
      this.applySnapshotToYMap(root, row.snapshot);
      console.log(
        `Initialized doc ${documentId} from Hyperdrive snapshot`,
      );
      await this.persist();
      this.lastSyncedStateVectorHash = this.computeStateVectorHash();
      return true;
    }

    return false;
  }

  /**
   * Load initial state via HTTP internal API (fallback path).
   */
  private async initializeFromHttpApi(): Promise<void> {
    if (
      this.env.INTERNAL_API_URL === undefined
      || this.env.INTERNAL_SECRET === undefined
    ) {
      return;
    }

    const { siteId, documentId, branchId } = this.sessionInfo;
    const url = new URL(
      `${this.env.INTERNAL_API_URL}/internal/crdt-state`,
    );
    url.searchParams.set('siteId', siteId);
    url.searchParams.set('documentId', documentId);
    url.searchParams.set('branchId', branchId);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'X-Internal-Secret': this.env.INTERNAL_SECRET },
    });

    if (!response.ok) {
      if (response.status === 404) return;
      throw new Error(
        `Failed to load from PostgreSQL: ${String(response.status)}`,
      );
    }

    const rawData = await response.json();
    const data = rawData as {
      found: boolean;
      snapshot?: Record<string, unknown>;
      crdtState?: string | null;
    };

    if (!data.found) return;

    if (typeof data.crdtState === 'string' && data.crdtState !== '') {
      Y.applyUpdate(
        this.ydoc,
        this.base64ToUint8Array(data.crdtState),
      );
      console.log(
        `Initialized doc ${documentId} from PostgreSQL CRDT state`,
      );
      await this.persist();
      this.lastSyncedStateVectorHash = this.computeStateVectorHash();
      return;
    }

    if (
      data.snapshot !== undefined
      && typeof data.snapshot === 'object'
    ) {
      const root = this.ydoc.getMap('root');
      this.applySnapshotToYMap(root, data.snapshot);
      console.log(
        `Initialized doc ${documentId} from PostgreSQL snapshot`,
      );
      await this.persist();
      this.lastSyncedStateVectorHash = this.computeStateVectorHash();
    }
  }

  /**
   * Apply a JSON snapshot to a Y.Map (recursive)
   */
  private applySnapshotToYMap(ymap: Y.Map<unknown>, snapshot: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === null || value === undefined) {
        ymap.set(key, value);
      } else if (Array.isArray(value)) {
        const yarray = new Y.Array();
        for (const item of value) {
          if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            const nestedMap = new Y.Map();
            this.applySnapshotToYMap(nestedMap, item as Record<string, unknown>);
            yarray.push([nestedMap]);
          } else {
            yarray.push([item]);
          }
        }
        ymap.set(key, yarray);
      } else if (typeof value === 'object') {
        const nestedMap = new Y.Map();
        this.applySnapshotToYMap(nestedMap, value as Record<string, unknown>);
        ymap.set(key, nestedMap);
      } else {
        ymap.set(key, value);
      }
    }
  }

  /**
   * Handle /snapshot endpoint
   * Returns current document state and connected actors
   */
  private handleSnapshot(): Response {
    const root = this.ydoc.getMap('root');
    const snapshot = root.toJSON() as Record<string, unknown>;
    const stateVector = Array.from(Y.encodeStateVector(this.ydoc));
    const connectedActors = this.getAllConnections().map(([, m]) => m);

    const response: SnapshotResponse = {
      snapshot,
      stateVector,
      connectedActors,
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * Handle /apply endpoint
   * Applies edit operations programmatically (for agents or API clients)
   */
  private async handleApplyOperations(request: Request): Promise<Response> {
    // Parse request body
    let body: ApplyRequest;
    try {
      body = await request.json();
    } catch {
      return this.errorResponse(400, 'Invalid JSON in request body');
    }

    // Validate actorId
    if (!body.actorId) {
      return this.errorResponse(400, 'actorId is required');
    }

    // Auth Phase 4: Cross-check body actorId against verified header
    const verifiedActorId = request.headers.get('X-Verified-Actor-Id');
    if (verifiedActorId !== null && verifiedActorId !== '' && body.actorId !== verifiedActorId) {
      return this.errorResponse(403, 'Actor ID in request body does not match verified identity');
    }

    // Security: Validate actorId format
    const actorIdError = this.validateActorId(body.actorId);
    if (actorIdError !== null) {
      return this.errorResponse(400, actorIdError);
    }

    // Determine actorType from verified header or client header (default to 'user')
    const actorTypeHeader = request.headers.get('X-Verified-Actor-Type')
      ?? request.headers.get('X-Actor-Type');
    const isAgent = actorTypeHeader === 'agent';

    // Agents must provide a valid editSessionId
    if (isAgent) {
      const editSessionId = (body as { editSessionId?: string }).editSessionId;
      if (editSessionId === undefined || editSessionId === '') {
        return this.errorResponse(400, 'editSessionId is required for agents');
      }

      // Validate the session exists and belongs to this agent
      const session = this.editSessions.get(editSessionId);
      if (!session) {
        return this.errorResponse(403, 'Invalid or expired edit session');
      }

      if (session.agentId !== body.actorId) {
        return this.errorResponse(403, 'Edit session belongs to a different agent');
      }
    }

    // Validate operations array
    if (!Array.isArray(body.operations)) {
      return this.errorResponse(400, 'operations must be an array');
    }

    // Security: Limit operations per request
    if (body.operations.length > MAX_OPERATIONS_PER_REQUEST) {
      return this.errorResponse(400, `Too many operations. Maximum is ${String(MAX_OPERATIONS_PER_REQUEST)}`);
    }

    // Handle empty operations array
    if (body.operations.length === 0) {
      const root = this.ydoc.getMap('root');
      const response: ApplyResponse = {
        success: true,
        snapshot: root.toJSON() as Record<string, unknown>,
        operationsApplied: 0,
      };
      return new Response(
        JSON.stringify(response),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Validate operation types and required fields
    for (const op of body.operations) {
      if (!VALID_OPERATION_TYPES.includes(op.type as typeof VALID_OPERATION_TYPES[number])) {
        return this.errorResponse(400, `Invalid operation type: ${op.type}`);
      }

      // Validate operation has required fields
      const opError = this.validateOperation(op);
      if (opError !== null) {
        return this.errorResponse(400, opError);
      }
    }

    // Apply operations within a transaction
    try {
      this.ydoc.transact(() => {
        for (const op of body.operations) {
          this.applyOperation(op);
        }
      }, body.actorId);
    } catch (error) {
      return this.errorResponse(400, `Failed to apply operations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Persist state
    try {
      await this.persist();
    } catch {
      return this.errorResponse(500, 'Failed to persist state');
    }

    // Broadcast update to connected clients
    const update = Y.encodeStateAsUpdate(this.ydoc);
    this.broadcastUpdate(update);

    // Use actorType from earlier header check
    const actorType = actorTypeHeader ?? 'user';

    // Extract regions (paths) from operations
    const regions = body.operations
      .map((op) => op.path)
      .filter((path): path is string => typeof path === 'string');

    // Track agent conflicts for response
    const agentConflicts: { agentId: string; regions: string[]; sessionId: string }[] = [];

    // Record human activity for the activity detector (if actor is a user)
    if (actorType === 'user') {
      // Schedule cleanup alarm for HTTP-only clients (idempotent if already scheduled)
      void this.scheduleCleanupAlarm();
      this.activityDetector.recordHumanActivity(body.actorId, regions);

      // Check for conflicts with active agent edit sessions
      // Optimized: early termination once conflict found, limited region collection
      for (const session of this.editSessions.values()) {
        const overlappingRegions: string[] = [];
        let conflictFound = false;

        // Use labeled loops for early termination
        regionCheck:
        for (const humanRegion of regions) {
          for (const agentRegion of session.targetRegions) {
            if (regionsOverlap(humanRegion, agentRegion)) {
              overlappingRegions.push(agentRegion);
              conflictFound = true;
              // Limit collected regions to prevent memory issues
              if (overlappingRegions.length >= MAX_CONFLICT_REGIONS_TO_REPORT) {
                break regionCheck;
              }
            }
          }
        }

        if (conflictFound) {
          // Mark session as conflicted
          session.conflicted = true;
          // Build reason with truncation for security
          let reason = `Human activity in overlapping regions: ${overlappingRegions.join(', ')}`;
          if (reason.length > MAX_CONFLICT_REASON_LENGTH) {
            reason = reason.substring(0, MAX_CONFLICT_REASON_LENGTH - 3) + '...';
          }
          session.conflictReason = reason;
          agentConflicts.push({
            agentId: session.agentId,
            regions: overlappingRegions,
            sessionId: session.id,
          });
        }
      }
    }

    // Schedule sync to PostgreSQL after idle timeout
    await this.scheduleSync(body.actorId, actorType as 'user' | 'agent');

    const root = this.ydoc.getMap('root');
    const response: ApplyResponse & { agentConflicts?: typeof agentConflicts } = {
      success: true,
      snapshot: root.toJSON() as Record<string, unknown>,
      operationsApplied: body.operations.length,
    };

    // Include agent conflicts in response if any were detected
    if (agentConflicts.length > 0) {
      response.agentConflicts = agentConflicts;
    }

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * Handle /connect endpoint for WebSocket connections
   */
  private handleWebSocket(request: Request): Response {
    const url = new URL(request.url);

    // Auth Phase 4: Prefer verified identity from worker over client-supplied headers
    const verifiedActorId = request.headers.get('X-Verified-Actor-Id')
      ?? url.searchParams.get('_verifiedActorId');
    const verifiedActorType = request.headers.get('X-Verified-Actor-Type')
      ?? url.searchParams.get('_verifiedActorType');
    const verifiedAuthProvider = request.headers.get('X-Verified-Auth-Provider')
      ?? url.searchParams.get('_verifiedAuthProvider');
    const verifiedEmail = request.headers.get('X-Verified-Email')
      ?? url.searchParams.get('_verifiedEmail');
    const verifiedName = request.headers.get('X-Verified-Name')
      ?? url.searchParams.get('_verifiedName');
    const verifiedAvatarUrl = request.headers.get('X-Verified-Avatar-Url')
      ?? url.searchParams.get('_verifiedAvatarUrl');

    let actorId: string | null;
    let actorType: string | null;
    let isVerified: boolean;
    let authProvider: string | undefined;
    let email: string | undefined;
    let actorName: string | undefined;
    let actorAvatar: string | undefined;

    if (verifiedActorId !== null && verifiedActorId !== '') {
      // Use verified identity from worker
      actorId = verifiedActorId;
      actorType = verifiedActorType;
      isVerified = true;
      authProvider = verifiedAuthProvider ?? undefined;
      email = verifiedEmail ?? undefined;
      actorName = verifiedName ?? undefined;
      actorAvatar = verifiedAvatarUrl ?? undefined;
    } else {
      // Legacy/test path: use client-supplied headers
      actorId = request.headers.get('X-Actor-Id') ?? url.searchParams.get('actorId');
      actorType = request.headers.get('X-Actor-Type') ?? url.searchParams.get('actorType');
      isVerified = false;
    }

    if (actorId === null || actorId === '') {
      return this.errorResponse(400, 'actorId is required (via X-Actor-Id header or actorId query param)');
    }

    if (actorType === null || actorType === '') {
      return this.errorResponse(400, 'actorType is required (via X-Actor-Type header or actorType query param)');
    }

    if (actorType !== 'user' && actorType !== 'agent') {
      return this.errorResponse(400, 'actorType must be "user" or "agent"');
    }

    // Security: Validate actorId format
    const actorIdError = this.validateActorId(actorId);
    if (actorIdError !== null) {
      return this.errorResponse(400, actorIdError);
    }

    // Security: Limit concurrent connections
    if (this.getConnectionCount() >= MAX_WEBSOCKET_CONNECTIONS) {
      return this.errorResponse(503, 'Too many connections. Try again later.');
    }

    // Check if WebSocketPair is available (may not be in test environment)
    if (typeof WebSocketPair === 'undefined') {
      return new Response(
        JSON.stringify({ error: 'WebSocket not supported in this environment' }),
        { status: 501, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Accept the WebSocket connection via Hibernatable API
    // (must happen before serializeAttachment so the runtime tracks the socket)
    this.state.acceptWebSocket(server);

    // Store connection metadata as attachment (Hibernatable WebSocket API)
    const meta: ConnectionMeta = {
      actorId,
      actorType,
      verified: isVerified,
      authProvider: authProvider as ConnectionMeta['authProvider'],
      email,
      name: actorName,
      avatar: actorAvatar,
    };
    server.serializeAttachment(meta);

    // Record WebSocket connection metrics
    incrementCounter('css_ws_connections_total', { action: 'open' });
    setGauge('css_ws_connections_active', this.getConnectionCount());

    // Schedule cleanup alarm if not already scheduled
    void this.scheduleCleanupAlarm();

    // Phase 1.3: Delta encoding — check for client-provided state vector
    const stateVectorParam = url.searchParams.get('stateVector');
    let stateUpdate: Uint8Array;
    if (stateVectorParam !== null && stateVectorParam !== '') {
      try {
        // Decode base64 state vector from client
        const svBinary = atob(stateVectorParam);
        const clientStateVector = new Uint8Array(svBinary.length);
        for (let i = 0; i < svBinary.length; i++) {
          clientStateVector[i] = svBinary.charCodeAt(i);
        }
        // Send only the delta since the client's state vector
        stateUpdate = Y.encodeStateAsUpdate(this.ydoc, clientStateVector);
      } catch {
        // If state vector is invalid, fall back to full state
        stateUpdate = Y.encodeStateAsUpdate(this.ydoc);
      }
    } else {
      // No state vector — send full compacted state
      stateUpdate = Y.encodeStateAsUpdate(this.ydoc);
    }

    console.log(
      '[DO-DIAG] handleWebSocket SEND initial state'
      + ` actor=${actorId},`
      + ` size=${String(stateUpdate.length)},`
      + ` delta=${String(stateVectorParam !== null)},`
      + ` conns=${String(this.getConnectionCount())},`
      + ` session=${JSON.stringify(this.sessionInfo)},`
      + ` ${this.snapshotSummary()}`,
    );
    server.send(stateUpdate);

    // Broadcast presence update to all clients (new connection joined)
    this.broadcastPresenceUpdate();

    // Phase 3.2: Push presence join to PresenceManager DO
    const joinedPresence = this.presenceManager.getByActorId(actorId);
    if (joinedPresence !== undefined) {
      this.pushPresenceUpdate('join', actorId, { actor: joinedPresence });
    }

    // Return the client side of the WebSocket
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Hibernatable WebSocket API: Handle incoming WebSocket messages.
   * Called by the runtime when a message arrives on any accepted WebSocket.
   */
  /**
   * Check rate limit for an actor's WebSocket messages.
   * Returns 'ok' if under limit, 'rate_limited' if over limit,
   * or 'close_connection' if persistent abuse detected.
   */
  private checkRateLimit(actorId: string): 'ok' | 'rate_limited' | 'close_connection' {
    const now = Date.now();
    let entry = this.messageRates.get(actorId);
    if (entry === undefined) {
      entry = { timestamps: [], consecutiveRateLimits: 0, rateLimitedInCurrentWindow: false };
      this.messageRates.set(actorId, entry);
    }

    // Remove timestamps outside the rate limit window
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const prevLength = entry.timestamps.length;
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    // If old timestamps were pruned, we've transitioned to a new window
    if (entry.timestamps.length < prevLength) {
      // If previous window was clean (not rate limited), reset consecutive counter
      if (!entry.rateLimitedInCurrentWindow) {
        entry.consecutiveRateLimits = 0;
      }
      entry.rateLimitedInCurrentWindow = false;
    }

    // Add current timestamp
    entry.timestamps.push(now);

    if (entry.timestamps.length >= MAX_MESSAGES_PER_SECOND) {
      // Only increment consecutive counter once per window
      if (!entry.rateLimitedInCurrentWindow) {
        entry.rateLimitedInCurrentWindow = true;
        entry.consecutiveRateLimits++;
      }
      if (entry.consecutiveRateLimits >= RATE_LIMIT_CLOSE_THRESHOLD) {
        return 'close_connection';
      }
      return 'rate_limited';
    }

    return 'ok';
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.initializeCrdtIfNeeded();

    const meta = this.getConnectionMeta(ws);
    if (meta === null) {
      console.warn('webSocketMessage: no metadata for WebSocket');
      return;
    }

    // Phase 4.1: Rate limit check
    const rateCheck = this.checkRateLimit(meta.actorId);
    if (rateCheck === 'close_connection') {
      const errorMsg: WsPresenceErrorMessage = {
        type: 'presence_error',
        code: 'RATE_LIMITED',
        message: 'Connection closed due to persistent rate limiting',
        timestamp: Date.now(),
      };
      ws.send(JSON.stringify(errorMsg));
      ws.close(1008, 'Rate limit exceeded');
      return;
    }
    if (rateCheck === 'rate_limited') {
      const errorMsg: WsPresenceErrorMessage = {
        type: 'presence_error',
        code: 'RATE_LIMITED',
        message: 'Message rate limit exceeded. Please slow down.',
        timestamp: Date.now(),
      };
      ws.send(JSON.stringify(errorMsg));
      return;
    }

    try {
      // Distinguish text (presence JSON) from binary (Yjs CRDT) messages
      if (typeof message === 'string') {
        this.handlePresenceMessage(ws, meta, message);
        return;
      }

      // Binary frame: Yjs CRDT update
      const data = message;

      // Security: Limit message size
      if (data.byteLength > MAX_WEBSOCKET_MESSAGE_SIZE) {
        console.warn(`WebSocket message too large: ${String(data.byteLength)} bytes`);
        return;
      }

      const update = new Uint8Array(data);

      // Diagnostic: snapshot BEFORE applying update
      const beforeSummary = this.snapshotSummary();

      // Apply update to local doc
      Y.applyUpdate(this.ydoc, update);

      // Diagnostic: snapshot AFTER applying update
      const afterSummary = this.snapshotSummary();
      const otherConnCount = this.state.getWebSockets()
        .filter((c: WebSocket) => c !== ws
          && c.readyState === WebSocket.OPEN)
        .length;
      console.log(
        '[DO-DIAG] webSocketMessage'
        + ` actor=${meta.actorId},`
        + ` updateSize=${String(update.length)},`
        + ` broadcastTo=${String(otherConnCount)},`
        + ` session=${JSON.stringify(this.sessionInfo)}`
        + `\n  BEFORE: ${beforeSummary}`
        + `\n  AFTER:  ${afterSummary}`,
      );

      // Phase 1.2: Batch broadcast — accumulate update and schedule flush
      this.enqueueBroadcast(ws, update);

      // Phase 1.1: Debounced persistence — mark pending instead of persisting directly
      await this.markPersistPending();

      // Schedule sync to PostgreSQL after idle timeout
      await this.scheduleSync(meta.actorId, meta.actorType);
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  }

  /**
   * Hibernatable WebSocket API: Handle WebSocket close.
   * Called by the runtime when a WebSocket connection closes.
   */
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    await this.initializeCrdtIfNeeded();

    const meta = this.getConnectionMeta(ws);
    const actorId = meta?.actorId ?? 'unknown';
    await this.handleWebSocketDisconnect(ws, actorId);
  }

  /**
   * Hibernatable WebSocket API: Handle WebSocket errors.
   * Called by the runtime when a WebSocket connection encounters an error.
   */
  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.initializeCrdtIfNeeded();

    const meta = this.getConnectionMeta(ws);
    const actorId = meta?.actorId ?? 'unknown';
    await this.handleWebSocketDisconnect(ws, actorId);
  }

  /**
   * Handle WebSocket disconnect (close or error).
   * Cleans up actor's presence, focus regions, and triggers sync if needed.
   *
   * Must be awaited so that persist/sync operations complete before the DO
   * is eligible for hibernation (fire-and-forget promises would be cancelled).
   *
   * @param server - The WebSocket connection
   * @param actorId - The actor ID associated with this connection
   */
  private async handleWebSocketDisconnect(server: WebSocket, actorId: string): Promise<void> {
    console.log(
      '[DO-DIAG] handleWebSocketDisconnect'
      + ` actor=${actorId},`
      + ` remainingConns=${String(this.getConnectionCount())},`
      + ` session=${JSON.stringify(this.sessionInfo)},`
      + ` ${this.snapshotSummary()}`,
    );
    // Runtime manages WebSocket removal for Hibernatable API
    incrementCounter('css_ws_connections_total', { action: 'close' });
    setGauge('css_ws_connections_active', this.getConnectionCount());

    // Check if actor has other active connections before cleaning up
    // Filter out the closing socket for accurate count
    const remainingWebSockets = this.state.getWebSockets().filter((ws: WebSocket) => ws !== server);
    let actorHasOtherConnections = false;
    for (const ws of remainingWebSockets) {
      const meta = this.getConnectionMeta(ws);
      if (meta !== null && meta.actorId === actorId) {
        actorHasOtherConnections = true;
        break;
      }
    }

    // Only clean up actor data if they have no other connections
    if (!actorHasOtherConnections) {
      // Clear actor's focus regions from activity detector
      this.activityDetector.clearActorFocus(actorId);

      // Unregister actor from presence manager
      this.presenceManager.unregisterByActorId(actorId);

      // Phase 3.2: Push presence leave to PresenceManager DO
      this.pushPresenceUpdate('leave', actorId);

      // Phase 4.1: Clean up rate tracking
      this.messageRates.delete(actorId);
    }

    // Broadcast presence update to remaining clients (connection left)
    this.broadcastPresenceUpdate();

    // Phase 1.2: Flush any pending broadcasts before checking disconnect
    this.flushPendingBroadcasts();

    // If this was the last connection, clean up and sync
    if (remainingWebSockets.length === 0) {
      // Run one final cleanup before syncing
      // (Cleanup alarm will self-stop if no data to track)
      const cleanupStats = this.runCleanup();

      // Persist edit sessions if any were cleared during cleanup
      if (cleanupStats.sessionsCleared > 0) {
        await this.persistEditSessions();
      }

      // Compact CRDT state to free memory from deleted content
      this.compactCrdtState();

      // Phase 1.1: Flush pending persist and persist compacted state
      this.persistPending = false; // Clear pending flag — we're about to do a full persist
      await this.state.storage.delete(DocumentSession.PERSIST_PENDING_KEY);
      await this.persist();

      // Phase 3.1: Persist presence state immediately on last disconnect
      await this.persistPresence();

      // Trigger sync to PostgreSQL (awaited so it completes before hibernation)
      await this.syncToPostgres();
    }
  }

  /**
   * Compact the Y.Doc CRDT state to free memory from deleted content.
   * This replaces the current Y.Doc with a fresh one containing only current state.
   * Should only be called when there are no active connections.
   */
  private compactCrdtState(): void {
    // Safety check: don't compact if there are active connections
    if (this.getConnectionCount() > 0) {
      console.warn('compactCrdtState called with active connections - skipping');
      return;
    }

    try {
      // Encode current state (this creates a compacted representation)
      const compactedState = Y.encodeStateAsUpdate(this.ydoc);

      // Create a fresh Y.Doc and apply the compacted state
      const newDoc = new Y.Doc();
      Y.applyUpdate(newDoc, compactedState);

      // Replace the old doc with the new one
      this.ydoc = newDoc;

      console.log('CRDT state compacted successfully');
    } catch (error) {
      console.error('Failed to compact CRDT state:', error);
    }
  }

  /**
   * Handle /sync endpoint
   * Manually trigger sync to PostgreSQL (via internal API)
   * Returns current state after sync
   */
  private async handleSync(request: Request): Promise<Response> {
    // Only accept POST method
    if (request.method !== 'POST') {
      return this.errorResponse(405, 'Method not allowed. Use POST.');
    }

    // Persist to DO storage first
    try {
      await this.persist();
    } catch (error) {
      return this.errorResponse(500, `Failed to persist state: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Sync to PostgreSQL via internal API
    await this.syncToPostgres();

    const root = this.ydoc.getMap('root');
    const response: SyncResponse = {
      synced: true,
      snapshot: root.toJSON() as Record<string, unknown>,
      stateVector: Array.from(Y.encodeStateVector(this.ydoc)),
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * Handle /initialize endpoint
   * Initialize CRDT state from PostgreSQL snapshot or CRDT state
   * Used when DO storage is empty but PostgreSQL has data
   */
  private async handleInitialize(request: Request): Promise<Response> {
    // Only accept POST method
    if (request.method !== 'POST') {
      return this.errorResponse(405, 'Method not allowed. Use POST.');
    }

    // Parse request body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return this.errorResponse(400, 'Invalid JSON in request body');
    }

    // Validate body structure
    if (typeof rawBody !== 'object' || rawBody === null) {
      return this.errorResponse(400, 'Request body must be an object');
    }

    const body = rawBody as Record<string, unknown>;

    // Validate snapshot is present
    if (body.snapshot === null || body.snapshot === undefined || typeof body.snapshot !== 'object') {
      return this.errorResponse(400, 'snapshot is required and must be an object');
    }

    const snapshot = body.snapshot as Record<string, unknown>;
    const crdtState = typeof body.crdtState === 'string' ? body.crdtState : null;

    try {
      if (crdtState !== null && crdtState !== '') {
        // Initialize from CRDT state (base64 encoded)
        const crdtBytes = this.base64ToUint8Array(crdtState);
        Y.applyUpdate(this.ydoc, crdtBytes);
      } else {
        // Initialize from JSON snapshot
        this.initializeFromSnapshot(snapshot);
      }

      // Persist the initialized state
      await this.persist();

      const root = this.ydoc.getMap('root');
      return new Response(
        JSON.stringify({
          success: true,
          snapshot: root.toJSON(),
          stateVector: Array.from(Y.encodeStateVector(this.ydoc)),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      return this.errorResponse(500, `Failed to initialize: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Initialize Y.Doc from a JSON snapshot
   */
  private initializeFromSnapshot(snapshot: Record<string, unknown>): void {
    const root = this.ydoc.getMap('root');

    // Clear existing data
    for (const key of root.keys()) {
      root.delete(key);
    }

    // Apply snapshot
    this.ydoc.transact(() => {
      for (const [key, value] of Object.entries(snapshot)) {
        root.set(key, this.toYjsValue(value));
      }
    }, 'initialize');
  }

  /**
   * Decode base64 string to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Apply a single edit operation to the CRDT
   */
  private applyOperation(op: EditOperation): void {
    const root = this.ydoc.getMap('root');

    switch (op.type) {
      case 'set':
        this.setNestedValue(root, op.path, op.value);
        break;

      case 'delete':
        this.deleteNestedValue(root, op.path);
        break;

      case 'insert':
        if (op.index !== undefined) {
          this.insertIntoArray(root, op.path, op.index, op.value);
        }
        break;

      case 'move':
        if (op.fromIndex !== undefined && op.toIndex !== undefined) {
          this.moveInArray(root, op.path, op.fromIndex, op.toIndex);
        }
        break;

      case 'replace':
        this.setNestedValue(root, op.path, op.content);
        break;
    }
  }

  /**
   * Set a value at a nested path in the Yjs document
   * Path format: "key1.key2.key3" or "content.0.props.title" (with array indices)
   */
  private setNestedValue(root: Y.Map<unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Y.Map<unknown> | Y.Array<unknown> = root;

    // Navigate to parent, handling both maps and arrays
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const isNumericIndex = /^\d+$/.test(key);

      let next: unknown;

      if (current instanceof Y.Array) {
        // Current is an array, key should be a numeric index
        if (!isNumericIndex) {
          throw new Error(`Expected numeric index for array at path segment "${String(key)}"`);
        }
        const index = parseInt(key, 10);
        next = current.get(index);
      } else {
        // Current is a map
        next = current.get(key);
      }

      // Check if next segment is a numeric index to determine type
      const nextKey = parts[i + 1];
      const nextIsNumericIndex = nextKey !== undefined && /^\d+$/.test(nextKey);

      if (next instanceof Y.Map || next instanceof Y.Array) {
        current = next;
      } else if (next === undefined || next === null) {
        // Create appropriate type based on next path segment
        if (nextIsNumericIndex) {
          const newArray = new Y.Array();
          if (current instanceof Y.Array) {
            // Can't easily set in array - this is an edge case
            throw new Error('Cannot create nested structure in array');
          } else {
            current.set(key, newArray);
          }
          current = newArray;
        } else {
          const newMap = new Y.Map();
          if (current instanceof Y.Array) {
            throw new Error('Cannot create nested structure in array');
          } else {
            current.set(key, newMap);
          }
          current = newMap;
        }
      } else {
        // Value exists but is not a Y.Map or Y.Array - it's likely a plain object
        // from the JSON structure that needs to be navigated
        throw new Error(`Cannot navigate through non-container value at path segment "${String(key)}"`);
      }
    }

    // Set the final value
    const finalKey = parts[parts.length - 1];
    const isNumericIndex = /^\d+$/.test(finalKey);

    if (current instanceof Y.Array) {
      if (!isNumericIndex) {
        throw new Error(`Expected numeric index for array at final path segment "${String(finalKey)}"`);
      }
      const index = parseInt(finalKey, 10);
      // For arrays, we need to delete and insert to replace
      if (index < current.length) {
        current.delete(index, 1);
      }
      current.insert(index, [this.toYjsValue(value)]);
    } else {
      current.set(finalKey, this.toYjsValue(value));
    }
  }

  /**
   * Delete a value at a nested path
   * Path format: "key1.key2.key3" or "content.0.props.title" (with array indices)
   */
  private deleteNestedValue(root: Y.Map<unknown>, path: string): void {
    const parts = path.split('.');
    let current: Y.Map<unknown> | Y.Array<unknown> = root;

    // Navigate to parent, handling both maps and arrays
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const isNumericIndex = /^\d+$/.test(key);

      let next: unknown;

      if (current instanceof Y.Array) {
        if (!isNumericIndex) {
          return; // Invalid path for array
        }
        const index = parseInt(key, 10);
        next = current.get(index);
      } else {
        next = current.get(key);
      }

      if (next instanceof Y.Map || next instanceof Y.Array) {
        current = next;
      } else {
        return; // Path doesn't exist
      }
    }

    // Delete the final key
    const finalKey = parts[parts.length - 1];
    const isNumericIndex = /^\d+$/.test(finalKey);

    if (current instanceof Y.Array) {
      if (!isNumericIndex) {
        return; // Invalid path for array
      }
      const index = parseInt(finalKey, 10);
      if (index < current.length) {
        current.delete(index, 1);
      }
    } else {
      current.delete(finalKey);
    }
  }

  /**
   * Insert a value into an array at the given path and index
   */
  private insertIntoArray(root: Y.Map<unknown>, path: string, index: number, value: unknown): void {
    const arr = this.getArrayAtPath(root, path);
    if (arr) {
      arr.insert(index, [this.toYjsValue(value)]);
    }
  }

  /**
   * Move an element within an array
   */
  private moveInArray(root: Y.Map<unknown>, path: string, fromIndex: number, toIndex: number): void {
    const arr = this.getArrayAtPath(root, path);
    if (arr && fromIndex < arr.length) {
      // Get the item to move
      const item = arr.get(fromIndex);

      // Remove from old position
      arr.delete(fromIndex, 1);

      // Adjust toIndex if necessary (after removal)
      const adjustedToIndex = toIndex > fromIndex ? toIndex : toIndex;

      // Insert at new position
      arr.insert(adjustedToIndex, [item]);
    }
  }

  /**
   * Get or create a Y.Array at the given path
   * Path format: "key1.key2.key3" or "content.0.items" (with array indices)
   */
  private getArrayAtPath(root: Y.Map<unknown>, path: string): Y.Array<unknown> | null {
    const parts = path.split('.');
    let current: Y.Map<unknown> | Y.Array<unknown> = root;

    // Navigate to parent, handling both maps and arrays
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const isNumericIndex = /^\d+$/.test(key);

      let next: unknown;

      if (current instanceof Y.Array) {
        if (!isNumericIndex) {
          return null; // Invalid path for array
        }
        const index = parseInt(key, 10);
        next = current.get(index);
      } else {
        next = current.get(key);
      }

      if (next instanceof Y.Map || next instanceof Y.Array) {
        current = next;
      } else if (next === undefined || next === null) {
        // Create a map for missing intermediate paths
        if (current instanceof Y.Array) {
          return null; // Can't create in array
        }
        const newMap = new Y.Map();
        current.set(key, newMap);
        current = newMap;
      } else {
        return null; // Path doesn't exist as container
      }
    }

    // Get or create the final array
    const finalKey = parts[parts.length - 1];
    const isNumericIndex = /^\d+$/.test(finalKey);

    let arr: unknown;
    if (current instanceof Y.Array) {
      if (!isNumericIndex) {
        return null;
      }
      arr = current.get(parseInt(finalKey, 10));
    } else {
      arr = current.get(finalKey);
    }

    if (arr instanceof Y.Array) {
      return arr;
    }

    // If it's a regular array, convert it
    if (Array.isArray(arr)) {
      const yArray = new Y.Array();
      yArray.push(arr.map((item) => this.toYjsValue(item)));
      if (current instanceof Y.Array) {
        // Can't easily replace in Y.Array, return null
        return null;
      }
      current.set(finalKey, yArray);
      return yArray;
    }

    return null;
  }

  /**
   * Convert a JavaScript value to a Yjs-compatible value
   * @param value The value to convert
   * @param depth Current recursion depth (for limiting)
   */
  private toYjsValue(value: unknown, depth = 0): unknown {
    // Security: Limit recursion depth
    if (depth > MAX_VALUE_DEPTH) {
      console.warn(`Value exceeds maximum depth of ${String(MAX_VALUE_DEPTH)}`);
      return null;
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        const arr = new Y.Array();
        arr.push(value.map((item) => this.toYjsValue(item, depth + 1)));
        return arr;
      } else {
        const map = new Y.Map();
        for (const [k, v] of Object.entries(value)) {
          map.set(k, this.toYjsValue(v, depth + 1));
        }
        return map;
      }
    }

    return value;
  }

  /**
   * Persist CRDT state to durable storage
   */
  private async persist(): Promise<void> {
    const update = Y.encodeStateAsUpdate(this.ydoc);
    await this.state.storage.put(YDOC_STORAGE_KEY, update);
  }

  // =============================================================================
  // Phase 1.1: Debounced Persistence Helpers
  // =============================================================================

  /** Storage key for persist pending flag (survives hibernation) */
  private static readonly PERSIST_PENDING_KEY = 'persistPending';

  /**
   * Mark that the Y.Doc has been modified and needs to be persisted.
   * Instead of persisting immediately, sets a flag and schedules an alarm
   * to flush within PERSIST_DEBOUNCE_MS. The Y.Doc remains the authoritative
   * in-memory state.
   */
  private async markPersistPending(): Promise<void> {
    if (this.persistPending) {
      return; // Already marked, alarm is already scheduled
    }

    this.persistPending = true;
    await this.state.storage.put(DocumentSession.PERSIST_PENDING_KEY, true);

    // Schedule an alarm to flush persistence if one isn't already set
    // within the debounce window
    const dueAt = Date.now() + PERSIST_DEBOUNCE_MS;
    const existingAlarm = await this.state.storage.getAlarm();
    if (existingAlarm === null || existingAlarm > dueAt) {
      await this.state.storage.setAlarm(dueAt);
      this.cleanupAlarmScheduled = true;
    }
  }

  /**
   * Flush pending persistence if there are uncommitted changes.
   * Called by alarm handler and on last client disconnect.
   */
  private async flushPendingPersist(): Promise<void> {
    if (!this.persistPending) {
      return;
    }

    await this.persist();
    this.persistPending = false;
    await this.state.storage.delete(DocumentSession.PERSIST_PENDING_KEY);
  }

  // =============================================================================
  // Phase 1.2: Debounced Broadcast Helpers
  // =============================================================================

  /**
   * Enqueue a Yjs update for batched broadcast.
   * Updates are accumulated and flushed after BROADCAST_DEBOUNCE_MS.
   *
   * @param sender - The WebSocket that sent the update (excluded from broadcast)
   * @param update - The Yjs update to broadcast
   */
  private enqueueBroadcast(sender: WebSocket, update: Uint8Array): void {
    this.pendingBroadcastUpdates.push(update);
    this.pendingBroadcastSenders.push(sender);

    // Schedule flush if not already scheduled
    this.broadcastTimer ??= setTimeout(() => {
      this.flushPendingBroadcasts();
    }, BROADCAST_DEBOUNCE_MS);
  }

  /**
   * Flush all pending broadcast updates. Merges accumulated Yjs updates
   * into a single update and broadcasts to all connections except senders.
   */
  private flushPendingBroadcasts(): void {
    this.broadcastTimer = null;

    if (this.pendingBroadcastUpdates.length === 0) {
      return;
    }

    // Collect unique senders to exclude
    const senders = new Set(this.pendingBroadcastSenders);

    // Merge all pending updates into one
    let mergedUpdate: Uint8Array;
    if (this.pendingBroadcastUpdates.length === 1) {
      mergedUpdate = this.pendingBroadcastUpdates[0];
    } else {
      mergedUpdate = Y.mergeUpdates(this.pendingBroadcastUpdates);
    }

    // Clear pending state
    this.pendingBroadcastUpdates = [];
    this.pendingBroadcastSenders = [];

    // Broadcast the merged update to all connections except senders
    for (const conn of this.state.getWebSockets()) {
      if (!senders.has(conn) && conn.readyState === WebSocket.OPEN) {
        conn.send(mergedUpdate);
      }
    }
  }

  // =============================================================================
  // PostgreSQL Sync Methods
  // =============================================================================

  /**
   * Compute a simple hash of the Yjs state vector for change detection.
   * Uses a fast string-based hash of the base64-encoded state vector.
   */
  private computeStateVectorHash(): string {
    const stateVector = Y.encodeStateVector(this.ydoc);
    return this.uint8ArrayToBase64(stateVector);
  }

  /** Storage key for sync schedule (survives hibernation) */
  private static readonly SYNC_SCHEDULE_KEY = 'syncSchedule';

  /**
   * Schedule a sync to PostgreSQL after idle timeout using DO alarms.
   * Uses storage-backed scheduling so the sync survives hibernation.
   * Debounces by updating the dueAt time on each call.
   *
   * @param actorId - ID of the actor making the edit
   * @param actorType - Type of actor ('user' or 'agent')
   */
  private async scheduleSync(actorId: string, actorType: 'user' | 'agent'): Promise<void> {
    // Check if the document has actually changed by comparing state vectors
    const currentHash = this.computeStateVectorHash();
    if (currentHash === this.lastSyncedStateVectorHash) {
      console.log('Sync skipped: state vector unchanged (no actual content changes)');
      return;
    }

    // Only schedule if we have internal API configured
    if (this.env.INTERNAL_API_URL === undefined || this.env.INTERNAL_SECRET === undefined) {
      return;
    }

    // Store sync schedule in DO storage (survives hibernation)
    const dueAt = Date.now() + SYNC_IDLE_TIMEOUT_MS;
    await this.state.storage.put(DocumentSession.SYNC_SCHEDULE_KEY, {
      dueAt,
      actorId,
      actorType,
    });

    // Set alarm to fire at the due time, replacing stale or later alarms
    const existingAlarm = await this.state.storage.getAlarm();
    const now = Date.now();
    if (existingAlarm === null || existingAlarm > dueAt || existingAlarm < now) {
      await this.state.storage.setAlarm(dueAt);
      this.cleanupAlarmScheduled = true;
    }
  }

  /**
   * Schedule a cleanup alarm using Durable Object alarms.
   * Alarms are more reliable than setInterval because they:
   * - Survive DO hibernation
   * - Are deduplicated (only one alarm per DO)
   * - Persist across crashes/restarts
   */
  private async scheduleCleanupAlarm(): Promise<void> {
    const metricsEnabled = this.isAlarmMetricsEnabled();

    // Check if alarm is already scheduled (optimization to avoid redundant storage calls)
    if (this.cleanupAlarmScheduled) {
      if (metricsEnabled) {
        incrementCounter('css_do_alarm_schedule_total', { result: 'skipped_cached' });
      }
      return;
    }

    // Check if there's already an alarm set
    const existingAlarm = await this.state.storage.getAlarm();
    if (existingAlarm !== null) {
      this.cleanupAlarmScheduled = true;
      if (metricsEnabled) {
        incrementCounter('css_do_alarm_schedule_total', { result: 'skipped_existing' });
      }
      return;
    }

    // Schedule alarm for CLEANUP_INTERVAL_MS from now
    await this.state.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
    this.cleanupAlarmScheduled = true;
    if (metricsEnabled) {
      incrementCounter('css_do_alarm_schedule_total', { result: 'scheduled' });
    }
  }

  /**
   * Durable Object alarm handler.
   * Called by the runtime when the scheduled alarm fires.
   * Handles sync schedule processing, then runs cleanup and reschedules.
   */
  async alarm(): Promise<void> {
    // Restore session info from storage if state.id.name is unavailable (Miniflare)
    await this.restoreSessionInfoFromStorage();

    // Restore state after potential hibernation wake
    await this.initializeCrdtIfNeeded();

    const startTime = Date.now();
    const metricsEnabled = this.isAlarmMetricsEnabled();

    if (metricsEnabled) {
      incrementCounter('css_do_alarm_fired_total');
    }

    // Reset the scheduled flag since the alarm has fired
    this.cleanupAlarmScheduled = false;

    // Phase 1.1: Flush any pending persistence
    await this.flushPendingPersist();

    // Phase 3.1: Flush pending presence persistence
    if (this.presencePersistPending) {
      await this.persistPresence();
    }

    // Phase 1.3: Run periodic compaction when no connections are active
    if (this.getConnectionCount() === 0) {
      this.compactCrdtState();
    }

    // Process sync schedule if due
    const syncSchedule = await this.state.storage.get<{ dueAt: number; actorId: string; actorType: 'user' | 'agent' }>(DocumentSession.SYNC_SCHEDULE_KEY);
    if (syncSchedule !== undefined && Date.now() >= syncSchedule.dueAt) {
      await this.syncToPostgres(syncSchedule.actorId, syncSchedule.actorType);
    }

    // Run cleanup
    const cleanupStats = this.runCleanup();

    // Persist edit sessions if any were cleared during cleanup
    if (cleanupStats.sessionsCleared > 0) {
      await this.persistEditSessions();
    }

    // Record metrics if enabled
    if (metricsEnabled) {
      // Record cleanup timing
      recordTiming('css_do_cleanup_duration_ms', Date.now() - startTime);

      // Record cleanup stats
      if (cleanupStats.presenceCleared > 0) {
        incrementCounter('css_do_cleanup_items_total', { type: 'presence' }, cleanupStats.presenceCleared);
      }
      if (cleanupStats.focusCleared > 0) {
        incrementCounter('css_do_cleanup_items_total', { type: 'focus' }, cleanupStats.focusCleared);
      }
      if (cleanupStats.sessionsCleared > 0) {
        incrementCounter('css_do_cleanup_items_total', { type: 'edit_session' }, cleanupStats.sessionsCleared);
      }
      if (cleanupStats.regionsCleared) {
        incrementCounter('css_do_cleanup_items_total', { type: 'active_regions' });
      }

      // Record DO state gauges
      setGauge('css_do_connections_count', this.getConnectionCount());
      setGauge('css_do_presence_count', this.presenceManager.count());
      setGauge('css_do_edit_sessions_count', this.editSessions.size);
      setGauge('css_do_active_regions_count', this.activityDetector.getActiveRegions().length);
      setGauge('css_do_focus_regions_count', this.activityDetector.getHumanFocusRegions().length);
    }

    // Determine next alarm time
    // Check for pending sync schedule that hasn't fired yet
    const pendingSyncSchedule = await this.state.storage.get<{ dueAt: number }>(DocumentSession.SYNC_SCHEDULE_KEY);
    let nextAlarmTime: number | null = null;

    if (pendingSyncSchedule !== undefined) {
      // There's a pending sync that needs to fire
      nextAlarmTime = pendingSyncSchedule.dueAt;
    }

    // Phase 1.1: If persist is still pending (e.g., rapid edits), schedule next alarm
    if (this.persistPending) {
      const persistTime = Date.now() + PERSIST_DEBOUNCE_MS;
      nextAlarmTime = nextAlarmTime !== null
        ? Math.min(nextAlarmTime, persistTime)
        : persistTime;
    }

    // Reschedule cleanup alarm if there's still data to track
    if (!this.shouldStopCleanupTimer()) {
      const cleanupTime = Date.now() + CLEANUP_INTERVAL_MS;
      nextAlarmTime = nextAlarmTime !== null
        ? Math.min(nextAlarmTime, cleanupTime)
        : cleanupTime;
    }

    if (nextAlarmTime !== null) {
      await this.state.storage.setAlarm(nextAlarmTime);
      this.cleanupAlarmScheduled = true;
      if (metricsEnabled) {
        incrementCounter('css_do_alarm_decision_total', { decision: 'rescheduled' });
      }
    } else {
      console.log('Cleanup alarm not rescheduled: DO is idle with no data to track');
      if (metricsEnabled) {
        incrementCounter('css_do_alarm_decision_total', { decision: 'stopped' });
      }
    }
  }

  /**
   * Run periodic cleanup of stale data.
   * Clears stale presence entries, focus regions, active regions, and orphaned edit sessions.
   * Self-stops the cleanup timer when the DO is truly idle (no data to clean).
   *
   * @returns Stats about what was cleaned up
   */
  private runCleanup(): {
    presenceCleared: number;
    focusCleared: number;
    sessionsCleared: number;
    regionsCleared: boolean;
    } {
    const now = Date.now();

    // Clear stale presence entries
    const presenceCleared = this.presenceManager.clearStale(PRESENCE_STALE_THRESHOLD_MS);

    // Clear stale focus entries
    const focusCleared = this.activityDetector.clearStaleFocus(FOCUS_STALE_THRESHOLD_MS);

    // Clear active regions when humans are idle
    // This prevents unbounded growth of activeRegions set
    let regionsCleared = false;
    if (this.activityDetector.isHumanIdle()) {
      this.activityDetector.clearRegions();
      regionsCleared = true;
    }

    // Clear orphaned edit sessions (sessions older than MAX_EDIT_SESSION_AGE_MS)
    let sessionsCleared = 0;
    for (const [id, session] of this.editSessions.entries()) {
      if (now - session.startedAt > MAX_EDIT_SESSION_AGE_MS) {
        this.editSessions.delete(id);
        sessionsCleared++;
      }
    }

    // Log cleanup for debugging (only when something was cleared)
    if (presenceCleared > 0 || sessionsCleared > 0 || focusCleared > 0) {
      console.log(
        `Cleanup: cleared ${String(presenceCleared)} presence, ` +
        `${String(focusCleared)} focus, ${String(sessionsCleared)} edit sessions`,
      );
    }

    return { presenceCleared, focusCleared, sessionsCleared, regionsCleared };
  }

  /**
   * Check if the cleanup timer should be stopped.
   * Returns true when there are no connections and no data to clean.
   */
  private shouldStopCleanupTimer(): boolean {
    // Keep running if there are active WebSocket connections
    if (this.getConnectionCount() > 0) {
      return false;
    }

    // Keep running if there are presence entries
    if (this.presenceManager.count() > 0) {
      return false;
    }

    // Keep running if there are active regions
    if (this.activityDetector.getActiveRegions().length > 0) {
      return false;
    }

    // Keep running if there are focus regions
    if (this.activityDetector.getHumanFocusRegions().length > 0) {
      return false;
    }

    // Keep running if there are edit sessions
    if (this.editSessions.size > 0) {
      return false;
    }

    // No data to track, safe to stop
    return true;
  }

  /**
   * Sync current CRDT state to PostgreSQL via the internal API.
   * Called from alarm handler when sync schedule is due, or on last client disconnect.
   * Uses a lock to prevent concurrent syncs which could create duplicate versions.
   *
   * @param actorId - Actor ID for sync attribution (from stored schedule or caller)
   * @param actorType - Actor type for sync attribution
   */
  private async syncToPostgres(actorId?: string, actorType?: 'user' | 'agent'): Promise<void> {
    // If a sync is already in progress, wait for it to complete and return.
    if (this.syncInProgress !== null) {
      console.log('Sync skipped: another sync is already in progress');
      await this.syncInProgress;
      return;
    }

    // Read sync schedule from storage if no actor info provided
    let syncActorId = actorId;
    let syncActorType = actorType ?? 'user' as const;
    if (syncActorId === undefined) {
      const schedule = await this.state.storage.get<{ dueAt: number; actorId: string; actorType: 'user' | 'agent' }>(DocumentSession.SYNC_SCHEDULE_KEY);
      if (schedule !== undefined) {
        syncActorId = schedule.actorId;
        syncActorType = schedule.actorType;
      }
    }

    if (syncActorId === undefined) {
      console.log('Sync skipped: no sync schedule or actor info available');
      return;
    }

    // Check if internal API is configured
    const internalApiUrl = this.env.INTERNAL_API_URL;
    const internalSecret = this.env.INTERNAL_SECRET;
    if (internalApiUrl === undefined || internalSecret === undefined) {
      console.log('Sync skipped: INTERNAL_API_URL or INTERNAL_SECRET not configured');
      return;
    }

    // Set the lock before starting the sync
    this.syncInProgress = this.performSync(internalApiUrl, internalSecret, syncActorId, syncActorType);

    try {
      await this.syncInProgress;
    } finally {
      this.syncInProgress = null;
    }
  }

  /**
   * Perform the actual sync operation.
   * Separated from syncToPostgres to enable proper locking.
   * @param internalApiUrl - The internal API URL (pre-validated)
   * @param internalSecret - The internal secret (pre-validated)
   * @param actorId - Actor ID for sync attribution
   * @param actorType - Actor type for sync attribution
   */
  private async performSync(
    internalApiUrl: string,
    internalSecret: string,
    actorId: string,
    actorType: 'user' | 'agent',
  ): Promise<void> {
    try {
      const root = this.ydoc.getMap('root');
      const snapshot = root.toJSON() as Record<string, unknown>;
      const crdtState = this.uint8ArrayToBase64(Y.encodeStateAsUpdate(this.ydoc));

      // Phase 5.1: Prefer queue-based sync when available
      if (this.env.SYNC_QUEUE !== undefined) {
        await this.env.SYNC_QUEUE.send({
          siteId: this.sessionInfo.siteId,
          documentId: this.sessionInfo.documentId,
          branchId: this.sessionInfo.branchId,
          snapshot,
          crdtState,
          actorId,
          actorType,
          timestamp: Date.now(),
        });
        this.lastSyncedStateVectorHash = this.computeStateVectorHash();
        await this.state.storage.delete(DocumentSession.SYNC_SCHEDULE_KEY);
        console.log(`Queued sync for document ${this.sessionInfo.documentId}`);
        return;
      }

      // Fallback: direct HTTP sync via internal API
      const syncUrl = `${internalApiUrl}/internal/crdt-sync`;

      const response = await fetch(syncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': internalSecret,
        },
        body: JSON.stringify({
          siteId: this.sessionInfo.siteId,
          documentId: this.sessionInfo.documentId,
          branchId: this.sessionInfo.branchId,
          snapshot,
          crdtState,
          actorId,
          actorType,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Sync to PostgreSQL failed: ${String(response.status)} ${errorText}`);
      } else {
        console.log(`Synced document ${this.sessionInfo.documentId} to PostgreSQL`);
        // Update the state vector hash and clear sync schedule after successful sync
        this.lastSyncedStateVectorHash = this.computeStateVectorHash();
        await this.state.storage.delete(DocumentSession.SYNC_SCHEDULE_KEY);
      }
    } catch (error) {
      console.error('Error syncing to PostgreSQL:', error);
    }
  }

  // =============================================================================
  // Agent Checkpoint Internal API Methods (Agent Politeness Protocol)
  // =============================================================================

  /**
   * Create a pre-edit checkpoint for an agent.
   * Phase 6.3: Tries direct Hyperdrive DB access first, falls back to HTTP.
   */
  private async createAgentPreEditCheckpoint(
    agentId: string,
    intent: string,
    trigger: 'human_requested' | 'autonomous',
    targetRegions: string[],
  ): Promise<string | undefined> {
    // Phase 6.3: Try direct Hyperdrive first
    if (this.env.HYPERDRIVE !== undefined) {
      try {
        const result = await runWithConnection(
          this.env.HYPERDRIVE.connectionString,
          { isHyperdrive: true },
          async () =>
            createCheckpointDirect({
              branchId: this.sessionInfo.branchId,
              checkpointType: 'agent_pre_edit',
              createdById: agentId,
              createdByType: 'agent',
              description: `Pre-edit checkpoint: ${intent}`,
              trigger,
              affectedRegions: targetRegions,
            }),
        );
        console.log(`Created pre-edit checkpoint ${result.checkpoint.id} for agent ${agentId} (direct DB)`);
        return result.checkpoint.id;
      } catch (error) {
        console.warn('Direct DB checkpoint failed, falling back to HTTP:', error);
      }
    }

    // Fallback: HTTP internal API
    if (this.env.INTERNAL_API_URL === undefined || this.env.INTERNAL_SECRET === undefined) {
      console.log('Agent checkpoint skipped: no Hyperdrive or internal API configured, using placeholder');
      return `checkpoint-${String(Date.now())}-${Math.random().toString(36).substring(2, 9)}`;
    }

    try {
      const checkpointUrl = `${this.env.INTERNAL_API_URL}/internal/agent-checkpoint-start`;

      const response = await fetch(checkpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': this.env.INTERNAL_SECRET,
        },
        body: JSON.stringify({
          branchId: this.sessionInfo.branchId,
          agentId,
          intent,
          trigger,
          targetRegions,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to create pre-edit checkpoint: ${String(response.status)} ${errorText}`);
        return undefined;
      }

      const rawResult: unknown = await response.json();
      const result = rawResult as { checkpointId: string };
      const { checkpointId } = result;
      console.log(`Created pre-edit checkpoint ${checkpointId} for agent ${agentId}`);
      return checkpointId;
    } catch (error) {
      console.error('Error creating pre-edit checkpoint:', error);
      return undefined;
    }
  }

  /**
   * Create a post-edit checkpoint for an agent.
   * Phase 6.3: Tries direct Hyperdrive DB access first, falls back to HTTP.
   */
  private async createAgentPostEditCheckpoint(
    agentId: string,
    intent: string,
    preEditCheckpointId: string,
    affectedRegions: string[],
  ): Promise<string | undefined> {
    // Phase 6.3: Try direct Hyperdrive first
    if (this.env.HYPERDRIVE !== undefined) {
      try {
        const result = await runWithConnection(
          this.env.HYPERDRIVE.connectionString,
          { isHyperdrive: true },
          async () =>
            createCheckpointDirect({
              branchId: this.sessionInfo.branchId,
              checkpointType: 'agent_post_edit',
              createdById: agentId,
              createdByType: 'agent',
              description: `Post-edit checkpoint: ${intent}`,
              trigger: 'autonomous',
              affectedRegions,
            }),
        );
        console.log(`Created post-edit checkpoint ${result.checkpoint.id} for agent ${agentId} (direct DB)`);
        return result.checkpoint.id;
      } catch (error) {
        console.warn('Direct DB post-edit checkpoint failed, falling back to HTTP:', error);
      }
    }

    // Fallback: HTTP internal API
    if (this.env.INTERNAL_API_URL === undefined || this.env.INTERNAL_SECRET === undefined) {
      console.log('Agent checkpoint skipped: no Hyperdrive or internal API configured');
      return undefined;
    }

    try {
      const checkpointUrl = `${this.env.INTERNAL_API_URL}/internal/agent-checkpoint-complete`;

      const response = await fetch(checkpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': this.env.INTERNAL_SECRET,
        },
        body: JSON.stringify({
          branchId: this.sessionInfo.branchId,
          agentId,
          intent,
          preEditCheckpointId,
          affectedRegions,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to create post-edit checkpoint: ${String(response.status)} ${errorText}`);
        return undefined;
      }

      const rawResult: unknown = await response.json();
      const result = rawResult as { checkpointId: string };
      const { checkpointId } = result;
      console.log(`Created post-edit checkpoint ${checkpointId} for agent ${agentId}`);
      return checkpointId;
    } catch (error) {
      console.error('Error creating post-edit checkpoint:', error);
      return undefined;
    }
  }

  /**
   * Rollback to a pre-edit checkpoint.
   * Phase 6.3: Tries direct Hyperdrive DB access first, falls back to HTTP.
   */
  private async rollbackToAgentCheckpoint(
    checkpointId: string,
    agentId: string,
    reason?: string,
  ): Promise<boolean> {
    // Phase 6.3: Try direct Hyperdrive first
    if (this.env.HYPERDRIVE !== undefined) {
      try {
        const result = await runWithConnection(
          this.env.HYPERDRIVE.connectionString,
          { isHyperdrive: true },
          async () =>
            revertToCheckpointDirect({
              checkpointId,
              createdById: agentId,
              createdByType: 'agent',
              message: reason,
            }),
        );
        const reverted = String(result.documentsReverted);
        console.log(`Rolled back to checkpoint ${checkpointId}, reverted ${reverted} docs (direct DB)`);
        return true;
      } catch (error) {
        console.warn('Direct DB rollback failed, falling back to HTTP:', error);
      }
    }

    // Fallback: HTTP internal API
    if (this.env.INTERNAL_API_URL === undefined || this.env.INTERNAL_SECRET === undefined) {
      console.log('Agent rollback skipped: no Hyperdrive or internal API configured');
      return false;
    }

    try {
      const rollbackUrl = `${this.env.INTERNAL_API_URL}/internal/agent-checkpoint-rollback`;

      const response = await fetch(rollbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': this.env.INTERNAL_SECRET,
        },
        body: JSON.stringify({
          checkpointId,
          agentId,
          reason,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to rollback to checkpoint: ${String(response.status)} ${errorText}`);
        return false;
      }

      const rawResult: unknown = await response.json();
      const result = rawResult as { rolledBack: boolean; documentsReverted: number };
      const { rolledBack, documentsReverted } = result;
      console.log(`Rolled back to checkpoint ${checkpointId}, reverted ${String(documentsReverted)} documents`);
      return rolledBack;
    } catch (error) {
      console.error('Error rolling back to checkpoint:', error);
      return false;
    }
  }

  /**
   * Convert Uint8Array to base64 string
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  /**
   * Broadcast an update to all connected clients
   */
  private broadcastUpdate(update: Uint8Array): void {
    for (const conn of this.state.getWebSockets()) {
      if (conn.readyState === WebSocket.OPEN) {
        conn.send(update);
      }
    }
  }

  /**
   * Create an error response
   */
  private errorResponse(status: number, message: string): Response {
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
   * Create a JSON response with the given status and data
   */
  private jsonResponse(status: number, data: unknown): Response {
    return new Response(
      JSON.stringify(data),
      { status, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // =============================================================================
  // Security Validation Helpers
  // =============================================================================

  /**
   * Validate actor ID format
   * Returns error message if invalid, null if valid
   */
  private validateActorId(actorId: string): string | null {
    if (actorId.length > MAX_ACTOR_ID_LENGTH) {
      return `actorId exceeds maximum length of ${String(MAX_ACTOR_ID_LENGTH)}`;
    }

    if (!ACTOR_ID_PATTERN.test(actorId)) {
      return 'actorId contains invalid characters. Only alphanumeric, hyphens, and underscores allowed.';
    }

    return null;
  }

  /**
   * Validate an edit operation has required fields
   * Returns error message if invalid, null if valid
   */
  private validateOperation(op: EditOperation): string | null {
    // All operations require a path
    if (typeof op.path !== 'string' || op.path === '') {
      return `Operation ${op.type} requires a non-empty path`;
    }

    // Validate path format
    const pathError = this.validatePath(op.path);
    if (pathError !== null) {
      return pathError;
    }

    // Type-specific validation
    switch (op.type) {
      case 'set':
        if (op.value === undefined) {
          return 'set operation requires a value';
        }
        break;

      case 'insert':
        if (typeof op.index !== 'number') {
          return 'insert operation requires an index';
        }
        if (op.value === undefined) {
          return 'insert operation requires a value';
        }
        break;

      case 'move':
        if (typeof op.fromIndex !== 'number') {
          return 'move operation requires fromIndex';
        }
        if (typeof op.toIndex !== 'number') {
          return 'move operation requires toIndex';
        }
        break;

      case 'replace':
        if (op.content === undefined) {
          return 'replace operation requires content';
        }
        break;

      case 'delete':
        // delete only requires path, which we already checked
        break;
    }

    return null;
  }

  /**
   * Validate path format
   * Returns error message if invalid, null if valid
   */
  private validatePath(path: string): string | null {
    const parts = path.split('.');

    // Check for empty segments
    for (const part of parts) {
      if (part === '') {
        return 'Path contains empty segments';
      }
    }

    // Check depth limit
    if (parts.length > MAX_PATH_DEPTH) {
      return `Path exceeds maximum depth of ${String(MAX_PATH_DEPTH)}`;
    }

    return null;
  }

  // =============================================================================
  // Agent Politeness Handlers
  // =============================================================================

  /**
   * Handle GET /presences - Return all presences in the document
   *
   * Merges presence data from two sources:
   * 1. presenceManager - agents in active edit sessions with focus regions
   * 2. connections - users/agents connected via WebSocket
   *
   * This ensures both WebSocket-connected users and agents are visible
   * in the presence system.
   */
  private handleGetPresences(): Response {
    // Get presences from presenceManager (agents in edit sessions)
    const managerPresences: ActorPresence[] = this.presenceManager.getAll();

    // Create a set of actorIds already in presenceManager to avoid duplicates
    const existingActorIds = new Set(managerPresences.map((p) => p.actorId));

    // Convert WebSocket connections to presence entries (if not already tracked)
    const now = new Date().toISOString();
    const connectionPresences: ActorPresence[] = [];

    for (const [, meta] of this.getAllConnections()) {
      // Skip if already tracked in presenceManager
      if (existingActorIds.has(meta.actorId)) {
        continue;
      }

      // Create presence entry from connection metadata
      connectionPresences.push({
        id: `ws-${meta.actorId}`,
        actorId: meta.actorId,
        actorType: meta.actorType,
        role: meta.actorType === 'agent' ? 'agent' : 'human',
        name: meta.name ?? meta.email ?? meta.actorId,
        avatar: meta.avatar,
        state: 'active',
        lastActivityAt: now,
        joinedAt: now,
      });

      // Track to avoid duplicates from multiple connections by same actor
      existingActorIds.add(meta.actorId);
    }

    // Merge both sources
    const presences = [...managerPresences, ...connectionPresences];

    return this.jsonResponse(200, { presences });
  }

  /**
   * Handle POST /update-focus-regions - Record human component selection
   *
   * This allows humans to proactively report their focus before making edits,
   * preventing race conditions where agents might edit the same region.
   */
  private async handleUpdateFocusRegions(request: Request): Promise<Response> {
    // Require POST method
    if (request.method !== 'POST') {
      return this.jsonResponse(405, { error: 'Method not allowed. Use POST.' });
    }

    // Require user actor type (agents should use /agent-edit-start)
    const actorType = request.headers.get('X-Actor-Type');
    if (actorType !== 'user') {
      return this.jsonResponse(403, {
        error: 'Only users can update focus regions. Agents should use /agent-edit-start.',
      });
    }

    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return this.jsonResponse(400, { error: 'Invalid JSON in request body' });
    }

    if (typeof body !== 'object' || body === null) {
      return this.jsonResponse(400, { error: 'Request body must be an object' });
    }

    const bodyObj = body as Record<string, unknown>;

    // Validate actorId
    if (typeof bodyObj.actorId !== 'string' || bodyObj.actorId === '') {
      return this.jsonResponse(400, { error: 'Missing or invalid required field: actorId' });
    }

    // Validate focusRegions
    if (!Array.isArray(bodyObj.focusRegions)) {
      return this.jsonResponse(400, { error: 'Missing or invalid required field: focusRegions' });
    }

    const actorId = bodyObj.actorId;
    const focusRegions = bodyObj.focusRegions as unknown[];

    // Validate each region is a string
    for (const region of focusRegions) {
      if (typeof region !== 'string') {
        return this.jsonResponse(400, { error: 'Each focusRegion must be a string' });
      }
    }

    const validRegions = focusRegions as string[];

    // Enforce maximum limit (uses centralized constant)
    if (validRegions.length > MAX_FOCUS_REGIONS_PER_REQUEST) {
      return this.jsonResponse(400, {
        error: `focusRegions cannot exceed ${String(MAX_FOCUS_REGIONS_PER_REQUEST)} entries`,
      });
    }

    // Schedule cleanup alarm for HTTP-only clients (idempotent if already scheduled)
    void this.scheduleCleanupAlarm();

    // Record focus activity in ActivityDetector
    if (validRegions.length === 0) {
      // Empty array means clear focus
      this.activityDetector.clearActorFocus(actorId);
    } else {
      // Record the focus regions
      this.activityDetector.recordFocusActivity(actorId, validRegions);
    }

    // Also update presence if user is registered
    const presence = this.presenceManager.getByActorId(actorId);
    if (presence) {
      this.presenceManager.updateFocusRegions(presence.id, validRegions);
    } else {
      // Register presence with focus regions
      this.presenceManager.register({
        actorId,
        actorType: 'user',
        name: actorId, // Use actorId as name
        focusRegions: validRegions,
      });
    }

    // Phase 3.1: Schedule debounced presence persistence on focus update
    await this.markPresencePersistPending();

    // Return the current focus regions for this actor
    const focusInfo = this.activityDetector.getFocusInfo(actorId);
    const currentRegions = focusInfo?.regions ?? [];

    return this.jsonResponse(200, {
      success: true,
      focusRegions: currentRegions,
    });
  }

  /**
   * Handle GET /activity-state - Return activity detection state
   */
  private handleGetActivityState(): Response {
    const state: ActivityDetectorState = this.activityDetector.toJSON();

    return this.jsonResponse(200, {
      isIdle: state.isIdle,
      lastActivityAt: state.lastHumanActivityAt,
      activeRegions: state.activeRegions,
      humanFocusRegions: state.humanFocusRegions,
      idleTimeoutMs: this.activityDetector.getIdleTimeoutMs(),
    });
  }

  /**
   * Handle POST /can-agent-edit - Check if agent can proceed with editing
   */
  private async handleCanAgentEdit(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return this.errorResponse(400, 'Invalid JSON body');
    }

    const rawBody = body as Record<string, unknown>;

    // Validate required fields before type narrowing
    if (typeof rawBody.agentId !== 'string' || rawBody.agentId.length === 0) {
      return this.errorResponse(400, 'agentId is required');
    }

    if (rawBody.trigger !== 'human_requested' && rawBody.trigger !== 'autonomous') {
      return this.errorResponse(400, 'trigger must be "human_requested" or "autonomous"');
    }

    const parsed = body as CanAgentEditRequest;

    // Validate agentId format
    const agentIdError = this.validateActorId(parsed.agentId);
    if (agentIdError !== null) {
      return this.errorResponse(400, agentIdError);
    }

    // Validate target regions - REQUIRED for agent politeness enforcement
    if (!Array.isArray(parsed.targetRegions)) {
      return this.errorResponse(400, 'targetRegions is required and must be an array of region paths');
    }
    const targetRegions = parsed.targetRegions;
    if (targetRegions.length === 0) {
      return this.errorResponse(400, 'targetRegions cannot be empty - specify which regions you intend to edit');
    }
    if (targetRegions.length > MAX_TARGET_REGIONS) {
      return this.errorResponse(400, `targetRegions exceeds maximum of ${String(MAX_TARGET_REGIONS)}`);
    }

    // Check permission using AgentEditPermissionService
    const permission = await this.agentEditPermissionService.canAgentEdit({
      agentId: parsed.agentId,
      trigger: parsed.trigger,
      targetRegions,
    });

    // Get conflicting regions
    const conflictingRegions = this.agentEditPermissionService.getConflictingRegions(targetRegions);

    return this.jsonResponse(200, {
      allowed: permission.allowed,
      reason: permission.reason,
      conflictingRegions,
    });
  }

  /**
   * Handle POST /agent-edit-start - Start an agent edit session
   */
  private async handleAgentEditStart(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return this.errorResponse(400, 'Invalid JSON body');
    }

    const rawBody = body as Record<string, unknown>;

    // Validate required fields before type narrowing
    if (typeof rawBody.agentId !== 'string' || rawBody.agentId.length === 0) {
      return this.errorResponse(400, 'agentId is required');
    }

    if (rawBody.trigger !== 'human_requested' && rawBody.trigger !== 'autonomous') {
      return this.errorResponse(400, 'trigger must be "human_requested" or "autonomous"');
    }

    if (typeof rawBody.intent !== 'string' || rawBody.intent.length === 0) {
      return this.errorResponse(400, 'intent is required');
    }

    if (rawBody.intent.length > MAX_INTENT_LENGTH) {
      return this.errorResponse(400, `intent exceeds maximum length of ${String(MAX_INTENT_LENGTH)}`);
    }

    const parsed = body as AgentEditStartRequest;

    // Validate agentId format
    const agentIdError = this.validateActorId(parsed.agentId);
    if (agentIdError !== null) {
      return this.errorResponse(400, agentIdError);
    }

    // Validate target regions - REQUIRED for agent politeness enforcement
    if (!Array.isArray(parsed.targetRegions)) {
      return this.errorResponse(400, 'targetRegions is required and must be an array of region paths');
    }
    const targetRegions = parsed.targetRegions;
    if (targetRegions.length === 0) {
      return this.errorResponse(400, 'targetRegions cannot be empty - specify which regions you intend to edit');
    }
    if (targetRegions.length > MAX_TARGET_REGIONS) {
      return this.errorResponse(400, `targetRegions exceeds maximum of ${String(MAX_TARGET_REGIONS)}`);
    }

    // Check if agent already has an active edit session
    for (const existingSession of this.editSessions.values()) {
      if (existingSession.agentId === parsed.agentId) {
        return this.errorResponse(409, 'Agent already has an active edit session');
      }
    }

    // Check permission
    const permission = await this.agentEditPermissionService.canAgentEdit({
      agentId: parsed.agentId,
      trigger: parsed.trigger,
      targetRegions,
    });

    if (!permission.allowed) {
      return this.jsonResponse(403, {
        allowed: false,
        reason: permission.reason,
      });
    }

    // Look up agent's display name from the registry
    // Wrapped in try-catch because database may not be available in DO context
    let agentName = parsed.agentId;
    try {
      const agent = await getAgentById(parsed.agentId);
      agentName = agent?.name ?? parsed.agentId;
    } catch (error) {
      console.warn('Failed to look up agent name, using agentId:', error);
    }

    // Generate edit session ID using cryptographically secure random
    const editSessionId = `edit-${crypto.randomUUID()}`;

    // Create checkpoint for autonomous work via internal API
    let checkpointId: string | undefined;
    if (parsed.trigger === 'autonomous') {
      checkpointId = await this.createAgentPreEditCheckpoint(
        parsed.agentId,
        parsed.intent,
        parsed.trigger,
        targetRegions,
      );
    }

    // Schedule cleanup alarm for HTTP-only clients (idempotent if already scheduled)
    void this.scheduleCleanupAlarm();

    // Create edit session
    const newSession: AgentEditSession = {
      id: editSessionId,
      agentId: parsed.agentId,
      trigger: parsed.trigger,
      intent: parsed.intent,
      targetRegions,
      checkpointId,
      startedAt: Date.now(),
    };

    this.editSessions.set(editSessionId, newSession);
    await this.persistEditSessions();

    // Register agent presence with focus regions and editing state
    this.presenceManager.register({
      actorId: parsed.agentId,
      actorType: 'agent',
      name: agentName,
      focusRegions: targetRegions,
      intent: parsed.intent,
      state: 'editing',
    });

    // Broadcast presence update to all connected clients
    this.broadcastPresenceUpdate();

    return this.jsonResponse(200, {
      editSessionId,
      checkpointId,
    });
  }

  /**
   * Handle POST /agent-edit-complete - Complete an agent edit session
   */
  private async handleAgentEditComplete(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return this.errorResponse(400, 'Invalid JSON body');
    }

    const parsed = body as AgentEditCompleteRequest;

    if (typeof parsed.editSessionId !== 'string' || parsed.editSessionId.length === 0) {
      return this.errorResponse(400, 'editSessionId is required');
    }

    // Find the edit session
    const session = this.editSessions.get(parsed.editSessionId);
    if (session === undefined) {
      return this.errorResponse(404, 'Edit session not found');
    }

    // Create post-edit checkpoint if there was a pre-edit checkpoint
    let postCheckpointId: string | undefined;
    if (session.checkpointId !== undefined) {
      postCheckpointId = await this.createAgentPostEditCheckpoint(
        session.agentId,
        session.intent,
        session.checkpointId,
        session.targetRegions,
      );
    }

    // Clear agent's presence
    this.presenceManager.unregisterByActorId(session.agentId);

    // Remove the edit session
    this.editSessions.delete(parsed.editSessionId);
    await this.persistEditSessions();

    // Broadcast presence update to all connected clients
    this.broadcastPresenceUpdate();

    return this.jsonResponse(200, {
      success: true,
      checkpointId: postCheckpointId,
    });
  }

  /**
   * Handle POST /agent-edit-abort - Abort an agent edit session
   */
  private async handleAgentEditAbort(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return this.errorResponse(400, 'Invalid JSON body');
    }

    const parsed = body as AgentEditAbortRequest;

    if (typeof parsed.editSessionId !== 'string' || parsed.editSessionId.length === 0) {
      return this.errorResponse(400, 'editSessionId is required');
    }

    if (parsed.reason !== undefined && parsed.reason.length > MAX_REASON_LENGTH) {
      return this.errorResponse(400, `reason exceeds maximum length of ${String(MAX_REASON_LENGTH)}`);
    }

    // Find the edit session
    const session = this.editSessions.get(parsed.editSessionId);
    if (session === undefined) {
      return this.errorResponse(404, 'Edit session not found');
    }

    // Rollback if there was a checkpoint (for autonomous work)
    let rolledBack = false;
    if (session.checkpointId !== undefined) {
      rolledBack = await this.rollbackToAgentCheckpoint(
        session.checkpointId,
        session.agentId,
        parsed.reason,
      );
    }

    // Clear agent's presence
    this.presenceManager.unregisterByActorId(session.agentId);

    // Remove the edit session
    this.editSessions.delete(parsed.editSessionId);
    await this.persistEditSessions();

    // Broadcast presence update to all connected clients
    this.broadcastPresenceUpdate();

    return this.jsonResponse(200, {
      success: true,
      rolledBack,
    });
  }

  /**
   * Handle POST /agent-stop - Stop an agent's edit session (human-initiated)
   *
   * Unlike /agent-edit-abort which requires the editSessionId, this endpoint
   * looks up the session by agentId, making it easier for humans to stop
   * an agent without knowing the session details.
   */
  private async handleAgentStop(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return this.errorResponse(400, 'Invalid JSON body');
    }

    const parsed = body as AgentStopRequest;

    if (typeof parsed.agentId !== 'string' || parsed.agentId.length === 0) {
      return this.errorResponse(400, 'agentId is required');
    }

    if (parsed.reason !== undefined && parsed.reason.length > MAX_REASON_LENGTH) {
      return this.errorResponse(400, `reason exceeds maximum length of ${String(MAX_REASON_LENGTH)}`);
    }

    // Find the edit session by agentId
    let session: AgentEditSession | undefined;
    let sessionId: string | undefined;
    for (const [id, s] of this.editSessions.entries()) {
      if (s.agentId === parsed.agentId) {
        session = s;
        sessionId = id;
        break;
      }
    }

    // If no active session, return success with rolledBack=false
    if (session === undefined || sessionId === undefined) {
      return this.jsonResponse(200, {
        success: true,
        rolledBack: false,
        message: 'No active session for agent',
      });
    }

    // Rollback if there was a checkpoint (for autonomous work)
    let rolledBack = false;
    if (session.checkpointId !== undefined) {
      rolledBack = await this.rollbackToAgentCheckpoint(
        session.checkpointId,
        session.agentId,
        parsed.reason ?? 'Stopped by human user',
      );
    }

    // Clear agent's presence
    this.presenceManager.unregisterByActorId(session.agentId);

    // Remove the edit session
    this.editSessions.delete(sessionId);
    await this.persistEditSessions();

    // Broadcast presence update to all connected clients
    this.broadcastPresenceUpdate();

    return this.jsonResponse(200, {
      success: true,
      rolledBack,
    });
  }

  /**
   * Handle GET /edit-sessions - Return active edit sessions
   */
  private handleGetEditSessions(): Response {
    const sessions = Array.from(this.editSessions.values()).map((session) => ({
      id: session.id,
      agentId: session.agentId,
      trigger: session.trigger,
      intent: session.intent,
      targetRegions: session.targetRegions,
      startedAt: session.startedAt,
      conflicted: session.conflicted,
      conflictReason: session.conflictReason,
    }));

    return this.jsonResponse(200, { sessions });
  }

  /**
   * Handle POST /set-idle-timeout - Configure idle timeout
   */
  private async handleSetIdleTimeout(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return this.errorResponse(400, 'Invalid JSON body');
    }

    const parsed = body as { idleTimeoutMs: number };

    if (typeof parsed.idleTimeoutMs !== 'number') {
      return this.errorResponse(400, 'idleTimeoutMs must be a number');
    }

    if (parsed.idleTimeoutMs < 0) {
      return this.errorResponse(400, 'idleTimeoutMs must be non-negative');
    }

    this.activityDetector.setIdleTimeout(parsed.idleTimeoutMs);

    return this.jsonResponse(200, {
      idleTimeoutMs: this.activityDetector.getIdleTimeoutMs(),
    });
  }

  /**
   * Handle GET /org-settings - Return organization settings for this site
   */
  private handleGetOrgSettings(): Response {
    const org = this.cachedOrganization;

    return this.jsonResponse(200, {
      organizationId: org?.id ?? null,
      organizationName: org?.name ?? null,
      agentIdleTimeoutMs: this.activityDetector.getIdleTimeoutMs(),
    });
  }

  /**
   * Handle POST /org-settings/refresh - Refresh cached organization settings
   */
  private async handleRefreshOrgSettings(): Promise<Response> {
    await this.refreshOrganizationSettings();

    const org = this.cachedOrganization;

    return this.jsonResponse(200, {
      organizationId: org?.id ?? null,
      organizationName: org?.name ?? null,
      agentIdleTimeoutMs: this.activityDetector.getIdleTimeoutMs(),
    });
  }

  // =============================================================================
  // Phase 6: Kill Switch & Active Agents Endpoints
  // =============================================================================

  /**
   * Handle POST /kick-agent - Terminate a specific agent's edit session
   */
  private async handleKickAgent(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return this.errorResponse(400, 'Invalid JSON body');
    }

    const parsed = body as { agentId?: string; reason?: string };

    if (parsed.agentId === undefined || parsed.agentId === '') {
      return this.errorResponse(400, 'agentId is required');
    }

    // Validate reason length if provided
    if (parsed.reason !== undefined && parsed.reason.length > MAX_REASON_LENGTH) {
      return this.errorResponse(400, `reason exceeds maximum length of ${String(MAX_REASON_LENGTH)}`);
    }

    // Find the agent's active edit session
    let sessionToRemove: AgentEditSession | undefined;
    let sessionKey: string | undefined;

    for (const [key, session] of this.editSessions.entries()) {
      if (session.agentId === parsed.agentId) {
        sessionToRemove = session;
        sessionKey = key;
        break;
      }
    }

    if (sessionToRemove === undefined || sessionKey === undefined) {
      return this.errorResponse(404, `Agent session not found for agentId: ${parsed.agentId}`);
    }

    // Remove the edit session
    this.editSessions.delete(sessionKey);
    await this.persistEditSessions();

    // Clear agent's presence
    this.presenceManager.unregisterByActorId(parsed.agentId);

    // Broadcast presence update to all connected clients
    this.broadcastPresenceUpdate();

    // Get the actor who is kicking
    const kickedBy = request.headers.get('X-Actor-Id') ?? 'unknown';

    return this.jsonResponse(200, {
      success: true,
      agentId: parsed.agentId,
      sessionId: sessionToRemove.id,
      reason: parsed.reason ?? 'No reason provided',
      kickedBy,
    });
  }

  /**
   * Handle POST /kick-all-agents - Terminate all active agent edit sessions
   */
  private async handleKickAllAgents(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const parsed = body as { reason?: string };

    // Validate reason length if provided
    if (parsed.reason !== undefined && parsed.reason.length > MAX_REASON_LENGTH) {
      return this.errorResponse(400, `reason exceeds maximum length of ${String(MAX_REASON_LENGTH)}`);
    }

    const kickedBy = request.headers.get('X-Actor-Id') ?? 'unknown';

    // Collect all agent IDs before clearing
    const kickedAgents: string[] = [];
    for (const session of this.editSessions.values()) {
      kickedAgents.push(session.agentId);
    }

    // Clear all edit sessions
    this.editSessions.clear();
    await this.persistEditSessions();

    // Clear all agent presences
    for (const agentId of kickedAgents) {
      this.presenceManager.unregisterByActorId(agentId);
    }

    // Broadcast presence update to all connected clients
    if (kickedAgents.length > 0) {
      this.broadcastPresenceUpdate();
    }

    return this.jsonResponse(200, {
      success: true,
      kickedCount: kickedAgents.length,
      kickedAgents,
      reason: parsed.reason ?? 'No reason provided',
      kickedBy,
    });
  }

  /**
   * Handle GET /active-agents - Return list of active agent edit sessions
   */
  private handleGetActiveAgents(): Response {
    const agents = Array.from(this.editSessions.values()).map((session) => ({
      agentId: session.agentId,
      sessionId: session.id,
      regions: session.targetRegions,
      trigger: session.trigger,
      intent: session.intent,
      startedAt: session.startedAt,
      conflicted: session.conflicted,
    }));

    return this.jsonResponse(200, { agents });
  }

  // =============================================================================
  // WebSocket Presence Protocol Methods
  // =============================================================================

  /**
   * Handle a text (JSON) presence message from a WebSocket client.
   *
   * @param sender - The WebSocket that sent the message
   * @param meta - Connection metadata (actorId, actorType)
   * @param data - The raw JSON string
   */
  private handlePresenceMessage(
    sender: WebSocket,
    meta: ConnectionMeta,
    data: string,
  ): void {
    // Parse JSON message
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      this.sendPresenceError(sender, 'PARSE_ERROR', 'Invalid JSON format');
      return;
    }

    // Route based on message type
    if (isWsFocusRegionUpdate(message)) {
      this.handleWsFocusRegionUpdate(sender, meta, message);
    } else if (isWsPresenceHeartbeat(message)) {
      this.handleWsPresenceHeartbeat(sender, meta, message);
    } else {
      this.sendPresenceError(sender, 'UNKNOWN_TYPE', 'Unknown message type');
    }
  }

  /**
   * Handle a focus_region_update message from a WebSocket client.
   *
   * @param sender - The WebSocket that sent the message
   * @param meta - Connection metadata
   * @param message - The parsed focus_region_update message
   */
  private handleWsFocusRegionUpdate(
    sender: WebSocket,
    meta: ConnectionMeta,
    message: WsFocusRegionUpdateMessage,
  ): void {
    console.log('[DocumentSession] handleWsFocusRegionUpdate called from actor:', meta.actorId, 'focusRegions:', message.focusRegions);
    const { focusRegions } = message;

    // Validate focus regions
    if (!Array.isArray(focusRegions)) {
      this.sendPresenceError(sender, 'INVALID_REGIONS', 'focusRegions must be an array');
      return;
    }

    // Check region count limit
    if (focusRegions.length > MAX_FOCUS_REGIONS_PER_REQUEST) {
      this.sendPresenceError(
        sender,
        'TOO_MANY_REGIONS',
        `Maximum ${String(MAX_FOCUS_REGIONS_PER_REQUEST)} focus regions allowed`,
      );
      return;
    }

    // Validate each region is a string
    const validRegions: string[] = [];
    for (const region of focusRegions) {
      if (typeof region === 'string') {
        validRegions.push(region);
      }
    }

    // Update activity detector with focus regions (for agent politeness)
    this.activityDetector.recordFocusActivity(meta.actorId, validRegions);

    // Update presence manager with focus regions
    const existing = this.presenceManager.getByActorId(meta.actorId);
    if (existing) {
      this.presenceManager.updateFocusRegions(existing.id, validRegions);
    } else {
      // Register new presence entry for this actor
      this.presenceManager.register({
        actorId: meta.actorId,
        actorType: meta.actorType,
        role: meta.actorType === 'agent' ? 'agent' : 'human',
        name: meta.name ?? meta.email ?? meta.actorId,
        avatar: meta.avatar,
        state: 'active',
        focusRegions: validRegions,
      });
    }

    // Send acknowledgment to sender
    const ack: WsFocusRegionAckMessage = {
      type: 'focus_region_ack',
      success: true,
      focusRegions: validRegions,
      timestamp: Date.now(),
    };
    this.sendWsMessage(sender, ack);

    // Broadcast focus region change to other clients
    const broadcast: WsFocusRegionBroadcastMessage = {
      type: 'focus_region_broadcast',
      actorId: meta.actorId,
      focusRegions: validRegions,
      timestamp: Date.now(),
    };
    this.broadcastToOthers(sender, broadcast);

    // Phase 3.1: Schedule debounced presence persistence on focus update
    void this.markPresencePersistPending();

    // Phase 3.2: Push focus change to PresenceManager DO
    this.pushPresenceUpdate('focus', meta.actorId, { focusRegions: validRegions });
  }

  /**
   * Handle a presence_heartbeat message from a WebSocket client.
   *
   * @param sender - The WebSocket that sent the message
   * @param meta - Connection metadata
   * @param message - The parsed presence_heartbeat message
   */
  private handleWsPresenceHeartbeat(
    _sender: WebSocket,
    meta: ConnectionMeta,
    message: WsPresenceHeartbeatMessage,
  ): void {
    // Update activity detector (keeps actor from going stale)
    const existing = this.presenceManager.getByActorId(meta.actorId);
    const currentFocusRegions = existing?.focusRegions ?? [];
    this.activityDetector.recordFocusActivity(meta.actorId, currentFocusRegions);

    // Update presence state if provided
    if (message.state && existing) {
      this.presenceManager.updateState(existing.id, message.state);
    }
  }

  /**
   * Broadcast a presence_update message to all connected clients.
   * Called when actors connect or disconnect.
   */
  private broadcastPresenceUpdate(): void {
    const actors = this.getPresenceList();
    const message: WsPresenceUpdateMessage = {
      type: 'presence_update',
      actors,
      timestamp: Date.now(),
    };

    const json = JSON.stringify(message);
    for (const conn of this.state.getWebSockets()) {
      if (conn.readyState === WebSocket.OPEN) {
        conn.send(json);
      }
    }
  }

  /**
   * Get the current presence list (merges presenceManager with WebSocket connections).
   * Reuses the logic from handleGetPresences.
   */
  private getPresenceList(): ActorPresence[] {
    // Get presences from presenceManager (agents in edit sessions)
    const managerPresences: ActorPresence[] = this.presenceManager.getAll();

    // Create a set of actorIds already in presenceManager to avoid duplicates
    const existingActorIds = new Set(managerPresences.map((p) => p.actorId));

    // Convert WebSocket connections to presence entries (if not already tracked)
    const now = new Date().toISOString();
    const connectionPresences: ActorPresence[] = [];

    for (const [, meta] of this.getAllConnections()) {
      // Skip if already tracked in presenceManager
      if (existingActorIds.has(meta.actorId)) {
        continue;
      }

      // Create presence entry from connection metadata
      connectionPresences.push({
        id: `ws-${meta.actorId}`,
        actorId: meta.actorId,
        actorType: meta.actorType,
        role: meta.actorType === 'agent' ? 'agent' : 'human',
        name: meta.name ?? meta.email ?? meta.actorId,
        avatar: meta.avatar,
        state: 'active',
        lastActivityAt: now,
        joinedAt: now,
      });

      // Track to avoid duplicates from multiple connections by same actor
      existingActorIds.add(meta.actorId);
    }

    // Merge both sources
    return [...managerPresences, ...connectionPresences];
  }

  /**
   * Send a WebSocket message to a specific client.
   */
  private sendWsMessage(ws: WebSocket, message: WsServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast a WebSocket message to all clients except the sender.
   */
  private broadcastToOthers(sender: WebSocket, message: WsServerMessage): void {
    const json = JSON.stringify(message);
    for (const conn of this.state.getWebSockets()) {
      if (conn !== sender && conn.readyState === WebSocket.OPEN) {
        conn.send(json);
      }
    }
  }

  /**
   * Send a presence error message to a client.
   */
  private sendPresenceError(ws: WebSocket, code: string, message: string): void {
    const error: WsPresenceErrorMessage = {
      type: 'presence_error',
      code,
      message,
      timestamp: Date.now(),
    };
    this.sendWsMessage(ws, error);
  }
}
