/**
 * Collaborative State System - Core TypeScript Types
 *
 * Phase 1.3: Type definitions matching the architecture document.
 * @see collaborative-state-system-architecture-v2.2.md
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
 */
export type CheckpointType = 'manual' | 'auto' | 'pre_merge' | 'post_merge';

/**
 * Source of a document version creation.
 */
export type DocumentVersionSource = 'edit' | 'merge' | 'revert' | 'checkpoint';

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
 * Represents a Pantheon website in the collaborative state system.
 */
export interface Site {
  id: string;
  pantheonSiteId: string;
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
}

// =============================================================================
// Checkpoint
// =============================================================================

/**
 * Named snapshot of branch state at a point in time.
 * Serves as semantic markers, rollback points, and merge bases.
 */
export interface Checkpoint {
  id: string;
  branchId: string;
  name?: string;
  message?: string;
  checkpointType: CheckpointType;
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

/**
 * Pre-validated identity from Pantheon Identity Service.
 */
export interface AuthenticatedPrincipal {
  id: string;
  type: 'user' | 'agent' | 'service';
  email?: string;
  organizationId?: string;
  pantheonSiteRoles: Record<string, PantheonRole>;
  tokenExpiry: string;
  scopes?: string[];
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
 */
export interface ConnectionMeta {
  actorId: string;
  actorType: 'user' | 'agent';
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
