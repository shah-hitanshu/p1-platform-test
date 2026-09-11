import { text, timestamp, index, foreignKey, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.sql';
import { sites } from './sites.sql';

export const documents = app.table('documents', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  siteId: uuid('site_id').notNull(),
  path: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  locale: text(),
}, (table) => [
  uniqueIndex('documents_site_id_path_active_key').using('btree', table.siteId.asc().nullsLast(), table.path.asc().nullsLast()).where(sql`(archived_at IS NULL)`),
  index('idx_documents_archived').using('btree', table.archivedAt.asc().nullsLast()).where(sql`(archived_at IS NOT NULL)`),
  index('idx_documents_site').using('btree', table.siteId.asc().nullsLast()),
  foreignKey({
    columns: [table.siteId],
    foreignColumns: [sites.id],
    name: 'documents_site_id_fkey',
  }),
]);
