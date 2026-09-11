import { text, timestamp, index, uuid, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.schema';

export const organizations = app.table('organizations', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  name: text().notNull(),
  settings: jsonb().default({'agentIdleTimeoutMs':5000}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  externalSpaceId: text('external_space_id'),
}, (table) => [
  index('idx_organizations_archived').using('btree', table.archivedAt.asc().nullsLast()).where(sql`(archived_at IS NOT NULL)`),
  uniqueIndex('idx_organizations_external_space').using('btree', table.externalSpaceId.asc().nullsLast()).where(sql`(external_space_id IS NOT NULL)`),
]);
