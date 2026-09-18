import { text, timestamp, index, foreignKey, uuid, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.schema';
import { branches } from './branches.schema';
import { documents } from './documents.schema';
import { sites } from './sites.schema';

export const commentThreads = app.table('comment_threads', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  siteId: uuid('site_id').notNull(),
  contextType: text('context_type').notNull(),
  contextId: text('context_id').notNull(),
  documentId: uuid('document_id'),
  branchId: uuid('branch_id'),
  status: text().default('open').notNull(),
  createdByType: text('created_by_type').notNull(),
  createdById: uuid('created_by_id').notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
  resolvedByType: text('resolved_by_type'),
  resolvedById: uuid('resolved_by_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  // One open thread per object; resolved ones may accumulate beneath it.
  uniqueIndex('comment_threads_open_context_key')
    .using('btree', table.siteId.asc().nullsLast(), table.contextType.asc().nullsLast(), table.contextId.asc().nullsLast())
    .where(sql`(status = 'open')`),
  index('idx_comment_threads_context')
    .using('btree', table.siteId.asc().nullsLast(), table.contextType.asc().nullsLast(), table.contextId.asc().nullsLast(), table.updatedAt.desc().nullsFirst()),
  index('idx_comment_threads_document').using('btree', table.siteId.asc().nullsLast(), table.documentId.asc().nullsLast()),
  index('idx_comment_threads_site_updated').using('btree', table.siteId.asc().nullsLast(), table.updatedAt.desc().nullsFirst()),
  foreignKey({
    columns: [table.siteId],
    foreignColumns: [sites.id],
    name: 'comment_threads_site_id_fkey',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.documentId],
    foreignColumns: [documents.id],
    name: 'comment_threads_document_id_fkey',
  }),
  foreignKey({
    columns: [table.branchId],
    foreignColumns: [branches.id],
    name: 'comment_threads_branch_id_fkey',
  }).onDelete('set null'),
  check('comment_threads_context_type_check', sql`context_type = ANY (ARRAY['block'::text, 'page'::text, 'site'::text, 'workstream'::text])`),
  check('comment_threads_status_check', sql`status = ANY (ARRAY['open'::text, 'resolved'::text])`),
  check('comment_threads_created_by_type_check', sql`created_by_type = ANY (ARRAY['user'::text, 'agent'::text])`),
]);
