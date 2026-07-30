/**
 * PostgreSQL Sync Manager for DocumentSession
 *
 * Handles initialization from PostgreSQL and bidirectional sync
 * between Durable Object storage and PostgreSQL.
 * Extracted from document-session.ts for maintainability.
 */

import * as Y from 'yjs';
import { runWithConnection, query as dbQuery } from '../db';
import type { DocumentSessionEnv, SessionInfo } from './document-session-types';
import {
  YDOC_STORAGE_KEY,
  SYNC_IDLE_TIMEOUT_MS,
  COW_BASELINE_IDS_KEY,
} from './document-session-types';
import { applySnapshotToYMap } from './crdt-operations';
import { reconstructVersionSnapshot } from '../services/document-version-service';
import { enforceUniqueSlotIds } from '../services/slot-id-backstop';
import { extractComponentIds } from '../services/component-identity';
import { IMMEDIATE_SYNC_ACTION_TYPES } from '../constants/security-limits';

/** Storage key for sync schedule (survives hibernation) */
export const SYNC_SCHEDULE_KEY = 'syncSchedule';

/**
 * Sync schedule persisted in DO storage (survives hibernation).
 * actorEmail/actorName are optional (PCC-3457) — schedules persisted before
 * the fields existed keep working.
 */
export interface SyncSchedule {
  dueAt: number;
  actorId: string;
  actorType: 'user' | 'agent';
  /** Verified email of the actor (PCC-3457) — enables JIT user provisioning for OAuth subjects */
  actorEmail?: string;
  /** Verified display name of the actor (PCC-3457) */
  actorName?: string;
  puckActions?: { type: string; [key: string]: unknown }[];
}

/** Verified actor identity carried alongside actorId/actorType (PCC-3457) */
export interface ActorIdentity {
  actorEmail?: string;
  actorName?: string;
}

/** Action metadata captured from the Puck client's WebSocket text messages */
export interface PendingActionMetadata {
  actionType: string;
  actionMetadata?: Record<string, unknown>;
}

export class PostgresSyncManager {
  /** Promise tracking an in-progress sync to prevent concurrent syncs */
  private syncInProgress: Promise<void> | null = null;

  /** Last synced state vector hash for change detection */
  lastSyncedStateVectorHash: string | null = null;

  /** Flag indicating if a cleanup alarm has been scheduled */
  cleanupAlarmScheduled = false;

  /** Pending action metadata from the most recent client edit (for immediate sync) */
  pendingActionMetadata: PendingActionMetadata | null = null;

  /** Accumulated puck actions from client edits since the last sync */
  pendingPuckActions: { type: string; [key: string]: unknown }[] = [];

  constructor(
    private readonly env: DocumentSessionEnv,
    private readonly getSessionInfo: () => SessionInfo,
    private readonly getYdoc: () => Y.Doc,
    private readonly storage: DurableObjectStorage,
  ) {}

  /** Accessor for current session info (follows reassignment in DocumentSession) */
  private get sessionInfo(): SessionInfo {
    return this.getSessionInfo();
  }

  // =============================================================================
  // Initialization Methods
  // =============================================================================

  /**
   * Load initial state from PostgreSQL.
   * Phase 5.3: Tries direct Hyperdrive first, falls back to HTTP.
   */
  async initializeFromPostgres(): Promise<void> {
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
      snapshot: Record<string, unknown> | null;
      version_number: number;
    }

    interface BranchSourceRow {
      source_branch_id: string;
    }

    return runWithConnection(
      this.env.HYPERDRIVE.connectionString,
      { isHyperdrive: true },
      async () => {
        const result = await dbQuery<VersionRow>(
          `SELECT dv.snapshot, dv.version_number
           FROM app.document_versions dv
           WHERE dv.document_id = $1 AND dv.branch_id = $2
           ORDER BY dv.version_number DESC LIMIT 1`,
          [documentId, branchId],
        );

        if (result.rows.length > 0) {
          const row = result.rows[0];
          if (!row) return false;
          const snapshot = row.snapshot ?? await reconstructVersionSnapshot(documentId, branchId, row.version_number);
          if (snapshot === null) return false;
          const root = this.getYdoc().getMap('root');
          applySnapshotToYMap(root, snapshot);
          console.log(
            `Initialized doc ${documentId} from Hyperdrive snapshot`,
          );
          await this.persist();
          this.lastSyncedStateVectorHash = this.computeStateVectorHash();
          return true;
        }

        const branchResult = await dbQuery<BranchSourceRow>(
          `SELECT source_branch_id
           FROM app.branches
           WHERE id = $1
             AND is_main = false
             AND source_branch_id IS NOT NULL`,
          [branchId],
        );

        if (branchResult.rows.length === 0) return false;

        const sourceRow = branchResult.rows[0];
        if (!sourceRow) return false;
        const sourceBranchId = sourceRow.source_branch_id;
        if (!sourceBranchId) return false;

        const cowResult = await dbQuery<VersionRow>(
          `SELECT dv.snapshot, dv.version_number
           FROM app.document_versions dv
           INNER JOIN app.checkpoint_documents cd ON cd.document_version_id = dv.id
           INNER JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
           WHERE dv.document_id = $1
             AND dv.branch_id = $2
             AND cp.branch_id = $2
             AND cp.checkpoint_type = 'publish'
           ORDER BY dv.version_number DESC
           LIMIT 1`,
          [documentId, sourceBranchId],
        );

        if (cowResult.rows.length === 0) return false;

        const cowRow = cowResult.rows[0];
        if (!cowRow) return false;
        const cowSnapshot = cowRow.snapshot
          ?? await reconstructVersionSnapshot(documentId, sourceBranchId, cowRow.version_number);
        if (cowSnapshot === null) return false;
        const root = this.getYdoc().getMap('root');
        applySnapshotToYMap(root, cowSnapshot);
        console.log(
          `Initialized doc ${documentId} from CoW baseline (source branch ${sourceBranchId})`,
        );

        // Store CoW baseline component IDs so detectCoWBaselineMismatch()
        // can compare them against the first sync write (Failure Mode B guard).
        const baselineIds = extractComponentIds(cowSnapshot);
        if (baselineIds.length > 0) {
          await this.storage.put(COW_BASELINE_IDS_KEY, baselineIds);
        }

        await this.persist();
        this.lastSyncedStateVectorHash = this.computeStateVectorHash();
        return true;
      },
    );
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
    };

    if (!data.found) return;

    if (
      data.snapshot !== undefined
      && typeof data.snapshot === 'object'
    ) {
      const root = this.getYdoc().getMap('root');
      applySnapshotToYMap(root, data.snapshot);
      console.log(
        `Initialized doc ${documentId} from PostgreSQL snapshot`,
      );
      await this.persist();
      this.lastSyncedStateVectorHash = this.computeStateVectorHash();
    }
  }

  // =============================================================================
  // Sync Methods
  // =============================================================================

  /**
   * Sync current CRDT state to PostgreSQL via the internal API.
   * Called from alarm handler when sync schedule is due, or on last client disconnect.
   * Uses a lock to prevent concurrent syncs which could create duplicate versions.
   *
   * @param actorId - Actor ID for sync attribution (from stored schedule or caller)
   * @param actorType - Actor type for sync attribution
   * @param identity - Verified actor identity (PCC-3457), when the caller has it
   */
  async syncToPostgres(
    actorId?: string,
    actorType?: 'user' | 'agent',
    identity?: ActorIdentity,
  ): Promise<void> {
    // If a sync is already in progress, wait for it to complete and return.
    if (this.syncInProgress !== null) {
      console.log('Sync skipped: another sync is already in progress');
      await this.syncInProgress;
      return;
    }

    // Read sync schedule from storage if no actor info provided
    let syncActorId = actorId;
    let syncActorType = actorType ?? 'user' as const;
    let syncActorEmail = identity?.actorEmail;
    let syncActorName = identity?.actorName;
    let syncPuckActions: { type: string; [key: string]: unknown }[] | undefined;
    if (syncActorId === undefined) {
      const schedule = await this.storage.get<SyncSchedule>(SYNC_SCHEDULE_KEY);
      if (schedule !== undefined) {
        syncActorId = schedule.actorId;
        syncActorType = schedule.actorType;
        syncActorEmail = schedule.actorEmail;
        syncActorName = schedule.actorName;
        syncPuckActions = schedule.puckActions;
      }
    }

    // Use in-memory accumulated actions if not read from schedule
    if (syncPuckActions === undefined && this.pendingPuckActions.length > 0) {
      syncPuckActions = this.pendingPuckActions;
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
    this.syncInProgress = this.performSync(
      internalApiUrl, internalSecret, syncActorId, syncActorType, syncPuckActions,
      { actorEmail: syncActorEmail, actorName: syncActorName },
    );

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
   * @param puckActions - Optional array of Puck actions
   * @param identity - Verified actor identity (PCC-3457)
   */
  private async performSync(
    internalApiUrl: string,
    internalSecret: string,
    actorId: string,
    actorType: 'user' | 'agent',
    puckActions?: { type: string; [key: string]: unknown }[],
    identity?: ActorIdentity,
  ): Promise<void> {
    try {
      const root = this.getYdoc().getMap('root');
      const snapshot = root.toJSON() as Record<string, unknown>;

      await this.detectCoWBaselineMismatch(snapshot, actorId);

      // Phase 5.1: Prefer queue-based sync when available
      if (this.env.SYNC_QUEUE !== undefined) {
        await this.env.SYNC_QUEUE.send({
          siteId: this.sessionInfo.siteId,
          documentId: this.sessionInfo.documentId,
          branchId: this.sessionInfo.branchId,
          snapshot,
          actorId,
          actorType,
          timestamp: Date.now(),
          ...(identity?.actorEmail !== undefined ? { actorEmail: identity.actorEmail } : {}),
          ...(identity?.actorName !== undefined ? { actorName: identity.actorName } : {}),
          ...(puckActions !== undefined ? { puckActions } : {}),
        });
        this.lastSyncedStateVectorHash = this.computeStateVectorHash();
        this.pendingPuckActions = [];
        await this.storage.delete(SYNC_SCHEDULE_KEY);
        console.log(`Queued sync for document ${this.sessionInfo.documentId}, puckActions: ${puckActions ? String(puckActions.length) : 'none'}`);
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
          actorId,
          actorType,
          ...(identity?.actorEmail !== undefined ? { actorEmail: identity.actorEmail } : {}),
          ...(identity?.actorName !== undefined ? { actorName: identity.actorName } : {}),
          ...(puckActions !== undefined ? { puckActions } : {}),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Sync to PostgreSQL failed: ${String(response.status)} ${errorText}`);
      } else {
        console.log(`Synced document ${this.sessionInfo.documentId} to PostgreSQL`);
        // Update the state vector hash and clear sync schedule after successful sync
        this.lastSyncedStateVectorHash = this.computeStateVectorHash();
        this.pendingPuckActions = [];
        await this.storage.delete(SYNC_SCHEDULE_KEY);
      }
    } catch (error) {
      console.error('Error syncing to PostgreSQL:', error);
    }
  }

  /**
   * Perform a synchronous sync to PostgreSQL, bypassing the async queue.
   * Uses direct Hyperdrive connection when available, falls back to HTTP internal API.
   * Unlike performSync(), this method never uses the queue and always awaits completion.
   */
  async performDirectSync(
    internalApiUrl: string,
    internalSecret: string,
    actorId: string,
    actorType: 'user' | 'agent',
    identity?: ActorIdentity,
  ): Promise<void> {
    // If another sync is in progress, wait for it
    if (this.syncInProgress !== null) {
      await this.syncInProgress;
    }

    // Set the lock so concurrent syncs (e.g. alarm-driven) wait for us
    const directSyncPromise = this.executeDirectSync(internalApiUrl, internalSecret, actorId, actorType, identity);
    this.syncInProgress = directSyncPromise;
    try {
      await directSyncPromise;
    } finally {
      this.syncInProgress = null;
    }
  }

  /**
   * Execute the direct sync write. Separated to enable proper syncInProgress locking.
   */
  private async executeDirectSync(
    internalApiUrl: string,
    internalSecret: string,
    actorId: string,
    actorType: 'user' | 'agent',
    identity?: ActorIdentity,
  ): Promise<void> {
    const root = this.getYdoc().getMap('root');
    const rawSnapshot = root.toJSON() as Record<string, unknown>;

    // CoW detection compares against the raw CRDT ids, so it runs before dedupe.
    await this.detectCoWBaselineMismatch(rawSnapshot, actorId);

    const snapshot = enforceUniqueSlotIds(this.sessionInfo.documentId, rawSnapshot);

    // Phase 5.3: Try direct Hyperdrive path first (synchronous, no queue).
    // PCC-3457: the direct INSERT writes actorId raw into the uuid
    // created_by_id column with no resolver — a non-uuid actor (OAuth
    // subject) is a guaranteed cast failure, so skip straight to the HTTP
    // path, which resolves identity server-side.
    const isUuidActor = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId);
    if (this.env.HYPERDRIVE !== undefined && isUuidActor) {
      try {
        await runWithConnection(
          this.env.HYPERDRIVE.connectionString,
          { isHyperdrive: true },
          async () => {
            const { documentId, branchId } = this.sessionInfo;
            await dbQuery(
              `INSERT INTO app.document_versions (
                document_id, branch_id, version_number, snapshot,
                source, created_by_id, created_by_type
              )
              SELECT $1, $2,
                COALESCE(
                  (SELECT MAX(version_number) FROM app.document_versions
                   WHERE document_id = $1 AND branch_id = $2),
                  0
                ) + 1,
                $3, 'realtime', $4, $5
              WHERE NOT EXISTS (
                SELECT 1 FROM (
                  SELECT snapshot FROM app.document_versions
                  WHERE document_id = $1 AND branch_id = $2
                  ORDER BY version_number DESC LIMIT 1
                ) latest
                WHERE latest.snapshot IS NOT DISTINCT FROM $3::jsonb
              )`,
              [documentId, branchId, snapshot, actorId, actorType],
            );
          },
        );
        this.lastSyncedStateVectorHash = this.computeStateVectorHash();
        await this.storage.delete(SYNC_SCHEDULE_KEY);
        console.log(`Flushed document ${this.sessionInfo.documentId} to PostgreSQL (direct DB)`);
        return;
      } catch (error) {
        console.warn('Direct DB flush failed, falling back to HTTP:', error);
      }
    }

    // Fallback: HTTP sync (synchronous — awaits response)
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
        actorId,
        actorType,
        ...(identity?.actorEmail !== undefined ? { actorEmail: identity.actorEmail } : {}),
        ...(identity?.actorName !== undefined ? { actorName: identity.actorName } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP sync failed: ${String(response.status)} ${errorText}`);
    }

    this.lastSyncedStateVectorHash = this.computeStateVectorHash();
    await this.storage.delete(SYNC_SCHEDULE_KEY);
    console.log(`Flushed document ${this.sessionInfo.documentId} to PostgreSQL (HTTP)`);
  }

  // =============================================================================
  // Scheduling Methods
  // =============================================================================

  /**
   * Schedule a sync to PostgreSQL after idle timeout using DO alarms.
   * Uses storage-backed scheduling so the sync survives hibernation.
   * Debounces by updating the dueAt time on each call.
   *
   * @param actorId - ID of the actor making the edit
   * @param actorType - Type of actor ('user' or 'agent')
   * @param identity - Verified actor identity from the connection (PCC-3457)
   */
  async scheduleSync(
    actorId: string,
    actorType: 'user' | 'agent',
    identity?: ActorIdentity,
  ): Promise<void> {
    // Check if the document has actually changed by comparing state vectors.
    // Still schedule when pendingPuckActions exist — the actions need to be
    // recorded on the version even if the snapshot is unchanged.
    const currentHash = this.computeStateVectorHash();
    if (currentHash === this.lastSyncedStateVectorHash && this.pendingPuckActions.length === 0) {
      console.log('Sync skipped: state vector unchanged (no actual content changes)');
      return;
    }

    // Only schedule if we have internal API configured
    if (this.env.INTERNAL_API_URL === undefined || this.env.INTERNAL_SECRET === undefined) {
      return;
    }

    // Immediate sync for document lifecycle operations (bypasses debounce + queue)
    if (
      this.pendingActionMetadata !== null
      && IMMEDIATE_SYNC_ACTION_TYPES.has(this.pendingActionMetadata.actionType)
    ) {
      const actionType = this.pendingActionMetadata.actionType;
      try {
        await this.performDirectSync(
          this.env.INTERNAL_API_URL,
          this.env.INTERNAL_SECRET,
          actorId,
          actorType,
          identity,
        );
        this.pendingActionMetadata = null;
        return;
      } catch (error) {
        console.error(
          `Immediate sync failed for ${actionType}, falling back to scheduled sync:`,
          error,
        );
      }
    }

    // Store sync schedule in DO storage (survives hibernation)
    const dueAt = Date.now() + SYNC_IDLE_TIMEOUT_MS;
    await this.storage.put(SYNC_SCHEDULE_KEY, {
      dueAt,
      actorId,
      actorType,
      ...(identity?.actorEmail !== undefined ? { actorEmail: identity.actorEmail } : {}),
      ...(identity?.actorName !== undefined ? { actorName: identity.actorName } : {}),
      ...(this.pendingPuckActions.length > 0 ? {
        puckActions: this.pendingPuckActions,
      } : {}),
    });

    // Set alarm to fire at the due time, replacing stale or later alarms
    const existingAlarm = await this.storage.getAlarm();
    const now = Date.now();
    if (existingAlarm === null || existingAlarm > dueAt || existingAlarm < now) {
      await this.storage.setAlarm(dueAt);
      this.cleanupAlarmScheduled = true;
    }
  }

  // =============================================================================
  // Hash & Change Detection
  // =============================================================================

  /**
   * Compute a simple hash of the Yjs state vector for change detection.
   * Uses a fast string-based hash of the base64-encoded state vector.
   */
  computeStateVectorHash(): string {
    const stateVector = Y.encodeStateVector(this.getYdoc());
    return this.uint8ArrayToBase64(stateVector);
  }

  // =============================================================================
  // CoW Baseline Mismatch Detection
  // =============================================================================

  /**
   * Compare the outgoing sync snapshot against the stored CoW baseline IDs.
   * Fires on the first sync after a CoW-initialized DO. If the snapshot contains
   * no component IDs from the baseline, logs a structured warning so the anomaly
   * can be detected in Cloudflare Workers observability.
   *
   * Detection-only: never rejects the write. The COW_BASELINE_IDS_KEY is deleted
   * after the first read so this check runs at most once per initialization.
   */
  private async detectCoWBaselineMismatch(
    snapshot: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    // Self-contained try/catch: detection failures must never abort the sync write.
    try {
      const baselineIds = await this.storage.get<string[]>(COW_BASELINE_IDS_KEY);
      if (baselineIds === undefined) return;

      // Delete unconditionally when the key is present — fires once per init.
      await this.storage.delete(COW_BASELINE_IDS_KEY);
      if (baselineIds.length === 0) return;

      const currentIds = extractComponentIds(snapshot);
      if (currentIds.length === 0) return; // empty doc — no inference possible

      const baselineSet = new Set(baselineIds);
      const hasOverlap = currentIds.some((id) => baselineSet.has(id));

      if (!hasOverlap) {
        const { documentId, branchId } = this.sessionInfo;
        console.warn('cow_baseline_mismatch detected', {
          documentId,
          branchId,
          actorId,
          baselineCount: baselineIds.length,
          currentCount: currentIds.length,
          sampleCurrentIds: currentIds.slice(0, 5),
        });
      }
    } catch (error) {
      console.error('CoW baseline mismatch detection failed (non-fatal):', error);
    }
  }

  // =============================================================================
  // Persistence & Encoding Utilities
  // =============================================================================

  /**
   * Persist the current Yjs document state to DO storage.
   */
  private async persist(): Promise<void> {
    const update = Y.encodeStateAsUpdate(this.getYdoc());
    await this.storage.put(YDOC_STORAGE_KEY, update);
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

}
