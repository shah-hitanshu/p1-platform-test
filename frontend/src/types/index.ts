/**
 * Frontend type definitions for the Collaborative State System API Explorer
 */

// User types
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  siteRoles: Record<string, string>;
}

export interface Agent {
  id: string;
  name: string;
  siteRoles: Record<string, string>;
}

// Auth response types
export interface LoginResponse {
  token: string;
  user: User;
}

export interface UsersResponse {
  users: User[];
  agents: Agent[];
}

// Site types
export interface Site {
  id: string;
  pantheonSiteId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// Branch types
export type BranchStatus = 'active' | 'review' | 'merged' | 'archived' | 'abandoned';

export interface Branch {
  id: string;
  siteId: string;
  name: string;
  /** Whether this is the main branch for the site */
  isMain: boolean;
  /** The branch this was created from (null for main branch) */
  sourceBranchId?: string;
  status: BranchStatus;
  createdAt: string;
  updatedAt: string;
}

// Document types
export interface Document {
  id: string;
  siteId: string;
  path: string;
  createdAt: string;
  archivedAt?: string | null;
}

// Document Version types
export interface DocumentVersion {
  id: string;
  documentId: string;
  branchId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
  source: 'edit' | 'merge' | 'revert' | 'import';
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  createdAt: string;
}

// Checkpoint types
export interface Checkpoint {
  id: string;
  branchId: string;
  name: string;
  type: 'manual' | 'auto' | 'merge';
  createdById: string;
  createdByType: 'user' | 'agent';
  createdAt: string;
}

// Merge Request types
export type MergeRequestStatus = 'open' | 'approved' | 'merged' | 'closed' | 'conflicted';

export type DocumentConflictType = 'both-modified' | 'deleted-in-source' | 'deleted-in-target';

export interface DocumentConflict {
  documentId: string;
  documentPath: string;
  conflictType: DocumentConflictType;
  sourceVersion?: number;
  targetVersion?: number;
}

export interface ConflictDetails {
  documentConflicts: DocumentConflict[];
  structureConflicts: unknown[];
}

export interface MergeRequest {
  id: string;
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
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
}

export type ConflictResolutionStrategy = 'take-source' | 'take-target' | 'merge-crdt' | 'manual';

/**
 * RFC 6902 JSON Patch operation.
 */
export interface DiffOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy';
  path: string;
  value?: unknown;
  from?: string;
}

/**
 * Diff result for a single document, including snapshots and operations.
 */
export interface DocumentDiff {
  documentId: string;
  documentPath: string;
  sourceSnapshot: Record<string, unknown> | null;
  targetSnapshot: Record<string, unknown> | null;
  diffOperations: DiffOperation[];
}

/**
 * A document that was modified on a branch since the merge base.
 */
export interface ModifiedDocument {
  documentId: string;
  documentPath: string;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
  baseVersionId: string | null;
  baseVersionNumber: number | null;
  isDeleted?: boolean;
}

export interface MergePreview {
  canMerge: boolean;
  hasConflicts: boolean;
  conflicts: ConflictDetails;
  /** Documents modified on the source branch since the merge base. */
  sourceChanges?: ModifiedDocument[];
  /** Documents modified on the target branch since the merge base. */
  targetChanges?: ModifiedDocument[];
  /** Document diffs with snapshots and operations. Only included when includeContent=true. */
  documentDiffs?: DocumentDiff[];
}

export interface MergeExecuteResult {
  success: boolean;
  checkpointId?: string;
  documentsUpdated: number;
}

// Health check types
export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  environment: string;
  timestamp: string;
  database?: {
    connected: boolean;
    latencyMs?: number;
    error?: string;
  };
}

// API error response
export interface ApiError {
  error: string;
  details?: unknown;
}

// Grant types
export interface Grant {
  id: string;
  branchId: string;
  actorId: string;
  actorType: 'user' | 'agent';
  role: string;
  grantedById: string;
  grantedByType: 'user' | 'agent';
  reason: string | null;
  grantedAt: string;
}

// Structure types
export interface Structure {
  id: string;
  siteId: string;
  name: string;
  slug: string;
  description: string | null;
  structureType: 'hierarchy' | 'collection';
  metadataSchema: Record<string, unknown> | null;
  schemaEnforcement: 'strict' | 'warn' | 'none';
  createdAt: string;
  updatedAt: string;
}

// System user types (admin allowlist)
export interface SystemUser {
  id: string;
  email: string;
  name: string | null;
  principalId: string | null;
  authProvider: string | null;
  systemRole: 'admin' | 'member';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Site collaborator types
export interface Collaborator {
  id: string;
  userId: string;
  siteId: string;
  role: string;         // 'owner' | 'admin' | 'developer' | 'team_member'
  source: string;       // 'local' | 'mas'
  createdAt: string;
  updatedAt: string;
}

// Site API Token types
export interface SiteApiToken {
  id: string;
  siteId: string;
  prefix: string;
  name: string;
  scopes: string[];
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

// Registered Agent types (from agent registry)
export interface RegisteredAgent {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  capabilities: string[];
  status: 'active' | 'suspended' | 'disabled';
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Agent API Key types
export interface AgentApiKey {
  id: string;
  agentId: string;
  prefix: string;
  name: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

// Agent Site Role types
export interface AgentSiteRole {
  id: string;
  agentId: string;
  siteId: string;
  role: 'viewer' | 'editor' | 'admin';
  grantedBy: string;
  grantedAt: string;
  revokedAt: string | null;
  agentName?: string;
}

// Node types
export interface StructureNode {
  id: string;
  structureId: string;
  parentNodeId: string | null;
  name: string;
  slug: string;
  nodeType: 'section' | 'document' | 'external';
  documentId: string | null;
  externalUrl: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}
