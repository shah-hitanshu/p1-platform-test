/**
 * Agent Politeness System - Phase 2.2: Activity Detection Service
 *
 * Tracks human activity to determine when autonomous agents can safely edit.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import { regionsOverlap } from './presence-service';
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  MAX_ACTIVE_REGIONS,
  MAX_FOCUS_REGIONS_PER_ACTOR,
} from '../constants/security-limits';

// Re-export for backwards compatibility
export { DEFAULT_IDLE_TIMEOUT_MS, MAX_ACTIVE_REGIONS, MAX_FOCUS_REGIONS_PER_ACTOR };

/**
 * Options for creating an ActivityDetector.
 */
export interface ActivityDetectorOptions {
  idleTimeoutMs?: number;
}

/**
 * Context for agent edit permission checks.
 */
export interface AgentProceedContext {
  trigger: 'human_requested' | 'autonomous';
  targetRegions: string[];
}

/**
 * Result of agent edit permission check.
 */
export interface AgentProceedResult {
  allowed: boolean;
  reason?: 'human_active' | 'region_conflict';
  retryAfterMs?: number;
  conflictingRegions?: string[];
}

/**
 * Information about a single actor's focus state.
 */
export interface FocusInfo {
  regions: string[];
  lastUpdatedAt: number;
}

/**
 * Serialized state of ActivityDetector.
 */
export interface ActivityDetectorState {
  idleTimeoutMs: number;
  lastHumanActivityAt: number | null;
  activeRegions: string[];
  humanFocusRegions: string[];
  isIdle: boolean;
}

/**
 * Activity detector for tracking human activity and determining
 * when autonomous agents can safely edit.
 *
 * This class is designed to be used within a Document Session Durable Object
 * to coordinate agent-human collaboration.
 */
export class ActivityDetector {
  private idleTimeoutMs: number;
  private lastHumanActivityAt: number | null = null;
  private activeRegions = new Set<string>();
  private humanFocusRegions = new Map<string, FocusInfo>();

  // Cache for flattened focus regions - invalidated on mutations
  private focusRegionsCache: string[] | null = null;

  constructor(options: ActivityDetectorOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  /**
   * Invalidate the focus regions cache.
   * Called whenever focus regions are modified.
   */
  private invalidateFocusCache(): void {
    this.focusRegionsCache = null;
  }

  /**
   * Get the cached flat list of all focus regions.
   * Rebuilds cache if invalidated.
   */
  private getCachedFocusRegions(): string[] {
    if (this.focusRegionsCache === null) {
      const allRegions = new Set<string>();
      for (const focusInfo of this.humanFocusRegions.values()) {
        for (const region of focusInfo.regions) {
          allRegions.add(region);
        }
      }
      this.focusRegionsCache = Array.from(allRegions);
    }
    return this.focusRegionsCache;
  }

  /**
   * Get the current idle timeout in milliseconds.
   */
  getIdleTimeoutMs(): number {
    return this.idleTimeoutMs;
  }

  /**
   * Set a new idle timeout.
   */
  setIdleTimeout(ms: number): void {
    this.idleTimeoutMs = ms;
  }

  /**
   * Record human activity with optional regions being edited.
   * Regions are silently ignored if MAX_ACTIVE_REGIONS limit is reached.
   */
  recordHumanActivity(actorId: string, regions?: string[]): void {
    this.lastHumanActivityAt = Date.now();

    if (regions) {
      for (const region of regions) {
        // Skip if already at limit (silently ignore to not disrupt activity recording)
        if (this.activeRegions.size >= MAX_ACTIVE_REGIONS) {
          break;
        }
        this.activeRegions.add(region);
      }
    }
  }

  /**
   * Get the timestamp of last human activity, or null if none recorded.
   */
  getLastHumanActivityAt(): number | null {
    return this.lastHumanActivityAt;
  }

  /**
   * Check if humans are considered idle (no activity within idle timeout).
   */
  isHumanIdle(): boolean {
    if (this.lastHumanActivityAt === null) {
      return true;
    }

    const elapsed = Date.now() - this.lastHumanActivityAt;
    return elapsed >= this.idleTimeoutMs;
  }

  /**
   * Get time since last human activity in milliseconds, or null if none recorded.
   */
  getTimeSinceLastActivity(): number | null {
    if (this.lastHumanActivityAt === null) {
      return null;
    }

    return Date.now() - this.lastHumanActivityAt;
  }

  /**
   * Get time remaining until humans are considered idle.
   * Returns 0 if already idle or no activity recorded.
   */
  getTimeUntilIdle(): number {
    if (this.lastHumanActivityAt === null) {
      return 0;
    }

    const elapsed = Date.now() - this.lastHumanActivityAt;
    const remaining = this.idleTimeoutMs - elapsed;

    return Math.max(0, remaining);
  }

  /**
   * Get all active regions being edited by humans.
   */
  getActiveRegions(): string[] {
    return Array.from(this.activeRegions);
  }

  /**
   * Clear all active regions.
   */
  clearRegions(): void {
    this.activeRegions.clear();
  }

  // =========================================================================
  // Focus Region Tracking (Proactive)
  // =========================================================================

  /**
   * Record focus activity for an actor (e.g., component selection in Puck).
   * Focus activity does NOT reset the idle timer - only actual operations do.
   * This allows agents to know about human intent before edits happen.
   *
   * @param actorId - The actor who is focusing on regions
   * @param focusRegions - The regions the actor is currently focused on
   */
  recordFocusActivity(actorId: string, focusRegions: string[]): void {
    // Limit the number of regions per actor
    const limitedRegions = focusRegions.slice(0, MAX_FOCUS_REGIONS_PER_ACTOR);

    this.humanFocusRegions.set(actorId, {
      regions: limitedRegions,
      lastUpdatedAt: Date.now(),
    });

    // Invalidate cache since focus regions changed
    this.invalidateFocusCache();
  }

  /**
   * Clear focus regions for a specific actor.
   *
   * @param actorId - The actor whose focus should be cleared
   */
  clearActorFocus(actorId: string): void {
    this.humanFocusRegions.delete(actorId);
    this.invalidateFocusCache();
  }

  /**
   * Clear focus entries older than the specified age.
   * Used to expire stale focus from disconnected clients.
   *
   * @param maxAgeMs - Maximum age in milliseconds before focus is cleared
   * @returns Number of focus entries cleared
   */
  clearStaleFocus(maxAgeMs: number): number {
    const now = Date.now();
    let deletedCount = 0;
    for (const [actorId, focusInfo] of this.humanFocusRegions.entries()) {
      if (now - focusInfo.lastUpdatedAt > maxAgeMs) {
        this.humanFocusRegions.delete(actorId);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      this.invalidateFocusCache();
    }
    return deletedCount;
  }

  /**
   * Get focus information for a specific actor.
   *
   * @param actorId - The actor to look up
   * @returns Focus info or undefined if actor has no focus
   */
  getFocusInfo(actorId: string): FocusInfo | undefined {
    return this.humanFocusRegions.get(actorId);
  }

  /**
   * Get all human focus regions (deduplicated).
   * These are regions where humans have expressed interest but not yet edited.
   *
   * @returns Deduplicated array of all focus regions
   */
  getHumanFocusRegions(): string[] {
    // Return a copy to prevent external mutation
    return [...this.getCachedFocusRegions()];
  }

  /**
   * Get all regions that should be considered "occupied" by humans.
   * This combines both active regions (from actual edits) and focus regions
   * (from component selection). Deduplicated.
   *
   * @returns Deduplicated array of all occupied regions
   */
  getAllFocusedRegions(): string[] {
    const allRegions = new Set<string>(this.activeRegions);
    for (const region of this.getCachedFocusRegions()) {
      allRegions.add(region);
    }
    return Array.from(allRegions);
  }

  /**
   * Check if a region is currently focused on by any human.
   * Uses overlap detection to check parent/child relationships.
   *
   * @param region - Region to check
   * @returns true if region overlaps with any focus region
   */
  isRegionFocused(region: string): boolean {
    // Use cached flat list for O(n) lookup instead of O(n*m)
    for (const focusRegion of this.getCachedFocusRegions()) {
      if (regionsOverlap(region, focusRegion)) {
        return true;
      }
    }
    return false;
  }

  // =========================================================================
  // Active Region Tracking (Reactive - from actual operations)
  // =========================================================================

  /**
   * Check if a region is currently active (being edited by humans).
   * Uses overlap detection to check parent/child relationships.
   */
  isRegionActive(region: string): boolean {
    for (const activeRegion of this.activeRegions) {
      if (regionsOverlap(region, activeRegion)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get regions from the target list that conflict with active or focused regions.
   * Checks both operation-derived active regions and proactive focus regions.
   */
  getConflictingRegions(targetRegions: string[]): string[] {
    return targetRegions.filter((target) =>
      this.isRegionActive(target) || this.isRegionFocused(target),
    );
  }

  /**
   * Reset all activity state (but preserve configuration).
   */
  reset(): void {
    this.lastHumanActivityAt = null;
    this.activeRegions.clear();
    this.humanFocusRegions.clear();
    this.invalidateFocusCache();
  }

  /**
   * Check if an agent can proceed with edits based on current activity state.
   *
   * Rules:
   * 1. Human-requested work is always allowed
   * 2. Autonomous work must wait for idle timeout
   * 3. Region conflicts are checked even after idle timeout
   */
  canAgentProceed(context: AgentProceedContext): AgentProceedResult {
    // Human-requested work always allowed
    if (context.trigger === 'human_requested') {
      return { allowed: true };
    }

    // Check if humans are idle
    if (!this.isHumanIdle()) {
      return {
        allowed: false,
        reason: 'human_active',
        retryAfterMs: this.getTimeUntilIdle(),
      };
    }

    // Check for region conflicts
    const conflictingRegions = this.getConflictingRegions(context.targetRegions);
    if (conflictingRegions.length > 0) {
      return {
        allowed: false,
        reason: 'region_conflict',
        conflictingRegions,
      };
    }

    return { allowed: true };
  }

  /**
   * Serialize current state to JSON.
   */
  toJSON(): ActivityDetectorState {
    return {
      idleTimeoutMs: this.idleTimeoutMs,
      lastHumanActivityAt: this.lastHumanActivityAt,
      activeRegions: this.getActiveRegions(),
      humanFocusRegions: this.getHumanFocusRegions(),
      isIdle: this.isHumanIdle(),
    };
  }
}
