import { text, timestamp, index, foreignKey, unique, uuid } from 'drizzle-orm/pg-core';
import { app } from './app.sql';
import { branches } from './branches.sql';

export const branchGrants = app.table('branch_grants', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  branchId: uuid('branch_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  actorType: text('actor_type').notNull(),
  role: text().notNull(),
  grantedById: uuid('granted_by_id').notNull(),
  grantedByType: text('granted_by_type').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  reason: text(),
}, (table) => [
  index('idx_branch_grants_actor').using('btree', table.actorId.asc().nullsLast()),
  index('idx_branch_grants_branch').using('btree', table.branchId.asc().nullsLast()),
  foreignKey({
    columns: [table.branchId],
    foreignColumns: [branches.id],
    name: 'branch_grants_branch_id_fkey',
  }).onDelete('cascade'),
  unique('branch_grants_branch_id_actor_id_key').on(table.branchId, table.actorId),
]);
