/**
 * Phase 3.2: PresenceManager Durable Object
 *
 * Site-level aggregator for presence data across all documents.
 * One PresenceManager per site, identified by env.PRESENCE.idFromName(siteId).
 *
 * Uses RPC methods (compatibility_date 2024-12-01 supports this) for
 * communication from DocumentSession DOs.
 *
 * In-memory index: Map<branchId, Map<documentId, Map<actorId, ActorPresence>>>
 */

import { DurableObject } from 'cloudflare:workers';
import type { DurableObjectState } from '@cloudflare/workers-types';
import type { ActorPresence, PresenceState } from '../types';
import {
  CLEANUP_INTERVAL_MS,
  PRESENCE_STALE_THRESHOLD_MS,
  PERSIST_DEBOUNCE_MS,
  MAX_ACTOR_ID_LENGTH,
  MAX_SITE_ID_LENGTH,
  MAX_BRANCH_ID_LENGTH,
} from '../constants/security-limits';

// =============================================================================
// Types
// =============================================================================

/** Payload for actorJoined RPC */
export interface ActorJoinedPayload {
  siteId: string;
  branchId: string;
  documentId: string;
  actor: ActorPresence;
}

/** Payload for actorLeft RPC */
export interface ActorLeftPayload {
  siteId: string;
  branchId: string;
  documentId: string;
  actorId: string;
}

/** Payload for focusChanged RPC */
export interface FocusChangedPayload {
  siteId: string;
  branchId: string;
  documentId: string;
  actorId: string;
  focusRegions: string[];
}

/** Payload for stateChanged RPC */
export interface StateChangedPayload {
  siteId: string;
  branchId: string;
  documentId: string;
  actorId: string;
  state: PresenceState;
}

/** Result from getBranchPresence */
export interface BranchPresenceResult {
  actors: ActorPresence[];
  documentSummary: {
    documentId: string;
    actorCount: number;
  }[];
}

/** Result from getSitePresence */
export interface SitePresenceResult {
  actors: ActorPresence[];
  branchSummary: {
    branchId: string;
    actorCount: number;
  }[];
}

/** Result from getAgentPresence */
export interface AgentPresenceResult {
  locations: {
    branchId: string;
    documentId: string;
    actor: ActorPresence;
  }[];
}

/** Serialized index format for DO storage */
type SerializedIndex = Record<
  string,
  Record<string, Record<string, ActorPresence>>
>;

/** Storage key for persisted presence index */
const PRESENCE_INDEX_KEY = 'presenceIndex';

/** Environment interface for PresenceManager */
interface PresenceManagerEnv {
  ENVIRONMENT?: string;
}

// =============================================================================
// PresenceManager Durable Object
// =============================================================================

export class PresenceManager extends DurableObject<PresenceManagerEnv> {
  /** Alias this.ctx as this.state for convenience */
  private get state(): DurableObjectState {
    return this.ctx;
  }

  /**
   * In-memory index: branchId -> documentId -> actorId -> ActorPresence
   */
  private index = new Map<string, Map<string, Map<string, ActorPresence>>>();

  /** Whether the index has been initialized from storage */
  private initialized = false;

  /** Whether there are pending changes to persist */
  private persistPending = false;

  /**
   * Initialize the in-memory index from DO storage if not already done.
   */
  private async initializeIfNeeded(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const stored = await this.state.storage.get(PRESENCE_INDEX_KEY);
      if (
        stored !== undefined &&
        stored !== null &&
        typeof stored === 'object'
      ) {
        const data = stored as SerializedIndex;
        this.deserializeIndex(data);
      }
    } catch (error) {
      console.warn('Failed to restore presence index from storage:', error);
    }

    this.initialized = true;
  }

  /**
   * Deserialize index data from storage into in-memory Maps.
   */
  private deserializeIndex(data: SerializedIndex): void {
    this.index.clear();
    for (const [branchId, docs] of Object.entries(data)) {
      const docMap = new Map<string, Map<string, ActorPresence>>();
      for (const [docId, actors] of Object.entries(docs)) {
        const actorMap = new Map<string, ActorPresence>();
        for (const [actorId, presence] of Object.entries(actors)) {
          actorMap.set(actorId, presence);
        }
        docMap.set(docId, actorMap);
      }
      this.index.set(branchId, docMap);
    }
  }

  /**
   * Serialize the in-memory index to a plain object for storage.
   */
  private serializeIndex(): SerializedIndex {
    const result: SerializedIndex = {};
    for (const [branchId, docMap] of this.index.entries()) {
      const docs: Record<string, Record<string, ActorPresence>> = {};
      for (const [docId, actorMap] of docMap.entries()) {
        const actors: Record<string, ActorPresence> = {};
        for (const [actorId, presence] of actorMap.entries()) {
          actors[actorId] = presence;
        }
        docs[docId] = actors;
      }
      result[branchId] = docs;
    }
    return result;
  }

  /**
   * Mark that the index has changed and needs to be persisted.
   * Schedules an alarm for debounced persistence.
   */
  private async markDirty(): Promise<void> {
    if (this.persistPending) {
      return;
    }

    this.persistPending = true;

    const dueAt = Date.now() + PERSIST_DEBOUNCE_MS;
    const existingAlarm = await this.state.storage.getAlarm();
    if (existingAlarm === null || existingAlarm > dueAt) {
      await this.state.storage.setAlarm(dueAt);
    }
  }

  /**
   * Schedule a cleanup alarm (idempotent).
   */
  private async scheduleCleanupAlarm(): Promise<void> {
    const dueAt = Date.now() + CLEANUP_INTERVAL_MS;
    const existingAlarm = await this.state.storage.getAlarm();
    if (existingAlarm === null) {
      await this.state.storage.setAlarm(dueAt);
    }
  }

  // =========================================================================
  // RPC Methods (called by DocumentSession DOs)
  // =========================================================================

  /**
   * Register an actor as present on a document.
   */
  async actorJoined(payload: ActorJoinedPayload): Promise<void> {
    await this.initializeIfNeeded();

    const { branchId, documentId, actor } = payload;
    this.validatePayloadFields({ branchId, documentId, actorId: actor.actorId, siteId: payload.siteId });

    let docMap = this.index.get(branchId);
    if (docMap === undefined) {
      docMap = new Map();
      this.index.set(branchId, docMap);
    }

    let actorMap = docMap.get(documentId);
    if (actorMap === undefined) {
      actorMap = new Map();
      docMap.set(documentId, actorMap);
    }

    actorMap.set(actor.actorId, actor);

    await this.markDirty();
    await this.scheduleCleanupAlarm();
  }

  /**
   * Remove an actor from a document.
   */
  async actorLeft(payload: ActorLeftPayload): Promise<void> {
    await this.initializeIfNeeded();

    const { branchId, documentId, actorId } = payload;
    this.validatePayloadFields({ branchId, documentId, actorId, siteId: payload.siteId });

    const docMap = this.index.get(branchId);
    if (docMap === undefined) return;

    const actorMap = docMap.get(documentId);
    if (actorMap === undefined) return;

    actorMap.delete(actorId);

    // Clean up empty maps
    if (actorMap.size === 0) {
      docMap.delete(documentId);
    }
    if (docMap.size === 0) {
      this.index.delete(branchId);
    }

    await this.markDirty();
  }

  /**
   * Update an actor's focus regions.
   */
  async focusChanged(payload: FocusChangedPayload): Promise<void> {
    await this.initializeIfNeeded();

    const { branchId, documentId, actorId, focusRegions } = payload;
    this.validatePayloadFields({ branchId, documentId, actorId, siteId: payload.siteId });

    const actor = this.getActor(branchId, documentId, actorId);
    if (actor === undefined) return;

    actor.focusRegions = focusRegions;
    actor.lastActivityAt = new Date().toISOString();

    await this.markDirty();
  }

  /**
   * Update an actor's presence state.
   */
  async stateChanged(payload: StateChangedPayload): Promise<void> {
    await this.initializeIfNeeded();

    const { branchId, documentId, actorId, state: newState } = payload;
    this.validatePayloadFields({ branchId, documentId, actorId, siteId: payload.siteId });

    const actor = this.getActor(branchId, documentId, actorId);
    if (actor === undefined) return;

    actor.state = newState;
    actor.lastActivityAt = new Date().toISOString();

    await this.markDirty();
  }

  // =========================================================================
  // Query Methods
  // =========================================================================

  /**
   * Get all presence data for a branch.
   */
  async getBranchPresence(branchId: string): Promise<BranchPresenceResult> {
    await this.initializeIfNeeded();

    const docMap = this.index.get(branchId);
    if (docMap === undefined) {
      return { actors: [], documentSummary: [] };
    }

    const actors: ActorPresence[] = [];
    const documentSummary: {
      documentId: string;
      actorCount: number;
    }[] = [];

    for (const [documentId, actorMap] of docMap.entries()) {
      const docActors = Array.from(actorMap.values());
      actors.push(...docActors);
      documentSummary.push({
        documentId,
        actorCount: docActors.length,
      });
    }

    return { actors, documentSummary };
  }

  /**
   * Get all presence data across the entire site.
   */
  async getSitePresence(): Promise<SitePresenceResult> {
    await this.initializeIfNeeded();

    const actors: ActorPresence[] = [];
    const branchSummary: {
      branchId: string;
      actorCount: number;
    }[] = [];

    for (const [branchId, docMap] of this.index.entries()) {
      let branchActorCount = 0;
      for (const actorMap of docMap.values()) {
        const docActors = Array.from(actorMap.values());
        actors.push(...docActors);
        branchActorCount += docActors.length;
      }
      branchSummary.push({
        branchId,
        actorCount: branchActorCount,
      });
    }

    return { actors, branchSummary };
  }

  /**
   * Get all locations where a specific agent is present.
   */
  async getAgentPresence(agentId: string): Promise<AgentPresenceResult> {
    await this.initializeIfNeeded();

    const locations: {
      branchId: string;
      documentId: string;
      actor: ActorPresence;
    }[] = [];

    for (const [branchId, docMap] of this.index.entries()) {
      for (const [documentId, actorMap] of docMap.entries()) {
        const actor = actorMap.get(agentId);
        if (actor !== undefined) {
          locations.push({ branchId, documentId, actor });
        }
      }
    }

    return { locations };
  }

  // =========================================================================
  // Alarm Handler
  // =========================================================================

  /**
   * Alarm handler for cleanup and persistence.
   */
  async alarm(): Promise<void> {
    await this.initializeIfNeeded();

    // Flush pending persistence
    if (this.persistPending) {
      await this.state.storage.put(
        PRESENCE_INDEX_KEY,
        this.serializeIndex(),
      );
      this.persistPending = false;
    }

    // Clean up stale presence entries
    const now = Date.now();
    let cleaned = 0;

    for (const [branchId, docMap] of this.index.entries()) {
      for (const [documentId, actorMap] of docMap.entries()) {
        for (const [actorId, actor] of actorMap.entries()) {
          const lastActivity = new Date(actor.lastActivityAt).getTime();
          if (now - lastActivity > PRESENCE_STALE_THRESHOLD_MS) {
            actorMap.delete(actorId);
            cleaned++;
          }
        }
        if (actorMap.size === 0) {
          docMap.delete(documentId);
        }
      }
      if (docMap.size === 0) {
        this.index.delete(branchId);
      }
    }

    if (cleaned > 0) {
      console.log(`Cleaned up ${String(cleaned)} stale presence entries`);
      await this.state.storage.put(
        PRESENCE_INDEX_KEY,
        this.serializeIndex(),
      );
    }

    // Reschedule cleanup if there are still actors in the index
    if (this.index.size > 0) {
      await this.state.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Validate string field lengths to prevent memory exhaustion.
   * Throws if any field exceeds its maximum allowed length.
   */
  private validatePayloadFields(fields: Record<string, string | undefined>): void {
    for (const [name, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      const limit = name === 'actorId' ? MAX_ACTOR_ID_LENGTH
        : name === 'siteId' ? MAX_SITE_ID_LENGTH
          : name === 'branchId' ? MAX_BRANCH_ID_LENGTH
            : MAX_SITE_ID_LENGTH; // default to site limit for documentId etc.
      if (value.length > limit) {
        throw new Error(`${name} exceeds maximum length of ${String(limit)}`);
      }
    }
  }

  /**
   * Get an actor from the index by branch, document, and actor ID.
   */
  private getActor(
    branchId: string,
    documentId: string,
    actorId: string,
  ): ActorPresence | undefined {
    return this.index.get(branchId)?.get(documentId)?.get(actorId);
  }
}
