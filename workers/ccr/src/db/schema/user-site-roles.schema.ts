import { text, timestamp, index, foreignKey, unique, uuid } from 'drizzle-orm/pg-core';
import { app } from './app.schema';
import { sites } from './sites.schema';

export const userSiteRoles = app.table('user_site_roles', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  // TODO(PCC-3903): user_id and created_by_id are text while app.users.id is
  // uuid, so every join to users casts `users.id::text` and cannot use the
  // users primary key index. Not a straight type change — the column also
  // holds raw OAuth subjects, which no uuid cast accepts.
  userId: text('user_id').notNull(),
  siteId: uuid('site_id').notNull(),
  role: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  createdById: text('created_by_id'),
  source: text().default('local').notNull(),
}, (table) => [
  index('idx_user_site_roles_site').using('btree', table.siteId.asc().nullsLast()),
  index('idx_user_site_roles_source').using('btree', table.source.asc().nullsLast()),
  index('idx_user_site_roles_updated').using('btree', table.updatedAt.asc().nullsLast()),
  index('idx_user_site_roles_user').using('btree', table.userId.asc().nullsLast()),
  foreignKey({
    columns: [table.siteId],
    foreignColumns: [sites.id],
    name: 'user_site_roles_site_id_fkey',
  }).onDelete('cascade'),
  unique('user_site_roles_user_site_source_key').on(table.userId, table.siteId, table.source),
]);
