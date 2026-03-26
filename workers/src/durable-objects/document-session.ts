/**
 * Phase 4.1: DocumentSession Durable Object
 *
 * Manages real-time collaborative editing for a single document on a branch.
 * Uses Yjs CRDT for conflict-free concurrent editing.
 *
 * Session Identifier Format: {siteId}:{documentId}:{branchId}
 */

import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import type { DurableObjectState } from '@cloudflare/workers-types';
import type { ActorPresence, Organization } from '../types';
import { PresenceManager } from '../services/presence-service';
import { ActivityDetector } from '../services/activity-detection-service';
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  PERSIST_DEBOUNCE_MS,
  BROADCAST_DEBOUNCE_MS,
  MAX_EDIT_SESSION_AGE_MS,
} from '../constants/security-limits';
import { AgentEditPermissionService } from '../services/agent-edit-permission-service';
import type { AgentEditSession, SessionInfo, DocumentSessionEnv } from './document-session-types';
import { YDOC_STORAGE_KEY, EDIT_SESSIONS_STORAGE_KEY } from './document-session-types';
import { PostgresSyncManager } from './postgres-sync-manager';
import {
  parseSessionId,
  updateSessionInfoFromRequest,
  restoreSessionInfoFromStorage,
  getAllConnections,
  SESSION_INFO_KEY,
} from './session-id-parser';
import {
  broadcastUpdate as broadcastUpdateFn,
  errorResponse as errorResponseFn,
  jsonResponse as jsonResponseFn,
} from './websocket-utils';
import {
  persistEditSessions as persistEditSessionsFn,
  restoreEditSessions as restoreEditSessionsFn,
} from './edit-session-store';
import { rollbackToAgentCheckpoint } from './agent-checkpoint-client';
import {
  persistPresence as persistPresenceFn,
  restorePresence as restorePresenceFn,
  pushPresenceUpdate as pushPresenceUpdateFn,
} from './presence-persistence';
import {
  loadOrganizationSettings as loadOrgSettingsFn,
  refreshOrganizationSettings as refreshOrgSettingsFn,
} from './org-settings-cache';
import type { CrdtEndpointDeps } from './crdt-endpoint-handlers';
import {
  handleSnapshot,
  handleApplyOperations,
  handleSync,
  handleFlush,
  handleInitialize,
  handleReload,
  checkBranchInvalidation,
} from './crdt-endpoint-handlers';
import type { AlarmCleanupDeps } from './alarm-cleanup-manager';
import {
  handleAlarm,
  runCleanup,
  scheduleCleanupAlarm,
} from './alarm-cleanup-manager';
import type { AgentPolitenessDeps } from './agent-politeness-handlers';
import {
  handleCanAgentEdit,
  handleAgentEditStart,
  handleAgentEditComplete,
  handleAgentEditAbort,
  handleAgentStop,
  handleGetEditSessions,
  handleSetIdleTimeout,
  handleGetOrgSettings,
  handleRefreshOrgSettings,
} from './agent-politeness-handlers';
import {
  handleKickAgent,
  handleKickAllAgents,
  handleGetActiveAgents,
} from './agent-kill-switch-handlers';
import type { PresenceProtocolDeps } from './websocket-presence-protocol';
import {
  handlePresenceMessage,
  tryParseJson,
  handleWsPublishRequest,
  broadcastPresenceUpdate,
  handleGetPresences,
  handleUpdateFocusRegions,
  handleGetActivityState,
} from './websocket-presence-protocol';
import type { WebSocketConnectionDeps, RateLimitEntry } from './websocket-connection-manager';
import {
  handleWebSocket,
  handleWebSocketMessage,
  handleWebSocketClose,
  handleWebSocketError,
  compactCrdtState,
} from './websocket-connection-manager';

/**
 * DocumentSession Durable Object
 *
 * Each instance manages CRDT state for a single document on a single branch.
 * Multiple users can connect via WebSocket for real-time collaboration.
 */
export class DocumentSession extends DurableObject<DocumentSessionEnv> {
  private get state(): DurableObjectState { return this.ctx; }
  private sessionInfo: SessionInfo;
  private ydoc: Y.Doc;
  private initialized: boolean;
  private metadataInitialized = false;
  private cleanupAlarmScheduled = false;
  private lastSeenBranchVersion = 0;
  private readonly syncManager: PostgresSyncManager;

  // Debounced persistence
  private persistPending = false;
  private static readonly PERSIST_PENDING_KEY = 'persistPending';

  // Debounced broadcasts
  private pendingBroadcastUpdates: Uint8Array[] = [];
  private pendingBroadcastSenders: WebSocket[] = [];
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;

  // WebSocket rate limiting
  private messageRates = new Map<string, RateLimitEntry>();

  // Agent politeness state
  private presenceManager: PresenceManager;
  private presencePersistPending = false;
  private readonly activityDetector: ActivityDetector;
  private readonly agentEditPermissionService: AgentEditPermissionService;
  private readonly editSessions = new Map<string, AgentEditSession>();
  private cachedOrganization: Organization | null | undefined = undefined;
  private orgSettingsLoaded = false;

  constructor(state: unknown, env: unknown) {
    super(state as DurableObjectState, env as DocumentSessionEnv);
    this.sessionInfo = parseSessionId(this.state.id.name);
    this.ydoc = new Y.Doc();
    this.initialized = false;
    this.presenceManager = new PresenceManager();
    this.activityDetector = new ActivityDetector({ idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS });
    this.agentEditPermissionService = new AgentEditPermissionService({
      activityDetector: this.activityDetector,
    });
    this.syncManager = new PostgresSyncManager(
      this.env,
      () => this.sessionInfo,
      () => this.ydoc,
      this.state.storage,
    );
  }

  getSessionInfo(): SessionInfo { return this.sessionInfo; }
  getConnectionCount(): number { return this.state.getWebSockets().length; }

  // =============================================================================
  // Session info helpers
  // =============================================================================

  private updateSessionInfoFromRequest(request: Request): void {
    const { updated, changed } = updateSessionInfoFromRequest(this.sessionInfo, request);
    if (changed) {
      this.sessionInfo = updated;
      void this.state.storage.put(SESSION_INFO_KEY, this.sessionInfo);
    }
  }

  private async restoreSessionInfoFromStorage(): Promise<void> {
    this.sessionInfo = await restoreSessionInfoFromStorage(this.sessionInfo, this.state.storage);
  }

  // =============================================================================
  // Main fetch handler
  // =============================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      this.updateSessionInfoFromRequest(request);

      switch (path) {
        // CRDT endpoints — full Y.Doc initialization + branch check
        case '/snapshot': {
          await this.initializeCrdtIfNeeded();
          const d = this.getCrdtEndpointDeps();
          await checkBranchInvalidation(d);
          return handleSnapshot(d);
        }
        case '/apply': {
          await this.initializeCrdtIfNeeded();
          const d = this.getCrdtEndpointDeps();
          await checkBranchInvalidation(d);
          return await handleApplyOperations(d, request);
        }
        case '/connect': {
          await this.initializeCrdtIfNeeded();
          await checkBranchInvalidation(this.getCrdtEndpointDeps());
          return handleWebSocket(this.getWebSocketConnectionDeps(), request);
        }
        case '/sync': {
          await this.initializeCrdtIfNeeded();
          const d = this.getCrdtEndpointDeps();
          await checkBranchInvalidation(d);
          return await handleSync(d, request);
        }
        case '/flush': {
          await this.initializeCrdtIfNeeded();
          const d = this.getCrdtEndpointDeps();
          await checkBranchInvalidation(d);
          return await handleFlush(d, request);
        }
        case '/initialize': {
          await this.initializeCrdtIfNeeded();
          const d = this.getCrdtEndpointDeps();
          await checkBranchInvalidation(d);
          return await handleInitialize(d, request);
        }
        case '/reload': {
          await this.initializeCrdtIfNeeded();
          return await handleReload(this.getCrdtEndpointDeps(), request);
        }

        // Metadata-only endpoints — no CRDT loading
        case '/presences':
          await this.initializeMetadataIfNeeded();
          return handleGetPresences(this.getPresenceProtocolDeps());
        case '/update-focus-regions':
          await this.initializeMetadataIfNeeded();
          return await handleUpdateFocusRegions(this.getPresenceProtocolDeps(), request);
        case '/activity-state':
          await this.initializeMetadataIfNeeded();
          return handleGetActivityState(this.getPresenceProtocolDeps());

        case '/can-agent-edit':
          await this.initializeMetadataIfNeeded();
          return await handleCanAgentEdit(this.getAgentPolitenessDeps(), request);
        case '/agent-edit-start':
          await this.initializeMetadataIfNeeded();
          return await handleAgentEditStart(this.getAgentPolitenessDeps(), request);
        case '/agent-edit-complete':
          await this.initializeMetadataIfNeeded();
          return await handleAgentEditComplete(this.getAgentPolitenessDeps(), request);
        case '/agent-edit-abort':
          await this.initializeMetadataIfNeeded();
          return await handleAgentEditAbort(this.getAgentPolitenessDeps(), request);
        case '/agent-stop':
          await this.initializeMetadataIfNeeded();
          return await handleAgentStop(this.getAgentPolitenessDeps(), request);
        case '/edit-sessions':
          await this.initializeMetadataIfNeeded();
          return handleGetEditSessions(this.getAgentPolitenessDeps());
        case '/set-idle-timeout':
          await this.initializeMetadataIfNeeded();
          return await handleSetIdleTimeout(this.getAgentPolitenessDeps(), request);
        case '/org-settings':
          await this.initializeMetadataIfNeeded();
          return handleGetOrgSettings(this.getAgentPolitenessDeps());
        case '/org-settings/refresh':
          await this.initializeMetadataIfNeeded();
          return await handleRefreshOrgSettings(this.getAgentPolitenessDeps());
        case '/kick-agent':
          await this.initializeMetadataIfNeeded();
          return await handleKickAgent(this.getAgentPolitenessDeps(), request);
        case '/kick-all-agents':
          await this.initializeMetadataIfNeeded();
          return await handleKickAllAgents(this.getAgentPolitenessDeps(), request);
        case '/active-agents':
          await this.initializeMetadataIfNeeded();
          return handleGetActiveAgents(this.getAgentPolitenessDeps());

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

  // =============================================================================
  // Initialization
  // =============================================================================

  private async initializeMetadataIfNeeded(): Promise<void> {
    if (this.metadataInitialized) {
      await this.loadOrgSettingsIfNeeded();
      return;
    }

    // Restore presence from DO storage
    const restored = await restorePresenceFn(this.state.storage);
    if (restored !== null) {
      this.presenceManager = restored;
    }

    await this.loadOrgSettingsIfNeeded();
    await this.restoreEditSessions();
    await this.cleanupOrphanedPresence();
    this.metadataInitialized = true;
  }

  private async cleanupOrphanedPresence(): Promise<void> {
    try {
      const allPresences = this.presenceManager.getAll();
      let orphanedCount = 0;
      for (const presence of allPresences) {
        if (presence.actorType === 'agent' && presence.state === 'editing') {
          const hasSession = Array.from(this.editSessions.values()).some(
            (s) => s.agentId === presence.actorId,
          );
          if (!hasSession) {
            this.presenceManager.unregisterByActorId(presence.actorId);
            orphanedCount++;
          }
        }
      }
      if (orphanedCount > 0) {
        await this.persistPresence();
        console.log(`Cleaned up ${String(orphanedCount)} orphaned agent presence record(s)`);
      }
    } catch (error) {
      console.warn('Failed to clean up orphaned presence:', error);
    }
  }

  private async initializeCrdtIfNeeded(): Promise<void> {
    await this.initializeMetadataIfNeeded();
    if (this.initialized) return;

    const stored = await this.state.storage.get(YDOC_STORAGE_KEY);
    if (stored instanceof Uint8Array && stored.length > 0) {
      try {
        Y.applyUpdate(this.ydoc, stored);
        this.initialized = true;
        this.syncManager.lastSyncedStateVectorHash = this.syncManager.computeStateVectorHash();
      } catch (error) {
        console.warn('Failed to restore CRDT state from storage:', error);
      }
    }

    if (!this.initialized) {
      const hasHttpApi = this.env.INTERNAL_API_URL !== undefined && this.env.INTERNAL_SECRET !== undefined;
      const hasHyperdrive = this.env.HYPERDRIVE !== undefined;
      if (hasHttpApi || hasHyperdrive) {
        try {
          await this.syncManager.initializeFromPostgres();
        } catch (error) {
          console.warn('Failed to initialize from PostgreSQL:', error);
        }
      }
      this.initialized = true;
      this.syncManager.lastSyncedStateVectorHash ??= this.syncManager.computeStateVectorHash();
    }

    const pendingFlag = await this.state.storage.get(DocumentSession.PERSIST_PENDING_KEY);
    if (pendingFlag === true) {
      this.persistPending = true;
    }
  }

  // =============================================================================
  // Org settings
  // =============================================================================

  private async loadOrgSettingsIfNeeded(): Promise<void> {
    if (this.orgSettingsLoaded) return;
    const result = await loadOrgSettingsFn(this.sessionInfo);
    this.cachedOrganization = result.organization;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- test mocks may omit settings
    if (result.organization?.settings?.agentIdleTimeoutMs !== undefined) {
      this.activityDetector.setIdleTimeout(result.organization.settings.agentIdleTimeoutMs);
    }
    this.orgSettingsLoaded = true;
  }

  private async refreshOrganizationSettings(): Promise<void> {
    this.orgSettingsLoaded = false;
    this.cachedOrganization = undefined;
    const result = await refreshOrgSettingsFn(this.sessionInfo);
    this.cachedOrganization = result.organization;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- test mocks may omit settings
    if (result.organization?.settings?.agentIdleTimeoutMs !== undefined) {
      this.activityDetector.setIdleTimeout(result.organization.settings.agentIdleTimeoutMs);
    }
    this.orgSettingsLoaded = true;
  }

  // =============================================================================
  // State persistence adapters
  // =============================================================================

  private async persistEditSessions(): Promise<void> {
    await persistEditSessionsFn(this.state.storage, this.editSessions);
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
      let expiredCount = 0;
      let rolledBackCount = 0;

      for (const [key, session] of Object.entries(sessions)) {
        // Roll back and discard sessions that have exceeded the maximum age
        if (now - session.startedAt > MAX_EDIT_SESSION_AGE_MS) {
          expiredCount++;
          if (session.checkpointId !== undefined) {
            try {
              const rolledBack = await rollbackToAgentCheckpoint(
                this.env,
                this.sessionInfo,
                session.checkpointId,
                session.agentId,
                'Expired edit session rolled back on DO restore',
              );
              if (rolledBack) {
                rolledBackCount++;
                console.log(
                  `Rolled back expired edit session ${key} to checkpoint ${session.checkpointId} on restore`,
                );
              } else {
                console.warn(
                  `Failed to roll back expired edit session ${key} (checkpoint ${session.checkpointId}) on restore`,
                );
              }
            } catch (error) {
              console.error(`Error rolling back expired edit session ${key} on restore:`, error);
            }
          }
          // Clean up presence for the expired agent
          this.presenceManager.unregisterByActorId(session.agentId);
          continue;
        }
        this.editSessions.set(key, session);
      }

      if (expiredCount > 0) {
        console.log(
          `Cleaned up ${String(expiredCount)} expired edit session(s) on restore (${String(rolledBackCount)} rolled back)`,
        );
        // Persist the cleaned-up sessions map (expired ones removed)
        await this.persistEditSessions();
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
    await persistPresenceFn(this.state.storage, this.presenceManager);
    this.presencePersistPending = false;
  }

  private async markPresencePersistPending(): Promise<void> {
    if (this.presencePersistPending) return;
    this.presencePersistPending = true;
    const dueAt = Date.now() + PERSIST_DEBOUNCE_MS;
    const existingAlarm = await this.state.storage.getAlarm();
    if (existingAlarm === null || existingAlarm > dueAt) {
      await this.state.storage.setAlarm(dueAt);
      this.cleanupAlarmScheduled = true;
    }
  }

  private pushPresenceUpdate(
    type: 'join' | 'leave' | 'focus' | 'state',
    actorId: string,
    extra?: { actor?: ActorPresence; focusRegions?: string[]; state?: string },
  ): void {
    pushPresenceUpdateFn(this.env, this.sessionInfo, type, actorId, extra);
  }

  // =============================================================================
  // CRDT persistence
  // =============================================================================

  private async persist(): Promise<void> {
    const update = Y.encodeStateAsUpdate(this.ydoc);
    await this.state.storage.put(YDOC_STORAGE_KEY, update);
  }

  private async markPersistPending(): Promise<void> {
    if (this.persistPending) return;
    this.persistPending = true;
    await this.state.storage.put(DocumentSession.PERSIST_PENDING_KEY, true);
    const dueAt = Date.now() + PERSIST_DEBOUNCE_MS;
    const existingAlarm = await this.state.storage.getAlarm();
    if (existingAlarm === null || existingAlarm > dueAt) {
      await this.state.storage.setAlarm(dueAt);
      this.cleanupAlarmScheduled = true;
    }
  }

  private async flushPendingPersist(): Promise<void> {
    if (!this.persistPending) return;
    await this.persist();
    this.persistPending = false;
    await this.state.storage.delete(DocumentSession.PERSIST_PENDING_KEY);
  }

  // =============================================================================
  // Debounced broadcasts
  // =============================================================================

  private enqueueBroadcast(sender: WebSocket, update: Uint8Array): void {
    this.pendingBroadcastUpdates.push(update);
    this.pendingBroadcastSenders.push(sender);
    this.broadcastTimer ??= setTimeout(() => { this.flushPendingBroadcasts(); }, BROADCAST_DEBOUNCE_MS);
  }

  private flushPendingBroadcasts(): void {
    this.broadcastTimer = null;
    if (this.pendingBroadcastUpdates.length === 0) return;

    const senders = new Set(this.pendingBroadcastSenders);
    const mergedUpdate: Uint8Array = this.pendingBroadcastUpdates.length === 1
      ? this.pendingBroadcastUpdates[0]!
      : Y.mergeUpdates(this.pendingBroadcastUpdates);
    this.pendingBroadcastUpdates = [];
    this.pendingBroadcastSenders = [];

    for (const conn of this.state.getWebSockets()) {
      if (!senders.has(conn) && conn.readyState === WebSocket.OPEN) {
        conn.send(mergedUpdate);
      }
    }
  }

  // =============================================================================
  // DO lifecycle handlers
  // =============================================================================

  async alarm(): Promise<void> {
    await handleAlarm(this.getAlarmCleanupDeps());
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await handleWebSocketMessage(this.getWebSocketConnectionDeps(), ws, message);
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    await handleWebSocketClose(this.getWebSocketConnectionDeps(), ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await handleWebSocketError(this.getWebSocketConnectionDeps(), ws);
  }

  // =============================================================================
  // Deps builders
  // =============================================================================

  private getCrdtEndpointDeps(): CrdtEndpointDeps {
    return {
      getYdoc: () => this.ydoc,
      setYdoc: (doc: Y.Doc) => { this.ydoc = doc; },
      getInitialized: () => this.initialized,
      setInitialized: (v: boolean) => { this.initialized = v; },
      env: this.env,
      storage: this.state.storage,
      sessionInfo: this.sessionInfo,
      editSessions: this.editSessions,
      activityDetector: this.activityDetector,
      syncManager: this.syncManager,
      getWebSockets: () => this.state.getWebSockets(),
      persist: () => this.persist(),
      flushPendingPersist: () => this.flushPendingPersist(),
      broadcastUpdate: (update, sender) => broadcastUpdateFn(() => this.state.getWebSockets(), update, sender),
      scheduleCleanupAlarm: () => scheduleCleanupAlarm(this.getAlarmCleanupDeps()),
      getLastSeenBranchVersion: () => this.lastSeenBranchVersion,
      setLastSeenBranchVersion: (v: number) => { this.lastSeenBranchVersion = v; },
    };
  }

  private getAlarmCleanupDeps(): AlarmCleanupDeps {
    return {
      env: this.env,
      storage: this.state.storage,
      sessionInfo: this.sessionInfo,
      presenceManager: this.presenceManager,
      activityDetector: this.activityDetector,
      editSessions: this.editSessions,
      syncManager: this.syncManager,
      getConnectionCount: () => this.getConnectionCount(),
      getWebSockets: () => this.state.getWebSockets(),
      getPersistPending: () => this.persistPending,
      getPresencePersistPending: () => this.presencePersistPending,
      getCleanupAlarmScheduled: () => this.cleanupAlarmScheduled,
      setCleanupAlarmScheduled: (v: boolean) => { this.cleanupAlarmScheduled = v; },
      initializeCrdtIfNeeded: () => this.initializeCrdtIfNeeded(),
      checkBranchInvalidation: () => checkBranchInvalidation(this.getCrdtEndpointDeps()),
      restoreSessionInfoFromStorage: () => this.restoreSessionInfoFromStorage(),
      flushPendingPersist: () => this.flushPendingPersist(),
      persistPresence: () => this.persistPresence(),
      persistEditSessions: () => this.persistEditSessions(),
      compactCrdtState: () => compactCrdtState(this.getWebSocketConnectionDeps()),
      broadcastPresenceUpdate: () => broadcastPresenceUpdate(this.getPresenceProtocolDeps()),
      pushPresenceUpdate: (type, actorId, extra) => this.pushPresenceUpdate(type, actorId, extra),
      isAlarmMetricsEnabled: () => this.env.DO_ALARM_METRICS_ENABLED === 'true',
    };
  }

  private getPresenceProtocolDeps(): PresenceProtocolDeps {
    return {
      env: this.env,
      sessionInfo: this.sessionInfo,
      presenceManager: this.presenceManager,
      activityDetector: this.activityDetector,
      editSessions: this.editSessions,
      getWebSockets: () => this.state.getWebSockets(),
      getAllConnections: () => getAllConnections(() => this.state.getWebSockets()),
      syncManager: this.syncManager,
      storage: this.state.storage,
      flushPendingPersist: () => this.flushPendingPersist(),
      markPresencePersistPending: () => this.markPresencePersistPending(),
      pushPresenceUpdate: (type, actorId, extra) => this.pushPresenceUpdate(type, actorId, extra),
      scheduleCleanupAlarm: () => scheduleCleanupAlarm(this.getAlarmCleanupDeps()),
    };
  }

  private getAgentPolitenessDeps(): AgentPolitenessDeps {
    const self = this;
    return {
      env: this.env,
      sessionInfo: this.sessionInfo,
      editSessions: this.editSessions,
      presenceManager: this.presenceManager,
      activityDetector: this.activityDetector,
      agentEditPermissionService: this.agentEditPermissionService,
      get cachedOrganization() { return self.cachedOrganization; },
      getConnectionCount: () => this.getConnectionCount(),
      persistEditSessions: () => this.persistEditSessions(),
      broadcastPresenceUpdate: () => broadcastPresenceUpdate(this.getPresenceProtocolDeps()),
      refreshOrganizationSettings: () => this.refreshOrganizationSettings(),
      scheduleCleanupAlarm: () => scheduleCleanupAlarm(this.getAlarmCleanupDeps()),
      jsonResponse: (status, data) => jsonResponseFn(status, data),
      errorResponse: (status, message) => errorResponseFn(status, message),
    };
  }

  private getWebSocketConnectionDeps(): WebSocketConnectionDeps {
    return {
      env: this.env,
      sessionInfo: this.sessionInfo,
      state: this.state,
      ydoc: this.ydoc,
      setYdoc: (doc: Y.Doc) => { this.ydoc = doc; },
      initialized: this.initialized,
      presenceManager: this.presenceManager,
      activityDetector: this.activityDetector,
      editSessions: this.editSessions,
      messageRates: this.messageRates,
      initializeCrdtIfNeeded: () => this.initializeCrdtIfNeeded(),
      restoreSessionInfoFromStorage: () => this.restoreSessionInfoFromStorage(),
      markPersistPending: () => this.markPersistPending(),
      flushPendingPersist: () => this.flushPendingPersist(),
      enqueueBroadcast: (sender, update) => this.enqueueBroadcast(sender, update),
      flushPendingBroadcasts: () => this.flushPendingBroadcasts(),
      persist: () => this.persist(),
      persistPresence: () => this.persistPresence(),
      persistEditSessions: () => this.persistEditSessions(),
      scheduleCleanupAlarm: () => scheduleCleanupAlarm(this.getAlarmCleanupDeps()),
      broadcastPresenceUpdate: () => broadcastPresenceUpdate(this.getPresenceProtocolDeps()),
      pushPresenceUpdate: (type, actorId, extra) => this.pushPresenceUpdate(type, actorId, extra),
      handlePresenceMessage: (ws, meta, data) => handlePresenceMessage(this.getPresenceProtocolDeps(), ws, meta, data),
      tryParseJson: (data) => tryParseJson(data),
      handleWsPublishRequest: (ws, meta, message) => handleWsPublishRequest(this.getPresenceProtocolDeps(), ws, meta, message),
      syncManager: this.syncManager,
      runCleanup: () => runCleanup(this.getAlarmCleanupDeps()),
      getConnectionCount: () => this.getConnectionCount(),
      PERSIST_PENDING_KEY: DocumentSession.PERSIST_PENDING_KEY,
      setPersistPending: (value: boolean) => { this.persistPending = value; },
    };
  }
}
