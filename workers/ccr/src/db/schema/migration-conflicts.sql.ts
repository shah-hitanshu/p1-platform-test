import { integer, text, timestamp, index, foreignKey, uuid, jsonb, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.sql';
import { branches } from './branches.sql';
import { documents } from './documents.sql';
import { migrationJobs } from './migration-jobs.sql';

export const migrationConflicts = app.table('migration_conflicts', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  migrationJobId: uuid('migration_job_id').notNull(),
  documentId: uuid('document_id').notNull(),
  branchId: uuid('branch_id').notNull(),
  templateId: uuid('template_id').notNull(),
  fromVersion: integer('from_version').notNull(),
  toVersion: integer('to_version').notNull(),
  templateDelta: jsonb('template_delta').notNull(),
  documentActions: jsonb('document_actions').notNull(),
  resolution: text(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
  propConflicts: jsonb('prop_conflicts').default([]).notNull(),
  conflictType: text('conflict_type').default('structural').notNull(),
}, (table) => [
  index('idx_migration_conflicts_job').using('btree', table.migrationJobId.asc().nullsLast()),
  index('idx_migration_conflicts_unresolved').using('btree', table.branchId.asc().nullsLast(), table.documentId.asc().nullsLast()).where(sql`(resolution IS NULL)`),
  foreignKey({
    columns: [table.migrationJobId],
    foreignColumns: [migrationJobs.id],
    name: 'migration_conflicts_migration_job_id_fkey',
  }),
  foreignKey({
    columns: [table.documentId],
    foreignColumns: [documents.id],
    name: 'migration_conflicts_document_id_fkey',
  }),
  foreignKey({
    columns: [table.branchId],
    foreignColumns: [branches.id],
    name: 'migration_conflicts_branch_id_fkey',
  }),
  foreignKey({
    columns: [table.templateId],
    foreignColumns: [documents.id],
    name: 'migration_conflicts_template_id_fkey',
  }),
  check('migration_conflicts_resolution_check', sql`(resolution IS NULL) OR (resolution = ANY (ARRAY['apply'::text, 'skip'::text, 'manual'::text]))`),
  check('migration_conflicts_conflict_type_check', sql`conflict_type = ANY (ARRAY['structural'::text, 'prop'::text])`),
]);
