import { integer, text, timestamp, index, foreignKey, uuid, check, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.schema';
import { documents } from './documents.schema';
import { mergeJobs } from './merge-jobs.schema';

export const mergeJobDocuments = app.table('merge_job_documents', {
  jobId: uuid('job_id').notNull(),
  documentId: uuid('document_id').notNull(),
  documentPath: text('document_path').notNull(),
  kind: text().notNull(),
  resolutionStrategy: text('resolution_strategy'),
  conflictType: text('conflict_type'),
  sourceVersionId: uuid('source_version_id'),
  targetVersionId: uuid('target_version_id'),
  status: text().default('pending').notNull(),
  resultVersionId: uuid('result_version_id'),
  error: text(),
  attempts: integer().default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('merge_job_documents_pending_idx').using('btree', table.jobId.asc().nullsLast()).where(sql`(status = 'pending'::text)`),
  index('merge_job_documents_document_id_idx').using('btree', table.documentId.asc().nullsLast()),
  foreignKey({
    columns: [table.jobId],
    foreignColumns: [mergeJobs.id],
    name: 'merge_job_documents_job_id_fkey',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.documentId],
    foreignColumns: [documents.id],
    name: 'merge_job_documents_document_id_fkey',
  }).onDelete('cascade'),
  primaryKey({ columns: [table.jobId, table.documentId], name: 'merge_job_documents_pkey' }),
  check('merge_job_documents_kind_check', sql`kind = ANY (ARRAY['copy'::text, 'conflict'::text])`),
  check('merge_job_documents_status_check', sql`status = ANY (ARRAY['pending'::text, 'done'::text, 'skipped_noop'::text, 'failed'::text])`),
]);
