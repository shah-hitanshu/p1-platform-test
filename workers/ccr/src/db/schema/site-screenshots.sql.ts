import { text, timestamp, index, foreignKey, uuid, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.sql';
import { sites } from './sites.sql';

export const siteScreenshots = app.table('site_screenshots', {
  siteId: uuid('site_id').primaryKey().notNull(),
  r2Key: text('r2_key').notNull(),
  status: text().notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }).notNull(),
  error: text(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('idx_site_screenshots_captured_at').using('btree', table.capturedAt.asc().nullsLast()),
  foreignKey({
    columns: [table.siteId],
    foreignColumns: [sites.id],
    name: 'site_screenshots_site_id_fkey',
  }).onDelete('cascade'),
  check('site_screenshots_status_check', sql`status = ANY (ARRAY['ok'::text, 'failed'::text])`),
]);
