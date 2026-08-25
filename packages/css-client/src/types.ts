/**
 * P1 Client Types
 *
 * TypeScript types matching the Collaborative Content Repository API.
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
 * A site in the Collaborative Content Repository.
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
  /** Whether this document has been published on the current branch */
  isPublished?: boolean;
  /** Version ID from the most recent checkpoint containing this document */
  publishedVersionId?: string | null;
  /** Timestamp of the checkpoint that published this document */
  publishedAt?: string | null;
  /** Whether this document is inherited from the parent branch (COW) vs locally edited */
  inherited?: boolean;
  /** Template this document is bound to (nullable for blank pages) */
  templateId?: string | null;
  /** Version of the template this document was created from or migrated to */
  templateVersion?: number | null;
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
  /** Whether this version has been published (exists in a checkpoint) */
  isPublished?: boolean;
  /** For source='revert' versions: the id of the version that was restored */
  sourceVersionId?: string;
  /** Classification of this version: 'structural' or null (prop-only) */
  actionType?: string;
  /** Action metadata including puckActions array when structural */
  actionMetadata?: Record<string, unknown>;
}

/**
 * Checkpoint types.
 */
export type CheckpointType = 'manual' | 'auto' | 'merge' | 'pre_merge' | 'agent_edit';

/**
 * Checkpoint status for agent edits.
 */
export type CheckpointStatus = 'completed' | 'rolled_back';

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
  // Agent politeness fields (optional, populated for agent checkpoints)
  /** Name of the creator (user or agent) */
  createdByName?: string;
  /** Description of what was done */
  description?: string;
  /** How the action was triggered */
  trigger?: AgentTrigger;
  /** ID of the user who requested the agent action */
  requestedById?: string;
  /** Name of the user who requested the agent action */
  requestedByName?: string;
  /** Type of operation performed */
  operationType?: string;
  /** Regions affected by the operation */
  affectedRegions?: string[];
  /** Status of the checkpoint */
  status?: CheckpointStatus;
  /** ID of user who rolled back (if rolled_back) */
  rolledBackById?: string;
  /** When the checkpoint was rolled back */
  rolledBackAt?: string;
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

/**
 * A Puck editor action forwarded from the frontend.
 * Uses the proposal's flat format: { type, sourceIndex, ... }
 */
export interface PuckAction {
  type: string;
  [key: string]: unknown;
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
  /** Optional template ID to bind this document to */
  templateId?: string;
  /** Optional template version (defaults to template's current version if not provided) */
  templateVersion?: number;
  /** Optional initial version content, written in the same call as the create */
  snapshot?: Record<string, unknown>;
  /** Optional page title seeded into the initial version's root.props.title */
  title?: string;
}

/**
 * Parameters for creating a document version.
 */
export interface CreateDocumentVersionParams {
  documentId: string;
  branchId: string;
  snapshot: Record<string, unknown>;
  puckActions?: PuckAction[];
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
 * Result of publishing a single document.
 */
export interface PublishDocumentResult {
  checkpoint: Checkpoint;
  publishedVersionId: string;
}

/**
 * List documents options.
 */
export interface ListDocumentsOptions extends PaginationOptions {
  pathPrefix?: string;
}

// =============================================================================
// Agent Politeness Types
// =============================================================================

/**
 * Actor state in a document session.
 */
export type ActorState = 'active' | 'idle' | 'editing';

/**
 * Simplified role for presence display.
 */
export type ActorRole = 'human' | 'agent';

/**
 * Presence information for an actor in a document.
 */
export interface ActorPresence {
  id: string;
  actorId: string;
  actorType: 'user' | 'agent';
  role: ActorRole;
  name: string;
  avatar?: string;
  state: ActorState;
  intent?: string;
  focusRegions?: string[];
  /** ID of the human who triggered this agent session (human_requested sessions only) */
  requestedById?: string;
  /** Display name of the human who triggered this agent session (human_requested sessions only) */
  requestedByName?: string;
  lastActivityAt: string;
  joinedAt: string;
}

/**
 * Summary of presence in a document.
 */
export interface DocumentPresenceSummary {
  documentId: string;
  documentPath: string;
  actorCount: number;
  hasHumans: boolean;
  hasAgents: boolean;
}

/**
 * Summary of presence in a branch.
 */
export interface BranchPresenceSummary {
  branchId: string;
  branchName: string;
  actorCount: number;
  hasHumans: boolean;
  hasAgents: boolean;
}

/**
 * Presence rollup for a branch.
 */
export interface BranchPresence {
  branchId: string;
  branchName: string;
  siteId: string;
  summary: {
    totalActors: number;
    humanCount: number;
    agentCount: number;
    editingCount: number;
  };
  actors: ActorPresence[];
  documentSummary: DocumentPresenceSummary[];
}

/**
 * Presence rollup for a site.
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
 * Location where an agent is present.
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
 * Global presence for an agent across an organization.
 */
export interface AgentGlobalPresence {
  agentId: string;
  agentName: string;
  organizationId: string;
  locations: AgentPresenceLocation[];
}

// =============================================================================
// Agent Registry Types
// =============================================================================

/**
 * Agent status values.
 */
export type AgentStatus = 'active' | 'suspended' | 'disabled';

/**
 * Agent settings.
 */
export interface AgentSettings {
  priorityTier?: string;
  allowedOperationTypes?: string[];
  maxConcurrentDocuments?: number;
}

/**
 * A registered agent in an organization.
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
 * Parameters for creating an agent.
 */
export interface CreateAgentParams {
  name: string;
  description?: string;
  capabilities?: string[];
  settings?: AgentSettings;
}

/**
 * Parameters for updating an agent.
 */
export interface UpdateAgentParams {
  name?: string;
  description?: string;
  capabilities?: string[];
  settings?: AgentSettings;
}

/**
 * Options for listing agents.
 */
export interface ListAgentsOptions {
  status?: AgentStatus;
}

// =============================================================================
// Agent Edit Workflow Types
// =============================================================================

/**
 * Trigger type for agent actions.
 */
export type AgentTrigger = 'human_requested' | 'autonomous';

/**
 * Reason why agent edit was denied.
 */
export type AgentEditDenialReason = 'human_active' | 'region_conflict' | 'agent_suspended';

/**
 * Context for an agent edit operation.
 */
export interface AgentEditContext {
  agentId: string;
  trigger: AgentTrigger;
  requestedById?: string;
  intent: string;
  targetRegions: string[];
  operationType?: string;
}

/**
 * Permission result for agent edit check.
 */
export interface AgentEditPermission {
  allowed: boolean;
  reason?: AgentEditDenialReason;
  retryAfterMs?: number;
  conflictingRegions?: string[];
}

/**
 * Session info returned when starting an agent edit.
 */
export interface AgentEditSession {
  sessionId: string;
  checkpointId?: string;
}

/**
 * Result of completing an agent edit.
 */
export interface AgentEditCompleteResult {
  success: boolean;
  checkpointId?: string;
}

/**
 * Result of aborting an agent edit.
 */
export interface AgentEditAbortResult {
  success: boolean;
  checkpointId?: string;
}

/**
 * Result of stopping an agent (human-initiated).
 * Server looks up the agent's session and performs rollback if needed.
 */
export interface AgentStopResult {
  success: boolean;
  rolledBack: boolean;
  message?: string;
}

// =============================================================================
// Focus Region Types
// =============================================================================

/**
 * Response from updating focus regions.
 */
export interface UpdateFocusRegionsResponse {
  success: boolean;
  focusRegions: string[];
}

// =============================================================================
// WebSocket Presence Message Types
// =============================================================================

/**
 * Update focus regions for the current actor.
 * Sent from client to server via WebSocket text frame.
 */
export interface WsFocusRegionUpdateMessage {
  type: 'focus_region_update';
  /** JSON paths the actor is focused on */
  focusRegions: string[];
  /** Client timestamp for latency measurement */
  timestamp: number;
}

/**
 * Heartbeat to keep presence alive and optionally update state.
 * Sent from client to server via WebSocket text frame.
 */
export interface WsPresenceHeartbeatMessage {
  type: 'presence_heartbeat';
  /** Optional state update */
  state?: ActorState;
  /** Client timestamp for latency measurement */
  timestamp: number;
}

/**
 * Union of all client-to-server WebSocket messages.
 */
export type WsClientMessage = WsFocusRegionUpdateMessage | WsPresenceHeartbeatMessage;

/**
 * Full presence update for all actors in the document.
 * Sent from server to client on connect and periodically.
 */
export interface WsPresenceUpdateMessage {
  type: 'presence_update';
  /** All actors currently present in the document */
  actors: ActorPresence[];
  /** Server timestamp */
  timestamp: number;
}

/**
 * Incremental broadcast when another actor updates their focus regions.
 * Sent from server to client.
 */
export interface WsFocusRegionBroadcastMessage {
  type: 'focus_region_broadcast';
  /** Actor whose focus regions changed */
  actorId: string;
  /** New focus regions for this actor */
  focusRegions: string[];
  /** Server timestamp */
  timestamp: number;
}

/**
 * Acknowledgment of focus region update from client.
 * Sent from server to client.
 */
export interface WsFocusRegionAckMessage {
  type: 'focus_region_ack';
  /** Whether the update was accepted */
  success: boolean;
  /** The focus regions that were set */
  focusRegions: string[];
  /** Server timestamp */
  timestamp: number;
}

/**
 * Error message for invalid presence operations.
 * Sent from server to client.
 */
export interface WsPresenceErrorMessage {
  type: 'presence_error';
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Server timestamp */
  timestamp: number;
}

/**
 * Server acknowledgment that all preceding messages have been processed.
 * Sent in response to a delivery_ack_request from the client.
 */
export interface WsDeliveryAckMessage {
  type: 'delivery_ack';
  /** Matches the requestId from the request */
  requestId: string;
  /** Server timestamp */
  timestamp: number;
}

/**
 * Result of a WebSocket-driven publish request.
 * Sent in response to publish_request after the DO completes flush + publish.
 */
export interface WsPublishResultMessage {
  type: 'publish_result';
  /** Matches the requestId from the request */
  requestId: string;
  /** Whether the publish succeeded */
  success: boolean;
  /** The published version ID (on success) */
  publishedVersionId?: string;
  /** The checkpoint created by the publish (on success) */
  checkpoint?: Checkpoint;
  /** Error message (on failure) */
  error?: string;
  /** Server timestamp */
  timestamp: number;
}

/**
 * Result returned by requestPublish().
 */
export interface PublishResult {
  success: boolean;
  publishedVersionId?: string;
  checkpoint?: Checkpoint;
  error?: string;
}

/**
 * Baseline handshake result from the server, sent after its initial state frame.
 * Carries the server's state vector so the client can reply with only the
 * updates the server is missing.
 */
export interface WsSyncBaselineMessage {
  type: 'sync_baseline';
  gate: 'open' | 'closed';
  /** Base64-encoded Yjs state vector of the server document. */
  serverStateVector: string;
  timestamp: number;
}

/**
 * Union of all server-to-client WebSocket messages.
 */
export type WsServerMessage =
  | WsPresenceUpdateMessage
  | WsFocusRegionBroadcastMessage
  | WsFocusRegionAckMessage
  | WsPresenceErrorMessage
  | WsDeliveryAckMessage
  | WsPublishResultMessage
  | WsSyncBaselineMessage;

// =============================================================================
// Merge Types
// =============================================================================

/**
 * Merge conflict resolution strategies (matches backend).
 */
export type ConflictResolutionStrategy = 'take-source' | 'take-target' | 'manual';

/**
 * Merge request workflow states.
 */
export type MergeRequestStatus = 'open' | 'approved' | 'merging' | 'merged' | 'closed' | 'conflicted';

/**
 * Document-level conflict types.
 */
export type DocumentConflictType = 'both-modified' | 'deleted-in-source' | 'deleted-in-target';

/**
 * A single document conflict in a merge.
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
 * Conflict details containing document and structure conflicts.
 */
export interface ConflictDetails {
  documentConflicts: DocumentConflict[];
  structureConflicts: unknown[];
}

/**
 * Result of checking mergeability between two branches.
 */
export interface MergeabilityResult {
  canMerge: boolean;
  conflicts: DocumentConflict[];
  mergeBase: { checkpointId: string; branchId: string };
  changes: {
    documentsModifiedInSource: string[];
    documentsModifiedInTarget: string[];
  };
}

/**
 * Diff information for a single document in a merge.
 */
export interface DocumentDiff {
  documentId: string;
  documentPath: string;
  sourceSnapshot: Record<string, unknown> | null;
  targetSnapshot: Record<string, unknown> | null;
  diffOperations: unknown[];
}

/**
 * A document that was modified on a branch since the merge base.
 */
export interface MergeDocumentChange {
  documentId: string;
  documentPath: string;
  latestVersionId?: string | null;
  latestVersionNumber?: number | null;
  baseVersionId?: string | null;
  baseVersionNumber?: number | null;
  isDeleted?: boolean;
}

/**
 * Preview of a merge operation between two branches.
 */
export interface MergePreview {
  canMerge: boolean;
  hasConflicts: boolean;
  conflicts: ConflictDetails;
  sourceChanges: MergeDocumentChange[];
  targetChanges: MergeDocumentChange[];
  mergeBase: { checkpointId: string; branchId: string } | null;
  documentDiffs?: DocumentDiff[];
}

/**
 * Parameters for executing a merge.
 */
export interface MergeExecuteParams {
  sourceBranchId: string;
  targetBranchId: string;
  message?: string;
  conflictResolutions?: {
    documentId: string;
    strategy: ConflictResolutionStrategy;
    resolvedSnapshot?: Record<string, unknown>;
  }[];
}

/**
 * Result of executing a merge.
 */
export interface MergeExecuteResult {
  success?: boolean;
  checkpointId?: string;
  documentsUpdated?: number;
  /**
   * Merge job runner [PCC-3737]: present on every runner response. When the
   * merge outlives the server's bounded wait the response is the async shape
   * (202): no `success`, and `status` is not yet terminal — poll the job
   * (merge.getJob / merge.waitForJob) until it is.
   */
  jobId?: string;
  status?: MergeJobStatus;
  totalDocuments?: number;
  processedDocuments?: number;
  statusUrl?: string;
  publishCheckpointId?: string;
  publishError?: string;
}

/** Merge job lifecycle [PCC-3737]. */
export type MergeJobStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'finalizing'
  | 'completed'
  | 'completed_with_errors'
  | 'blocked_on_conflicts'
  | 'failed'
  | 'cancelled';

export const TERMINAL_MERGE_JOB_STATUSES: readonly MergeJobStatus[] = [
  'completed',
  'completed_with_errors',
  'blocked_on_conflicts',
  'failed',
  'cancelled',
];

/** Status projection of a merge job [PCC-3737]. */
export interface MergeJob {
  id: string;
  mergeRequestId: string | null;
  siteId: string;
  status: MergeJobStatus;
  totalDocuments: number;
  processedDocuments: number;
  failedDocuments: number;
  noopDocuments: number;
  postMergeCheckpointId: string | null;
  publishCheckpointId: string | null;
  publishError: string | null;
  error: string | null;
  failedDocumentDetails: { documentId: string; path: string; error: string | null }[];
}

/**
 * A merge request in the system.
 */
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
}

/**
 * Parameters for creating a merge request.
 */
export interface CreateMergeRequestParams {
  sourceBranchId: string;
  targetBranchId: string;
  title: string;
  description?: string;
}

/**
 * Parameters for updating a merge request.
 */
export interface UpdateMergeRequestParams {
  title?: string;
  description?: string;
  status?: MergeRequestStatus;
}

/**
 * Options for listing merge requests.
 */
export interface ListMergeRequestsOptions {
  status?: MergeRequestStatus;
}

/**
 * Options for executing a merge request.
 */
export interface ExecuteMergeRequestOptions {
  resolutions?: {
    documentId: string;
    strategy: ConflictResolutionStrategy;
    resolvedSnapshot?: Record<string, unknown>;
  }[];
}

// =============================================================================
// Content Type Templates
// =============================================================================

/**
 * Template metadata stored at `root.props._template` in the template snapshot.
 */
export interface TemplateMetadata {
  /** Human-readable label */
  label: string;
  /** Optional description */
  description?: string;
  /** Optional default URL pattern */
  defaultUrlPattern?: string;
  /** Whether this template is deprecated (soft-disabled for new documents) */
  deprecated?: boolean;
}

/**
 * A component instance in a template's content. Its props are the default
 * props applied to pages scaffolded from the template.
 */
export interface TemplateContentItem {
  /** Component type */
  type: string;
  /** Component props, including the instance id */
  props: { id: string; [key: string]: unknown };
}

/**
 * Root props of a template snapshot.
 */
export interface TemplateRootProps {
  /** Template metadata */
  _template: TemplateMetadata;
  /** Pinned state by component instance id */
  _pinMap: Record<string, boolean>;
  [key: string]: unknown;
}

/**
 * A template list entry: document identifiers plus the `_template` metadata
 * fields. Carries no component data.
 */
export interface TemplateSummary extends TemplateMetadata {
  /** Template document ID */
  id: string;
  /** Template name (kebab-case identifier, last segment of the registry path) */
  name: string;
  /** Latest version number */
  version: number;
  /** Last update timestamp */
  updatedAt: string;
}

/**
 * A content type template: the stored Puck-shaped snapshot plus identifier
 * fields. Metadata lives at `root.props._template`, pin state at
 * `root.props._pinMap`.
 */
export interface Template {
  /** Template document ID */
  id: string;
  /** Template name (kebab-case identifier) */
  name: string;
  /** Latest version number */
  version: number;
  /** Last update timestamp */
  updatedAt: string;
  /** Component instances; their props are the defaults for scaffolded pages */
  content: TemplateContentItem[];
  /** Root props carrying template metadata and pin state */
  root: { props: TemplateRootProps };
  /** Puck zones record */
  zones: Record<string, unknown>;
}

/**
 * Parameters for creating a template. Metadata only; the layout is authored
 * on the editor canvas afterwards.
 */
export interface CreateTemplateParams {
  /** Template name (kebab-case identifier) */
  name: string;
  /** Human-readable label */
  label: string;
  /** Optional description */
  description?: string;
  /** Optional default URL pattern */
  defaultUrlPattern?: string;
}

/**
 * Parameters for updating a template's `_template` metadata. Never touches
 * content or pin state.
 */
export interface UpdateTemplateParams {
  /** Updated label */
  label?: string;
  /** Updated description */
  description?: string;
  /** Updated default URL pattern */
  defaultUrlPattern?: string;
  /** Whether to deprecate or reactivate */
  deprecated?: boolean;
}

// =============================================================================
// Migration Types (PROPOSAL-010)
// =============================================================================

export interface MigrationJob {
  id: string;
  siteId: string;
  branchId: string;
  templateId: string;
  fromVersion: number;
  toVersion: number;
  checkpointId: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'completed_with_conflicts' | 'failed';
  totalDocuments: number;
  processedDocuments: number;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  createdAt: string;
  completedAt: string | null;
}

export interface MigrationConflict {
  id: string;
  migrationJobId: string;
  documentId: string;
  branchId: string;
  templateId: string;
  fromVersion: number;
  toVersion: number;
  templateDelta: unknown;
  documentActions: unknown;
  resolution: 'apply' | 'skip' | 'manual' | null;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * Per-document detail in a migration preview, present only when
 * previewMigration is called with detail enabled.
 */
export interface MigrationPreviewDocument {
  documentId: string;
  path: string;
  currentTemplateVersion: number | null;
  hasConflict: boolean;
  proposedSnapshot?: Record<string, unknown>;
  conflictDetails?: {
    templateDelta: unknown[];
    documentActions: unknown[];
  };
}

export interface MigrationPreview {
  templateId: string;
  fromVersion: number;
  toVersion: number;
  templateDelta: unknown[];
  affectedDocuments: number;
  estimatedConflicts: number;
  cleanDocuments: number;
  /** Present only when previewMigration is called with detail enabled. */
  documents?: MigrationPreviewDocument[];
}

export interface TriggerMigrationParams {
  fromVersion: number;
  toVersion: number;
}

// =============================================================================
// Datasource & Query Types
// =============================================================================

/**
 * A datasource defines WHERE data comes from — a reference to a content type
 * template. Auto-generated when a template is created.
 */
export interface Datasource {
  type: string;
  name: string;
  templateName: string;
  templateId: string;
  autoGenerated: boolean;
  version: number;
}

/**
 * Sort field specification for a query.
 */
export interface QuerySortField {
  field: string;
  direction: 'asc' | 'desc';
}

/**
 * A query defines WHAT to retrieve — sort order, pagination defaults.
 * Auto-generated alongside a datasource when a template is created.
 */
export interface Query {
  name: string;
  datasource: string;
  sort: QuerySortField[];
  defaultLimit: number;
  maxLimit: number;
  includeMetadata: boolean;
  includeSnapshot: boolean;
  autoGenerated: boolean;
  version: number;
}

/**
 * A single item in a query result set.
 */
export interface QueryResultItem {
  documentId: string;
  path: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
}

/**
 * Metadata about the applied query parameters in a result set.
 */
export interface QueryResultsMeta {
  name: string;
  datasource: string;
  sortedBy: string;
  appliedLimit: number;
  appliedOffset: number;
}

/**
 * Result of executing a named query.
 */
export interface QueryResults {
  items: QueryResultItem[];
  returnedCount: number;
  query: QueryResultsMeta;
}

/**
 * Optional parameters for fetching query results.
 */
export interface QueryResultsParams {
  limit?: number;
  offset?: number;
  includeMetadata?: boolean;
  includeSnapshot?: boolean;
}
