/**
 * Merge Job Runner — domain models [PCC-3737].
 *
 * The `*Row` interfaces mirror the Postgres tables (migration 059); the plain
 * interfaces are the domain shapes the service, routes, and MCP surface work
 * with; `rowToMergeJob` is the factory between the two. Kept separate from
 * the service so readers of the model never wade through query code.
 */

import type { ConflictResolutionStrategy } from '../types';
import type { DocumentResolution } from './merge-execution-service';

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

/** Statuses that hold the per-MR / per-branch-pair active-job slot. */
export const ACTIVE_MERGE_JOB_STATUSES: readonly MergeJobStatus[] = [
  'queued',
  'planning',
  'running',
  'finalizing',
];

export const TERMINAL_MERGE_JOB_STATUSES: readonly MergeJobStatus[] = [
  'completed',
  'completed_with_errors',
  'blocked_on_conflicts',
  'failed',
  'cancelled',
];

export interface MergeJobRow {
  id: string;
  merge_request_id: string | null;
  site_id: string;
  source_branch_id: string;
  target_branch_id: string;
  status: MergeJobStatus;
  prior_mr_status: string | null;
  resolution_strategy: ConflictResolutionStrategy | null;
  resolutions: DocumentResolution[] | string | null;
  total_documents: number;
  processed_documents: number;
  failed_documents: number;
  noop_documents: number;
  cancel_requested: boolean;
  post_merge_checkpoint_id: string | null;
  publish_checkpoint_id: string | null;
  publish_error: string | null;
  error: string | null;
  triggered_by_id: string;
  triggered_by_type: 'user' | 'agent';
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface MergeJob {
  id: string;
  mergeRequestId: string | null;
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
  status: MergeJobStatus;
  priorMrStatus: string | null;
  resolutionStrategy: ConflictResolutionStrategy | null;
  resolutions: DocumentResolution[] | null;
  totalDocuments: number;
  processedDocuments: number;
  failedDocuments: number;
  noopDocuments: number;
  cancelRequested: boolean;
  postMergeCheckpointId: string | null;
  publishCheckpointId: string | null;
  publishError: string | null;
  error: string | null;
  triggeredById: string;
  triggeredByType: 'user' | 'agent';
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface MergeJobDocumentRow {
  job_id: string;
  document_id: string;
  document_path: string;
  kind: 'copy' | 'conflict';
  resolution_strategy: ConflictResolutionStrategy | null;
  conflict_type: string | null;
  source_version_id: string | null;
  target_version_id: string | null;
  status: 'pending' | 'done' | 'skipped_noop' | 'failed';
  result_version_id: string | null;
  error: string | null;
  attempts: number;
}

/** The API/MCP-facing status projection, including per-document failures. */
export interface MergeJobProjection extends MergeJob {
  failedDocumentDetails: { documentId: string; path: string; error: string | null }[];
}

export function rowToMergeJob(row: MergeJobRow): MergeJob {
  let resolutions: DocumentResolution[] | null = null;
  if (row.resolutions !== null) {
    resolutions =
      typeof row.resolutions === 'string'
        ? (JSON.parse(row.resolutions) as DocumentResolution[])
        : row.resolutions;
  }
  return {
    id: row.id,
    mergeRequestId: row.merge_request_id,
    siteId: row.site_id,
    sourceBranchId: row.source_branch_id,
    targetBranchId: row.target_branch_id,
    status: row.status,
    priorMrStatus: row.prior_mr_status,
    resolutionStrategy: row.resolution_strategy,
    resolutions,
    totalDocuments: row.total_documents,
    processedDocuments: row.processed_documents,
    failedDocuments: row.failed_documents,
    noopDocuments: row.noop_documents,
    cancelRequested: row.cancel_requested,
    postMergeCheckpointId: row.post_merge_checkpoint_id,
    publishCheckpointId: row.publish_checkpoint_id,
    publishError: row.publish_error,
    error: row.error,
    triggeredById: row.triggered_by_id,
    triggeredByType: row.triggered_by_type,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export interface CreateMergeJobParams {
  /** Caller-generated so it can double as the Workflow instance id. */
  jobId: string;
  mergeRequestId?: string;
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
  /** MR status to restore on failure/cancel ('approved' | 'conflicted'). */
  priorMrStatus?: string;
  resolutionStrategy?: ConflictResolutionStrategy;
  resolutions?: DocumentResolution[];
  triggeredById: string;
  triggeredByType: 'user' | 'agent';
}

export type PlanOutcome =
  | { outcome: 'planned'; totalDocuments: number; copyCount: number; conflictCount: number }
  | { outcome: 'blocked_on_conflicts'; conflictCount: number }
  | { outcome: 'superseded' };

/** Per-chunk apply outcome; avgMsPerDoc drives the workflow's pacing. */
export interface ApplyChunkResult {
  done: number;
  failed: number;
  noop: number;
  remaining: number;
  avgMsPerDoc: number;
  cancelled: boolean;
}

export interface FinalizeCheckpointResult {
  checkpointId: string | null;
  finalized: boolean;
  mergedCount: number;
}

export interface FinalizePublishResult {
  publishCheckpointId: string | null;
  publishedDocumentIds: string[];
  publishError: string | null;
  targetIsMain: boolean;
}
