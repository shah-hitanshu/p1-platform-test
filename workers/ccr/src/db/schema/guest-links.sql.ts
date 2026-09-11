import { integer, text, timestamp, index, foreignKey, unique, uuid } from 'drizzle-orm/pg-core';
import { app } from './app.sql';
import { branches } from './branches.sql';

export const guestLinks = app.table('guest_links', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  branchId: uuid('branch_id').notNull(),
  email: text().notNull(),
  name: text(),
  tokenHash: text('token_hash').notNull(),
  status: text().default('active').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdById: uuid('created_by_id').notNull(),
  createdByType: text('created_by_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  message: text(),
  accessCount: integer('access_count').default(0),
  lastAccessAt: timestamp('last_access_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  index('idx_guest_links_branch').using('btree', table.branchId.asc().nullsLast()),
  index('idx_guest_links_status').using('btree', table.status.asc().nullsLast(), table.expiresAt.asc().nullsLast()),
  index('idx_guest_links_token').using('btree', table.tokenHash.asc().nullsLast()),
  foreignKey({
    columns: [table.branchId],
    foreignColumns: [branches.id],
    name: 'guest_links_branch_id_fkey',
  }).onDelete('cascade'),
  unique('guest_links_token_hash_key').on(table.tokenHash),
]);
