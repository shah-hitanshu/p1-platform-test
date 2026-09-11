import { text, timestamp, index, unique, uuid, boolean, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.schema';

export const users = app.table('users', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  email: text().notNull(),
  name: text(),
  principalId: text('principal_id'),
  authProvider: text('auth_provider'),
  systemRole: text('system_role').default('member').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  avatarUrl: text('avatar_url'),
}, (table) => [
  index('idx_users_email').using('btree', table.email.asc().nullsLast()),
  index('idx_users_principal_id').using('btree', table.principalId.asc().nullsLast()),
  unique('users_email_key').on(table.email),
  unique('users_principal_id_key').on(table.principalId),
  check('users_system_role_check', sql`system_role = ANY (ARRAY['member'::text, 'admin'::text, 'superadmin'::text])`),
]);
