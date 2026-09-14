/**
 * Merge Job Runner — domain models [PCC-3737].
 *
 * The `*Row` interfaces mirror the Postgres tables (migration 059); the plain
 * interfaces are the domain shapes the service, routes, and MCP surface work
 * with; `rowToMergeJob` is the factory between the two. Kept separate from
 * the service so readers of the model never wade through query code.
 */

import type { InferSelectModel } from 'drizzle-orm';
import type { mergeJobDocuments, mergeJobs } from '../db/schema';
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

/** Raw select shape from app.merge_jobs (all columns). */
export type MergeJobRow = InferSelectModel<typeof mergeJobs>;

/** Raw select shape from app.merge_job_documents (all columns). */
export type MergeJobDocumentRow = InferSelectModel<typeof mergeJobDocuments>;

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
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** The API/MCP-facing status projection, including per-document failures. */
export interface MergeJobProjection extends MergeJob {
  failedDocumentDetails: { documentId: string; path: string; error: string | null }[];
}

/**
 * The row's field names already match the domain shape (both are camelCase),
 * so the only real work is narrowing the columns the schema can't type as a
 * union, and typing the jsonb resolutions column — Drizzle deserializes it
 * for us, unlike the driver's raw string form the legacy `query()` returned.
 */
export function rowToMergeJob(row: MergeJobRow): MergeJob {
  return {
    ...row,
    status: row.status as MergeJobStatus,
    resolutionStrategy: row.resolutionStrategy as ConflictResolutionStrategy | null,
    resolutions: row.resolutions as DocumentResolution[] | null,
    triggeredByType: row.triggeredByType as 'user' | 'agent',
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
