/**
 * Agent Politeness System - Phase 2.3: Agent Edit Permission Service
 *
 * Manages agent edit permissions based on activity detection and agent status.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import type { AgentStatus } from '../types';
import { ActivityDetector } from './activity-detection-service';

/**
 * Context provided by agent when requesting edit permission.
 */
export interface AgentEditContext {
  agentId: string;
  trigger: 'human_requested' | 'autonomous';
  requestedById?: string;
  intent: string;
  targetRegions: string[];
  operationType?: string;
}

/**
 * Result of agent edit permission check.
 */
export interface AgentEditPermission {
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
 * Options for creating AgentEditPermissionService.
 */
export interface AgentEditPermissionServiceOptions {
  activityDetector: ActivityDetector;
  /**
   * Optional function to get agent status.
   * If not provided, all agents are assumed to be active.
   */
  getAgentStatus?: GetAgentStatusFn;
}

/**
 * Service for managing agent edit permissions.
 *
 * Combines activity detection with agent status checks to determine
 * whether an agent can proceed with editing a document.
 *
 * Permission rules:
 * 1. Agent must be active (not suspended or disabled)
 * 2. Human-requested work is always allowed (if agent is active)
 * 3. Autonomous work must wait for idle timeout
 * 4. Region conflicts are checked even after idle timeout
 */
export class AgentEditPermissionService {
  private activityDetector: ActivityDetector;
  private getAgentStatusFn?: GetAgentStatusFn;

  constructor(options: AgentEditPermissionServiceOptions) {
    this.activityDetector = options.activityDetector;
    this.getAgentStatusFn = options.getAgentStatus;
  }

  /**
   * Check if an agent can edit based on current state.
   *
   * @param context - Agent edit context
   * @returns Permission result with allowed flag and reason if denied
   */
  async canAgentEdit(context: AgentEditContext): Promise<AgentEditPermission> {
    // Check agent status first (applies to all triggers)
    if (this.getAgentStatusFn) {
      const status = await this.getAgentStatusFn(context.agentId);
      if (status === 'suspended' || status === 'disabled') {
        return {
          allowed: false,
          reason: 'agent_suspended',
        };
      }
    }

    // Check for region conflicts (applies to all triggers, including human-requested).
    // A human focused on /content/4 should block agent edits to /content/4/props/...
    // even when the human explicitly requested the edit.
    const conflictingRegions = this.activityDetector.getConflictingRegions(
      context.targetRegions,
    );
    if (conflictingRegions.length > 0) {
      return {
        allowed: false,
        reason: 'region_conflict',
        conflictingRegions,
      };
    }

    // Human-requested work is allowed if no region conflicts
    if (context.trigger === 'human_requested') {
      return { allowed: true };
    }

    // For autonomous work, also check idle timeout
    const activityResult = this.activityDetector.canAgentProceed({
      trigger: context.trigger,
      targetRegions: context.targetRegions,
    });

    if (!activityResult.allowed) {
      return {
        allowed: false,
        reason: activityResult.reason,
        retryAfterMs: activityResult.retryAfterMs,
        conflictingRegions: activityResult.conflictingRegions,
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
  getConflictingRegions(targetRegions: string[]): string[] {
    return this.activityDetector.getConflictingRegions(targetRegions);
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
