/**
 * Agent Politeness System - Phase 2.1: Presence Service
 *
 * In-memory presence tracking for document sessions.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import type { ActorPresence, PresenceState } from '../types';

/**
 * Maximum number of presences allowed per session.
 * Prevents memory exhaustion from unbounded registration.
 */
export const MAX_PRESENCES = 1000;

/**
 * Error thrown when maximum presence limit is reached.
 */
export class MaxPresencesExceededError extends Error {
  constructor() {
    super(`Maximum presence limit (${String(MAX_PRESENCES)}) exceeded`);
    this.name = 'MaxPresencesExceededError';
  }
}

/**
 * Options for registering a new presence.
 */
export interface RegisterPresenceOptions {
  actorId: string;
  actorType: 'user' | 'agent';
  name: string;
  avatar?: string;
  intent?: string;
  focusRegions?: string[];
  /** Initial state for the actor (default: 'active') */
  state?: PresenceState;
}

/**
 * Normalize a region path to JSON Pointer format for consistent comparison.
 * Converts dot-notation (content.0.props) to JSON Pointer format (/content/0/props).
 * Handles mixed formats and ensures leading slash.
 *
 * @param path - Path in any format
 * @returns Normalized path in JSON Pointer format
 */
function normalizeRegionPath(path: string): string {
  // If path contains dots and no slashes, it's dot-notation
  if (path.includes('.') && !path.includes('/')) {
    return '/' + path.split('.').join('/');
  }
  // If path doesn't start with /, add it
  if (!path.startsWith('/')) {
    return '/' + path;
  }
  return path;
}

/**
 * Checks if two JSON paths overlap (one is a parent/child of the other or equal).
 * Handles both JSON Pointer format (/content/0) and dot-notation (content.0).
 *
 * @param path1 - First JSON path (e.g., '/content/0' or 'content.0')
 * @param path2 - Second JSON path (e.g., '/content/0/props' or 'content.0.props')
 * @returns true if paths overlap, false otherwise
 */
export function regionsOverlap(path1: string, path2: string): boolean {
  // Normalize both paths to JSON Pointer format
  const normalized1 = normalizeRegionPath(path1);
  const normalized2 = normalizeRegionPath(path2);

  // Exact match
  if (normalized1 === normalized2) {
    return true;
  }

  // Check if one path is a prefix of the other
  // Ensure we're matching complete path segments by checking for '/' boundary
  if (normalized1.startsWith(normalized2)) {
    // path2 is parent of path1
    const remainder = normalized1.slice(normalized2.length);
    return remainder === '' || remainder.startsWith('/');
  }

  if (normalized2.startsWith(normalized1)) {
    // path1 is parent of path2
    const remainder = normalized2.slice(normalized1.length);
    return remainder === '' || remainder.startsWith('/');
  }

  return false;
}

/**
 * Generate a unique presence ID.
 */
function generatePresenceId(): string {
  return `presence-${crypto.randomUUID()}`;
}

/**
 * Get current ISO timestamp.
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * In-memory presence manager for a document session.
 *
 * This class tracks actors (users and agents) currently viewing or editing
 * a document. It's designed to be used within a Durable Object for
 * ephemeral session state.
 */
export class PresenceManager {
  private presences: Map<string, ActorPresence>;
  private actorIdIndex: Map<string, string>; // actorId -> presence id

  constructor() {
    this.presences = new Map();
    this.actorIdIndex = new Map();
  }

  /**
   * Register a new presence or replace existing presence for the same actor.
   * @throws {MaxPresencesExceededError} If limit is reached and this is a new actor
   */
  register(options: RegisterPresenceOptions): ActorPresence {
    // Check if actor already has a presence
    const existingId = this.actorIdIndex.get(options.actorId);
    if (existingId !== undefined) {
      // Remove existing presence (replacement, not new registration)
      this.presences.delete(existingId);
    } else {
      // New registration - check limit
      if (this.presences.size >= MAX_PRESENCES) {
        throw new MaxPresencesExceededError();
      }
    }

    const now = getCurrentTimestamp();
    const id = generatePresenceId();

    const presence: ActorPresence = {
      id,
      actorId: options.actorId,
      actorType: options.actorType,
      role: options.actorType === 'agent' ? 'agent' : 'human',
      name: options.name,
      avatar: options.avatar,
      state: options.state ?? 'active',
      intent: options.intent,
      focusRegions: options.focusRegions,
      lastActivityAt: now,
      joinedAt: now,
    };

    this.presences.set(id, presence);
    this.actorIdIndex.set(options.actorId, id);

    return presence;
  }

  /**
   * Get presence by ID.
   */
  get(id: string): ActorPresence | undefined {
    return this.presences.get(id);
  }

  /**
   * Get presence by actor ID.
   */
  getByActorId(actorId: string): ActorPresence | undefined {
    const presenceId = this.actorIdIndex.get(actorId);
    if (presenceId === undefined) {
      return undefined;
    }
    return this.presences.get(presenceId);
  }

  /**
   * Update presence state.
   */
  updateState(id: string, state: PresenceState): ActorPresence | undefined {
    const presence = this.presences.get(id);
    if (presence === undefined) {
      return undefined;
    }

    const updated: ActorPresence = {
      ...presence,
      state,
      lastActivityAt: getCurrentTimestamp(),
    };

    this.presences.set(id, updated);
    return updated;
  }

  /**
   * Update focus regions.
   */
  updateFocusRegions(id: string, focusRegions: string[]): ActorPresence | undefined {
    const presence = this.presences.get(id);
    if (presence === undefined) {
      return undefined;
    }

    const updated: ActorPresence = {
      ...presence,
      focusRegions,
      lastActivityAt: getCurrentTimestamp(),
    };

    this.presences.set(id, updated);
    return updated;
  }

  /**
   * Update agent intent.
   */
  updateIntent(id: string, intent: string | undefined): ActorPresence | undefined {
    const presence = this.presences.get(id);
    if (presence === undefined) {
      return undefined;
    }

    const updated: ActorPresence = {
      ...presence,
      intent,
      lastActivityAt: getCurrentTimestamp(),
    };

    this.presences.set(id, updated);
    return updated;
  }

  /**
   * Record activity for a presence.
   */
  recordActivity(id: string): ActorPresence | undefined {
    const presence = this.presences.get(id);
    if (presence === undefined) {
      return undefined;
    }

    const updated: ActorPresence = {
      ...presence,
      lastActivityAt: getCurrentTimestamp(),
    };

    this.presences.set(id, updated);
    return updated;
  }

  /**
   * Unregister presence by ID.
   */
  unregister(id: string): boolean {
    const presence = this.presences.get(id);
    if (presence === undefined) {
      return false;
    }

    this.presences.delete(id);
    this.actorIdIndex.delete(presence.actorId);
    return true;
  }

  /**
   * Unregister presence by actor ID.
   */
  unregisterByActorId(actorId: string): boolean {
    const presenceId = this.actorIdIndex.get(actorId);
    if (presenceId === undefined) {
      return false;
    }

    this.presences.delete(presenceId);
    this.actorIdIndex.delete(actorId);
    return true;
  }

  /**
   * Get all presences.
   */
  getAll(): ActorPresence[] {
    return Array.from(this.presences.values());
  }

  /**
   * Get all human presences.
   */
  getHumans(): ActorPresence[] {
    return this.getAll().filter((p) => p.role === 'human');
  }

  /**
   * Get all agent presences.
   */
  getAgents(): ActorPresence[] {
    return this.getAll().filter((p) => p.role === 'agent');
  }

  /**
   * Get presences by state.
   */
  getByState(state: PresenceState): ActorPresence[] {
    return this.getAll().filter((p) => p.state === state);
  }

  /**
   * Check if any humans are present.
   */
  hasHumanPresence(): boolean {
    return this.getHumans().length > 0;
  }

  /**
   * Check if any humans are active (active or editing state).
   */
  hasActiveHumans(): boolean {
    return this.getHumans().some((p) => p.state === 'active' || p.state === 'editing');
  }

  /**
   * Get actors whose focus regions overlap with the given region.
   */
  getActorsInRegion(region: string): ActorPresence[] {
    return this.getAll().filter((p) => {
      if (!p.focusRegions || p.focusRegions.length === 0) {
        return false;
      }
      return p.focusRegions.some((r) => regionsOverlap(r, region));
    });
  }

  /**
   * Get count of presences.
   */
  count(): number {
    return this.presences.size;
  }

  /**
   * Clear all presences.
   */
  clear(): void {
    this.presences.clear();
    this.actorIdIndex.clear();
  }

  /**
   * Clear stale presence entries older than the specified age.
   * Used by periodic cleanup to remove disconnected clients.
   *
   * @param maxAgeMs - Maximum age in milliseconds before presence is cleared
   * @returns Number of entries cleared
   */
  clearStale(maxAgeMs: number): number {
    const now = Date.now();
    let cleared = 0;

    for (const [id, presence] of this.presences.entries()) {
      const lastActivityTime = new Date(presence.lastActivityAt).getTime();
      if (now - lastActivityTime > maxAgeMs) {
        this.presences.delete(id);
        // Also clean up the actorId index
        const existingId = this.actorIdIndex.get(presence.actorId);
        if (existingId === id) {
          this.actorIdIndex.delete(presence.actorId);
        }
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Serialize to JSON array.
   */
  toJSON(): ActorPresence[] {
    return this.getAll();
  }
}
