/**
 * Collaborative State System - Core TypeScript Types
 *
 * Phase 1.3: Type definitions matching the architecture document.
 * Phase 1.2 (Agent Politeness): Added organization, agent registry, and presence types.
 * @see collaborative-state-system-architecture-v2.3.md
 */

// =============================================================================
// Common Enums and Union Types
// =============================================================================

/**
 * Types of actors that can perform actions in the system.
 */
export type ActorType = 'user' | 'agent' | 'guest' | 'service' | 'system';

/**
 * Pantheon platform roles for site access.
 */
export type PantheonRole = 'owner' | 'admin' | 'developer' | 'team_member';

/**
 * Agent-specific site roles (mapped from Pantheon roles).
 */
export type AgentSiteRole = 'viewer' | 'editor' | 'admin';

/**
 * Internal role names for the collaborative state system.
 * Effective role = max(Pantheon Site Role, Branch Grant)
 */
export type RoleName = 'NO_ACCESS' | 'VIEWER' | 'EDITOR' | 'ADMIN';

/**
 * Branch lifecycle states.
 */
export type BranchStatus = 'active' | 'review' | 'merged' | 'archived';

/**
 * Types of checkpoints that can be created.
 * - manual: Created by user action
 * - auto: Created automatically by the system
 * - pre_merge: Created before a merge operation
 * - post_merge: Created after a merge operation
 * - agent_pre_edit: Created before an agent starts editing (for rollback)
 * - agent_post_edit: Created after an agent completes editing (for audit)
 */
export type CheckpointType = 'manual' | 'auto' | 'pre_merge' | 'post_merge' | 'agent_pre_edit' | 'agent_post_edit';

/**
 * Source of a document version creation.
 */
export type DocumentVersionSource = 'edit' | 'merge' | 'revert' | 'checkpoint' | 'realtime' | 'publish';

/**
 * Merge request workflow states.
 */
export type MergeRequestStatus = 'open' | 'approved' | 'merged' | 'closed' | 'conflicted';

/**
 * Approval request states.
 */
export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/**
 * Guest link states.
 */
export type GuestLinkStatus = 'active' | 'revoked' | 'expired';

/**
 * Merge approval requirements for a site.
 */
export type MergeApprovalMode = 'none' | 'optional' | 'required';

/**
 * How approvers are selected for merge requests.
 */
export type ApproverMode = 'role_based' | 'explicit' | 'both';

/**
 * Strategies for resolving merge conflicts.
 */
export type ConflictResolutionStrategy = 'take-source' | 'take-target' | 'merge-crdt' | 'manual';

/**
 * Types of site structures.
 */
export type StructureType = 'collection' | 'hierarchy';

/**
 * Types of nodes within a site structure.
 */
export type NodeType = 'section' | 'document' | 'external';

/**
 * Schema enforcement modes for document metadata.
 */
export type SchemaEnforcementMode = 'strict' | 'warn' | 'none';

/**
 * Types of edit operations for programmatic document editing.
 */
export type EditOperationType = 'set' | 'delete' | 'insert' | 'move' | 'replace';

// =============================================================================
// Agent Politeness System - Union Types
// =============================================================================

/**
 * How a checkpoint was triggered.
 * - manual: User explicitly created checkpoint
 * - human_requested: Agent created after user requested work
 * - autonomous: Agent created during autonomous operation
 */
export type CheckpointTrigger = 'manual' | 'human_requested' | 'autonomous';

/**
 * Checkpoint completion status.
 * - completed: Operation finished successfully
 * - rolled_back: Operation was rolled back (agent yielded to human)
 * - partial: Operation was interrupted before completion
 */
export type CheckpointStatus = 'completed' | 'rolled_back' | 'partial';

/**
 * Agent operational status.
 * - active: Agent can perform all allowed operations
 * - suspended: Agent cannot start new operations but can complete in-progress work
 * - disabled: Agent cannot perform any operations
 */
export type AgentStatus = 'active' | 'suspended' | 'disabled';

/**
 * Actor presence state within a document.
 */
export type PresenceState = 'active' | 'idle' | 'editing';

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

// =============================================================================
// Agent Politeness System - Organization & Agent Registry
// =============================================================================

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
 * Represents a Pantheon website in the collaborative state system.
 */
export interface Site {
  id: string;
  pantheonSiteId: string;
  /** Organization this site belongs to (for agent configuration) */
  organizationId?: string;
  name: string;
  workflowSettings: WorkflowSettings;
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
  createdByType: 'user' | 'agent';
  createdAt: string;
  updatedAt: string;
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
}

/**
 * Snapshot of document state on a specific branch at a point in time.
 */
export interface DocumentVersion {
  id: string;
  documentId: string;
  branchId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
  crdtState?: string; // Base64-encoded CRDT state
  source: DocumentVersionSource;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
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

// =============================================================================
// Merge Types
// =============================================================================

/**
 * Types of document-level conflicts during merge.
 */
export type DocumentConflictType = 'both-modified' | 'deleted-in-source' | 'deleted-in-target';

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
  crdtMergePossible?: boolean;
}

/**
 * Types of structure-level conflicts during merge.
 */
export type StructureConflictType = 'node-move' | 'node-delete' | 'schema-change' | 'metadata-change';

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
// Authorization Types
// =============================================================================

/**
 * Permissions available to each role level.
 */
export interface RolePermissions {
  canView: boolean;
  canEdit: boolean;
  canCreateBranch: boolean;
  canEditDocuments: boolean;
  canCreateCheckpoint: boolean;
  canProposeMerge: boolean;
  canMerge: boolean;
  canMergeToMain: boolean;
  canManageGrants: boolean;
}

/**
 * Role definition with name and associated permissions.
 */
export interface Role {
  name: RoleName;
  permissions: RolePermissions;
}

/**
 * Elevates an actor's permissions on a specific branch.
 */
export interface BranchGrant {
  id: string;
  branchId: string;
  actorId: string;
  actorType: 'user' | 'agent';
  role: RoleName;
  grantedById: string;
  grantedByType: 'user' | 'agent';
  grantedAt: string;
  reason?: string;
}

/**
 * Magic link for view-only branch access.
 * Guests can access without a Pantheon account.
 */
export interface GuestLink {
  id: string;
  branchId: string;
  email: string;
  name?: string;
  tokenHash: string;
  status: GuestLinkStatus;
  expiresAt: string;
  createdById: string;
  createdByType: 'user' | 'agent';
  createdAt: string;
  message?: string;
  accessCount: number;
  lastAccessAt?: string;
}

/**
 * Tracks approval requests for merge requests.
 */
export interface ApprovalRequest {
  id: string;
  mergeRequestId: string;
  approverEmail: string;
  approverName?: string;
  tokenHash?: string;
  status: ApprovalRequestStatus;
  expiresAt?: string;
  respondedAt?: string;
  comment?: string;
  createdAt: string;
}

// =============================================================================
// Identity Types
// =============================================================================

/** Authentication provider that validated the token */
export type AuthProvider = 'auth0' | 'google' | 'mock' | 'site_token' | 'agent_key' | 'unknown';

/**
 * Pre-validated identity from Pantheon Identity Service.
 */
export interface AuthenticatedPrincipal {
  id: string;
  type: 'user' | 'agent' | 'service';
  email?: string;
  /** Display name from the identity provider */
  name?: string;
  /** Profile picture URL from the identity provider */
  avatarUrl?: string;
  organizationId?: string;
  pantheonSiteRoles: Record<string, PantheonRole>;
  tokenExpiry: string;
  scopes?: string[];
  /** Which auth provider validated this principal */
  authProvider?: AuthProvider;
  /** Original subject ID from the OAuth provider (before UUIDv5 mapping) */
  providerSubjectId?: string;
  /** Database users.id (may differ from id which is a provider-derived UUIDv5) */
  dbUserId?: string;
  /** Site ID this principal is scoped to (for service/site_token principals) */
  siteId?: string;
  /** System-level role from the users allowlist ('admin' or 'member') */
  systemRole?: string;
}

/**
 * AI agent identity with capabilities and site access.
 */
export interface AgentIdentity {
  id: string;
  organizationId: string;
  name: string;
  capabilities: string[];
  siteAccess: Record<string, AgentSiteRole>;
}

/**
 * Test user for local development.
 */
export interface MockUser {
  id: string;
  email: string;
  name: string;
  siteRoles: Record<string, PantheonRole>;
}

/**
 * Test agent for local development.
 */
export interface MockAgent {
  id: string;
  name: string;
  apiKey: string; // Unhashed for local testing
  siteRoles: Record<string, AgentSiteRole>;
}

/**
 * Configuration for mock identity provider.
 */
export interface MockIdentityConfig {
  users: MockUser[];
  agents: MockAgent[];
  defaultSiteRoles: Record<string, PantheonRole>;
}

// =============================================================================
// Structure Types
// =============================================================================

/**
 * Hierarchical organizational container within a site.
 */
export interface SiteStructure {
  id: string;
  siteId: string;
  name: string;
  slug: string;
  description?: string;
  structureType: StructureType;
  createdAt: string;
}

/**
 * Entry in a site structure hierarchy.
 */
export interface StructureNode {
  id: string;
  structureId: string;
  parentNodeId?: string;
  position: number;
  name: string;
  slug: string;
  nodeType: NodeType;
  documentId?: string; // For document nodes
  externalUrl?: string; // For external nodes
  createdAt: string;
}

/**
 * Tracks structure state per branch.
 */
export interface BranchStructureState {
  id: string;
  branchId: string;
  structureId: string;
  nodesSnapshot: Record<string, unknown>[];
  metadataSchema?: Record<string, unknown>;
  schemaEnforcement: SchemaEnforcementMode;
  updatedAt: string;
}

/**
 * Stores metadata per document per branch.
 */
export interface BranchDocumentMetadata {
  id: string;
  branchId: string;
  documentId: string;
  structureId: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

/**
 * Single field validation error.
 */
export interface SchemaValidationError {
  field: string;
  message: string;
  currentValue?: unknown;
}

/**
 * Document that doesn't conform to schema.
 */
export interface NonConformingDocument {
  documentId: string;
  documentPath: string;
  errors: SchemaValidationError[];
}

/**
 * Result of validating documents against a structure's metadata schema.
 */
export interface SchemaValidationResult {
  structureId: string;
  totalDocuments: number;
  conformingDocuments: number;
  nonConformingDocuments: NonConformingDocument[];
}

// =============================================================================
// Operations Types
// =============================================================================

/**
 * Represents a single edit operation on document content.
 */
export interface EditOperation {
  type: EditOperationType;
  path: string;
  value?: unknown;
  content?: unknown;
  index?: number;
  fromIndex?: number;
  toIndex?: number;
}

/**
 * Metadata about a WebSocket connection to a document session.
 * Auth Phase 4: Extended with authProvider, email, and verified fields
 * to track authenticated identity context.
 */
export interface ConnectionMeta {
  actorId: string;
  actorType: 'user' | 'agent';
  authProvider?: AuthProvider;
  email?: string;
  /** Display name for presence */
  name?: string;
  /** Profile picture URL for presence */
  avatar?: string;
  verified: boolean;
}

// =============================================================================
// Audit Types
// =============================================================================

/**
 * Actor information for audit events.
 */
export interface AuditActor {
  id: string;
  type: 'user' | 'agent' | 'guest' | 'system';
}

/**
 * Resource information for audit events.
 */
export interface AuditResource {
  type: string;
  id: string;
  siteId: string;
}

/**
 * Records significant system actions for audit logging.
 */
export interface AuditEvent {
  service: 'collaborative-state';
  action: string;
  actor: AuditActor;
  resource: AuditResource;
  context: Record<string, unknown>;
  timestamp: string;
  success: boolean;
  errorMessage?: string;
}

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
