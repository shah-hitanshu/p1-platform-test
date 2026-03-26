/**
 * Collaborative State System - Presence and Agent Edit Workflow Types
 *
 * Actor presence, agent edit context/permissions, and Phase 8 rollup types.
 */

import type { PresenceState } from './enums';

// =============================================================================
// Agent Politeness System - Presence & Edit Workflow
// =============================================================================

/**
 * Actor presence information for awareness system.
 * Tracks who is viewing/editing a document.
 */
export interface ActorPresence {
  id: string;
  actorId: string;
  actorType: 'user' | 'agent';
  role: 'human' | 'agent';
  name: string;
  avatar?: string;
  state: PresenceState;
  /** Agent's declared intent (e.g., "Updating hero section") */
  intent?: string;
  /** JSON paths the actor is focused on */
  focusRegions?: string[];
  lastActivityAt: string;
  joinedAt: string;
}

/**
 * Context provided by agent when requesting edit permission.
 */
export interface AgentEditContext {
  agentId: string;
  trigger: 'autonomous' | 'human_requested';
  /** User who requested the agent action (if trigger = human_requested) */
  requestedById?: string;
  /** JSON paths the agent intends to edit */
  targetRegions: string[];
  /** Human-readable description of intended action */
  intent?: string;
  /** Category of operation (e.g., 'content_edit', 'style_update') */
  operationType?: string;
}

/**
 * Result of agent edit permission check.
 */
export interface AgentEditPermission {
  allowed: boolean;
  /** Reason for denial (if allowed = false) */
  reason?: 'human_active' | 'region_conflict' | 'agent_disabled' | 'no_access';
  /** Suggested retry delay in milliseconds */
  retryAfterMs?: number;
  /** Regions that conflict with active human edits */
  conflictingRegions?: string[];
}

// =============================================================================
// Presence Rollup Types (Phase 8)
// =============================================================================

/**
 * Summary counts for presence rollups.
 */
export interface PresenceSummary {
  totalActors: number;
  humanCount: number;
  agentCount: number;
  editingCount: number;
}

/**
 * Per-document presence summary for branch rollups.
 */
export interface DocumentPresenceSummary {
  documentId: string;
  documentPath: string;
  actorCount: number;
  hasHumans: boolean;
  hasAgents: boolean;
}

/**
 * Branch-level presence aggregation.
 */
export interface BranchPresence {
  branchId: string;
  branchName: string;
  siteId: string;
  summary: PresenceSummary;
  actors: ActorPresence[];
  documentSummary: DocumentPresenceSummary[];
}

/**
 * Per-branch presence summary for site rollups.
 */
export interface BranchPresenceSummary {
  branchId: string;
  branchName: string;
  actorCount: number;
  hasHumans: boolean;
  hasAgents: boolean;
}

/**
 * Site-level presence aggregation.
 */
export interface SitePresence {
  siteId: string;
  siteName: string;
  summary: {
    totalActors: number;
    humanCount: number;
    agentCount: number;
    activeBranches: number;
  };
  branches: BranchPresenceSummary[];
}

/**
 * Agent presence location for global agent queries.
 */
export interface AgentPresenceLocation {
  siteId: string;
  siteName: string;
  branchId: string;
  branchName: string;
  documentId: string;
  documentPath: string;
  presence: ActorPresence;
}

/**
 * Agent's presence across an organization.
 */
export interface AgentGlobalPresence {
  agentId: string;
  agentName: string;
  organizationId: string;
  locations: AgentPresenceLocation[];
}
