/**
 * CSS Client Types
 *
 * TypeScript types matching the Collaborative State System API.
 */

// =============================================================================
// Core Domain Types
// =============================================================================

/**
 * Workflow settings for a site.
 */
export interface WorkflowSettings {
  mergeApprovalMode: 'optional' | 'required';
  minApprovers: number;
  allowSelfApproval: boolean;
  approverMode: 'users' | 'agents' | 'both';
  approverMinRole: string;
}

/**
 * A site in the Collaborative State System.
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
 * Branch status values.
 */
export type BranchStatus = 'active' | 'merged' | 'archived';

/**
 * A branch within a site.
 */
export interface Branch {
  id: string;
  siteId: string;
  name: string;
  isMain: boolean;
  status: BranchStatus;
  sourceBranchId: string | null;
  sourceCheckpointId: string | null;
  createdById: string;
  createdByType: 'user' | 'agent';
  createdAt: string;
  updatedAt: string;
}

/**
 * A document (page) within a site.
 */
export interface Document {
  id: string;
  siteId: string;
  path: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Document version source types.
 */
export type DocumentVersionSource = 'edit' | 'merge' | 'revert' | 'initial';

/**
 * A version of a document on a specific branch.
 */
export interface DocumentVersion {
  id: string;
  documentId: string;
  branchId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
  crdtState: string | null;
  source: DocumentVersionSource;
  createdById: string;
  createdByType: 'user' | 'agent';
  createdAt: string;
}

/**
 * Checkpoint types.
 */
export type CheckpointType = 'manual' | 'auto' | 'merge' | 'pre_merge';

/**
 * A checkpoint capturing the state of all documents on a branch.
 */
export interface Checkpoint {
  id: string;
  branchId: string;
  name: string | null;
  checkpointType: CheckpointType;
  createdById: string;
  createdByType: 'user' | 'agent';
  createdAt: string;
}

/**
 * Document with its version snapshot at a checkpoint.
 */
export interface CheckpointDocument {
  documentId: string;
  documentPath: string;
  versionId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
}

// =============================================================================
// Puck-Specific Types
// =============================================================================

/**
 * Puck component data.
 */
export interface PuckComponentData {
  type: string;
  props: Record<string, unknown> & { id: string };
}

/**
 * Puck root data.
 */
export interface PuckRootData {
  props?: Record<string, unknown>;
}

/**
 * Puck page data structure.
 * This is the format stored in DocumentVersion.snapshot.
 */
export interface PuckData {
  content: PuckComponentData[];
  root: PuckRootData;
  zones?: Record<string, PuckComponentData[]>;
}

// =============================================================================
// API Request/Response Types
// =============================================================================

/**
 * Principal (user or agent) making API requests.
 */
export interface Principal {
  id: string;
  type: 'user' | 'agent';
}

/**
 * Pagination options for list endpoints.
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

/**
 * Parameters for creating a branch.
 */
export interface CreateBranchParams {
  siteId: string;
  name: string;
  sourceBranchId?: string;
}

/**
 * Parameters for creating a document.
 */
export interface CreateDocumentParams {
  siteId: string;
  branchId: string;
  path: string;
}

/**
 * Parameters for creating a document version.
 */
export interface CreateDocumentVersionParams {
  documentId: string;
  branchId: string;
  snapshot: Record<string, unknown>;
}

/**
 * Parameters for creating a checkpoint.
 */
export interface CreateCheckpointParams {
  branchId: string;
  name?: string;
  type?: CheckpointType;
}

/**
 * List documents options.
 */
export interface ListDocumentsOptions extends PaginationOptions {
  pathPrefix?: string;
}
