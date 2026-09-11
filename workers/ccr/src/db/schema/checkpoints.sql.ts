import { text, timestamp, index, foreignKey, uuid, jsonb, boolean, check, type PgTableExtraConfigValue } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.sql';
import { branches } from './branches.sql';

export const checkpoints = app.table('checkpoints', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  branchId: uuid('branch_id').notNull(),
  name: text(),
  message: text(),
  checkpointType: text('checkpoint_type').default('manual').notNull(),
  createdById: uuid('created_by_id').notNull(),
  createdByType: text('created_by_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  description: text(),
  trigger: text().default('manual'),
  requestedById: uuid('requested_by_id'),
  operationType: text('operation_type'),
  affectedRegions: jsonb('affected_regions').default([]),
  status: text().default('completed'),
  rolledBackById: uuid('rolled_back_by_id'),
  rolledBackAt: timestamp('rolled_back_at', { withTimezone: true, mode: 'date' }),
  parentCheckpointId: uuid('parent_checkpoint_id'),
  isFullSnapshot: boolean('is_full_snapshot').default(false).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  index('idx_checkpoints_branch').using('btree', table.branchId.asc().nullsLast(), table.createdAt.desc().nullsFirst()),
  index('idx_checkpoints_branch_type_created').using('btree', table.branchId.asc().nullsLast(), table.checkpointType.asc().nullsLast(), table.createdAt.desc().nullsFirst()),
  index('idx_checkpoints_parent').using('btree', table.parentCheckpointId.asc().nullsLast()).where(sql`(parent_checkpoint_id IS NOT NULL)`),
  foreignKey({
    columns: [table.branchId],
    foreignColumns: [branches.id],
    name: 'checkpoints_branch_id_fkey',
  }),
  foreignKey({
    columns: [table.parentCheckpointId],
    foreignColumns: [table.id],
    name: 'checkpoints_parent_checkpoint_id_fkey',
  }),
  check('checkpoints_trigger_check', sql`trigger = ANY (ARRAY['manual'::text, 'human_requested'::text, 'autonomous'::text])`),
  check('checkpoints_status_check', sql`status = ANY (ARRAY['completed'::text, 'rolled_back'::text, 'partial'::text])`),
]);
