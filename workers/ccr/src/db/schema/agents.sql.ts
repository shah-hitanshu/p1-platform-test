import { text, timestamp, index, foreignKey, unique, uuid, jsonb, boolean, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.sql';
import { organizations } from './organizations.sql';

export const agents = app.table('agents', {
  id: text().default(sql`gen_random_uuid()::text`).primaryKey().notNull(),
  organizationId: uuid('organization_id').notNull(),
  name: text().notNull(),
  description: text(),
  capabilities: text().array().default(sql`'{}'::text[]`).notNull(),
  status: text().default('active').notNull(),
  settings: jsonb().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  isGlobal: boolean('is_global').default(false).notNull(),
}, (table) => [
  index('idx_agents_organization').using('btree', table.organizationId.asc().nullsLast()),
  index('idx_agents_status').using('btree', table.status.asc().nullsLast()),
  foreignKey({
    columns: [table.organizationId],
    foreignColumns: [organizations.id],
    name: 'agents_organization_id_fkey',
  }),
  unique('agents_organization_id_name_key').on(table.organizationId, table.name),
  check('agents_status_check', sql`status = ANY (ARRAY['active'::text, 'suspended'::text, 'disabled'::text])`),
  check('agents_id_uuid_format', sql`id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text`),
]);
