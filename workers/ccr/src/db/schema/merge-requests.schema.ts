import { text, timestamp, index, foreignKey, uuid, jsonb, boolean } from 'drizzle-orm/pg-core';
import { app } from './app.schema';
import { branches } from './branches.schema';
import { checkpoints } from './checkpoints.schema';
import { sites } from './sites.schema';

export const mergeRequests = app.table('merge_requests', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  siteId: uuid('site_id').notNull(),
  sourceBranchId: uuid('source_branch_id').notNull(),
  targetBranchId: uuid('target_branch_id').notNull(),
  baseCheckpointId: uuid('base_checkpoint_id'),
  title: text().notNull(),
  description: text(),
  status: text().default('open').notNull(),
  hasConflicts: boolean('has_conflicts').default(false),
  conflictDetails: jsonb('conflict_details'),
  createdById: uuid('created_by_id').notNull(),
  createdByType: text('created_by_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  mergedAt: timestamp('merged_at', { withTimezone: true, mode: 'date' }),
  mergedById: uuid('merged_by_id'),
  mergedByType: text('merged_by_type'),
  closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
  closedById: uuid('closed_by_id'),
  closedByType: text('closed_by_type'),
}, (table) => [
  index('idx_merge_requests_site').using('btree', table.siteId.asc().nullsLast()),
  index('idx_merge_requests_source').using('btree', table.sourceBranchId.asc().nullsLast()),
  index('idx_merge_requests_status').using('btree', table.siteId.asc().nullsLast(), table.status.asc().nullsLast()),
  index('idx_merge_requests_target').using('btree', table.targetBranchId.asc().nullsLast()),
  foreignKey({
    columns: [table.siteId],
    foreignColumns: [sites.id],
    name: 'merge_requests_site_id_fkey',
  }),
  foreignKey({
    columns: [table.sourceBranchId],
    foreignColumns: [branches.id],
    name: 'merge_requests_source_branch_id_fkey',
  }),
  foreignKey({
    columns: [table.targetBranchId],
    foreignColumns: [branches.id],
    name: 'merge_requests_target_branch_id_fkey',
  }),
  foreignKey({
    columns: [table.baseCheckpointId],
    foreignColumns: [checkpoints.id],
    name: 'merge_requests_base_checkpoint_id_fkey',
  }),
]);
