import { timestamp, index, foreignKey, uuid } from 'drizzle-orm/pg-core';
import { app } from './app.sql';
import { sites } from './sites.sql';

export const siteStructures = app.table('site_structures', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  siteId: uuid('site_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
}, (table) => [
  index('idx_site_structures_site').using('btree', table.siteId.asc().nullsLast()),
  foreignKey({
    columns: [table.siteId],
    foreignColumns: [sites.id],
    name: 'site_structures_site_id_fkey',
  }),
]);
