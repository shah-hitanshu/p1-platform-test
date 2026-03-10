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
 * Union of all server-to-client WebSocket messages.
 */
export type WsServerMessage =
  | WsPresenceUpdateMessage
  | WsFocusRegionBroadcastMessage
  | WsFocusRegionAckMessage
  | WsPresenceErrorMessage;
