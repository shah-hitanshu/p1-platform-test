/**
 * Collaborative Content Repository - Core Domain Entity Types
 *
 * Organization, Site, Branch, Document, DocumentVersion, Checkpoint,
 * Merge Request, and Conflict types.
 */

import type {
  AgentStatus,
  BranchStatus,
  CheckpointStatus,
  CheckpointTrigger,
  CheckpointType,
  DocumentConflictType,
  DocumentVersionSource,
  MergeApprovalMode,
  MergeRequestStatus,
  ApproverMode,
  StructureConflictType,
} from './enums';

// =============================================================================
// Core Entities
// =============================================================================

/**
 * Workflow settings for a site's merge approval process.
 */
export interface WorkflowSettings {
  mergeApprovalMode: MergeApprovalMode;
  minApprovers: number;
  allowSelfApproval: boolean;
  approverMode: ApproverMode;
  approverMinRole?: 'EDITOR' | 'ADMIN';
}

/**
 * Priority tier configuration for agent scheduling.
 */
export interface AgentPriorityTier {
  name: string;
  idleTimeoutMultiplier: number;
  canInterruptAutonomous: boolean;
}

/**
 * Organization-level settings for agent behavior.
 */
export interface OrganizationSettings {
  /**
   * How long humans must be idle before autonomous agents can edit (default: 5000ms).
   * Optional for defensive handling of missing/legacy data.
   */
  agentIdleTimeoutMs?: number;
  /** Future: priority tier configurations */
  agentPriorityTiers?: Record<string, AgentPriorityTier>;
}

/**
 * Organization entity for agent configuration and site grouping.
 * Minimal model owned by this service for agent politeness.
 */
export interface Organization {
  id: string;
  name: string;
  settings: OrganizationSettings;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp when the organization was soft-deleted; null if active. */
  archivedAt: string | null;
  /** PCC space ID linked to this org for frontend BA merging; null if P1-only. */
  externalSpaceId?: string | null;
  /** Email of the org owner (first member). */
  ownerEmail?: string;
}

/**
 * Agent-specific settings for registered agents.
 */
export interface AgentSettings {
  /** Reference to priority tier name */
  priorityTier?: string;
  /** Allowed operation types (future) */
  allowedOperationTypes?: string[];
  /** Maximum concurrent document edits (future) */
  maxConcurrentDocuments?: number;
}

/**
 * Registered agent at the organization level.
 * Individual agent accounts for the Agent Politeness System.
 */
export interface RegisteredAgent {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  capabilities: string[];
  status: AgentStatus;
  settings: AgentSettings;
  createdAt: string;
  updatedAt: string;
}

/**
 * Represents a Pantheon website in the collaborative content repository.
 */
export interface Site {
  id: string;
  /** The linked hosting site's ID; absent until a user links one. */
  pantheonSiteId?: string;
  /** Organization this site belongs to (for agent configuration) */
  organizationId?: string;
  name: string;
  /** Public URL of the site, used for screenshotting and Pantheon lookups. */
  url?: string;
  workflowSettings: WorkflowSettings;
  /** Allowed origin patterns for OAuth redirect URI validation */
  allowedOrigins: string[];
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp when the site was soft-deleted; null if active. */
  archivedAt: string | null;
}

/**
 * Outcome of the most recent screenshot capture for a site.
 * - 'ok'     : R2 object exists at r2Key and is the current screenshot.
 * - 'failed' : nothing stored. The reason (HTTP error, auth-gated page,
 *              browser timeout, etc.) is in `error`.
 */
export type SiteScreenshotStatus = 'ok' | 'failed';

/**
 * Current screenshot state for a site. One row per site.
 */
export interface SiteScreenshot {
  siteId: string;
  r2Key: string;
  status: SiteScreenshotStatus;
  capturedAt: string;
  /** Short reason when status != 'ok'. */
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A named line of work within a site.
 * Each site has a main branch representing the published state.
 */
export interface Branch {
  id: string;
  siteId: string;
  name: string;
  description?: string;
  status: BranchStatus;
  isMain: boolean;
  sourceBranchId?: string;
  sourceCheckpointId?: string;
  createdById: string;
  /** Main branches are seeded by the system, not by a user or an agent. */
  createdByType: 'user' | 'agent' | 'system';
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp when the branch was soft-deleted; null if active. */
  archivedAt: string | null;
}

/**
 * A single JSON document identified by path within a site.
 * Documents exist independently across branches.
 */
export interface Document {
  id: string;
  siteId: string;
  path: string;
  createdAt: string;
  /** Reference to template document (if created from template) */
  templateId?: string;
  /** Version of template this document was created from or last migrated to */
  templateVersion?: number;
  /** BCP-47 language tag of this variant; absent for a canonical document */
  locale?: string;
}

/**
 * Snapshot of document state on a specific branch at a point in time.
 */
export interface DocumentVersion {
  id: string;
  documentId: string;
  branchId: string;
  versionNumber: number;
  snapshot?: Record<string, unknown>;
  patch?: unknown[]; // RFC 6902 JSON Patch operations array
  /** @deprecated CRDT state is no longer stored. Column removed in migration 030. */
  crdtState?: string;
  actionType?: string; // Puck action type (e.g., "insert", "reorder", "set")
  actionMetadata?: Record<string, unknown>; // Additional Puck action context
  source: DocumentVersionSource;
  createdById: string;
  createdByType: 'user' | 'agent' | 'service' | 'system';
  createdAt: string;
  isPublished?: boolean;
  isTombstone?: boolean;
  sourceBranchId?: string;
  sourceVersionId?: string;
  publishedToVersionId?: string;
  sourceBranchName?: string;
}

// =============================================================================
// Checkpoint
// =============================================================================

/**
 * Named snapshot of branch state at a point in time.
 * Serves as semantic markers, rollback points, and merge bases.
 * Enhanced for Agent Politeness System with trigger, status, and rollback tracking.
 */
export interface Checkpoint {
  id: string;
  branchId: string;
  name?: string;
  message?: string;
  /** Detailed description of what the checkpoint contains */
  description?: string;
  checkpointType: CheckpointType;
  /** ID of the parent checkpoint for incremental checkpoints (Phase 6.1) */
  parentCheckpointId?: string;
  /**
   * True when this checkpoint captured every live document on the branch, so a
   * parent-chain walk can stop here. False for deltas.
   */
  isFullSnapshot?: boolean;

  // Agent Politeness fields
  /** How this checkpoint was triggered */
  trigger?: CheckpointTrigger;
  /** User ID who requested the agent action (if trigger = human_requested) */
  requestedById?: string;
  /** Category of operation that created this checkpoint */
  operationType?: string;
  /** JSON paths of regions affected by this checkpoint */
  affectedRegions?: string[];
  /** Checkpoint completion status */
  status?: CheckpointStatus;
  /** User ID who rolled back this checkpoint */
  rolledBackById?: string;
  /** When the checkpoint was rolled back */
  rolledBackAt?: string;

  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  createdAt: string;
}

/**
 * The actor an edit session belongs to. Edit permission, checkpoint
 * attribution, presence, and the session-owner check all read from it.
 */
export interface SessionOwner {
  id: string;
  type: 'user' | 'agent';
}

// =============================================================================
// Merge Types
// =============================================================================

/**
 * Describes a conflict for a single document during merge.
 */
export interface DocumentConflict {
  documentId: string;
  documentPath: string;
  conflictType: DocumentConflictType;
  sourceVersion?: number;
  targetVersion?: number;
  baseVersion?: number;
}

/**
 * Describes a conflict at the structure level during merge.
 */
export interface StructureMergeConflict {
  structureId: string;
  conflictType: StructureConflictType;
  details: {
    nodeId?: string;
    documentId?: string;
    sourceValue: unknown;
    targetValue: unknown;
    baseValue: unknown;
  };
}

/**
 * Complete conflict information for a merge request.
 */
export interface ConflictDetails {
  documentConflicts: DocumentConflict[];
  structureConflicts: StructureMergeConflict[];
}

/**
 * Proposal to merge changes from source branch to target branch.
 */
export interface MergeRequest {
  id: string;
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
  baseCheckpointId?: string;
  title: string;
  description?: string;
  status: MergeRequestStatus;
  hasConflicts: boolean;
  conflictDetails?: ConflictDetails;
  createdById: string;
  createdByType: 'user' | 'agent';
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  mergedById?: string;
  mergedByType?: string;
}

// =============================================================================
// Template Migration System
// =============================================================================

/**
 * Tracks a template migration job that updates documents to a new template version.
 */
export interface MigrationJob {
  id: string;
  siteId: string;
  branchId: string;
  templateId: string;
  fromVersion: number;
  toVersion: number;
  /** Optional pre-migration checkpoint for rollback */
  checkpointId?: string;
  status: import('./enums').MigrationJobStatus;
  totalDocuments: number;
  processedDocuments: number;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  createdAt: string;
  completedAt?: string;
}

/**
 * Records a migration conflict requiring manual resolution.
 */
export interface MigrationConflict {
  id: string;
  migrationJobId: string;
  documentId: string;
  branchId: string;
  templateId: string;
  fromVersion: number;
  toVersion: number;
  /** The template's slot delta between the migration's from and to versions. */
  templateDelta: Record<string, unknown>;
  /** The document's own slot delta since its last migration baseline. */
  documentDelta: Record<string, unknown>;
  /** How conflict was resolved */
  resolution?: import('./enums').MigrationResolution;
  createdAt: string;
  resolvedAt?: string;
}
