/**
 * Checkpoint Service - Types, Interfaces, and Error Classes
 *
 * Parameter interfaces, result types, database row mappings,
 * error classes, and validation constants.
 */

import type {
  Checkpoint,
  CheckpointType,
  CheckpointStatus,
  CheckpointTrigger,
  DocumentVersion,
} from '../types';

// =============================================================================
// Parameter & Result Types
// =============================================================================

/**
 * Parameters for creating a new checkpoint.
 */
export interface CreateCheckpointParams {
  branchId: string;
  name?: string;
  message?: string;
  checkpointType: CheckpointType;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  /** Detailed description of what the checkpoint contains */
  description?: string;
  /** How this checkpoint was triggered */
  trigger?: CheckpointTrigger;
  /** User ID who requested the agent action (if trigger = human_requested) */
  requestedById?: string;
  /** Category of operation that created this checkpoint */
  operationType?: string;
  /** JSON paths of regions affected by this checkpoint */
  affectedRegions?: string[];
  /** Force a full snapshot of all branch documents, ignoring incremental logic.
   *  Required for agent_pre_edit checkpoints so rollback can restore all
   *  documents the agent might edit, not just those changed since the parent. */
  forceFullSnapshot?: boolean;
  /** Explicit document versions to capture. When provided, skips the
   *  automatic document_versions query and uses only these entries.
   *  Used by merge to ensure only merge-touched documents are checkpointed. */
  documentVersionIds?: { documentId: string; documentVersionId: string }[];
}

/**
 * Result of creating a checkpoint.
 */
export interface CreateCheckpointResult {
  checkpoint: Checkpoint;
  documentCount: number;
}

/**
 * Options for listing checkpoints.
 */
export interface ListCheckpointsOptions {
  checkpointType?: CheckpointType;
  limit?: number;
  offset?: number;
}

/**
 * Parameters for reverting to a checkpoint.
 */
export interface RevertToCheckpointParams {
  checkpointId: string;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  message?: string;
}

/**
 * Result of reverting to a checkpoint.
 */
export interface RevertToCheckpointResult {
  checkpoint: Checkpoint;
  documentsReverted: number;
  /**
   * _registry/* rows (except _registry/templates/*) found in the checkpoint
   * and excluded from the revert. Non-zero only for checkpoints captured
   * before registry documents were filtered out of capture.
   */
  documentsSkipped: number;
}

/**
 * Options for listing checkpoints by agent.
 */
export interface ListCheckpointsByAgentOptions {
  limit?: number;
  offset?: number;
  branchId?: string;
  operationType?: string;
  trigger?: CheckpointTrigger;
  status?: CheckpointStatus;
}

/**
 * Document version with path information for checkpoint queries.
 */
export interface CheckpointDocumentVersion extends DocumentVersion {
  documentPath: string;
  versionId: string;
}

/**
 * Structure state captured in a checkpoint.
 */
export interface CheckpointStructure {
  checkpointId: string;
  structureId: string;
  name: string;
  slug: string;
  description?: string;
  structureType: string;
  structureTree: Record<string, unknown>[];
  metadataSchema: Record<string, unknown>;
  schemaEnforcement: string;
}

/**
 * Parameters for publishing a document.
 */
export interface PublishDocumentParams {
  siteId: string;
  branchId: string;
  documentId: string;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
}

/**
 * Result of publishing a document.
 */
export interface PublishDocumentResult {
  checkpoint: Checkpoint;
  publishedVersionId: string;
  sourceBranchName?: string;
}

// =============================================================================
// Database Row Types
// =============================================================================

/**
 * Database row format for checkpoints.
 */
export interface CheckpointRow {
  id: string;
  branch_id: string;
  name: string | null;
  message: string | null;
  checkpoint_type: CheckpointType;
  created_by_id: string;
  created_by_type: 'user' | 'agent' | 'system';
  created_at: string;
  // Enhanced checkpoint fields (Agent Politeness)
  description: string | null;
  trigger: CheckpointTrigger | null;
  requested_by_id: string | null;
  operation_type: string | null;
  affected_regions: string[] | null;
  status: CheckpointStatus | null;
  rolled_back_by_id: string | null;
  rolled_back_at: string | null;
  // Incremental checkpoint support (Phase 6.1)
  parent_checkpoint_id: string | null;
}

/**
 * Extended row returned by CTE-based INSERT in createCheckpoint.
 * The CTE embeds parent checkpoint lookup, so RETURNING includes
 * parent_created_at alongside standard checkpoint fields.
 */
export interface CheckpointInsertRow extends CheckpointRow {
  parent_created_at: string | null;
}

/**
 * Database row for document versions with document path (joined).
 */
export interface VersionWithDocumentRow {
  id: string;
  document_id: string;
  branch_id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  source: string;
  created_by_id: string;
  created_by_type: 'user' | 'agent' | 'system';
  created_at: string;
  document_path: string;
}

/**
 * Database row for checkpoint structures.
 */
export interface CheckpointStructureRow {
  checkpoint_id: string;
  structure_id: string;
  name: string;
  slug: string;
  description: string | null;
  structure_type: string;
  structure_tree: Record<string, unknown>[];
  metadata_schema: Record<string, unknown>;
  schema_enforcement: string;
}

// =============================================================================
// Validation Constants
// =============================================================================

/** Maximum length for checkpoint name */
export const MAX_NAME_LENGTH = 255;

/** Maximum length for checkpoint message */
export const MAX_MESSAGE_LENGTH = 1000;

/** Maximum length for checkpoint description */
export const MAX_DESCRIPTION_LENGTH = 5000;

/** Maximum length for operation type */
export const MAX_OPERATION_TYPE_LENGTH = 100;

/** Maximum number of affected regions per checkpoint */
export const MAX_AFFECTED_REGIONS = 100;

/** Maximum length for a single affected region path */
export const MAX_REGION_PATH_LENGTH = 500;
