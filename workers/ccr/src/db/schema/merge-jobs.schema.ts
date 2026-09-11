import { integer, text, timestamp, index, foreignKey, uuid, jsonb, uniqueIndex, boolean, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.schema';
import { branches } from './branches.schema';
import { mergeRequests } from './merge-requests.schema';
import { sites } from './sites.schema';

export const mergeJobs = app.table('merge_jobs', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  mergeRequestId: uuid('merge_request_id'),
  siteId: uuid('site_id').notNull(),
  sourceBranchId: uuid('source_branch_id').notNull(),
  targetBranchId: uuid('target_branch_id').notNull(),
  status: text().default('queued').notNull(),
  priorMrStatus: text('prior_mr_status'),
  resolutionStrategy: text('resolution_strategy'),
  resolutions: jsonb(),
  totalDocuments: integer('total_documents').default(0).notNull(),
  processedDocuments: integer('processed_documents').default(0).notNull(),
  failedDocuments: integer('failed_documents').default(0).notNull(),
  noopDocuments: integer('noop_documents').default(0).notNull(),
  cancelRequested: boolean('cancel_requested').default(false).notNull(),
  postMergeCheckpointId: uuid('post_merge_checkpoint_id'),
  publishCheckpointId: uuid('publish_checkpoint_id'),
  publishError: text('publish_error'),
  error: text(),
  triggeredById: uuid('triggered_by_id').notNull(),
  triggeredByType: text('triggered_by_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  uniqueIndex('merge_jobs_active_per_mr').using('btree', table.mergeRequestId.asc().nullsLast()).where(sql`((merge_request_id IS NOT NULL) AND (status = ANY (ARRAY['queued'::text, 'planning'::text, 'running'::text, 'finalizing'::text])))`),
  uniqueIndex('merge_jobs_active_per_branch_pair').using('btree', table.siteId.asc().nullsLast(), table.sourceBranchId.asc().nullsLast(), table.targetBranchId.asc().nullsLast()).where(sql`((merge_request_id IS NULL) AND (status = ANY (ARRAY['queued'::text, 'planning'::text, 'running'::text, 'finalizing'::text])))`),
  index('merge_jobs_merge_request_id_idx').using('btree', table.mergeRequestId.asc().nullsLast()).where(sql`(merge_request_id IS NOT NULL)`),
  foreignKey({
    columns: [table.mergeRequestId],
    foreignColumns: [mergeRequests.id],
    name: 'merge_jobs_merge_request_id_fkey',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.siteId],
    foreignColumns: [sites.id],
    name: 'merge_jobs_site_id_fkey',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.sourceBranchId],
    foreignColumns: [branches.id],
    name: 'merge_jobs_source_branch_id_fkey',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.targetBranchId],
    foreignColumns: [branches.id],
    name: 'merge_jobs_target_branch_id_fkey',
  }).onDelete('cascade'),
  check('merge_jobs_status_check', sql`status = ANY (ARRAY['queued'::text, 'planning'::text, 'running'::text, 'finalizing'::text, 'completed'::text, 'completed_with_errors'::text, 'blocked_on_conflicts'::text, 'failed'::text, 'cancelled'::text])`),
  check('merge_jobs_triggered_by_type_check', sql`triggered_by_type = ANY (ARRAY['user'::text, 'agent'::text])`),
]);
