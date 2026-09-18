/**
 * PostgreSQL Sync Manager for DocumentSession
 *
 * Handles initialization from PostgreSQL and bidirectional sync
 * between Durable Object storage and PostgreSQL.
 * Extracted from document-session.ts for maintainability.
 */

import * as Y from 'yjs';
import { getLogger } from '@pantheon-systems/p1-telemetry';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { runWithConnection } from '../db';
import { db } from '../db/scope';
import { branches, checkpointDocuments, checkpoints, documentVersions } from '../db/schema';
import type { DocumentSessionEnv, SessionInfo } from './document-session-types';
import { internalApiConfig } from './internal-api-config';
import {
  YDOC_STORAGE_KEY,
  BASELINE_SOURCE_KEY,
  SYNC_IDLE_TIMEOUT_MS,
  COW_BASELINE_IDS_KEY,
} from './document-session-types';
import { applySnapshotToYMap } from './crdt-operations';
import { reconstructVersionSnapshot } from '../services/document-version-service';
import { enforceUniqueSlotIds } from '../services/slot-id-backstop';
import { extractComponentIds } from '../services/component-identity';
import { classifyChange, type PuckAction } from '../services/action-classification';
import { withAttribution } from '../services/document-version-service';
import type { VersionAttribution } from '../types/domain';
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
  attribution?: VersionAttribution;
}

/** Verified actor identity carried alongside actorId/actorType (PCC-3457) */
export interface ActorIdentity {
  actorEmail?: string;
  actorName?: string;
  /** Set when the write applies an agent's accepted proposal for the actor. */
  attribution?: VersionAttribution;
}

/** Action metadata captured from the Puck client's WebSocket text messages */
export interface PendingActionMetadata {
  actionType: string;
  actionMetadata?: Record<string, unknown>;
}

/**
 * One write's inputs, taken together at a single instant so the version
 * records exactly the state and actions it carries.
 */
interface PendingWrite {
  snapshot: Record<string, unknown>;
  /** Identifies the document state the snapshot was taken from. */
  stateVectorHash: string;
  puckActions?: PuckAction[];
  /** How many of the actions were taken from memory, acknowledged on success. */
  takenActionCount: number;
}

/** Provenance of the loaded baseline, for gate diagnostics. In-memory only. */
export type BaselineSource = 'branch' | 'cow' | 'none' | 'restored';

export class PostgresSyncManager {
  /** Promise tracking an in-progress sync to prevent concurrent syncs */
  private syncInProgress: Promise<unknown> | null = null;

  /** Last synced state vector hash for change detection */
  lastSyncedStateVectorHash: string | null = null;

  /** Flag indicating if a cleanup alarm has been scheduled */
  cleanupAlarmScheduled = false;

  /** Pending action metadata from the most recent client edit (for immediate sync) */
  pendingActionMetadata: PendingActionMetadata | null = null;

  /** Accumulated puck actions from client edits since the last sync */
  pendingPuckActions: { type: string; [key: string]: unknown }[] = [];

  /**
   * Set when the document's stored content could not be loaded. The session
   * then holds an empty Y.Doc that does not represent the document, so syncing
   * it would overwrite the stored content with nothing.
   */
  contentLoadFailed = false;

  /** How the session's current Y.Doc content was obtained. Diagnostic only. */
  baselineSource: BaselineSource = 'restored';

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
    if (this.env.HYPERDRIVE === undefined) { this.baselineSource = 'none'; return false; }

    const { documentId, branchId } = this.sessionInfo;

    return runWithConnection(
      this.env.HYPERDRIVE.connectionString,
      { isHyperdrive: true },
      async () => {
        const rows = await db()
          .select({
            snapshot: sql<Record<string, unknown> | null>`${documentVersions.snapshot}`,
            versionNumber: documentVersions.versionNumber,
          })
          .from(documentVersions)
          .where(and(
            eq(documentVersions.documentId, documentId),
            eq(documentVersions.branchId, branchId),
          ))
          .orderBy(desc(documentVersions.versionNumber))
          .limit(1);

        if (rows.length > 0) {
          const row = rows[0];
          if (!row) { this.baselineSource = 'none'; return false; }
          const snapshot = row.snapshot ?? await reconstructVersionSnapshot(documentId, branchId, row.versionNumber);
          if (snapshot === null) { this.baselineSource = 'none'; return false; }
          const root = this.getYdoc().getMap('root');
          applySnapshotToYMap(root, snapshot);
          this.baselineSource = 'branch';
          console.log(
            `Initialized doc ${documentId} from Hyperdrive snapshot`,
          );
          await this.persist();
          this.lastSyncedStateVectorHash = this.computeStateVectorHash();
          return true;
        }

        const branchRows = await db()
          .select({ sourceBranchId: branches.sourceBranchId })
          .from(branches)
          .where(and(
            eq(branches.id, branchId),
            eq(branches.isMain, false),
            isNotNull(branches.sourceBranchId),
          ));

        if (branchRows.length === 0) { this.baselineSource = 'none'; return false; }

        const sourceRow = branchRows[0];
        if (!sourceRow) { this.baselineSource = 'none'; return false; }
        const sourceBranchId = sourceRow.sourceBranchId;
        if (sourceBranchId === null) { this.baselineSource = 'none'; return false; }

        const cowRows = await db()
          .select({
            snapshot: sql<Record<string, unknown> | null>`${documentVersions.snapshot}`,
            versionNumber: documentVersions.versionNumber,
          })
          .from(documentVersions)
          .innerJoin(checkpointDocuments, eq(checkpointDocuments.documentVersionId, documentVersions.id))
          .innerJoin(checkpoints, eq(checkpoints.id, checkpointDocuments.checkpointId))
          .where(and(
            eq(documentVersions.documentId, documentId),
            eq(documentVersions.branchId, sourceBranchId),
            eq(checkpoints.branchId, sourceBranchId),
            eq(checkpoints.checkpointType, 'publish'),
          ))
          .orderBy(desc(documentVersions.versionNumber))
          .limit(1);

        if (cowRows.length === 0) { this.baselineSource = 'none'; return false; }

        const cowRow = cowRows[0];
        if (!cowRow) { this.baselineSource = 'none'; return false; }
        const cowSnapshot = cowRow.snapshot
          ?? await reconstructVersionSnapshot(documentId, sourceBranchId, cowRow.versionNumber);
        if (cowSnapshot === null) { this.baselineSource = 'none'; return false; }
        const root = this.getYdoc().getMap('root');
        applySnapshotToYMap(root, cowSnapshot);
        this.baselineSource = 'cow';
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
    const internalApi = internalApiConfig(this.env);
    if (internalApi === undefined) {
      return;
    }

    const { siteId, documentId, branchId } = this.sessionInfo;
    const url = new URL(`${internalApi.url}/internal/crdt-state`);
    url.searchParams.set('siteId', siteId);
    url.searchParams.set('documentId', documentId);
    url.searchParams.set('branchId', branchId);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'X-Internal-Secret': internalApi.secret },
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

    if (!data.found) { this.baselineSource = 'none'; return; }

    if (
      data.snapshot !== undefined
      && typeof data.snapshot === 'object'
    ) {
      const root = this.getYdoc().getMap('root');
      applySnapshotToYMap(root, data.snapshot);
      // The internal API response does not distinguish a CoW baseline from a
      // direct branch match, so this path reports the coarser 'branch'.
      this.baselineSource = 'branch';
      console.log(
        `Initialized doc ${documentId} from PostgreSQL snapshot`,
      );
      await this.persist();
      this.lastSyncedStateVectorHash = this.computeStateVectorHash();
    } else {
      this.baselineSource = 'none';
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

    // The schedule attributes the sync when the caller does not, and carries
    // the actions across hibernation.
    const schedule = await this.storage.get<SyncSchedule>(SYNC_SCHEDULE_KEY);
    const syncActorId = actorId ?? schedule?.actorId;
    const syncActorType = actorType ?? schedule?.actorType ?? 'user';
    const syncActorEmail = identity?.actorEmail ?? schedule?.actorEmail;
    const syncActorName = identity?.actorName ?? schedule?.actorName;
    const syncAttribution = identity?.attribution ?? schedule?.attribution;

    if (syncActorId === undefined) {
      console.log('Sync skipped: no sync schedule or actor info available');
      return;
    }

    const internalApi = internalApiConfig(this.env);
    if (internalApi === undefined) {
      console.log('Sync skipped: INTERNAL_API_URL or INTERNAL_SECRET not configured');
      return;
    }

    // Set the lock before starting the sync
    const scheduledSync = this.performSync(
      internalApi.url, internalApi.secret, syncActorId, syncActorType, schedule?.puckActions,
      { actorEmail: syncActorEmail, actorName: syncActorName, attribution: syncAttribution },
    );
    this.syncInProgress = scheduledSync;

    try {
      await scheduledSync;
    } finally {
      // Whoever holds the lock releases it; a sync that started later owns it now.
      if (this.syncInProgress === scheduledSync) {
        this.syncInProgress = null;
      }
    }
  }

  /**
   * Take the inputs of the write about to happen: the document as it stands
   * this instant, the hash identifying that state, and the Puck actions behind
   * it. Every write path obtains its snapshot here, so no writer can reach the
   * database with state the session never loaded.
   *
   * Actions pending in memory are the ones the snapshot reflects. An action
   * that arrives after this returns is not in the snapshot and stays pending
   * for the next write.
   *
   * @param scheduledActions - Actions carried by the sync schedule, used when
   *   memory holds none because the session hibernated since they were recorded.
   * @throws when the session's content failed to load
   */
  private takePendingWrite(scheduledActions?: PuckAction[]): PendingWrite {
    if (this.contentLoadFailed) {
      throw new Error(
        `Sync refused for document ${this.sessionInfo.documentId}: session state was `
        + 'never loaded, so writing it would destroy the stored content',
      );
    }

    const snapshot = this.getYdoc().getMap('root').toJSON() as Record<string, unknown>;
    const takenActionCount = this.pendingPuckActions.length;
    const puckActions = takenActionCount > 0 ? [...this.pendingPuckActions] : scheduledActions;
    return {
      snapshot,
      stateVectorHash: this.computeStateVectorHash(),
      ...(puckActions !== undefined ? { puckActions } : {}),
      takenActionCount,
    };
  }

  /**
   * Perform the actual sync operation.
   * Separated from syncToPostgres to enable proper locking.
   * @param internalApiUrl - The internal API URL (pre-validated)
   * @param internalSecret - The internal secret (pre-validated)
   * @param actorId - Actor ID for sync attribution
   * @param actorType - Actor type for sync attribution
   * @param scheduledActions - Puck actions carried by the sync schedule
   * @param identity - Verified actor identity (PCC-3457)
   */
  private async performSync(
    internalApiUrl: string,
    internalSecret: string,
    actorId: string,
    actorType: 'user' | 'agent',
    scheduledActions?: PuckAction[],
    identity?: ActorIdentity,
  ): Promise<void> {
    try {
      const write = this.takePendingWrite(scheduledActions);
      await this.detectCoWBaselineMismatch(write.snapshot, actorId);

      const payload = {
        siteId: this.sessionInfo.siteId,
        documentId: this.sessionInfo.documentId,
        branchId: this.sessionInfo.branchId,
        snapshot: write.snapshot,
        actorId,
        actorType,
        ...(identity?.actorEmail !== undefined ? { actorEmail: identity.actorEmail } : {}),
        ...(identity?.actorName !== undefined ? { actorName: identity.actorName } : {}),
        ...(identity?.attribution !== undefined ? { attribution: identity.attribution } : {}),
        ...(write.puckActions !== undefined ? { puckActions: write.puckActions } : {}),
      };

      // Phase 5.1: Prefer queue-based sync when available
      if (this.env.SYNC_QUEUE !== undefined) {
        try {
          await this.env.SYNC_QUEUE.send({ ...payload, timestamp: Date.now() });
          await this.recordSyncSuccess(write);
          console.log(`Queued sync for document ${this.sessionInfo.documentId}, puckActions: ${write.puckActions ? String(write.puckActions.length) : 'none'}`);
          return;
        } catch (error) {
          // Queues reject any message above their per-message ceiling, so a
          // document past that size is permanently unqueueable. The HTTP path
          // carries the same payload under no such limit.
          console.error(
            `Queue sync failed for document ${this.sessionInfo.documentId}, using direct sync:`,
            error,
          );
        }
      }

      // Fallback: direct HTTP sync via internal API
      const syncUrl = `${internalApiUrl}/internal/crdt-sync`;

      const response = await fetch(syncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': internalSecret,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Sync to PostgreSQL failed: ${String(response.status)} ${errorText}`);
      } else {
        console.log(`Synced document ${this.sessionInfo.documentId} to PostgreSQL`);
        await this.recordSyncSuccess(write);
      }
    } catch (error) {
      console.error('Error syncing to PostgreSQL:', error);
    }
  }

  /**
   * Mark a write as durably stored. The session is clean only as far as the
   * state that write took: an edit that arrived while it was in flight still
   * owes a sync, and its schedule stays in place for the alarm to serve.
   */
  /**
   * Whether Postgres is behind this session. Pending Puck actions count even
   * when the snapshot has not moved: the actions belong on the version.
   */
  hasUnsyncedChanges(): boolean {
    return this.computeStateVectorHash() !== this.lastSyncedStateVectorHash
      || this.pendingPuckActions.length > 0;
  }

  private async recordSyncSuccess(write: PendingWrite): Promise<void> {
    this.lastSyncedStateVectorHash = write.stateVectorHash;
    this.pendingPuckActions.splice(0, write.takenActionCount);
    const unchangedSince = this.computeStateVectorHash() === write.stateVectorHash
      && this.pendingPuckActions.length === 0;
    if (unchangedSince) {
      await this.storage.delete(SYNC_SCHEDULE_KEY);
    }
  }

  /**
   * Write the document's pending state to Postgres and return the version it
   * now reads from.
   *
   * Attribution comes from the pending sync schedule, which names the actor
   * whose edits are being flushed; `fallback` covers a document with no sync
   * owed. Resolves to undefined when the sync infrastructure is unconfigured,
   * which is the local and test case.
   *
   * @param flushPendingPersist - Writes the in-memory Y.Doc to DO storage.
   *   Owned by DocumentSession, so it arrives as a callback.
   */
  async flushAndSync(
    flushPendingPersist: () => Promise<void>,
    fallback: { actorId: string; actorType: 'user' | 'agent' },
  ): Promise<string | undefined> {
    const internalApi = internalApiConfig(this.env);
    if (internalApi === undefined) {
      // Postgres is out of reach, but the CRDT state still belongs in DO storage.
      await flushPendingPersist();
      return undefined;
    }

    await flushPendingPersist();
    // The schedule is read once this write's turn comes: an earlier write in
    // the queue may have served the actor it named.
    return this.runSerialized(async () => {
      const schedule = await this.storage.get<SyncSchedule>(SYNC_SCHEDULE_KEY);
      return await this.executeDirectSync(
        internalApi.url,
        internalApi.secret,
        schedule?.actorId ?? fallback.actorId,
        schedule?.actorType ?? fallback.actorType,
        {
          ...(schedule?.actorEmail !== undefined ? { actorEmail: schedule.actorEmail } : {}),
          ...(schedule?.actorName !== undefined ? { actorName: schedule.actorName } : {}),
          ...(schedule?.attribution !== undefined ? { attribution: schedule.attribution } : {}),
        },
        schedule?.puckActions,
      );
    });
  }

  /**
   * Run a write with every other write from this session waiting behind it.
   *
   * Each caller waits on the write before it and immediately becomes what the
   * next caller waits on. Waiting on the lock without replacing it would let
   * two waiters resume together and compute the same next version number.
   */
  private runSerialized<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.syncInProgress ?? Promise.resolve();
    // A failed write still releases the queue behind it.
    const run = previous.catch(() => undefined).then(work);
    this.syncInProgress = run;
    return run.finally(() => {
      // Whoever holds the lock releases it; a write that started later owns it now.
      if (this.syncInProgress === run) {
        this.syncInProgress = null;
      }
    });
  }

  /**
   * Perform a synchronous sync to PostgreSQL, bypassing the async queue.
   * Uses direct Hyperdrive connection when available, falls back to HTTP internal API.
   * Unlike performSync(), this method never uses the queue and always awaits completion.
   *
   * Resolves to the id of the version the document now reads from. An unchanged
   * document mints no new version, so the id is the existing latest one; it is
   * undefined only when the version cannot be identified.
   */
  async performDirectSync(
    internalApiUrl: string,
    internalSecret: string,
    actorId: string,
    actorType: 'user' | 'agent',
    identity?: ActorIdentity,
    scheduledActions?: PuckAction[],
  ): Promise<string | undefined> {
    return this.runSerialized(() =>
      this.executeDirectSync(
        internalApiUrl, internalSecret, actorId, actorType, identity, scheduledActions,
      ),
    );
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
    scheduledActions?: PuckAction[],
  ): Promise<string | undefined> {
    const write = this.takePendingWrite(scheduledActions);
    await this.detectCoWBaselineMismatch(write.snapshot, actorId);
    const puckActions = write.puckActions;

    // CoW detection compares against the raw CRDT ids, so it runs before dedupe.
    const snapshot = enforceUniqueSlotIds(this.sessionInfo.documentId, write.snapshot);

    // Phase 5.3: Try direct Hyperdrive path first (synchronous, no queue).
    // PCC-3457: the direct INSERT writes actorId raw into the uuid
    // created_by_id column with no resolver — a non-uuid actor (OAuth
    // subject) is a guaranteed cast failure, so skip straight to the HTTP
    // path, which resolves identity server-side.
    const isUuidActor = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId);
    if (this.env.HYPERDRIVE !== undefined && isUuidActor) {
      try {
        const versionId = await runWithConnection(
          this.env.HYPERDRIVE.connectionString,
          { isHyperdrive: true },
          async () => {
            const { documentId, branchId } = this.sessionInfo;
            const classified = classifyChange(undefined, puckActions);
            const actionType = classified.actionType;
            const actionMetadata = withAttribution(classified.actionMetadata, identity?.attribution);
            // The version number, the no-op check and the insert are one
            // statement so a concurrent write cannot land between them; there
            // is no builder form, so it stays raw (D6). Every value the row
            // takes is bound once in `incoming` and referenced by name, so the
            // snapshot crosses the wire once however often the statement reads
            // it. Both jsonb parameters are stringified here: the Drizzle
            // client serializes json as identity, so an object would reach
            // Postgres as [object Object].
            const snapshotJson = JSON.stringify(snapshot);
            const inserted = await db().execute<{ id: string }>(sql`
              WITH incoming AS (
                SELECT ${documentId}::uuid AS document_id,
                       ${branchId}::uuid AS branch_id,
                       ${snapshotJson}::jsonb AS snapshot,
                       ${actorId}::uuid AS created_by_id,
                       ${actorType}::text AS created_by_type,
                       ${actionType}::text AS action_type,
                       ${actionMetadata === null ? null : JSON.stringify(actionMetadata)}::jsonb AS action_metadata
              )
              INSERT INTO app.document_versions (
                document_id, branch_id, version_number, snapshot,
                source, created_by_id, created_by_type,
                action_type, action_metadata
              )
              SELECT incoming.document_id, incoming.branch_id,
                COALESCE(
                  (SELECT MAX(version_number) FROM app.document_versions
                   WHERE document_id = incoming.document_id
                     AND branch_id = incoming.branch_id),
                  0
                ) + 1,
                incoming.snapshot, 'realtime', incoming.created_by_id,
                incoming.created_by_type, incoming.action_type,
                incoming.action_metadata
              FROM incoming
              WHERE NOT EXISTS (
                SELECT 1 FROM LATERAL (
                  SELECT snapshot FROM app.document_versions
                  WHERE document_id = incoming.document_id
                    AND branch_id = incoming.branch_id
                  ORDER BY version_number DESC LIMIT 1
                ) latest
                WHERE latest.snapshot IS NOT DISTINCT FROM incoming.snapshot
              )
              RETURNING id
            `);

            // A snapshot matching the latest version mints no row, and the
            // document still reads from that version.
            if (inserted[0] !== undefined) {
              return inserted[0].id;
            }
            const latest = await db()
              .select({ id: documentVersions.id })
              .from(documentVersions)
              .where(and(
                eq(documentVersions.documentId, documentId),
                eq(documentVersions.branchId, branchId),
              ))
              .orderBy(desc(documentVersions.versionNumber))
              .limit(1);
            return latest[0]?.id;
          },
        );
        await this.recordSyncSuccess(write);
        console.log(`Flushed document ${this.sessionInfo.documentId} to PostgreSQL (direct DB)`);
        return versionId;
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
        ...(identity?.attribution !== undefined ? { attribution: identity.attribution } : {}),
        ...(puckActions !== undefined ? { puckActions } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP sync failed: ${String(response.status)} ${errorText}`);
    }

    // The version is committed once the response is ok, so the session records
    // the write before reading the body. A body that cannot be read costs the
    // caller the version id, not the sync.
    await this.recordSyncSuccess(write);
    console.log(`Flushed document ${this.sessionInfo.documentId} to PostgreSQL (HTTP)`);
    const synced = await response
      .json<{ version?: { id?: string } }>()
      .catch(() => ({ version: undefined }));
    return synced.version?.id;
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
    if (!this.hasUnsyncedChanges()) {
      console.log('Sync skipped: state vector unchanged (no actual content changes)');
      return;
    }

    const internalApi = internalApiConfig(this.env);
    if (internalApi === undefined) {
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
          internalApi.url,
          internalApi.secret,
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
      ...(identity?.attribution !== undefined ? { attribution: identity.attribution } : {}),
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
        const { siteId, documentId, branchId } = this.sessionInfo;
        getLogger().warn('cow baseline mismatch', {
          site_id: siteId,
          document_id: documentId,
          branch_id: branchId,
          principal_id: actorId,
          outcome: 'accepted',
          reason: 'cow_baseline_mismatch',
          baseline_source: this.baselineSource,
          count: currentIds.length,
          baseline_count: baselineIds.length,
          sample_current_ids: currentIds.slice(0, 5),
        });
      }
    } catch (error) {
      getLogger().error('cow baseline mismatch detection failed', error, {
        document_id: this.sessionInfo.documentId,
        outcome: 'degraded',
      });
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
    await this.storage.put(BASELINE_SOURCE_KEY, this.baselineSource);
  }

  /**
   * Restore baselineSource from DO storage after a hibernation wake cycle.
   * Called by DocumentSession.doInitializeCrdt() after applying stored Y.Doc bytes.
   */
  async restoreBaselineSourceFromStorage(): Promise<void> {
    const stored = await this.storage.get<string>(BASELINE_SOURCE_KEY);
    if (stored != null) {
      this.baselineSource = stored as typeof this.baselineSource;
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

}
