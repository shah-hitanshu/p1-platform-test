/**
 * Alarm and cleanup management.
 * Extracted from document-session.ts for maintainability.
 *
 * Contains the alarm handler body, periodic cleanup logic,
 * cleanup alarm scheduling, and idle-stop detection.
 */

import type { ActorPresence } from '../types';
import {
  incrementCounter,
  setGauge,
  recordTiming,
} from '../services/metrics-service';
import type { PresenceManager } from '../services/presence-service';
import type { ActivityDetector } from '../services/activity-detection-service';
import {
  CLEANUP_INTERVAL_MS,
  FOCUS_STALE_THRESHOLD_MS,
  LOCAL_PRESENCE_STALE_THRESHOLD_MS,
  MAX_EDIT_SESSION_AGE_MS,
  PERSIST_DEBOUNCE_MS,
} from '../constants/security-limits';
import type {
  AgentEditSession,
  SessionInfo,
  DocumentSessionEnv,
} from './document-session-types';
import { rollbackToAgentCheckpoint } from './agent-checkpoint-client';
import { SYNC_SCHEDULE_KEY } from './postgres-sync-manager';
import type { PostgresSyncManager } from './postgres-sync-manager';

// =============================================================================
// Dependencies interface
// =============================================================================

export interface AlarmCleanupDeps {
  env: DocumentSessionEnv;
  storage: DurableObjectStorage;
  sessionInfo: SessionInfo;
  presenceManager: PresenceManager;
  activityDetector: ActivityDetector;
  editSessions: Map<string, AgentEditSession>;
  syncManager: PostgresSyncManager;
  getConnectionCount: () => number;
  getWebSockets: () => WebSocket[];
  getPersistPending: () => boolean;
  getPresencePersistPending: () => boolean;
  getCleanupAlarmScheduled: () => boolean;
  setCleanupAlarmScheduled: (value: boolean) => void;
  initializeCrdtIfNeeded: () => Promise<void>;
  checkBranchInvalidation: () => Promise<void>;
  restoreSessionInfoFromStorage: () => Promise<void>;
  flushPendingPersist: () => Promise<void>;
  persistPresence: () => Promise<void>;
  persistEditSessions: () => Promise<void>;
  compactCrdtState: () => void;
  broadcastPresenceUpdate: () => void;
  pushPresenceUpdate: (
    type: 'join' | 'leave' | 'focus' | 'state',
    actorId: string,
    extra?: { actor?: ActorPresence; focusRegions?: string[]; state?: string },
  ) => void;
  isAlarmMetricsEnabled: () => boolean;
}

// =============================================================================
// Alarm handler
// =============================================================================

/**
 * Durable Object alarm handler body.
 * Called by the runtime when the scheduled alarm fires.
 * Handles sync schedule processing, then runs cleanup and reschedules.
 */
export async function handleAlarm(deps: AlarmCleanupDeps): Promise<void> {
  // Restore session info from storage if state.id.name is unavailable (Miniflare)
  await deps.restoreSessionInfoFromStorage();

  // Restore state after potential hibernation wake
  await deps.initializeCrdtIfNeeded();
  await deps.checkBranchInvalidation();

  const startTime = Date.now();
  const metricsEnabled = deps.isAlarmMetricsEnabled();

  if (metricsEnabled) {
    incrementCounter('css_do_alarm_fired_total');
  }

  // Reset the scheduled flag since the alarm has fired
  deps.setCleanupAlarmScheduled(false);

  // Phase 1.1: Flush any pending persistence
  await deps.flushPendingPersist();

  // Phase 3.1: Flush pending presence persistence
  if (deps.getPresencePersistPending()) {
    await deps.persistPresence();
  }

  // Phase 1.3: Run periodic compaction when no connections are active
  if (deps.getConnectionCount() === 0) {
    deps.compactCrdtState();
  }

  // Process sync schedule if due
  const syncSchedule = await deps.storage.get<{ dueAt: number; actorId: string; actorType: 'user' | 'agent' }>(SYNC_SCHEDULE_KEY);
  if (syncSchedule !== undefined && Date.now() >= syncSchedule.dueAt) {
    await deps.syncManager.syncToPostgres(syncSchedule.actorId, syncSchedule.actorType);
  }

  // Run cleanup (async — may roll back orphaned edit sessions)
  const cleanupStats = await runCleanup(deps);

  // Persist edit sessions and presence if any were cleared during cleanup
  if (cleanupStats.sessionsCleared > 0) {
    await deps.persistEditSessions();
    await deps.persistPresence();
  }

  // Record metrics if enabled
  if (metricsEnabled) {
    recordAlarmMetrics(deps, startTime, cleanupStats);
  }

  // Determine next alarm time
  // Check for pending sync schedule that hasn't fired yet
  const pendingSyncSchedule = await deps.storage.get<{ dueAt: number }>(SYNC_SCHEDULE_KEY);
  const nextAlarmTime = computeNextAlarmTime(deps, pendingSyncSchedule?.dueAt ?? null);

  if (nextAlarmTime !== null) {
    await deps.storage.setAlarm(nextAlarmTime);
    deps.setCleanupAlarmScheduled(true);
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

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Run periodic cleanup of stale data.
 * Clears stale presence entries, focus regions, active regions, and orphaned edit sessions.
 *
 * Expired edit sessions with a pre-edit checkpoint are rolled back to ensure
 * partial agent edits do not persist when the agent disconnects without
 * completing or aborting the session.
 */
export async function runCleanup(deps: AlarmCleanupDeps): Promise<{
  presenceCleared: number;
  focusCleared: number;
  sessionsCleared: number;
  sessionsRolledBack: number;
  regionsCleared: boolean;
}> {
  const now = Date.now();

  // Clear stale presence entries
  const presenceCleared = deps.presenceManager.clearStale(LOCAL_PRESENCE_STALE_THRESHOLD_MS);

  // Clear stale focus entries
  const focusCleared = deps.activityDetector.clearStaleFocus(FOCUS_STALE_THRESHOLD_MS);

  // Clear active regions when humans are idle
  let regionsCleared = false;
  if (deps.activityDetector.isHumanIdle()) {
    deps.activityDetector.clearRegions();
    regionsCleared = true;
  }

  // Clear orphaned edit sessions (sessions older than MAX_EDIT_SESSION_AGE_MS)
  // Roll back sessions that have a pre-edit checkpoint to undo partial edits
  let sessionsCleared = 0;
  let sessionsRolledBack = 0;
  for (const [id, session] of deps.editSessions.entries()) {
    if (now - session.startedAt > MAX_EDIT_SESSION_AGE_MS) {
      // Roll back to pre-edit checkpoint if one exists (autonomous sessions)
      if (session.checkpointId !== undefined) {
        try {
          const rolledBack = await rollbackToAgentCheckpoint(
            deps.env,
            deps.sessionInfo,
            session.checkpointId,
            session.agentId,
            'Orphaned edit session expired without completion',
          );
          if (rolledBack) {
            sessionsRolledBack++;
            console.log(
              `Rolled back orphaned edit session ${id} to checkpoint ${session.checkpointId}`,
            );
          } else {
            console.warn(
              `Failed to roll back orphaned edit session ${id} (checkpoint ${session.checkpointId})`,
            );
          }
        } catch (error) {
          console.error(
            `Error rolling back orphaned edit session ${id}:`, error,
          );
        }
      }

      deps.editSessions.delete(id);
      deps.presenceManager.unregisterByActorId(session.agentId);
      deps.pushPresenceUpdate('leave', session.agentId);
      sessionsCleared++;
    }
  }

  // Notify connected WebSocket clients of agent departures from orphaned sessions
  if (sessionsCleared > 0) {
    deps.broadcastPresenceUpdate();
  }

  // Log cleanup for debugging (only when something was cleared)
  if (presenceCleared > 0 || sessionsCleared > 0 || focusCleared > 0) {
    const rollbackInfo = sessionsRolledBack > 0
      ? ` (${String(sessionsRolledBack)} rolled back)`
      : '';
    console.log(
      `Cleanup: cleared ${String(presenceCleared)} presence, ` +
      `${String(focusCleared)} focus, ${String(sessionsCleared)} edit sessions${rollbackInfo}`,
    );
  }

  return { presenceCleared, focusCleared, sessionsCleared, sessionsRolledBack, regionsCleared };
}

// =============================================================================
// Alarm scheduling
// =============================================================================

/**
 * Schedule a cleanup alarm using Durable Object alarms.
 * Alarms survive DO hibernation, are deduplicated, and persist across crashes.
 */
export async function scheduleCleanupAlarm(deps: AlarmCleanupDeps): Promise<void> {
  const metricsEnabled = deps.isAlarmMetricsEnabled();

  // Check if alarm is already scheduled (optimization to avoid redundant storage calls)
  if (deps.getCleanupAlarmScheduled()) {
    if (metricsEnabled) {
      incrementCounter('css_do_alarm_schedule_total', { result: 'skipped_cached' });
    }
    return;
  }

  // Check if there's already an alarm set
  const existingAlarm = await deps.storage.getAlarm();
  if (existingAlarm !== null) {
    deps.setCleanupAlarmScheduled(true);
    if (metricsEnabled) {
      incrementCounter('css_do_alarm_schedule_total', { result: 'skipped_existing' });
    }
    return;
  }

  // Schedule alarm for CLEANUP_INTERVAL_MS from now
  await deps.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
  deps.setCleanupAlarmScheduled(true);
  if (metricsEnabled) {
    incrementCounter('css_do_alarm_schedule_total', { result: 'scheduled' });
  }
}

/**
 * Check if the cleanup timer should be stopped.
 * Returns true when there are no connections and no data to clean.
 */
export function shouldStopCleanupTimer(deps: AlarmCleanupDeps): boolean {
  if (deps.getConnectionCount() > 0) return false;
  if (deps.presenceManager.count() > 0) return false;
  if (deps.activityDetector.getActiveRegions().length > 0) return false;
  if (deps.activityDetector.getHumanFocusRegions().length > 0) return false;
  if (deps.editSessions.size > 0) return false;
  return true;
}

// =============================================================================
// Private helpers
// =============================================================================

function recordAlarmMetrics(
  deps: AlarmCleanupDeps,
  startTime: number,
  cleanupStats: {
    presenceCleared: number;
    focusCleared: number;
    sessionsCleared: number;
    regionsCleared: boolean;
  },
): void {
  recordTiming('css_do_cleanup_duration_ms', Date.now() - startTime);

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

  setGauge('css_do_connections_count', deps.getConnectionCount());
  setGauge('css_do_presence_count', deps.presenceManager.count());
  setGauge('css_do_edit_sessions_count', deps.editSessions.size);
  setGauge('css_do_active_regions_count', deps.activityDetector.getActiveRegions().length);
  setGauge('css_do_focus_regions_count', deps.activityDetector.getHumanFocusRegions().length);
}

function computeNextAlarmTime(deps: AlarmCleanupDeps, pendingSyncDueAt: number | null): number | null {
  let nextAlarmTime: number | null = null;

  // Honor pending sync schedule
  if (pendingSyncDueAt !== null) {
    nextAlarmTime = pendingSyncDueAt;
  }

  // If persist is still pending (e.g., rapid edits), schedule next alarm
  if (deps.getPersistPending()) {
    const persistTime = Date.now() + PERSIST_DEBOUNCE_MS;
    nextAlarmTime = nextAlarmTime !== null
      ? Math.min(nextAlarmTime, persistTime)
      : persistTime;
  }

  // Reschedule cleanup alarm if there's still data to track
  if (!shouldStopCleanupTimer(deps)) {
    const cleanupTime = Date.now() + CLEANUP_INTERVAL_MS;
    nextAlarmTime = nextAlarmTime !== null
      ? Math.min(nextAlarmTime, cleanupTime)
      : cleanupTime;
  }

  return nextAlarmTime;
}
