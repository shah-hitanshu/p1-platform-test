import { text, timestamp, index, foreignKey, unique, uuid, uniqueIndex, boolean, type PgTableExtraConfigValue } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.schema';
import { checkpoints } from './checkpoints.schema';
import { sites } from './sites.schema';

export const branches = app.table('branches', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  siteId: uuid('site_id').notNull(),
  name: text().notNull(),
  description: text(),
  status: text().default('active').notNull(),
  isMain: boolean('is_main').default(false).notNull(),
  sourceBranchId: uuid('source_branch_id'),
  sourceCheckpointId: uuid('source_checkpoint_id'),
  createdById: uuid('created_by_id').notNull(),
  createdByType: text('created_by_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
}, (table): PgTableExtraConfigValue[] => [
  index('idx_branches_archived').using('btree', table.archivedAt.asc().nullsLast()).where(sql`(archived_at IS NOT NULL)`),
  uniqueIndex('idx_branches_main').using('btree', table.siteId.asc().nullsLast()).where(sql`(is_main = true)`),
  index('idx_branches_site').using('btree', table.siteId.asc().nullsLast()),
  index('idx_branches_status').using('btree', table.siteId.asc().nullsLast(), table.status.asc().nullsLast()),
  foreignKey({
    columns: [table.siteId],
    foreignColumns: [sites.id],
    name: 'branches_site_id_fkey',
  }),
  foreignKey({
    columns: [table.sourceBranchId],
    foreignColumns: [table.id],
    name: 'branches_source_branch_id_fkey',
  }),
  foreignKey({
    columns: [table.sourceCheckpointId],
    foreignColumns: [checkpoints.id],
    name: 'fk_branches_source_checkpoint',
  }),
  unique('branches_site_id_name_key').on(table.siteId, table.name),
]);
