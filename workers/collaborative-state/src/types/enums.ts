/**
 * Collaborative State System - Enum and Union Type Definitions
 *
 * All union types used across the system for type-safe discrimination.
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
 * 'author' and 'editor' are grantable via the collaborators API and are
 * permission-identical to the EDITOR tier.
 */
export type PantheonRole = 'owner' | 'admin' | 'developer' | 'team_member' | 'author' | 'editor';

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
 * - publish: Created when content is published to main (drives branch inheritance)
 * - session_pre_edit: Created before an edit session starts (for rollback)
 * - session_post_edit: Created after an edit session completes (for audit)
 * - agent_pre_edit: A session_pre_edit written before sessions could be owned by a person
 * - agent_post_edit: A session_post_edit written before sessions could be owned by a person
 * - pre_migration: Created before a template migration operation (for rollback)
 *
 * Whether a session checkpoint belongs to a person or an agent is recorded in
 * created_by_type, not in the type.
 */
export type CheckpointType = 'manual' | 'auto' | 'pre_merge' | 'post_merge' | 'publish' | 'session_pre_edit' | 'session_post_edit' | 'agent_pre_edit' | 'agent_post_edit' | 'pre_migration';

/**
 * Source of a document version creation.
 *
 * `recreate` marks version 1 of a document rebuilt at a path whose previous
 * incarnation was tombstoned. createDocumentOnBranch has always written it —
 * the column is plain TEXT with no CHECK, so nothing caught its absence here.
 */
export type DocumentVersionSource =
  | 'edit'
  | 'merge'
  | 'revert'
  | 'checkpoint'
  | 'realtime'
  | 'publish'
  | 'migration'
  | 'recreate';

/**
 * Merge request workflow states.
 */
export type MergeRequestStatus = 'open' | 'approved' | 'merging' | 'merged' | 'closed' | 'conflicted';

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
export type ConflictResolutionStrategy = 'take-source' | 'take-target' | 'manual';

/**
 * Types of site structures.
 */
export type StructureType = 'collection' | 'hierarchy';

/**
 * Types of nodes within a site structure.
 */
export type NodeType = 'section' | 'document' | 'external';

/**
 * Types of page redirects.
 */
export type RedirectType = 'permanent' | 'temporary';

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

/** Authentication provider that validated the token */
export type AuthProvider = 'auth0' | 'broker' | 'google' | 'mock' | 'site_token' | 'agent_key' | 'unknown';

/**
 * Types of document-level conflicts during merge.
 */
export type DocumentConflictType = 'both-modified' | 'deleted-in-source' | 'deleted-in-target';

/**
 * Types of structure-level conflicts during merge.
 */
export type StructureConflictType = 'node-move' | 'node-delete' | 'schema-change' | 'metadata-change';

// =============================================================================
// Template Migration System - Union Types
// =============================================================================

/**
 * Migration job status.
 * - pending: Job created, not yet started
 * - in_progress: Currently processing documents
 * - completed: All documents processed successfully
 * - failed: Job failed with error
 */
export type MigrationJobStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Migration conflict resolution strategy.
 * - apply: Apply template changes (overwrite document)
 * - skip: Keep document as-is (ignore template changes)
 * - manual: Manually resolved by user
 */
export type MigrationResolution = 'apply' | 'skip' | 'manual';
