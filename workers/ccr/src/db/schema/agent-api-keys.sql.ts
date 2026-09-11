import { text, timestamp, index, foreignKey, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.sql';
import { agents } from './agents.sql';

export const agentApiKeys = app.table('agent_api_keys', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  agentId: text('agent_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  prefix: varchar({ length: 12 }).notNull(),
  name: text().notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  index('idx_agent_api_keys_agent_id').using('btree', table.agentId.asc().nullsLast()),
  index('idx_agent_api_keys_hash').using('btree', table.tokenHash.asc().nullsLast()).where(sql`(revoked_at IS NULL)`),
  foreignKey({
    columns: [table.agentId],
    foreignColumns: [agents.id],
    name: 'agent_api_keys_agent_id_fkey',
  }).onDelete('cascade'),
  unique('agent_api_keys_token_hash_key').on(table.tokenHash),
]);
