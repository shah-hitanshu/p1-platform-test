import { integer, text, timestamp, index, foreignKey, uuid, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.sql';
import { branches } from './branches.sql';
import { checkpoints } from './checkpoints.sql';
import { documents } from './documents.sql';
import { sites } from './sites.sql';

export const migrationJobs = app.table('migration_jobs', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  siteId: uuid('site_id').notNull(),
  branchId: uuid('branch_id').notNull(),
  templateId: uuid('template_id').notNull(),
  fromVersion: integer('from_version').notNull(),
  toVersion: integer('to_version').notNull(),
  checkpointId: uuid('checkpoint_id'),
  status: text().default('pending').notNull(),
  totalDocuments: integer('total_documents').default(0).notNull(),
  processedDocuments: integer('processed_documents').default(0).notNull(),
  createdById: uuid('created_by_id').notNull(),
  createdByType: text('created_by_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  index('idx_migration_jobs_branch').using('btree', table.branchId.asc().nullsLast(), table.status.asc().nullsLast()),
  foreignKey({
    columns: [table.siteId],
    foreignColumns: [sites.id],
    name: 'migration_jobs_site_id_fkey',
  }),
  foreignKey({
    columns: [table.branchId],
    foreignColumns: [branches.id],
    name: 'migration_jobs_branch_id_fkey',
  }),
  foreignKey({
    columns: [table.templateId],
    foreignColumns: [documents.id],
    name: 'migration_jobs_template_id_fkey',
  }),
  foreignKey({
    columns: [table.checkpointId],
    foreignColumns: [checkpoints.id],
    name: 'migration_jobs_checkpoint_id_fkey',
  }),
  check('migration_jobs_created_by_type_check', sql`created_by_type = ANY (ARRAY['user'::text, 'agent'::text, 'system'::text])`),
  check('migration_jobs_status_check', sql`status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'completed_with_conflicts'::text, 'failed'::text])`),
]);
