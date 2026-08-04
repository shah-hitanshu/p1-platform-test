/**
 * Agent Politeness System - Phase 2.3: Edit Permission Service
 *
 * Decides whether a session owner may edit, from activity detection and — for
 * agents — registry status.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import type { AgentStatus, SessionOwner } from '../types';
import { ActivityDetector, type ConflictScopeOptions } from './activity-detection-service';

/**
 * Context supplied when a session owner requests edit permission.
 */
export interface EditPermissionContext {
  owner: SessionOwner;
  trigger: 'human_requested' | 'autonomous' | 'manual';
  requestedById?: string;
  intent: string;
  targetRegions: string[];
  operationType?: string;
}

/**
 * Result of an edit permission check.
 */
export interface EditPermission {
  allowed: boolean;
  reason?: 'human_active' | 'region_conflict' | 'agent_suspended';
  retryAfterMs?: number;
  conflictingRegions?: string[];
}

/**
 * Function to get agent status by ID.
 */
export type GetAgentStatusFn = (agentId: string) => Promise<AgentStatus>;

/**
 * Options for creating EditPermissionService.
 */
export interface EditPermissionServiceOptions {
  activityDetector: ActivityDetector;
  /**
   * Optional function to get agent status.
   * If not provided, all agents are assumed to be active.
   */
  getAgentStatus?: GetAgentStatusFn;
}

/**
 * Service deciding whether a session owner can edit a document.
 *
 * Permission rules:
 * 1. An agent must be active (not suspended or disabled)
 * 2. A region another actor occupies conflicts, whatever the trigger
 * 3. Autonomous work additionally waits for the human idle timeout
 */
export class EditPermissionService {
  private activityDetector: ActivityDetector;
  private getAgentStatusFn?: GetAgentStatusFn;

  constructor(options: EditPermissionServiceOptions) {
    this.activityDetector = options.activityDetector;
    this.getAgentStatusFn = options.getAgentStatus;
  }

  /**
   * Check whether a session owner can edit, given current activity.
   *
   * Registry status is an agent-only concept, so it is consulted only for an
   * agent owner. The owner's own claim on a region never counts against it —
   * for an agent that exclusion is a no-op, since agents register no regions.
   * The idle timeout gates autonomous agent work only: waiting for people to go
   * quiet is a courtesy agents owe them, not one a person owes themselves. A
   * person's session is held to the region check alone, whatever it declares as
   * its trigger.
   *
   * @param context - Session owner and declared intent
   * @returns Permission result with allowed flag and reason if denied
   */
  async canEdit(context: EditPermissionContext): Promise<EditPermission> {
    if (context.owner.type === 'agent' && this.getAgentStatusFn) {
      const status = await this.getAgentStatusFn(context.owner.id);
      if (status === 'suspended' || status === 'disabled') {
        return {
          allowed: false,
          reason: 'agent_suspended',
        };
      }
    }

    // Region conflicts apply to every trigger. Someone focused on /content/4
    // blocks edits to /content/4/props/... even when they asked for them.
    const conflictingRegions = this.activityDetector.getConflictingRegions(
      context.targetRegions,
      { excludeActorId: context.owner.id },
    );
    if (conflictingRegions.length > 0) {
      return {
        allowed: false,
        reason: 'region_conflict',
        conflictingRegions,
      };
    }

    if (context.owner.type === 'user' || context.trigger !== 'autonomous') {
      return { allowed: true };
    }

    if (!this.activityDetector.isHumanIdle()) {
      return {
        allowed: false,
        reason: 'human_active',
        retryAfterMs: this.activityDetector.getTimeUntilIdle(),
      };
    }

    return { allowed: true };
  }

  /**
   * Record human activity.
   */
  recordHumanActivity(actorId: string, regions?: string[]): void {
    this.activityDetector.recordHumanActivity(actorId, regions);
  }

  /**
   * Clear all active regions.
   */
  clearRegions(): void {
    this.activityDetector.clearRegions();
  }

  /**
   * Set the idle timeout.
   */
  setIdleTimeout(ms: number): void {
    this.activityDetector.setIdleTimeout(ms);
  }

  /**
   * Get the current idle timeout.
   */
  getIdleTimeoutMs(): number {
    return this.activityDetector.getIdleTimeoutMs();
  }

  /**
   * Check if humans are currently idle.
   */
  isHumanIdle(): boolean {
    return this.activityDetector.isHumanIdle();
  }

  /**
   * Get regions that conflict with the given target regions.
   */
  getConflictingRegions(targetRegions: string[], options?: ConflictScopeOptions): string[] {
    return this.activityDetector.getConflictingRegions(targetRegions, options);
  }

  /**
   * Get all active regions.
   */
  getActiveRegions(): string[] {
    return this.activityDetector.getActiveRegions();
  }

  /**
   * Reset all activity state.
   */
  reset(): void {
    this.activityDetector.reset();
  }
}
