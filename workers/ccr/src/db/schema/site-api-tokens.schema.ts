import { text, timestamp, index, foreignKey, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.schema';
import { sites } from './sites.schema';

export const siteApiTokens = app.table('site_api_tokens', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  siteId: uuid('site_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  prefix: varchar({ length: 12 }).notNull(),
  name: text().notNull(),
  scopes: text().array().default(sql`ARRAY['read:published']`).notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  index('idx_site_api_tokens_hash').using('btree', table.tokenHash.asc().nullsLast()).where(sql`(revoked_at IS NULL)`),
  index('idx_site_api_tokens_site_id').using('btree', table.siteId.asc().nullsLast()),
  foreignKey({
    columns: [table.siteId],
    foreignColumns: [sites.id],
    name: 'site_api_tokens_site_id_fkey',
  }).onDelete('cascade'),
  unique('site_api_tokens_token_hash_key').on(table.tokenHash),
]);
